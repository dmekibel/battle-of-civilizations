// Draws the board as one SVG string. The grid is flat-top hexes with odd columns shifted
// down; in portrait the whole map turns 90° so the armies face each other top and bottom.
// In 2.5D the map is then turned and tilted by the camera like a table seen from a chair:
// far rows are squashed and smaller, and pieces, trees and bridges stand up from the ground.

import { CONFIG, type GameConfig, type TerrainId, type TimeOfDay, type UnitTypeId, type WeatherKind } from '../config';
import type { AttackPreview, GameState, Hex, Player, Reach, Unit } from '../engine';
import { maxHp, neighbors } from '../engine';
import { sides } from './factions';
import { hexName } from './i18n';
import { ART_VERSION, SPRITES } from './sprites';
import { DROP } from './spritefix';
import { artAt, BUILD_SCALE, TREE_SCALE, BIOME_SCENERY, biomeId, biomeOf, biomePics, detailUrlOf, groundUrlOf, propsOf, riverFile, treeKinds, treeUrlOf } from './biomes';
import { armyColor, healthBar, unitSymbol } from './symbols';
import { sideColor, sideColorsOn, sideDashed } from './sides';

const S = 34; // hex radius in SVG units
const R3 = Math.sqrt(3);
/** The flat map's size in units; follows the board size (standard 25 x 15, large 33 x 19). */
let W = 0;
let H = 0;
let sizedFor = '';
function syncSize() {
  const k = `${CONFIG.board.cols}x${CONFIG.board.rows}`;
  if (k === sizedFor) return;
  sizedFor = k;
  W = S * 1.5 * (CONFIG.board.cols - 1) + 2 * S;
  H = R3 * S * (CONFIG.board.rows + 0.5);
}
syncSize();
/** The bigger board has its own paintings (*-large.webp). */
const LARGE = () => CONFIG.board.cols > 25;
const SUF = () => (LARGE() ? '-large' : '');

/** A real perspective camera over the board, like a 3D program. It looks at a point on the
 *  ground (`x`, `y` in flat map units, null = the board's middle), orbits that point (`yaw`,
 *  radians; `pitch` 0..1 from gently sloped to steep), and `zoom` brings it closer.
 *  Pieces and trees always stand facing the viewer. */
export interface Camera {
  yaw: number;
  pitch: number;
  zoom: number;
  x: number | null;
  y: number | null;
}

export interface View {
  /** Write each hex's name on it (off unless switched on in the menu). */
  labels?: boolean;
  portrait: boolean;
  /** 2.5D: tilted board with standing pieces. Off = straight down from above. */
  tilt: boolean;
  cam: Camera;
  /** Size of the drawing area in screen pixels; the picture fills it exactly. */
  vw: number;
  vh: number;
}

type Pt = [number, number];

/** Everything needed to turn flat map positions into screen positions for one render. */
interface Lens {
  /** Flat map point -> screen point (pixels). */
  pt: (x: number, y: number) => Pt;
  /** How big things look at this point, in pixels per map unit. */
  size: (x: number, y: number) => number;
  /** How near the viewer this point is; larger is nearer. Used to paint back to front. */
  depth: (x: number, y: number) => number;
  /** Screen point -> the point on the ground under it. */
  ground: (X: number, Y: number) => Pt;
  width: number;
  height: number;
  tilt: boolean;
  /** The same projection as a 3x3 matrix (rows), flat (x, y, 1) -> screen (X·w, Y·w, w): lays a picture on the ground. */
  h: number[];
  /** A point `z` map units above the table (raised high ground); `pt` and `size` already lift points on raised hexes. */
  pt3: (x: number, y: number, z: number) => Pt;
  size3: (x: number, y: number, z: number) => number;
  /** How high a hex's top stands (0 = the table). */
  hexZ: (h: Hex) => number;
  /** Where the camera is, over the flat map (to tell which cliff faces it sees). */
  eye: Pt;
}

/** Flat map size for this orientation (portrait turns the map 90°). */
export const mapSize = (portrait: boolean): Pt => (syncSize(), portrait ? [H, W] : [W, H]);

/** Camera tilt: 0° looks straight down, up to 76° looks almost across the table. */
const tiltAngle = (v: View) => (v.tilt ? (76 * v.cam.pitch * Math.PI) / 180 : 0);

function lens(v: View, T: Terraces | null = null): Lens {
  syncSize();
  const [fw, fh] = mapSize(v.portrait);
  const radius = Math.hypot(fw, fh) / 2;
  const tx = v.cam.x ?? fw / 2;
  const ty = v.cam.y ?? fh / 2;
  const [cos, sin] = [Math.cos(v.cam.yaw), Math.sin(v.cam.yaw)];
  const angle = tiltAngle(v);
  const [cosA, sinA] = [Math.cos(angle), Math.sin(angle)];
  const dist = radius * 2.4; // camera distance: closer = stronger perspective
  // At zoom 1 the whole board fits the screen; the fit doesn't change as the camera turns or tilts.
  const fit = Math.min(v.vw / (fw * (v.tilt ? 1.12 : 1) + 60), v.vh / ((v.tilt ? fh * 0.8 : fh) + 110));
  const scale = fit * v.cam.zoom;
  const [cx, cy] = [v.vw / 2, v.vh / 2 + (v.tilt ? 18 : 0)];
  // `z` lifts the point off the table (raised high ground): up the screen and a little towards the camera.
  const raw = (x: number, y: number, z = 0) => {
    const dx = x - tx;
    const dy = y - ty;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos; // positive = towards the viewer
    const k = dist / Math.max(dist * 0.15, dist - ry * sinA - z * cosA); // true perspective
    return [cx + rx * k * scale, cy + (ry * cosA - z * sinA) * k * scale, k * scale, ry] as const;
  };
  const zAt = T ? T.at : () => 0;
  return {
    pt: (x, y) => {
      const [X, Y] = raw(x, y, zAt(x, y));
      return [X, Y];
    },
    size: (x, y) => raw(x, y, zAt(x, y))[2],
    pt3: (x, y, z) => {
      const [X, Y] = raw(x, y, z);
      return [X, Y];
    },
    size3: (x, y, z) => raw(x, y, z)[2],
    hexZ: T ? T.hex : () => 0,
    eye: [tx + dist * sinA * sin, ty + dist * sinA * cos],
    depth: (x, y) => raw(x, y)[3],
    ground: (X, Y) => {
      const xr = (X - cx) / scale;
      const yr = (Y - cy) / scale;
      const ry = (yr * dist) / Math.max(1e-3, cosA * dist + yr * sinA);
      const k = dist / Math.max(dist * 0.15, dist - ry * sinA);
      const rx = xr / k;
      return [tx + rx * cos + ry * sin, ty - rx * sin + ry * cos];
    },
    width: v.vw,
    height: v.vh,
    tilt: v.tilt,
    h: (() => {
      const [r0, q0] = [-tx * cos + ty * sin, -tx * sin - ty * cos];
      const w = [-sin * sinA, -cos * sinA, dist - q0 * sinA];
      const rx = [cos, -sin, r0].map((n) => n * dist * scale);
      const ry = [sin, cos, q0].map((n) => n * cosA * dist * scale);
      return [...w.map((n, i) => cx * n + rx[i]), ...w.map((n, i) => cy * n + ry[i]), ...w];
    })(),
  };
}

// ---------- the painted ground ----------
// One picture of the whole board (grass, river, bridges, forest shade, the table around it), made by _art/map_build.py.
// It covers the flat map plus GROUND_M units all round and is laid under the hexes with the camera's own projection.
export const GROUND_M = 70;
export const groundUrlFor = (large: boolean) => `${import.meta.env.BASE_URL}map/ground${large ? '-large' : ''}.webp?v=11`;
// biomes: a map in another land lays its own ground (and close-up tile), snowed over when it snows (_art/biome_snow.py);
// the snow biome is the meadow's own snowy ground. Biome trees keep their leaves (only the meadow's trees have snowy pictures).
export const groundUrl = () => (biomeId(CONFIG.board) === 'meadow' ? weatherPic(groundUrlFor(LARGE())) : biomeId(CONFIG.board) === 'snow' ? groundUrlOf('snow', LARGE()) : weatherPic(groundUrlOf(biomeId(CONFIG.board), LARGE())));
/** Close-up grass (grass-detail.webp, one seamless tile): where the field lies in the ground picture, in map units. */
export const DETAIL_URL = `${import.meta.env.BASE_URL}map/grass-detail.webp?v=1`;
/** biomes: this map's close-up tile, snowy when it snows on the meadow. */
export const detailUrl = () => (biomeId(CONFIG.board) === 'meadow' ? (skyNow().kind === 'snow' ? weatherPic(DETAIL_URL) : DETAIL_URL) : biomeId(CONFIG.board) === 'snow' ? detailUrlOf('snow') : weatherPic(detailUrlOf(biomeId(CONFIG.board))));
export const detailBox = (): number[] => (syncSize(), [GROUND_M - 12, GROUND_M - 12, W + 24, H + 24]);
/** The river, each bridge and each ford are their own pictures laid over the ground, so every map places its own.
 *  Positions and sizes are in the ground picture's own units (map units, origin at the picture's top left). */
