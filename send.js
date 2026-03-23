// ═══════════════════════════════════════════════════════════════════════
// Voice Widget Module: Send & Restart — The Messenger
//
// DESIGN: Package voice commands as HTTP POST to /add_relative_,
// then handle post-send state transitions (back to listen or idle).
// ═══════════════════════════════════════════════════════════════════════

if (!window.__voiceSendInit) {
window.__voiceSendInit = true;

(function() {
const V = window._voice;
if (!V) { console.error('[Send] No voice widget'); return; }
if (V._sendCleanup) V._sendCleanup();

const log = V.log;

// DESIGN: Core send function used by both voice and preset paths.
// Reads V.sendMode to determine msg_type and whether to auto-run.
async function sendTranscript(text, mode) {
    mode = mode || V.sendMode || 'prompt_run';
    V.setStatus('📤 Sending: ' + text.slice(0, 40) + '...', V.CLR.warn);
    try {
        const msgType = (mode === 'note') ? 'note' : 'prompt';
        const params = {
            dlg_name: V.getDname(),
            content: text,
            msg_type: msgType,
            placement: V.anchorId ? 'add_before' : 'at_end',
        };
        // DESIGN: Only prompt_run auto-runs. prompt and note don't.
        if (mode === 'prompt_run') params.run = 'true';
        if (V.anchorId) params.id_ = V.anchorId;

        const body = new URLSearchParams(params);
        const resp = await fetch('/add_relative_', { method: 'POST', body });

        if (resp.ok) V.setStatus('✅ Sent!', V.CLR.ok);
        else V.setStatus('❌ Error: ' + resp.status, V.CLR.err);
    } catch(e) {
        V.setStatus('❌ ' + e.message, V.CLR.err);
    }
}

// DESIGN: sendPreset is called by the send button for preset prompts.
// Voice path still uses sendAndRestart() which adds the 🎤 prefix.
async function sendPreset(text, mode) {
    log('sendPreset:', text.slice(0, 40), 'mode:', mode);
    await sendTranscript(text, mode);
}

async function sendAndRestart(text) {
    // DESIGN: Voice path adds 🎤 prefix to distinguish voice from preset prompts
    const prefixed = (V.autoCb.checked ? '🎤 Voice [autorun]: ' : '🎤 Voice: ') + text;
    try { await sendTranscript(prefixed, 'prompt_run'); }
    catch(e) { log('Send error:', e); V.setStatus('❌ ' + e.message, V.CLR.err); }
    finally {
        if (V.toggleCb.checked && !V.destroyed) {
            V.safeStart(V.CFG.postSendMs);
            V.go('listen', 'send complete, back to listening');
        } else {
            V.resetUI();
            V.go('idle', 'send complete, no continuous');
        }
    }
}

V.sendTranscript = sendTranscript;
V.sendAndRestart = sendAndRestart;
V.sendPreset = sendPreset;

V._sendCleanup = () => {
    delete V.sendTranscript; delete V.sendAndRestart; delete V._sendCleanup;
    window.__voiceSendInit = false;
    log('[Send] Cleaned up');
};

log('✅ Send & Restart module loaded');
})();

}
