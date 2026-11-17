// Draws the board as one SVG string. The grid is flat-top hexes with odd columns shifted
// down; in portrait the whole map turns 90° so the armies face each other top and bottom.
// In 2.5D the map is then turned and tilted by the camera like a table seen from a chair:
// far rows are squashed and smaller, and pieces, trees and bridges stand up from the ground.

import { CONFIG, type TerrainId, type UnitTypeId } from '../config';
import type { AttackPreview, GameState, Hex, Player, Reach } from '../engine';
import { maxHp } from '../engine';
import { sides } from './factions';
import { hexName } from './i18n';
import { ART_VERSION, SPRITES } from './sprites';
import { armyColor, healthBar, unitSymbol } from './symbols';

const S = 34; // hex radius in SVG units
const R3 = Math.sqrt(3);
const W = S * 1.5 * (CONFIG.board.cols - 1) + 2 * S;
const H = R3 * S * (CONFIG.board.rows + 0.5);

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
}

/** Flat map size for this orientation (portrait turns the map 90°). */
export const mapSize = (portrait: boolean): Pt => (portrait ? [H, W] : [W, H]);

/** Camera tilt: 0° looks straight down, up to 76° looks almost across the table. */
const tiltAngle = (v: View) => (v.tilt ? (76 * v.cam.pitch * Math.PI) / 180 : 0);