export interface GroundPart { key: string; src: string; x: number; y: number; w: number; h: number }
export const PART = (name: string) => `${import.meta.env.BASE_URL}map/${name}.webp?v=2`;
export function groundParts(b: GameConfig['board']): GroundPart[] {
  const out: GroundPart[] = [];
  // Hills, swamps and lakes are painted per map as one see-through picture the size of the ground.
  syncSize();
  const [gw, gh] = groundSize();
  // Lakes alone are always painted on the fly: the old painted lake layer showed sand between its hexes.
  if (b.overlay && !raisedHills(b) && (b.hills?.length || b.swamps?.length)) out.push({ key: `over-${b.overlay}${SUF()}`, src: PART(`over-${b.overlay}${SUF()}`), x: 0, y: 0, w: gw, h: gh });
  // Random maps have no painted overlay: their lakes are painted here, in the same style.
  else if (b.lakes?.length) {
    const lp = lakePart(b.lakes, b);
    if (lp) out.push(lp);
  }
  const rivers = [...(b.riverCol === null ? [] : [{ col: b.riverCol, bridges: b.bridgeRows, fords: b.fordRows ?? [] }]), ...(b.rivers ?? [])];
  for (const rv of rivers) {
    // The river picture was painted for column 12; other columns slide it sideways.
    out.push({ key: `river${rv.col}${SUF()}`, src: PART(riverFile(biomeId(b), LARGE())), x: S * 1.5 * rv.col + S + GROUND_M - 47, y: 0, w: 94, h: gh });
    const at = (row: number, w: number, h: number): [number, number] => [S * 1.5 * rv.col + S + GROUND_M - w / 2, R3 * S * (row + 0.5 * (rv.col & 1)) + (R3 / 2) * S + GROUND_M - h / 2];
    for (const r of rv.fords) {
      const [x, y] = at(r, 94, 56);
      out.push({ key: `ford${rv.col}-${r}`, src: PART('ford'), x, y, w: 94, h: 56 });
    }
    for (const r of rv.bridges) {
      const [x, y] = at(r, 108, 46.5);
      out.push({ key: `bridge${rv.col}-${r}`, src: PART('bridge'), x, y, w: 108, h: 46.5 });
    }
  }
  return out;
}
// ---------- lakes painted on the fly (random maps) ----------
// The same recipe as _art/map_build.py: the lake hexes as one shape, softened into a rounded outline with a gently
// wavy edge, a sandy shore, and water darker towards the banks with painted ripples. Painted once per lake layout.
const lakeCache = new Map<string, GroundPart | null>();
export function lakePart(lakes: [number, number][], b: Pick<GameConfig['board'], 'biome'> = CONFIG.board): GroundPart | null {
  const { water: W0, sand: S0 } = biomeOf(b).lake; // biomes: the lake's water and shore colours
  if (typeof document === 'undefined') return null;
  const id = `lake${SUF()}-${biomeId(b)}-${lakes.map(([c, r]) => `${c}.${r}`).join('_')}`;
  if (lakeCache.has(id)) return lakeCache.get(id)!;
  const centre = (c: number, r: number): Pt => [S * 1.5 * c + S + GROUND_M, R3 * S * (r + 0.5 * (c & 1)) + (R3 / 2) * S + GROUND_M];
  const pad = S + 40;
  const cs = lakes.map(([c, r]) => centre(c, r));
  const x0 = Math.floor(Math.min(...cs.map((p) => p[0])) - pad);
  const y0 = Math.floor(Math.min(...cs.map((p) => p[1])) - pad);
  const w = Math.ceil(Math.max(...cs.map((p) => p[0])) + pad) - x0;
  const h = Math.ceil(Math.max(...cs.map((p) => p[1])) + pad) - y0;
  // 1. The lake hexes on a coarse grid (2 units a cell), then blurred: a smooth "how much lake" field.
  const G = 2;
  const [gw, gh] = [Math.ceil(w / G) + 1, Math.ceil(h / G) + 1];
  let f = new Float32Array(gw * gh);
  const half = (R3 / 2) * S;
  for (const [cx, cy] of cs)
    for (let j = Math.floor((cy - half - y0) / G); j <= Math.ceil((cy + half - y0) / G); j++)
      for (let i = Math.floor((cx - S - x0) / G); i <= Math.ceil((cx + S - x0) / G); i++) {
        if (i < 0 || j < 0 || i >= gw || j >= gh) continue;
        const [dx, dy] = [Math.abs(x0 + i * G - cx), Math.abs(y0 + j * G - cy)];
        if (dy <= half && R3 * dx + dy <= R3 * S) f[j * gw + i] = 1;
      }
  // Three box blurs make a gaussian (about 15 units), enough to round off every hex corner.
  const box = (src: Float32Array, rad: number, horiz: boolean) => {
    const out = new Float32Array(src.length);
    const [n, m] = horiz ? [gh, gw] : [gw, gh];
    for (let a = 0; a < n; a++) {
      let sum = 0;
      const idx = (b: number) => (horiz ? a * gw + b : b * gw + a);
      for (let b = -rad; b <= rad; b++) sum += src[idx(Math.min(m - 1, Math.max(0, b)))];
      for (let b = 0; b < m; b++) {
        out[idx(b)] = sum / (2 * rad + 1);
        sum += src[idx(Math.min(m - 1, b + rad + 1))] - src[idx(Math.max(0, b - rad))];
      }
    }
    return out;
  };
  for (let k = 0; k < 3; k++) f = box(box(f, 7, true), 7, false);
  const field = (x: number, y: number) => {
    const gx = Math.min(gw - 1.001, Math.max(0, x / G));
    const gy = Math.min(gh - 1.001, Math.max(0, y / G));
    const [i, j] = [Math.floor(gx), Math.floor(gy)];
    const [u, v] = [gx - i, gy - j];
    const a = f[j * gw + i], b = f[j * gw + i + 1], c = f[(j + 1) * gw + i], d = f[(j + 1) * gw + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  // Smooth noise for the wavy edge and the water's light and dark.
  const hash = (i: number, j: number) => {
    let q = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ 0x5bd1e995;
    q = Math.imul(q ^ (q >>> 13), 1274126177);
    return ((q ^ (q >>> 16)) >>> 0) / 4294967296;
  };
  const noise = (x: number, y: number) => {
    const [i, j] = [Math.floor(x), Math.floor(y)];
    const [u, v] = [x - i, y - j].map((t) => t * t * (3 - 2 * t));
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v - 0.5;
  };
  // 2. Paint at 2 pixels a unit, like the ground picture.
  const K = 2;
  const cv = document.createElement('canvas');
  cv.width = w * K;
  cv.height = h * K;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(cv.width, cv.height);
  const px = img.data;
  const clamp = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
  for (let py = 0; py < cv.height; py++)
    for (let pxl = 0; pxl < cv.width; pxl++) {
      const [lx, ly] = [pxl / K, py / K];
      const [X, Y] = [x0 + lx, y0 + ly];
      const wob = noise(X / 26, Y / 26) * 0.16 + noise(X / 9, Y / 9) * 0.05;
      const v = field(lx, ly) + wob;
      const shore = clamp((v - 0.4) * 14 + 0.5);
      if (shore <= 0) continue;
      const water = clamp((v - 0.56) * 16 + 0.5);
      // Deeper (lighter) towards the middle, darker along the banks, as on the river.
      const deep = clamp((v - 0.56) / 0.38);
      const ripple = Math.sin((X / 8.5 + 0.55 * Math.sin(Y / 10 + X / 31) + noise(X / 40, Y / 40) * 1.5) * Math.PI * 2);
      const glint = Math.pow(Math.max(0, ripple), 8) * 0.22 - Math.pow(Math.max(0, -ripple), 6) * 0.07;
      const tone = (0.62 + 0.38 * deep) * (1 + noise(X / 60, Y / 60) * 0.12 + glint);
      const [wr, wg, wb] = [W0[0] * tone, W0[1] * tone, W0[2] * tone];
      // Sand at the shore, a touch of grass mixed in so it sits in the meadow.
      const grit = 1 + noise(X / 3, Y / 3) * 0.08;
      const [sr, sg, sb] = [S0[0] * grit, S0[1] * grit, S0[2] * grit];
      const o = (py * cv.width + pxl) * 4;
      px[o] = sr + (wr - sr) * water;
      px[o + 1] = sg + (wg - sg) * water;
      px[o + 2] = sb + (wb - sb) * water;
      px[o + 3] = 255 * shore;
    }
  ctx.putImageData(img, 0, 0);
  const part: GroundPart = { key: id, src: cv.toDataURL('image/png'), x: x0, y: y0, w, h };
  lakeCache.set(id, part);
  return part;
}
/** The picture's size in map units (its CSS size before the camera's transform). */
export const groundSize = (): Pt => (syncSize(), [W + 2 * GROUND_M, H + 2 * GROUND_M]);
/** Carved trees, each drawn from 8 directions (tree-<kind>-<direction>.webp); picture size in pixels, trunk foot at bottom centre. */
export const TREE_KINDS: [string, Pt][] = [['pine', [150, 301]], ['spruce', [126, 285]], ['oak', [198, 251]]];
const DIRS8 = ['front', 'front-left', 'left', 'back-left', 'back', 'back-right', 'right', 'front-right'];
export const TREE_URL = (kind: string, dir: string) => `${import.meta.env.BASE_URL}map/tree-${kind}-${dir}.webp?v=4`;
/** Small standing scenery (prop-N.webp): picture size in pixels and how tall it stands in map units.
 *  Grass tufts and flowers reach a soldier's knee; the bush his waist. */
const PROPS: [Pt, number][] = [[[100, 135], 9], [[160, 117], 8], [[116, 128], 9], [[123, 127], 9], [[134, 115], 17], [[148, 99], 11], [[144, 70], 6], [[135, 150], 6]];
/** Which prop a hex gets: mostly grass, now and then flowers, a bush, stones or mushrooms. */
const PROP_MIX = [0, 1, 0, 1, 0, 2, 1, 3, 0, 4, 1, 6, 0, 5, 2, 7];
const PROP_URL = (i: number) => `${import.meta.env.BASE_URL}map/prop-${i + 1}.webp?v=2`;
/** Carved castle and village pieces, each drawn from 8 directions (sc-<name>-<direction>.webp).
 *  Picture size in pixels (_art/scenery-manifest.json), foot at bottom centre. */
export const SCENERY = { wall: [250, 311], gate: [258, 316], tower: [270, 502], house: [306, 323], house2: [302, 310], reeds: [110, 153], boulder: [196, 94] } as const satisfies Record<string, Pt>;
export type SceneryId = keyof typeof SCENERY;
export const SC_URL = (name: SceneryId, dir: string) => `${import.meta.env.BASE_URL}map/sc-${name}-${dir}.webp?v=2`;
// ---------- pictures ----------
// Every picture on the board (pieces, trees, scenery) is loaded once into a hidden sheet that stays in the page,
// and the board only points at it. Turning a piece to another view is then instant: nothing is loaded, so nothing blinks.
const SHEET = new Map<string, string>();
let sheetEl: SVGSVGElement | null = null;
function sheetId(url: string, w: number, h: number): string | null {
  if (typeof document === 'undefined') return null;
  let id = SHEET.get(url);
  if (id) return id;
  if (!sheetEl) {
    sheetEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sheetEl.setAttribute('width', '0');
    sheetEl.setAttribute('height', '0');
    sheetEl.setAttribute('aria-hidden', 'true');
    sheetEl.style.cssText = 'position:absolute;left:0;top:0;overflow:hidden;pointer-events:none';
    sheetEl.append(document.createElementNS('http://www.w3.org/2000/svg', 'defs'));
    document.body.append(sheetEl);
  }
  id = `pic${SHEET.size}`;
  SHEET.set(url, id);
  const im = document.createElementNS('http://www.w3.org/2000/svg', 'image');
  im.setAttribute('id', id);
  im.setAttribute('href', url);
  im.setAttribute('width', String(w));
  im.setAttribute('height', String(h));
  im.setAttribute('decoding', 'sync');
  sheetEl.firstChild!.appendChild(im);
  return id;
}
/** A picture `nat` pixels big, drawn w x h with its top left at (x, y); `flip` mirrors it left to right about x = 0. */
/** Standing pictures were carved and photographed from a low angle; seen from high above they look too tall, so
 *  they are squashed a little (feet fixed) the steeper the camera looks down (David 2026-11-18). Set per drawing. */
let SQUASH = 1;
function pic(url: string, nat: Pt, x: number, y: number, w: number, h: number, flip = false): string {
  if (SQUASH !== 1) {
    y += h * (1 - SQUASH);
    h *= SQUASH;
  }
  // see-through: remember where this picture lands, so the sprite that drew it knows its screen box.
  lastPic = flip ? [-x - w, y, -x, y + h] : [x, y, x + w, y + h];
  const id = sheetId(url, nat[0], nat[1]);
  if (!id) return `<image decoding="sync" href="${url}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"${flip ? ' transform="scale(-1 1)"' : ''}/>`;
  return `<use href="#${id}" transform="${flip ? 'scale(-1 1) ' : ''}translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(w / nat[0]).toFixed(4)} ${(h / nat[1]).toFixed(4)})"/>`;
}
let groundReady = false;
/** Starts loading the painted ground and trees; `done` runs once they can be drawn. Until then the plain board shows. */
export function loadGround(done: () => void) {
  if (typeof Image === 'undefined') return;
  const all = [groundUrl(), PART('river'), PART('bridge'), PART('ford'), ...TREE_KINDS.flatMap(([k]) => DIRS8.map((d) => TREE_URL(k, d))), ...PROPS.map((_, i) => PROP_URL(i)), ...(Object.keys(SCENERY) as SceneryId[]).flatMap((n) => DIRS8.map((d) => SC_URL(n, d)))].map((src) => {
    const im = new Image();
    im.src = src;
    KEEP.push(im);
    // Loaded is enough to draw. Decoding ahead is only a head start, and a tab in the background never finishes it.
    return new Promise<void>((ok, no) => ((im.onload = () => (ok(), void im.decode?.().catch(() => {}))), (im.onerror = no)));
  });
  Promise.all(all).then(() => ((groundReady = true), done())).catch(() => {});
}
export const hasGround = () => groundReady;
/** CSS transform that lays the ground picture (GROUND_SIZE, origin top left) exactly under the board. */
export function groundTransform(v: View): string {
  const m = lens(v).h;
  // Picture point -> flat map point: shift by the margin; portrait turns the map a quarter turn.
  syncSize();
  const P = v.portrait ? [0, 1, -GROUND_M, -1, 0, W + GROUND_M, 0, 0, 1] : [1, 0, -GROUND_M, 0, 1, -GROUND_M, 0, 0, 1];
  const a = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => m[r * 3] * P[c] + m[r * 3 + 1] * P[3 + c] + m[r * 3 + 2] * P[6 + c]));
  const n = a.map((x) => x / a[8]);
  return `matrix3d(${[n[0], n[3], 0, n[6], n[1], n[4], 0, n[7], 0, 0, 1, 0, n[2], n[5], 0, 1].map((x) => +x.toPrecision(9)).join(',')})`;
}

/** The point on the ground under a screen pixel, for panning and zooming about the cursor. */
export const screenToGround = (v: View, X: number, Y: number): Pt => lens(v).ground(X, Y);

/** Where a point on the ground shows on the screen. */
export const groundToScreen = (v: View, x: number, y: number): Pt => lens(v).pt(x, y);

/** Where a hex's centre is on the flat map, to aim the camera at a piece. */
export const hexOnMap = (h: Hex, v: Pick<View, 'portrait'>): Pt => flat(h, v as View);

/** Centre of a hex on the flat map. Portrait turns the map so Red's edge is at the bottom. */
function flat(h: Hex, v: View): Pt {
  syncSize();
  const x = S * 1.5 * h.col + S;
  const y = R3 * S * (h.row + 0.5 * (h.col & 1)) + (R3 / 2) * S;
  return v.portrait ? [y, W - x] : [x, y];
}

const fmt = ([x, y]: Pt) => `${x.toFixed(1)},${y.toFixed(1)}`;

function corners(h: Hex, v: View, L: Lens, r = S): string {
  return cornerPts(h, v, L, r).map(fmt).join(' ');
}
/** A hex's corners on screen, on top of the hex (lifted when it is raised ground); `z` overrides the height. */
function cornerPts(h: Hex, v: View, L: Lens, r = S, z = L.hexZ(h)): Pt[] {
  const [x, y] = flat(h, v);
  const turn = v.portrait ? Math.PI / 2 : 0;
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + turn;
    return L.pt3(x + r * Math.cos(a), y + r * Math.sin(a), z);
  });
}

// Grass in three close shades so the field doesn't look flat; the shade is fixed per hex.
const GRASS = ['#7fa35a', '#87ab61', '#789b53'];

function fill(t: TerrainId, h: Hex): string {
  if (t === 'plain') return GRASS[(h.col * 7 + h.row * 13 + ((h.col * h.row) % 5)) % GRASS.length];
  if (t === 'forest') return '#3d6530';
  if (t === 'ford') return '#9fb8a0'; // shallows
  if (t === 'hill') return '#a9b56a';
  if (t === 'swamp') return '#5f6f45';
  if (t === 'wall' || t === 'tower') return '#8d8a84';
  if (t === 'gate') return '#a39a8a';
  if (t === 'house') return '#9a5a35';
  return '#5f9ccc'; // river and the water under a bridge
}

/** Something drawn above the ground, painted back to front by its flat depth. */
interface Standing {
  depth: number;
  svg: string;
  /** see-through: the drawn picture's screen box [x0, y0, x1, y1], if it can hide what is behind it. */
  box?: number[] | null;
  /** see-through: a raised hex's outline on screen (its top and sides), instead of a box. */
  hull?: Pt[];
  /** see-through: the hex it stands on ("col,row"), so it never hides its own hex. */
  on?: string;
  /** A soldier: fades only when it hides the selected piece itself, never just a target hex (random soldiers going
   *  see-through while orbiting read as a bug, David 2026-11-18). */
  unit?: boolean;
}

/** A pine: trunk and three stacked tiers, dark on the shaded side and lighter in the sun. */
function pine(tx: number, ty: number, k: number, tall: boolean): string {
  const h = (tall ? 30 : 20) * k;
  const w = (tall ? 14 : 11) * k;
  let out = `<rect x="${tx - 1.6 * k}" y="${ty - 4 * k}" width="${3.2 * k}" height="${5 * k}" fill="#4a3220"/>`;
  for (let i = 0; i < 3; i++) {
    const base = ty - 3 * k - (h / 3.4) * i;
    const ww = w * (1 - i * 0.22);
    const peak = base - h * 0.48;
    out +=
      `<path d="M${tx} ${peak}L${tx + ww} ${base}L${tx - ww} ${base}Z" fill="#1f3d1a"/>` +
      `<path d="M${tx} ${peak}L${tx} ${base}L${tx - ww} ${base}Z" fill="#2f5b27"/>`;
  }
  return out;
}

