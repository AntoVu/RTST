# RTST: Real-Time Spanish Translator

A Windows desktop app for holding a voice call with a Spanish speaker when you don't speak Spanish.

1. Press **Listen** while the other person talks. The app captures your computer's audio output (Zoom, Teams, WhatsApp, a phone app, anything).
2. Their Spanish appears on the left with an English translation underneath.
3. A suggested reply appears on the right: the Spanish to say, a pronunciation guide, and what it means in English. Replies are based on a context file you write about yourself and your business.

Everything runs locally on your PC. There are no API keys, no accounts, and no per-use costs, and no audio or text leaves your machine.

## Requirements

- **Windows 10 or 11**
- **Node.js 20+** ([nodejs.org](https://nodejs.org))
- **Ollama 0.35+** ([ollama.com](https://ollama.com)). Older versions leak the model's reasoning into its answers.
- **A GPU with about 8 GB of free video memory** is recommended. Any DirectX 12 GPU (AMD, NVIDIA, or Intel) works. Without one, speech recognition falls back to the CPU and is slower.
- **About 12 GB of disk space** for the two models.

Tested on an AMD RX 6800 XT (16 GB) with a 12th-gen Intel i5 and 16 GB of RAM, alongside a Zoom call.

## Setup

```sh
# 1. Get the code
git clone <this repo's URL>
cd RTST

# 2. Install dependencies
npm install

# 3. Download the language model (about 9.6 GB, one time)
ollama pull gemma4:e4b
```

The speech recognition model (Whisper, about 1 GB) downloads automatically the first time you start the app.

## Running

1. Make sure the **Ollama** app is running. It usually starts with Windows; look for its icon in the system tray.
2. Start the app:
   ```sh
   npm start
   ```
3. Wait for the status line at the bottom to say **Ready**. The first launch takes longer while Whisper downloads.

## Using it

### Write a context file (do this first)

Copy [context.example.md](context.example.md), fill it in, and choose it under **Settings → Context file**. Include:

- who you are and what your business does
- prices, hours, location, payment methods, policies
- common questions and your answers
- the tone you want (for example, formal "usted")

The model answers from this file and is told never to make up prices, dates, or promises that aren't in it. When the file doesn't cover a question, it gives a polite generic reply (asking to clarify, or saying you'll check), and the reply bubble shows a yellow **generic** badge. The file is re-read on every reply, so you can edit it mid-call.

### Listening

| Action | What happens |
|---|---|
| **Tap** Listen (or tap Space) | Listens until the speaker pauses, then stops automatically |
| **Hold** Listen (or hold Space) | Listens until you let go. Use this when the speaker pauses mid-thought |
| Tap again while listening | Stops right away |

The Space bar only works while the RTST window is focused.

After you stop, Spanish text appears in about a second, the English shortly after, and the suggested reply a second or two later. The status line shows the exact timings.

### Reading the reply

```
Yo cobro quinientos dólares por discurso.             ← say this
yoh KOH-broh kee-NYEHN-tohs DOH-lah-rehs pohr ...     ← how to say it (CAPS = stressed syllable)
I charge five hundred dollars per speech.             ← what it means
```

Numbers in replies are written as words so you can read them aloud.

### Settings

- **Context file**: your notes about yourself and your business (see above).
- **Speech threshold**: how loud audio must be to count as speech. Raise it if background noise keeps listening from stopping on its own.
- **Pause before auto-stop**: how long a silence ends a tap-to-listen. Raise it if the speaker gets cut off mid-sentence.
- **Clear conversation**: starts fresh. The app uses the last 10 exchanges as context for its replies. Nothing is saved to disk.

## Tips

- **Mute other audio.** The app hears everything your PC plays (music, videos, notification sounds), not just the call.
- **Your own voice isn't captured.** Only your speaker output is recorded, not your microphone.
- **Close memory-heavy apps** (games, lots of browser tabs) during calls if your PC has 16 GB of RAM or less.
- **Use headphones if you like.** Capture works the same with headphones or speakers.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Ollama is not running" | Start the Ollama app, then click **Retry** on the message. |
| `model 'gemma4:e4b' not found` | Run `ollama pull gemma4:e4b`. |
| Replies contain reasoning text or odd `<channel\|>` tags | Update Ollama to 0.35 or newer. |
| "No speech heard" | Check that the call audio is actually playing through this PC, or lower the speech threshold. |
| Listening never stops on its own | Background audio is above the threshold. Raise the threshold, mute other audio, or use hold-to-listen. |
| The app window opens and closes immediately, or errors mention `ipcMain` | The `ELECTRON_RUN_AS_NODE` environment variable is set (VS Code sets it for extensions). `npm start` clears it; if you launch Electron another way, unset it first. |
| Transcription is slow | Check the status line. If it says "Speech on CPU", the GPU couldn't be used; update your graphics drivers. |

## How it works

| Step | Tool | Where |
|---|---|---|
| Capture desktop audio | Electron loopback capture (WASAPI) | `renderer.js`, `main.js` |
| Detect the end of speech | Volume-based pause detection | `endpoint.js` |
| Speech to text | Whisper large-v3-turbo via [transformers.js](https://github.com/huggingface/transformers.js), on the GPU with DirectML | `main.js` |
| Translate and draft a reply | `gemma4:e4b` via Ollama; both run in parallel | `prompts.js`, `main.js` |
| Pronunciation guide | Rule-based Spanish-to-English respelling | `pronounce.js` |

To try a different Ollama model, change `MODEL` in [prompts.js](prompts.js) and `ollama pull` it.

## Development

```sh
npm test    # runs the unit tests (pause detection, prompts, pronunciation)
```
