// Sound effects made on the fly with Web Audio: no files to download.
// Browsers only allow sound after the first tap, so the context starts lazily.

export type Cue = 'tick' | 'dice' | 'step' | 'clash' | 'arrow' | 'death' | 'horn' | 'win';

const MUTE_KEY = 'boc-mute';
let ctx: AudioContext | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();

export const isMuted = () => muted;

export function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* keep the choice for this visit only */
  }
}

function audio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function envelope(c: AudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  g.connect(c.destination);
  return g;
}

function noise(c: AudioContext, at: number, dur: number, peak: number, freq: number, q = 1) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f).connect(envelope(c, at, peak, 0.004, dur));
  src.start(at);
}

function tone(c: AudioContext, at: number, type: OscillatorType, from: number, to: number, dur: number, peak: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(from, at);
  o.frequency.exponentialRampToValueAtTime(to, at + dur);
  o.connect(envelope(c, at, peak, 0.01, dur));
  o.start(at);
  o.stop(at + dur + 0.05);
}

export function sound(cue: Cue) {
  if (muted) return;
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  switch (cue) {
    case 'tick':
      return tone(c, t, 'triangle', 900, 700, 0.04, 0.05);
    case 'dice':
      // Wooden dice rattling, then landing.
      for (let i = 0; i < 9; i++) noise(c, t + i * 0.06 + Math.random() * 0.03, 0.05, 0.25, 1800 + Math.random() * 1500, 4);
      return noise(c, t + 0.62, 0.09, 0.4, 900, 2);
    case 'step':
      return noise(c, t, 0.12, 0.25, 260, 1.5);
    case 'clash':
      // Steel on steel: a bright burst with ringing partials.
      noise(c, t, 0.18, 0.5, 3200, 2);
      tone(c, t, 'square', 1870, 1700, 0.25, 0.04);
      return tone(c, t, 'square', 2630, 2400, 0.2, 0.03);
    case 'arrow':
      return noise(c, t, 0.25, 0.25, 5000, 6);
    case 'death':
      return tone(c, t, 'sawtooth', 220, 70, 0.45, 0.08);
    case 'horn':
      // A war horn: two low notes.
      tone(c, t, 'sawtooth', 146, 146, 0.55, 0.12);
      return tone(c, t + 0.5, 'sawtooth', 196, 190, 0.9, 0.12);
    case 'win':
      [262, 330, 392, 523].forEach((f, i) => tone(c, t + i * 0.16, 'triangle', f, f, 0.4, 0.15));
      return;
  }
}
