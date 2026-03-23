// ═══════════════════════════════════════════════════════════════════════
// SolveIt Voice — Main Widget (widget.js)
//
// DESIGN: Creates the voice widget DOM, SpeechRecognition engine,
// beep sounds, silence timer, wake word detection, and the shared
// V = window._voice bridge that all other modules attach to.
//
// This is the foundation — loaded FIRST by content.js.
// All other modules (state-machine, send, tts, kokoro, porcupine,
// draggable, visibility) read from and write to window._voice.
//
// INIT GUARD: window.__voiceWidgetInit prevents duplicate initialization
// if content.js re-runs (e.g. on SPA navigation within SolveIt).
// ═══════════════════════════════════════════════════════════════════════

if (!window.__voiceWidgetInit) {
window.__voiceWidgetInit = true;

(function() {
// --- Cleanup previous instance ---
if (window._voiceCleanup) window._voiceCleanup();
document.getElementById('voice-widget')?.remove();

// --- AbortController for document-level listeners ---
// DESIGN: All document-level listeners use this controller.
// ac.abort() removes them all at once during cleanup.
const ac = new AbortController();
const sig = { signal: ac.signal };

// --- Constants ---
// getDname() reads the current dialog name from the page at call-time.
// DESIGN: Dynamic getter — if dialog name changes mid-session, this
// always returns the current name (unlike a hardcoded value).
const getDname = () => document.documentElement.dataset.solveitDname || '';
const DEBUG = true;
const log = (...args) => { if (DEBUG) console.log('[Voice]', ...args); };
const CFG = {
    silenceMs: 8000,       // ms of silence before sending command
    watchdogMs: 2000,      // ms between watchdog checks
    restartMs: 300,        // default restart delay
    retryMs: 1000,         // retry delay on start failure
    postSendMs: 1500,      // restart delay after sending transcript
    beepFreq: 880,         // wake beep frequency
    beepDur: 200,          // wake beep duration ms
    confirmFreq: 660,      // send confirmation beep frequency
    confirmDur: 150,       // send confirmation beep duration ms
    ttsRate: 1.0,          // TTS speech rate
    ttsVoice: 'Google UK English Male',
};
// CLR — Color palette for status bar states
const CLR = { ok: '#6bff6b', info: '#6bc5ff', warn: '#ffd93d', err: '#ff6b6b', muted: '#aaa' };
const MSG = {
    idle: 'Click mic to start',
    wake: '👂 Listening for "Solveit"...',
    listening: '🟢 Listening...',
    command: '🟢 Speak your command...',
    noSpeech: 'No speech detected',
    micDenied: '❌ Mic permission denied',
    noApi: '❌ Speech API not supported',
};

// --- DOM helper ---
function el(tag, cls, props) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (props) Object.assign(e, props);
    return e;
}

// --- Widget Container ---
const div = el('div', null, { id: 'voice-widget' });
const btn = el('button', 'v-mic', { textContent: '🎤' });
btn.style.display = 'none';
const status = el('span', 'v-status');

function setStatus(text, color = CLR.muted) { status.textContent = text; status.style.color = color; }
setStatus(MSG.idle);

const ttsStopBtn = el('button', 'v-tts-stop', { textContent: '⏹', title: 'Stop speech' });
ttsStopBtn.style.display = 'none';

// --- Hidden checkbox state holders (lightweight state objects) ---
// DESIGN: Each toggle in the gear dropdown uses { checked: bool } objects
// instead of real HTML checkboxes. makeSwitch() reads/writes .checked
// and calls .onchange() when the user clicks the toggle.
const autoCb = { checked: false };       // Auto-run OFF by default
const toggleCb = { checked: false };     // Continuous OFF by default
const ttsCb = { checked: false };        // TTS voice OFF by default
const ttsManualCb = { checked: false };  // TTS manual OFF by default
const anchorCb = { checked: false };     // Select anchor OFF by default
const porcupineCb = { checked: false };  // Porcupine wake word OFF by default
let anchorId = null;

// --- Send Mode (replaces message type toggle) ---
// DESIGN: Three send modes — prompt_run sends + auto-runs,
// prompt sends without running, note creates a note message.
const SEND_MODES = [
    { mode: 'prompt_run', color: '#e74c3c', label: 'Send to Prompt & Run', icon: '▶' },
    { mode: 'prompt',     color: '#f39c12', label: 'Send to Prompt',       icon: '📝' },
    { mode: 'note',       color: '#2ecc71', label: 'Send to Note',         icon: '📋' }
];
let sendMode = 'prompt_run';
let promptText = '';

// --- Preset Prompts ---
// DESIGN: Quick-access prompts for common actions. User can select
// a preset, then click send — two clicks for repetitive tasks.
// DESIGN: Categorized presets — object with category keys, each holding an array of {name, text}.
// Two-level menu: category buttons on right, preset items expand left.
// Migration: if localStorage has old flat array, auto-wrap in {"uncategorized": [...]}.
const DEFAULT_PRESETS = {
    organize: [
        { name: 'Build Section TOC', text: 'Build a ## 📑 Section TOC note for the current H1 section. Use your memory — do NOT use tool calls to read messages. For each prompt, summarize the core idea from its OUTPUT (the output is what matters most) and use that as the link description. Format as numbered list: 1. <a href=\"#_id\">summary of prompt output essential idea</a>. Each item links to one prompt. Place the TOC note right after the H1 heading.' },
        { name: 'Update Section TOC', text: 'Update the existing ## 📑 Section TOC for this section. Use your memory — no tool calls to read messages. Only add entries for new important prompts whose outputs have substantial content. Summarize the core idea from each output as the link description. Keep existing entries intact.' },
        { name: 'Download Extension', text: 'Run download_folder for the Chrome extension folder in the current directory so I can test it locally.' },
        { name: 'Push Repo to GitHub', text: 'First call curr_dialog() to get the exact dialog path. Then push the cloned repo using push_repo_to_github(), and backup the instance with backup_to_github() using the correct dialog path in the commit message.' },
        { name: 'Backup to GitHub', text: 'First call curr_dialog() to get the exact dialog path. Then run backup_to_github() with a descriptive commit message that includes the correct dialog path.' }
    ],
    build: [
        { name: 'plan this feature', text: 'apply "plan this feature" the first trigger, help me understand the design comprehensively' },
        { name: 'test this step', text: 'So, have we finished this step? if so, How should I test the modifications or the step completed to make sure everything work as expected' },
        { name: 'explain the issue & fix', text: 'explain the issue/bug comprehensively using rewrite4kid style without losing any details and then explain how the fix solve the problem accordingly' }
    ],
    read: [
        { name: 'walk me through', text: 'use function call to figure out where is the current section, and then apply "walk me through this" trigger to explain the issues, bugs and related learning points and solutions in this current section' },
        { name: 'sketch concepts', text: 'please apply "sketch this concept" on issues, bugs and their related solutions and learning points in this section' }
    ],
    watch: []
};
// DESIGN: presets is the live categorized object. activeCategory tracks which tab is selected.
// lastSelectedPreset stores {cat, idx} so preset editor knows which preset to update.
let presets = JSON.parse(JSON.stringify(DEFAULT_PRESETS));
let activeCategory = Object.keys(DEFAULT_PRESETS)[0];
let lastSelectedPreset = { cat: null, idx: -1 };

// DESIGN: Persist presets and anchor via localStorage.
// localStorage is available in MAIN world — no bridge needed.
// Follows context_token_counter pattern: key by dialog name.
const PRESETS_KEY = 'voice_presets';
const ANCHOR_KEY = 'voice_anchor_' + _edVar('dlg_name');
const GIST_TOKEN_KEY = 'voice_gist_token';
const GIST_ID_KEY = 'voice_gist_id';

// DESIGN: savePresets writes to BOTH localStorage AND presets.json via solveit kernel.
// Auto-save on every change — no manual button needed (manual still available as backup).
// DESIGN: savePresets writes categorized object to localStorage.
// Log total preset count across all categories for quick verification.
function savePresets() {
    try {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
        const total = Object.values(presets).reduce((sum, arr) => sum + arr.length, 0);
        log('Presets saved to localStorage:', total, 'across', Object.keys(presets).length, 'categories');
    }
    catch(e) { log('Save presets localStorage error:', e); }
    // DESIGN: Also persist to JSON file via solveit kernel code cell.
    // Sends a code message that writes presets.json — permanent backup survives browser data clear.
    savePresetsToFile();
}
function savePresetsToFile() {
    const json = JSON.stringify(presets, null, 2);
    const total = Object.values(presets).reduce((sum, arr) => sum + arr.length, 0);
    const code = `from pathlib import Path\nPath('./solveit-voice/presets.json').write_text('''${json.replace(/\\/g, '\\\\').replace(/'''/g, "\\'\\'\\'")}''')\nprint('💾 Presets saved to presets.json:', ${total}, 'presets across', ${Object.keys(presets).length}, 'categories')`;
    const body = new URLSearchParams({
        dlg_name: V.getDname(),
        content: code,
        msg_type: 'code',
        run: 'true',
        placement: 'at_end'
    });
    fetch('/add_relative_', { method: 'POST', body })
        .then(r => { if (r.ok) { setStatus('💾 Saved to file + localStorage', CLR.ok); log('Presets saved to file:', total, 'presets'); } else { setStatus('⚠️ File save failed: ' + r.status, CLR.warn); } })
        .catch(e => { log('Save to file error:', e); setStatus('⚠️ File save failed', CLR.warn); });
}
// DESIGN: Load presets from localStorage with migration.
// Old format was flat array [{name,text},...] — auto-wrap in {uncategorized: [...]}.
// New format is categorized object {category: [{name,text},...], ...}.
function loadPresets() {
    try {
        const saved = localStorage.getItem(PRESETS_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            // MIGRATION: detect old flat array format → wrap in uncategorized
            if (Array.isArray(parsed)) {
                log('Migration: converting flat array to categorized object,', parsed.length, 'presets → uncategorized');
                presets = { uncategorized: parsed };
                savePresets(); // persist migrated format immediately
            } else {
                presets = parsed;
            }
            const total = Object.values(presets).reduce((sum, arr) => sum + arr.length, 0);
            log('Presets loaded from localStorage:', total, 'across', Object.keys(presets).length, 'categories');
            activeCategory = Object.keys(presets)[0] || 'organize';
            buildPresetMenu();
        }
    } catch(e) { log('Load presets error:', e); }
}
// DESIGN: Load presets from JSON file via solveit kernel.
// Sends a code cell that reads presets.json and injects data via add_scr (not add_html).
// LESSON: add_html with <script> tags doesn't execute — browsers block innerHTML scripts.
// add_scr properly creates and executes a <script> element.
// Widget polls for window._voiceLoadedPresets, grabs data, updates presets, cleans up.
function loadPresetsFromFile() {
    setStatus('📂 Loading from file...', CLR.warn);
    log('loadPresetsFromFile: starting...');
    const code = `from pathlib import Path\np = Path('./solveit-voice/presets.json')\nif p.exists():\n    add_scr('window._voiceLoadedPresets = ' + p.read_text())\n    print('📂 Presets file read:', len(__import__('json').loads(p.read_text())), 'presets')\nelse:\n    add_scr('window._voiceLoadedPresets = "NOT_FOUND"')\n    print('⚠️ presets.json not found')`;
    const body = new URLSearchParams({
        dlg_name: V.getDname(),
        content: code,
        msg_type: 'code',
        run: 'true',
        placement: 'at_end'
    });
    fetch('/add_relative_', { method: 'POST', body })
        .then(r => {
            log('loadPresetsFromFile: fetch response status:', r.status);
            if (!r.ok) { setStatus('⚠️ Load failed: ' + r.status, CLR.warn); return; }
            // DESIGN: Poll for injected data — kernel runs code, add_scr executes JS.
            // Polls every 500ms for up to 15s, then gives up.
            let attempts = 0;
            const poll = setInterval(() => {
                attempts++;
                log('loadPresetsFromFile: poll attempt', attempts, 'window._voiceLoadedPresets:', typeof window._voiceLoadedPresets);
                if (window._voiceLoadedPresets !== undefined) {
                    clearInterval(poll);
                    if (window._voiceLoadedPresets === 'NOT_FOUND') {
                        setStatus('⚠️ presets.json not found — save first', CLR.warn);
                    } else {
                        try {
                            const loaded = window._voiceLoadedPresets;
                            log('loadPresetsFromFile: got data, type:', typeof loaded, 'isArray:', Array.isArray(loaded));
                            // MIGRATION: accept both old flat array and new categorized object
                            if (Array.isArray(loaded)) {
                                log('loadPresetsFromFile: migrating flat array →', loaded.length, 'presets → uncategorized');
                                presets = { uncategorized: loaded };
                            } else if (loaded && typeof loaded === 'object') {
                                presets = loaded;
                            } else { setStatus('⚠️ Invalid presets data', CLR.warn); return; }
                            localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
                            activeCategory = Object.keys(presets)[0] || 'organize';
                            buildPresetMenu();
                            const total = Object.values(presets).reduce((sum, arr) => sum + arr.length, 0);
                            setStatus('📂 Loaded ' + total + ' presets from file', CLR.ok);
                            log('Presets loaded from file:', total, 'across', Object.keys(presets).length, 'categories');
                        } catch(err) { setStatus('⚠️ Parse error: ' + err.message, CLR.warn); log('Load parse error:', err); }
                    }
                    delete window._voiceLoadedPresets;
                }
                if (attempts > 30) { clearInterval(poll); setStatus('⚠️ Load timed out', CLR.warn); log('loadPresetsFromFile: timed out after 30 polls'); }
            }, 500);
        })
        .catch(e => { log('Load from file error:', e); setStatus('⚠️ Load failed', CLR.warn); });
}
// --- Gist sync ---
// DESIGN: Presets sync to a GitHub Gist for cross-machine persistence.
// Token stored in localStorage (user enters once). Gist ID stored after first create.
// Routes through background.js to avoid CORS.
// DESIGN: MAIN world can't call chrome.runtime.sendMessage() directly.
// Same postMessage bridge as kokoro.js uses for Replicate API.
// Flow: widget.js → postMessage → content.js → chrome.runtime.sendMessage → background.js
let _gistReqCounter = 0;
function gistFetch(url, method, token, body) {
    return new Promise((resolve, reject) => {
        const requestId = 'gf-' + (++_gistReqCounter) + '-' + Date.now();
        function handler(e) {
            if (e.source !== window || e.data?.type !== 'gist-fetch-response') return;
            if (e.data.requestId !== requestId) return;
            window.removeEventListener('message', handler);
            resolve({ ok: e.data.ok, status: e.data.status, data: e.data.data });
        }
        window.addEventListener('message', handler);
        window.postMessage({
            type: 'gist-fetch', requestId, url, method,
            headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' },
            body: body ? JSON.stringify(body) : undefined
        }, '*');
        setTimeout(() => { window.removeEventListener('message', handler); reject(new Error('Gist fetch timeout')); }, 30000);
    });
}

async function savePresetsToGist() {
    const token = localStorage.getItem(GIST_TOKEN_KEY);
    if (!token) { setStatus('⚠️ Set GitHub token first (gear menu)', CLR.warn); return; }
    setStatus('☁️ Saving to Gist...', CLR.info);
    log('savePresetsToGist: starting...');
    const files = { 'solveit-voice-presets.json': { content: JSON.stringify(presets, null, 2) } };
    try {
        let gistId = localStorage.getItem(GIST_ID_KEY);
        let resp;
        if (gistId) {
            resp = await gistFetch('https://api.github.com/gists/' + gistId, 'PATCH', token, { files });
        } else {
            resp = await gistFetch('https://api.github.com/gists', 'POST', token, { description: 'SolveIt Voice presets', public: false, files });
        }
        if (resp.ok) {
            if (!gistId && resp.data?.id) { localStorage.setItem(GIST_ID_KEY, resp.data.id); log('Gist created:', resp.data.id); }
            const total = Object.values(presets).reduce((sum, arr) => sum + arr.length, 0);
            setStatus('☁️ Saved to Gist (' + total + ' presets)', CLR.ok);
            log('Presets saved to gist:', total, 'across', Object.keys(presets).length, 'categories');
        } else {
            setStatus('⚠️ Gist save failed: ' + (resp.data?.message || resp.status), CLR.warn);
            log('Gist save error:', resp);
        }
    } catch (e) { setStatus('⚠️ Gist save failed', CLR.warn); log('Gist save error:', e); }
}

async function loadPresetsFromGist() {
    const token = localStorage.getItem(GIST_TOKEN_KEY);
    if (!token) { setStatus('⚠️ Set GitHub token first (gear menu)', CLR.warn); return; }
    const gistId = localStorage.getItem(GIST_ID_KEY);
    if (!gistId) { setStatus('⚠️ No Gist ID — save to Gist first', CLR.warn); return; }
    setStatus('☁️ Loading from Gist...', CLR.info);
    log('loadPresetsFromGist: starting...');
    try {
        const resp = await gistFetch('https://api.github.com/gists/' + gistId, 'GET', token);
        if (resp.ok) {
            const content = resp.data?.files?.['solveit-voice-presets.json']?.content;
            if (!content) { setStatus('⚠️ Gist file not found', CLR.warn); return; }
            const loaded = JSON.parse(content);
            // MIGRATION: accept both old flat array and new categorized object from Gist
            if (Array.isArray(loaded)) { presets = { uncategorized: loaded }; }
            else if (loaded && typeof loaded === 'object') { presets = loaded; }
            else { setStatus('⚠️ Invalid Gist data', CLR.warn); return; }
            localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
            activeCategory = Object.keys(presets)[0] || 'organize';
            buildPresetMenu();
            const total = Object.values(presets).reduce((sum, arr) => sum + arr.length, 0);
            setStatus('☁️ Loaded ' + total + ' presets from Gist', CLR.ok);
            log('Presets loaded from gist:', total, 'across', Object.keys(presets).length, 'categories');
        } else {
            setStatus('⚠️ Gist load failed: ' + (resp.data?.message || resp.status), CLR.warn);
            log('Gist load error:', resp);
        }
    } catch (e) { setStatus('⚠️ Gist load failed', CLR.warn); log('Gist load error:', e); }
}

function saveAnchor() {
    try { localStorage.setItem(ANCHOR_KEY, anchorId || ''); log('Anchor saved:', anchorId); }
    catch(e) { log('Save anchor error:', e); }
}
function loadAnchor() {
    try {
        const saved = localStorage.getItem(ANCHOR_KEY);
        if (saved) {
            anchorId = saved;
            anchorLabel.textContent = '📌 ' + anchorId;
            log('Anchor loaded from localStorage:', anchorId);
        }
    } catch(e) { log('Load anchor error:', e); }
}

// --- Expose shared state under single namespace ---
const V = window._voice = { ttsStopBtn, ttsCb, ttsManualCb, toggleCb, speaking: false, log, CFG, CLR };
V.ttsEnd = () => {
    if (V._ttsSafety) { clearTimeout(V._ttsSafety); V._ttsSafety = null; }
    speechSynthesis.cancel();
    V.speaking = false;
    ttsStopBtn.style.display = 'none';
    if (toggleCb.checked && !wakeDetected) safeStartRec(CFG.restartMs);
};
ttsStopBtn.onclick = V.ttsEnd;

// --- Toggle switch helper ---
function makeSwitch(label, stateObj) {
    const row = el('div', 'v-switch-row');
    const txt = el('span', null, { textContent: label });
    const track = el('span', 'v-track');
    const thumb = el('span', 'v-thumb');

    function render() {
        if (stateObj.checked) {
            track.style.background = '#6bff6b';
            thumb.style.right = '1px'; thumb.style.left = 'auto'; thumb.style.background = '#fff';
        } else {
            track.style.background = '#555';
            thumb.style.left = '1px'; thumb.style.right = 'auto'; thumb.style.background = '#888';
        }
    }
    render();
    track.appendChild(thumb);
    row.appendChild(txt);
    row.appendChild(track);
    row.onclick = () => { stateObj.checked = !stateObj.checked; render(); if (stateObj.onchange) stateObj.onchange(); };
    return { row, render };
}

// --- Gear Button & Dropdown ---
function setGearStyle(open) {
    gearBtn.style.background = open ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)';
    gearBtn.style.color = open ? '#fff' : '#aaa';
}
const gearBtn = el('button', 'v-gear', { textContent: '⚙️', title: 'Settings' });
gearBtn.onmouseenter = () => setGearStyle(true);
gearBtn.onmouseleave = () => { if (!ddOpen) setGearStyle(false); };
const dropdown = el('div', 'v-dropdown');
dropdown.id = 'voice-gear-dropdown';

const autoSwitch = makeSwitch('Auto-run code', autoCb);
const contSwitch = makeSwitch('Continuous mode', toggleCb);
const ttsSwitch = makeSwitch('TTS voice prompt', ttsCb);
const ttsManualSwitch = makeSwitch('TTS manual prompt', ttsManualCb);
const anchorSwitch = makeSwitch('Select anchor', anchorCb);
const anchorLabel = el('div', 'v-anchor-label');
anchorLabel.textContent = '📌 (none — using end)';
const porcupineSwitch = makeSwitch('🦔 Porcupine wake', porcupineCb);

dropdown.appendChild(autoSwitch.row);
dropdown.appendChild(contSwitch.row);
dropdown.appendChild(ttsSwitch.row);
dropdown.appendChild(ttsManualSwitch.row);
dropdown.appendChild(anchorSwitch.row);
dropdown.appendChild(anchorLabel);
dropdown.appendChild(porcupineSwitch.row);

// --- GitHub token input for Gist sync ---
// DESIGN: User pastes their GitHub token once. Stored in localStorage.
// Shown as password field so the token isn't visible on screen.
const tokenRow = el('div', 'v-switch-row');
tokenRow.style.cssText = 'padding:4px 12px;display:flex;align-items:center;gap:6px;border-top:1px solid rgba(255,255,255,0.1)';
const tokenLabel = el('span', null, { textContent: '🔑 Gist token' });
tokenLabel.style.cssText = 'font-size:0.75em;color:#aaa;white-space:nowrap';
const tokenInput = el('input');
tokenInput.type = 'password';
tokenInput.placeholder = 'ghp_...';
tokenInput.style.cssText = 'flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;padding:2px 6px;color:#ccc;font-size:0.75em;min-width:0';
tokenInput.value = localStorage.getItem(GIST_TOKEN_KEY) || '';
tokenInput.onchange = () => {
    const v = tokenInput.value.trim();
    if (v) { localStorage.setItem(GIST_TOKEN_KEY, v); setStatus('🔑 Token saved', CLR.ok); }
    else { localStorage.removeItem(GIST_TOKEN_KEY); setStatus('🔑 Token cleared', CLR.info); }
};
tokenRow.appendChild(tokenLabel);
tokenRow.appendChild(tokenInput);
dropdown.appendChild(tokenRow);

// --- Preset file/gist operations in gear menu ---
// DESIGN: Utility items (save/load file + gist) live in gear, not preset dropdown.
// Keeps preset menu purely about choosing prompts.
const utilDivider = el('div');
utilDivider.style.cssText = 'border-top:1px solid rgba(255,255,255,0.1);margin:6px 0';
dropdown.appendChild(utilDivider);

const utilStyle = 'padding:6px 12px;cursor:pointer;font-size:0.8em;border-radius:4px;margin:2px 6px';
const utilHover = (el) => { el.onmouseenter = () => { el.style.background = 'rgba(255,255,255,0.08)'; }; el.onmouseleave = () => { el.style.background = 'none'; }; };

const gearSaveFile = el('div');
gearSaveFile.style.cssText = utilStyle + ';color:#6bff6b';
gearSaveFile.textContent = '💾 Save presets to file';
gearSaveFile.onclick = (e) => { e.stopPropagation(); savePresetsToFile(); };
utilHover(gearSaveFile);
dropdown.appendChild(gearSaveFile);

const gearLoadFile = el('div');
gearLoadFile.style.cssText = utilStyle + ';color:#ffb86b';
gearLoadFile.textContent = '📂 Load presets from file';
gearLoadFile.onclick = (e) => { e.stopPropagation(); loadPresetsFromFile(); };
utilHover(gearLoadFile);
dropdown.appendChild(gearLoadFile);

const gearSaveGist = el('div');
gearSaveGist.style.cssText = utilStyle + ';color:#a78bfa';
gearSaveGist.textContent = '☁️ Save presets to Gist';
gearSaveGist.onclick = (e) => { e.stopPropagation(); savePresetsToGist(); };
utilHover(gearSaveGist);
dropdown.appendChild(gearSaveGist);

const gearLoadGist = el('div');
gearLoadGist.style.cssText = utilStyle + ';color:#c084fc';
gearLoadGist.textContent = '☁️ Load presets from Gist';
gearLoadGist.onclick = (e) => { e.stopPropagation(); loadPresetsFromGist(); };
utilHover(gearLoadGist);
dropdown.appendChild(gearLoadGist);

// --- Porcupine toggle handler ---
// DESIGN: Only subscribe/unsubscribe when continuous mode is ON.
// Without continuous, there's no Google SpeechRecognition to capture
// the command after Porcupine detects the wake word.
porcupineCb.onchange = () => {
    if (!toggleCb.checked) return;
    if (porcupineCb.checked) {
        if (V.porcupineSubscribe) V.porcupineSubscribe();
        setStatus('🦔 Say "solvent"', CLR.info);
    } else {
        if (V.porcupineUnsubscribe) V.porcupineUnsubscribe();
        setStatus(MSG.wake, CLR.info);
    }
};

// --- Preset Prompts Dropdown ---
// DESIGN: Split button — left shows current preset name (click to open editor),
// right arrow opens dropdown of preset prompts. Follows solveit-canvas pattern.
const presetWrap = el('div', 'v-gear-wrap');
presetWrap.style.cssText = 'position:relative;display:flex;align-items:center';

const presetBtn = el('button', null, { textContent: '📋', title: 'Preset prompts' });
presetBtn.style.cssText = 'border:none;background:rgba(255,255,255,0.08);border-radius:6px 0 0 6px;padding:4px 8px;cursor:pointer;font-size:0.85em;color:#ccc;height:28px;border-right:1px solid rgba(255,255,255,0.1)';

const presetArrow = el('button', null, { textContent: '▾', title: 'Choose preset' });
presetArrow.style.cssText = 'border:none;background:rgba(255,255,255,0.08);border-radius:0 6px 6px 0;padding:4px 6px;cursor:pointer;font-size:0.75em;color:#ccc;height:28px';

// DESIGN: Two-panel preset menu — category tabs on RIGHT, preset items on LEFT.
// presetMenu is the outer container (flex row). Left panel swaps when category clicked.
// Utility items (save/load/gist) moved to gear menu in Step 3.
const presetMenu = el('div', 'v-dropdown');
// DESIGN: Right-aligned — menu expands leftward from the preset button's right edge.
presetMenu.style.cssText += ';bottom:36px;right:0;left:auto;display:none;padding:0;overflow:visible';

// DESIGN: Left panel shows presets for active category, scrollable.
const presetListPanel = el('div');
presetListPanel.style.cssText = 'min-width:200px;max-height:260px;overflow-y:auto;padding:4px 0';

// DESIGN: Right panel shows category tabs, fixed height, no scroll.
const categoryPanel = el('div');
categoryPanel.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:6px;border-left:1px solid rgba(255,255,255,0.1);min-width:80px';

// DESIGN: Assemble two-panel layout — presets left, categories right.
presetMenu.appendChild(presetListPanel);
presetMenu.appendChild(categoryPanel);

// DESIGN: Category tab colors — rotate through palette for visual distinction.
const CAT_COLORS = ['#ff6b6b', '#ffa06b', '#6bc5ff', '#a78bfa', '#6bff6b', '#ffda6b'];

function buildPresetMenu() {
    // --- RIGHT PANEL: category tabs ---
    categoryPanel.innerHTML = '';
    const cats = Object.keys(presets);
    cats.forEach((cat, ci) => {
        const tab = el('div');
        const isActive = cat === activeCategory;
        const color = CAT_COLORS[ci % CAT_COLORS.length];
        // DESIGN: Active tab gets solid background + white text, inactive gets outline style.
        tab.style.cssText = 'padding:5px 10px;border-radius:6px;cursor:pointer;font-size:0.78em;font-weight:600;text-align:center;transition:all 0.15s;'
            + (isActive
                ? 'background:' + color + ';color:#1a1a2e;'
                : 'background:transparent;color:' + color + ';border:1px solid ' + color + ';');
        tab.textContent = cat;
        // DESIGN: Click swaps the left panel contents — no close/reopen flicker.
        tab.onclick = (e) => { e.stopPropagation(); activeCategory = cat; buildPresetMenu(); log('Category switched:', cat); };
        // DESIGN: Double-click renames category — prompt for new name, move all presets.
        tab.ondblclick = (e) => {
            e.stopPropagation();
            const newName = prompt('Rename category "' + cat + '" to:', cat);
            if (!newName || newName === cat || newName.trim() === '') return;
            const trimmed = newName.trim().toLowerCase();
            if (presets[trimmed]) { setStatus('⚠️ Category "' + trimmed + '" already exists', CLR.warn); return; }
            // DESIGN: Create new key with old presets, delete old key, preserve order.
            const newPresets = {};
            Object.keys(presets).forEach(k => { newPresets[k === cat ? trimmed : k] = presets[k]; });
            presets = newPresets;
            if (activeCategory === cat) activeCategory = trimmed;
            savePresets(); buildPresetMenu();
            setStatus('✏️ Renamed: ' + cat + ' → ' + trimmed, CLR.ok);
            log('Category renamed:', cat, '→', trimmed);
        };
        // DESIGN: Right-click deletes category — confirm, move presets to first remaining.
        tab.oncontextmenu = (e) => {
            e.preventDefault(); e.stopPropagation();
            if (cats.length <= 1) { setStatus('⚠️ Cannot delete last category', CLR.warn); return; }
            const count = (presets[cat] || []).length;
            const msg = count > 0
                ? 'Delete "' + cat + '"? Its ' + count + ' preset(s) will move to the first remaining category.'
                : 'Delete empty category "' + cat + '"?';
            if (!confirm(msg)) return;
            // DESIGN: Move presets to first remaining category before deleting.
            const remaining = cats.filter(c => c !== cat);
            if (count > 0) { presets[remaining[0]] = (presets[remaining[0]] || []).concat(presets[cat]); }
            delete presets[cat];
            if (activeCategory === cat) activeCategory = remaining[0];
            savePresets(); buildPresetMenu();
            setStatus('🗑️ Deleted: ' + cat + (count > 0 ? ' (' + count + ' moved to ' + remaining[0] + ')' : ''), CLR.ok);
            log('Category deleted:', cat, count > 0 ? '→ moved ' + count + ' to ' + remaining[0] : '(empty)');
        };
        tab.onmouseenter = () => { if (cat !== activeCategory) tab.style.background = 'rgba(255,255,255,0.08)'; };
        tab.onmouseleave = () => { if (cat !== activeCategory) tab.style.background = 'transparent'; };
        categoryPanel.appendChild(tab);
    });

    // DESIGN: "+ Category" button at bottom of category panel — prompts for name, creates empty.
    const addCatBtn = el('div');
    addCatBtn.style.cssText = 'padding:5px 10px;border-radius:6px;cursor:pointer;font-size:0.75em;text-align:center;color:#6bc5ff;border:1px dashed rgba(107,197,255,0.4);margin-top:2px';
    addCatBtn.textContent = '+ Category';
    addCatBtn.onclick = (e) => {
        e.stopPropagation();
        const name = prompt('New category name:');
        if (!name || name.trim() === '') return;
        const trimmed = name.trim().toLowerCase();
        if (presets[trimmed]) { setStatus('⚠️ Category "' + trimmed + '" already exists', CLR.warn); return; }
        presets[trimmed] = [];
        activeCategory = trimmed;
        savePresets(); buildPresetMenu();
        setStatus('✅ Category added: ' + trimmed, CLR.ok);
        log('Category added:', trimmed);
    };
    addCatBtn.onmouseenter = () => { addCatBtn.style.background = 'rgba(255,255,255,0.08)'; };
    addCatBtn.onmouseleave = () => { addCatBtn.style.background = 'none'; };
    categoryPanel.appendChild(addCatBtn);

    // --- LEFT PANEL: preset items for active category ---
    presetListPanel.innerHTML = '';
    const catItems = presets[activeCategory] || [];
    if (catItems.length === 0) {
        const empty = el('div');
        empty.style.cssText = 'padding:12px;color:#666;font-size:0.8em;font-style:italic;text-align:center';
        empty.textContent = '(empty)';
        presetListPanel.appendChild(empty);
    } else {
        catItems.forEach((p, i) => {
            const item = el('div');
            item.style.cssText = 'padding:6px 12px;cursor:pointer;color:#ccc;font-size:0.8em';
            item.textContent = p.name;
            // DESIGN: Single click selects preset and closes entire menu.
            item.onclick = (e) => { e.stopPropagation(); promptText = p.text; lastSelectedPreset = { cat: activeCategory, idx: i }; presetMenu.style.display = 'none'; presetMenuOpen = false; setStatus('📋 ' + p.name + ' [' + activeCategory + ']', CLR.info); log('Preset selected:', p.name, 'cat:', activeCategory, 'idx:', i); };
            // DESIGN: Double click opens editor for this preset.
            item.ondblclick = (e) => { e.stopPropagation(); presetMenu.style.display = 'none'; presetMenuOpen = false; openPresetEditor(p.text, i, activeCategory); };
            item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.08)'; };
            item.onmouseleave = () => { item.style.background = 'none'; };
            presetListPanel.appendChild(item);
        });
    }
    // DESIGN: "+ Custom..." always at bottom of left panel — creates new preset in active category.
    const custom = el('div');
    custom.style.cssText = 'padding:6px 12px;cursor:pointer;color:#6bc5ff;font-size:0.8em;border-top:1px solid rgba(255,255,255,0.1)';
    custom.textContent = '+ Custom...';
    custom.onclick = (e) => { e.stopPropagation(); presetMenu.style.display = 'none'; presetMenuOpen = false; openPresetEditor('', -1, activeCategory); };
    custom.onmouseenter = () => { custom.style.background = 'rgba(255,255,255,0.08)'; };
    custom.onmouseleave = () => { custom.style.background = 'none'; };
    presetListPanel.appendChild(custom);
}
buildPresetMenu();
loadPresets();
loadAnchor();

