// ═══════════════════════════════════════════════════════════════════════
// Voice Widget Module: State Machine — The Traffic Controller
//
// DESIGN: Replace scattered boolean flags with a single `state` variable
// and a `go()` function that logs all transitions. Phase 1 = observation.
//
// Five states: idle | listen | command | send | manual
// ═══════════════════════════════════════════════════════════════════════

if (!window.__voiceStateMachineInit) {
window.__voiceStateMachineInit = true;

(function() {
const V = window._voice;
if (!V) { console.error('[State] No voice widget found'); return; }
if (V._stateCleanup) V._stateCleanup();

const log = V.log;
const STATES = new Set(['idle', 'listen', 'command', 'send', 'manual']);
V.STATES = STATES;

let state = 'idle';
V.state = state;

function go(newState, reason = '') {
    if (!STATES.has(newState)) { log('❌ Invalid state:', newState); return state; }
    const prev = state;
    state = newState;
    V.state = state;
    const reasonStr = reason ? ' (' + reason + ')' : '';
    log('🔄 ' + prev + ' → ' + state + reasonStr);
    return state;
}

V.go = go;

V._stateCleanup = () => {
    delete V.state; delete V.go; delete V.STATES; delete V._stateCleanup;
    window.__voiceStateMachineInit = false;
    log('[State] Cleaned up');
};

log('✅ State machine loaded (Phase 1). State:', state);
})();

}
