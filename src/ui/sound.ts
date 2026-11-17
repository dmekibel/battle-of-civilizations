// Sound effects: short recordings made with ElevenLabs (public/sfx/<cue>-<n>.mp3), played through Web Audio.
// Each cue has a few takes, picked at random and slightly re-pitched, so repeats don't sound mechanical.
// Until a recording has loaded (or if it can't), a synthesized stand-in plays instead.
// Browsers only allow sound after the first tap, so the context starts lazily.

export type Cue =
  | 'tick' | 'dice' | 'step' | 'hoof' | 'clash' | 'bow' | 'thunk' | 'pistol' | 'rifle' | 'cannon' | 'boom' | 'death' | 'horn' | 'win' | 'lose'
  /** What a blow lands on (sword on shield, axe on mail, spear into a horse, arrow into a body, a club), a musket, and the ground underfoot. */
  | 'shield' | 'axe' | 'spear' | 'flesh' | 'musket' | 'club' | 'splash' | 'bridge' | 'snort'
  /** Older name for a bow shot. */
  | 'arrow';

/** How many takes each cue has, and how loud it plays (the files are all peaked to -1 dB). */
const TAKES: Record<Exclude<Cue, 'arrow'>, [number, number]> = {
  tick: [1, 0.35], dice: [2, 0.8], step: [3, 0.32], hoof: [3, 0.38], clash: [3, 0.7], bow: [2, 0.55], thunk: [2, 0.6],
  pistol: [2, 0.6], rifle: [2, 0.65], cannon: [2, 0.75], boom: [2, 0.7], death: [2, 0.7], horn: [1, 0.45], win: [1, 0.8], lose: [1, 0.75],
  shield: [3, 0.65], axe: [3, 0.65], spear: [2, 0.6], flesh: [2, 0.55], musket: [2, 0.65], club: [3, 0.65], splash: [3, 0.35], bridge: [3, 0.35], snort: [3, 0.4],
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

// ---------- mixer ----------
// Three volumes (effects, voices, music), each a gain every sound of that kind runs through. The old Sound switch
// still silences effects and voices together; the Music switch still silences music.

export type Bus = 'fx' | 'voice' | 'music';
const MIX_KEY = 'boc-mix';
const mix: Record<Bus, number> = (() => {
  const m = { fx: 1, voice: 1, music: 1 };
  try {
    const saved = JSON.parse(localStorage.getItem(MIX_KEY) ?? '{}') as Partial<Record<Bus, unknown>>;
    for (const k of ['fx', 'voice', 'music'] as Bus[]) if (typeof saved[k] === 'number') m[k] = Math.min(1, Math.max(0, saved[k] as number));
  } catch {
    /* defaults */
  }
  return m;
})();
const buses = new Map<Bus, GainNode>();

/** The gain every sound of one kind goes through (made on first use). */
export function busOf(c: AudioContext, b: Bus): GainNode {
  let g = buses.get(b);
  if (!g) {
    g = c.createGain();
    g.gain.value = mix[b];
    g.connect(c.destination);
    buses.set(b, g);
  }
  return g;
}

export const volumeOf = (b: Bus) => mix[b];

export function setVolume(b: Bus, v: number) {
  mix[b] = Math.min(1, Math.max(0, v));
  if (ctx) busOf(ctx, b).gain.setTargetAtTime(mix[b], ctx.currentTime, 0.05);
  try {
    localStorage.setItem(MIX_KEY, JSON.stringify(mix));
  } catch {
    /* keep it for this visit only */
  }
}

/** Where a sound goes: your own side's sounds play full and close; the other side's a little quieter and duller, as if across the field. */
export function outlet(c: AudioContext, b: Bus, near = true): AudioNode {
  if (near) return busOf(c, b);
  const g = c.createGain();
  g.gain.value = 0.7;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  g.connect(lp).connect(busOf(c, b));
  return g;
}

/** Three sliders for the menu (Effects / Voices / Music). They save themselves; no click handler needed. */
export function mixerHtml(labels: Record<Bus, string>): string {
  const one = (b: Bus) =>
    `<label class="mix-row"><span>${labels[b]}</span><input type="range" min="0" max="100" step="5" value="${Math.round(mix[b] * 100)}" data-mix="${b}" aria-label="${labels[b]}"></label>`;
  return `<div class="mixer">${one('fx')}${one('voice')}${one('music')}</div>`;
}

if (typeof document !== 'undefined') {
  document.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement | null;
    const b = el?.dataset?.mix as Bus | undefined;
    if (b && b in mix) setVolume(b, Number(el!.value) / 100);
  });
}

/** Plays a recording of the cue; false if none has loaded yet. */
function sample(c: AudioContext, cue: Exclude<Cue, 'arrow'>, delay: number, near = true): boolean {
  const [n, vol] = TAKES[cue];
  const takes = Array.from({ length: n }, (_, i) => buffers.get(`${cue}-${i + 1}`)).filter((b): b is AudioBuffer => !!b);
  if (!takes.length) return false;
  const src = c.createBufferSource();
  src.buffer = takes[Math.floor(Math.random() * takes.length)];
  if (!STEADY.has(cue)) src.playbackRate.value = 0.93 + Math.random() * 0.14;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(g).connect(outlet(c, 'fx', near));
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

/** The sound engine, started if it can be (null before the first tap on some browsers, or with no Web Audio). */
export function audio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // iPhone: play through the speaker even when the ringer switch is on silent (the game has its own Sound and Music switches).
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'playback';
    } catch {
      /* older browsers: the ringer switch decides */
    }
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
  g.connect(busOf(c, 'fx'));
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

