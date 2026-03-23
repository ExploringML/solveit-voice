// ═══════════════════════════════════════════════════════════════════════
// Voice Widget Module: Page Visibility — The Tab Bouncer
//
// DESIGN: When multiple tabs have voice control, they fight over:
//   1. Chrome's SpeechRecognition (one global session)
//   2. Porcupine mic (same physical mic, duplicate detections)
//   3. speechSynthesis (one global audio queue)
//
// This module pauses all pipelines when tab goes to background,
// resumes when tab comes back. Only the active tab uses the mic.
// ═══════════════════════════════════════════════════════════════════════

if (!window.__voiceVisibilityInit) {
window.__voiceVisibilityInit = true;

(function() {
const V = window._voice;
if (!V) { console.error('[Visibility] No voice widget found'); return; }
if (V._visCleanup) V._visCleanup();

const log = V.log;
const ac = new AbortController();
const sig = { signal: ac.signal };

V._tabHidden = false;

// --- pauseAll: 9-step shutdown sequence ---
function pauseAll() {
    V._tabHidden = true;
    log('⏸️ Tab hidden — pausing all pipelines');

    if (V.go) V.go('idle', 'tab hidden — pausing all pipelines');

    try { V.rec.stop(); log('⏸️ rec.stop() OK'); }
    catch(e) { log('⏸️ rec.stop() already stopped:', e.message); }

    if (V.porcupineCb && V.porcupineCb.checked) {
        V.porcupineUnsubscribe?.();
        log('⏸️ Porcupine unsubscribed');
    }

    V.clearTtsWatch?.();
    V.clearKokoroWatch?.();
    log('⏸️ TTS watchers cleared');

    speechSynthesis.cancel();
    V.speaking = false;
    V.ttsStopBtn.style.display = 'none';

    const kokoroAudio = document.querySelector('#kokoro-audio-container audio');
    if (kokoroAudio && !kokoroAudio.paused) kokoroAudio.pause();

    V.resetWakeState?.();
    V.setStatus('💤 Paused — tab hidden', V.CLR.muted);
}

// --- resumeAll: restart based on toggle states ---
function resumeAll() {
    V._tabHidden = false;
    log('▶️ Tab visible — resuming');

    const continuous = V.toggleCb && V.toggleCb.checked;

    if (continuous) {
        V.safeStart(300);

        if (V.porcupineCb && V.porcupineCb.checked) {
            V.porcupineSubscribe?.();
            log('▶️ Porcupine resubscribed');
        }

        if (V.go) V.go('listen', 'tab visible — resumed');
        const msg = (V.porcupineCb && V.porcupineCb.checked) ? '🦔 Say "solvent"' : '👂 Listening for "Solveit"...';
        V.setStatus(msg, V.CLR.info);
    } else {
        if (V.go) V.go('idle', 'tab visible — manual mode');
        V.setStatus('Click mic to start', V.CLR.muted);
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.group('[Visibility] ⏸️ Tab hidden');
        pauseAll();
        console.groupEnd();
    } else {
        console.group('[Visibility] ▶️ Tab visible');
        resumeAll();
        console.groupEnd();
    }
}, sig);

V._visCleanup = () => {
    ac.abort();
    V._tabHidden = false;
    delete V._visCleanup;
    window.__voiceVisibilityInit = false;
    log('[Visibility] Cleaned up');
};

log('✅ Page Visibility module loaded');
})();

}