// Preset editor overlay
// DESIGN: Three buttons — Cancel (discard), Use (temporary), Save (persistent).
// For existing presets, Save overwrites the text in storage.
// For new/custom presets, Save prompts for a title then adds to the list.
// DESIGN: editCat tracks which category this preset belongs to.
// For new presets (editIndex=-1), editCat defaults to activeCategory.
function openPresetEditor(text, editIndex, editCat) {
    editCat = editCat || activeCategory;
    const overlay = el('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center';
    const box = el('div');
    box.style.cssText = 'background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:16px;width:400px;max-width:90vw';
    const ta = el('textarea');
    ta.style.cssText = 'width:100%;height:120px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;font-size:12px;padding:8px;resize:vertical;font-family:system-ui';
    ta.value = text;
    const btnRow = el('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:10px;justify-content:flex-end';

    // Cancel — discard changes
    const cancelBtn = el('button', null, { textContent: 'Cancel' });
    cancelBtn.style.cssText = 'border:none;background:rgba(255,255,255,0.1);color:#ccc;padding:6px 14px;border-radius:6px;cursor:pointer';
    cancelBtn.onclick = () => overlay.remove();

    // Use — temporary, just sets promptText for this session
    const useBtn = el('button', null, { textContent: 'Use' });
    useBtn.style.cssText = 'border:none;background:#2563eb;color:white;padding:6px 14px;border-radius:6px;cursor:pointer';
    useBtn.onclick = () => {
        promptText = ta.value.trim();
        overlay.remove();
        setStatus('📋 Prompt set (' + promptText.length + ' chars)', CLR.info);
    };

    // Save — persistent, writes to chrome.storage.local
    const persistBtn = el('button', null, { textContent: 'Save' });
    persistBtn.style.cssText = 'border:none;background:#27ae60;color:white;padding:6px 14px;border-radius:6px;cursor:pointer';
    persistBtn.onclick = () => {
        const newText = ta.value.trim();
        if (!newText) { setStatus('Cannot save empty preset', CLR.warn); return; }

        const catArr = presets[editCat] || [];
        if (editIndex >= 0 && editIndex < catArr.length) {
            // DESIGN: Existing preset — open title prompt with current name pre-filled
            overlay.remove();
            openTitlePrompt(newText, presets[editCat][editIndex].name, editIndex, editCat);
        } else {
            // DESIGN: New preset — prompt for title with blank input
            overlay.remove();
            openTitlePrompt(newText, null, -1, editCat);
        }
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(useBtn);
    btnRow.appendChild(persistBtn);
    box.appendChild(ta);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    ta.focus();
}

// DESIGN: Title prompt for saving presets (new or existing).
// For existing presets, pre-fills with current name so user can keep or change it.
// For new presets, shows blank input.
// DESIGN: editCat specifies which category to save into.
function openTitlePrompt(presetText, existingName, editIndex, editCat) {
    editCat = editCat || activeCategory;
    const overlay = el('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10002;display:flex;align-items:center;justify-content:center';
    const box = el('div');
    box.style.cssText = 'background:#1a1a2e;border:1px solid rgba(255,255,255,0.15);border-radius:10px;padding:16px;width:320px;max-width:90vw';
    const label = el('div');
    label.style.cssText = 'color:#ccc;font-size:0.85em;margin-bottom:8px';
    label.textContent = 'Name this preset:';
    const input = el('input');
    input.style.cssText = 'width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#fff;font-size:13px;padding:8px;font-family:system-ui';
    input.placeholder = 'e.g. Summarize Section';
    if (existingName) input.value = existingName;
    const btnRow = el('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:10px;justify-content:flex-end';
    const cancelBtn = el('button', null, { textContent: 'Cancel' });
    cancelBtn.style.cssText = 'border:none;background:rgba(255,255,255,0.1);color:#ccc;padding:6px 14px;border-radius:6px;cursor:pointer';
    cancelBtn.onclick = () => overlay.remove();
    const saveBtn = el('button', null, { textContent: 'Save' });
    saveBtn.style.cssText = 'border:none;background:#27ae60;color:white;padding:6px 14px;border-radius:6px;cursor:pointer';
    saveBtn.onclick = () => {
        const name = input.value.trim();
        if (!name) { input.style.borderColor = '#e74c3c'; return; }
        // DESIGN: Ensure category array exists before saving
        if (!presets[editCat]) presets[editCat] = [];
        const catArr = presets[editCat];
        if (editIndex >= 0 && editIndex < catArr.length) {
            // DESIGN: Update existing preset — change name and/or text
            catArr[editIndex] = { name, text: presetText };
            setStatus('💾 Updated: ' + name + ' [' + editCat + ']', CLR.ok);
            log('Preset updated:', name, 'in category:', editCat);
        } else {
            // DESIGN: Create new preset in this category
            catArr.push({ name, text: presetText });
            const total = Object.values(presets).reduce((sum, arr) => sum + arr.length, 0);
            setStatus('💾 New preset: ' + name + ' [' + editCat + ']', CLR.ok);
            log('New preset created:', name, 'in', editCat, '(' + total + ' total)');
        }
        promptText = presetText;
        savePresets();
        buildPresetMenu();
        overlay.remove();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') saveBtn.onclick(); };
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    box.appendChild(label);
    box.appendChild(input);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    input.focus();
}

let presetMenuOpen = false;
// DESIGN: Toggle uses 'flex' not 'block' — two-panel layout requires flex container.
presetArrow.onclick = (e) => { e.stopPropagation(); presetMenuOpen = !presetMenuOpen; presetMenu.style.display = presetMenuOpen ? 'flex' : 'none'; };
presetBtn.onclick = (e) => { e.stopPropagation(); openPresetEditor(promptText, lastSelectedPreset.idx, lastSelectedPreset.cat); };

presetWrap.appendChild(presetBtn);
presetWrap.appendChild(presetArrow);
presetWrap.appendChild(presetMenu);

// --- Send Mode Dropdown ---
// DESIGN: Split button — left sends promptText, right arrow opens mode dropdown.
// Replaces the message type dot. Follows solveit-canvas pattern.
const sendWrap = el('div', 'v-gear-wrap');
sendWrap.style.cssText = 'position:relative;display:flex;align-items:center';

const sendBtn = el('button', null, { title: 'Send preset prompt' });
sendBtn.style.cssText = 'border:none;background:#e74c3c;border-radius:6px 0 0 6px;padding:4px 10px;cursor:pointer;font-size:0.85em;color:white;height:28px;border-right:1px solid rgba(255,255,255,0.2)';
const updateSendBtn = () => {
    const m = SEND_MODES.find(s => s.mode === sendMode);
    sendBtn.textContent = m.icon;
    sendBtn.style.background = m.color;
};
updateSendBtn();

const sendArrow = el('button', null, { textContent: '▾', title: 'Send mode' });
sendArrow.style.cssText = 'border:none;background:rgba(255,255,255,0.08);border-radius:0 6px 6px 0;padding:4px 6px;cursor:pointer;font-size:0.75em;color:#ccc;height:28px';

const sendMenu = el('div', 'v-dropdown');
sendMenu.style.cssText += ';bottom:36px;right:0;left:auto;min-width:180px';

SEND_MODES.forEach(m => {
    const item = el('div', 'v-switch-row');
    item.style.cssText = 'padding:6px 12px;cursor:pointer;color:#ccc;font-size:0.8em';
    item.textContent = m.icon + ' ' + m.label;
    item.onclick = (e) => { e.stopPropagation(); sendMode = m.mode; updateSendBtn(); sendMenu.style.display = 'none'; setStatus(m.label, m.color); log('Send mode:', m.mode); };
    item.onmouseenter = () => { item.style.background = 'rgba(255,255,255,0.08)'; };
    item.onmouseleave = () => { item.style.background = 'none'; };
    sendMenu.appendChild(item);
});

// DESIGN: Send button sends promptText. Disabled when empty.
sendBtn.onclick = () => {
    if (!promptText.trim()) { setStatus('No preset selected', CLR.warn); return; }
    log('Send preset:', promptText.slice(0, 40), 'mode:', sendMode);
    V.sendPreset(promptText, sendMode);
};

let sendMenuOpen = false;
sendArrow.onclick = (e) => { e.stopPropagation(); sendMenuOpen = !sendMenuOpen; sendMenu.style.display = sendMenuOpen ? 'block' : 'none'; };

sendWrap.appendChild(sendBtn);
sendWrap.appendChild(sendArrow);
sendWrap.appendChild(sendMenu);

// --- Close all dropdowns on outside click ---
document.addEventListener('click', (e) => {
    if (presetMenuOpen && !presetWrap.contains(e.target)) { presetMenuOpen = false; presetMenu.style.display = 'none'; }
    if (sendMenuOpen && !sendWrap.contains(e.target)) { sendMenuOpen = false; sendMenu.style.display = 'none'; }
}, sig);

let ddOpen = false;
gearBtn.onclick = (e) => { e.stopPropagation(); ddOpen = !ddOpen; dropdown.style.display = ddOpen ? 'block' : 'none'; setGearStyle(ddOpen); };
document.addEventListener('click', (e) => {
    if (ddOpen && !dropdown.contains(e.target) && e.target !== gearBtn) {
        ddOpen = false; dropdown.style.display = 'none'; setGearStyle(false);
    }
}, sig);

// --- Anchor Selection ---
// DESIGN: One-shot mode — toggle ON, click a message, auto-OFF.
// Uses [data-sm] to find Solveit's message wrapper (framework-independent).
anchorCb.onchange = () => {
    if (anchorCb.checked) setStatus('📌 Click a message to set anchor...', CLR.warn);
    else setStatus(toggleCb.checked ? (porcupineCb.checked ? '🦔 Say "solvent"' : MSG.wake) : MSG.idle);
};

document.addEventListener('click', (e) => {
    if (!anchorCb.checked) return;
    const wrapper = e.target.closest('[data-sm]');
    if (!wrapper) return;
    const msgId = wrapper.id;
    if (!msgId) return;
    anchorId = msgId;
    anchorLabel.textContent = '📌 ' + anchorId;
    anchorCb.checked = false;
    anchorSwitch.render();
    setStatus('📌 Anchor set: ' + anchorId, CLR.ok);
    log('Anchor set:', anchorId);
    // DESIGN: Persist anchor to localStorage so it survives refresh/reload
    saveAnchor();
}, sig);

const gearWrap = el('div', 'v-gear-wrap');
gearWrap.appendChild(gearBtn);
gearWrap.appendChild(dropdown);

// --- Assemble Widget ---
div.appendChild(btn);
div.appendChild(ttsStopBtn);
div.appendChild(status);
div.appendChild(presetWrap);
div.appendChild(sendWrap);
div.appendChild(gearWrap);
document.body.appendChild(div);

// --- Expose widget element and shared functions ---
V.widget = div;
V.setStatus = setStatus;
V.getDname = getDname;
V.resetUI = resetUI;
V.autoCb = autoCb;
V.doubleBeep = doubleBeep;
// DESIGN: sendMode getter — send.js reads this to determine msg_type + run flag
Object.defineProperty(V, 'msgType', { get() { return sendMode === 'note' ? 'note' : 'prompt'; }, configurable: true });
Object.defineProperty(V, 'sendMode', { get() { return sendMode; }, set(v) { sendMode = v; } });
Object.defineProperty(V, 'promptText', { get() { return promptText; }, set(v) { promptText = v; } });

// --- Speech Recognition Setup ---
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) {
    status.textContent = MSG.noApi;
    window._voiceCleanup = () => { ac.abort(); div.remove(); };
    return;
}

const rec = new SR();
V.rec = rec;
V.safeStart = safeStartRec;
rec.continuous = true;
rec.interimResults = true;

let on = false;
let transcript = '';
let silenceTimer = null;
let wakeDetected = false;
let commandTranscript = '';
let commandBuffer = '';
let sessionText = '';
let wakeResultIdx = 0;
let lastResultLen = 0;
let lastResultTime = 0;
let emptyTextSince = 0;
let livenessWarned = false;
let destroyed = false;
let startTimer = null;
let userActive = false;

// --- Getters for split-out modules ---
// DESIGN: msgType, sendMode, promptText are defined above (near V exports).
// anchorId is also defined above as a getter reading the local anchorId variable.
Object.defineProperty(V, 'anchorId',   { get: () => anchorId, set: (v) => { anchorId = v; }, configurable: true });
Object.defineProperty(V, 'destroyed',  { get: () => destroyed,  configurable: true });
Object.defineProperty(V, 'userActive', { get: () => userActive, configurable: true });

// --- Robust restart function ---
function canStart() { return !(destroyed || on); }
function safeStartRec(delay = 300) {
    if (startTimer) clearTimeout(startTimer);
    startTimer = setTimeout(() => {
        startTimer = null;
        if (!canStart()) return;
        if (V._tabHidden) return;
        if (!toggleCb.checked && !wakeDetected) return;
        try { rec.start(); log('rec.start() OK'); }
        catch(e) {
            log('rec.start() failed:', e.message, '— retrying in 1s');
            startTimer = setTimeout(() => {
                startTimer = null;
                if (!canStart()) return;
                try { rec.start(); } catch(e2) { log('rec.start() retry failed:', e2.message); }
            }, CFG.retryMs);
        }
    }, delay);
}

// --- Watchdog: recover stuck TTS and frozen sessions ---
const watchdog = setInterval(() => {
    if (destroyed) { clearInterval(watchdog); return; }
    if (V.speaking && !speechSynthesis.speaking && !speechSynthesis.pending) {
        log('Watchdog: TTS stuck, forcing reset'); V.ttsEnd();
    }
    // Liveness check: detect frozen speech session
    if (wakeDetected && on) {
        const hasText = !!(sessionText.trim() || commandBuffer.trim());
        if (hasText) { emptyTextSince = 0; }
        else if (!emptyTextSince) { emptyTextSince = Date.now(); }
        const emptyMs = emptyTextSince ? Date.now() - emptyTextSince : 0;
        log('Liveness:', { emptyMs: Math.round(emptyMs), hasText, sessionText: sessionText.slice(-30), commandBuffer: commandBuffer.slice(-30) });
        if (emptyTextSince && emptyMs > 2000 && !livenessWarned) {
            log('Watchdog: empty for 2s, warning beep'); livenessWarned = true; warnBeep();
        }
        if (emptyTextSince && emptyMs > 5000) {
            log('Watchdog: frozen session detected, restarting');
            if (V.go) V.go('command', 'liveness restart — session frozen');
            lastResultTime = 0; emptyTextSince = 0; livenessWarned = false;
            commandBuffer = ''; sessionText = '';
            resetSilenceTimer(); stopRec(); beep(); safeStartRec(CFG.restartMs);
        }
    }
    if (toggleCb.checked && !on && !V._tabHidden) { log('Watchdog: restarting'); safeStartRec(100); }
}, CFG.watchdogMs);

// --- AudioContext for beeps ---
let audioCtx = null;
async function beep(freq = 880, duration = 150) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = freq; gain.gain.value = 0.3;
    osc.start(); osc.stop(audioCtx.currentTime + duration / 1000);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}
async function doubleBeep(freq = 550, dur = 100, gap = 130) {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const o1 = audioCtx.createOscillator(), g1 = audioCtx.createGain();
    o1.connect(g1); g1.connect(audioCtx.destination); o1.frequency.value = freq; g1.gain.value = 0.3;
    o1.start(); o1.stop(audioCtx.currentTime + dur/1000);
    const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
    o2.connect(g2); g2.connect(audioCtx.destination); o2.frequency.value = freq; g2.gain.value = 0.3;
    o2.start(audioCtx.currentTime + gap/1000); o2.stop(audioCtx.currentTime + gap/1000 + dur/1000);
    o2.onended = () => { o1.disconnect(); g1.disconnect(); o2.disconnect(); g2.disconnect(); };
}
async function warnBeep() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    const o1 = audioCtx.createOscillator(), g1 = audioCtx.createGain();
    o1.connect(g1); g1.connect(audioCtx.destination); o1.frequency.value = 880; g1.gain.value = 0.3;
    o1.start(); o1.stop(audioCtx.currentTime + 0.15);
    const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
    o2.connect(g2); g2.connect(audioCtx.destination); o2.frequency.value = 440; g2.gain.value = 0.3;
    o2.start(audioCtx.currentTime + 0.18); o2.stop(audioCtx.currentTime + 0.33);
    o2.onended = () => { o1.disconnect(); g1.disconnect(); o2.disconnect(); g2.disconnect(); };
}

// --- Silence timer ---
function clearSilence() { if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; } }
function resetWakeState() {
    wakeDetected = false; commandTranscript = ''; commandBuffer = '';
    sessionText = ''; wakeResultIdx = 0; clearSilence(); emptyTextSince = 0;
}
V.resetWakeState = resetWakeState;
V.isWakeActive = () => wakeDetected;

// --- Debug dashboard ---
let ttsPoll = null;
let ttsSafety = null;
Object.defineProperty(V, '_dbg', { get: () => ({
    commandTranscript, commandBuffer, sessionText, wakeResultIdx,
    wakeDetected, state: V.state, on, lastResultLen, ttsPoll, ttsSafety,
    destroyed, silenceTimer, wakeDetected, anchorId
}), configurable: true });
V._resetSilenceTimer = () => resetSilenceTimer();
V._collectTranscript = (results, start) => collectTranscript(results, start);

// --- TTS watcher (used by tts.js but defined here for shared access) ---
function clearTtsWatch() {
    if (ttsPoll) { clearInterval(ttsPoll); ttsPoll = null; }
    if (ttsSafety) { clearTimeout(ttsSafety); ttsSafety = null; }
}
V.clearTtsWatch = clearTtsWatch;
// Expose ttsPoll/ttsSafety setters for tts.js
V._setTtsPoll = (v) => { ttsPoll = v; };
V._setTtsSafety = (v) => { ttsSafety = v; };
V._getTtsPoll = () => ttsPoll;

// --- Barge-in: Porcupine trigger ---
V.triggerWake = () => {
    if (!porcupineCb.checked) return;
    if (wakeDetected || V.state === 'send') return;
    userActive = true;
    log('Porcupine: wake word triggered!');
    wakeDetected = true;
    if (V.go) V.go('command', V.speaking ? 'Porcupine barge-in — interrupted TTS' : ttsPoll ? 'Porcupine barge-in — interrupted generating response' : 'Porcupine wake word detected');
    wakeResultIdx = lastResultLen;
    if (V.speaking) {
        log('Porcupine barge-in: stopping TTS');
        speechSynthesis.cancel(); V.speaking = false; ttsStopBtn.style.display = 'none';
        const kokoroAudio = document.querySelector('#kokoro-audio-container audio');
        if (kokoroAudio && !kokoroAudio.paused) kokoroAudio.pause();
    }
    clearTtsWatch(); if (V.clearKokoroWatch) V.clearKokoroWatch();
    beep(CFG.beepFreq, CFG.beepDur);
    commandTranscript = ''; commandBuffer = ''; sessionText = '';
    setStatus(MSG.command, CLR.ok);
    if (!on) safeStartRec(100);
    resetSilenceTimer();
};
V.porcupineCb = porcupineCb;

function stopRec() { try { rec.stop(); } catch(e) {} }
function resetUI() { btn.textContent = '🎤'; setStatus(MSG.idle); }
function collectTranscript(results, start = 0) {
    let text = '';
    for (let i = start; i < results.length; i++) text += results[i][0].transcript;
    return text;
}

function resetSilenceTimer() {
    clearSilence();
    silenceTimer = setTimeout(async () => {
        silenceTimer = null;
        if (wakeDetected && commandTranscript.trim()) {
            V.go('send', 'silence timer fired');
            const text = commandTranscript.trim();
            resetWakeState(); stopRec(); doubleBeep();
            await V.sendAndRestart(text);
        }
    }, CFG.silenceMs);
}

// --- Wake phrase detection ---
const WAKE_RE = /(?:solveit|solve it|solvent|so late|salt wait)/gi;
function findWake(text) {
    let last = null;
    for (const m of text.matchAll(WAKE_RE)) last = m;
    return last ? { idx: last.index, len: last[0].length } : null;
}

// --- Button click handler ---
btn.onclick = async () => {
    userActive = true;
    if (on) {
        stopRec(); resetWakeState();
        if (!toggleCb.checked && transcript.trim()) {
            const text = transcript; transcript = '';
            V.go('send', 'manual mic stop with text');
            await V.sendAndRestart(text);
        } else { resetUI(); V.go('idle', 'manual mic stop, no text'); }
    } else {
        if (V.speaking) {
            log('Barge-in: mic clicked, stopping TTS');
            speechSynthesis.cancel(); V.speaking = false; ttsStopBtn.style.display = 'none';
            const kokoroAudio = document.querySelector('#kokoro-audio-container audio');
            if (kokoroAudio && !kokoroAudio.paused) kokoroAudio.pause();
        }
        transcript = ''; resetWakeState();
        try { rec.start(); } catch(e) { setStatus('⚠️ ' + e.message, CLR.warn); }
        if (V.go) V.go('manual', !V.speaking && ttsPoll ? 'barge-in via mic click — interrupted generating response' : V.speaking ? 'barge-in via mic click — interrupted TTS' : 'mic button clicked');
    }
};

// --- Recognition events ---
rec.onstart = () => {
    on = true;
    if (wakeDetected) wakeResultIdx = 0;
    if (toggleCb.checked) {
        btn.style.display = 'none';
        if (!wakeDetected) setStatus(porcupineCb.checked ? '🦔 Say "solvent"' : MSG.wake, CLR.info);
    } else { btn.textContent = '⏹'; setStatus(MSG.listening, CLR.ok); }
};

rec.onend = async () => {
    on = false;
    if (destroyed) return;
    if (wakeDetected && sessionText.trim()) { commandBuffer = commandBuffer + sessionText.trim() + ' '; sessionText = ''; }
    if (V.state === 'send' || V.state === 'idle') return;
    if (toggleCb.checked) {
        if (!silenceTimer && !(porcupineCb.checked && wakeDetected)) resetWakeState();
        safeStartRec(CFG.restartMs); return;
    }
    if (!transcript.trim()) { resetUI(); setStatus(MSG.noSpeech); return; }
    const text = transcript; transcript = '';
    await V.sendAndRestart(text);
};

rec.onerror = (e) => {
    log('Speech recognition error:', e.error);
    if (e.error === 'not-allowed') setStatus(MSG.micDenied, CLR.err);
    else if (e.error !== 'no-speech' && e.error !== 'aborted') setStatus('⚠️ ' + e.error, CLR.warn);
};

rec.onresult = (e) => {
    lastResultTime = Date.now();
    lastResultLen = e.results.length;
    if (toggleCb.checked) {
        if (porcupineCb.checked) {
            if (wakeDetected) {
                sessionText = collectTranscript(e.results, wakeResultIdx ?? e.resultIndex).trim();
                commandTranscript = commandBuffer + sessionText;
                setStatus('🟢 ' + commandTranscript.slice(-40), CLR.ok);
                resetSilenceTimer();
            }
        } else if (!wakeDetected && V.state !== 'send') {
            const latest = collectTranscript(e.results, e.resultIndex);
            const wake = findWake(latest);
            if (wake) {
                userActive = true; wakeDetected = true; wakeResultIdx = e.resultIndex;
                V.go('command', V.speaking ? 'Google barge-in — interrupted TTS' : ttsPoll ? 'Google barge-in — interrupted generating response' : 'Google wake word detected');
                if (V.speaking) {
                    log('Wake word barge-in: stopping TTS');
                    speechSynthesis.cancel(); V.speaking = false; ttsStopBtn.style.display = 'none';
                    const kokoroAudio = document.querySelector('#kokoro-audio-container audio');
                    if (kokoroAudio && !kokoroAudio.paused) kokoroAudio.pause();
                }
                clearTtsWatch(); if (V.clearKokoroWatch) V.clearKokoroWatch();
                beep(CFG.beepFreq, CFG.beepDur);
                commandBuffer = '';
                sessionText = latest.slice(wake.idx + wake.len).trim();
                commandTranscript = commandBuffer + sessionText;
                setStatus(MSG.command, CLR.ok); resetSilenceTimer();
            }
        } else {
            const text = collectTranscript(e.results, wakeResultIdx);
            const wake = findWake(text);
            if (wake) { sessionText = text.slice(wake.idx + wake.len).trim(); }
            else { sessionText = text.trim(); }
            commandTranscript = commandBuffer + sessionText;
            setStatus('🟢 ' + commandTranscript.slice(-40), CLR.ok);
            resetSilenceTimer();
        }
    } else {
        transcript = collectTranscript(e.results);
        setStatus('🟢 ' + transcript.slice(-40), CLR.ok);
    }
};

// --- Continuous mode toggle ---
toggleCb.onchange = () => {
    resetWakeState();
    if (toggleCb.checked) {
        btn.style.display = 'none'; V.speaking = false;
        safeStartRec(100);
        setStatus(porcupineCb.checked ? '🦔 Say "solvent"' : MSG.wake, CLR.info);
        if (V.go) V.go('listen', 'continuous mode ON');
    } else {
        btn.style.display = ''; stopRec(); resetUI();
        if (V.go) V.go('idle', 'continuous mode OFF');
    }
};
toggleCb.onchange();

// --- TTS: Preload voices ---
speechSynthesis.getVoices();
speechSynthesis.onvoiceschanged = () => log('Voices loaded:', speechSynthesis.getVoices().length);

// --- Monkey-patch debounceScroll ---
// DESIGN: Prevent Solveit from auto-scrolling to voice widget's
// temporary code messages (e.g. Kokoro TTS self-deleting messages).
if (!window._origDebounceScroll && window.debounceScroll) {
    window._origDebounceScroll = window.debounceScroll;
    window.debounceScroll = function(el) {
        if (el && el.id && el.closest && el.closest('#voice-widget')) return;
        return window._origDebounceScroll?.call(this, el);
    };
}

// --- Global cleanup ---
window._voiceCleanup = () => {
    if (window._origDebounceScroll) {
        window.debounceScroll = window._origDebounceScroll;
        delete window._origDebounceScroll;
    }
    destroyed = true;
    ac.abort();
    if (startTimer) clearTimeout(startTimer);
    clearSilence(); clearInterval(watchdog); clearTtsWatch();
    speechSynthesis.cancel(); speechSynthesis.onvoiceschanged = null;
    stopRec();
    if (audioCtx) try { audioCtx.close(); audioCtx = null; } catch(e) {}
    // Chain module cleanups
    if (V._stateCleanup) V._stateCleanup();
    if (V._sendCleanup) V._sendCleanup();
    if (V._dragCleanup) V._dragCleanup();
    if (V._visCleanup) V._visCleanup();
    if (window._kokoroCleanup) window._kokoroCleanup();
    if (window._saveToggleCleanup) window._saveToggleCleanup();
    div.remove();
    window.__voiceWidgetInit = false;
    log('Voice widget cleaned up');
};

log('✅ Voice widget loaded');
})();

} // end init guard