/** A leafy tree: trunk and a round crown with a sunlit side. */
function oak(tx: number, ty: number, k: number, tall: boolean): string {
  const r = (tall ? 11.5 : 9) * k;
  const cy = ty - (tall ? 14 : 9) * k;
  return (
    `<rect x="${tx - 1.6 * k}" y="${cy}" width="${3.2 * k}" height="${ty - cy}" fill="#4a3220"/>` +
    `<circle cx="${tx}" cy="${cy}" r="${r}" fill="#26491f"/>` +
    `<circle cx="${tx - r * 0.3}" cy="${cy - r * 0.3}" r="${r * 0.62}" fill="#3a6b2e"/>` +
    `<circle cx="${tx - r * 0.45}" cy="${cy - r * 0.45}" r="${r * 0.25}" fill="#4f8a3c" opacity=".8"/>`
  );
}

/** A direction on the flat map as the camera sees it: [to the right, towards the viewer]. Depends only on how far the camera is turned. */
function turned(v: View, dx: number, dy: number): Pt {
  const [cos, sin] = [Math.cos(v.cam.yaw), Math.sin(v.cam.yaw)];
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

/** Which of the 8 sides of something standing on the map the camera sees: 0 when the map's +x points at the viewer, counting round in eighths. */
function seenFrom(v: View): number {
  // Worked out from the camera's turn alone. Measured through the perspective view it shifted a little as the
  // camera slid over the board, and trees near a boundary flipped between two pictures while panning.
  const [rx, ry] = turned(v, 1, 0);
  const a = Math.atan2(rx, ry);
  // Pointing down the screen = facing us (0); pointing down-left = 'front-left' (1), and so on round.
  return ((-Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

/** Small standing scenery on open ground: a grass tuft, flowers, a stone. Fixed per hex, set off-centre so pieces don't hide it. */
function scenery(h: Hex, v: View, L: Lens): Standing[] {
  const seed = hexSeed(h);
  const [x, y] = flat(h, v);
  const a = (seed * 2.399) % (Math.PI * 2);
  const [px, py] = [x + Math.cos(a) * S * 0.62, y + Math.sin(a) * S * 0.62];
  // Now and then a boulder on maps without a river.
  if (seed % 29 === 3 && openMap()) return [{ depth: L.depth(px, py), svg: carved('boulder', px, py, seed, v, L, 0.55).svg, box: lastPic, on: `${h.col},${h.row}` }];
  if (seed % 5 > 1) return [];
  // biomes: this land's own props (a cactus, a fern, a hay bale), or the meadow's tufts.
  const bp = propsOf(CONFIG.board);
  // The lands' little props (pebbles, mini cacti, tumbleweeds) looked out of place: off for now (David, 2026-11-18).
  if (biomeOf(CONFIG.board).props === null || bp) return [];
  const pi = PROP_MIX[seed % PROP_MIX.length];
  // Flowers and mushrooms don't come up through snow.
  if (skyNow().kind === 'snow' && (pi === 2 || pi === 3 || pi === 7)) return [];
  const [[pw, ph], tall] = PROPS[pi];
  const k = L.size(px, py);
  const [sx, sy] = L.pt(px, py);
  const [w, hh] = [(pw / ph) * tall * k, tall * k];
  return [{ depth: L.depth(px, py), svg: pic(PROP_URL(pi), [pw, ph], sx - w / 2, sy - hh + 0.8 * k, w, hh), box: lastPic, on: `${h.col},${h.row}` }];
}

/** A hex's own fixed number, so its scenery never changes between redraws. */
const hexSeed = (h: Hex) => (h.col * 73 + h.row * 151 + ((h.col * h.row) % 7) * 31) % 97;

/** Is there any river on this map? Boulders turn up now and then on maps without one. */
const openMap = () => CONFIG.board.riverCol === null && !CONFIG.board.rivers?.length;

/** One carved piece of scenery standing on a ground point: `turn` eighths turned from its front facing the map's +x,
 *  `scale` its size against the trees' (1 = same carving scale). Its foot lies `near` units towards the viewer, so a
 *  block's front edge, not its middle, sits on that point. */
function carved(name: SceneryId | string, gx: number, gy: number, turn: number, v: View, L: Lens, scale = 1, near = 0): { svg: string; sy: number } {
  // The direction on the flat map that points at the viewer (turned() maps it to straight down the screen).
  const [vx, vy] = [Math.sin(v.cam.yaw), Math.cos(v.cam.yaw)];
  const [px, py] = [gx + vx * near, gy + vy * near];
  const [sx, sy] = L.pt(px, py);
  const k = L.size(px, py);
  const dir = DIRS8[(((seenFrom(v) + turn) % 8) + 8) % 8];
  const size = (SCENERY as Record<string, Pt>)[name] ?? BIOME_SCENERY[name] ?? SCENERY.house; // biomes: a saloon, a yurt, a pagoda...
  // All 8 sides go into the picture sheet the first time this building is drawn, so turning the board never waits
  // for a side to load (that wait was a blink on the saloons).
  if (!SHEETED.has(name)) {
    SHEETED.add(name);
    for (const d of DIRS8) sheetId(scUrl(name, d), size[0], size[1]);
  }
  const f = 0.27 * k * scale;
  const [w, hh] = [size[0] * f, size[1] * f];
  return { svg: pic(scUrl(name, dir), size as unknown as Pt, sx - w / 2, sy - hh + 1.5 * k, w, hh), sy };
}
const SHEETED = new Set<string>();
const scUrl = (name: string, dir: string) => (name in SCENERY ? SC_URL(name as SceneryId, dir) : `${import.meta.env.BASE_URL}map/sc-${name}-${dir}.webp?v=2`);

/** Castle walls, towers, gateways and houses, standing on their hex. In the flat top-down view they are drawn as roofs. */
function building(t: TerrainId, h: Hex, v: View, L: Lens): Standing[] {
  const [x, y] = flat(h, v);
  const seed = hexSeed(h);
  if (!L.tilt) return [];
  const d = L.depth(x, y);
  // A soft shadow on the ground keeps the block standing on the grass.
  const shade = `<polygon points="${corners(h, v, L, S * 0.92)}" fill="#1b1a12" fill-opacity=".22"/>`;
  if (t === 'wall') return [{ depth: d, svg: shade + carved('wall', x, y, 0, v, L, 1.04, S * 0.5).svg, box: lastPic, on: `${h.col},${h.row}` }];
  if (t === 'tower') return [{ depth: d, svg: shade + carved('tower', x, y, seed % 8, v, L, 1, S * 0.45).svg, box: lastPic, on: `${h.col},${h.row}` }];
  if (t === 'gate') {
    // The door faces along the way through: front and back of the gatehouse are the two doorways.
    const g = CONFIG.board.gates?.find((q) => q.col === h.col && q.row === h.row);
    const across = (g?.facing === 'ns') !== v.portrait;
    // Drawn just before a piece standing in the gateway, so the piece shows in the doorway, not behind the stone.
    return [{ depth: d - 1, svg: shade + carved('gate', x, y, across ? 2 : 0, v, L, 1.04, S * 0.5).svg, box: lastPic, on: `${h.col},${h.row}` }];
  }
  if (t === 'house') {
    // biomes: the map's own building for this hex, else one of its land's houses (the meadow: the two village houses).
    const nm = artAt(CONFIG.board, h.col, h.row, 'house', seed);
    return [{ depth: d, svg: shade + carved(nm, x, y, nm in SCENERY ? seed % 8 : [0, 1, 7, 0, 1, 7, 0, 1][seed % 8], v, L, 0.9 * (BUILD_SCALE[nm] ?? 1), S * 0.45).svg, box: lastPic, on: `${h.col},${h.row}` }];
  }
  return [];
}

/** Stone between two neighbouring wall or tower hexes, so the blocks read as one unbroken wall. */
const STONE = new Set<TerrainId>(['wall', 'tower']);
function joints(s: GameState, v: View, L: Lens): Standing[] {
  const out: Standing[] = [];
  for (let r = 0; r < s.board.length; r++)
    for (let c = 0; c < s.board[r].length; c++) {
      if (!STONE.has(s.board[r][c])) continue;
      const a = flat({ col: c, row: r }, v);
      for (const n of neighbors({ col: c, row: r })) {
        // Each pair once; gateways stay open.
        if (n.col < c || (n.col === c && n.row < r) || s.board[n.row]?.[n.col] === undefined || !STONE.has(s.board[n.row][n.col])) continue;
        const b = flat(n, v);
        const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        out.push({ depth: L.depth(mx, my), svg: carved('wall', mx, my, 0, v, L, 0.92, S * 0.4).svg, box: lastPic });
      }
    }
  return out;
}

/** A few boulders on a hex (the map's boulder hexes). Only scenery: pieces stand among them. */
function boulders(h: Hex, v: View, L: Lens): Standing[] {
  const [x, y] = flat(h, v);
  const seed = hexSeed(h);
  // biomes: a red rock, a wagon, a rune stone or a torii stands alone on the hex instead of the three boulders.
  const nm = artAt(CONFIG.board, h.col, h.row, 'boulder', seed);
  if (nm !== 'boulder') return [{ depth: L.depth(x, y), svg: carved(nm, x, y, [0, 1, 7, 2, 6][seed % 5], v, L, 0.85 * (BUILD_SCALE[nm] ?? 1), S * 0.3).svg, box: lastPic, on: `${h.col},${h.row}` }];
  return ([[-12, -8, 0.8], [13, 4, 0.6], [-4, 14, 0.5]] as const).map(([dx, dy, sc], i) => ({
    depth: L.depth(x + dx, y + dy),
    svg: carved('boulder', x + dx, y + dy, seed + i * 3, v, L, sc).svg,
    box: lastPic,
    on: `${h.col},${h.row}`,
  }));
}

/** Flat top-down view: walls, towers and houses as plain roofs seen from above. */
function roof(t: TerrainId, h: Hex, v: View, L: Lens): string {
  const [x, y] = flat(h, v);
  const k = L.size(x, y);
  const [cx, cy] = L.pt(x, y);
  if (t === 'wall') return `<polygon points="${corners(h, v, L, S * 0.86)}" fill="#8d8a84" stroke="#5b5852" stroke-width="${(2 * k).toFixed(1)}"/>`;
  if (t === 'tower') return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(S * 0.95 * k).toFixed(1)}" fill="#97938c" stroke="#5b5852" stroke-width="${(2.5 * k).toFixed(1)}"/><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(S * 0.6 * k).toFixed(1)}" fill="#7d7a73"/>`;
  // A gateway: stone with the wooden door showing in its middle.
  if (t === 'gate') return `<polygon points="${corners(h, v, L, S * 0.86)}" fill="#a39a8a" stroke="#5b5852" stroke-width="${(2 * k).toFixed(1)}"/><polygon points="${corners(h, v, L, S * 0.5)}" fill="#7a5432"/>`;
  if (t === 'house') return `<polygon points="${corners(h, v, L, S * 0.78)}" fill="${hexSeed(h) % 2 ? '#8a4f2c' : '#c9a24e'}" stroke="#5a3a20" stroke-width="${(2 * k).toFixed(1)}"/>`;
  return '';
}

function trees(h: Hex, v: View, L: Lens): Standing[] {
  const [x, y] = flat(h, v);
  // A small grove; which trees are pines or leafy is fixed per hex so the map doesn't flicker.
  const spots = [[-13, -2, 0.95], [12, -5, 0.9], [0, -13, 1], [-6, 12, 0.85], [11, 11, 0.8]] as const;
  // Carved trees are big, so three to a hex; the plain drawn ones are small, so five.
  return (groundReady ? spots.slice(0, 3) : spots).map(([dx, dy, sz], i) => {
    const [tx, ty] = L.pt(x + dx, y + dy);
    const k = L.size(x + dx, y + dy) * sz;
    const leafy = (h.col * 3 + h.row * 5 + i) % 3 === 0;
    const shadow = `<ellipse cx="${tx + 4 * k}" cy="${ty + 1}" rx="${10 * k}" ry="${3.5 * k}" fill="#000" opacity="${L.tilt ? 0.3 : 0.18}"/>`;
    if (groundReady) {
      // A carved wooden tree: the same kind, turned the same way, every time for this spot.
      // It is drawn from the side the camera sees it from, so it turns as the camera orbits.
      const seed = h.col * 7 + h.row * 11 + i * 5;
      const kinds = treeKinds(CONFIG.board); // biomes: cacti, palms, cypresses... (the meadow: pine, spruce, oak)
      const [kind, size] = kinds[seed % kinds.length];
      const bio = biomeId(CONFIG.board);
      // All 8 sides into the picture sheet on first sight, so turning never waits for a side to load (a blink).
      if (bio !== 'meadow' && !SHEETED.has(`tree:${bio}:${kind}`)) {
        SHEETED.add(`tree:${bio}:${kind}`);
        for (const d of DIRS8) sheetId(treeUrlOf(bio, kind, d), size[0], size[1]);
      }
      const dir = L.tilt ? DIRS8[(seenFrom(v) + (seed % 8)) % 8] : 'front';
      const f = (L.tilt ? 0.27 : 0.12) * k * (TREE_SCALE[kind] ?? 1); // biomes: a cactus stands lower than a pine // the tallest tree stands about one and a half soldiers high
      const [w, hh] = [size[0] * f, size[1] * f];
      return { depth: L.depth(x + dx, y + dy), svg: shadow + pic(biomeId(CONFIG.board) === 'meadow' ? weatherPic(TREE_URL(kind, dir)) : treeUrlOf(biomeId(CONFIG.board), kind, dir), size, tx - w / 2, ty - hh + 2 * k, w, hh), box: lastPic, on: `${h.col},${h.row}` };
    }
    return { depth: L.depth(x + dx, y + dy), svg: shadow + (leafy ? oak(tx, ty, k, L.tilt) : pine(tx, ty, k, L.tilt)) };
  });
}

function bridge(h: Hex, v: View, L: Lens): Standing {
  const [x, y] = flat(h, v);
  // The deck runs across the river: along x in landscape, along y once the map is turned.
  const [hw, hh] = v.portrait ? [11, 34] : [34, 11];
  const quad = [L.pt(x - hw, y - hh), L.pt(x + hw, y - hh), L.pt(x + hw, y + hh), L.pt(x - hw, y + hh)];
  const rise = L.tilt ? 5 * L.size(x, y) : 0;
  const deck = quad.map(([px, py]) => fmt([px, py - rise])).join(' ');
  const side = L.tilt ? `<polygon points="${fmt([quad[3][0], quad[3][1] - rise])} ${fmt([quad[2][0], quad[2][1] - rise])} ${fmt(quad[2])} ${fmt(quad[3])}" fill="#6b4a2b"/>` : '';
  return { depth: L.depth(x, y), svg: `${side}<polygon points="${deck}" fill="#a77b4f" stroke="#6b4a2b" stroke-width="1.5"/>` };
}

function riverRipple(h: Hex, v: View, L: Lens): string {
  const [x, y] = flat(h, v);
  // A short wavy line along the river's direction.
  const pts: Pt[] = [-18, -6, 6, 18].map((d, i) => {
    const wob = i % 2 ? 5 : -5;
    return v.portrait ? L.pt(x + d, y + wob) : L.pt(x + wob, y + d);
  });
  return `<polyline points="${pts.map(fmt).join(' ')}" stroke="#cfe6f6" stroke-width="2" fill="none" opacity=".75" stroke-linejoin="round"/>`;
}

export interface Overlay {
  selected: string | null;
  reach: Map<string, Reach>;
  targets: Map<string, AttackPreview>; // by unit id
  /** Deployment zone to shade, and whose it is. */
  zone: { owner: Player; hexes: Hex[] } | null;
  /** Units of this side are hidden (the other player is setting up in secret). */
  hide: Player | null;
  /** The side to move's pieces that can't do anything more this turn: drawn dimmed. */
  spent: Set<string>;
  /** What the other side did on its last turn: moves as arrows, kills as crosses. */
  trail: { moves: { from: Hex; to: Hex; owner?: Player; old?: boolean }[]; kills: Hex[] };
  /** Hexes the selected archer can shoot at (in range and in sight). */
  rings: Hex[];
  /** Threat view: hexes the enemy could hit on its next turn. */
  danger: Hex[];
  /** A move waiting for a second tap: the route to show, ending at the destination. */
  route: Hex[];
  /** camera v2: your pieces an enemy could reach and hit next turn (unit ids): a soft red pulse under each. */
  threat?: Set<string>;
}

/** One-off effects for what just happened: they play once, on the render right after. */
export interface Effects {
  /** Unit id -> where it stood before, so it can slide to its new hex. */
  from: Map<string, Hex>;
  hits: {
    at: Hex; damage: number; killed: boolean; type: UnitTypeId; owner: Player; shotFrom: Hex | null;
    /** The attacker's type and where it struck from; whether it stepped into the hex after a kill. */
    by?: UnitTypeId; from?: Hex; advanced?: boolean;
    /** Drawn again only for its arrow still in flight (no flash, number or fall). */
    flightOnly?: boolean;
  }[];
  /** Unit id -> every hex of the walk it just made, start first, so it walks the route step by step. */
  walks: Map<string, Hex[]>;
}

export const NO_EFFECTS: Effects = { from: new Map(), hits: [], walks: new Map() };

/** Time for one step of a walk, in ms. */
export const STEP_MS = 130;
/** Pieces that fire guns: a quick tracer and smoke instead of an arrow in flight. */
const GUNS = new Set<UnitTypeId>(['gunslinger', 'championGun', 'rifleman', 'cowboy', 'deputy', 'lineInfantry', 'skirmisher', 'cannon', 'bomber', 'crossbow', 'longRifle', 'rocket']);
/** When the blow lands after the attack starts (seconds): arrows fly, bullets and blades are quick. */
/** How long an arrow is in the air (seconds): slow enough to follow with the eye. */
export const ARROW_S = 0.65;
const impact = (h: Effects['hits'][number]) => (h.shotFrom ? (h.by && GUNS.has(h.by) ? 0.22 : ARROW_S) : 0.14);
const same = (a: Hex | undefined, b: Hex) => !!a && a.col === b.col && a.row === b.row;
/** Eight short rays: the flash of a blow landing. */
const RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4 + 0.2;
  return `M${(5 * Math.cos(a)).toFixed(1)} ${(5 * Math.sin(a)).toFixed(1)}L${(12 * Math.cos(a)).toFixed(1)} ${(12 * Math.sin(a)).toFixed(1)}`;
}).join('');

/** Which side of its figure a piece shows: each army faces the enemy, and the camera's turn decides
 *  whether we see it from the front, a front diagonal, the side, a back diagonal or the back, in
 *  45° steps. Turned views are drawn facing left and mirrored when the piece faces right. */
type ViewId = 'front' | 'fdiag' | 'side' | 'bdiag' | 'back';
interface Look { view: ViewId; flip: boolean; /** The true 8-way direction, for pieces drawn from all 8 sides. */ dir: string }
const VIEWS: ViewId[] = ['front', 'fdiag', 'side', 'bdiag', 'back'];

function lookFor(owner: Player, v: View, s: GameState): Look {
  // Measured on screen, not worked out: from the middle of the board, step towards the enemy's
  // side (red starts in the first columns, blue in the last) and see which way that step points.
  const mid = Math.floor(s.board.length / 2);
  const cols = s.board[0].length;
  const redSide = flat({ col: 0, row: mid }, v);
  const blueSide = flat({ col: cols - 1, row: mid }, v);
  const [from, to] = owner === 'red' ? [redSide, blueSide] : [blueSide, redSide];
  return lookAlong(v, from, to);
}

/** The side of its figure a piece shows when it faces from map point `from` towards map point `to`. */
function lookAlong(v: View, from: Pt, to: Pt): Look {
  const [rx, ry] = turned(v, to[0] - from[0], to[1] - from[1]); // ry > 0 = towards the viewer
  const turn = Math.atan2(Math.abs(rx), ry); // 0 = facing us, π = facing away
  const n = Math.round(turn / (Math.PI / 4)); // 0 front, 1 front diagonal, 2 side, 3 back diagonal, 4 back
  const side = rx > 0 ? 'right' : 'left';
  const dir = ['front', `front-${side}`, side, `back-${side}`, 'back'][n];
  return { view: VIEWS[n], flip: rx > 0, dir };
}

/** Forest cover: a small leaf beside a target's damage badge, the trees take 1 off the shot. */
const COVER_LEAF = '<g transform="translate(-13 -9)" class="cover-leaf"><circle r="7.5" fill="#2f6b2a" stroke="#d9f2c4" stroke-width="1.2"/><path d="M-3.6 3.4C-3.8-1.8.2-4.6 4-4.2 4.2.6.8 3.8-3.6 3.4ZM-3.6 3.4L1.6-1.6" fill="#bfe8a0" stroke="#173d14" stroke-width=".8"/></g>';

/** A piece's own facing: the way it last walked or struck (kept by the engine until it moves again),
 *  else its army's facing towards the enemy. Snapped to the 8 views like everything else. */
function lookOf(u: Unit, v: View, looks: Record<Player, Look>): Look {
  if (!u.face) return looks[u.owner];
  const [a, b] = [flat(u.face[0], v), flat(u.face[1], v)];
  return a[0] === b[0] && a[1] === b[1] ? looks[u.owner] : lookAlong(v, a, b);
}

/** Which straight views of an aiming piece show it shooting sideways (see figure()). */
const AIMS_FORWARD: Record<string, ViewId[]> = {
  'comanche/horseArcher': ['front', 'back'],
  'mongols/horseArcher': ['front', 'back'],
};

/** The carved arrow, drawn from 5 angles (all pointing right, down or up), and each picture's size in pixels. */
const ARROWS: Record<string, [number, number]> = {"side": [234, 50], "toward-diag": [234, 155], "toward": [63, 236], "away-diag": [233, 151], "away": [53, 236]};
const ARROW_VIEWS = ['toward', 'toward-diag', 'side', 'away-diag', 'away'];

let BOARD_SEQ = 0;

/** Screen direction shadows fall in (away from the sun), set per render. */
let SHADOW: Pt = [0.6, 0.4];

/** Pixels of figure art per map unit at size 1: pictures are exported with a 150 px base; a foot figure stands about 49 units tall. */
const ART_SCALE = 0.26 * 80 / 150;
/** Pieces that share another piece's carved figure. */
const ART_OF: Record<string, string> = { deputy: 'lightInfantry' };
const SPRITE_URL = (fac: string, type: string, view: string) => `${import.meta.env.BASE_URL}pieces/${fac}/${ART_OF[type] ?? type}-${view}.webp?v=${ART_VERSION}`;

/** side colours: the ring on the ground round a piece's base. With side colours on (src/ui/sides.ts) it says whose
 *  piece it is: yours solid and bright, the enemy's dashed and darker, over a thin dark line so it reads on any ground. */
function baseRing(owner: Player, k: number): string {
  const ell = `cx="0" cy="${k.toFixed(1)}" rx="${(17 * k).toFixed(1)}" ry="${(5.6 * k).toFixed(1)}" fill="none"`;
  if (!sideColorsOn()) return `<ellipse ${ell} stroke="${armyColor(owner)}" stroke-width="${(2 * k).toFixed(1)}" opacity=".9"/>`;
  const dash = sideDashed(owner) ? ` stroke-dasharray="${(5 * k).toFixed(1)} ${(3 * k).toFixed(1)}"` : '';
  return `<ellipse ${ell} stroke="#140d06" stroke-width="${(4.2 * k).toFixed(1)}" opacity=".55"/><ellipse ${ell} stroke="${sideColor(owner)}" stroke-width="${(2.6 * k).toFixed(1)}"${dash}/>`;
}

/** The carved figure for this piece in 2.5D, if its army has one. */
function figure(type: UnitTypeId, owner: Player, hp: number, k: number, look: Look): string | null {
  const fac = sides[owner];
  const set = SPRITES[fac]?.[ART_OF[type] ?? type];
  if (!set) return null;
  // Pieces that shoot forward can't be drawn aiming straight at (or away from) the camera, so head-on they
  // show their diagonal instead, where the weapon clearly points the way they face.
  // Pieces drawn from all 8 sides: the true picture, never mirrored, so nothing switches hands.
  const true8 = set[look.dir];
  if (true8) {
    const [w8, h8] = [true8[0] * ART_SCALE * k, true8[1] * ART_SCALE * k];
    // Views whose base centre sits higher in the picture than usual (a rider's oval base from a diagonal) are drawn lower,
    // so the base, not the picture's bottom edge, stands on the hex (src/ui/spritefix.ts, written by _art/cav_fix.py).
    const drop8 = (DROP[`${fac}/${ART_OF[type] ?? type}/${look.dir}`] ?? 0) * ART_SCALE * k;
    const full8 = maxHp(type);
    const bar8 = hp > 0 && hp < full8 ? `<g transform="translate(0 ${(7 * k).toFixed(1)}) scale(${(0.7 * k).toFixed(3)}) translate(0 -16)">${healthBar(hp, full8)}</g>` : '';
    return `${castShadow(k)}<ellipse cx="0" cy="${k.toFixed(1)}" rx="${(13 * k).toFixed(1)}" ry="${(4 * k).toFixed(1)}" fill="#000" opacity=".35"/>
    ${baseRing(owner, k)}
    ${pic(SPRITE_URL(fac, type, look.dir), true8, -w8 / 2, -h8 + 4 * k + drop8, w8, h8)}${bar8}`;
  }
  const wanted: ViewId = AIMS_FORWARD[`${fac}/${type}`]?.includes(look.view) ? (look.view === 'front' ? 'fdiag' : set.bdiag ? 'bdiag' : 'side') : look.view;
  // A missing diagonal falls back to the straight view on the same side (front or back).
  const view: ViewId = set[wanted] ? wanted : wanted === 'fdiag' ? 'front' : wanted === 'bdiag' ? 'back' : 'side';
  const size = set[view];
  if (!size) return null;
  const [w, h] = [size[0] * ART_SCALE * k, size[1] * ART_SCALE * k];
  const full = maxHp(type);
  const bar = hp > 0 && hp < full ? `<g transform="translate(0 ${(7 * k).toFixed(1)}) scale(${(0.7 * k).toFixed(3)}) translate(0 -16)">${healthBar(hp, full)}</g>` : '';
  const flip = view !== 'front' && view !== 'back' && look.flip ? ' transform="scale(-1 1)"' : '';
  return `${castShadow(k)}<ellipse cx="0" cy="${k.toFixed(1)}" rx="${(13 * k).toFixed(1)}" ry="${(4 * k).toFixed(1)}" fill="#000" opacity=".35"/>
    ${baseRing(owner, k)}
    ${pic(SPRITE_URL(fac, type, view), size, -w / 2, -h + 4 * k, w, h, flip !== '')}${bar}`;
}

/** Loaded pictures are held here for good: a picture nothing points at is dropped by the browser and
 *  must be read again the next time the camera turns to it, which showed as pieces blinking. */
const KEEP: HTMLImageElement[] = [];
let preloaded = '';
/** Starts loading both armies' figures, once per pair of armies, so pieces don't pop in. */
export function preloadFigures() {
  const key = `${sides.red}/${sides.blue}`;
  if (key === preloaded || typeof Image === 'undefined') return;
  preloaded = key;
  const hold = (src: string) => { const im = new Image(); im.src = src; im.decode?.().catch(() => {}); KEEP.push(im); };
  for (const av of ARROW_VIEWS) hold(`${import.meta.env.BASE_URL}pieces/arrow-${av}.webp?v=${ART_VERSION}`);
  for (const fac of [sides.red, sides.blue]) {
    for (const [type, set] of Object.entries(SPRITES[fac] ?? {})) {
      for (const [view, nat] of Object.entries(set)) if (nat) sheetId(SPRITE_URL(fac, type, view), nat[0], nat[1]);
    }
  }
}

/** A piece: flat it lies on the hex; in 2.5D it is its carved figure standing on the hex (or, for a
 *  piece without one, the counter itself standing upright, with a thin edge underneath and a shadow). */
function piece(type: UnitTypeId, owner: Player, hp: number, L: Lens, [sx, sy]: Pt, k: number, cls = '', look?: Look): string {
  const fig = L.tilt && look ? figure(type, owner, hp, k, look) : null;
  if (fig) return `<g transform="translate(${sx} ${sy})">${baseGlow(k)}<g class="${cls}">${fig}</g></g>`;
  const counter = unitSymbol(type, owner, hp);
  if (!L.tilt) return `<g transform="translate(${sx} ${sy}) scale(${k.toFixed(3)})">${baseGlow(1, true)}${flatRing(owner)}<g class="${cls}">${counter}</g></g>`;
  return `<g transform="translate(${sx} ${sy})"><g class="${cls}">
    <ellipse cx="${5 * k}" cy="${1 * k}" rx="${19 * k}" ry="${5.5 * k}" fill="#000" opacity=".35"/>
    <rect x="${-16.4 * k}" y="${-4 * k}" width="${32.8 * k}" height="${4 * k}" rx="${1.5 * k}" fill="${sideColorsOn() ? sideColor(owner) : armyColor(owner)}" filter="${sideColorsOn() ? 'none' : 'brightness(.6)'}" opacity=".9"/>
    <g transform="translate(0 ${-15.5 * k}) scale(${0.82 * k})">${counter}</g>
  </g></g>`;
}

/** side colours: a flat counter (seen from straight above) gets a frame in its side colour round its army-coloured box. */
function flatRing(owner: Player): string {
  if (!sideColorsOn()) return '';
  const dash = sideDashed(owner) ? ' stroke-dasharray="6 3.5"' : '';
  return `<rect x="-23.5" y="-17.5" width="47" height="35" rx="5" fill="none" stroke="#140d06" stroke-width="5" opacity=".5"/><rect x="-23.5" y="-17.5" width="47" height="35" rx="5" fill="none" stroke="${sideColor(owner)}" stroke-width="3"${dash}/>`;
}

/** Height of a piece's middle above its hex, for badges, numbers and arrows. */
const lift = (L: Lens, k: number) => (L.tilt ? 20 * k : 3 * k);

// ---------- weather & light ----------
// The battle's time of day and weather (CONFIG.weather, set from the battle settings). The drawing changes only a
// little for them: the sun layer's colours, longer shadows at dusk, a soft glow under each piece at night, and
// snowy pictures of the ground and trees. Tints, puddles, falling rain and snow and fog are page layers around the
// board (weather.ts), so nothing here costs a filter per piece.
export const skyNow = (): { time: TimeOfDay; kind: WeatherKind } => CONFIG.weather ?? { time: 'day', kind: 'clear' };
/** The snowy picture (name-snow.webp, made by _art/snow_build.py) of a ground, close-up grass or tree picture when it snows. */
export const weatherPic = (url: string) => (skyNow().kind === 'snow' ? url.replace(/\.webp(\?|$)/, '-snow.webp$1') : url);
/** The pictures a battle in this weather needs, to fetch ahead (the setup screen asks for them as snow is picked). */
export const weatherPicsFor = (kind: WeatherKind, large: boolean): string[] =>
  kind !== 'snow' ? [] : [groundUrlFor(large), DETAIL_URL, ...TREE_KINDS.flatMap(([k]) => DIRS8.map((d) => TREE_URL(k, d)))].map((u) => u.replace(/\.webp(\?|$)/, '-snow.webp$1'));
/** The shadow a standing piece throws: the usual one by day, long and thin away from a low sun at dusk, faint by moonlight. */
function castShadow(k: number): string {
  const { time, kind } = skyNow();
  const soft = kind === 'fog' || kind === 'rain' ? 0.55 : 1; // no sun to speak of
  if (time !== 'dusk') {
    const op = (time === 'night' ? 0.16 : 0.32) * soft;
    return `<ellipse cx="${(SHADOW[0] * 11 * k).toFixed(1)}" cy="${(k + SHADOW[1] * 5 * k).toFixed(1)}" rx="${(21 * k).toFixed(1)}" ry="${(6.5 * k).toFixed(1)}" fill="#1b2410" opacity="${op.toFixed(2)}" class="cast"/>`;
  }
  // Dusk: stretched along the way shadows fall, reaching about two pieces' width.
  const deg = (Math.atan2(SHADOW[1] * 0.45, SHADOW[0]) * 180) / Math.PI;
  const len = 30 * k;
  return `<ellipse transform="translate(${(SHADOW[0] * len).toFixed(1)} ${(k + SHADOW[1] * 0.45 * len).toFixed(1)}) rotate(${deg.toFixed(1)})" rx="${(36 * k).toFixed(1)}" ry="${(6 * k).toFixed(1)}" fill="#2a1630" opacity="${(0.36 * soft).toFixed(2)}" class="cast"/>`;
}
/** Night: a soft warm glow on the ground round each piece's base (like a lantern at its feet), so pieces stay easy to find. */
function baseGlow(k: number, flat = false): string {
  if (skyNow().time !== 'night') return '';
  return flat
    ? `<circle r="24" fill="url(#wxglow)"/>`
    : `<ellipse cx="0" cy="${k.toFixed(1)}" rx="${(40 * k).toFixed(1)}" ry="${(14 * k).toFixed(1)}" fill="url(#wxglow)"/>`;
}
/** Paint servers for the weather: the glow's gradient (one id shared by every board drawing). */
function weatherDefs(): string {
  return skyNow().time === 'night' ? `<radialGradient id="wxglow"><stop offset="0" stop-color="#ffe2a0" stop-opacity=".95"/><stop offset=".5" stop-color="#ffcc78" stop-opacity=".5"/><stop offset="1" stop-color="#ffb860" stop-opacity="0"/></radialGradient>` : '';
}
/** The sun layer's colours: warm sun from the far-left corner and cool shade opposite; golden and stronger at dusk,
 *  silver moonlight at night, flat and grey under cloud. */
function sunStops(): string {
  const { time, kind } = skyNow();
  const st = (a: [string, number], b: [string, number], c: [string, number], d: [string, number]) =>
    ([[0, a], [0.45, b], [0.75, c], [1, d]] as [number, [string, number]][]).map(([o, [col, op]]) => `<stop offset="${o}" stop-color="${col}" stop-opacity="${op}"/>`).join('');
  const overcast = kind === 'rain' || kind === 'fog';
  if (time === 'dusk') return overcast ? st(['#f0a860', 0.14], ['#e89858', 0.05], ['#3a2a50', 0.12], ['#24163e', 0.3]) : st(['#ff8a6a', 0.08], ['#ffb080', 0.02], ['#3c2a64', 0.16], ['#1c1440', 0.42]);
  if (time === 'night') return st(['#d8e4ff', overcast ? 0.04 : 0.12], ['#a8c0ff', 0.03], ['#0a1430', 0.14], ['#050a1e', 0.34]);
  if (overcast) return st(['#e0e6ea', 0.06], ['#e0e6ea', 0.02], ['#1e2c3a', 0.08], ['#14202c', 0.22]);
  if (kind === 'snow') return st(['#fff2d8', 0.12], ['#fff2d8', 0.03], ['#30466e', 0.1], ['#1e2e52', 0.26]);
  return st(['#e8a948', 0.13], ['#e8a948', 0.03], ['#1e2c4a', 0.1], ['#14203a', 0.3]);
}

// ---------- raised high ground ----------
// Hill hexes stand up off the table as carved terraces: the meadow on top, lifted by one step (two for a summit
// ringed by hills), with turf-lipped earthen sides where the ground drops away. Raised neighbours merge into one
// plateau (no wall between them). Pieces, trees and tufts on a raised hex stand on its top: the lens lifts every
// point that lies on one. The old painted hill overlay is not used while this is on.

/** Height of each step above the table, in map units (a foot soldier stands about 49 tall). */
const RISE = [0, 15, 26];
/** A hill hex whose every neighbour is a hill rises a second step. */
const SUMMITS = true;

/** The map's hills are drawn raised (instead of the painted overlay) once the ground pictures are loaded. */
// A drawn map paints its lakes into its overlay along with the hills, so raising them would leave painted hills
// behind; a random map's lakes are painted separately (lakePart), so its hills can rise next to them.
export const raisedHills = (b: GameConfig['board']): boolean => !!b.hills?.length && !b.swamps?.length && !(b.overlay && b.lakes?.length);

/** Heights of the raised hexes for one render. */
interface Terraces {
  /** Height of the ground at a flat map point. */
  at: (x: number, y: number) => number;
  /** Height of a hex's top. */
  hex: (h: Hex) => number;
  list: Hex[];
}

function terraces(s: GameState, v: View): Terraces | null {
  if (!groundReady || !raisedHills(CONFIG.board)) return null;
  const rows = s.board.length;
  const cols = s.board[0]?.length ?? 0;
  const isHill = (c: number, r: number) => s.board[r]?.[c] === 'hill';
  const level = new Map<number, number>();
  const list: Hex[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!isHill(c, r)) continue;
      const ring = neighbors({ col: c, row: r }).filter((n) => n.row >= 0 && n.row < rows && n.col >= 0 && n.col < cols);
      level.set(r * 1000 + c, SUMMITS && ring.length === 6 && ring.every((n) => isHill(n.col, n.row)) ? 2 : 1);
      list.push({ col: c, row: r });
    }
  if (!list.length) return null;
  const hex = (h: Hex) => RISE[level.get(h.row * 1000 + h.col) ?? 0];
  // Which hex a flat point lies in: the nearest hex centre (hexes are exactly the cells of their centres).
  const at = (px: number, py: number) => {
    const [x, y] = v.portrait ? [W - py, px] : [px, py];
    const c0 = Math.round((x - S) / (1.5 * S));
    let best = Infinity;
    let z = 0;
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const r0 = Math.round((y - (R3 / 2) * S) / (R3 * S) - 0.5 * (c & 1));
      for (let r = r0 - 1; r <= r0 + 1; r++) {
        const d = (x - (S * 1.5 * c + S)) ** 2 + (y - (R3 * S * (r + 0.5 * (c & 1)) + (R3 / 2) * S)) ** 2;
        if (d < best) {
          best = d;
          z = c >= 0 && r >= 0 && c < cols && r < rows ? RISE[level.get(r * 1000 + c) ?? 0] : 0;
        }
      }
    }
    return best <= S * S ? z : 0;
  };
  return { at, hex, list };
}

