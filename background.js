// ═══════════════════════════════════════════════════════════════════════
// SolveIt Voice — Background Service Worker
//
// DESIGN: Proxy for Replicate API calls. Browser CORS blocks fetch()
// from page context to api.replicate.com. The background service worker
// isn't subject to CORS — it acts as a trusted middleman.
//
// FLOW: kokoro.js → chrome.runtime.sendMessage → background.js → fetch
// → response back to kokoro.js
// ═══════════════════════════════════════════════════════════════════════

// DESIGN: Generic async fetch proxy. Both Replicate and GitHub API calls
// route through here — content scripts can't fetch cross-origin directly.
function proxyFetch(msg, sendResponse) {
  (async () => {
    try {
      const resp = await fetch(msg.url, {
        method: msg.method || 'GET',
        headers: msg.headers || {},
        body: msg.body || undefined
      });
      const data = await resp.json();
      sendResponse({ ok: resp.ok, status: resp.status, data });
    } catch (e) {
      sendResponse({ ok: false, status: 0, error: e.message });
    }
  })();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'replicate-fetch' || msg.type === 'gist-fetch') {
    proxyFetch(msg, sendResponse);
    // DESIGN: return true = "I will call sendResponse asynchronously"
    return true;
  }
  return false;
});
