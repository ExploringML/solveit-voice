// ═══════════════════════════════════════════════════════════════════════
// SolveIt Voice — Popup Settings
//
// DESIGN: Manages extension enable/disable toggle and API key storage.
// Keys are stored in chrome.storage.local (sandboxed per-extension).
// content.js reads these and passes to page via data-* attributes.
//
// Following David's pattern: popup.html has the UI, popup.js handles
// the storage read/write and tab messaging.
// ═══════════════════════════════════════════════════════════════════════

const toggle = document.getElementById('toggle');
const porcupineInput = document.getElementById('porcupineKey');
const replicateInput = document.getElementById('replicateKey');
const statusEl = document.getElementById('status');

// --- Load saved state ---
chrome.storage.local.get({
    enabled: true,
    porcupineKey: '',
    replicateKey: ''
}, (data) => {
    toggle.classList.toggle('on', data.enabled);
    porcupineInput.value = data.porcupineKey;
    replicateInput.value = data.replicateKey;
});

// --- Toggle enabled/disabled ---
toggle.addEventListener('click', async () => {
    const wasOn = toggle.classList.contains('on');
    const enabled = !wasOn;
    toggle.classList.toggle('on', enabled);
    await chrome.storage.local.set({ enabled });

    // DESIGN: Notify the active tab so content.js can react immediately
    // (cleanup if disabled, or user can refresh to re-inject if enabled)
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'solveit-voice-toggle', enabled }).catch(() => {});
    }
});

// --- Save API keys on change (with debounce) ---
let saveTimer = null;
function saveKeys() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
        await chrome.storage.local.set({
            porcupineKey: porcupineInput.value.trim(),
            replicateKey: replicateInput.value.trim()
        });
        // DESIGN: Show brief confirmation so user knows keys were saved
        statusEl.style.display = 'block';
        setTimeout(() => { statusEl.style.display = 'none'; }, 1500);
    }, 500);
}

porcupineInput.addEventListener('input', saveKeys);
replicateInput.addEventListener('input', saveKeys);
