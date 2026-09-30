const { app, BrowserWindow, ipcMain, session, desktopCapturer, dialog, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { z } = require('zod');
const Anthropic = require('@anthropic-ai/sdk').default;
const { betaZodOutputFormat } = require('@anthropic-ai/sdk/helpers/beta/zod');
const { buildTranslateRequest, buildDraftRequest } = require('./prompts.js');

// ponytail: if turbo is too slow on the CPU fallback, switch to onnx-community/whisper-small
const WHISPER_MODEL = 'onnx-community/whisper-large-v3-turbo';
const DEFAULTS = { threshold: 0.01, silenceMs: 1200, contextPath: null, apiKey: null };

const DraftSchema = z.object({
  reply_es: z.string(),
  pronunciation: z.string(),
  reply_en: z.string(),
  used_context: z.boolean(),
});

let win, asr, client, statusText = 'Starting…';

// --- settings (API key encrypted with the OS keychain via safeStorage) ---
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { return { ...DEFAULTS }; }
}
function saveSettings(s) { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); }
let settings;

function getClient() {
  if (client) return client;
  const key = settings.apiKey ? safeStorage.decryptString(Buffer.from(settings.apiKey, 'base64')) : process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('No Claude API key. Open Settings to add one.');
  return (client = new Anthropic({ apiKey: key }));
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

// --- speech-to-text ---
async function loadWhisper() {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.cacheDir = path.join(app.getPath('userData'), 'models');
  status('Loading speech model (first run downloads ~1 GB)…');
  const attempts = [
    ['dml', { encoder_model: 'fp16', decoder_model_merged: 'q4' }, 'GPU (DirectML)'],
    ['cpu', 'q8', 'CPU'],
  ];
  for (const [device, dtype, label] of attempts) {
    try {
      asr = await pipeline('automatic-speech-recognition', WHISPER_MODEL, { device, dtype });
      await asr(new Float32Array(16000), { language: 'spanish', task: 'transcribe' }); // warm-up
      return status(`Ready. Speech model on ${label}.`);
    } catch (e) {
      console.error(`Whisper on ${device} failed:`, e);
      asr = null;
    }
  }
  status('Speech model failed to load. Check the terminal for errors.');
}

ipcMain.handle('transcribe', async (_e, pcm) => {
  if (!asr) throw new Error('Speech model is still loading.');
  const out = await asr(pcm, { language: 'spanish', task: 'transcribe' });
  console.log(`[heard] ${out.text.trim()}`);
  return out.text.trim();
});

// --- Claude ---
ipcMain.handle('translate', async (_e, text, history) => {
  const msg = await getClient().messages.create(buildTranslateRequest(text, history));
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
});

ipcMain.handle('draft', async (_e, text, history) => {
  const req = buildDraftRequest(text, history, readContext());
  const msg = await getClient().beta.messages.parse({
    ...req,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { ...req.output_config, format: betaZodOutputFormat(DraftSchema) },
  });
  if (msg.stop_reason === 'refusal') throw new Error('Claude declined to draft a reply for this message.');
  if (!msg.parsed_output) throw new Error(`Could not read the drafted reply (stop reason: ${msg.stop_reason}).`);
  return msg.parsed_output;
});

// --- settings IPC ---
const publicSettings = () => ({
  hasKey: !!settings.apiKey || !!process.env.ANTHROPIC_API_KEY,
  contextPath: settings.contextPath,
  threshold: settings.threshold,
  silenceMs: settings.silenceMs,
});
ipcMain.handle('settings:get', () => publicSettings());
ipcMain.handle('settings:set', (_e, patch) => {
  if (patch.apiKey) {
    settings.apiKey = safeStorage.encryptString(patch.apiKey.trim()).toString('base64');
    client = null;
  }
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
  loadWhisper();
});

app.on('window-all-closed', () => app.quit());
