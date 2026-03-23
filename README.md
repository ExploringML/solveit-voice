# SolveIt Voice — Chrome Extension

Voice control for SolveIt dialogs — wake word detection, speech commands, Kokoro TTS, and hands-free operation.

## Features

- **Wake Word Detection** — Say "Solveit" (Google Speech) or "Solvent" (Porcupine AI) to activate
- **Voice Commands** — Speak commands that get sent as prompt/code/note messages
- **Browser TTS** — AI responses read aloud via browser speechSynthesis
- **Kokoro TTS** — Premium voice via Replicate's Kokoro-82M model (optional)
- **Barge-in** — Interrupt TTS by saying the wake word or clicking mic
- **Anchor Selection** — Choose where in the dialog voice commands are inserted
- **Message Type Toggle** — Cycle between prompt (red), code (blue), note (green)
- **Draggable Widget** — Move the voice widget anywhere on screen
- **Tab Management** — Auto-pause when switching tabs (prevents mic conflicts)
- **Audio Bookmarks** — Save/unsave Kokoro audio with ☆/★ toggle

## Installation

1. Open `chrome://extensions/` in Chrome
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `solveit-voice` folder

## Setup

### Required
No setup needed for basic voice control — works with browser's built-in Speech API.

### Optional: Porcupine Wake Word
For AI-powered wake word detection ("Solvent"):
1. Get a free key from [Picovoice Console](https://console.picovoice.ai/)
2. Click the extension icon → enter your **Porcupine Access Key**
3. Toggle 🦔 in the widget's gear menu

### Optional: Kokoro TTS
For premium text-to-speech via Replicate:
1. Get an API key from [Replicate](https://replicate.com/account/api-tokens)
2. Click the extension icon → enter your **Replicate API Key**
3. Toggle 🎵 in the widget's gear menu

## File Structure

```
solveit-voice/
├── manifest.json       # Chrome extension manifest (V3)
├── content.js          # Loader — injects modules into MAIN world
├── content.css         # Widget styles (dark glassmorphism theme)
├── popup.html          # Settings popup (toggle + API keys)
├── popup.js            # Storage management for settings
├── widget.js           # Main widget DOM + SpeechRecognition + beeps
├── state-machine.js    # 5-state machine (idle/listen/command/send/manual)
├── send.js             # HTTP POST to /add_relative_
├── tts.js              # Browser TTS + response watcher
├── kokoro.js           # Kokoro TTS via Replicate API (browser-side)
├── porcupine.js        # Porcupine wake word (bundled model files)
├── save-toggle.js      # Audio bookmark (localStorage)
├── draggable.js        # Drag widget around screen
├── visibility.js       # Pause/resume on tab switch
├── solvent_en_wasm_v4_0_0.ppn  # Porcupine keyword model
└── porcupine_params.pv         # Porcupine engine model
```

## Widget Controls

| Control | Action |
|---------|--------|
| 🎤 Mic button | Manual start/stop (visible in manual mode) |
| ⏹ Stop button | Stop TTS playback |
| ▶ Play button | Play selected prompt's response |
| ☆/★ Bookmark | Save/unsave Kokoro audio |
| 🔴/🔵/🟢 Dot | Cycle message type (prompt/code/note) |
| ⚙️ Gear | Settings dropdown |

## Gear Menu Toggles

| Toggle | Default | Purpose |
|--------|---------|---------|
| Auto-run code | OFF | Auto-execute code messages after send |
| Continuous mode | ON | Always listening for wake word |
| TTS voice prompt | ON | Read voice-triggered responses aloud |
| TTS manual prompt | ON | Read manually-typed responses aloud |
| Select anchor | OFF | One-shot: click message to set insert point |
| 🦔 Porcupine wake | OFF | Use Porcupine AI for wake word detection |
| 🎵 Kokoro TTS | OFF | Use Replicate Kokoro for premium TTS |
