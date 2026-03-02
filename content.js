(async function() {
    const DEBUG = true;
    const log = (...args) => DEBUG && console.log('[SolveIt Voice]', ...args);

    log('content script running, url:', location.href);

    if (!document.getElementById('dialog-container')) {
        log('dialog-container not found, retrying in 1s...');
        await new Promise(r => setTimeout(r, 1000));
        if (!document.getElementById('dialog-container')) {
            console.warn('[SolveIt Voice] dialog-container not found after retry, extension not loaded.');
            return;
        }
        log('dialog-container found on retry');
    } else {
        log('dialog-container found immediately');
    }

    const dname = new URLSearchParams(window.location.search).get('name')
        || document.getElementById('dlg_name')?.value;
    log('dname:', dname);
    if (!dname) { log('no dname, aborting'); return; }

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
        const { openAiKey = '', elevenKey = '' } = await chrome.storage.local.get(['openAiKey', 'elevenKey']);
        document.documentElement.dataset.solveitDname = dname;
        document.documentElement.dataset.solveitOpenAiKey = openAiKey || '';
        document.documentElement.dataset.solveitElevenKey = elevenKey || '';
        const s = document.createElement('script');
        s.type = 'module';
        s.dataset.solveitVoice = '1';
        s.src = chrome.runtime.getURL('voice.js');
        document.head.appendChild(s);
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

    // Check initial state
    const { enabled = true } = await chrome.storage.local.get('enabled');
    if (enabled) inject();
})();
