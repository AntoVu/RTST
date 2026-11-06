const $ = (id) => document.getElementById(id);
const MIN_SPEECH_S = 0.3;  // ignore blips: needs this much audio above the threshold
const AUTO_MAX_MS = 60000; // tap mode cap; hold and locked modes have none
const PREROLL_CHUNKS = 2;  // ~0.5 s kept from before a recording starts, so the first word isn't clipped
const PREVIEW_MS = 1500;   // live preview: re-transcribe the recording so far this often while they talk
const PREVIEW_MAX_S = 20;  // ...using only the newest audio, so previews stay fast during long turns
const MIC_TARGETS = 3;     // speech check compares against the newest few replies you haven't said yet

const QUICK_PHRASES = [
  ['¡Hola! Mucho gusto.', 'Hi! Nice to meet you.'],
  ['¿Cómo está?', 'How are you?'],
  ['¿Puede repetirlo, por favor?', 'Can you repeat that, please?'],
  ['¿Puede hablar más despacio, por favor?', 'Can you speak more slowly, please?'],
  ['No entiendo. ¿Qué significa eso?', "I don't understand. What does that mean?"],
  ['Un momento, por favor.', 'One moment, please.'],
  ['Perdón, mi español no es muy bueno.', "Sorry, my Spanish isn't very good."],
  ['Voy a compartir mi pantalla.', "I'm going to share my screen."],
  ['¡Muchas gracias!', 'Thank you very much!'],
  ['Gracias por su tiempo. ¡Hasta luego!', 'Thank you for your time. See you later!'],
];

// The whole meeting, oldest first: [{ who: 'them' | 'me', es, en }]. Sent to the model as memory.
// A 'me' entry is added as a placeholder (es: null) when a draft starts, so messages stay in order.
const history = [];
let meetingId = null;      // set by the first message, e.g. 2026-10-02_15-30-05
let settings = {};
let rec = null;            // { chunks, loud, endpointer } while listening
let preroll = [];          // the last few chunks while not listening
let pending = 0;           // recordings waiting for or in transcription
let queue = Promise.resolve(); // transcriptions run one at a time, in order, while listening continues
const button = createListenButton({ holdMs: 300, doubleTapMs: 400 });

// ---------- status ----------
const setStatus = (t) => { $('status').textContent = t; };
window.api.onStatus(setStatus);
window.api.getStatus().then(setStatus);
const cleanErr = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const secs = (a, b) => `${((b - a) / 1000).toFixed(1)}s`;

// ---------- meeting log ----------
function newMeetingId() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
function addMessage(m) {
  if (!history.length) meetingId = newMeetingId();
  history.push(m);
  saveMeeting();
  return m;
}
// Rewritten after every change so the transcript survives closing the app.
function saveMeeting() {
  if (!history.length) return;
  window.api.saveMeeting(meetingId, history.filter((m) => m.es)).catch((e) => setStatus(`Could not save transcript: ${cleanErr(e)}`));
}

// ---------- desktop audio ----------
async function initAudio() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  stream.getVideoTracks().forEach((t) => t.stop());
  if (!stream.getAudioTracks().length) throw new Error('No desktop audio track was granted.');
  const ctx = new AudioContext({ sampleRate: 16000 }); // Whisper wants 16 kHz mono
  const source = ctx.createMediaStreamSource(stream);
  // ponytail: ScriptProcessor is deprecated; move to AudioWorklet if Chromium drops it
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0; // keep the graph running without playing the audio back
  proc.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    $('level').style.width = `${Math.min(100, rms * 400)}%`;
    const chunk = new Float32Array(data);
    if (!rec && settings.autoListen && rms >= settings.threshold) {
      startRec(autoEndpointer());
      button.autoStart();
      setButton('listening');
    }
    if (!rec) { preroll = [...preroll, chunk].slice(-PREROLL_CHUNKS); return; }
    rec.chunks.push(chunk);
    if (rms >= settings.threshold) rec.loud += chunk.length;
    if (rec.endpointer && rec.endpointer.feed(rms, performance.now()) === 'stop') return stopListening();
    maybePreview(rec);
  };
  source.connect(proc).connect(mute).connect(ctx.destination);
}

