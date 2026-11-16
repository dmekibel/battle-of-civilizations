// Draws the board as one SVG string. The grid is flat-top hexes with odd columns shifted
// down; in portrait the whole map turns 90° so the armies face each other top and bottom.
// In 2.5D the map is then tilted back like a table seen from a chair: far rows are
// squashed and smaller, and pieces, trees and bridges stand up from the ground.

import { CONFIG, type TerrainId, type UnitTypeId } from '../config';
import type { AttackPreview, GameState, Hex, Player, Reach } from '../engine';
import { hexName } from './i18n';
import { ARMY_COLOR, unitSymbol } from './symbols';

const S = 34; // hex radius in SVG units
const R3 = Math.sqrt(3);
const W = S * 1.5 * (CONFIG.board.cols - 1) + 2 * S;
const H = R3 * S * (CONFIG.board.rows + 0.5);

export interface View {
  portrait: boolean;
  /** 2.5D: tilted board with standing pieces. */
  tilt: boolean;
}

type Pt = [number, number];

/** Everything needed to turn flat map positions into screen positions for one render. */
interface Lens {
  /** Flat map point -> screen point. */
  pt: (x: number, y: number) => Pt;
  /** How big things are at this flat depth (1 at the front, smaller further back). */
  size: (y: number) => number;
  width: number;
  height: number;
  tilt: boolean;
}

function lens(v: View): Lens {
  const [fw, fh] = v.portrait ? [H, W] : [W, H];
  if (!v.tilt) return { pt: (x, y) => [x, y], size: () => 1, width: fw, height: fh, tilt: false };
  // A tall phone screen gets a gentler tilt so the board still fills it.
  const [squash, far] = v.portrait ? [0.82, 0.86] : [0.54, 0.74];
  const lift = 64; // room above the back row for standing pieces
  const size = (y: number) => far + (1 - far) * (y / fh);
  return {
    pt: (x, y) => [fw / 2 + (x - fw / 2) * size(y), lift + y * squash * (0.86 + 0.14 * size(y))],
    size,
    width: fw,
    height: lift + fh * squash + 24,
    tilt: true,
  };
}

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
    const k = L.size(y + dy) * sz;
    const leafy = (h.col * 3 + h.row * 5 + i) % 3 === 0;
    const shadow = `<ellipse cx="${tx + 4 * k}" cy="${ty + 1}" rx="${10 * k}" ry="${3.5 * k}" fill="#000" opacity="${L.tilt ? 0.3 : 0.18}"/>`;
    return { depth: y + dy, svg: shadow + (leafy ? oak(tx, ty, k, L.tilt) : pine(tx, ty, k, L.tilt)) };
  });
}

function bridge(h: Hex, v: View, L: Lens): Standing {
  const [x, y] = flat(h, v);
  // The deck runs across the river: along x in landscape, along y once the map is turned.
  const [hw, hh] = v.portrait ? [11, 34] : [34, 11];
  const quad = [L.pt(x - hw, y - hh), L.pt(x + hw, y - hh), L.pt(x + hw, y + hh), L.pt(x - hw, y + hh)];
  const rise = L.tilt ? 5 * L.size(y) : 0;
  const deck = quad.map(([px, py]) => fmt([px, py - rise])).join(' ');
  const side = L.tilt ? `<polygon points="${fmt([quad[3][0], quad[3][1] - rise])} ${fmt([quad[2][0], quad[2][1] - rise])} ${fmt(quad[2])} ${fmt(quad[3])}" fill="#6b4a2b"/>` : '';
  return { depth: y, svg: `${side}<polygon points="${deck}" fill="#a77b4f" stroke="#6b4a2b" stroke-width="1.5"/>` };
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
}

/** One-off effects for what just happened: they play once, on the render right after. */
export interface Effects {
  /** Unit id -> where it stood before, so it can slide to its new hex. */
  from: Map<string, Hex>;
  hits: { at: Hex; damage: number; killed: boolean; type: UnitTypeId; owner: Player; shotFrom: Hex | null }[];
}

