let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let gainNode: GainNode | null = null;
let source: MediaElementAudioSourceNode | null = null;
let attachedEl: HTMLAudioElement | null = null;
let working = false;
let unlockScheduled = false;

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor();
    ctx.onstatechange = () => {
      if (ctx?.state === 'running') connectOutput();
    };
  }
  return ctx;
}

function unlock() {
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

function scheduleUnlock() {
  if (unlockScheduled) return;
  unlockScheduled = true;
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function connectOutput() {
  const c = ctx;
  if (!c || !source) return;
  if (!gainNode) {
    gainNode = c.createGain();
    gainNode.gain.value = 1;
  }
  try {
    source.connect(gainNode);
    gainNode.connect(c.destination);
  } catch {
    /* ignore */
  }
}

function attachSource(c: AudioContext, el: HTMLAudioElement): boolean {
  if (working) return true;
  try {
    source = c.createMediaElementSource(el);
    source.connect(analyser);
    working = true;
    connectOutput();
    return true;
  } catch {
    working = false;
    return false;
  }
}

export function getAnalyserFor(el: HTMLAudioElement | null): AnalyserNode | null {
  const c = ensureCtx();
  if (!c || !el) return null;
  if (!analyser) {
    analyser = c.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
  }
  if (el !== attachedEl) {
    try {
      source?.disconnect();
    } catch {
      /* ignore */
    }
    source = null;
    attachedEl = el;
    working = false;
  }
  if (c.state === 'running') attachSource(c, el);
  scheduleUnlock();
  return working ? analyser : null;
}

let sharedFreq: Uint8Array | null = null;

// Frequency snapshot for the currently attached audio element (shared buffer
// so LiveBars and Waveform never allocate per frame). Null when the graph is
// not live.
export function sampleLevels(el: HTMLAudioElement | null): Uint8Array | null {
  const a = getAnalyserFor(el);
  if (!a) return null;
  if (!sharedFreq || sharedFreq.length !== a.frequencyBinCount) {
    sharedFreq = new Uint8Array(a.frequencyBinCount);
  }
  a.getByteFrequencyData(sharedFreq);
  return sharedFreq;
}
