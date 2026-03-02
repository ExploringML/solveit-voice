const CLR = { ok: '#6bff6b', info: '#6bc5ff', warn: '#ffd93d', err: '#ff6b6b', muted: '#aaa' };
export const ac = new AbortController();

const styleEl = document.createElement('style');
styleEl.id = 'solveit-voice-styles';
styleEl.textContent = `
    #solveit-voice { position:fixed;bottom:107px;right:46px;z-index:9999;background:rgba(15,15,25,0.85);backdrop-filter:blur(12px);padding:10px 14px;border-radius:14px;border:1px solid rgba(255,255,255,0.1);box-shadow:0 4px 24px rgba(0,0,0,0.4);display:flex;align-items:center;gap:10px;font-family:system-ui;cursor:grab }
    #solveit-voice .v-mic { font-size:1.8em;border:none;background:rgba(255,255,255,0.1);border-radius:50%;width:44px;height:44px;cursor:pointer }
    #solveit-voice .v-status { color:#aaa;font-size:0.8em;width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
    #solveit-voice .v-tts-stop { font-size:0.85em;border:none;background:rgba(255,100,100,0.2);border-radius:8px;padding:4px 10px;color:#ff6b6b;cursor:pointer }
    #solveit-voice .v-gear { border:none;background:rgba(255,255,255,0.08);border-radius:8px;padding:5px 8px;cursor:pointer;font-size:1.1em;color:#aaa;transition:all 0.2s }
    #solveit-voice .v-dropdown { position:absolute;right:0;bottom:52px;background:rgba(30,30,50,0.95);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:6px 0;width:280px;box-shadow:0 8px 24px rgba(0,0,0,0.5);display:none }
    #solveit-voice .v-switch-row { display:flex;align-items:center;justify-content:space-between;padding:7px 14px;cursor:pointer;color:#ccc;font-size:0.82em }
    #solveit-voice .v-switch-row:hover { background:rgba(255,255,255,0.08) }
    #solveit-voice .v-track { display:inline-block;width:28px;height:14px;border-radius:7px;position:relative;transition:background 0.2s;cursor:pointer }
    #solveit-voice .v-thumb { position:absolute;top:1px;width:12px;height:12px;border-radius:50%;transition:all 0.2s }
    #solveit-voice .v-gear-wrap { position:relative;display:flex;align-items:center }
    #solveit-voice .v-divider { border:none;border-top:1px solid rgba(255,255,255,0.08);margin:4px 14px }
    #solveit-voice .v-row { display:flex;align-items:center;padding:6px 14px;color:#ccc;font-size:0.82em;gap:8px }
    #solveit-voice .v-row label { width:80px;flex-shrink:0 }
    #solveit-voice .v-row input[type=range] { flex:1;accent-color:#6bff6b }
    #solveit-voice .v-row .v-val { width:32px;text-align:right }
    #solveit-voice .v-row input[type=password], #solveit-voice .v-row input[type=text], #solveit-voice .v-row select { flex:1;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;padding:3px 6px;color:#fff;font-size:0.85em;min-width:0 }
    #solveit-voice .v-row input.error { border-color:#ff6b6b }
    #solveit-voice select option { background:#1e1e32;color:#fff }
`;
document.getElementById('solveit-voice-styles')?.remove();
document.head.appendChild(styleEl);

function el(tag, cls, props) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (props) Object.assign(e, props);
    return e;
}

function makeSwitch(label, obj) {
    const row = el('div', 'v-switch-row'), track = el('span', 'v-track'), thumb = el('span', 'v-thumb');
    function render() {
        const on = obj.checked;
        track.style.background = on ? '#6bff6b' : '#555';
        Object.assign(thumb.style, on ? { right:'1px', left:'auto', background:'#fff' } : { left:'1px', right:'auto', background:'#888' });
    }
    render();
    track.append(thumb);
    row.append(el('span', null, { textContent: label }), track);
    row.onclick = () => { obj.checked = !obj.checked; render(); obj.onchange?.(); };
    return row;
}

function makeRow(labelText, input) {
    const row = el('div', 'v-row');
    const lbl = el('label', null, { textContent: labelText });
    row.append(lbl, input);
    return row;
}

function makeSlider(min, max, step, val, obj, key) {
    const inp = el('input', null, { type: 'range', min, max, step, value: val });
    const display = el('span', 'v-val', { textContent: val.toFixed(2) });
    inp.oninput = () => { obj[key] = parseFloat(inp.value); display.textContent = obj[key].toFixed(2); };
    const row = el('div', 'v-row');
    row.append(el('label', null, { textContent: key === 'value' ? 'Speed' : key }), inp, display);
    return row;
}

function makeSelect(options, current) {
    const sel = el('select');
    options.forEach(([val, txt]) => {
        const o = el('option', null, { value: val, textContent: txt });
        if (val === current) o.selected = true;
        sel.append(o);
    });
    return sel;
}

