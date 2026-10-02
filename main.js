const { app, BrowserWindow, ipcMain, session, desktopCapturer, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const { buildTranslateRequest, buildDraftRequest, buildSuggestRequest, buildSummaryRequest, MODEL } = require('./prompts.js');

// ponytail: if turbo is too slow on the CPU fallback, switch to onnx-community/whisper-small
const WHISPER_MODEL = 'onnx-community/whisper-large-v3-turbo';
const OLLAMA = 'http://127.0.0.1:11434';
const DEFAULTS = { threshold: 0.01, silenceMs: 1200, contextPath: null };
const MEMORY_CHARS = 6000; // ponytail: only the newest memory is sent; re-summarize memory.md if old meetings matter

const DraftSchema = z.object({ reply_es: z.string(), reply_en: z.string(), used_context: z.boolean() });
const SuggestSchema = z.object({ suggestions: z.array(z.object({ es: z.string(), en: z.string() })) });

let win, asr, statusText = 'Starting…';

// --- files: settings, context, memory, meeting transcripts (all in %APPDATA%/rtst) ---
const dataPath = (...p) => path.join(app.getPath('userData'), ...p);
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(dataPath('settings.json'), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
function saveSettings(s) { fs.writeFileSync(dataPath('settings.json'), JSON.stringify(s, null, 2)); }
let settings;

const readFile = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const readContext = () => (settings.contextPath ? readFile(settings.contextPath) : '');
const readMemory = () => readFile(dataPath('memory.md')).slice(-MEMORY_CHARS);

// 2026-10-02_15-30-05 -> 2026-10-02 15:30
const prettyId = (id) => id.replace(/_(\d\d)-(\d\d)-\d\d$/, ' $1:$2');

function transcriptPath(meetingId) {
  if (!/^[\w-]+$/.test(meetingId)) throw new Error('Bad meeting id.');
  fs.mkdirSync(dataPath('meetings'), { recursive: true });
  return dataPath('meetings', `${meetingId}.md`);
}
function transcriptMarkdown(meetingId, history, summary) {
  const lines = [`# Meeting ${prettyId(meetingId)}`, ''];
  if (summary) lines.push('## Summary', summary, '', '## Transcript', '');
  for (const m of history) lines.push(`**${m.who === 'me' ? 'You' : 'Them'}:** ${m.es}  `, m.en ? `*${m.en}*` : '', '');
  return lines.join('\n');
}

// --- Ollama ---
async function ollamaChat(body) {
  let res;
  try {
    res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: JSON.stringify(body) });
  } catch {
    throw new Error('Ollama is not running. Start the Ollama app, then Retry.');
  }
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`Ollama: ${json.error || res.status}`);
  return json.message?.content?.trim() ?? '';
}

async function ollamaJson(body, schema) {
  const content = await ollamaChat({ ...body, format: z.toJSONSchema(schema) });
  try {
    return schema.parse(JSON.parse(content));
  } catch {
    throw new Error('The model returned an unreadable answer.');
  }
}

// Loads the model and pre-processes the context + memory prefix, so the first real reply is fast.
function warmUp() {
  const req = buildDraftRequest('Hola', [], readContext(), readMemory());
  return ollamaChat({ ...req, options: { ...req.options, num_predict: 1 } });
}

function status(text) {
  statusText = text;
  console.log(`[status] ${text}`);
  win?.webContents.send('status', text);
}

// --- model loading ---
async function loadWhisper() {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = dataPath('models');
  status('Loading speech model (first run downloads ~1 GB)…');
  const attempts = [
    ['dml', { encoder_model: 'fp16', decoder_model_merged: 'q4' }, 'GPU'],
    ['cpu', 'q8', 'CPU'],
  ];
  for (const [device, dtype, label] of attempts) {
    try {
      asr = await pipeline('automatic-speech-recognition', WHISPER_MODEL, { device, dtype });
      await asr(new Float32Array(16000), { language: 'spanish', task: 'transcribe' }); // warm-up
      return label;
    } catch (e) {
      console.error(`Whisper on ${device} failed:`, e);
      asr = null;
    }
  }
  return null;
}

async function loadModels() {
  const whisper = await loadWhisper();
  if (!whisper) return status('Speech model failed to load. Check the terminal for errors.');
  status(`Loading ${MODEL}…`);
  try {
    await warmUp();
  } catch (e) {
    return status(e.message);
  }
  status(`Ready. Speech on ${whisper}, replies by ${MODEL}.`);
}

ipcMain.handle('transcribe', async (_e, pcm) => {
  if (!asr) throw new Error('Speech model is still loading.');
  // chunking lets recordings longer than Whisper's 30 s window be transcribed in full
  const out = await asr(pcm, { language: 'spanish', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
  console.log(`[heard] ${out.text.trim()}`);
  return out.text.trim();
});

// --- conversation ---
ipcMain.handle('translate', (_e, text, history) => ollamaChat(buildTranslateRequest(text, history)));

ipcMain.handle('draft', (_e, text, history) =>
  ollamaJson(buildDraftRequest(text, history, readContext(), readMemory()), DraftSchema));

ipcMain.handle('suggest', async (_e, history) =>
  (await ollamaJson(buildSuggestRequest(history, readContext(), readMemory()), SuggestSchema)).suggestions.slice(0, 5));

ipcMain.handle('meeting:save', (_e, meetingId, history) => {
  fs.writeFileSync(transcriptPath(meetingId), transcriptMarkdown(meetingId, history));
});

ipcMain.handle('meeting:end', async (_e, meetingId, history) => {
  const file = transcriptPath(meetingId);
  fs.writeFileSync(file, transcriptMarkdown(meetingId, history)); // save first, in case summarizing fails
  const summary = await ollamaChat(buildSummaryRequest(history));
  fs.writeFileSync(file, transcriptMarkdown(meetingId, history, summary));
  fs.appendFileSync(dataPath('memory.md'), `\n## Meeting on ${prettyId(meetingId)}\n${summary}\n`);
  warmUp().catch(() => {}); // memory changed: refresh the cached prefix
  return summary;
});

// --- settings ---
const publicSettings = () => ({
  contextPath: settings.contextPath,
  threshold: settings.threshold,
  silenceMs: settings.silenceMs,
});
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  if (typeof patch.threshold === 'number') settings.threshold = patch.threshold;
  if (typeof patch.silenceMs === 'number') settings.silenceMs = patch.silenceMs;
  saveSettings(settings);
  return publicSettings();
});
ipcMain.handle('settings:pickContext', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose your context file',
    properties: ['openFile'],
    filters: [{ name: 'Text', extensions: ['txt', 'md'] }],
  });
  if (!r.canceled) {
    settings.contextPath = r.filePaths[0];
    saveSettings(settings);
    warmUp().catch(() => {});
  }
  return publicSettings();
});
ipcMain.handle('openDataFolder', () => shell.openPath(app.getPath('userData')));
ipcMain.handle('status', () => statusText);

app.whenReady().then(() => {
  settings = loadSettings();
  // Grant desktop (loopback) audio to getDisplayMedia without a picker.
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb({ video: s[0], audio: 'loopback' }));
  });
  win = new BrowserWindow({
    width: 980, height: 860, title: 'RTST',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
  loadModels();
});

app.on('window-all-closed', () => app.quit());
