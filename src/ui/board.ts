// Draws the board as one SVG string. The grid is flat-top hexes with odd columns shifted
// down; in portrait the whole map turns 90° so the armies face each other top and bottom.

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
}

/** Centre of a hex on screen. Portrait turns the map so Red's edge is at the bottom. */
export function center(h: Hex, v: View): [number, number] {
  const x = S * 1.5 * h.col + S;
  const y = R3 * S * (h.row + 0.5 * (h.col & 1)) + (R3 / 2) * S;
  return v.portrait ? [y, W - x] : [x, y];
}

function corners(h: Hex, v: View, r = S): string {
  const [x, y] = center(h, v);
  const turn = v.portrait ? Math.PI / 2 : 0;
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + turn;
    return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

// Grass in three close shades so the field doesn't look flat; the shade is fixed per hex.
const GRASS = ['#7fa35a', '#87ab61', '#789b53'];

function fill(t: TerrainId, h: Hex): string {
  if (t === 'plain') return GRASS[(h.col * 7 + h.row * 13 + ((h.col * h.row) % 5)) % GRASS.length];
  if (t === 'forest') return '#3d6530';
  return '#5f9ccc'; // river and the water under a bridge
}

function decor(t: TerrainId, h: Hex, v: View): string {
  const [x, y] = center(h, v);
  if (t === 'forest') {
    const tree = (dx: number, dy: number, s: number) =>
      `<path d="M${x + dx} ${y + dy - 11 * s}L${x + dx + 8 * s} ${y + dy + 5 * s}L${x + dx - 8 * s} ${y + dy + 5 * s}Z" fill="#24421d"/>` +
      `<rect x="${x + dx - 1.5 * s}" y="${y + dy + 5 * s}" width="${3 * s}" height="${5 * s}" fill="#5b4126"/>`;
    return tree(-9, 2, 0.85) + tree(9, 4, 0.75) + tree(1, -8, 0.9);
  }
  // River and bridge follow the map's turn; trees stay upright.
  const turn = v.portrait ? ` transform="rotate(-90 ${x} ${y})"` : '';
  if (t === 'river') {
    return `<path${turn} d="M${x - 4} ${y - 22}Q${x + 6} ${y - 11} ${x - 2} ${y}T${x} ${y + 22}" stroke="#cfe6f6" stroke-width="2" fill="none" opacity=".8"/>`;
  }
  if (t === 'bridge') {
    const planks = Array.from({ length: 6 }, (_, i) => {
      const px = x - 30 + i * 10;
      return `<line x1="${px}" y1="${y - 11}" x2="${px}" y2="${y + 11}" stroke="#6b4a2b" stroke-width="1.2"/>`;
    }).join('');
    return `<g${turn}><rect x="${x - 34}" y="${y - 11}" width="68" height="22" rx="2" fill="#a77b4f" stroke="#6b4a2b" stroke-width="1.5"/>${planks}</g>`;
  }
  return '';
}

export interface Overlay {
  selected: string | null;
  reach: Map<string, Reach>;
  targets: Map<string, AttackPreview>; // by unit id
  /** Deployment zone to shade, and whose it is. */
  zone: { owner: Player; hexes: Hex[] } | null;
  /** Units of this side are hidden (the other player is setting up in secret). */
  hide: Player | null;
}

/** One-off effects for what just happened: they play once, on the render right after. */
export interface Effects {
  /** Unit id -> where it stood before, so it can slide to its new hex. */
  from: Map<string, Hex>;
  hits: { at: Hex; damage: number; killed: boolean; type: UnitTypeId; owner: Player; shotFrom: Hex | null }[];
}

export const NO_EFFECTS: Effects = { from: new Map(), hits: [] };

export function renderBoard(s: GameState, o: Overlay, v: View, fx: Effects = NO_EFFECTS): string {
  const parts: string[] = [];

  for (let r = 0; r < s.board.length; r++) {
    for (let c = 0; c < s.board[r].length; c++) {
      const hex = { col: c, row: r };
      const t = s.board[r][c];
      const [x, y] = center(hex, v);
      parts.push(
        `<polygon class="hex" data-col="${c}" data-row="${r}" points="${corners(hex, v)}" fill="${fill(t, hex)}" stroke="#5d7f40" stroke-width="1"/>`,
        decor(t, hex, v),
        `<text x="${x}" y="${y - S * 0.62}" class="coord">${hexName(hex)}</text>`,
      );
    }
  }

  if (o.zone) {
    const c = ARMY_COLOR[o.zone.owner];
    for (const hex of o.zone.hexes) {
      parts.push(`<polygon points="${corners(hex, v, S - 2)}" fill="${c}" fill-opacity=".12" stroke="${c}" stroke-opacity=".5" stroke-width="1.5"/>`);
    }
  }

  for (const { hex, cost } of o.reach.values()) {
    const [x, y] = center(hex, v);
    parts.push(
      `<polygon points="${corners(hex, v, S - 3)}" fill="#fffbe0" fill-opacity=".28" stroke="#fff3a6" stroke-width="2.5"/>`,
      `<text x="${x}" y="${y + 5}" class="cost">−${cost}</text>`,
    );
  }

  for (const u of s.units) {
    if (u.owner === o.hide) continue;
    const [x, y] = center(u.pos, v);
    if (u.id === o.selected) parts.push(`<polygon points="${corners(u.pos, v, S - 2)}" fill="#ffe27a" fill-opacity=".55" stroke="#c99a00" stroke-width="3"/>`);
    const p = o.targets.get(u.id);
    if (p) parts.push(`<polygon points="${corners(u.pos, v, S - 3)}" fill="#e53935" fill-opacity=".14" stroke="#d32f2f" stroke-width="3" stroke-dasharray="6 4"/>`);
    const was = fx.from.get(u.id);
    const hit = fx.hits.some((h) => !h.killed && h.at.col === u.pos.col && h.at.row === u.pos.row);
    let inner = unitSymbol(u.type, u.owner, u.hp);
    if (was && (was.col !== u.pos.col || was.row !== u.pos.row)) {
      const [px, py] = center(was, v);
      inner = `<g class="slide" style="--dx:${(px - x).toFixed(1)}px;--dy:${(py - y).toFixed(1)}px">${inner}</g>`;
    }
    parts.push(`<g transform="translate(${x} ${y - 3})"><g class="${hit ? 'hit' : ''}">${inner}</g></g>`);
    if (p) {
      parts.push(
        `<g transform="translate(${x + 17} ${y - 20})" class="badge"><circle r="10" fill="#d32f2f"/><text y="4">${p.kills ? '✕' : `−${p.damage}`}</text></g>`,
      );
    }
  }

  // Arrows in flight, pieces that just died, and floating damage numbers.
  for (const h of fx.hits) {
    const [x, y] = center(h.at, v);
    if (h.shotFrom) {
      const [sx, sy] = center(h.shotFrom, v);
      parts.push(`<line class="arrow" x1="${sx}" y1="${sy}" x2="${x}" y2="${y}" stroke="#3a2a14" stroke-width="2.5" stroke-linecap="round"/>`);
    }
    if (h.killed) parts.push(`<g transform="translate(${x} ${y - 3})"><g class="ghost">${unitSymbol(h.type, h.owner, 0)}</g></g>`);
    parts.push(`<text class="float" x="${x}" y="${y - 8}">${h.killed ? '✕' : `−${h.damage}`}</text>`);
  }

  const [vw, vh] = v.portrait ? [H, W] : [W, H];
  return `<svg class="board" viewBox="0 0 ${vw.toFixed(0)} ${vh.toFixed(0)}" preserveAspectRatio="xMidYMid meet" role="img">${parts.join('')}</svg>`;
}