function makeKeyInput(storageKey, inputEl) {
    inputEl.onchange = () => {
        inputEl.classList.remove('error');
        window.postMessage({ type: 'solveit-save-key', key: storageKey, value: inputEl.value.trim() }, '*');
    };
    return inputEl;
}

// --- State objects ---
export const autoCb = { checked: false };
export const toggleCb = { checked: false };
export const ttsCb = { checked: true };
export const ttsManualCb = { checked: false };
export const ttsRate = { value: 1.15 };
export const ttsPitch = { value: 1.05 };

// ttsProvider: 'browser' | 'openai' | 'elevenlabs'
export const ttsProvider = { value: 'browser' };
export const openAiModel = { value: 'gpt-4o-mini-tts' };
export const openAiVoice = { value: 'cedar' };

// --- Widget DOM ---
const div = el('div', null, { id: 'solveit-voice' });
export const btn = el('button', 'v-mic', { textContent: '🎤' });
const status = el('span', 'v-status');
export const ttsStopBtn = el('button', 'v-tts-stop', { textContent: '⏹', title: 'Stop speech' });
ttsStopBtn.style.display = 'none';

export function setStatus(text, color = CLR.muted, onClick = null) {
    status.textContent = text; status.style.color = color;
    status.style.cursor = onClick ? 'pointer' : 'default';
    status.onclick = onClick;
}
setStatus('Click mic to start');

// --- Gear dropdown ---
const dropdown = el('div', 'v-dropdown');

// Main toggles
[['Auto-run code', autoCb], ['Continuous mode', toggleCb], ['TTS voice prompt', ttsCb], ['TTS manual prompt', ttsManualCb]]
    .forEach(([l, o]) => dropdown.append(makeSwitch(l, o)));

dropdown.append(el('hr', 'v-divider'));

// TTS provider selector
const providerSel = makeSelect([
    ['browser', 'Browser TTS'],
    ['openai',  'OpenAI TTS'],
    ['elevenlabs', 'ElevenLabs TTS'],
], ttsProvider.value);
providerSel.onchange = () => { ttsProvider.value = providerSel.value; updateProviderUI(); };
dropdown.append(makeRow('Provider', providerSel));

dropdown.append(el('hr', 'v-divider'));

// --- Browser TTS section ---
const browserSection = el('div');
browserSection.append(
    makeSlider(0.5, 2.0, 0.05, ttsRate.value, ttsRate, 'value'),
    makeSlider(0.5, 2.0, 0.05, ttsPitch.value, ttsPitch, 'pitch'),
);
dropdown.append(browserSection);

// --- OpenAI TTS section ---
const openAiModelSel = makeSelect([
    ['gpt-4o-mini-tts', 'gpt-4o-mini-tts'],
    ['tts-1', 'tts-1 (faster)'],
    ['tts-1-hd', 'tts-1-hd (quality)'],
], openAiModel.value);
openAiModelSel.onchange = () => { openAiModel.value = openAiModelSel.value; };

const openAiVoiceSel = makeSelect([
    ['alloy','Alloy'],['ash','Ash'],['ballad','Ballad'],['cedar','Cedar'],
    ['coral','Coral'],['echo','Echo'],['fable','Fable'],['nova','Nova'],
    ['onyx','Onyx'],['sage','Sage'],['shimmer','Shimmer'],['verse','Verse'],
], openAiVoice.value);
openAiVoiceSel.onchange = () => { openAiVoice.value = openAiVoiceSel.value; };

export const openAiKeyInput = makeKeyInput('openAiKey', el('input', null, { type: 'password', placeholder: 'sk-…', autocomplete: 'off' }));
openAiKeyInput.value = document.documentElement.dataset.solveitOpenAiKey || '';

const openAiSection = el('div');
openAiSection.append(
    makeRow('Model', openAiModelSel),
    makeRow('Voice', openAiVoiceSel),
    makeRow('API Key', openAiKeyInput),
);
dropdown.append(openAiSection);

// --- ElevenLabs TTS section ---
export const elevenKeyInput = makeKeyInput('elevenKey', el('input', null, { type: 'password', placeholder: 'sk_…', autocomplete: 'off' }));
elevenKeyInput.value = document.documentElement.dataset.solveitElevenKey || '';
const elevenSection = el('div');
elevenSection.append(makeRow('API Key', elevenKeyInput));
dropdown.append(elevenSection);

function updateProviderUI() {
    const p = ttsProvider.value;
    browserSection.style.display  = p === 'browser'      ? '' : 'none';
    openAiSection.style.display   = p === 'openai'        ? '' : 'none';
    elevenSection.style.display   = p === 'elevenlabs'    ? '' : 'none';
}
updateProviderUI();

// legacy compat exports (voice.js checks these)
export const openAiCb = { get checked() { return ttsProvider.value === 'openai'; } };
export const elevenLabsCb = { get checked() { return ttsProvider.value === 'elevenlabs'; } };