/** Plays a cue now, or `delay` seconds from now. `near` = false plays it as the far side's (quieter, duller). */
export function sound(cue: Cue, delay = 0, near = true) {
  if (muted) return;
  const c = audio();
  if (!c) return;
  if (cue === 'arrow') cue = 'bow';
  if (sample(c, cue, delay, near)) return;
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
    case 'bridge':
      return noise(c, t, 0.12, 0.25, 260, 1.5);
    case 'splash':
      return noise(c, t, 0.2, 0.25, 1400, 0.8);
    case 'snort':
      return noise(c, t, 0.3, 0.12, 700, 1);
    case 'shield':
    case 'club':
    case 'flesh':
      return noise(c, t, 0.1, 0.35, cue === 'shield' ? 700 : 400, 1.5);
    case 'axe':
    case 'spear':
      noise(c, t, 0.15, 0.45, 2400, 1.5);
      return noise(c, t, 0.1, 0.3, 500, 2);
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
    case 'musket':
      return noise(c, t, 0.2, 0.6, 1200, 0.7);
    case 'cannon':
    case 'boom':
      // A deep boom: low noise with a long tail.
      return noise(c, t, cue === 'cannon' ? 0.9 : 0.5, 0.8, 300, 0.7);
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

// ---------- music ----------
// One quiet looping theme per army (public/music/<army>.mp3, made with ElevenLabs). Both armies' themes run
// together and the one whose turn it is is faded up, so the music tells you whose move it is. A war-drum layer
// joins while a King is in danger. Each loop cross-fades into itself, so there's no gap where it repeats.

const MUSIC_KEY = 'boc-music';
let musicOff = (() => {
  try {
    return localStorage.getItem(MUSIC_KEY) === '0';
  } catch {
    return false;
  }
})();
export const musicOn = () => !musicOff;

interface Track { gain: GainNode; timer: number; live: AudioBufferSourceNode[] }
const OVERLAP = 3; // seconds a loop overlaps its own repeat
const THEME_VOL = 0.5; // 0.2 was too faint to hear on a phone speaker
const DRUM_VOL = 0.3;
const musicBuf = new Map<string, AudioBuffer | 'loading'>();
const tracks = new Map<string, Track>();
let scene: { themes: string[]; active: string | null; tension: boolean } = { themes: [], active: null, tension: false };

function loopTrack(c: AudioContext, name: string, buf: AudioBuffer): Track {
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.connect(busOf(c, 'music'));
  const tr: Track = { gain, timer: 0, live: [] };
  const play = (first: boolean) => {
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(first ? 1 : 0, t);
    g.gain.linearRampToValueAtTime(1, t + OVERLAP);
    g.gain.setValueAtTime(1, t + buf.duration - OVERLAP);
    g.gain.linearRampToValueAtTime(0, t + buf.duration);
    src.connect(g).connect(gain);
    src.start(t);
    tr.live.push(src);
    src.onended = () => (tr.live = tr.live.filter((x) => x !== src));
    tr.timer = window.setTimeout(() => play(false), (buf.duration - OVERLAP) * 1000);
  };
  play(true);
  tracks.set(name, tr);
  return tr;
}

function stopTrack(name: string) {
  const tr = tracks.get(name);
  if (!tr || !ctx) return;
  tracks.delete(name);
  clearTimeout(tr.timer);
  tr.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  setTimeout(() => tr.live.forEach((s) => s.stop()), 2500);
}

function applyMusic() {
  const c = ctx;
  if (!c) return; // no sound until the first tap
  const wanted = musicOff ? [] : [...scene.themes, ...(scene.themes.length ? ['tension'] : [])];
  for (const name of [...tracks.keys()]) if (!wanted.includes(name)) stopTrack(name);
  for (const name of wanted) {
    const buf = musicBuf.get(name);
    if (!buf) {
      musicBuf.set(name, 'loading');
      fetch(`${import.meta.env.BASE_URL}music/${name}.mp3?v=1`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
        .then((b) => new Promise<AudioBuffer>((ok, no) => c.decodeAudioData(b, ok, no)))
        .then((b) => (musicBuf.set(name, b), applyMusic()))
        .catch(() => musicBuf.delete(name));
      continue;
    }
    if (buf === 'loading') continue;
    const tr = tracks.get(name) ?? loopTrack(c, name, buf);
    const vol = name === 'tension' ? (scene.tension ? DRUM_VOL : 0) : name === scene.active ? THEME_VOL : 0;
    tr.gain.gain.setTargetAtTime(vol, c.currentTime, name === 'tension' ? 1.2 : 1.6);
  }
}

/** Says what should be playing: the armies on the board, whose theme is up front, and whether a King is in danger.
 *  No themes = silence (menus, setup). Safe to call on every draw. */
export function setMusic(themes: string[], active: string | null, tension: boolean) {
  scene = { themes: [...new Set(themes)], active, tension };
  applyMusic();
}

export function toggleMusic() {
  musicOff = !musicOff;
  try {
    localStorage.setItem(MUSIC_KEY, musicOff ? '0' : '1');
  } catch {
    /* keep the choice for this visit only */
  }
  if (!musicOff) audio();
  applyMusic();
}

// Music can only start after a tap or key press: start the sound engine on the first one.
if (typeof window !== 'undefined') {
  const wake = () => {
    if (!muted || !musicOff) audio();
    applyMusic();
  };
  // iPhones only allow sound to start when a tap ends, so listen for that too.
  for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, wake, { passive: true });
}
