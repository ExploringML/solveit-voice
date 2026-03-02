import { CLR, btn, ttsStopBtn, setStatus, autoCb, toggleCb, ttsCb, ttsManualCb,
         ensureAudio, getAudioCtx, beep, ttsRate, ttsPitch, elevenLabsCb, openAiCb,
         openAiKeyInput, elevenKeyInput, openAiModel, openAiVoice, ttsProvider, ac,
         disable as uiDisable, enable as uiEnable, reinit as uiReinit } from './ui.js';

const ELEVEN_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'; // George
let enabled = true;
const getOpenAiKey = () => document.documentElement.dataset.solveitOpenAiKey || '';
const getElevenKey = () => document.documentElement.dataset.solveitElevenKey || '';

const getDname = () => document.documentElement.dataset.solveitDname;
if (!getDname()) throw new Error('No dname');

const DEBUG = false;
const log = (...args) => { if (DEBUG) console.log('[SV-Voice]', ...args); };
log('Init, dname:', getDname());

const CFG = {
    silenceMs: 1500, watchdogMs: 5000, restartMs: 300, retryMs: 1000,
    postSendMs: 1500, beepFreq: 880, beepDur: 200, confirmFreq: 660,
    confirmDur: 150, ttsRate: 1.0, ttsVoice: 'Google UK English Male',
};

// --- Speech Recognition ---
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) { setStatus('❌ Speech API not supported'); throw new Error('No SR'); }

const rec = new SR();
rec.continuous = true;
rec.interimResults = true;

let state = 'idle';
let transcript = '';        // Manual mode: full transcript
let commandTranscript = ''; // Continuous mode: text after wake word
let wakeResultIdx = 0;
let silenceTimer = null, startTimer = null;

function stopRec() { try { rec.stop(); } catch(e) {} }
function clearSilence() { if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; } }
function resetCmd() { commandTranscript = ''; wakeResultIdx = 0; clearSilence(); }

function startRec(delay = CFG.restartMs) {
    if (startTimer) clearTimeout(startTimer);
    startTimer = setTimeout(() => {
        startTimer = null;
        if (state !== 'listen' && state !== 'command') return;
        try { rec.start(); log('rec.start() OK'); }
        catch(e) {
            log('rec.start() failed:', e.message);
            startTimer = setTimeout(() => {
                startTimer = null;
                if (state !== 'listen' && state !== 'command') return;
                try { rec.start(); } catch(e2) { log('retry failed:', e2.message); }
            }, CFG.retryMs);
        }
    }, delay);
}

function go(s, delay = CFG.restartMs) {
    log('state:', state, '→', s);
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    state = s;
    if (s === 'listen') {
        resetCmd();
        if (toggleCb.checked) { btn.style.display = 'none'; setStatus('👂 Listening for "Solveit"...', CLR.info); }
        else { btn.textContent = '⏹'; setStatus('🟢 Listening...', CLR.ok); }
        startRec(delay);
    } else if (s === 'command') {
        beep(CFG.beepFreq, CFG.beepDur);
        setStatus('🟢 Speak your command...', CLR.ok);
    } else if (s === 'send' || s === 'speak') {
        stopRec();
        // Chrome bug: cancel() can interrupt a speak() called immediately after, so
        // we cancel here and delay the actual speak() by 50ms in tts.speak()
        if (s === 'speak') speechSynthesis.cancel();
    } else if (s === 'idle' || s === 'off') {
        stopRec(); resetCmd();
        btn.style.display = ''; btn.textContent = '🎤';
        setStatus('Click mic to start');
    }
}

// --- TTS ---
let preferredVoice = null;
speechSynthesis.getVoices();
speechSynthesis.onvoiceschanged = () => {
    const voices = speechSynthesis.getVoices();
    preferredVoice = voices.find(v => v.name.includes(CFG.ttsVoice));
    log('Voices loaded:', voices.length);
};

