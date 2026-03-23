// ═══════════════════════════════════════════════════════════════
// SolveIt Voice — Content Script Loader
//
// DESIGN: Inject voice modules into the page's MAIN world in order.
// Each module attaches to window._voice (the shared bridge).
// Follows the minimap extension pattern: content.js loads scripts,
// scripts self-heal via watchdog and AbortController cleanup.
//
// API KEYS: Read from chrome.storage, passed to page via data-*
// attributes on <html>. Scripts read keys at call-time via getters.
// ═══════════════════════════════════════════════════════════════

(async function () {
  const log = (...args) => console.log('[sv-loader]', ...args);

  log('content script running, url:', location.href);

  // Only inject on dialog pages — skip dashboard, terminal, folder views
  // DESIGN: Dialog pages have /dialog_ in the path. Other pages
  // (dashboard, terminal) don't need voice control.
  if (!location.pathname.startsWith('/dialog_')) {
    log('not a dialog page, skipping voice injection');
    return;
  }

  const alive = () => !!chrome.runtime?.id;

  function loadScript(path) {
    return new Promise((resolve, reject) => {
      if (!alive()) return reject(new Error('extension context invalidated'));
      const s = document.createElement('script');
      // DESIGN: Load from extension's own files via chrome.runtime.getURL.
      // This gives a chrome-extension:// URL that the page can access
      // because these files are listed in web_accessible_resources.
      s.src = chrome.runtime.getURL(path);
      s.dataset.solveitVoice = '1';
      // DESIGN: MAIN world injection — script runs in the page's JS context,
      // not the extension's isolated content script world. This is required
      // because we need access to page globals (debounceScroll, htmx events).
      s.onload = () => { log('loaded:', path); resolve(); };
      s.onerror = () => reject(new Error('failed to load ' + path));
      document.head.appendChild(s);
    });
  }

  // Pass API keys from chrome.storage to page via data-* attributes.
  // DESIGN: Scripts can't access chrome.storage from MAIN world,
  // so we bridge the gap through DOM data attributes on <html>.
  // Scripts read these at call-time: document.documentElement.dataset.solveitXxxKey
  const keys = await chrome.storage.local.get({
    porcupineKey: '',
    replicateKey: '',
    enabled: true
  });

  if (!keys.enabled) {
    log('extension disabled via popup, skipping');
    return;
  }

  // DESIGN: Extract dialog name from URL query param or hidden input.
  // widget.js reads this via getDname() for HTTP POST to /add_relative_.
  const dname = new URLSearchParams(location.search).get('name')
      || document.getElementById('dlg_name')?.value;
  if (!dname) { log('no dname found, skipping injection'); return; }
  document.documentElement.dataset.solveitDname = dname;

  document.documentElement.dataset.solveitPorcupineKey = keys.porcupineKey || '';
  document.documentElement.dataset.solveitReplicateKey = keys.replicateKey || '';

  // Listen for key updates from popup (while page is open)
  // DESIGN: When user changes keys in popup.html, popup.js sends
  // a message to this content script, which updates the data-* attrs.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.porcupineKey) {
      document.documentElement.dataset.solveitPorcupineKey = changes.porcupineKey.newValue || '';
    }
    if (changes.replicateKey) {
      document.documentElement.dataset.solveitReplicateKey = changes.replicateKey.newValue || '';
    }
    if (changes.enabled && !changes.enabled.newValue) {
      log('extension disabled, cleaning up');
      if (window._voiceCleanup) window._voiceCleanup();
    }
  });

  // --- Bridge: MAIN world → content script → background service worker ---
  // DESIGN: Scripts in MAIN world can't call chrome.runtime.sendMessage().
  // So kokoro.js posts a window message, content.js catches it here,
  // forwards to background.js, and posts the response back.
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.type !== 'replicate-fetch') return;
    const { url, method, headers, body, requestId } = e.data;
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'replicate-fetch', url, method, headers, body
      });
      window.postMessage({ type: 'replicate-fetch-response', requestId, ...resp }, '*');
    } catch (err) {
      window.postMessage({ type: 'replicate-fetch-response', requestId, ok: false, error: err.message }, '*');
    }
  });

  // --- Bridge: Gist API (same pattern as Replicate bridge above) ---
  // DESIGN: widget.js posts gist-fetch, content.js forwards to background.js,
  // background.js proxies the GitHub API call, response flows back.
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.type !== 'gist-fetch') return;
    const { url, method, headers, body, requestId } = e.data;
    try {
      const resp = await chrome.runtime.sendMessage({
        type: 'gist-fetch', url, method, headers, body
      });
      window.postMessage({ type: 'gist-fetch-response', requestId, ...resp }, '*');
    } catch (err) {
      window.postMessage({ type: 'gist-fetch-response', requestId, ok: false, error: err.message }, '*');
    }
  });

  // Guard: don't double-inject if scripts already loaded
  if (document.querySelector('script[data-solveit-voice]')) {
    log('scripts already loaded, skipping');
    return;
  }

  // DESIGN: Load scripts in strict order — each module depends on
  // the previous one having attached its exports to window._voice.
  // widget.js creates V = window._voice, all others read from it.
  const modules = [
    'widget.js',          // Main widget DOM + SpeechRecognition + beeps
    'state-machine.js',   // 5-state machine (idle/listen/command/send/manual)
    'send.js',            // HTTP POST to /add_relative_
    'tts.js',             // Browser TTS + response watcher
    'kokoro.js',          // Kokoro TTS via Replicate API (browser-side)
    'porcupine.js',       // Porcupine wake word detection
    'save-toggle.js',     // TTS audio bookmark (localStorage)
    'draggable.js',       // Drag widget around screen
    'visibility.js',      // Pause/resume on tab switch
  ];

  try {
    for (const mod of modules) await loadScript(mod);
    log('all modules loaded');
  } catch (e) {
    log('module load error:', e.message);
  }
})();
