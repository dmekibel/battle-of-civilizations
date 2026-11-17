// Sound effects: short recordings made with ElevenLabs (public/sfx/<cue>-<n>.mp3), played through Web Audio.
// Each cue has a few takes, picked at random and slightly re-pitched, so repeats don't sound mechanical.
// Until a recording has loaded (or if it can't), a synthesized stand-in plays instead.
// Browsers only allow sound after the first tap, so the context starts lazily.

export type Cue =
  | 'tick' | 'dice' | 'step' | 'hoof' | 'clash' | 'bow' | 'thunk' | 'pistol' | 'rifle' | 'death' | 'horn' | 'win' | 'lose'
  /** Older name for a bow shot. */
  | 'arrow';

/** How many takes each cue has, and how loud it plays (the files are all peaked to -1 dB). */
const TAKES: Record<Exclude<Cue, 'arrow'>, [number, number]> = {
  tick: [1, 0.35], dice: [2, 0.8], step: [3, 0.32], hoof: [3, 0.38], clash: [3, 0.7], bow: [2, 0.55], thunk: [2, 0.6],
  pistol: [2, 0.6], rifle: [2, 0.65], death: [2, 0.7], horn: [1, 0.45], win: [1, 0.8], lose: [1, 0.75],
};
/** Cues that keep their pitch: music and the horn. */
const STEADY = new Set<Cue>(['win', 'lose', 'horn']);
const buffers = new Map<string, AudioBuffer>();
let loading = false;

function load(c: AudioContext) {
  if (loading) return;
  loading = true;
  for (const [cue, [n]] of Object.entries(TAKES)) {
    for (let i = 1; i <= n; i++) {
      const name = `${cue}-${i}`;
      fetch(`${import.meta.env.BASE_URL}sfx/${name}.mp3?v=1`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((b) => new Promise<AudioBuffer>((ok, no) => c.decodeAudioData(b, ok, no)))
        .then((buf) => buffers.set(name, buf))
        .catch(() => {
          /* the synthesized stand-in covers this cue */
        });
    }
  }
}

/** Plays a recording of the cue; false if none has loaded yet. */
function sample(c: AudioContext, cue: Exclude<Cue, 'arrow'>, delay: number): boolean {
  const [n, vol] = TAKES[cue];
  const takes = Array.from({ length: n }, (_, i) => buffers.get(`${cue}-${i + 1}`)).filter((b): b is AudioBuffer => !!b);
  if (!takes.length) return false;
  const src = c.createBufferSource();
  src.buffer = takes[Math.floor(Math.random() * takes.length)];
  if (!STEADY.has(cue)) src.playbackRate.value = 0.93 + Math.random() * 0.14;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(g).connect(c.destination);
  src.start(c.currentTime + delay);
  return true;
}

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
  load(ctx);
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

/** Plays a cue now, or `delay` seconds from now. */
export function sound(cue: Cue, delay = 0) {
  if (muted) return;
  const c = audio();
  if (!c) return;
  if (cue === 'arrow') cue = 'bow';
  if (sample(c, cue, delay)) return;
  const t = c.currentTime + delay;
  switch (cue) {
    case 'tick':
      return tone(c, t, 'triangle', 900, 700, 0.04, 0.05);
    case 'dice':
      // Wooden dice rattling, then landing.
      for (let i = 0; i < 9; i++) noise(c, t + i * 0.06 + Math.random() * 0.03, 0.05, 0.25, 1800 + Math.random() * 1500, 4);
      return noise(c, t + 0.62, 0.09, 0.4, 900, 2);
    case 'step':
    case 'hoof':
      return noise(c, t, 0.12, 0.25, 260, 1.5);
    case 'clash':
      // Steel on steel: a bright burst with ringing partials.
      noise(c, t, 0.18, 0.5, 3200, 2);
      tone(c, t, 'square', 1870, 1700, 0.25, 0.04);
      return tone(c, t, 'square', 2630, 2400, 0.2, 0.03);
    case 'bow':
      return noise(c, t, 0.25, 0.25, 5000, 6);
    case 'thunk':
      return noise(c, t, 0.08, 0.3, 500, 2);
    case 'pistol':
    case 'rifle':
      return noise(c, t, 0.2, 0.6, 1200, 0.7);
    case 'death':
      return tone(c, t, 'sawtooth', 220, 70, 0.45, 0.08);
    case 'horn':
      // A war horn: two low notes.
      tone(c, t, 'sawtooth', 146, 146, 0.55, 0.12);
      return tone(c, t + 0.5, 'sawtooth', 196, 190, 0.9, 0.12);
    case 'lose':
      [220, 196, 165].forEach((f, i) => tone(c, t + i * 0.3, 'triangle', f, f, 0.6, 0.12));
      return;
    case 'win':
      [262, 330, 392, 523].forEach((f, i) => tone(c, t + i * 0.16, 'triangle', f, f, 0.4, 0.15));
      return;
  }
}
