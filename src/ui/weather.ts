// Weather and time of day, as page layers around the board: tints that colour the ground and the pieces, rain
// puddles laid on the ground, falling rain and snow, drifting fog. Each is one layer the GPU moves or blends
// (transforms, opacity, blend modes): nothing per piece and nothing repainted per frame, so panning stays smooth.
// The board drawing itself changes only a little (board.ts, "weather & light"): the sun's colour, longer shadows
// at dusk, a glow under each piece at night, and snowy ground and trees.

import { CONFIG, type TimeOfDay, type WeatherKind } from '../config';
import { DETAIL_URL, groundSize, groundToScreen, mapSize, skyNow, weatherPic, weatherPicsFor, type View } from './board';
import { t, type Key, type Lang } from './i18n';
import type { Settings } from './settings';

type RGB = [number, number, number];
const mul = (a: RGB, b: RGB): RGB => [(a[0] * b[0]) / 255, (a[1] * b[1]) / 255, (a[2] * b[2]) / 255];
const css = (c: RGB, a = 1) => `rgba(${c.map((n) => Math.round(n)).join(',')},${a})`;
const WHITE: RGB = [255, 255, 255];

/** How one time of day and one weather light the scene. `near`/`far`: the colour the ground is multiplied by
 *  towards the sun and away from it; `pieces`: the colour everything on the board is multiplied by; `desat`: how
 *  much colour the ground loses; `warm`: a soft glow of colour laid over the sunny side; `vignette`: darker corners. */
interface Look { near: RGB; far: RGB; pieces: RGB; desat: number; warm: [RGB, number] | null; vignette: number }
const TIME: Record<TimeOfDay, Look> = {
  day: { near: WHITE, far: WHITE, pieces: WHITE, desat: 0, warm: null, vignette: 0 },
  // Low golden sun: warm where it shines, a dusky violet away from it; everything a little darker.
  dusk: { near: [236, 246, 232], far: [96, 98, 150], pieces: [242, 234, 236], desat: 0, warm: [[255, 110, 100], 0.36], vignette: 0.34 },
  // Cool blue moonlight: dark, blue and grey, brighter under the moon.
  night: { near: [134, 152, 194], far: [58, 68, 108], pieces: [150, 162, 204], desat: 0.5, warm: null, vignette: 0.5 },
};
const WEATHER: Record<WeatherKind, Look> = {
  clear: { near: WHITE, far: WHITE, pieces: WHITE, desat: 0, warm: null, vignette: 0 },
  // Overcast and wet: the ground darker, everything a touch grey.
  rain: { near: [178, 188, 192], far: [138, 148, 158], pieces: [204, 212, 218], desat: 0.25, warm: null, vignette: 0.22 },
  // Snow light: cool and soft, a little blue away from the sun.
  snow: { near: WHITE, far: [212, 222, 242], pieces: [240, 244, 252], desat: 0, warm: null, vignette: 0 },
  // Fog greys the ground; the fog layers do the rest.
  fog: { near: [240, 242, 242], far: [226, 230, 232], pieces: [238, 240, 242], desat: 0.18, warm: null, vignette: 0 },
};


// ---------- textures, drawn once on a canvas ----------
const cache = new Map<string, string>();
/** The same darkening as multiplying by `c`, as a plain see-through colour: blend modes over the 3D board
 *  draw as solid colour in iPhone Safari (a white screen at dusk), so no layer may rely on them. */
function shadeOf(c: RGB): string {
  const a = 1 - Math.min(...c) / 255;
  if (a <= 0.001) return 'rgba(0,0,0,0)';
  const o = c.map((v) => Math.max(0, Math.round((v - 255 * (1 - a)) / a)));
  return `rgba(${o[0]},${o[1]},${o[2]},${a.toFixed(3)})`;
}

