const { app, BrowserWindow, ipcMain, session, desktopCapturer, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const { buildTranslateRequest, buildDraftRequest, MODEL } = require('./prompts.js');
const { pronounce } = require('./pronounce.js');

// ponytail: if turbo is too slow on the CPU fallback, switch to onnx-community/whisper-small
const WHISPER_MODEL = 'onnx-community/whisper-large-v3-turbo';
const OLLAMA = 'http://127.0.0.1:11434';
const DEFAULTS = { threshold: 0.01, silenceMs: 1200, contextPath: null };

const DraftSchema = z.object({
  reply_es: z.string(),
  reply_en: z.string(),
  used_context: z.boolean(),
});

let win, asr, statusText = 'Starting…';

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
function saveSettings(s) { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); }
let settings;

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

function readContext() {
  if (!settings.contextPath) return '';
  try { return fs.readFileSync(settings.contextPath, 'utf8'); } catch { return ''; }
}

function status(text) {
  statusText = text;
  console.log(`[status] ${text}`);
  win?.webContents.send('status', text);
}

// --- model loading ---
async function loadWhisper() {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = path.join(app.getPath('userData'), 'models');
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
    await ollamaChat({ model: MODEL, messages: [], keep_alive: '30m' }); // empty chat just loads the model
  } catch (e) {
    return status(e.message);
  }
  status(`Ready. Speech on ${whisper}, replies by ${MODEL}.`);
}

ipcMain.handle('transcribe', async (_e, pcm) => {
  if (!asr) throw new Error('Speech model is still loading.');
  const out = await asr(pcm, { language: 'spanish', task: 'transcribe' });
  console.log(`[heard] ${out.text.trim()}`);
  return out.text.trim();
});

// --- local LLM (Ollama) ---
ipcMain.handle('translate', (_e, text, history) => ollamaChat(buildTranslateRequest(text, history)));

ipcMain.handle('draft', async (_e, text, history) => {
  const content = await ollamaChat({ ...buildDraftRequest(text, history, readContext()), format: z.toJSONSchema(DraftSchema) });
  let reply;
  try {
    reply = DraftSchema.parse(JSON.parse(content));
  } catch {
    throw new Error('The model returned an unreadable reply.');
  }
  return { ...reply, pronunciation: pronounce(reply.reply_es) };
});

// --- settings IPC ---
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
  if (!r.canceled) { settings.contextPath = r.filePaths[0]; saveSettings(settings); }
  return publicSettings();
});
ipcMain.handle('status', () => statusText);

app.whenReady().then(() => {
  settings = loadSettings();
  // Grant desktop (loopback) audio to getDisplayMedia without a picker.
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb({ video: s[0], audio: 'loopback' }));
  });
  win = new BrowserWindow({
    width: 560, height: 860, title: 'RTST',
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
  loadModels();
});

app.on('window-all-closed', () => app.quit());