let ddOpen = false;
const gearBtn = el('button', 'v-gear', { textContent: '⚙️', title: 'Settings' });
const setGear = (on) => { gearBtn.style.background = on ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'; gearBtn.style.color = on ? '#fff' : '#aaa'; };
gearBtn.onmouseenter = () => setGear(true);
gearBtn.onmouseleave = () => { if (!ddOpen) setGear(false); };
gearBtn.onclick = (e) => { e.stopPropagation(); ddOpen = !ddOpen; dropdown.style.display = ddOpen ? 'block' : 'none'; setGear(ddOpen); };

// --- Message type selector ---
const MSG_TYPES = [
    { type: 'prompt', color: '#e74c3c', label: 'Prompt' },
    { type: 'code',   color: '#4a90e2', label: 'Code' },
    { type: 'note',   color: '#2ecc71', label: 'Note' },
    { type: 'raw',    color: '#f7e017', label: 'Raw' },
];
export let msgType = 'prompt';

const msgTypeDot = el('button', 'v-gear', { title: 'Message type' });
msgTypeDot.style.cssText = 'width:20px;height:20px;border-radius:50%;padding:0;margin-right:4px;border:2px solid rgba(255,255,255,0.3)';
const setMsgTypeDot = (t) => { msgType = t; msgTypeDot.style.background = MSG_TYPES.find(m => m.type === t).color; };
setMsgTypeDot('prompt');

const msgTypeDropdown = el('div', null);
msgTypeDropdown.style.cssText = 'position:absolute;right:0;bottom:42px;background:rgba(30,30,50,0.95);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:6px 10px;display:none;gap:8px;flex-direction:column;min-width:90px;box-shadow:0 8px 24px rgba(0,0,0,0.5)';
MSG_TYPES.forEach(({ type, color, label }) => {
    const row = el('div', null);
    row.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 0';
    const dot = el('span');
    dot.style.cssText = `width:12px;height:12px;border-radius:50%;background:${color};flex-shrink:0;display:inline-block`;
    const lbl = el('span', null, { textContent: label });
    lbl.style.cssText = 'color:#ccc;font-size:0.82em';
    row.append(dot, lbl);
    row.onclick = (e) => { e.stopPropagation(); setMsgTypeDot(type); msgTypeDropdown.style.display = 'none'; mtOpen = false; };
    msgTypeDropdown.append(row);
});

let mtOpen = false;
msgTypeDot.onclick = (e) => { e.stopPropagation(); mtOpen = !mtOpen; msgTypeDropdown.style.display = mtOpen ? 'flex' : 'none'; };

const msgTypeWrap = el('div', 'v-gear-wrap');
msgTypeWrap.append(msgTypeDot, msgTypeDropdown);

const gearWrap = el('div', 'v-gear-wrap');
gearWrap.append(gearBtn, dropdown);
div.append(btn, ttsStopBtn, status, msgTypeWrap, gearWrap);
document.getElementById('solveit-voice')?.remove();
document.body.appendChild(div);

// --- AudioContext (created on first user gesture) ---
let audioCtx = null;
export function ensureAudio() { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); }
export function getAudioCtx() { return audioCtx; }
export function beep(freq = 880, duration = 200) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.frequency.value = freq; gain.gain.value = 0.3;
    osc.start(); osc.stop(audioCtx.currentTime + duration / 1000);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}

// --- Dragging ---
let isDragging = false, dragX = 0, dragY = 0;
div.addEventListener('mousedown', (e) => {
    if (dropdown.contains(e.target)) return;
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SPAN') return;
    isDragging = true;
    dragX = e.clientX - div.getBoundingClientRect().left;
    dragY = e.clientY - div.getBoundingClientRect().top;
    div.style.cursor = 'grabbing';
}, { signal: ac.signal });
document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    Object.assign(div.style, { left: (e.clientX-dragX)+'px', top: (e.clientY-dragY)+'px', right: 'auto', bottom: 'auto' });
}, { signal: ac.signal });
document.addEventListener('mouseup', () => { if (isDragging) { isDragging = false; div.style.cursor = 'grab'; } }, { signal: ac.signal });

// --- Close dropdown on outside click ---
document.addEventListener('click', (e) => {
    if (ddOpen && !dropdown.contains(e.target) && e.target !== gearBtn) { ddOpen = false; dropdown.style.display = 'none'; setGear(false); }
    if (mtOpen && !msgTypeDropdown.contains(e.target) && e.target !== msgTypeDot) { mtOpen = false; msgTypeDropdown.style.display = 'none'; }
}, { signal: ac.signal });

export { CLR };

export function disable() {
    speechSynthesis?.cancel();
    div.style.display = 'none';
    document.querySelectorAll('.sv-play').forEach(el => el.style.display = 'none');
}

export function enable() {
    div.style.display = '';
    document.querySelectorAll('.sv-play').forEach(el => el.style.display = '');
}

export function reinit() {
    if (!document.getElementById('solveit-voice')) document.body.appendChild(div);
    if (!document.getElementById('solveit-voice-styles')) document.head.appendChild(styleEl);
}
