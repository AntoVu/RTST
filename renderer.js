const $ = (id) => document.getElementById(id);
const MIN_AUDIO_S = 0.3;   // ignore accidental blips
const AUTO_MAX_MS = 60000; // tap mode cap; hold and locked modes have none

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
let rec = null;            // { chunks, peak, endpointer } while listening
let busy = false;          // transcribing
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
    $('level').style.width = rec ? `${Math.min(100, rms * 400)}%` : '0';
    if (!rec) return;
    rec.chunks.push(new Float32Array(data));
    rec.peak = Math.max(rec.peak, rms);
    if (rec.endpointer && rec.endpointer.feed(rms, performance.now()) === 'stop') stopListening();
  };
  source.connect(proc).connect(mute).connect(ctx.destination);
}

// ---------- listen button: tap = auto-stop on pause, hold = until release, double-tap = locked ----------
function setButton(state) {
  const b = $('listen');
  b.className = state;
  b.textContent = { idle: 'Listen', listening: 'Listening…', locked: 'Locked · tap to stop', processing: 'Working…' }[state];
}

function act(action) {
  if (action === 'start') {
    rec = { chunks: [], peak: 0, endpointer: null };
    setButton('listening');
  } else if (action === 'auto') {
    rec.endpointer = createEndpointer({ threshold: settings.threshold, silenceMs: settings.silenceMs, maxMs: AUTO_MAX_MS });
  } else if (action === 'lock') {
    rec.endpointer = null;
    setButton('locked');
  } else if (action === 'stop') {
    stopListening();
  }
}
const press = () => { if (!busy) act(button.press(performance.now())); };
const release = () => act(button.release(performance.now()));

// Pointer capture keeps a hold going even if the mouse slides off the button.
$('listen').addEventListener('pointerdown', (e) => { e.preventDefault(); $('listen').setPointerCapture(e.pointerId); press(); });
$('listen').addEventListener('pointerup', release);
const typing = () => $('settings').open;
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || typing()) return;
  e.preventDefault();
  press();
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !typing()) release();
});

async function stopListening() {
  const r = rec;
  rec = null;
  button.reset();
  if (!r) return;
  const len = r.chunks.reduce((n, c) => n + c.length, 0);
  if (len < 16000 * MIN_AUDIO_S || r.peak < settings.threshold) {
    setButton('idle');
    return setStatus('No speech heard.');
  }
  const pcm = new Float32Array(len);
  let o = 0;
  for (const c of r.chunks) { pcm.set(c, o); o += c.length; }

  busy = true;
  setButton('processing');
  const t0 = performance.now();
  let es;
  try {
    es = await window.api.transcribe(pcm);
  } catch (e) {
    return setStatus(`Transcription failed: ${cleanErr(e)}`);
  } finally {
    busy = false;
    setButton('idle');
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

function addTurn(es, tHeard) {
  $('empty')?.remove();
  const prior = history.filter((m) => m.es);
  const theirs = addMessage({ who: 'them', es, en: null });
  const mine = addMessage({ who: 'me', es: null, en: null });

  const them = cloneTpl('them-tpl');
  them.querySelector('.es').textContent = es;
  const me = cloneTpl('me-tpl');
  $('chat').append(them, me);
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

  run(me.querySelector('.es'), () => window.api.draft(es, prior), (r) => {
    // ponytail: a draft counts as said even if the user picks a starter instead; add a "skip" toggle if that confuses replies
    mine.es = r.reply_es;
    mine.en = r.reply_en;
    fillMine(me, r.reply_es, r.reply_en);
    saveMeeting();
    timings.reply = `reply ${secs(tHeard, performance.now())}`;
    report();
  });
}

// The user picked a phrase from the sidebar: show it as their message to read aloud.
function say(es, en) {
  $('empty')?.remove();
  addMessage({ who: 'me', es, en });
  const me = cloneTpl('me-tpl');
  fillMine(me, es, en);
  $('chat').append(me);
  scrollDown();
}

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
  $('settings').showModal();
}
$('open-settings').onclick = showSettings;
$('threshold').oninput = () => { $('threshold-out').textContent = $('threshold').value; };
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
  });
};
$('clear-chat').onclick = () => {
  resetChat();
  $('settings').close();
  setStatus('Conversation cleared. Its transcript is still in the meetings folder.');
};

// ---------- start ----------
(async () => {
  settings = await window.api.getSettings();
  loadQuestions();
  if (!settings.contextPath) showSettings();
  try {
    await initAudio();
  } catch (e) {
    setStatus(`Could not capture desktop audio: ${cleanErr(e)}`);
    $('listen').disabled = true;
  }
})();
