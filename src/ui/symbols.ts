// NATO-style unit symbols, drawn as SVG centred on (0,0).
// Heavy units: filled box, white mark. Light units: outlined box, coloured mark.

import { CONFIG, type UnitTypeId } from '../config';
import type { Player } from '../engine';

export const ARMY_COLOR: Record<Player, string> = { red: '#b3261e', blue: '#1f56a8' };

const W = 30;
const H = 20;

function mark(type: UnitTypeId, ink: string): string {
  const x = W / 2;
  const y = H / 2;
  const line = `stroke="${ink}" stroke-width="2" stroke-linecap="round" fill="none"`;
  switch (type) {
    case 'heavyInfantry':
    case 'lightInfantry':
      return `<path d="M${-x} ${-y}L${x} ${y}M${-x} ${y}L${x} ${-y}" ${line}/>`;
    case 'heavyCavalry':
    case 'lightCavalry':
      return `<path d="M${-x} ${y}L${x} ${-y}" ${line}/>`;
    case 'archer':
      // Bow facing right with its string and an arrow.
      return `<path d="M-3 -8Q7 0 -3 8M-3 -8L-3 8M-9 0L9 0M9 0L5 -3M9 0L5 3" ${line}/>`;
    case 'king':
      return `<path d="M-9 6L-9 -5L-4.5 0L0 -7L4.5 0L9 -5L9 6Z" fill="${ink}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/>`;
  }
}

export function unitSymbol(type: UnitTypeId, owner: Player, hp: number): string {
  const color = ARMY_COLOR[owner];
  const heavy = CONFIG.units[type].heavy;
  const max = CONFIG.units[type].hp;
  const box = heavy
    ? `<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" fill="${color}" stroke="${color}" stroke-width="2"/>`
    : `<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" fill="#fffdf6" stroke="${color}" stroke-width="2.2"/>`;
  const ink = heavy ? '#fffdf6' : color;
  // HP pips under the box: filled = HP left, hollow = HP lost.
  const pips = Array.from({ length: max }, (_, i) => {
    const cx = (i - (max - 1) / 2) * 7;
    return `<circle cx="${cx}" cy="${H / 2 + 6}" r="2.6" fill="${i < hp ? color : '#fffdf6'}" stroke="${color}" stroke-width="1.2"/>`;
  }).join('');
  return `<g>${box}<g>${mark(type, ink)}</g>${pips}</g>`;
}
