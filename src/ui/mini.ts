// ===== miniature look =====
// Makes the board read like a macro photo of a real tabletop model: the far part of the field (and a little of the
// nearest) goes softly out of focus, stronger the lower the camera looks across the board and nearly none looking
// straight down; plus a gentle model-photo grade (a touch warmer and richer, a soft vignette).
//
// Cost: two page layers over the board using `backdrop-filter: blur()` (GPU, one pass each), each only as tall as its
// band and faded in by a mask; the grade is one plain see-through gradient layer (no blend modes: iPhone Safari draws
// blend layers over the 3D board as solid colour) and a saturate filter on the ground picture only. Nothing per piece.
// A frame-time watchdog lowers the quality, then switches the look off on this device, if the camera stops being smooth.

import { CONFIG } from '../config';
import type { View } from './board';

const KEY = 'boc-mini';
/** What the watchdog decided on this device: 'low' (lighter blur) or 'off'. Cleared when the player switches the look on. */
const AUTO_KEY = 'boc-mini-auto';
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const put = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } };

let pref = get(KEY) !== 'off';
let auto: 'low' | 'off' | null = (() => { const a = get(AUTO_KEY); return a === 'low' || a === 'off' ? a : null; })();

/** The menu switch: what the player chose (the watchdog may still hold it off; see miniHeldOff). */
export const miniPref = () => pref;
/** The look actually drawn. */
export const miniOn = () => pref && auto !== 'off';
/** The watchdog switched it off on this device to keep the camera smooth. */
export const miniHeldOff = () => pref && auto === 'off';
export function toggleMini() {
  // Switching it on again gives it a fresh chance (the watchdog may switch it off again if it is still slow).
  pref = !(pref && auto !== 'off');
  auto = null;
  put(KEY, pref ? 'on' : 'off');
  put(AUTO_KEY, null);
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** A multiply by colour `c` as a plain see-through colour (same trick as the weather tints). */
function shade(c: [number, number, number]): string {
  const a = 1 - Math.min(...c) / 255;
  if (a <= 0.001) return 'rgba(0,0,0,0)';
  const o = c.map((v) => Math.max(0, Math.round((v - 255 * (1 - a)) / a)));
  return `rgba(${o[0]},${o[1]},${o[2]},${a.toFixed(3)})`;
}

function layer(cls: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

/** Last values written, so a camera frame that changes nothing writes nothing. */
let last = '';
let lastTone = '';

/**
 * Lays the miniature look over the board. Call after the weather layers, every camera frame.
 * `focusY`: the screen height (0..1) kept sharpest (the selected piece, or the middle of the screen).
 * `depthAt(y)`: how far (as a share of the camera's distance) the ground seen at screen height y lies in front of or
 * behind the ground at the focus; Infinity above the horizon.
 */
export function placeMini(wrap: HTMLElement, v: View, focusY: number | null, depthAt: (y: number) => number) {
  let box = wrap.querySelector<HTMLElement>(':scope > .mini');
  const clip = wrap.querySelector<HTMLElement>(':scope > .ground-clip');
  if (!miniOn()) {
    box?.remove();
    clip?.classList.remove('mini-sat');
    last = lastTone = '';
    return;
  }
  noteFrame();
  if (!box) {
    box = layer('mini');
    box.dataset.keep = '1';
    box.append(layer('mini-far'), layer('mini-near'), layer('mini-tone'));
    last = lastTone = '';
  }
  // Over the board and the weather (rain far away is out of focus too), under the camera buttons.
  const after = wrap.querySelector<HTMLElement>(':scope > .wx-sky') ?? wrap.querySelector<HTMLElement>(':scope > .stage');
  if (after && after.nextElementSibling !== box) after.after(box);
  clip?.classList.add('mini-sat');

  // How much blur: none looking straight down (or on the flat map), full when the camera looks low across the board.
  const k = v.tilt ? smooth(0.1, 1.0, v.cam.pitch) : 0;
  // Blur in screen pixels, scaled to the picture's size (a phone screen needs less for the same look).
  const px = Math.min(1.25, Math.max(0.6, Math.min(v.vw, v.vh * 1.6) / 900));
  const lowQ = auto === 'low';
  const far = 4.8 * Math.pow(k, 0.7) * px * (lowQ ? 0.7 : 1);
  const near = 2.2 * Math.pow(k, 0.7) * px * (lowQ ? 0.7 : 1);
  // Where the blur starts and where it is full, by real depth: a thin slice of focus, thinner closer in (a macro lens).
  const zoom = Math.max(0.7, v.cam.zoom);
  const [r1, r2] = [0.1 / Math.pow(zoom, 0.8), 0.3 / Math.pow(zoom, 0.8)];
  // In front of the focus the slice is deeper: your own pieces near the camera stay readable.
  const nearMul = 2.6;
  const f = Math.min(0.8, Math.max(0.25, focusY ?? 0.5));
  const scan = (dir: -1 | 1, m: number): [number, number] => {
    let [a, b] = [dir < 0 ? 0 : 1, dir < 0 ? 0 : 1];
    let gotA = false;
    for (let y = f; dir < 0 ? y >= 0 : y <= 1; y += dir * 0.015) {
      const d = depthAt(y);
      if (!gotA && !(d < r1 * m)) [a, gotA] = [y, true];
      if (!(d < r2 * m)) {
        b = y;
        break;
      }
    }
    return [a, b];
  };
  const [farStart, farFull] = scan(-1, 1);
  const [nearStart, nearFull] = scan(1, nearMul);
  // Tilt-shift: whatever the depth, a soft band along the very top and bottom when the camera is tilted.
  const fa = Math.max(farStart, 0.18 * k);
  const ff = Math.min(fa, Math.max(farFull, 0.07 * k));
  const na = Math.min(nearStart, 1 - 0.14 * k);
  const nf = Math.max(na, Math.min(nearFull, 1 - 0.05 * k));
  const key = `${far.toFixed(1)}|${near.toFixed(1)}|${fa.toFixed(3)}|${ff.toFixed(3)}|${na.toFixed(3)}|${nf.toFixed(3)}`;
  if (key !== last) {
    last = key;
    const [fl, nl] = [box.children[0] as HTMLElement, box.children[1] as HTMLElement];
    // A band with almost no blur or no height is not drawn at all (saves the GPU pass looking straight down).
    fl.style.display = far < 0.8 || fa < 0.02 || watch === 'probe' ? 'none' : '';
    nl.style.display = near < 0.8 || na > 0.98 || watch === 'probe' ? 'none' : '';
    const fb = `blur(${far.toFixed(1)}px)`;
    fl.style.setProperty('backdrop-filter', fb);
    fl.style.setProperty('-webkit-backdrop-filter', fb);
    fl.style.height = `${(fa * 100).toFixed(1)}%`;
    fl.style.setProperty('--solid', `${((ff / Math.max(fa, 0.001)) * 100).toFixed(1)}%`);
    const nb = `blur(${near.toFixed(1)}px)`;
    nl.style.setProperty('backdrop-filter', nb);
    nl.style.setProperty('-webkit-backdrop-filter', nb);
    nl.style.height = `${((1 - na) * 100).toFixed(1)}%`;
    nl.style.setProperty('--solid', `${(((1 - nf) / Math.max(1 - na, 0.001)) * 100).toFixed(1)}%`);
  }

  // The model-photo grade: warmer by day, never over the moonlight; a soft vignette (less when the weather has its own).
  const time = CONFIG.weather?.time ?? 'day';
  const kind = CONFIG.weather?.kind ?? 'clear';
  const tone = `${time}/${kind}`;
  if (tone !== lastTone) {
    lastTone = tone;
    const t = box.children[2] as HTMLElement;
    const warm = time === 'night' ? null : time === 'dusk' || kind !== 'clear' ? shade([255, 250, 240]) : shade([255, 244, 226]);
    const vig = time === 'day' && kind === 'clear' ? 0.3 : 0.16;
    t.style.background = [
      `radial-gradient(ellipse 80% 75% at 50% 52%, rgba(22,14,6,0) 58%, rgba(22,14,6,${vig}) 100%)`,
      ...(warm ? [`linear-gradient(${warm}, ${warm})`] : []),
    ].join(', ');
    clip?.style.setProperty('--mini-sat', time === 'night' ? '1.04' : kind === 'fog' || kind === 'snow' ? '1.06' : '1.12');
  }
}

// ---------- the watchdog: frame times while the camera moves ----------
// The camera can be slow for reasons of its own (a big board on an old phone), so a slow stretch alone proves nothing:
// it then hides the blur for one short stretch and compares. Only if the look itself costs the frames is it lowered.
const frames: number[] = [];
let prevAt = 0;
/** 'measure': look on; 'probe': blur hidden to compare; a number: frames to wait before judging again. */
let watch: 'measure' | 'probe' | number = 'measure';
let slowOn = 0;
/** Frame-time samples while the look was on (for the dev measurement). */
export const miniStats = { samples: [] as number[], downgrades: [] as string[], hold: false };
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
function noteFrame() {
  const now = performance.now();
  const dt = now - prevAt;
  prevAt = now;
  // Only frames of a continuous camera move count (a pause between moves is not a slow frame).
  if (dt <= 0 || dt > 250) return;
  miniStats.samples.push(dt);
  if (miniStats.samples.length > 600) miniStats.samples.shift();
  if (miniStats.hold) return;
  if (typeof watch === 'number') {
    if (--watch <= 0) watch = 'measure';
    return;
  }
  frames.push(dt);
  if (frames.length < 40) return;
  const m = median(frames);
  frames.length = 0;
  if (watch === 'measure') {
    // Under ~40 frames a second with the look on: try a stretch without the blur.
    if (m > 25) [watch, slowOn, last] = ['probe', m, ''];
    return;
  }
  // Back from the probe: the blur is to blame only if the frames were clearly faster without it.
  last = '';
  if (slowOn > m * 1.15 + 2) {
    auto = auto === null ? 'low' : 'off';
    put(AUTO_KEY, auto);
    miniStats.downgrades.push(`${auto} (${slowOn.toFixed(1)} ms with, ${m.toFixed(1)} ms without)`);
    watch = 'measure';
  } else watch = 600; // not the look's fault: leave it on, look again much later
}
/** Dev: forget the watchdog's decision (measurements start from full quality). */
export function miniReset() {
  auto = null;
  put(AUTO_KEY, null);
  watch = 'measure';
  frames.length = 0;
  miniStats.samples.length = 0;
  miniStats.downgrades.length = 0;
  last = '';
}
/** Dev: switch the look on or off for a measurement without saving the choice. */
export function miniSetPref(on: boolean) {
  pref = on;
  last = lastTone = '';
}
// ===== end miniature look =====