const ttsSkipTags = new Set(['PRE', 'DETAILS']);
const tts = {
    _poll: null, _safety: null, _uttSafety: null, _watchId: null,
    _clearWatch() {
        if (this._poll) { clearInterval(this._poll); this._poll = null; }
        if (this._safety) { clearTimeout(this._safety); this._safety = null; }
        this._watchId = null;
    },
    _extractProse(proseEl) {
        const tw = document.createTreeWalker(proseEl, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => {
                let p = n.parentElement;
                while (p && p !== proseEl) { if (ttsSkipTags.has(p.tagName) || p.classList.contains('cm-editor')) return NodeFilter.FILTER_REJECT; p = p.parentElement; }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let text = '';
        while (tw.nextNode()) text += tw.currentNode.textContent;
        return text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\x00-\x1f\x7f]/gu, '').trim().slice(0, 1000);
    },
    stop() {
        if (this._uttSafety) { clearTimeout(this._uttSafety); this._uttSafety = null; }
        if (this._elevenSrc) { try { this._elevenSrc.stop(); } catch(e) {} this._elevenSrc = null; }
        if (this._openAiAbort) { this._openAiAbort.abort(); this._openAiAbort = null; }
        if (this._openAiAudio) { this._openAiAudio.pause(); this._openAiAudio.src = ''; this._openAiAudio = null; }
        speechSynthesis.cancel();
        ttsStopBtn.style.display = 'none';
        if (toggleCb.checked) go('listen');
        else go('idle');
    },
    speak(text) {
        log('TTS speaking:', text.slice(0, 50));
        go('speak');
        ttsStopBtn.style.display = 'inline';
        if (this._uttSafety) clearTimeout(this._uttSafety);
        const safetyMs = Math.max(10000, text.length * 100 + 5000);
        this._uttSafety = setTimeout(() => { if (state === 'speak') { log('TTS safety timeout'); tts.stop(); } }, safetyMs);
        if (openAiCb.checked) {
            this._speakOpenAI(text);
        } else if (elevenLabsCb.checked) {
            this._speakElevenLabs(text);
        } else {
            this._speakBrowser(text);
        }
    },
    _speakBrowser(text) {
        setTimeout(() => {
            if (state !== 'speak') return;
            const utt = new SpeechSynthesisUtterance(text);
            if (preferredVoice) utt.voice = preferredVoice;
            utt.rate = ttsRate.value;
            utt.pitch = ttsPitch.value;
            utt.onend = () => tts.stop();
            utt.onerror = (e) => { log('TTS error:', e.error); tts.stop(); };
            speechSynthesis.speak(utt);
        }, 50);
    },
    async _speakOpenAI(text) {
        const abortCtrl = new AbortController();
        this._openAiAbort = abortCtrl;

        // Create audio element + MediaSource for streaming
        const ms = new MediaSource();
        const audio = new Audio(URL.createObjectURL(ms));
        this._openAiAudio = audio;

        ms.addEventListener('sourceopen', async () => {
            const sb = ms.addSourceBuffer('audio/mpeg');
            try {
                const res = await fetch('https://api.openai.com/v1/audio/speech', {
                    method: 'POST',
                    signal: abortCtrl.signal,
                    headers: { 'Authorization': `Bearer ${getOpenAiKey()}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: openAiModel.value, voice: openAiVoice.value, input: text, response_format: 'mp3' })
                });
                if (!res.ok) { log('OpenAI TTS error:', res.status); openAiKeyInput.classList.add('error'); tts.stop(); return; }
                if (state !== 'speak') return;

                const reader = res.body.getReader();
                const appendNext = async () => {
                    const { done, value } = await reader.read();
                    if (done) { if (ms.readyState === 'open') ms.endOfStream(); return; }
                    if (state !== 'speak') { reader.cancel(); return; }
                    sb.appendBuffer(value);
                };
                sb.addEventListener('updateend', () => appendNext().catch(e => { if (e.name !== 'AbortError') throw e; }));
                await appendNext();
            } catch(e) {
                if (e.name !== 'AbortError') { log('OpenAI TTS error:', e); tts.stop(); }
            }
        }, { once: true });

        audio.onended = () => tts.stop();
        audio.onerror = (e) => { log('OpenAI audio error:', e); tts.stop(); };
        audio.play().catch(e => { log('OpenAI play error:', e); tts.stop(); });
    },
    async _speakElevenLabs(text) {
        try {
            const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`, {
                method: 'POST',
                headers: { 'xi-api-key': getElevenKey(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' })
            });
            if (!res.ok) { log('ElevenLabs error:', res.status); elevenKeyInput.classList.add('error'); tts.stop(); return; }
            if (state !== 'speak') return;
            const buf = await res.arrayBuffer();
            ensureAudio();
            await getAudioCtx().resume();
            const decoded = await getAudioCtx().decodeAudioData(buf);
            const src = getAudioCtx().createBufferSource();
            src.buffer = decoded;
            src.connect(getAudioCtx().destination);
            src.onended = () => tts.stop();
            this._elevenSrc = src;
            src.start();
        } catch(e) { log('ElevenLabs error:', e); tts.stop(); }
    },
    watch(id) {
        if (this._watchId === id) return;
        this._clearWatch();
        this._watchId = id;
        let lastText = '', stableCount = 0;
        const sel = `#${id}-o`;
        this._poll = setInterval(() => {
            if (document.querySelector(`#${id} .animate-spin`)) { stableCount = 0; return; }
            const container = document.querySelector(sel);
            if (!container) return;
            const proseEl = container.querySelector('.prose');
            if (!proseEl) return;
            const text = this._extractProse(proseEl);
            log('TTS poll:', { len: text.length, stable: stableCount });
            if (text.length === 0) return;
            if (text === lastText) { if (++stableCount >= 3) { this._clearWatch(); this.speak(text); } }
            else { lastText = text; stableCount = 0; }
        }, 250);
        this._safety = setTimeout(() => this._clearWatch(), 120000);
    },
    cleanup() {
        this._clearWatch();
        if (this._uttSafety) { clearTimeout(this._uttSafety); this._uttSafety = null; }
        speechSynthesis.cancel();
        speechSynthesis.onvoiceschanged = null;
        ttsStopBtn.style.display = 'none';
    }
};
ttsStopBtn.onclick = () => tts.stop();

// --- Watchdog ---
const watchdog = setInterval(() => {
    if (state === 'off') { clearInterval(watchdog); return; }
    if (state === 'speak' && ttsProvider.value === 'browser' && !speechSynthesis.speaking && !speechSynthesis.pending) {
        log('Watchdog: TTS stuck'); tts.stop();
    }
    if (toggleCb.checked && state === 'idle') {
        log('Watchdog: restarting'); go('listen', 100);
    }
}, CFG.watchdogMs);

// --- Send ---
async function sendTranscript(text) {
    setStatus('📤 Sending: ' + text.slice(0, 40) + '...', CLR.warn);
    try {
        const body = new URLSearchParams({
            dlg_name: getDname(), content: (autoCb.checked ? '🎤 Voice [autorun]: ' : '🎤 Voice: ') + text,
            msg_type: 'prompt', placement: 'at_end', run_mode: 'run'
        });
        const resp = await fetch('/add_relative_', { method: 'POST', body });
        if (resp.ok) setStatus('✅ Sent!', CLR.ok);
        else setStatus('❌ Error: ' + resp.status, CLR.err);
    } catch(e) { setStatus('❌ ' + e.message, CLR.err); }
}

async function doSend(text) {
    go('send');
    try { await sendTranscript(text); }
    finally {
        if (state === 'off') return;
        if (toggleCb.checked) go('listen', CFG.postSendMs);
        else go('idle');
    }
}

// --- Wake word ---
const WAKE_RE = /(?:solveit|solve it|solvent|so late|salt wait)/gi;
function findWake(text) {
    let last = null;
    for (const m of text.matchAll(WAKE_RE)) last = m;
    return last ? { idx: last.index, len: last[0].length } : null;
}

function collectTranscript(results, start = 0) {
    let text = '';
    for (let i = start; i < results.length; i++) text += results[i][0].transcript;
    return text;
}

function resetSilenceTimer() {
    clearSilence();
    silenceTimer = setTimeout(async () => {
        silenceTimer = null;
        const text = commandTranscript.trim();
        if (state === 'command' && text) {
            resetCmd();
            beep(CFG.confirmFreq, CFG.confirmDur);
            await doSend(text);
        }
    }, CFG.silenceMs);
}

// --- Button handler ---
btn.onclick = async () => {
    ensureAudio();
    if (state === 'listen') {
        if (transcript.trim()) { const text = transcript; transcript = ''; await doSend(text); }
        else go('idle');
    } else if (state === 'idle') {
        transcript = '';
        go('listen', 0);
    }
};

// --- Recognition events ---
rec.onstart = () => { log('rec.onstart, state:', state); };

rec.onend = async () => {
    log('rec.onend, state:', state);
    if (state !== 'listen' && state !== 'command') return;
    if (toggleCb.checked) {
        if (state === 'command' && !silenceTimer) go('listen');
        else startRec(CFG.restartMs);
    } else {
        if (!transcript.trim()) { go('idle'); setStatus('No speech detected'); return; }
        const text = transcript; transcript = '';
        await doSend(text);
    }
};

rec.onerror = (e) => {
    log('error:', e.error);
    if (e.error === 'not-allowed') setStatus('❌ Mic permission denied', CLR.err);
    else if (e.error !== 'no-speech' && e.error !== 'aborted') setStatus('⚠️ ' + e.error, CLR.warn);
};

rec.onresult = (e) => {
    if (toggleCb.checked) {
        if (state === 'listen') {
            const latest = collectTranscript(e.results, e.resultIndex);
            const wake = findWake(latest);
            if (wake) {
                wakeResultIdx = e.resultIndex;
                commandTranscript = latest.slice(wake.idx + wake.len).trim();
                go('command');
                resetSilenceTimer();
            }
        } else if (state === 'command') {
            const text = collectTranscript(e.results, wakeResultIdx);
            const wake = findWake(text);
            if (wake) commandTranscript = text.slice(wake.idx + wake.len).trim();
            setStatus('🟢 ' + commandTranscript.slice(-40), CLR.ok);
            resetSilenceTimer();
        }
    } else {
        transcript = collectTranscript(e.results);
        setStatus('🟢 ' + transcript.slice(-40), CLR.ok);
    }
};

// --- Toggle handler ---
toggleCb.onchange = () => {
    ensureAudio();
    if (toggleCb.checked) go('listen', 100);
    else go('idle');
};
go('idle');

// --- Tab visibility ---
let wasListening = false;
document.addEventListener('visibilitychange', () => {
    if (!enabled) return;
    if (document.hidden) {
        wasListening = (state === 'listen' || state === 'command');
        if (wasListening) go('idle');
    } else {
        if (wasListening) go('listen', 100);
    }
}, { signal: ac.signal });

// --- WS listener for TTS ---
document.body.addEventListener('htmx:wsAfterMessage', (e) => {
    if (!enabled) return;
    const html = e.detail.message;
    if (!html.includes('beforeend:#dialog-container')) return;
    if (!html.includes('data-mtype="prompt"')) return;
    const isVoice = html.includes('🎤');
    if (isVoice && !ttsCb.checked) return;
    if (!isVoice && !ttsManualCb.checked) return;
    const idMatch = html.match(/id="(_[a-f0-9]+)"/);
    if (!idMatch) return;
    log('TTS check:', idMatch[1]);
    tts.watch(idMatch[1]);
}, { signal: ac.signal });

// --- Play buttons ---
const svgIcon = (href) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" height="16px" width="16px" class="lucide-icon"><use href="#lc-${href}"></use></svg>`;
let activePlayBtn = null;
let paused = false;
function setPlayBtn(btn, state) {
    if (!btn) return;
    btn.innerHTML = svgIcon(state === 'play' ? 'octagon-x' : 'circle-play');
    btn.title = state === 'play' ? 'Click pause, dbl-click stop' : 'Play response';
}
function addPlayBtn(msgEl) {
    const mtype = msgEl.dataset.mtype;
    if (mtype !== 'prompt' && mtype !== 'note') return;
    if (mtype === 'prompt' && msgEl.id.endsWith('-i')) return;
    const id = msgEl.id.replace(/-[io]$/, '');
    const btns = msgEl.querySelector(`[id^="btns_"]`);
    if (!btns || btns.querySelector('.sv-play')) return;
    const playBtn = document.createElement('button');
    playBtn.className = 'sv-play uk-btn text-muted-foreground uk-btn-ghost cursor-pointer p-1 h-fit';
    playBtn.title = 'Play response';
    playBtn.innerHTML = svgIcon('circle-play');
    playBtn.onclick = () => {
        if (activePlayBtn === playBtn) {
            if (paused) {
                speechSynthesis.resume();
                paused = false;
                setPlayBtn(playBtn, 'play');
            } else {
                speechSynthesis.pause();
                paused = true;
                setPlayBtn(playBtn, 'paused');
            }
        } else {
            // Stop any current playback
            if (activePlayBtn) { setPlayBtn(activePlayBtn, 'idle'); activePlayBtn = null; }
            tts.stop();
            const parentMsg = document.getElementById(id);
            const proseEl = mtype === 'prompt'
                ? parentMsg?.querySelector(`#${id}-o .prose`)
                : msgEl.querySelector('.prose');
            if (!proseEl) return;
            const text = tts._extractProse(proseEl);
            if (!text) return;
            activePlayBtn = playBtn;
            paused = false;
            setPlayBtn(playBtn, 'play');
            tts.speak(text);
        }
    };
    playBtn.ondblclick = (e) => {
        e.stopPropagation();
        paused = false;
        tts.stop();
        setPlayBtn(playBtn, 'idle');
        activePlayBtn = null;
    };
    const btnGroup = btns.querySelector('.flex.flex-row') || btns;
    btnGroup.prepend(playBtn);
}

// Patch tts.stop to also reset active play button
const _origStop = tts.stop.bind(tts);
tts.stop = () => {
    _origStop();
    if (activePlayBtn) { setPlayBtn(activePlayBtn, 'idle'); paused = false; activePlayBtn = null; }
};

// Inject into existing messages
document.querySelectorAll('#dialog-container [data-mtype]').forEach(addPlayBtn);

// Watch for new messages
const playBtnObserver = new MutationObserver(muts => {
    if (!enabled) return;
    for (const m of muts)
        for (const n of m.addedNodes)
            if (n.nodeType === 1) n.querySelectorAll?.('[data-mtype]').forEach(addPlayBtn);
});
playBtnObserver.observe(document.getElementById('dialog-container'), { childList: true });

// --- Enable / Disable ---
function voiceDisable() {
    enabled = false;
    go('off');
    tts.stop();
    uiDisable();
}

function voiceEnable() {
    enabled = true;
    uiEnable();
}

function voiceReinit() {
    uiReinit();
    const dc = document.getElementById('dialog-container');
    if (dc) {
        dc.querySelectorAll('[data-mtype]').forEach(addPlayBtn);
        playBtnObserver.observe(dc, { childList: true });
    }
}

window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type === 'solveit-voice-disable') voiceDisable();
    if (e.data?.type === 'solveit-voice-enable') voiceEnable();
    if (e.data?.type === 'solveit-voice-reinit') voiceReinit();
});
