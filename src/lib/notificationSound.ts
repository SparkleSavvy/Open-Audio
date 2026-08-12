let ctx: AudioContext | null = null;
let unlocked = false;

const SOUND_KEY = 'open-audio:notification-sound';

export function notificationsSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(SOUND_KEY) !== '0';
}

export function setNotificationsSoundEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SOUND_KEY, enabled ? '1' : '0');
}

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

function unlock() {
  if (unlocked) return;
  unlocked = true;
  const c = getContext();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

function ensureUnlocked() {
  if (unlocked) return;
  if (typeof window === 'undefined') return;
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

export function playChime() {
  ensureUnlocked();
  if (!unlocked) return;
  const c = getContext();
  if (!c || c.state !== 'running') return;

  const t0 = c.currentTime;
  const master = c.createGain();
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
  master.connect(c.destination);

  const notes = [
    { f: 523.25, t: 0, dur: 0.28 },
    { f: 783.99, t: 0.1, dur: 0.4 },
  ];
  for (const note of notes) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = note.f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0 + note.t);
    g.gain.exponentialRampToValueAtTime(1, t0 + note.t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + note.t + note.dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0 + note.t);
    osc.stop(t0 + note.t + note.dur + 0.05);
  }
}
