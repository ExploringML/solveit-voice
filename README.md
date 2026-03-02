# SolveIt Voice

Voice control for [SolveIt](https://solveit.fast.ai). Click the mic, speak your
command, and it's sent straight to the AI, no typing required. The AI can also respond
in a natural spoken voice, making it practical for hands-free coding and exploration.

Two modes are available: **manual** (push-to-talk, for quick one-off commands) and
**continuous** (always listening for the wake word "Solveit", great for hands-free
work sessions).

## Features
- **Push-to-talk mode** — click the mic button, speak, done.
- **Wake word activation** — say "Solveit" followed by your command, hands-free.
- **Conversational voice responses** — AI replies are read back aloud via OpenAI TTS,
  ElevenLabs, or the free built-in browser TTS.
- **On-demand playback** — click the play button on any note or AI response to hear it read aloud.
- **Auto-run toggle** — optionally execute generated code immediately.
- **Draggable widget** — unobtrusive overlay, stays out of your way.

## Installation

1. Download or clone this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the extension folder.
5. When you open a SolveIt dialog, the voice widget will appear automatically in the bottom-right corner.
6. Allow microphone access when prompted by the browser.

## Usage

### Continuous Mode

Continuous mode listens in the background for the wake word.

1. The widget shows **"Listening for Solveit..."** when ready
2. Say **"Solveit"** followed by your command — e.g. *"Solveit, plot a sine wave"*
3. A beep confirms the wake word was detected
4. After ~1.5 seconds of silence, your command is sent automatically
5. A second beep confirms dispatch

You don't need to pause between "Solveit" and your command — just speak naturally.

### Manual Mode (Default)

Toggle **Continuous mode** off in the settings gear to switch to push-to-talk.

1. Click the **mic button** (🎤) to start recording
2. Speak your command
3. Click **stop** (⏹) when done — the command is sent automatically

### Tools

For the auto-run code feature to work, you'll need to add a note message at the top of your dialog with `` &`run_msg` `` to allow SolveIt to automatically run messages on your behalf.

## Settings

Click the **gear icon** (⚙️) on the widget to access settings.

| Setting               | Default | Description                                         |
| --------------------- | ------- | --------------------------------------------------- |
| **Auto-run code**     | Off     | AI-generated code executes immediately when enabled |
| **Continuous mode**   | On      | Listens for wake word; disable for push-to-talk     |
| **TTS voice prompt**  | On      | Read AI responses to voice commands aloud           |
| **TTS manual prompt** | On      | Read AI responses to typed prompts aloud            |

### TTS Providers

Choose a provider from the **Provider** dropdown:

| Provider           | Setup                         | Notes                                                                |
| ------------------ | ----------------------------- | -------------------------------------------------------------------- |
| **Browser TTS**    | None — works out of the box   | Free, adjustable speed and pitch, voice quality varies by OS         |
| **OpenAI TTS**     | Enter your API key (`sk-...`) | High quality, multiple voices and models including `gpt-4o-mini-tts` |
| **ElevenLabs TTS** | Enter your API key (`sk_...`) | Natural-sounding, uses the George voice                              |

API keys are stored locally in your browser via `chrome.storage` and are never sent to SolveIt.

### On-Demand Playback

Every note and AI response has a **play button** (▶) in its toolbar. Click it to
hear that message read aloud using your selected TTS provider. Click again to
pause, or double-click to stop.

## Troubleshooting

**Widget not appearing?**
Make sure you're on a SolveIt dialog page. The extension only activates when it detects a dialog container in the DOM.

**Microphone not working?**
Check your browser's site permissions (lock icon in the address bar) and ensure the microphone is allowed. Chrome only permits **one** `SpeechRecognition` instance globally — close any other tabs or extensions using speech recognition.

**Wake word not triggering?**
Speak clearly and say "Solveit" as one word. The recogniser also accepts near-matches like "solve it". In noisy environments, switch to manual mode.

**TTS not playing?**
For OpenAI or ElevenLabs, check that your API key is entered correctly — the key input will flash red on auth errors. For browser TTS, try a different voice or check that your system volume is up.

**Command cutting off too early?**
The silence timeout is 1.5 seconds. Avoid long pauses mid-sentence. If you need more thinking time, use manual mode instead.

## Contributing

Contributions are welcome! If you find a bug or have a feature idea, please
[open an issue](../../issues). Pull requests are also appreciated — for larger
changes, consider opening an issue first to discuss the approach.

### Project Structure

```
├── manifest.json   # Extension config: permissions, content scripts, web-accessible resources
├── content.js      # Detects SolveIt pages, injects voice.js into the page context
├── ui.js           # Widget DOM, CSS, settings panel, drag logic, audio helpers
└── voice.js        # Core logic: speech recognition, state machine, wake word, TTS, WS listener
```

### How It Works

The content script detects SolveIt dialog pages and injects `voice.js` as a
`<script>` tag into the page's main world. This is necessary because Chrome's
`SpeechRecognition` API is only available in the page context, not in content
scripts or extension service workers.

Voice commands are sent to SolveIt by POSTing to `/add_relative_` — the same
internal endpoint the app uses. The browser's session cookie handles
authentication automatically.

AI responses are detected by listening for `htmx:wsAfterMessage` events on the
page's existing WebSocket connection. When a response stabilises, it's extracted
from the DOM and passed to the selected TTS provider.

### Loading for Development

1. Make your changes.
2. Go to `chrome://extensions` and click the reload button on the extension card.
3. Refresh the SolveIt tab.

### Limitations

- `SpeechRecognition` is Chrome-only (uses the Web Speech API).
- Chrome allows only one speech recognition instance globally — other tabs or extensions using it will cause silent failures.
- Wake word detection uses simple regex matching on the transcript, not a dedicated hotword model.