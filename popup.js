const toggle = document.getElementById('toggle');

chrome.storage.local.get({ enabled: true }, ({ enabled }) => {
    toggle.classList.toggle('on', enabled);
});

toggle.addEventListener('click', async () => {
    const wasOn = toggle.classList.contains('on');
    const enabled = !wasOn;
    toggle.classList.toggle('on', enabled);
    await chrome.storage.local.set({ enabled });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'solveit-voice-toggle', enabled });
    }
});
