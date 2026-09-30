# RTST: Real-Time Spanish Translator

Electron app (Windows) that captures desktop audio (a Spanish-speaking customer on a voice call), transcribes it with local
Whisper, translates it with Claude, and drafts a Spanish reply (plus a pronunciation guide and English meaning) from a
user-written context file. The user reads the reply aloud. Design spec: [docs/specs/2026-09-30-rtst-design.md](docs/specs/2026-09-30-rtst-design.md).

## Run / test
- `npm start` launches the app. `npm test` runs `node --test` (endpointer and prompt builders).
- VS Code / Claude Code set `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node (`ipcMain` undefined).
  `npm start` clears it; when launching manually, use `env -u ELECTRON_RUN_AS_NODE npx electron .`.
- Launch with `--remote-debugging-port=9229` to drive the renderer via CDP (call `press()` / `release()` in the page).

## Layout
- `main.js`: window, loopback-audio grant (`setDisplayMediaRequestHandler` with `audio: 'loopback'`), Whisper, Claude calls, settings (API key encrypted with `safeStorage` in `%APPDATA%/rtst/settings.json`).
- `prompts.js`: pure request builders (translate = `claude-haiku-4-5`, draft = `claude-opus-5` at low effort with structured output).
- `endpoint.js`: pause detection for tap-to-listen. Shared by the renderer (plain script) and tests.
- `renderer.js`: audio capture (16 kHz AudioContext + ScriptProcessor), Listen button (tap = auto-stop on pause, hold = until release, Space works too), chat bubbles.

## Decisions
- TransWord.ai has no public API, so Claude does the translation instead.
- Whisper: `onnx-community/whisper-large-v3-turbo` via transformers.js with `device: 'dml'` (DirectML on the AMD RX 6800 XT, ~1 s per 11 s clip), falling back to CPU.
  The model is cached in `%APPDATA%/rtst/models`.
- Translation and drafting run in parallel right after transcription, so the English shows first and the reply follows.
- Conversation history is kept in memory only (last 10 turns sent to the drafter).
