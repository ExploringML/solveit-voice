(async function() {
    const DEBUG = true;
    const log = (...args) => DEBUG && console.log('[SolveIt Voice]', ...args);

    log('content script running, url:', location.href);

    // Listen for key updates from the page and save to storage
    window.addEventListener('message', (e) => {
        if (e.source !== window || e.data?.type !== 'solveit-save-key') return;
        const { key, value } = e.data;
        chrome.storage.local.set({ [key]: value });
        document.documentElement.dataset[key === 'openAiKey' ? 'solveitOpenAiKey' : 'solveitElevenKey'] = value;
    });

    async function inject() {
        log('inject() called');
        if (document.querySelector('script[data-solveit-voice]')) { log('script already loaded, skipping'); return; }
        const dname = new URLSearchParams(window.location.search).get('name')
            || document.getElementById('dlg_name')?.value;
        if (!dname) { log('no dname, skipping'); return; }
        const { openAiKey = '', elevenKey = '' } = await chrome.storage.local.get(['openAiKey', 'elevenKey']);
        document.documentElement.dataset.solveitDname = dname;
        document.documentElement.dataset.solveitOpenAiKey = openAiKey || '';
        document.documentElement.dataset.solveitElevenKey = elevenKey || '';
        const s = document.createElement('script');
        s.type = 'module';
        s.dataset.solveitVoice = '1';
        s.src = chrome.runtime.getURL('voice.js');
        document.head.appendChild(s);
        log('voice.js injected');
    }

    async function tryInit() {
        if (!document.getElementById('dialog-container')) { log('no dialog-container'); return; }
        const { enabled = true } = await chrome.storage.local.get('enabled');
        if (enabled) inject();
    }

    // Listen for toggle messages from popup
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type !== 'solveit-voice-toggle') return;
        if (msg.enabled) {
            if (!document.querySelector('script[data-solveit-voice]')) inject();
            else window.postMessage({ type: 'solveit-voice-enable' }, '*');
        } else {
            window.postMessage({ type: 'solveit-voice-disable' }, '*');
        }
    });

    // Try now, and also after any HTMX navigation
    await tryInit();
    document.body.addEventListener('htmx:afterSettle', () => {
        log('htmx:afterSettle fired');
        tryInit();
    });
})();
