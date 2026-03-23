// ═══════════════════════════════════════════════════════════════════════
// Voice Widget Module: Porcupine Wake Word — The Sentry
//
// DESIGN: Loads Picovoice's Porcupine engine from CDN, then loads
// the keyword (.ppn) and engine (.pv) model files bundled with
// the extension as web_accessible_resources.
//
// The Porcupine API key is read from chrome.storage via data-* attr.
// Model files are fetched as ArrayBuffer and converted to base64
// for Porcupine's create() API.
//
// FLOW: CDN scripts → fetch model files → base64 encode → init engine
// → subscribe to mic → detection callback triggers V.triggerWake()
// ═══════════════════════════════════════════════════════════════════════

if (!window.__voicePorcupineInit) {
window.__voicePorcupineInit = true;

(function() {
const V = window._voice;
if (!V) { console.error('[Porcupine] No voice widget'); return; }

const log = V.log;

// DESIGN: Read access key from data-* attribute set by content.js.
const getAccessKey = () => document.documentElement.dataset.solveitPorcupineKey || '';

const SCRIPTS = [
    'https://unpkg.com/@picovoice/porcupine-web@4.0.0/dist/iife/index.js',
    'https://unpkg.com/@picovoice/web-voice-processor@4.0.0/dist/iife/index.js'
];

async function loadScript(src) {
    return new Promise((resolve, reject) => {
        // DESIGN: Check if script already loaded to avoid duplicates
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

// DESIGN: Convert ArrayBuffer to base64 string for Porcupine API.
// Porcupine's create() accepts model data as { base64: '...' }.
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

async function startPorcupine() {
    const accessKey = getAccessKey();
    if (!accessKey) {
        log('No Porcupine key — set it in extension popup. Skipping init.');
        return;
    }

    // Load CDN scripts
    for (const src of SCRIPTS) {
        log('Loading:', src);
        await loadScript(src);
    }
    log('CDN scripts loaded');

    // DESIGN: Fetch model files from extension bundle via chrome.runtime.getURL.
    // These are listed in web_accessible_resources so the page can fetch them.
    // We use the extension's own URL scheme to get absolute paths.
    const ppnUrl = document.querySelector('script[data-solveit-voice]')?.src?.replace(/[^/]+$/, '') || '';
    
    // Try to construct the extension base URL from any loaded script
    let extBase = '';
    const svScripts = document.querySelectorAll('script[data-solveit-voice]');
    if (svScripts.length > 0) {
        extBase = svScripts[0].src.replace(/[^/]+$/, '');
    }

    if (!extBase) {
        log('Cannot determine extension base URL, skipping Porcupine');
        return;
    }

    log('Fetching model files from:', extBase);
    const [ppnResp, pvResp] = await Promise.all([
        fetch(extBase + 'solvent_en_wasm_v4_0_0.ppn'),
        fetch(extBase + 'porcupine_params.pv')
    ]);

    if (!ppnResp.ok || !pvResp.ok) {
        log('Failed to fetch model files:', ppnResp.status, pvResp.status);
        return;
    }

    const ppnB64 = arrayBufferToBase64(await ppnResp.arrayBuffer());
    const pvB64 = arrayBufferToBase64(await pvResp.arrayBuffer());
    log('Keyword model:', ppnB64.length, 'chars. Engine model:', pvB64.length, 'chars');

    const keywordModel = { base64: ppnB64, label: 'solvent', sensitivity: 0.7 };
    const porcupineModel = { base64: pvB64 };

    // Init Porcupine engine
    const porcupine = await PorcupineWeb.PorcupineWorker.create(
        accessKey,
        [keywordModel],
        (detection) => {
            log('🔔 DETECTED:', detection.label);
            if (V && V.triggerWake) V.triggerWake();
        },
        porcupineModel
    );
    log('✅ Engine ready (mic OFF — toggle 🦔 to start)');

    // --- Mic control: subscribe/unsubscribe ---
    const WVP = window.WebVoiceProcessor.WebVoiceProcessor;

    V.porcupineSubscribe = async () => {
        await WVP.subscribe(porcupine);
        log('🎤 Mic subscribed');
    };
    V.porcupineUnsubscribe = async () => {
        await WVP.unsubscribe(porcupine);
        log('🔇 Mic unsubscribed');
    };

    window._porcupineEngine = porcupine;
}

startPorcupine().catch(e => log('Error:', e.message));
})();

}
