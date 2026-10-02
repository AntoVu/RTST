# RTST: Real-Time Spanish Translator

Electron app (Windows) that helps a Spanish learner through live voice conversations (currently tutor practice meetings on Zoom).
It captures desktop audio, transcribes it with local Whisper, and uses a local Ollama model to translate it and draft a simple Spanish reply
(plus a pronunciation guide and English meaning) from a user-written context file, the whole meeting so far, and memory from past meetings.
A sidebar offers quick phrases and AI suggestions. Everything runs locally and costs nothing.
Original design spec (Claude-based, since replaced by Ollama; local only, `docs/` is gitignored): [docs/specs/2026-09-30-rtst-design.md](docs/specs/2026-09-30-rtst-design.md).

## Run / test
- Requires the Ollama app running (0.35+; 0.20.x ignored `think:false` for Gemma 4) with `gemma4:e4b` pulled.
- `npm start` launches the app. `npm test` runs `node --test` (endpointer, button state machine, prompt builders, pronunciation).
- Keep real names and personal details out of tracked files (tests, README examples): the repo is public. The user's context file is `context.*` (gitignored).
- VS Code / Claude Code set `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node (`ipcMain` undefined).
  `npm start` clears it; when launching manually, use `env -u ELECTRON_RUN_AS_NODE npx electron .`.
- Launch with `--remote-debugging-port=9229` to drive the renderer via CDP (`press()` / `release()`, or `addTurn('texto', performance.now())` to skip audio).

## Layout
- `main.js`: window, loopback-audio grant (`setDisplayMediaRequestHandler` with `audio: 'loopback'`), Whisper, Ollama calls (`/api/chat`), settings in `%APPDATA%/rtst/settings.json`.
- `prompts.js`: pure Ollama request builders (translate, draft, suggest, summary). One model (`gemma4:e4b`) serves all of them; JSON answers use zod schemas via Ollama `format`.
  `NUM_CTX` must be identical on every request, or Ollama reloads the model.
- `pronounce.js`: rule-based Spanish-to-English respelling with stress. The small LLM was unreliable at this, so the model doesn't produce pronunciation.
- `endpoint.js`: pause detection (`createEndpointer`) and the Listen button state machine (`createListenButton`: tap = auto, hold = until release, double-tap = locked). Shared by the renderer (plain script) and tests.
- `renderer.js`: audio capture (16 kHz AudioContext + ScriptProcessor), button wiring (pointer capture so a hold survives leaving the button), chat, sidebar, End meeting.
  `history` is a flat `[{ who: 'them'|'me', es, en }]` list; a draft adds a `me` placeholder with `es: null` to keep order.
- `pronounce.js` is also loaded in the renderer as a plain script, so avoid reusing its top-level names in `renderer.js`.
- Memory: `%APPDATA%/rtst/memory.md` (the last 6000 chars go in the system prompt after the context); transcripts in `%APPDATA%/rtst/meetings/<id>.md`, rewritten after every message.

## Decisions
- TransWord.ai has no public API. Claude was used first, then swapped to local Ollama so it's free.
- Whisper: `onnx-community/whisper-large-v3-turbo` via transformers.js with `device: 'dml'` (DirectML on the AMD RX 6800 XT), falling back to CPU.
  The model is cached in `%APPDATA%/rtst/models`.
- Measured: transcribe ~1.1 s, translate ~0.3-0.5 s, draft ~1.3-1.5 s. The whole GPU uses ~8 GB of 16 GB with both models loaded.
- The draft prompt asks for numbers written as words so the pronunciation line covers them.
- The drafter gets the whole meeting (capped at 200 messages). Prompt order is kept stable (instructions, context, memory, transcript, newest) so Ollama's
  prefix cache keeps replies ~1.3-2.3 s even late in a 60-message meeting. Startup sends a 1-token draft to pre-process the context and memory (first reply ~1.7 s instead of ~3.5 s).
- Whisper uses `chunk_length_s: 30`; without it, audio past 30 s was silently dropped.
- Bash/Write tool input un-escapes `\u` and `\d` sequences: write regexes with backslashes through the Edit tool.
