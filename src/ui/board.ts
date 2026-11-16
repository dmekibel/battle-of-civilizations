// Draws the board as one SVG string. Flat-top hexes, odd columns shifted down.

import { CONFIG, type TerrainId } from '../config';
import { type GameState, type Hex, type AttackPreview, type Reach } from '../engine';
import { hexName } from './i18n';
import { ARMY_COLOR, unitSymbol } from './symbols';

const S = 34; // hex radius in SVG units
const R3 = Math.sqrt(3);

export function center(h: Hex): [number, number] {
  return [S * 1.5 * h.col + S, R3 * S * (h.row + 0.5 * (h.col & 1)) + (R3 / 2) * S];
}

function corners(h: Hex, r = S): string {
  const [x, y] = center(h);
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

const FILL: Record<TerrainId, string> = {
  plain: '#ece4c8',
  forest: '#9cb38a',
  river: '#8fbcdc',
  bridge: '#8fbcdc',
};

function decor(t: TerrainId, h: Hex): string {
  const [x, y] = center(h);
  if (t === 'forest') {
    const tree = (dx: number, dy: number, s: number) =>
      `<path d="M${x + dx} ${y + dy - 11 * s}L${x + dx + 8 * s} ${y + dy + 5 * s}L${x + dx - 8 * s} ${y + dy + 5 * s}Z" fill="#3f6b3a"/>` +
      `<rect x="${x + dx - 1.5 * s}" y="${y + dy + 5 * s}" width="${3 * s}" height="${5 * s}" fill="#5b4126"/>`;
    return tree(-9, 2, 0.85) + tree(9, 4, 0.75) + tree(1, -8, 0.9);
  }
  if (t === 'river') {
    return `<path d="M${x - 4} ${y - 22}Q${x + 6} ${y - 11} ${x - 2} ${y}T${x} ${y + 22}" stroke="#d9ecf7" stroke-width="2" fill="none" opacity=".8"/>`;
  }
  if (t === 'bridge') {
    const planks = Array.from({ length: 6 }, (_, i) => {
      const px = x - 30 + i * 10;
      return `<line x1="${px}" y1="${y - 11}" x2="${px}" y2="${y + 11}" stroke="#6b4a2b" stroke-width="1.2"/>`;
    }).join('');
    return `<rect x="${x - 34}" y="${y - 11}" width="68" height="22" rx="2" fill="#a77b4f" stroke="#6b4a2b" stroke-width="1.5"/>${planks}`;
  }
  return '';
}

export interface Overlay {
  selected: string | null;
  reach: Map<string, Reach>;
  targets: Map<string, AttackPreview>; // by unit id
}

export function renderBoard(s: GameState, o: Overlay): string {
  const { cols, rows } = CONFIG.board;
  const w = S * 1.5 * (cols - 1) + 2 * S;
  const h = R3 * S * (rows + 0.5);
  const parts: string[] = [];
  const tint = ARMY_COLOR[s.current];

  for (let r = 0; r < s.board.length; r++) {
    for (let c = 0; c < s.board[r].length; c++) {
      const hex = { col: c, row: r };
      const t = s.board[r][c];
      const [x, y] = center(hex);
      parts.push(
        `<polygon class="hex" data-col="${c}" data-row="${r}" points="${corners(hex)}" fill="${FILL[t]}" stroke="#b9ad86" stroke-width="1"/>`,
        decor(t, hex),
        `<text x="${x}" y="${y - S * 0.62}" class="coord">${hexName(hex)}</text>`,
      );
    }
  }

  for (const { hex, cost } of o.reach.values()) {
    const [x, y] = center(hex);
    parts.push(
      `<polygon points="${corners(hex, S - 3)}" fill="${tint}" fill-opacity=".16" stroke="#2f7d32" stroke-width="2.5" class="reach"/>`,
      `<text x="${x}" y="${y + 5}" class="cost">−${cost}</text>`,
    );
  }

  for (const u of s.units) {
    const [x, y] = center(u.pos);
    const sel = u.id === o.selected;
    if (sel) parts.push(`<polygon points="${corners(u.pos, S - 2)}" fill="#ffe27a" fill-opacity=".55" stroke="#c99a00" stroke-width="3"/>`);
    const p = o.targets.get(u.id);
    if (p) parts.push(`<polygon points="${corners(u.pos, S - 3)}" fill="#e53935" fill-opacity=".14" stroke="#d32f2f" stroke-width="3" stroke-dasharray="6 4"/>`);
    parts.push(`<g transform="translate(${x} ${y - 3})" class="unit">${unitSymbol(u.type, u.owner, u.hp)}</g>`);
    if (p) {
      const label = p.kills ? '✕' : `−${p.damage}`;
      parts.push(
        `<g transform="translate(${x + 17} ${y - 20})" class="badge"><circle r="10" fill="#d32f2f"/><text y="4">${label}</text></g>`,
      );
    }
  }

  return `<svg class="board" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" role="img">${parts.join('')}</svg>`;
}