function lens(v: View): Lens {
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
  const raw = (x: number, y: number) => {
    const dx = x - tx;
    const dy = y - ty;
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos; // positive = towards the viewer
    const k = dist / Math.max(dist * 0.15, dist - ry * sinA); // true perspective
    return [cx + rx * k * scale, cy + ry * cosA * k * scale, k * scale, ry] as const;
  };
  return {
    pt: (x, y) => {
      const [X, Y] = raw(x, y);
      return [X, Y];
    },
    size: (x, y) => raw(x, y)[2],
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
const GROUND_M = 70;
export const GROUND_URL = `${import.meta.env.BASE_URL}map/ground.webp?v=7`;
/** The picture's size in map units (its CSS size before the camera's transform). */
export const GROUND_SIZE: Pt = [W + 2 * GROUND_M, H + 2 * GROUND_M];
/** Carved trees, each drawn from 8 directions (tree-<kind>-<direction>.webp); picture size in pixels, trunk foot at bottom centre. */
const TREE_KINDS: [string, Pt][] = [['pine', [150, 301]], ['spruce', [126, 285]], ['oak', [198, 251]]];
const DIRS8 = ['front', 'front-left', 'left', 'back-left', 'back', 'back-right', 'right', 'front-right'];
const TREE_URL = (kind: string, dir: string) => `${import.meta.env.BASE_URL}map/tree-${kind}-${dir}.webp?v=3`;
/** Small standing scenery (prop-N.webp): picture size in pixels and how tall it stands in map units.
 *  Grass tufts and flowers reach a soldier's knee; the bush his waist. */
const PROPS: [Pt, number][] = [[[100, 135], 9], [[160, 117], 8], [[116, 128], 9], [[123, 127], 9], [[134, 115], 17], [[148, 99], 11], [[144, 70], 6], [[135, 150], 6]];
/** Which prop a hex gets: mostly grass, now and then flowers, a bush, stones or mushrooms. */
const PROP_MIX = [0, 1, 0, 1, 0, 2, 1, 3, 0, 4, 1, 6, 0, 5, 2, 7];
const PROP_URL = (i: number) => `${import.meta.env.BASE_URL}map/prop-${i + 1}.webp?v=1`;
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
function pic(url: string, nat: Pt, x: number, y: number, w: number, h: number, flip = false): string {
  const id = sheetId(url, nat[0], nat[1]);
  if (!id) return `<image decoding="sync" href="${url}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"${flip ? ' transform="scale(-1 1)"' : ''}/>`;
  return `<use href="#${id}" transform="${flip ? 'scale(-1 1) ' : ''}translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(w / nat[0]).toFixed(4)} ${(h / nat[1]).toFixed(4)})"/>`;
}
let groundReady = false;
/** Starts loading the painted ground and trees; `done` runs once they can be drawn. Until then the plain board shows. */
export function loadGround(done: () => void) {
  if (typeof Image === 'undefined') return;
  const all = [GROUND_URL, ...TREE_KINDS.flatMap(([k]) => DIRS8.map((d) => TREE_URL(k, d))), ...PROPS.map((_, i) => PROP_URL(i))].map((src) => {
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
  const x = S * 1.5 * h.col + S;
  const y = R3 * S * (h.row + 0.5 * (h.col & 1)) + (R3 / 2) * S;
  return v.portrait ? [y, W - x] : [x, y];
}

const fmt = ([x, y]: Pt) => `${x.toFixed(1)},${y.toFixed(1)}`;

function corners(h: Hex, v: View, L: Lens, r = S): string {
  const [x, y] = flat(h, v);
  const turn = v.portrait ? Math.PI / 2 : 0;
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + turn;
    return fmt(L.pt(x + r * Math.cos(a), y + r * Math.sin(a)));
  }).join(' ');
}

// Grass in three close shades so the field doesn't look flat; the shade is fixed per hex.
const GRASS = ['#7fa35a', '#87ab61', '#789b53'];

function fill(t: TerrainId, h: Hex): string {
  if (t === 'plain') return GRASS[(h.col * 7 + h.row * 13 + ((h.col * h.row) % 5)) % GRASS.length];
  if (t === 'forest') return '#3d6530';
  return '#5f9ccc'; // river and the water under a bridge
}

/** Something drawn above the ground, painted back to front by its flat depth. */
interface Standing {
  depth: number;
  svg: string;
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

/** Which of the 8 sides of something standing on the map the camera sees: 0 when the map's +x points at the viewer, counting round in eighths. */
function seenFrom(v: View, L: Lens): number {
  const [fw, fh] = mapSize(v.portrait);
  const [ax, ay] = L.pt(fw / 2, fh / 2);
  const [bx, by] = L.pt(fw / 2 + 20, fh / 2);
  const a = Math.atan2(bx - ax, (by - ay) / Math.max(0.2, Math.cos(tiltAngle(v))));
  // Pointing down the screen = facing us (0); pointing down-left = 'front-left' (1), and so on round.
  return ((-Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
}

/** Small standing scenery on open ground: a grass tuft, flowers, a stone. Fixed per hex, set off-centre so pieces don't hide it. */
function scenery(h: Hex, v: View, L: Lens): Standing[] {
  const seed = (h.col * 73 + h.row * 151 + ((h.col * h.row) % 7) * 31) % 97;
  if (seed % 5 > 1) return [];
  const [x, y] = flat(h, v);
  const a = (seed * 2.399) % (Math.PI * 2);
  const [px, py] = [x + Math.cos(a) * S * 0.62, y + Math.sin(a) * S * 0.62];
  const pi = PROP_MIX[seed % PROP_MIX.length];
  const [[pw, ph], tall] = PROPS[pi];
  const k = L.size(px, py);
  const [sx, sy] = L.pt(px, py);
  const [w, hh] = [(pw / ph) * tall * k, tall * k];
  return [{ depth: L.depth(px, py), svg: pic(PROP_URL(pi), [pw, ph], sx - w / 2, sy - hh + 0.8 * k, w, hh) }];
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
      const [kind, size] = TREE_KINDS[seed % TREE_KINDS.length];
      const dir = L.tilt ? DIRS8[(seenFrom(v, L) + (seed % 8)) % 8] : 'front';
      const f = (L.tilt ? 0.27 : 0.12) * k; // the tallest tree stands about one and a half soldiers high
      const [w, hh] = [size[0] * f, size[1] * f];
      return { depth: L.depth(x + dx, y + dy), svg: shadow + pic(TREE_URL(kind, dir), size, tx - w / 2, ty - hh + 2 * k, w, hh) };
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
}

/** One-off effects for what just happened: they play once, on the render right after. */
export interface Effects {
  /** Unit id -> where it stood before, so it can slide to its new hex. */
  from: Map<string, Hex>;
  hits: {
    at: Hex; damage: number; killed: boolean; type: UnitTypeId; owner: Player; shotFrom: Hex | null;
    /** The attacker's type and where it struck from; whether it stepped into the hex after a kill. */
    by?: UnitTypeId; from?: Hex; advanced?: boolean;
  }[];
  /** Unit id -> every hex of the walk it just made, start first, so it walks the route step by step. */
  walks: Map<string, Hex[]>;
}

export const NO_EFFECTS: Effects = { from: new Map(), hits: [], walks: new Map() };

/** Time for one step of a walk, in ms. */
export const STEP_MS = 130;
/** Pieces that fire guns: a quick tracer and smoke instead of an arrow in flight. */
const GUNS = new Set<UnitTypeId>(['gunslinger', 'rifleman', 'cowboy', 'deputy']);
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

function lookFor(owner: Player, v: View, L: Lens, s: GameState): Look {
  // Measured on screen, not worked out: from the middle of the board, step towards the enemy's
  // side (red starts in the first columns, blue in the last) and see which way that step points.
  const mid = Math.floor(s.board.length / 2);
  const cols = s.board[0].length;
  const redSide = flat({ col: 0, row: mid }, v);
  const blueSide = flat({ col: cols - 1, row: mid }, v);
  const [from, to] = owner === 'red' ? [redSide, blueSide] : [blueSide, redSide];
  const c: Pt = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  const step: Pt = [c[0] + ((to[0] - from[0]) / d) * 20, c[1] + ((to[1] - from[1]) / d) * 20];
  const [ax, ay] = L.pt(...c);
  const [bx, by] = L.pt(...step);
  const rx = bx - ax;
  const ry = (by - ay) / Math.max(0.2, Math.cos(tiltAngle(v))); // down the screen = towards the viewer
  const turn = Math.atan2(Math.abs(rx), ry); // 0 = facing us, π = facing away
  const n = Math.round(turn / (Math.PI / 4)); // 0 front, 1 front diagonal, 2 side, 3 back diagonal, 4 back
  const side = rx > 0 ? 'right' : 'left';
  const dir = ['front', `front-${side}`, side, `back-${side}`, 'back'][n];
  return { view: VIEWS[n], flip: rx > 0, dir };
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
    const full8 = maxHp(type);
    const bar8 = hp > 0 && hp < full8 ? `<g transform="translate(0 ${(7 * k).toFixed(1)}) scale(${(0.7 * k).toFixed(3)}) translate(0 -16)">${healthBar(hp, full8)}</g>` : '';
    return `<ellipse cx="${(SHADOW[0] * 11 * k).toFixed(1)}" cy="${(k + SHADOW[1] * 5 * k).toFixed(1)}" rx="${(21 * k).toFixed(1)}" ry="${(6.5 * k).toFixed(1)}" fill="#1b2410" opacity=".32" class="cast"/><ellipse cx="0" cy="${k.toFixed(1)}" rx="${(13 * k).toFixed(1)}" ry="${(4 * k).toFixed(1)}" fill="#000" opacity=".35"/>
    <ellipse cx="0" cy="${k.toFixed(1)}" rx="${(17 * k).toFixed(1)}" ry="${(5.6 * k).toFixed(1)}" fill="none" stroke="${armyColor(owner)}" stroke-width="${(2 * k).toFixed(1)}" opacity=".9"/>
    ${pic(SPRITE_URL(fac, type, look.dir), true8, -w8 / 2, -h8 + 4 * k, w8, h8)}${bar8}`;
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
  return `<ellipse cx="${(SHADOW[0] * 11 * k).toFixed(1)}" cy="${(k + SHADOW[1] * 5 * k).toFixed(1)}" rx="${(21 * k).toFixed(1)}" ry="${(6.5 * k).toFixed(1)}" fill="#1b2410" opacity=".32" class="cast"/><ellipse cx="0" cy="${k.toFixed(1)}" rx="${(13 * k).toFixed(1)}" ry="${(4 * k).toFixed(1)}" fill="#000" opacity=".35"/>
    <ellipse cx="0" cy="${k.toFixed(1)}" rx="${(17 * k).toFixed(1)}" ry="${(5.6 * k).toFixed(1)}" fill="none" stroke="${armyColor(owner)}" stroke-width="${(2 * k).toFixed(1)}" opacity=".9"/>
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
  if (fig) return `<g transform="translate(${sx} ${sy})"><g class="${cls}">${fig}</g></g>`;
  const counter = unitSymbol(type, owner, hp);
  if (!L.tilt) return `<g transform="translate(${sx} ${sy}) scale(${k.toFixed(3)})"><g class="${cls}">${counter}</g></g>`;
  return `<g transform="translate(${sx} ${sy})"><g class="${cls}">
    <ellipse cx="${5 * k}" cy="${1 * k}" rx="${19 * k}" ry="${5.5 * k}" fill="#000" opacity=".35"/>
    <rect x="${-16.4 * k}" y="${-4 * k}" width="${32.8 * k}" height="${4 * k}" rx="${1.5 * k}" fill="${armyColor(owner)}" filter="brightness(.6)" opacity=".9"/>
    <g transform="translate(0 ${-15.5 * k}) scale(${0.82 * k})">${counter}</g>
  </g></g>`;
}

/** Height of a piece's middle above its hex, for badges, numbers and arrows. */
const lift = (L: Lens, k: number) => (L.tilt ? 20 * k : 3 * k);

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

export function renderBoard(s: GameState, o: Overlay, v: View, fx: Effects = NO_EFFECTS): string {
  const L = lens(v);
  if (v.tilt) preloadFigures();
  const looks: Record<Player, Look> = { red: lookFor('red', v, L, s), blue: lookFor('blue', v, L, s) };
  const ground: string[] = [];
  const standing: Standing[] = [];
  const top: string[] = [];
  if (groundReady && L.tilt) ground.push(slab(v, L));

  for (let r = 0; r < s.board.length; r++) {
    for (let c = 0; c < s.board[r].length; c++) {
      const hex = { col: c, row: r };
      const t = s.board[r][c];
      const [x, y] = flat(hex, v);
      const [lx, ly] = L.pt(x, y - S * 0.62);
      ground.push(
        `<polygon class="hex" data-col="${c}" data-row="${r}" points="${corners(hex, v, L)}" ${groundReady ? 'fill="#000" fill-opacity="0" stroke="#1d3312" stroke-opacity=".28" stroke-width="1"' : `fill="${fill(t, hex)}" stroke="#5d7f40" stroke-width="1"`}/>`,
        v.labels ? `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="coord" style="font-size:${(7 * L.size(x, y)).toFixed(1)}px">${hexName(hex)}</text>` : '',
      );
      if (t === 'river' && !groundReady) ground.push(riverRipple(hex, v, L));
      if (t === 'forest') standing.push(...trees(hex, v, L));
      if (t === 'plain' && groundReady && L.tilt) standing.push(...scenery(hex, v, L));
      if (t === 'bridge' && !groundReady) standing.push(bridge(hex, v, L));
    }
  }

  if (o.zone) {
    const c = armyColor(o.zone.owner);
    for (const hex of o.zone.hexes) {
      ground.push(`<polygon points="${corners(hex, v, L, S - 2)}" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-opacity=".55" stroke-width="1.5"/>`);
    }
  }

  for (const hex of o.danger) {
    ground.push(`<polygon points="${corners(hex, v, L, S - 3)}" fill="#e0302a" fill-opacity=".22" stroke="#ff6a5a" stroke-opacity=".5" stroke-width="1"/>`);
  }

  for (const hex of o.rings) {
    ground.push(`<polygon points="${corners(hex, v, L, S - 4)}" fill="#a066ff" fill-opacity=".32" stroke="#d4b0ff" stroke-opacity=".8" stroke-width="1.5"/>`);
  }

  // Where pieces fell this battle the grass stays trampled.
  for (const e of s.log) {
    if ((e.kind === 'attack' || e.kind === 'shoot') && e.killed) {
      const [mx, my] = L.pt(...flat(e.at, v));
      const k = L.size(...flat(e.at, v));
      ground.push(`<ellipse class="scar" cx="${mx.toFixed(1)}" cy="${(my + 2 * k).toFixed(1)}" rx="${(13 * k).toFixed(1)}" ry="${((L.tilt ? 4.5 : 10) * k).toFixed(1)}"/>`);
    }
  }

  // Last turn's enemy moves: a faint dashed arrow per move, a cross where a piece fell.
  for (const m of o.trail.moves) {
    const [ax, ay] = L.pt(...flat(m.from, v));
    const [bx, by] = L.pt(...flat(m.to, v));
    const ang = Math.atan2(by - ay, bx - ax);
    const head = (d: number) => `${(bx - 9 * Math.cos(ang + d)).toFixed(1)},${(by - 9 * Math.sin(ang + d)).toFixed(1)}`;
    ground.push(
      `<g class="trail-g${m.old ? ' old' : ''}">${m.owner ? `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" class="trail-side" stroke="${armyColor(m.owner)}"/>` : ''}<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" class="trail"/>`,
      `<polygon points="${bx.toFixed(1)},${by.toFixed(1)} ${head(0.45)} ${head(-0.45)}" class="trail-head"/></g>`,
    );
  }
  for (const h of o.trail.kills) {
    const [kx, ky] = L.pt(...flat(h, v));
    ground.push(`<text x="${kx.toFixed(1)}" y="${(ky + 7).toFixed(1)}" class="trail-kill">✕</text>`);
  }

  for (const { hex, cost } of o.reach.values()) {
    const [x, y] = flat(hex, v);
    const [cx, cy] = L.pt(x, y);
    ground.push(
      `<polygon points="${corners(hex, v, L, S - 3)}" fill="#fffbe0" fill-opacity=".28" stroke="#fff3a6" stroke-width="2.5"/>`,
      `<text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" class="cost">${cost}</text>`,
    );
  }

  // The planned route: a dotted line through each step, a ring on the destination.
  if (o.route.length) {
    const sel = o.selected ? s.units.find((u) => u.id === o.selected) : undefined;
    const pts = [...(sel ? [sel.pos] : []), ...o.route].map((h) => L.pt(...flat(h, v)));
    ground.push(`<polyline points="${pts.map(fmt).join(' ')}" class="route"/>`);
    const end = o.route[o.route.length - 1];
    ground.push(`<polygon points="${corners(end, v, L, S - 4)}" class="route-end"/>`);
  }

  for (const u of s.units) {
    if (u.owner === o.hide) continue;
    const [x, y] = flat(u.pos, v);
    const at = L.pt(x, y);
    const k = L.size(x, y);
    if (u.id === o.selected) ground.push(`<polygon points="${corners(u.pos, v, L, S - 2)}" fill="#ffe27a" fill-opacity=".6" stroke="#c99a00" stroke-width="3"/>`);
    const p = o.targets.get(u.id);
    if (p) ground.push(`<polygon points="${corners(u.pos, v, L, S - 3)}" fill="#e53935" fill-opacity=".2" stroke="#d32f2f" stroke-width="3" stroke-dasharray="6 4"/>`);
    const hit = fx.hits.find((h) => !h.killed && same(h.at, u.pos));
    let svg = piece(u.type, u.owner, u.hp, L, at, k, o.spent.has(u.id) ? 'spent' : '', looks[u.owner]);
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
    standing.push({ depth: L.depth(x, y), svg });
    if (p) {
      const by = at[1] - lift(L, k) - 17 * k;
      top.push(`<g transform="translate(${(at[0] + 17 * k).toFixed(1)} ${by.toFixed(1)})" class="badge"><circle r="10" fill="#d32f2f"/><text y="4">${p.kills ? '✕' : `−${p.damage}`}</text></g>`);
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
        // The arrow is seen from the angle it flies at, like the pieces: towards the viewer, diagonally, side on,
        // or away; side and diagonal views are mirrored when it flies to the left (an arrow has no left or right hand).
        const rx = hx - sx, ry = (ty - y0) / Math.max(0.2, Math.cos(tiltAngle(v)));
        const av = ARROW_VIEWS[Math.round(Math.atan2(Math.abs(rx), ry) / (Math.PI / 4))];
        const [aw, ah] = ARROWS[av].map((n) => n * (46 / ARROWS.side[0]));
        const amirror = rx < 0 && av !== 'toward' && av !== 'away' ? ' transform="scale(-1 1)"' : '';
        top.push(`<g class="flight"><image decoding="sync" href="${import.meta.env.BASE_URL}pieces/arrow-${av}.webp?v=${ART_VERSION}" x="${(-aw / 2).toFixed(1)}" y="${(-ah / 2).toFixed(1)}" width="${aw.toFixed(1)}" height="${ah.toFixed(1)}"${amirror}/>
          <animateMotion dur="${d}s" fill="freeze" path="M${sx.toFixed(1)} ${y0.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${hx.toFixed(1)} ${ty.toFixed(1)}"/>
          <animate attributeName="opacity" values="1;1;0" keyTimes="0;.8;1" dur="${d + 0.25}s" fill="freeze"/></g>`);
      }
    }
    top.push(`<g transform="translate(${hx.toFixed(1)} ${ty.toFixed(1)})"><path class="spark" style="animation-delay:${d}s" d="${RAYS}"/></g>`);
    if (h.killed) {
      ground.push(`<g transform="translate(${hx.toFixed(1)} ${hy.toFixed(1)})"><ellipse class="dust" style="animation-delay:${d + 0.25}s" rx="${(16 * k).toFixed(1)}" ry="${((L.tilt ? 6 : 12) * k).toFixed(1)}"/></g>`);
      standing.push({ depth: L.depth(x, y), svg: `<g class="ghost" style="animation-delay:${d}s">${piece(h.type, h.owner, 0, L, [hx, hy], k, '', looks[h.owner])}</g>` });
    }
    top.push(`<text class="float" style="animation-delay:${d}s" x="${hx}" y="${ty - 8}">${h.killed ? '✕' : `−${h.damage}`}</text>`);
  }

  // Paint from the back of the board to the front so nearer things overlap farther ones.
  standing.sort((a, b) => a.depth - b.depth);
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
  // Ids unique to this drawing: while the camera moves an older board can still be in the page.
  const u = `b${++BOARD_SEQ}`;
  const light = `<defs>
      <radialGradient id="${u}sun" gradientUnits="userSpaceOnUse" cx="${sunX.toFixed(0)}" cy="${sunY.toFixed(0)}" r="${reach.toFixed(0)}">
        <stop offset="0" stop-color="#e8a948" stop-opacity=".13"/><stop offset=".45" stop-color="#e8a948" stop-opacity=".03"/>
        <stop offset=".75" stop-color="#1e2c4a" stop-opacity=".10"/><stop offset="1" stop-color="#14203a" stop-opacity=".30"/>
      </radialGradient>
      <linearGradient id="${u}haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe8f0" stop-opacity=".34"/><stop offset=".42" stop-color="#dfe8f0" stop-opacity="0"/></linearGradient>
      <clipPath id="${u}clip"><polygon points="${[[-20, -20], [fw + 20, -20], [fw + 20, fh + 20], [-20, fh + 20]].map(([x, y]) => L.pt(x, y).map((c) => c.toFixed(0)).join(',')).join(' ')}"/></clipPath>
      <radialGradient id="${u}cloud"><stop offset="0" stop-color="#0c1408" stop-opacity=".2"/><stop offset="1" stop-color="#0c1408" stop-opacity="0"/></radialGradient>
    </defs>
    <rect class="light" width="${W}" height="${H}" fill="url(#${u}sun)" clip-path="url(#${u}clip)"/>
    <g clip-path="url(#${u}clip)"><g class="clouds" fill="url(#${u}cloud)" style="animation-delay:-${((performance.now() / 1000) % 180).toFixed(2)}s"><ellipse cx="${(+W * 0.2).toFixed(0)}" cy="${(+H * 0.35).toFixed(0)}" rx="${(+W * 0.16).toFixed(0)}" ry="${(+H * 0.09).toFixed(0)}"/><ellipse cx="${(+W * 0.75).toFixed(0)}" cy="${(+H * 0.7).toFixed(0)}" rx="${(+W * 0.2).toFixed(0)}" ry="${(+H * 0.1).toFixed(0)}"/></g></g>`;
  const haze = ''; // a pale haze read as glare on the board, so it's off
  const body = ground.join('') + light + standing.map((x) => x.svg).join('') + haze + top.join('');
  return `<svg class="board ${L.tilt ? 'tilted' : ''}" viewBox="0 0 ${L.width.toFixed(0)} ${L.height.toFixed(0)}" role="img">${body}</svg>`;
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
