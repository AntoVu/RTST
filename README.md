# RTST: Real-Time Spanish Translator

A Windows desktop app for holding a Spanish voice conversation (a tutor session, a customer call, a meeting) when your Spanish isn't strong yet.

1. Press **Listen** while the other person talks. The app captures your computer's audio output (Zoom, Teams, WhatsApp, a phone app, anything).
2. Their Spanish appears on the left with an English translation underneath.
3. A suggested reply appears on the right: the Spanish to say, a pronunciation guide, and what it means in English. Replies are based on a context file you write about yourself and the situation, and on everything said so far.
4. A sidebar offers quick phrases and AI-suggested questions you can click to say next.
5. When the meeting ends, the app saves a transcript and a summary, which it remembers in future meetings.

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

Copy [context.example.md](context.example.md) to `context.md`, fill it in, and choose it under **Settings → Context file**. Include:

- the situation (for example, "a Spanish practice session with a tutor on Zoom")
- who you are: name, where you're from, school or work, family, hobbies
- your goals for the conversation and topics or questions you want to cover
- anything you know about the other person
- the tone you want (for example, polite "usted")

The model answers from this file and is told never to make up facts about you. When the file doesn't cover a question, it improvises, and the small local model can't reliably tell when it has (it may say your favorite color is blue). **Read the English line before you speak**, and add any missing facts to your context file. Short bullet points work best: one fact per line, no duplicates. The file is re-read on every reply, so you can edit it mid-call.

Files named `context.*` (except the example) are ignored by git, so your personal details aren't committed by accident.

### Listening

| Action | What happens |
|---|---|
| **Tap** Listen (or tap Space) | Listens until the speaker pauses, then stops automatically |
| **Hold** Listen (or hold Space) | Listens until you let go, however long. Sliding the mouse off the button doesn't stop it |
| **Double-tap** Listen (or Space) | **Locked**: listens through any pause until you tap once more. Best for long, unpredictable turns |
| Tap again while listening | Stops right away |
| **Auto-listen** checkbox (next to Listen) | Listening starts by itself whenever audio plays louder than the speech threshold, then stops at a pause, like a tap. It keeps listening while the previous turn is transcribed, so nothing is missed |

The Space bar only works while the RTST window is focused. Long recordings (several minutes) are transcribed in full.

With Auto-listen on, mute other sounds on your PC (anything louder than the threshold starts listening). If the speaker gets split into several messages, raise **Pause before auto-stop** in Settings (2 seconds works well for slow speakers). Short remarks with no question in them ("Sí.", "Bueno.") are translated but get no suggested reply, since the speaker is usually still talking.

After you stop, Spanish text appears in about a second, the English shortly after, and the suggested reply a second or two later. The status line shows the exact timings.

### Live preview

While they're still talking, a faded bubble shows what the app has heard so far, with a rough English translation, updated about every 1.5 seconds. When they stop, the real message replaces it. Previews never delay the final transcription: if Whisper is busy, the preview is skipped. Turn it off under **Settings → Live preview** if your GPU struggles.

### Reading the reply

```
Te llamas María, eres de Colombia y tienes dos hermanas.             ← say this
teh YAH-mahs mah-REE-ah, EH-rehs deh koh-LOHM-byah ee TYEH-nehs ...  ← how to say it (CAPS = stressed syllable)
Your name is María, you're from Colombia, and you have two sisters.  ← what it means
```

Replies use simple, student-level Spanish, and numbers are written as words so you can read them aloud.

Don't like a suggested reply? Click **↻** in its corner for a different one. The app remembers the replies you skipped, so it won't offer them again.

### Say something of your own

Type what you want to say in English in the box above the Listen button and press Enter. It appears as your message in simple Spanish, with pronunciation, using the conversation so far to choose words and tú/usted.

### Check my speech

Tick **Check my speech** to have the app listen to your microphone. When you read a reply aloud, it transcribes you and compares what you said with your newest unsaid replies. If it's close enough (60% by default, so a few mispronounced or missing words are fine), the reply turns a brighter green and gets a ✓ with what it heard. If not, it shows what it heard and the match percentage, with a **Count it as said** button.

