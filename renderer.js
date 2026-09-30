const $ = (id) => document.getElementById(id);
const HOLD_MS = 300;       // press longer than this = hold-to-talk
const MIN_AUDIO_S = 0.3;   // ignore accidental blips

const history = [];        // [{ es, en, reply }] oldest first, sent to the model as context
let settings = {};
let rec = null;            // { chunks, peak, endpointer, pressAt } while listening
let busy = false;          // transcribing

// ---------- status ----------
const setStatus = (t) => { $('status').textContent = t; };
window.api.onStatus(setStatus);
window.api.getStatus().then(setStatus);
const cleanErr = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

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

// ---------- listen button: tap = auto-stop on pause, hold = until release ----------
function setButton(state) {
  const b = $('listen');
  b.className = state;
  b.textContent = { idle: 'Listen', listening: 'Listening…', processing: 'Working…' }[state];
}

function press() {
  if (busy) return;
  if (rec) return stopListening(); // tap again while auto-listening = stop now
  rec = { chunks: [], peak: 0, endpointer: null, pressAt: performance.now() };
  setButton('listening');
}

function release() {
  if (!rec || rec.pressAt === null) return;
  const held = performance.now() - rec.pressAt;
  rec.pressAt = null;
  if (held >= HOLD_MS) return stopListening();
  rec.endpointer = createEndpointer({ threshold: settings.threshold, silenceMs: settings.silenceMs, maxMs: 30000 });
}

$('listen').addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
$('listen').addEventListener('pointerup', release);
$('listen').addEventListener('pointerleave', release);
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat || $('settings').open) return;
  e.preventDefault();
  press();
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && !$('settings').open) release();
});

async function stopListening() {
  const r = rec;
  rec = null;
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

const secs = (a, b) => `${((b - a) / 1000).toFixed(1)}s`;

// ---------- chat ----------
function addTurn(es, tHeard) {
  $('empty')?.remove();
  const prior = history.slice();
  const turn = { es, en: null, reply: null };
  history.push(turn);

  const them = $('them-tpl').content.firstElementChild.cloneNode(true);
  them.querySelector('.es').textContent = es;
  const me = $('me-tpl').content.firstElementChild.cloneNode(true);
  $('chat').append(them, me);
  scrollDown();

  const timings = { heard: $('status').textContent };
  const report = () => setStatus([timings.heard, timings.en, timings.reply].filter(Boolean).join(' · '));

  run(them.querySelector('.en'), () => window.api.translate(es, prior), (en) => {
    turn.en = en;
    const el = them.querySelector('.en');
    el.className = 'en';
    el.textContent = en;
    timings.en = `translated ${secs(tHeard, performance.now())}`;
    report();
  });

  run(me.querySelector('.es'), () => window.api.draft(es, prior), (r) => {
    turn.reply = r;
    const el = me.querySelector('.es');
    el.className = 'es';
    el.textContent = r.reply_es;
    me.querySelector('.pron').textContent = r.pronunciation;
    me.querySelector('.en').textContent = r.reply_en;
    me.querySelector('.badge').hidden = r.used_context;
    timings.reply = `reply ${secs(tHeard, performance.now())}`;
    report();
  });
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
};
$('save-settings').onclick = async () => {
  settings = await window.api.setSettings({
    threshold: Number($('threshold').value),
    silenceMs: Math.round(Number($('silence').value) * 1000),
  });
};
$('clear-chat').onclick = () => {
  history.length = 0;
  $('chat').replaceChildren();
  $('settings').close();
  setStatus('Conversation cleared.');
};

// ---------- start ----------
(async () => {
  settings = await window.api.getSettings();
  if (!settings.contextPath) showSettings();
  try {
    await initAudio();
  } catch (e) {
    setStatus(`Could not capture desktop audio: ${cleanErr(e)}`);
    $('listen').disabled = true;
  }
})();
