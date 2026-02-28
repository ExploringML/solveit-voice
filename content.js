(async function() {
    if (!document.getElementById('dialog-container')) return;

    const dname = new URLSearchParams(window.location.search).get('name')
        || document.getElementById('dlg_name')?.value;
    if (!dname) return;

    const { openAiKey = '', elevenKey = '' } = await chrome.storage.local.get(['openAiKey', 'elevenKey']);
    document.documentElement.dataset.solveitDname = dname;
    document.documentElement.dataset.solveitOpenAiKey = openAiKey;
    document.documentElement.dataset.solveitElevenKey = elevenKey;

    // Listen for key updates from the page and save to storage
    window.addEventListener('message', (e) => {
        if (e.source !== window || e.data?.type !== 'solveit-save-key') return;
        const { key, value } = e.data;
        chrome.storage.local.set({ [key]: value });
        document.documentElement.dataset[key === 'openAiKey' ? 'solveitOpenAiKey' : 'solveitElevenKey'] = value;
    });

    const s = document.createElement('script');
    s.type = 'module';
    s.src = chrome.runtime.getURL('voice.js');
    document.head.appendChild(s);
})();
