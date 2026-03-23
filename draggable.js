// ═══════════════════════════════════════════════════════════════════════
// Voice Widget Module: Draggable — The Position Controller
//
// DESIGN: Three-event drag pattern (mousedown → mousemove → mouseup).
// mousemove/mouseup on document (not widget) to catch fast mouse movement.
// Skips drag when clicking buttons or spans (interactive controls).
// Uses AbortController for one-shot cleanup of all listeners.
// ═══════════════════════════════════════════════════════════════════════

if (!window.__voiceDraggableInit) {
window.__voiceDraggableInit = true;

(function() {
const V = window._voice;
if (!V || !V.widget) { console.error('[Drag] No voice widget found'); return; }
if (V._dragCleanup) V._dragCleanup();

const log = V.log;
const widget = V.widget;
const ac = new AbortController();
const sig = { signal: ac.signal };

let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

// EVENT 1: mousedown — record grab offset, skip buttons/spans
widget.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SPAN') return;
    isDragging = true;
    const rect = widget.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    widget.style.cursor = 'grabbing';
}, sig);

// EVENT 2: mousemove — move widget, switch from right/bottom to left/top
document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    widget.style.left = (e.clientX - dragOffsetX) + 'px';
    widget.style.top = (e.clientY - dragOffsetY) + 'px';
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
}, sig);

// EVENT 3: mouseup — end drag
document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    widget.style.cursor = 'grab';
}, sig);

V._dragCleanup = () => {
    ac.abort();
    window.__voiceDraggableInit = false;
    log('[Drag] Cleaned up');
};

log('[Drag] ✅ Draggable module loaded');
})();

}