// ---------- listen button: tap = auto-stop on pause, hold = until release, double-tap = locked ----------
function setButton(state) {
  const b = $('listen');
  b.className = state;
  b.textContent = { idle: 'Listen', listening: 'Listening…', locked: 'Locked · tap to stop', processing: 'Working…' }[state];
}

function startRec(endpointer) {
  rec = { chunks: preroll, loud: 0, endpointer, preview: null, previewAt: performance.now(), previewBusy: false };
  preroll = [];
}

const joinChunks = (chunks) => {
  const pcm = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) { pcm.set(c, o); o += c.length; }
  return pcm;
};

// ---------- live preview: what they're saying so far, translated, while they're still talking ----------
// One preview in flight per recording; main.js skips it if Whisper is busy with a real transcription.
function maybePreview(r) {
  if (!settings.livePreview || r.previewBusy || r.loud < 16000 * 0.5 || performance.now() - r.previewAt < PREVIEW_MS) return;
  r.previewBusy = true;
  r.previewAt = performance.now();
  const pcm = joinChunks(r.chunks).slice(-16000 * PREVIEW_MAX_S);
  const prior = history.filter((m) => m.es).slice(-4);
  window.api.transcribePartial(pcm).then(async (es) => {
    if (!es || r.done) return;
    showPreview(r, es, null);
    const en = await window.api.translate(es, prior).catch(() => null);
    if (en && !r.done) showPreview(r, es, en);
  }).catch(() => {}).finally(() => { r.previewBusy = false; r.previewAt = performance.now(); });
}

function showPreview(r, es, en) {
  if (!r.preview) {
    $('empty')?.remove();
    r.preview = cloneTpl('them-tpl');
    r.preview.classList.add('preview');
    $('chat').append(r.preview);
  }
  r.preview.querySelector('.es').textContent = es;
  const enEl = r.preview.querySelector('.en');
  if (en) { enEl.className = 'en'; enEl.textContent = en; }
  scrollDown();
}
const autoEndpointer = () => createEndpointer({ threshold: settings.threshold, silenceMs: settings.silenceMs, maxMs: AUTO_MAX_MS });

function act(action) {
  if (action === 'start') {
    startRec(null);
    setButton('listening');
  } else if (action === 'auto') {
    rec.endpointer = autoEndpointer();
  } else if (action === 'lock') {
    rec.endpointer = null;
    setButton('locked');
  } else if (action === 'stop') {
    stopListening();
  }
}
const press = () => act(button.press(performance.now()));
const release = () => act(button.release(performance.now()));

// Pointer capture keeps a hold going even if the mouse slides off the button.
$('listen').addEventListener('pointerdown', (e) => { e.preventDefault(); $('listen').setPointerCapture(e.pointerId); press(); });
$('listen').addEventListener('pointerup', release);
const typing = () => $('settings').open || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || typing()) return;
  e.preventDefault();
  press();
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !typing()) release();
});

function stopListening() {
  const r = rec;
  rec = null;
  button.reset();
  if (!r) return;
  r.done = true; // late previews for this recording are ignored
  if (r.loud < 16000 * MIN_SPEECH_S) {
    r.preview?.remove();
    setButton(pending ? 'processing' : 'idle');
    return setStatus('No speech heard.');
  }
  r.preview?.classList.add('finishing');
  const pcm = joinChunks(r.chunks);
  pending++;
  setButton('processing');
  queue = queue.then(() => transcribe(pcm, r.preview));
}

async function transcribe(pcm, preview) {
  const t0 = performance.now();
  let es;
  try {
    es = await window.api.transcribe(pcm);
  } catch (e) {
    return setStatus(`Transcription failed: ${cleanErr(e)}`);
  } finally {
    preview?.remove(); // the final message replaces it
    pending--;
    if (!rec) setButton(pending ? 'processing' : 'idle');
  }
  if (!es) return setStatus('No speech recognized.');
  const tHeard = performance.now();
  setStatus(`Heard in ${secs(t0, tHeard)}`);
  addTurn(es, tHeard);
}

// ---------- chat ----------
const cloneTpl = (id) => $(id).content.firstElementChild.cloneNode(true);

function fillMine(el, es, en) {
  const esEl = el.querySelector('.es');
  esEl.className = 'es';
  esEl.textContent = es;
  el.querySelector('.pron').textContent = pronounce(es);
  el.querySelector('.en').textContent = en;
}