/** Direction the sun shines from, on the flat map: the board's far-left corner, as the light layer paints it. */
function sunDir(v: View): Pt {
  const [fw, fh] = mapSize(v.portrait);
  const [dx, dy] = [-0.75 * fw, -0.85 * fh];
  const l = Math.hypot(dx, dy);
  return [dx / l, dy / l];
}

/** The shadow the raised ground throws on the table: every raised hex's footprint slid away from the sun,
 *  as one shape (so overlapping hexes don't darken twice). Drawn on the ground, under everything. */
function raisedShadow(T: Terraces, v: View, L: Lens): string {
  const [sx, sy] = sunDir(v);
  const turn = v.portrait ? Math.PI / 2 : 0;
  const outline = (x: number, y: number, r: number) =>
    `M${Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i + turn;
      return fmt(L.pt3(x + r * Math.cos(a), y + r * Math.sin(a), 0));
    }).join('L')}Z`;
  let cast = '';
  let foot = '';
  for (const h of T.list) {
    const [x, y] = flat(h, v);
    const z = T.hex(h);
    cast += outline(x - sx * z * 1.1, y - sy * z * 1.1, S * 1.02);
    foot += outline(x, y, S + 3.5);
  }
  // A soft dark ring where the sides meet the ground, then the shadow itself.
  return `<path d="${foot}" fill="#1b2410" fill-opacity=".2"/><path d="${cast}" fill="#1b2410" fill-opacity=".3"/>`;
}

