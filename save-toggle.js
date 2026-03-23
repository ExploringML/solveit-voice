// ═══════════════════════════════════════════════════════════════════════
// Voice Widget Module: Save Toggle — The Bookmark
//
// DESIGN: Adds a ☆/★ button next to the ▶ play button. Clicking it
// saves/unsaves the current Kokoro audio hash in localStorage.
//
// In the curation dialog version, this also called Python to persist
// the hash to saved.json. In the Chrome extension, we use localStorage
// only — no Python backend needed for bookmarking.
// ═══════════════════════════════════════════════════════════════════════

if (!window.__voiceSaveToggleInit) {
window.__voiceSaveToggleInit = true;

(function() {
const V = window._voice;
if (!V) { console.error('[SaveToggle] No voice widget'); return; }
if (window._saveToggleCleanup) window._saveToggleCleanup();

const LS_KEY = 'tts_saved_hashes';

function getSaved() {
    try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); }
    catch(e) { return new Set(); }
}
function toggleSaved(h) {
    const saved = getSaved();
    const nowSaved = !saved.has(h);
    if (nowSaved) saved.add(h); else saved.delete(h);
    localStorage.setItem(LS_KEY, JSON.stringify([...saved]));
    return nowSaved;
}

// --- Bookmark button ---
const bookmarkBtn = document.createElement('button');
bookmarkBtn.style.cssText = 'display:none;font-size:1.1em;border:none;border-radius:8px;padding:4px 8px;cursor:pointer;margin-left:2px;transition:all 0.2s';
let currentHash = null;

function renderBookmark() {
    if (!currentHash) { bookmarkBtn.style.display = 'none'; return; }
    const saved = getSaved().has(currentHash);
    bookmarkBtn.textContent = saved ? '★' : '☆';
    bookmarkBtn.style.display = 'inline';
    bookmarkBtn.style.background = saved ? 'rgba(255,220,100,0.3)' : 'rgba(255,255,255,0.08)';
    bookmarkBtn.style.color = saved ? '#ffd93d' : '#888';
    bookmarkBtn.title = saved ? 'Saved — click to unsave' : 'Click to save this audio';
}

bookmarkBtn.onclick = () => { if (!currentHash) return; toggleSaved(currentHash); renderBookmark(); };

// Insert after play button in voice widget
const widget = document.getElementById('voice-widget');
if (widget) {
    const playBtn = [...widget.querySelectorAll('button')].find(b => b.textContent === '▶');
    if (playBtn) playBtn.after(bookmarkBtn);
    else widget.querySelector('.v-status')?.before(bookmarkBtn);
}

// Watch audio src changes to detect Kokoro hash
const audioEl = document.querySelector('#kokoro-audio-container audio');
if (audioEl) {
    const obs = new MutationObserver(() => {
        const src = audioEl.getAttribute('src') || '';
        // DESIGN: Kokoro audio URLs contain the hash in the filename
        // Works for both local cache URLs and Replicate URLs
        const m = src.match(/kokoro[_-]([a-f0-9]{12})/) || src.match(/([a-f0-9]{12})\.wav/);
        currentHash = m ? m[1] : null;
        renderBookmark();
    });
    obs.observe(audioEl, { attributes: true, attributeFilter: ['src'] });
    window._saveToggleCleanup = () => {
        obs.disconnect(); bookmarkBtn.remove();
        window.__voiceSaveToggleInit = false;
    };
}

V.log('[SaveToggle] ✅ ready — ☆/★ next to ▶');
})();

}