export const NO_EFFECTS: Effects = { from: new Map(), hits: [] };

/** A piece: flat it lies on the hex; in 2.5D the shield stands upright on its point,
 *  with a shadow, low enough not to hide the hex behind it. */
function piece(type: UnitTypeId, owner: Player, hp: number, L: Lens, [sx, sy]: Pt, k: number, cls = ''): string {
  const counter = unitSymbol(type, owner, hp);
  if (!L.tilt) return `<g transform="translate(${sx} ${sy}) scale(.95)"><g class="${cls}">${counter}</g></g>`;
  return `<g transform="translate(${sx} ${sy})"><g class="${cls}">
    <ellipse cx="${5 * k}" cy="${1 * k}" rx="${17 * k}" ry="${5 * k}" fill="#000" opacity=".35"/>
    <g transform="translate(0 ${-19 * k}) scale(${0.82 * k})">${counter}</g>
  </g></g>`;
}

/** Height of a piece's middle above its hex, for badges, numbers and arrows. */
const lift = (L: Lens, k: number) => (L.tilt ? 20 * k : 3);

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
        `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" class="coord" style="font-size:${(7 * L.size(y)).toFixed(1)}px">${hexName(hex)}</text>`,
      );
      if (t === 'river') ground.push(riverRipple(hex, v, L));
      if (t === 'forest') standing.push(...trees(hex, v, L));
      if (t === 'bridge') standing.push(bridge(hex, v, L));
    }
  }

  if (o.zone) {
    const c = ARMY_COLOR[o.zone.owner];
    for (const hex of o.zone.hexes) {
      ground.push(`<polygon points="${corners(hex, v, L, S - 2)}" fill="${c}" fill-opacity=".14" stroke="${c}" stroke-opacity=".55" stroke-width="1.5"/>`);
    }
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

  for (const u of s.units) {
    if (u.owner === o.hide) continue;
    const [x, y] = flat(u.pos, v);
    const at = L.pt(x, y);
    const k = L.size(y);
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
    standing.push({ depth: y, svg });
    if (p) {
      const by = at[1] - lift(L, k) - 17 * k;
      top.push(`<g transform="translate(${(at[0] + 17 * k).toFixed(1)} ${by.toFixed(1)})" class="badge"><circle r="10" fill="#d32f2f"/><text y="4">${p.kills ? '✕' : `−${p.damage}`}</text></g>`);
    }
  }

  // Arrows in flight, pieces that just died, and floating damage numbers.
  for (const h of fx.hits) {
    const [x, y] = flat(h.at, v);
    const [hx, hy] = L.pt(x, y);
    const k = L.size(y);
    if (h.shotFrom) {
      const [fx0, fy0] = flat(h.shotFrom, v);
      const [sx, sy] = L.pt(fx0, fy0);
      const sl = lift(L, L.size(fy0));
      top.push(`<line class="arrow" x1="${sx}" y1="${sy - sl}" x2="${hx}" y2="${hy - lift(L, k)}" stroke="#3a2a14" stroke-width="2.5" stroke-linecap="round"/>`);
    }
    if (h.killed) standing.push({ depth: y, svg: piece(h.type, h.owner, 0, L, [hx, hy], k, 'ghost') });
    top.push(`<text class="float" x="${hx}" y="${hy - lift(L, k) - 8}">${h.killed ? '✕' : `−${h.damage}`}</text>`);
  }

  // Paint from the back of the board to the front so nearer things overlap farther ones.
  standing.sort((a, b) => a.depth - b.depth);
  const body = ground.join('') + standing.map((x) => x.svg).join('') + top.join('');
  return `<svg class="board ${L.tilt ? 'tilted' : ''}" viewBox="0 0 ${L.width.toFixed(0)} ${L.height.toFixed(0)}" preserveAspectRatio="xMidYMid meet" role="img">${body}</svg>`;
}