const rgb = (c: [number, number, number], lum: number) => `rgb(${c.map((n) => Math.max(0, Math.min(255, Math.round(n * lum)))).join(',')})`;
const SOIL: [number, number, number] = [172, 124, 76];
const TURF: [number, number, number] = [104, 136, 58];

/** One raised hex: its visible cliff faces, its meadow top (the same ground painting, lifted), a lit rim along
 *  its edges, then `extra` (its tap shape, highlights and marks, which must lie on the top, not under it). */
function raisedHex(h: Hex, T: Terraces, v: View, L: Lens, u: string, groundId: string | null, detail: number, extra: string): Standing {
  const [x, y] = flat(h, v);
  const z = T.hex(h);
  const turn = v.portrait ? Math.PI / 2 : 0;
  const [sx, sy] = sunDir(v);
  const top = cornerPts(h, v, L, S, z);
  const k = L.size3(x, y, z);
  let faces = '';
  let rim = '';
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * (i + 0.5) + turn; // this edge's outward direction
    const [nx, ny] = [Math.cos(a), Math.sin(a)];
    const low = T.at(x + nx * R3 * S, y + ny * R3 * S); // the neighbour's height
    if (low >= z) continue;
    const ca = (Math.PI / 3) * i + turn;
    const cb = (Math.PI / 3) * (i + 1) + turn;
    const A: Pt = [x + S * Math.cos(ca), y + S * Math.sin(ca)];
    const B: Pt = [x + S * Math.cos(cb), y + S * Math.sin(cb)];
    const lit = nx * sx + ny * sy; // 1 = facing the sun
    if (!L.tilt) {
      // Straight down: no sides show. A thin light edge on the sunny side and a dark one in the shade reads as a step.
      rim += `<line x1="${fmt(top[i]).replace(',', '" y1="')}" x2="${fmt(top[(i + 1) % 6]).replace(',', '" y2="')}" stroke="${lit > 0 ? '#f4efc4' : '#24301a'}" stroke-opacity="${(0.25 + 0.4 * Math.abs(lit)).toFixed(2)}" stroke-width="${(1.6 * k).toFixed(1)}" stroke-linecap="round"/>`;
      continue;
    }
    // Only sides that face the camera are drawn (the top hides the rest).
    const [mx, my] = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    if ((L.eye[0] - mx) * nx + (L.eye[1] - my) * ny <= 0) continue;
    const lum = 0.8 + 0.26 * lit;
    const P = (p: Pt, zz: number) => L.pt3(p[0], p[1], zz);
    const lerp = (t: number): Pt => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    const quad = (z1: number, z2: number) => [P(A, z1), P(B, z1), P(B, z2), P(A, z2)].map(fmt).join(' ');
    const hgt = z - low;
    const seed = (h.col * 31 + h.row * 17 + i * 7) % 13;
    // The earth, darker towards its foot where it meets the ground below.
    faces += `<polygon points="${quad(z, low)}" fill="${rgb(SOIL, lum)}"/><polygon points="${quad(z, low)}" fill="url(#${u}cliff)"/>`;
    // A carved layer line across the earth, gently wavering.
    const band = Array.from({ length: 6 }, (_, j) => fmt(P(lerp(j / 5), low + hgt * (0.55 + 0.06 * Math.sin(seed + j * 2.1)))));
    faces += `<polyline points="${band.join(' ')}" fill="none" stroke="${rgb(SOIL, lum * 0.78)}" stroke-width="${(0.7 * k).toFixed(1)}" stroke-linecap="round"/>`;
    // The turf lip: grass hanging a little over the edge, its lower edge scalloped like carved tufts.
    const lip = Math.min(2.4, hgt * 0.22);
    const under = Array.from({ length: 9 }, (_, j) => {
      const t = 1 - j / 8;
      return fmt(P(lerp(t), z - lip * (0.75 + 0.45 * Math.abs(Math.sin(seed * 1.7 + t * 9.4)))));
    });
    faces += `<polygon points="${fmt(P(A, z))} ${fmt(P(B, z))} ${under.join(' ')}" fill="${rgb(TURF, lum)}"/>`;
    // Sunlight catching the top edge.
    rim += `<line x1="${fmt(top[i]).replace(',', '" y1="')}" x2="${fmt(top[(i + 1) % 6]).replace(',', '" y2="')}" stroke="#eef0b8" stroke-opacity="${(0.2 + 0.25 * Math.max(0, lit)).toFixed(2)}" stroke-width="${(1.1 * k).toFixed(1)}" stroke-linecap="round"/>`;
  }
  // The top: the ground painting laid on the lifted plane. Locally the lift is an affine map, so the picture
  // goes through one matrix per hex, clipped a hair wider than the hex so neighbouring tops meet without a seam.
  let surface = '';
  const clip = cornerPts(h, v, L, S + 0.8, z).map(fmt).join(' ');
  if (groundId) {
    const toFlat = (gu: number, gv: number): Pt => (v.portrait ? [gv - GROUND_M, W + GROUND_M - gu] : [gu - GROUND_M, gv - GROUND_M]);
    const [u0, v0] = v.portrait ? [W + GROUND_M - y, x + GROUND_M] : [x + GROUND_M, y + GROUND_M];
    const scr = (gu: number, gv: number) => L.pt3(...toFlat(gu, gv), z);
    const d = S / 2;
    const [pu1, pu0, pv1, pv0, p0] = [scr(u0 + d, v0), scr(u0 - d, v0), scr(u0, v0 + d), scr(u0, v0 - d), scr(u0, v0)];
    const m = [(pu1[0] - pu0[0]) / (2 * d), (pu1[1] - pu0[1]) / (2 * d), (pv1[0] - pv0[0]) / (2 * d), (pv1[1] - pv0[1]) / (2 * d)];
    const e = p0[0] - m[0] * u0 - m[2] * v0;
    const f = p0[1] - m[1] * u0 - m[3] * v0;
    const db = detailBox();
    surface =
      `<clipPath id="${u}r${h.col}_${h.row}"><polygon points="${clip}"/></clipPath>` +
      `<g clip-path="url(#${u}r${h.col}_${h.row})"><g transform="matrix(${[...m, e, f].map((n) => +n.toFixed(5)).join(' ')})"><use href="#${groundId}"/>` +
      (detail > 0 ? `<rect x="${db[0]}" y="${db[1]}" width="${db[2]}" height="${db[3]}" fill="url(#${u}gd)" opacity="${detail.toFixed(2)}"/>` : '') +
      `</g></g>`;
  } else surface = `<polygon points="${clip}" fill="${fill('hill', h)}"/>`;
  // The light and shade the rest of the board gets from the sun layer; higher ground a touch brighter.
  surface += `<polygon points="${clip}" fill="url(#${u}sun)"/><polygon points="${clip}" fill="#fff4cc" fill-opacity="${(0.07 * (z / RISE[1])).toFixed(3)}"/>`;
  // see-through: the hex's whole outline on screen (top and sides), and its body apart from what lies on its top.
  const hull = convexHull([...top, ...cornerPts(h, v, L, S, 0)]);
  return { depth: L.depth(x, y) - 0.65 * S, svg: `<g><g class="rbody">${faces}${surface}${rim}</g>${extra}</g>`, hull, on: `${h.col},${h.row}` };
}