// Your bubbles, for the speech check: message -> its element. (Kept out of `history`, which is sent over IPC.)
const mineEls = new WeakMap();
function addMine(m, el) {
  mineEls.set(m, el);
  el.querySelector('.count-it').onclick = () => markSaid(m, null);
  return el;
}
function markSaid(m, heard) {
  m.said = true;
  const el = mineEls.get(m);
  if (el) {
    el.classList.add('said');
    el.classList.remove('missed');
    el.querySelector('.heard').textContent = heard ? `✓ You said: ${heard}` : '✓ Said';
  }
  saveMeeting();
}
function resetSaid(m) {
  m.said = false;
  const el = mineEls.get(m);
  el?.classList.remove('said', 'missed');
  if (el) el.querySelector('.heard').textContent = '';
}

// A short remark with no question ("Sí.", "Bueno.", "Ah...") usually means they're still talking, so it gets no reply.
const isFiller = (es) => !es.includes('?') && es.trim().split(/\s+/).length <= 3;

function addTurn(es, tHeard) {
  $('empty')?.remove();
  const prior = history.filter((m) => m.es);
  const theirs = addMessage({ who: 'them', es, en: null });
  const them = cloneTpl('them-tpl');
  them.querySelector('.es').textContent = es;
  $('chat').append(them);
  scrollDown();

  const timings = { heard: $('status').textContent };
  const report = () => setStatus([timings.heard, timings.en, timings.reply].filter(Boolean).join(' · '));

  run(them.querySelector('.en'), () => window.api.translate(es, prior), (en) => {
    theirs.en = en;
    const el = them.querySelector('.en');
    el.className = 'en';
    el.textContent = en;
    saveMeeting();
    timings.en = `translated ${secs(tHeard, performance.now())}`;
    report();
  });

  if (isFiller(es)) return;
  const mine = addMessage({ who: 'me', es: null, en: null });
  const me = addMine(mine, cloneTpl('me-tpl'));
  $('chat').append(me);
  scrollDown();
  const tried = []; // drafts already shown for this message, so Refresh asks for something new
  const refreshBtn = me.querySelector('.refresh');
  const showDraft = (r) => {
    // ponytail: a draft counts as said even if the user picks a starter instead; add a "skip" toggle if that confuses replies
    mine.es = r.reply_es;
    mine.en = r.reply_en;
    tried.push(r.reply_es);
    fillMine(me, r.reply_es, r.reply_en);
    refreshBtn.hidden = false;
    saveMeeting();
  };
  run(me.querySelector('.es'), () => window.api.draft(es, prior), (r) => {
    showDraft(r);
    timings.reply = `reply ${secs(tHeard, performance.now())}`;
    report();
  });
  refreshBtn.onclick = () => {
    refreshBtn.hidden = true;
    resetSaid(mine);
    const esEl = me.querySelector('.es');
    esEl.className = 'es pending';
    esEl.textContent = 'Drafting another reply…';
    me.querySelector('.pron').textContent = '';
    me.querySelector('.en').textContent = '';
    run(esEl, () => window.api.draft(es, prior, tried.slice(-3)), showDraft);
  };
}

// The user picked a phrase from the sidebar: show it as their message to read aloud.
function say(es, en) {
  $('empty')?.remove();
  const m = addMessage({ who: 'me', es, en });
  const me = addMine(m, cloneTpl('me-tpl'));
  fillMine(me, es, en);
  $('chat').append(me);
  scrollDown();
}

// ---------- type it in English: becomes Spanish for you to say ----------
$('say-form').onsubmit = (e) => {
  e.preventDefault();
  const english = $('say-input').value.trim();
  if (!english) return;
  $('say-input').value = '';
  $('empty')?.remove();
  const prior = history.filter((m) => m.es);
  const m = addMessage({ who: 'me', es: null, en: null });
  const me = addMine(m, cloneTpl('me-tpl'));
  me.querySelector('.es').textContent = 'Translating…';
  $('chat').append(me);
  scrollDown();
  run(me.querySelector('.es'), () => window.api.phrase(english, prior), (r) => {
    m.es = r.es;
    m.en = r.en;
    fillMine(me, r.es, r.en);
    saveMeeting();
  });
};

