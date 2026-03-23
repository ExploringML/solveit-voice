// ═══════════════════════════════════════════════════════════════════════
// Voice Widget Module: Browser TTS — The Voice
//
// DESIGN: Watches for AI prompt responses via htmx:wsAfterMessage,
// extracts prose text (skipping code blocks), and speaks it using
// the browser's built-in speechSynthesis API.
//
// This is the DEFAULT TTS. When Kokoro is enabled (kokoro.js),
// it intercepts speechSynthesis.speak() and uses Replicate instead.
// ═══════════════════════════════════════════════════════════════════════

if (!window.__voiceTtsInit) {
window.__voiceTtsInit = true;

(function() {
const V = window._voice;
if (!V) { console.error('[TTS] No voice widget'); return; }

const log = V.log;

// --- Text extraction: skip code blocks and details sections ---
const ttsSkipTags = new Set(['PRE', 'CODE', 'DETAILS']);

function extractProseText(proseEl) {
    const tw = document.createTreeWalker(proseEl, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => {
            let p = n.parentElement;
            while (p && p !== proseEl) {
                if (ttsSkipTags.has(p.tagName) || p.classList.contains('cm-editor')) return NodeFilter.FILTER_REJECT;
                p = p.parentElement;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    let text = '';
    while (tw.nextNode()) text += tw.currentNode.textContent;
    return text.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 10000);
}
// Expose for kokoro.js and save-toggle.js
V._extractProseText = extractProseText;

function speakText(text) {
    // Guard: don't talk over user's command or from hidden tab
    if (V.isWakeActive && V.isWakeActive()) { log('TTS suppressed: wake active'); return; }
    if (V._tabHidden) { log('TTS suppressed: tab hidden'); return; }
    log('TTS speaking:', text.slice(0, 50));
    V.speaking = true;
    if (V.resetWakeState) V.resetWakeState();
    speechSynthesis.cancel();
    // DESIGN: Slight delay after cancel() — Chrome bug where cancel()
    // interrupts a speak() called immediately after.
    setTimeout(() => {
        if (!V.speaking) return;
        const utt = new SpeechSynthesisUtterance(text);
        const voices = speechSynthesis.getVoices();
        const preferred = voices.find(v => v.name.includes(V.CFG.ttsVoice));
        if (preferred) utt.voice = preferred;
        utt.rate = V.CFG.ttsRate;
        utt.onend = () => V.ttsEnd();
        utt.onerror = (e) => { log('TTS error:', e.error); V.ttsEnd(); };
        V.ttsStopBtn.style.display = 'inline';
        if (V._ttsSafety) clearTimeout(V._ttsSafety);
        const safetyMs = Math.max(10000, text.length * 100 + 5000);
        V._ttsSafety = setTimeout(() => { if (V.speaking) { log('TTS safety timeout'); V.ttsEnd(); } }, safetyMs);
        speechSynthesis.speak(utt);
    }, 50);
}
V._speakText = speakText;

// --- Poll-based response watcher ---
function watchForResponse(id) {
    V.clearTtsWatch();
    let lastText = '';
    let stableCount = 0;
    let stableThreshold = 12;  // 6s default, upgrades to 10s for tool calls
    const containerSel = `#${id}-o`;

    const poll = setInterval(() => {
        const container = document.querySelector(containerSel);
        if (!container) return;
        const proseEl = container.querySelector('.prose');
        if (!proseEl) return;
        if (stableThreshold < 20 && proseEl.querySelector('details')) stableThreshold = 20;
        const text = extractProseText(proseEl);
        log('TTS poll:', { len: text.length, stable: stableCount, threshold: stableThreshold });
        if (text.length === 0) return;
        if (text === lastText) {
            if (++stableCount >= stableThreshold) {
                V.clearTtsWatch();
                speakText(text);
            }
        } else { lastText = text; stableCount = 0; }
    }, 500);
    V._setTtsPoll(poll);
    V._setTtsSafety(setTimeout(() => V.clearTtsWatch(), 300000));
}

// --- Listen for prompt responses via htmx WebSocket messages ---
const wsListener = (e) => {
    if (!V.userActive) return;
    if (V._tabHidden) { log('TTS watcher blocked: tab hidden'); return; }
    const html = e.detail.message;
    if (!html.includes('data-mtype="prompt"')) return;
    const isVoice = html.includes('🎤');
    if (isVoice && !V.ttsCb.checked) return;
    if (!isVoice && !V.ttsManualCb.checked) return;
    const idMatch = html.match(/id="(_[a-f0-9]+)"/);
    if (!idMatch) return;
    log('TTS check:', idMatch[1]);
    watchForResponse(idMatch[1]);
};
document.body.addEventListener('htmx:wsAfterMessage', wsListener, { signal: V.widget._voiceAc?.signal });

// Cleanup is handled by V.clearTtsWatch and main widget cleanup
log('✅ Browser TTS module loaded');
})();

}