/** The grass close-up for the raised tops, in the ground picture's units, as the .gdetail layer tiles it (150 wide). */
function raisedDefs(u: string, detail: number): string {
  // The sides darken smoothly towards their foot, where little light reaches.
  const cliff = `<defs><linearGradient id="${u}cliff" x1="0" y1="0" x2="0" y2="1"><stop offset=".1" stop-color="#1e1208" stop-opacity="0"/><stop offset="1" stop-color="#1e1208" stop-opacity=".55"/></linearGradient></defs>`;
  if (detail <= 0) return cliff;
  const th = 150 * (747 / 1280);
  const db = detailBox();
  return `${cliff}<defs><pattern id="${u}gd" patternUnits="userSpaceOnUse" x="${db[0]}" y="${db[1]}" width="150" height="${th.toFixed(2)}"><image href="${DETAIL_URL}" width="150" height="${th.toFixed(2)}"/></pattern></defs>`;
}

/** The table is a thick slab of wood, not a sheet: its sides towards the camera, and the shadow it throws below. */
const SLAB = 26;
function slab(v: View, L: Lens): string {
  const [fw, fh] = mapSize(v.portrait);
  const m = GROUND_M - 0.6; // tucked just under the picture's edge so no gap shows
  const c: Pt[] = [[-m, -m], [fw + m, -m], [fw + m, fh + m], [-m, fh + m]];
  const sinA = Math.sin(tiltAngle(v));
  const [cos, sin] = [Math.cos(v.cam.yaw), Math.sin(v.cam.yaw)];
  const top = c.map(([x, y]) => L.pt(x, y));
  const low = (d: number) => c.map(([x, y], i) => [top[i][0], top[i][1] + d * sinA * L.size(x, y)] as Pt);
  const foot = low(SLAB);
  const normals: Pt[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const out: string[] = [];
  // Shadow on whatever the table stands on: the slab's footprint, dropped a little further and spread.
  const sh = low(SLAB * 2.1);
  for (const [grow, op] of [[1.05, 0.2], [1.02, 0.25]] as const) {
    const cx = sh.reduce((a, p) => a + p[0], 0) / 4, cy = sh.reduce((a, p) => a + p[1], 0) / 4;
    // The table top is cut out of the shadow: the ground painting lies under this drawing and must not be dimmed.
    out.push(`<path fill-rule="evenodd" d="M${sh.map(([x, y]) => fmt([cx + (x - cx) * grow, cy + (y - cy) * grow])).join('L')}ZM${top.map(fmt).join('L')}Z" fill="#000" opacity="${op}"/>`);
  }
  for (let i = 0; i < 4; i++) {
    const [nx, ny] = normals[i];
    const facing = nx * sin + ny * cos; // > 0: this side faces the camera
    if (facing <= 0.01) continue;
    const j = (i + 1) % 4;
    const side = nx * cos - ny * sin; // which way it faces across the screen: lit from the left
    const lum = 0.62 - 0.22 * side;
    const col = (r: number, g: number, b: number) => `rgb(${[r, g, b].map((n) => Math.round(n * lum)).join(',')})`;
    const lip = low(SLAB * 0.16), mid = low(SLAB * 0.62);
    const quad = (a: Pt[], b: Pt[]) => `${fmt(a[i])} ${fmt(a[j])} ${fmt(b[j])} ${fmt(b[i])}`;
    out.push(
      `<polygon points="${quad(top, foot)}" fill="${col(92, 58, 36)}"/>`,
      `<polygon points="${quad(mid, foot)}" fill="${col(62, 38, 24)}"/>`,
      `<polygon points="${quad(top, lip)}" fill="${col(150, 104, 66)}"/>`,
    );
  }
  return out.join('');
}

// ---------- biomes: fetch a new land's pictures ahead ----------
const biomeFetched = new Set<string>();
function fetchBiome() {
  if (typeof Image === 'undefined') return;
  const key = `${CONFIG.board.biome}|${LARGE()}|${JSON.stringify(CONFIG.board.art ?? {})}|${CONFIG.board.trees ?? ''}`;
  if (biomeFetched.has(key)) return;
  biomeFetched.add(key);
  for (const src of biomePics(CONFIG.board, LARGE())) {
    const im = new Image();
    im.src = src;
    KEEP.push(im);
  }
}

export function renderBoard(s: GameState, o: Overlay, v: View, fx: Effects = NO_EFFECTS): string {
  fetchBiome();
  // Steep camera (looking down) → shorter figures; gentle slope → as carved. tiltAngle is 0 (flat view) to 76°.
  SQUASH = v.tilt ? 0.78 + 0.22 * Math.min(1, Math.max(0, (tiltAngle(v) * 180) / Math.PI / 76)) : 1;
  // Raised high ground: the lens lifts every point on a raised hex onto its top.
  const T = terraces(s, v);
  const L = lens(v, T);
  // Ids unique to this drawing: while the camera moves an older board can still be in the page.
  const u = `b${++BOARD_SEQ}`;
  if (v.tilt) preloadFigures();
  const looks: Record<Player, Look> = { red: lookFor('red', v, s), blue: lookFor('blue', v, s) };
  const ground: string[] = [];
  const standing: Standing[] = [];
  const top: string[] = [];
  if (groundReady && L.tilt) ground.push(slab(v, L));
  // What lies on a raised hex (its tap shape, highlights, marks) is drawn with that hex's top, after it, not on the
  // ground under it; everything else goes on the ground as before.
  const onTop = new Map<string, string[]>();
  for (const h of T?.list ?? []) onTop.set(`${h.col},${h.row}`, []);
  const onHex = (h: Hex, ...svg: string[]) => {
    const b = onTop.get(`${h.col},${h.row}`);
    (b ?? ground).push(...svg);
  };
  if (T) ground.push(raisedShadow(T, v, L));

  for (let r = 0; r < s.board.length; r++) {
    for (let c = 0; c < s.board[r].length; c++) {
      const hex = { col: c, row: r };
      const t = s.board[r][c];
      const [x, y] = flat(hex, v);
      const [lx, ly] = L.pt(x, y - S * 0.62);
      onHex(
        hex,
        `<polygon class="hex" data-col="${c}" data-row="${r}" points="${corners(hex, v, L)}" ${groundReady ? 'fill="#000" fill-opacity="0" stroke="#1d3312" stroke-opacity=".28" stroke-width="1"' : `fill="${fill(t, hex)}" stroke="#5d7f40" stroke-width="1"`}/>`,
        v.labels ? `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="coord" style="font-size:${(7 * L.size(x, y)).toFixed(1)}px">${hexName(hex)}</text>` : '',
      );
      if (t === 'river' && !groundReady) ground.push(riverRipple(hex, v, L));
      if (t === 'forest') standing.push(...trees(hex, v, L));
      if (t === 'wall' || t === 'tower' || t === 'gate' || t === 'house') {
        if (groundReady && L.tilt) standing.push(...building(t, hex, v, L));
        else if (groundReady) ground.push(roof(t, hex, v, L));
      }
      if (t === 'plain' && groundReady && L.tilt && CONFIG.board.boulders?.some(([bc, br]) => bc === c && br === r)) standing.push(...boulders(hex, v, L));
      // Grass tufts and bushes sit off the hex's centre; on a lake shore they would land in the water.
      if ((t === 'plain' || t === 'hill') && groundReady && L.tilt && !neighbors(hex).some((n) => s.board[n.row]?.[n.col] === 'lake')) standing.push(...scenery(hex, v, L));
      if (t === 'bridge' && !groundReady) standing.push(bridge(hex, v, L));
    }
  }

  if (groundReady && L.tilt) standing.push(...joints(s, v, L));

  if (o.zone) {
    const c = armyColor(o.zone.owner);
    for (const hex of o.zone.hexes) {
      onHex(hex, `<polygon points="${corners(hex, v, L, S - 2)}" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-opacity=".55" stroke-width="1.5"/>`);
    }
  }

  for (const hex of o.danger) {
    onHex(hex, `<polygon points="${corners(hex, v, L, S - 3)}" fill="#e0302a" fill-opacity=".22" stroke="#ff6a5a" stroke-opacity=".5" stroke-width="1"/>`);
  }

  for (const hex of o.rings) {
    onHex(hex, `<polygon points="${corners(hex, v, L, S - 4)}" fill="#a066ff" fill-opacity=".32" stroke="#d4b0ff" stroke-opacity=".8" stroke-width="1.5"/>`);
  }

  // Where pieces fell this battle the grass stays trampled.
  for (const e of s.log) {
    if ((e.kind === 'attack' || e.kind === 'shoot') && e.killed) {
      const [mx, my] = L.pt(...flat(e.at, v));
      const k = L.size(...flat(e.at, v));
      onHex(e.at, `<ellipse class="scar" cx="${mx.toFixed(1)}" cy="${(my + 2 * k).toFixed(1)}" rx="${(13 * k).toFixed(1)}" ry="${((L.tilt ? 4.5 : 10) * k).toFixed(1)}"/>`);
    }
  }

  // Moves just made: the hex a piece left and the one it reached glow yellow, as on a chess site
  // (this turn's clearly, the other side's last turn fainter).
  for (const m of o.trail.moves) {
    const f = m.old ? 0.55 : 1;
    onHex(m.from, `<polygon points="${corners(m.from, v, L, S - 2.5)}" fill="#f2d24a" fill-opacity="${(0.2 * f).toFixed(2)}" pointer-events="none"/>`);
    onHex(m.to, `<polygon points="${corners(m.to, v, L, S - 2.5)}" fill="#f2d24a" fill-opacity="${(0.36 * f).toFixed(2)}" pointer-events="none"/>`);
  }
  for (const h of o.trail.kills) {
    const [kx, ky] = L.pt(...flat(h, v));
    onHex(h, `<text x="${kx.toFixed(1)}" y="${(ky + 7).toFixed(1)}" class="trail-kill">✕</text>`);
  }

  for (const { hex, cost } of o.reach.values()) {
    const [x, y] = flat(hex, v);
    const [cx, cy] = L.pt(x, y);
    onHex(
      hex,
      // A light wash, so the board still looks like a board; the cost numbers come with the hex labels switch.
      `<polygon points="${corners(hex, v, L, S - 3)}" fill="#fffbe0" fill-opacity=".13" stroke="#fff3a6" stroke-opacity=".5" stroke-width="1.2"/>`,
      v.labels ? `<text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" class="cost">${cost}</text>` : '',
    );
  }

  // The planned route: a dotted line through each step, a ring on the destination.
  if (o.route.length) {
    const sel = o.selected ? s.units.find((u) => u.id === o.selected) : undefined;
    const pts = [...(sel ? [sel.pos] : []), ...o.route].map((h) => L.pt(...flat(h, v)));
    // Over raised ground the line would pass under the hill tops, so it is drawn above everything there.
    const line = `<polyline points="${pts.map(fmt).join(' ')}" class="route"/>`;
    if ([...(sel ? [sel.pos] : []), ...o.route].some((h) => L.hexZ(h) > 0)) top.push(line);
    else ground.push(line);
    const end = o.route[o.route.length - 1];
    onHex(end, `<polygon points="${corners(end, v, L, S - 4)}" class="route-end"/>`);
  }

  for (const u of s.units) {
    if (u.owner === o.hide) continue;
    const [x, y] = flat(u.pos, v);
    const at = L.pt(x, y);
    const k = L.size(x, y);
    if (u.id === o.selected) onHex(u.pos, `<polygon points="${corners(u.pos, v, L, S - 2)}" fill="#ffe27a" fill-opacity=".6" stroke="#c99a00" stroke-width="3"/>`);
    // camera v2: a piece of yours within an enemy's reach breathes a soft red ring on the ground.
    if (o.threat?.has(u.id)) onHex(u.pos, `<ellipse class="threat-ring" cx="${at[0].toFixed(1)}" cy="${(at[1] + (L.tilt ? k : 0)).toFixed(1)}" rx="${(23 * k).toFixed(1)}" ry="${((L.tilt ? 7.5 : 21) * k).toFixed(1)}" pointer-events="none"/>`);
    const p = o.targets.get(u.id);
    if (p) onHex(u.pos, `<polygon points="${corners(u.pos, v, L, S - 3)}" fill="#e53935" fill-opacity=".2" stroke="#d32f2f" stroke-width="3" stroke-dasharray="6 4"/>`);
    const hit = fx.hits.find((h) => !h.killed && !h.flightOnly && same(h.at, u.pos));
    lastPic = null;
    let svg = piece(u.type, u.owner, u.hp, L, at, k, o.spent.has(u.id) ? 'spent' : '', lookOf(u, v, looks));
    const figBox = figureBoxAt(L, at, k);
    if (hit) svg = `<g class="hit" style="animation-delay:${impact(hit)}s">${svg}</g>`;
    // A melee attacker lunges at its target and comes back.
    const blow = fx.hits.find((h) => !h.shotFrom && !h.advanced && same(h.from, u.pos) && u.owner !== h.owner);
    if (blow) {
      const [tx, ty] = L.pt(...flat(blow.at, v));
      svg = `<g class="lunge" style="--lx:${((tx - at[0]) * 0.4).toFixed(1)}px;--ly:${((ty - at[1]) * 0.4).toFixed(1)}px">${svg}</g>`;
    }
    const was = fx.from.get(u.id);
    const walk = fx.walks.get(u.id);
    if (walk && walk.length > 1) {
      // Walk the route one hex at a time, with a small hop on every step.
      const vals = walk.map((h) => L.pt(...flat(h, v))).map(([px, py]) => `${(px - at[0]).toFixed(1)} ${(py - at[1]).toFixed(1)}`).join(';');
      const n = walk.length - 1;
      svg = `<g><animateTransform attributeName="transform" type="translate" values="${vals}" dur="${(n * STEP_MS) / 1000}s" fill="freeze"/><g class="hop" style="animation-duration:${STEP_MS}ms;animation-iteration-count:${n}">${svg}</g></g>`;
    } else if (was && (was.col !== u.pos.col || was.row !== u.pos.row)) {
      const [px, py] = L.pt(...flat(was, v));
      svg = `<g class="slide" style="--dx:${(px - at[0]).toFixed(1)}px;--dy:${(py - at[1]).toFixed(1)}px">${svg}</g>`;
    }
    // In 2.5D a standing piece can cover the hex behind it, so the piece itself is tappable too.
    if (L.tilt) svg = `<g class="tap" data-col="${u.pos.col}" data-row="${u.pos.row}">${svg}</g>`;
    standing.push({ depth: L.depth(x, y), svg, box: u.id === o.selected ? null : figBox, on: `${u.pos.col},${u.pos.row}`, unit: true });
    if (p) {
      const by = at[1] - lift(L, k) - 17 * k;
      top.push(`<g transform="translate(${(at[0] + 17 * k).toFixed(1)} ${by.toFixed(1)})" class="badge"><circle r="10" fill="#d32f2f"/><text y="4">${p.kills ? '✕' : `−${p.damage}`}</text>${p.covered ? COVER_LEAF : ''}</g>`);
    }
  }

  // Arrows in flight, bullets, the flash of each blow, pieces falling, and floating damage numbers.
  for (const h of fx.hits) {
    const [x, y] = flat(h.at, v);
    const [hx, hy] = L.pt(x, y);
    const k = L.size(x, y);
    const ty = hy - lift(L, k);
    const d = impact(h);
    if (h.shotFrom) {
      const [fx0, fy0] = flat(h.shotFrom, v);
      const [sx, sy] = L.pt(fx0, fy0);
      const y0 = sy - lift(L, L.size(fx0, fy0));
      if (h.by && GUNS.has(h.by)) {
        // Muzzle flash, then a glowing bullet with a short fading trail flies to the target; smoke lingers.
        const path = `M${sx.toFixed(1)} ${y0.toFixed(1)}L${hx.toFixed(1)} ${ty.toFixed(1)}`;
        top.push(
          `<line class="tracer" x1="${sx.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${ty.toFixed(1)}"/>`,
          `<g transform="translate(${sx.toFixed(1)} ${y0.toFixed(1)})"><path class="muzzle" d="M0-9L2-2 9 0 2 2 0 9-2 2-9 0-2-2Z"/></g>`,
          `<g class="bullet"><ellipse rx="9" ry="2.6"/><ellipse class="core" rx="4.5" ry="1.4"/>
            <animateMotion dur="${d}s" fill="freeze" path="${path}"/>
            <animate attributeName="opacity" values="1;1;0" keyTimes="0;.9;1" dur="${d + 0.05}s" fill="freeze"/></g>`,
          `<g transform="translate(${sx.toFixed(1)} ${(y0 - 4).toFixed(1)})"><circle class="smoke" r="7"/></g>`,
        );
      } else {
        // The arrow flies in an arc, turning to follow its path, and lands on the target.
        const mx = (sx + hx) / 2;
        const my = (y0 + ty) / 2 - (Math.hypot(hx - sx, ty - y0) * 0.28 + 10);
        // The carved arrow side on, turned along its arc as it flies (rotate="auto"), so it always points the way it goes.
        // Real scale: about a third of a figure's height (it was a hand-span across the screen, David 2026-11-20).
        const ka = L.size(fx0, fy0);
        const [aw, ah] = [Math.max(7, 15 * ka), Math.max(1.6, 15 * ka * ARROWS.side[1] / ARROWS.side[0])];
        top.push(`<g class="flight"><image decoding="sync" href="${import.meta.env.BASE_URL}pieces/arrow-side.webp?v=${ART_VERSION}" x="${(-aw / 2).toFixed(1)}" y="${(-ah / 2).toFixed(1)}" width="${aw.toFixed(1)}" height="${ah.toFixed(1)}"/>
          <animateMotion dur="${d}s" fill="freeze" rotate="auto" path="M${sx.toFixed(1)} ${y0.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${hx.toFixed(1)} ${ty.toFixed(1)}"/>
          <animate attributeName="opacity" values="1;1;0" keyTimes="0;.8;1" dur="${d + 0.25}s" fill="freeze"/></g>`);
      }
    }
    if (h.flightOnly) continue;
    top.push(`<g transform="translate(${hx.toFixed(1)} ${ty.toFixed(1)})"><path class="spark" style="animation-delay:${d}s" d="${RAYS}"/></g>`);
    if (h.killed) {
      onHex(h.at, `<g transform="translate(${hx.toFixed(1)} ${hy.toFixed(1)})"><ellipse class="dust" style="animation-delay:${d + 0.25}s" rx="${(16 * k).toFixed(1)}" ry="${((L.tilt ? 6 : 12) * k).toFixed(1)}"/></g>`);
      standing.push({ depth: L.depth(x, y), svg: `<g class="ghost" style="animation-delay:${d}s">${piece(h.type, h.owner, 0, L, [hx, hy], k, '', looks[h.owner])}</g>` });
    }
    top.push(`<text class="float" style="animation-delay:${d}s" x="${hx}" y="${ty - 8}">${h.killed ? '✕' : `−${h.damage}`}</text>`);
  }

  // The raised hexes themselves, each with what lies on its top.
  if (T) {
    const detail = Math.max(0, Math.min(0.8, (v.cam.zoom - 2) / 3.5));
    const [gw, gh] = groundSize();
    const gid = sheetId(groundUrl(), gw, gh);
    ground.push(raisedDefs(u, detail));
    for (const h of T.list) standing.push(raisedHex(h, T, v, L, u, gid, detail, onTop.get(`${h.col},${h.row}`)!.join('')));
  }

  // Paint from the back of the board to the front so nearer things overlap farther ones.
  standing.sort((a, b) => a.depth - b.depth);
  // see-through: what stands in front of a hex the selected piece can reach or strike fades, so the hex shows.
  const seen = seeThrough(s, o, v, L, standing);
  // Atmosphere: warm sun from the board's far-left corner and cool shade opposite (turns with the board),
  // slow cloud shadows (the animation is offset by the clock, so a redrawn board carries on from the same spot
  // instead of jumping back, which flickered while panning), and haze over the far edge when the board is tilted.
  const [fw, fh] = mapSize(v.portrait);
  const [sunX, sunY] = L.pt(-0.25 * fw, -0.35 * fh);
  const [mx, my] = L.pt(fw / 2, fh / 2);
  const [fx2, fy2] = L.pt(fw / 2 + 40, fh / 2 + 40);
  const sl = Math.hypot(fx2 - mx, fy2 - my) || 1;
  SHADOW = [(fx2 - mx) / sl, (fy2 - my) / sl];
  const reach = Math.hypot(...L.pt(1.2 * fw, 1.3 * fh).map((c, i) => c - [sunX, sunY][i]) as [number, number]);
  const W = L.width.toFixed(0), H = L.height.toFixed(0);
  const light = `<defs>
      <radialGradient id="${u}sun" gradientUnits="userSpaceOnUse" cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${reach.toFixed(0)}">
        ${sunStops()}
      </radialGradient>
      <linearGradient id="${u}haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe8f0" stop-opacity=".34"/><stop offset=".42" stop-color="#dfe8f0" stop-opacity="0"/></linearGradient>
      <clipPath id="${u}clip"><polygon points="${[[-20, -20], [fw + 20, -20], [fw + 20, fh + 20], [-20, fh + 20]].map(([x, y]) => L.pt(x, y).map((c) => c.toFixed(0)).join(',')).join(' ')}"/></clipPath>
      ${weatherDefs()}<radialGradient id="${u}cloud"><stop offset="0" stop-color="#0c1408" stop-opacity=".2"/><stop offset="1" stop-color="#0c1408" stop-opacity="0"/></radialGradient>
    </defs>
    <rect class="light" width="${W}" height="${H}" fill="url(#${u}sun)" clip-path="url(#${u}clip)"/>
    <g clip-path="url(#${u}clip)"><g class="clouds" fill="url(#${u}cloud)" style="animation-delay:-${((performance.now() / 1000) % 180).toFixed(2)}s"><ellipse cx="${(+W * 0.2).toFixed(0)}" cy="${(+H * 0.35).toFixed(0)}" rx="${(+W * 0.16).toFixed(0)}" ry="${(+H * 0.09).toFixed(0)}"/><ellipse cx="${(+W * 0.75).toFixed(0)}" cy="${(+H * 0.7).toFixed(0)}" rx="${(+W * 0.2).toFixed(0)}" ry="${(+H * 0.1).toFixed(0)}"/></g></g>`;
  const haze = ''; // a pale haze read as glare on the board, so it's off
  const body = ground.join('') + light + standing.map((x, i) => `<g class="bst${x.hull ? ' rz' : ''}${seen.has(i) ? ' see' : ''}">${x.svg}</g>`).join('') + haze + top.join('');
  return `<svg class="board ${L.tilt ? 'tilted' : ''} wx-${skyNow().time}" viewBox="0 0 ${L.width.toFixed(0)} ${L.height.toFixed(0)}" role="img">${body}</svg>`;
}

/** A small orientation cube, like a 3D program's view cube: it turns and tilts with the camera.
 *  The top is grass; the side towards Novgorod is crimson, towards the Teutonic Order black. */
export function viewCube(v: View, size = 64): string {
  const angle = tiltAngle(v);
  const [cosA, sinA] = [Math.cos(angle), Math.sin(angle)];
  const [cos, sin] = [Math.cos(v.cam.yaw), Math.sin(v.cam.yaw)];
  // Directions on the flat map towards each army (portrait turns the map).
  const toRed: Pt = v.portrait ? [0, 1] : [-1, 0];
  const turn = ([x, y]: Pt): Pt => [x * cos - y * sin, x * sin + y * cos];
  const proj = (x: number, y: number, z: number): Pt => {
    const [rx, ry] = turn([x, y]);
    return [size / 2 + rx * size * 0.26, size / 2 + (ry * cosA - z * sinA) * size * 0.26];
  };
  const h = 1;
  const faces: { n: [number, number, number]; pts: [number, number, number][]; fill: string }[] = [
    { n: [0, 0, 1], pts: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]], fill: '#7fa35a' },
  ];
  // Four sides: one per map direction.
  const sides: [Pt, string][] = [[toRed, '#a8201a'], [[-toRed[0], -toRed[1]], '#1b1b1d'], [[toRed[1], -toRed[0]], '#5d5446'], [[-toRed[1], toRed[0]], '#5d5446']];
  for (const [[nx, ny], fill] of sides) {
    const [px, py] = [-ny, nx]; // along the face
    faces.push({
      n: [nx, ny, 0],
      fill,
      pts: [[nx - px, ny - py, h], [nx + px, ny + py, h], [nx + px, ny + py, -h], [nx - px, ny - py, -h]].map(([x, y, z]) => [x, y, z]) as [number, number, number][],
    });
  }
  // Show faces that look towards the camera, farthest first.
  const toCamera = (n: [number, number, number]) => {
    const [, ry] = turn([n[0], n[1]]);
    return ry * sinA + n[2] * cosA;
  };
  const shown = faces.filter((f) => toCamera(f.n) > 0.01).sort((a, b) => toCamera(a.n) - toCamera(b.n));
  const polys = shown
    .map((f) => `<polygon points="${f.pts.map(([x, y, z]) => fmt(proj(x, y, z))).join(' ')}" fill="${f.fill}" stroke="#f1e8d2" stroke-opacity=".55" stroke-width="1.2" stroke-linejoin="round"/>`)
    .join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">${polys}</svg>`;
}