// ---------- speech check: your mic, compared with the replies you haven't said yet ----------
// Listens only while "Check my speech" is on, a reply is waiting to be said, and the other person isn't being recorded
// (without headphones the mic hears them too). A fuzzy match (speech-match.js) forgives accents and small mistakes.
let mic = null; // { rec, preroll, busy }
const unsaid = () => history.filter((m) => m.who === 'me' && m.es && !m.said && mineEls.has(m)).slice(-MIC_TARGETS);

async function initMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  mic = { rec: null, preroll: [], stream, ctx };
  proc.onaudioprocess = (e) => {
    if (!settings.micCheck) return;
    const data = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    $('mic-level').style.width = `${Math.min(100, rms * 400)}%`;
    const chunk = new Float32Array(data);
    if (!mic.rec) {
      if (rms >= settings.micThreshold && !rec && unsaid().length) {
        mic.rec = { chunks: mic.preroll, loud: 0, endpointer: createEndpointer({ threshold: settings.micThreshold, silenceMs: settings.silenceMs, maxMs: 30000 }) };
        mic.preroll = [];
        $('mic-toggle').classList.add('hearing');
      } else {
        mic.preroll = [...mic.preroll, chunk].slice(-PREROLL_CHUNKS);
        return;
      }
    }
    mic.rec.chunks.push(chunk);
    if (rms >= settings.micThreshold) mic.rec.loud += chunk.length;
    if (mic.rec.endpointer.feed(rms, performance.now()) === 'stop') stopMic();
  };
  ctx.createMediaStreamSource(stream).connect(proc).connect(mute).connect(ctx.destination);
}

function stopMic() {
  const r = mic.rec;
  mic.rec = null;
  $('mic-toggle').classList.remove('hearing');
  if (r.loud < 16000 * MIN_SPEECH_S) return;
  queue = queue.then(() => checkSpeech(joinChunks(r.chunks)));
}

async function checkSpeech(pcm) {
  const targets = unsaid();
  if (!targets.length) return;
  let heard;
  try {
    heard = await window.api.transcribeMine(pcm);
  } catch (e) {
    return setStatus(`Speech check failed: ${cleanErr(e)}`);
  }
  if (!heard) return;
  const hit = speechMatch.best(heard, targets.map((m, i) => ({ id: i, es: m.es })), settings.matchThreshold);
  if (hit) {
    markSaid(targets[hit.id], heard);
    return setStatus(`You said it (${Math.round(hit.score * 100)}% match).`);
  }
  // Show the near miss on the newest reply, with a button to count it anyway.
  const m = targets.at(-1);
  const pct = Math.round(speechMatch.score(heard, m.es) * 100);
  const el = mineEls.get(m);
  el.classList.add('missed');
  el.querySelector('.heard').textContent = `Heard: ${heard} (${pct}% match)`;
  setStatus(`Not a match yet (${pct}%). Try again, or click "Count it".`);
}

$('mic-check').onchange = async () => {
  const on = $('mic-check').checked;
  if (on && !mic) {
    try {
      await initMic();
    } catch (e) {
      $('mic-check').checked = false;
      return setStatus(`Could not use the microphone: ${cleanErr(e)}`);
    }
  }
  settings = await window.api.setSettings({ micCheck: on });
  $('mic-toggle').classList.toggle('on', on);
  if (!on) { if (mic?.rec) mic.rec = null; $('mic-level').style.width = '0'; }
};

// Runs an async call; on failure shows the error in `el` with a Retry button.
function run(el, call, onDone) {
  call().then((v) => { onDone(v); scrollDown(); }, (e) => {
    el.className = 'error';
    el.textContent = cleanErr(e);
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.onclick = () => { el.className = 'pending'; el.textContent = '…'; run(el, call, onDone); };
    el.append(retry);
  });
}

function scrollDown() { $('chat').scrollTop = $('chat').scrollHeight; }

function resetChat() {
  history.length = 0;
  meetingId = null;
  $('chat').replaceChildren();
}

// ---------- sidebar ----------
function starterItem(es, en) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  const esEl = document.createElement('span');
  const enEl = document.createElement('small');
  esEl.textContent = es;
  enEl.textContent = en;
  b.append(esEl, enEl);
  b.onclick = () => say(es, en);
  li.append(b);
  return li;
}
$('quick').append(...QUICK_PHRASES.map(([es, en]) => starterItem(es, en)));