- The mic is ignored while the other person is being recorded, and only listens while there's a reply waiting to be said.
- Use headphones if you can: on speakers, the mic also hears the call.
- Change the mic sensitivity and how close counts under **Settings**.

### The sidebar: things to say

- **Suggestions**: click **Suggest** for 5 questions or comments that fit your context and the conversation so far (about 4 seconds).
- **From your context**: your own prepared questions, for example ones an assignment requires. Add a `# Sidebar questions` section to your context file; each `##` subheading becomes a collapsible group:
  ```markdown
  # Sidebar questions
  ## Their family
  - ¿Cómo es tu familia? | What is your family like?
  - ¿Tienes hermanos? | Do you have siblings?
  ```
  The section is re-read whenever you switch back to the app, so you can edit it mid-meeting.
- **Quick phrases**: always-available basics like "¿Puede repetirlo, por favor?" and "¿Puede hablar más despacio?"

Clicking any of them adds it to the chat as your message, with pronunciation, so you can read it aloud.

### Memory

- **During a meeting**, everything said so far is part of every reply. If someone introduces themselves at the start, the app still knows their name an hour later.
- **End meeting** (top right) saves the meeting: a summary of names, details, and topics is added to `memory.md`, and the full transcript (Spanish with English) is saved in `meetings/`. Future meetings use `memory.md`, so the app remembers people and past topics.
- Transcripts are saved after every message, so closing the app without clicking End meeting only skips the summary.
- **Settings → Open folder** opens `%APPDATA%\rtst`, where `memory.md` and `meetings/` live. `memory.md` is plain markdown: edit or delete lines whenever you like.

None of this slows replies down. Ollama reuses the processing for the unchanged start of each request, so a reply in a long meeting takes about as long as the first one (about 1.5 s on the tested PC).

### Settings

- **Context file**: your notes about yourself and the situation (see above).
- **Speech threshold**: how loud audio must be to count as speech. Raise it if background noise keeps listening from stopping on its own.
- **Pause before auto-stop**: how long a silence ends a tap-to-listen. Raise it if the speaker gets cut off mid-sentence.
- **Memory and meeting transcripts → Open folder**: see Memory, above.
- **Clear without saving notes**: starts fresh without adding a summary to memory. The transcript stays in `meetings/`.

## Tips

- **Mute other audio.** The app hears everything your PC plays (music, videos, notification sounds), not just the call.
- **Your own voice isn't translated.** The conversation comes from your speaker output. Your microphone is only used by **Check my speech**, and only to tick off your replies.
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
| A reply or memory note has a wrong fact about you | Add the right fact to your context file, and fix or delete the line in `memory.md`. |
| The app window opens and closes immediately, or errors mention `ipcMain` | The `ELECTRON_RUN_AS_NODE` environment variable is set (VS Code sets it for extensions). `npm start` clears it; if you launch Electron another way, unset it first. |
| Transcription is slow | Check the status line. If it says "Speech on CPU", the GPU couldn't be used; update your graphics drivers. |

## How it works

| Step | Tool | Where |
|---|---|---|
| Capture desktop audio | Electron loopback capture (WASAPI) | `renderer.js`, `main.js` |
| Detect the end of speech | Volume-based pause detection | `endpoint.js` |
| Speech to text | Whisper large-v3-turbo via [transformers.js](https://github.com/huggingface/transformers.js), on the GPU with DirectML | `main.js` |
| Translate and draft a reply | `gemma4:e4b` via Ollama; both run in parallel | `prompts.js`, `main.js` |
| Suggestions and meeting summaries | The same model | `prompts.js`, `main.js` |
| Pronunciation guide | Rule-based Spanish-to-English respelling | `pronounce.js` |
| Tap, hold, and double-tap logic | A small state machine | `endpoint.js` |

To try a different Ollama model, change `MODEL` in [prompts.js](prompts.js) and `ollama pull` it.

## Development

```sh
npm test    # runs the unit tests (pause detection, button logic, prompts, pronunciation)
```