function texture(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  if (!c) return '';
  draw(c);
  const url = cv.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
/** A small fixed random sequence, so the textures look the same every time. */
function rand(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** Rain: thin streaks along (RW, RH), the way the layer moves, wrapped so the tile repeats without a seam. */
const RW = 64, RH = 512;
const rainTile = (night: boolean) =>
  texture(`rain${night}`, RW * 2, RH * 2, (c) => {
    const r = rand(night ? 5 : 9);
    c.scale(2, 2);
    const len = Math.hypot(RW, RH);
    const [ux, uy] = [RW / len, RH / len];
    for (let i = 0; i < 40; i++) {
      const [x, y] = [r() * RW, r() * RH];
      const l = 16 + r() * 34;
      const a = (night ? 0.35 : 0.6) * (0.45 + r() * 0.55);
      const g = c.createLinearGradient(x, y, x + ux * l, y + uy * l);
      g.addColorStop(0, `rgba(220,232,245,0)`);
      g.addColorStop(1, `rgba(225,236,248,${a.toFixed(2)})`);
      c.strokeStyle = g;
      c.lineWidth = 0.6 + r() * 0.7;
      c.lineCap = 'round';
      for (const dx of [-RW, 0, RW])
        for (const dy of [-RH, 0, RH]) {
          c.beginPath();
          c.moveTo(x + dx, y + dy);
          c.lineTo(x + dx + ux * l, y + dy + uy * l);
          c.stroke();
        }
    }
  });

/** Snow: soft round flakes, wrapped at the edges. */
const SN = 256;
const snowTile = (big: boolean) =>
  texture(`snow${big}`, SN * 2, SN * 2, (c) => {
    const r = rand(big ? 3 : 17);
    c.scale(2, 2);
    for (let i = 0; i < (big ? 22 : 46); i++) {
      const [x, y] = [r() * SN, r() * SN];
      const rad = big ? 1.6 + r() * 2.2 : 0.7 + r() * 1.1;
      const a = big ? 0.75 + r() * 0.25 : 0.5 + r() * 0.4;
      for (const dx of [-SN, 0, SN])
        for (const dy of [-SN, 0, SN]) {
          const g = c.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
          g.addColorStop(0, `rgba(255,255,255,${a.toFixed(2)})`);
          g.addColorStop(0.55, `rgba(250,252,255,${(a * 0.7).toFixed(2)})`);
          g.addColorStop(1, 'rgba(245,248,255,0)');
          c.fillStyle = g;
          c.beginPath();
          c.arc(x + dx, y + dy, rad, 0, Math.PI * 2);
          c.fill();
        }
    }
  });

const FW = 1024, FH = 512;

/** Ground fog: a few separate banks of mist, each a clump of soft puffs, with clear ground between them. */
const bankTile = () =>
  texture('fogbanks', FW / 2, FH / 2, (c) => {
    const r = rand(41);
    c.scale(0.5, 0.5);
    const banks = 6;
    for (let b = 0; b < banks; b++) {
      const [bx, by] = [r() * FW, FH * ((b + 0.2 + r() * 0.6) / banks)];
      for (let i = 0; i < 9; i++) {
        const [x, y] = [bx + (r() - 0.5) * 340, by + (r() - 0.5) * 22];
        const rad = 40 + r() * 70;
        const a = 0.2 + r() * 0.16;
        for (const dx of [-FW, 0, FW]) {
          const g = c.createRadialGradient(0, 0, 0, 0, 0, rad);
          g.addColorStop(0, `rgba(246,249,252,${a.toFixed(2)})`);
          g.addColorStop(0.5, `rgba(244,247,250,${(a * 0.55).toFixed(2)})`);
          g.addColorStop(1, 'rgba(240,244,248,0)');
          c.fillStyle = g;
          c.save();
          c.translate(x + dx, y);
          c.scale(2.3, 0.85); // banks lie long and low
          c.beginPath();
          c.arc(0, 0, rad, 0, Math.PI * 2);
          c.fill();
          c.restore();
        }
      }
    }
  });

// ---------- the layers ----------
const PUDDLES = (large: boolean) => `${import.meta.env.BASE_URL}map/puddles${large ? '-large' : ''}.webp?v=1`;
/** Pictures fetched ahead of a snowy or rainy battle, so the ground doesn't change in front of the player. */
const held = new Set<string>();
function hold(src: string) {
  if (held.has(src) || typeof Image === 'undefined') return;
  held.add(src);
  const im = new Image();
  im.src = src;
}

const el = (cls: string, tag = 'div') => {
  const e = document.createElement(tag);
  e.className = cls;
  e.setAttribute('aria-hidden', 'true');
  return e;
};

/** Lays (or updates) the weather layers. Called with the ground on every camera move, so it only moves things. */
export function placeWeather(wrap: HTMLElement, clip: HTMLElement, groundTransform: string, v: View) {
  const sky = skyNow();
  const look = <K extends keyof Look>(k: K): [Look[K], Look[K]] => [TIME[sky.time][k], WEATHER[sky.kind][k]];
  const sig = `${sky.time}/${sky.kind}/${CONFIG.board.cols}`;
  const plain = sky.time === 'day' && sky.kind === 'clear';

  // 1. On the ground: a CSS filter (wet, frosted, moonlit), the puddles, and the light tint by the sun or moon.
  if (clip.dataset.wx !== sig) {
    clip.dataset.wx = sig;
    clip.dataset.time = sky.time;
    clip.querySelectorAll('.wx-puddles, .wx-light, .wx-warm, .wx-desat, .wx-gfog').forEach((n) => n.remove());
    if (sky.kind === 'rain') {
      const p = el('wx-puddles', 'img') as HTMLImageElement;
      p.src = PUDDLES(CONFIG.board.cols > 25);
      p.alt = '';
      p.draggable = false;
      (clip.querySelector('.gpart') ? clip.insertBefore(p, clip.querySelector('.gpart')) : clip.append(p));
    }
    if (sky.kind === 'fog') {
      // Fog banks lying on the field, drifting slowly across it (white: the light tint colours them).
      const g = el('wx-gfog');
      const inner = el('wx-gfog-in');
      inner.style.backgroundImage = `url(${bankTile()})`;
      g.append(inner);
      clip.append(g);
    }
    if (!plain) {
      const [tn, wn] = look('near');
      const [tf, wf] = look('far');
      const l = el('wx-light');
      const [near, far] = [mul(tn, wn), mul(tf, wf)];
      const mid = near.map((n, i) => (n + far[i]) / 2) as RGB;
      // Twice as wide as the light's reach, so the far colour carries on past it to the screen's edges.
      l.style.background = `radial-gradient(closest-side, ${shadeOf(near)} 0%, ${shadeOf(mid)} 18%, ${shadeOf(far)} 42%, ${shadeOf(far)} 100%)`;
      const desat = Math.min(0.8, look('desat').reduce((a, b) => a + b, 0));
      if (desat > 0 && false) { // saturation blend: off (blend modes break on iPhone)
        const d = el('wx-desat wx-ground');
        d.style.opacity = desat.toFixed(2);
        clip.append(d);
      }
      clip.append(l);
      const warm = look('warm').find(Boolean);
      if (warm) {
        const w = el('wx-warm');
        w.style.background = `radial-gradient(closest-side, ${css(warm[0], warm[1] * 0.45)} 0%, ${css(warm[0], warm[1] * 0.2)} 14%, ${css(warm[0], 0)} 32%)`;
        clip.append(w);
      }
    }
  }
  // Snowy close-up grass under a snowy ground.
  const detail = clip.querySelector<HTMLElement>('.gdetail');
  const want = sky.kind === 'snow' ? weatherPic(DETAIL_URL) : DETAIL_URL;
  if (detail && detail.dataset.wx !== want) {
    detail.dataset.wx = want;
    detail.style.backgroundImage = `url(${want})`;
  }
  const puddles = clip.querySelector<HTMLElement>('.wx-puddles');
  if (puddles) {
    const [gw, gh] = groundSize();
    puddles.style.width = `${gw}px`;
    puddles.style.height = `${gh}px`;
    puddles.style.transform = groundTransform;
  }
  const gfog = clip.querySelector<HTMLElement>('.wx-gfog');
  if (gfog) {
    const [gw, gh] = groundSize();
    gfog.style.width = `${gw}px`;
    gfog.style.height = `${gh}px`;
    gfog.style.transform = groundTransform;
  }
  const light = clip.querySelector<HTMLElement>('.wx-light');
  if (light) {
    // The river and bridge pictures are added after these on a new map: they must stay on top of them.
    const tints = [...clip.querySelectorAll<HTMLElement>('.wx-gfog, .wx-desat, .wx-light, .wx-warm')];
    if (clip.querySelector('.wx-gfog ~ .gpart, .wx-desat ~ .gpart, .wx-light ~ .gpart, .wx-warm ~ .gpart')) clip.append(...tints);
    // A big round gradient centred on the sun (the board's far-left corner, as the board's own light), moved
    // by a transform only, so the light turns with the camera without being repainted.
    const [fw, fh] = mapSize(v.portrait);
    const [sx, sy] = groundToScreen(v, -0.25 * fw, -0.35 * fh);
    const [ex, ey] = groundToScreen(v, 1.15 * fw, 1.25 * fh);
    // The light's reach, but never so short that the layer stops before a corner of the screen.
    const corner = Math.max(...[[0, 0], [clip.clientWidth, 0], [0, clip.clientHeight], [clip.clientWidth, clip.clientHeight]].map(([x, y]) => Math.hypot(x - sx, y - sy)));
    const r = Math.max(200, Math.hypot(ex - sx, ey - sy), corner / 2);
    for (const e of clip.querySelectorAll<HTMLElement>('.wx-light, .wx-warm')) {
      e.style.width = e.style.height = `${(4 * r).toFixed(0)}px`;
      e.style.transform = `translate(${(sx - 2 * r).toFixed(1)}px, ${(sy - 2 * r).toFixed(1)}px)`;
    }
  }

  // 2. Over the board: the colour the pieces take, darker corners, fog, falling rain or snow.
  let top = wrap.querySelector<HTMLElement>(':scope > .wx-sky');
  const stage = wrap.querySelector(':scope > .stage');
  if (plain) {
    top?.remove();
    return;
  }
  if (!top) {
    top = el('wx-sky');
    top.dataset.keep = '1';
  }
  // Right after the board, under the camera buttons.
  if (stage && stage.nextElementSibling !== top) stage.after(top);
  if (top.dataset.wx === sig) return;
  top.dataset.wx = sig;
  top.textContent = '';
  const [tp, wp] = look('pieces');
  const dim = mul(tp, wp);
  if (dim.some((n) => n < 254)) {
    const d = el('wx-dim');
    d.style.background = shadeOf(dim);
    top.append(d);
  }
  const vig = Math.max(...look('vignette'));
  if (vig > 0) {
    const g = el('wx-vig');
    const shade = sky.time === 'dusk' ? '40,16,30' : '4,8,24';
    g.style.background = `radial-gradient(ellipse 75% 70% at 50% 55%, rgba(${shade},0) 55%, rgba(${shade},${vig}) 100%)`;
    top.append(g);
  }
  if (sky.kind === 'rain') {
    const tile = rainTile(sky.time === 'night');
    for (const [i, scale, dur, a] of [[0, 0.62, 0.62, 0.55], [1, 1, 0.42, 0.85]] as const) {
      const d = el(`wx-fall wx-rain${i}`);
      d.style.setProperty('--tw', `${RW * scale}px`);
      d.style.setProperty('--th', `${RH * scale}px`);
      d.style.backgroundImage = `url(${tile})`;
      d.style.backgroundSize = `${RW * scale}px ${RH * scale}px`;
      d.style.animationDuration = `${dur}s`;
      d.style.opacity = String(a);
      top.append(d);
    }
  }
  if (sky.kind === 'snow') {
    for (const [i, big, size, dur, a] of [[0, false, 180, 13, 0.75], [1, true, 256, 8, 0.95]] as const) {
      // Two nested layers: the outer sways side to side, the inner falls.
      const sway = el(`wx-sway wx-sway${i}`);
      const d = el(`wx-fall wx-snow${i}`);
      d.style.setProperty('--tw', '0px');
      d.style.setProperty('--th', `${size}px`);
      d.style.backgroundImage = `url(${snowTile(big)})`;
      d.style.backgroundSize = `${size}px ${size}px`;
      d.style.animationDuration = `${dur}s`;
      d.style.opacity = String(sky.time === 'night' ? a * 0.7 : a);
      sway.append(d);
      top.append(sway);
    }
  }
}


// ---------- the setup screen ----------
const ICON: Record<string, string> = {
  day: '<circle cx="12" cy="10" r="4"/><path d="M12 2.5v2M12 15.5v2M4.5 10h2M17.5 10h2M6.7 4.7l1.4 1.4M15.9 13.9l1.4 1.4M6.7 15.3l1.4-1.4M15.9 6.1l1.4-1.4" fill="none"/><path d="M3 21h18" fill="none"/>',
  dusk: '<path d="M6.5 17a5.5 5.5 0 0 1 11 0z"/><path d="M12 6.5v2.5M4.6 10.4l1.8 1.8M19.4 10.4l-1.8 1.8M2 17h20M6 21h12" fill="none"/>',
  night: '<path d="M15.5 3.5a8 8 0 1 0 5 13.8A7 7 0 0 1 15.5 3.5z"/><path d="M6 5l.6 1.4L8 7l-1.4.6L6 9l-.6-1.4L4 7l1.4-.6z"/>',
  clear: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7" fill="none"/>',
  rain: '<path d="M7 14a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.3 3.3 0 0 1 17 14z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" fill="none"/>',
  snow: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.5 3.8L12 6l2.5-2.2M9.5 20.2L12 18l2.5 2.2M3.6 10.5l3.2-.9-.8-3.2M20.4 13.5l-3.2.9.8 3.2M3.6 13.5l3.2.9-.8 3.2M20.4 10.5l-3.2-.9.8-3.2" fill="none"/>',
  fog: '<path d="M3 8c3-2 6 2 9 0s6-2 9 0M3 13c3-2 6 2 9 0s6-2 9 0M3 18c3-2 6 2 9 0s6-2 9 0" fill="none"/>',
  random: '<rect x="4" y="4" width="16" height="16" rx="3.5" fill="none"/><circle cx="8.5" cy="8.5" r="1.4"/><circle cx="15.5" cy="15.5" r="1.4"/><circle cx="12" cy="12" r="1.4"/>',
};
const RULE_OF: Partial<Record<WeatherKind, keyof Settings['options']>> = { rain: 'rainRange', snow: 'snowCavalry', fog: 'fogCap' };

/** "Weather and light" on the New battle screen: time of day and weather as small icon buttons, each with a line
 *  saying what it does (and whether its rule is on). */
export function weatherPanel(s: Settings, lang: Lang): string {
  const seg = (field: 'time' | 'weather', values: string[], current: string, label: (v: string) => string) =>
    `<div class="seg wxseg" role="radiogroup">${values
      .map((v) => `<button role="radio" data-act="set" data-field="${field}" data-value="${v}" class="${v === current ? 'on' : ''}" aria-checked="${v === current}" title="${label(v)}"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${ICON[v]}</svg><small>${label(v)}</small></button>`)
      .join('')}</div>`;
  const time = s.time ?? 'day';
  const kind = s.weather ?? 'clear';
  // Snow has its own ground and trees: fetch them while the player is still choosing.
  if (kind === 'snow') for (const u of weatherPicsFor('snow', s.size === 'large')) hold(u);
  if (kind === 'rain') hold(PUDDLES(s.size === 'large'));
  const rule = kind !== 'random' && kind !== 'clear' ? RULE_OF[kind] : undefined;
  const ruleOff = rule && !s.options[rule] ? ` ${t(lang, 'wxRuleOff')}` : '';
  return `<h3>${t(lang, 'weatherTitle')}</h3>
      ${seg('time', ['day', 'dusk', 'night', 'random'], time, (v) => t(lang, (v === 'random' ? 'wx_random' : `time_${v}`) as Key))}
      <p class="wxhint">${t(lang, `timeHint_${time}` as Key)}</p>
      ${seg('weather', ['clear', 'rain', 'snow', 'fog', 'random'], kind, (v) => t(lang, `wx_${v}` as Key))}
      <p class="wxhint">${t(lang, `wxHint_${kind}` as Key)}${ruleOff}</p>`;
}