// The context file's "# Sidebar questions" section. Re-read whenever the window regains focus,
// so edits to the file show up after switching back from the editor.
async function loadQuestions() {
  const groups = await window.api.questions();
  $('context-questions').hidden = !groups.length;
  $('question-groups').replaceChildren(...groups.map((g) => {
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = g.title || 'Questions';
    const ul = document.createElement('ul');
    ul.className = 'starters';
    ul.append(...g.items.map((q) => starterItem(q.es, q.en)));
    details.append(summary, ul);
    return details;
  }));
}
window.addEventListener('focus', loadQuestions);

$('suggest').onclick = async () => {
  const btn = $('suggest');
  btn.disabled = true;
  btn.textContent = 'Thinking…';
  try {
    const list = await window.api.suggest(history.filter((m) => m.es));
    $('suggestions').replaceChildren(...list.map((s) => starterItem(s.es, s.en)));
  } catch (e) {
    const li = document.createElement('li');
    li.className = 'error';
    li.textContent = cleanErr(e);
    $('suggestions').replaceChildren(li);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Suggest';
  }
};

// ---------- end meeting ----------
$('end-meeting').onclick = async () => {
  const said = history.filter((m) => m.es);
  if (!said.length) return setStatus('Nothing to save yet.');
  if (!confirm('End this meeting? Notes will be saved to memory and the chat cleared.')) return;
  const btn = $('end-meeting');
  btn.disabled = true;
  btn.textContent = 'Saving notes…';
  try {
    await window.api.endMeeting(meetingId, said);
    resetChat();
    setStatus('Meeting saved. Its notes will be remembered next time.');
  } catch (e) {
    setStatus(`Could not save meeting notes: ${cleanErr(e)}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'End meeting';
  }
};

// ---------- settings ----------
function showSettings() {
  $('context-path').textContent = settings.contextPath || 'None chosen';
  $('threshold').value = settings.threshold;
  $('threshold-out').textContent = settings.threshold;
  $('silence').value = settings.silenceMs / 1000;
  $('live-preview').checked = settings.livePreview;
  $('mic-threshold').value = settings.micThreshold;
  $('mic-threshold-out').textContent = settings.micThreshold;
  $('match-threshold').value = Math.round(settings.matchThreshold * 100);
  $('match-threshold-out').textContent = `${Math.round(settings.matchThreshold * 100)}%`;
  $('settings').showModal();
}
$('open-settings').onclick = showSettings;
$('threshold').oninput = () => { $('threshold-out').textContent = $('threshold').value; };
$('mic-threshold').oninput = () => { $('mic-threshold-out').textContent = $('mic-threshold').value; };
$('match-threshold').oninput = () => { $('match-threshold-out').textContent = `${$('match-threshold').value}%`; };
$('pick-context').onclick = async () => {
  settings = await window.api.pickContext();
  $('context-path').textContent = settings.contextPath || 'None chosen';
  loadQuestions();
};
$('open-data').onclick = () => window.api.openDataFolder();
$('save-settings').onclick = async () => {
  settings = await window.api.setSettings({
    threshold: Number($('threshold').value),
    silenceMs: Math.round(Number($('silence').value) * 1000),
    livePreview: $('live-preview').checked,
    micThreshold: Number($('mic-threshold').value),
    matchThreshold: Number($('match-threshold').value) / 100,
  });
};
$('auto-listen').onchange = async () => {
  settings = await window.api.setSettings({ autoListen: $('auto-listen').checked });
};
$('clear-chat').onclick = () => {
  resetChat();
  $('settings').close();
  setStatus('Conversation cleared. Its transcript is still in the meetings folder.');
};

// ---------- start ----------
(async () => {
  settings = await window.api.getSettings();
  $('auto-listen').checked = settings.autoListen;
  if (settings.micCheck) { $('mic-check').checked = true; $('mic-check').onchange(); }
  loadQuestions();
  if (!settings.contextPath) showSettings();
  try {
    await initAudio();
  } catch (e) {
    setStatus(`Could not capture desktop audio: ${cleanErr(e)}`);
    $('listen').disabled = true;
  }
})();