// ---------- see-through, ground picking and smart camera helpers ----------
// While a piece is selected, scenery and pieces standing in front of a hex it can reach or strike fade (class "see"
// on the sprite's wrapper; CSS eases the opacity), so the hex shows. Taps are worked out from the camera's own
// projection (ground picking), never from the element under the finger, so a tall figure can't swallow a tap.

/** The screen box of the last picture pic() drew (see-through and ground picking read it right after). */
let lastPic: number[] | null = null;

type Box = number[];

/** Convex outline of a few screen points (a raised hex's top and foot together). */
function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function inPoly(X: number, Y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > Y !== yj > Y && X < ((xj - xi) * (Y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polygon's edge (0 inside). */
function polyDist(X: number, Y: number, poly: Pt[]): number {
  if (inPoly(X, Y, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j];
    const [bx, by] = poly[i];
    const [dx, dy] = [bx - ax, by - ay];
    const t = Math.max(0, Math.min(1, ((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(X - ax - t * dx, Y - ay - t * dy));
  }
  return best;
}

/** The screen box of the piece just drawn by piece() (call with lastPic cleared first). */
function figureBoxAt(L: Lens, [sx, sy]: Pt, k: number): Box | null {
  if (!L.tilt) return null;
  if (lastPic) return [sx + lastPic[0], sy + lastPic[1], sx + lastPic[2], sy + lastPic[3]];
  return [sx - 17 * k, sy - 36 * k, sx + 17 * k, sy + 2 * k]; // a counter standing upright
}

/** A picture's painted part: carved pictures have empty margins at the sides and a little on top. */
const inner = (b: Box, side = 0.16): Box => {
  const w = b[2] - b[0];
  return [b[0] + w * side, b[1] + (b[3] - b[1]) * 0.06, b[2] - w * side, b[3]];
};

/** Hexes the selected piece can move to or strike. */
function targetHexes(s: GameState, o: Overlay): Hex[] {
  if (!o.selected) return [];
  const out = [...o.reach.values()].map((r) => r.hex);
  for (const id of o.targets.keys()) {
    const u = s.units.find((x) => x.id === id);
    if (u) out.push(u.pos);
  }
  return out;
}

/** How many target hexes the last render found hidden behind something (smart camera reads it). */
let lastCover = { total: 0, covered: 0 };
/** Depth margin: an occluder must stand clearly nearer the camera than the hex it hides. */
const COVER_EPS = 4;

/** Which standing sprites (by index) hide a target hex behind them. Cheap: a few sample points per target
 *  against each sprite's box; most sprites are rejected by one bounding-box test. */
function seeThrough(s: GameState, o: Overlay, v: View, L: Lens, standing: Standing[]): Set<number> {
  const seen = new Set<number>();
  lastCover = { total: 0, covered: 0 };
  const hexes = L.tilt ? targetHexes(s, o) : [];
  if (!hexes.length) return seen;
  // The selected piece itself must show too, or its moves read as coming from nowhere.
  const sel = s.units.find((u) => u.id === o.selected);
  if (sel) hexes.push(sel.pos);
  const selKey = sel ? `${sel.pos.col},${sel.pos.row}` : '';
  const turn = v.portrait ? Math.PI / 2 : 0;
  let [mnx, mny, mxx, mxy] = [Infinity, Infinity, -Infinity, -Infinity];
  const tg = hexes.map((h) => {
    const [x, y] = flat(h, v);
    const z = L.hexZ(h);
    const pts: Pt[] = [L.pt3(x, y, z)];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * (i + 0.5) + turn;
      pts.push(L.pt3(x + 0.5 * S * Math.cos(a), y + 0.5 * S * Math.sin(a), z));
    }
    for (const [px, py] of pts) {
      mnx = Math.min(mnx, px); mny = Math.min(mny, py); mxx = Math.max(mxx, px); mxy = Math.max(mxy, py);
    }
    return { key: `${h.col},${h.row}`, depth: L.depth(x, y), pts, hit: new Uint8Array(7) };
  });
  for (let i = 0; i < standing.length; i++) {
    const st = standing[i];
    if (!st.box && !st.hull) continue;
    const b = st.box ? inner(st.box) : null;
    const hull = st.hull;
    let bb: Box;
    if (b) bb = b;
    else {
      bb = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [px, py] of hull!) bb = [Math.min(bb[0], px), Math.min(bb[1], py), Math.max(bb[2], px), Math.max(bb[3], py)];
    }
    if (bb[2] < mnx || bb[0] > mxx || bb[3] < mny || bb[1] > mxy) continue;
    // A raised hex is sorted a little behind its centre; compare from the centre itself.
    const depth = hull ? st.depth + 0.65 * S : st.depth;
    for (const t of tg) {
      if (st.on === t.key || depth <= t.depth + COVER_EPS) continue;
      if (st.unit && t.key !== selKey) continue;
      let n = 0;
      let centre = false;
      for (let j = 0; j < 7; j++) {
        const [px, py] = t.pts[j];
        if (px < bb[0] || px > bb[2] || py < bb[1] || py > bb[3]) continue;
        if (hull && !inPoly(px, py, hull)) continue;
        t.hit[j] = 1;
        n++;
        if (j === 0) centre = true;
      }
      if (centre || n >= 2) seen.add(i);
    }
  }
  lastCover = { total: tg.length, covered: tg.filter((t) => t.hit[0] || t.hit.reduce((a, b) => a + b, 0) >= 3).length };
  return seen;
}

/** The hex whose centre is nearest a flat map point (hexes are exactly those cells), or null off the board. */
function hexAtFlat(s: GameState, v: View, px: number, py: number): Hex | null {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  syncSize();
  const [x, y] = v.portrait ? [W - py, px] : [px, py];
  const rows = s.board.length;
  const cols = s.board[0]?.length ?? 0;
  const c0 = Math.round((x - S) / (1.5 * S));
  let best = Infinity;
  let out: Hex | null = null;
  for (let c = c0 - 1; c <= c0 + 1; c++) {
    const r0 = Math.round((y - (R3 / 2) * S) / (R3 * S) - 0.5 * (c & 1));
    for (let r = r0 - 1; r <= r0 + 1; r++) {
      const d = (x - (S * 1.5 * c + S)) ** 2 + (y - (R3 * S * (r + 0.5 * (c & 1)) + (R3 / 2) * S)) ** 2;
      if (d < best) {
        best = d;
        out = c >= 0 && r >= 0 && c < cols && r < rows ? { col: c, row: r } : null;
      }
    }
  }
  return best <= S * S ? out : null;
}

/** The hex drawn under a screen point: the nearest raised hex whose top or side covers it, else the ground there. */
function groundHexesAt(s: GameState, v: View, L: Lens, T: Terraces | null, X: number, Y: number): Hex[] {
  // Every hex drawn under the point, nearest the camera first: raised hexes whose top or side covers it, then the
  // ground there (which a faded hill in front may be hiding).
  const out: [number, Hex][] = [];
  if (T)
    for (const h of T.list) {
      const hull = convexHull([...cornerPts(h, v, L, S, T.hex(h)), ...cornerPts(h, v, L, S, 0)]);
      if (inPoly(X, Y, hull)) out.push([L.depth(...flat(h, v)), h]);
    }
  out.sort((a, b) => b[0] - a[0]);
  const [gx, gy] = L.ground(X, Y);
  const g = hexAtFlat(s, v, gx, gy);
  const all = out.map((e) => e[1]);
  if (g && !all.some((h) => h.col === g.col && h.row === g.row)) all.push(g);
  return all;
}

/** Ground picking: which hex a tap at screen point (X, Y) means. A highlighted target hex under the finger wins,
 *  then a piece whose figure (which rises over the hexes behind it) is under the finger, then (on touch) the
 *  nearest highlighted hex within `snap` pixels, then the plain hex under the finger. */
export function pickHex(s: GameState, o: Overlay, v: View, X: number, Y: number, snap = 0): Hex | null {
  const T = terraces(s, v);
  const L = lens(v, T);
  const under = groundHexesAt(s, v, L, T, X, Y);
  const ground = under[0] ?? null;
  const targets = targetHexes(s, o);
  const tkeys = new Set(targets.map((h) => `${h.col},${h.row}`));
  const hit = under.find((h) => tkeys.has(`${h.col},${h.row}`));
  if (hit) return hit;
  if (L.tilt) {
    const looks: Record<Player, Look> = { red: lookFor('red', v, s), blue: lookFor('blue', v, s) };
    let best: Hex | null = null;
    let bd = -Infinity;
    for (const u of s.units) {
      if (u.owner === o.hide) continue;
      const [x, y] = flat(u.pos, v);
      const at = L.pt(x, y);
      const k = L.size(x, y);
      lastPic = null;
      piece(u.type, u.owner, u.hp, L, at, k, '', lookOf(u, v, looks));
      const b = figureBoxAt(L, at, k);
      if (!b) continue;
      const [x0, y0, x1, y1] = inner(b, 0.22);
      if (X < x0 || X > x1 || Y < y0 || Y > y1) continue;
      const d = L.depth(x, y);
      if (d > bd) [bd, best] = [d, u.pos];
    }
    if (best) return best;
  }
  if (snap > 0 && targets.length) {
    let best: Hex | null = null;
    let bd = snap;
    for (const h of targets) {
      const d = polyDist(X, Y, cornerPts(h, v, L));
      if (d <= bd) [bd, best] = [d, h];
    }
    if (best) return best;
  }
  return ground;
}

/** Smart camera: where the selected piece's targets (and the piece) lie on screen, and how many are hidden. */
export function targetFrame(s: GameState, o: Overlay, v: View, withCover: boolean): { box: Box | null; total: number; covered: number } {
  const T = terraces(s, v);
  const L = lens(v, T);
  const hexes = targetHexes(s, o);
  const sel = o.selected ? s.units.find((u) => u.id === o.selected) : undefined;
  if (sel) hexes.push(sel.pos);
  if (!hexes.length) return { box: null, total: 0, covered: 0 };
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const h of hexes)
    for (const [px, py] of cornerPts(h, v, L, S * 0.8)) {
      if (!Number.isFinite(px) || !Number.isFinite(py)) return { box: null, total: 0, covered: 0 };
      b[0] = Math.min(b[0], px); b[1] = Math.min(b[1], py); b[2] = Math.max(b[2], px); b[3] = Math.max(b[3], py);
    }
  // The selected piece's own figure rises above its hex: keep its head on screen too.
  if (sel && L.tilt) {
    const [x, y] = flat(sel.pos, v);
    const [, sy] = L.pt(x, y);
    b[1] = Math.min(b[1], sy - 45 * L.size(x, y));
  }
  // camera v2: the enemy pieces it can strike stand up from their hexes too; keep their heads on screen as well.
  if (L.tilt) {
    const looks: Record<Player, Look> = { red: lookFor('red', v, s), blue: lookFor('blue', v, s) };
    for (const id of o.targets.keys()) {
      const u = s.units.find((x) => x.id === id);
      if (!u) continue;
      const [x, y] = flat(u.pos, v);
      const at = L.pt(x, y);
      const k = L.size(x, y);
      lastPic = null;
      piece(u.type, u.owner, u.hp, L, at, k, '', lookOf(u, v, looks));
      const fb = figureBoxAt(L, at, k);
      if (fb) b[1] = Math.min(b[1], inner(fb)[1]);
    }
  }
  if (!withCover) return { box: b, total: 0, covered: 0 };
  renderBoard(s, o, v);
  return { box: b, ...lastCover };
}

// ---------- camera v2 helpers ----------

/** camera v2: where a hex's middle is on screen (on top of raised ground), in stage pixels. */
export function hexScreen(s: GameState, v: View, h: Hex): Pt {
  const L = lens(v, terraces(s, v));
  return L.pt(...flat(h, v));
}

/** camera v2: the screen box round some hexes and the figures standing on them (heads included), or null. */
export function hexesBox(s: GameState, v: View, hexes: Hex[]): Box | null {
  if (!hexes.length) return null;
  const L = lens(v, terraces(s, v));
  const looks: Record<Player, Look> = { red: lookFor('red', v, s), blue: lookFor('blue', v, s) };
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const h of hexes) {
    for (const [px, py] of cornerPts(h, v, L, S * 0.8)) {
      if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
      b[0] = Math.min(b[0], px); b[1] = Math.min(b[1], py); b[2] = Math.max(b[2], px); b[3] = Math.max(b[3], py);
    }
    const u = L.tilt ? s.units.find((x) => x.pos.col === h.col && x.pos.row === h.row) : undefined;
    if (!u) continue;
    const [x, y] = flat(h, v);
    const at = L.pt(x, y);
    const k = L.size(x, y);
    lastPic = null;
    piece(u.type, u.owner, u.hp, L, at, k, '', lookOf(u, v, looks));
    const fb = figureBoxAt(L, at, k);
    if (fb) b[1] = Math.min(b[1], inner(fb)[1]);
  }
  return b;
}
