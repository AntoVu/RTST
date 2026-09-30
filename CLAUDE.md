# RTST: Real-Time Spanish Translator

Electron app (Windows) that captures desktop audio (a Spanish-speaking customer on a voice call), transcribes it with local
Whisper, translates it and drafts a Spanish reply (plus a pronunciation guide and English meaning) with a local Ollama model,
using a context file the user writes. The user reads the reply aloud. Everything runs locally and costs nothing.
Original design spec (Claude-based, since replaced by Ollama): [docs/specs/2026-09-30-rtst-design.md](docs/specs/2026-09-30-rtst-design.md).

## Run / test
- Requires the Ollama app running (0.35+; 0.20.x ignored `think:false` for Gemma 4) with `gemma4:e4b` pulled.
- `npm start` launches the app. `npm test` runs `node --test` (endpointer, prompt builders, pronunciation).
- VS Code / Claude Code set `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node (`ipcMain` undefined).
  `npm start` clears it; when launching manually, use `env -u ELECTRON_RUN_AS_NODE npx electron .`.
- Launch with `--remote-debugging-port=9229` to drive the renderer via CDP (`press()` / `release()`, or `addTurn('texto', performance.now())` to skip audio).

## Layout
- `main.js`: window, loopback-audio grant (`setDisplayMediaRequestHandler` with `audio: 'loopback'`), Whisper, Ollama calls (`/api/chat`), settings in `%APPDATA%/rtst/settings.json`.
- `prompts.js`: pure Ollama request builders. One model (`gemma4:e4b`) serves both translate and draft; draft uses a zod JSON schema via Ollama `format`.
- `pronounce.js`: rule-based Spanish-to-English respelling with stress. The small LLM was unreliable at this, so the model doesn't produce pronunciation.
- `endpoint.js`: pause detection for tap-to-listen. Shared by the renderer (plain script) and tests.
- `renderer.js`: audio capture (16 kHz AudioContext + ScriptProcessor), Listen button (tap = auto-stop on pause, hold = until release, Space works too), chat bubbles.

## Decisions
- TransWord.ai has no public API. Claude was used first, then swapped to local Ollama so it's free.
- Whisper: `onnx-community/whisper-large-v3-turbo` via transformers.js with `device: 'dml'` (DirectML on the AMD RX 6800 XT), falling back to CPU.
  The model is cached in `%APPDATA%/rtst/models`.
- Measured: transcribe ~1.1 s, translate ~0.3-0.5 s, draft ~1.3-1.5 s. The whole GPU uses ~8 GB of 16 GB with both models loaded.
- The draft prompt asks for numbers written as words so the pronunciation line covers them.
- Conversation history is kept in memory only (last 10 turns sent to the drafter).
