// Draws the board as one SVG string. The grid is flat-top hexes with odd columns shifted
// down; in portrait the whole map turns 90° so the armies face each other top and bottom.
// In 2.5D the map is then turned and tilted by the camera like a table seen from a chair:
// far rows are squashed and smaller, and pieces, trees and bridges stand up from the ground.

import { CONFIG, type TerrainId, type UnitTypeId } from '../config';
import type { AttackPreview, GameState, Hex, Player, Reach } from '../engine';
import { hexName } from './i18n';
import { armyColor, unitSymbol } from './symbols';

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
  };
}

/** The point on the ground under a screen pixel, for panning and zooming about the cursor. */
export const screenToGround = (v: View, X: number, Y: number): Pt => lens(v).ground(X, Y);

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

function trees(h: Hex, v: View, L: Lens): Standing[] {
  const [x, y] = flat(h, v);
  // A small grove; which trees are pines or leafy is fixed per hex so the map doesn't flicker.
  const spots = [[-13, -2, 0.95], [12, -5, 0.9], [0, -13, 1], [-6, 12, 0.85], [11, 11, 0.8]] as const;
  return spots.map(([dx, dy, sz], i) => {
    const [tx, ty] = L.pt(x + dx, y + dy);
    const k = L.size(x + dx, y + dy) * sz;
    const leafy = (h.col * 3 + h.row * 5 + i) % 3 === 0;
    const shadow = `<ellipse cx="${tx + 4 * k}" cy="${ty + 1}" rx="${10 * k}" ry="${3.5 * k}" fill="#000" opacity="${L.tilt ? 0.3 : 0.18}"/>`;
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
  trail: { moves: { from: Hex; to: Hex }[]; kills: Hex[] };
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
  hits: { at: Hex; damage: number; killed: boolean; type: UnitTypeId; owner: Player; shotFrom: Hex | null }[];
}

export const NO_EFFECTS: Effects = { from: new Map(), hits: [] };

/** A piece: flat it lies on the hex; in 2.5D the counter itself stands upright on the hex,
 *  with a thin edge underneath and a shadow, low enough not to hide the hex behind it. */
function piece(type: UnitTypeId, owner: Player, hp: number, L: Lens, [sx, sy]: Pt, k: number, cls = ''): string {
  const counter = unitSymbol(type, owner, hp);
  if (!L.tilt) return `<g transform="translate(${sx} ${sy}) scale(${k.toFixed(3)})"><g class="${cls}">${counter}</g></g>`;
  return `<g transform="translate(${sx} ${sy})"><g class="${cls}">
    <ellipse cx="${5 * k}" cy="${1 * k}" rx="${19 * k}" ry="${5.5 * k}" fill="#000" opacity=".35"/>
    <rect x="${-16.4 * k}" y="${-4 * k}" width="${32.8 * k}" height="${4 * k}" rx="${1.5 * k}" fill="${armyColor(owner)}" filter="brightness(.6)" opacity=".9"/>
    <g transform="translate(0 ${-15.5 * k}) scale(${0.82 * k})">${counter}</g>
  </g></g>`;
}

/** Height of a piece's middle above its hex, for badges, numbers and arrows. */
const lift = (L: Lens, k: number) => (L.tilt ? 16 * k : 3 * k);

export function renderBoard(s: GameState, o: Overlay, v: View, fx: Effects = NO_EFFECTS): string {
  const L = lens(v);
  const ground: string[] = [];
  const standing: Standing[] = [];
  const top: string[] = [];

  for (let r = 0; r < s.board.length; r++) {
    for (let c = 0; c < s.board[r].length; c++) {
      const hex = { col: c, row: r };
      const t = s.board[r][c];
      const [x, y] = flat(hex, v);
      const [lx, ly] = L.pt(x, y - S * 0.62);
      ground.push(
        `<polygon class="hex" data-col="${c}" data-row="${r}" points="${corners(hex, v, L)}" fill="${fill(t, hex)}" stroke="#5d7f40" stroke-width="1"/>`,
        `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="coord" style="font-size:${(7 * L.size(x, y)).toFixed(1)}px">${hexName(hex)}</text>`,
      );
      if (t === 'river') ground.push(riverRipple(hex, v, L));
      if (t === 'forest') standing.push(...trees(hex, v, L));
      if (t === 'bridge') standing.push(bridge(hex, v, L));
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

  // Last turn's enemy moves: a faint dashed arrow per move, a cross where a piece fell.
  for (const m of o.trail.moves) {
    const [ax, ay] = L.pt(...flat(m.from, v));
    const [bx, by] = L.pt(...flat(m.to, v));
    const ang = Math.atan2(by - ay, bx - ax);
    const head = (d: number) => `${(bx - 9 * Math.cos(ang + d)).toFixed(1)},${(by - 9 * Math.sin(ang + d)).toFixed(1)}`;
    ground.push(
      `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" class="trail"/>`,
      `<polygon points="${bx.toFixed(1)},${by.toFixed(1)} ${head(0.45)} ${head(-0.45)}" class="trail-head"/>`,
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
      `<text x="${cx.toFixed(1)}" y="${(cy + 5).toFixed(1)}" class="cost">−${cost}</text>`,
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
    const hit = fx.hits.some((h) => !h.killed && h.at.col === u.pos.col && h.at.row === u.pos.row);
    let svg = piece(u.type, u.owner, u.hp, L, at, k, [hit ? 'hit' : '', o.spent.has(u.id) ? 'spent' : ''].join(' '));
    const was = fx.from.get(u.id);
    if (was && (was.col !== u.pos.col || was.row !== u.pos.row)) {
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

  // Arrows in flight, pieces that just died, and floating damage numbers.
  for (const h of fx.hits) {
    const [x, y] = flat(h.at, v);
    const [hx, hy] = L.pt(x, y);
    const k = L.size(x, y);
    if (h.shotFrom) {
      const [fx0, fy0] = flat(h.shotFrom, v);
      const [sx, sy] = L.pt(fx0, fy0);
      const sl = lift(L, L.size(fx0, fy0));
      top.push(`<line class="arrow" x1="${sx}" y1="${sy - sl}" x2="${hx}" y2="${hy - lift(L, k)}" stroke="#3a2a14" stroke-width="2.5" stroke-linecap="round"/>`);
    }
    if (h.killed) standing.push({ depth: L.depth(x, y), svg: piece(h.type, h.owner, 0, L, [hx, hy], k, 'ghost') });
    top.push(`<text class="float" x="${hx}" y="${hy - lift(L, k) - 8}">${h.killed ? '✕' : `−${h.damage}`}</text>`);
  }

  // Paint from the back of the board to the front so nearer things overlap farther ones.
  standing.sort((a, b) => a.depth - b.depth);
  const body = ground.join('') + standing.map((x) => x.svg).join('') + top.join('');
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
