// Unit counters, drawn as SVG centred on (0,0): a box in the army colour with a picture
// of the piece. Heavy units have a filled box and a light picture; light units the reverse.

import { CONFIG, type UnitTypeId } from '../config';
import type { Player } from '../engine';
import { factionOf } from './factions';

/** A side's army colour comes from the faction it leads. */
export const armyColor = (p: Player) => factionOf(p).color;

const W = 40;
const H = 28;

const SWORD = (ink: string) =>
  `<path d="M0 -11L0 5M-5 4L5 4M0 5L0 9" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>` +
  `<circle cx="0" cy="10.5" r="1.6" fill="${ink}"/>`;

const HORSE = (ink: string, dx = 0) =>
  `<path transform="translate(${dx} 0)" d="M-7 12L-7 3C-7 -5 -2 -10 4 -10L6 -13L7.5 -9C11 -7 13 -3 13 1L13 3L9 4L5 1L3 3L3 12Z" fill="${ink}"/>`;

function picture(type: UnitTypeId, ink: string): string {
  switch (type) {
    case 'king':
      return `<path d="M-11 7L-11 -6L-5.5 0L0 -9L5.5 0L11 -6L11 7Z" fill="${ink}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
    case 'heavyInfantry':
      // Shield and sword.
      return `<path d="M-10 -10H10V-1Q10 8 0 12Q-10 8 -10 -1Z" fill="none" stroke="${ink}" stroke-width="2"/>${SWORD(ink)}`;
    case 'lightInfantry':
      // Spear.
      return `<path d="M-13 11L9 -6" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><path d="M15 -11L6 -8L10 -3Z" fill="${ink}"/>`;
    case 'heavyCavalry':
      // Horse with a couched lance.
      return `${HORSE(ink, -3)}<path d="M-16 -2L17 -12" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>`;
    case 'lightCavalry':
      return HORSE(ink, -3);
    case 'horseArcher':
      // A horse with a bow above its back.
      return `${HORSE(ink, -6)}<path d="M6 -14Q16 -5 6 4" fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round"/><path d="M6 -14L6 4" stroke="${ink}" stroke-width="1.2"/>`;
    case 'samurai':
      // A katana: a long, slightly curved blade with a round guard.
      return `<path d="M-11 10Q1 4 12 -11" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><circle cx="-5" cy="6.3" r="2.6" fill="none" stroke="${ink}" stroke-width="1.8"/>`;
    case 'ashigaru':
      // A yari: a tall straight spear with a cross-bar.
      return `<path d="M0 12V-8M-5 -5H5" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><path d="M0 -14L-3 -7H3Z" fill="${ink}"/>`;
    case 'archer':
      // Bow drawn with an arrow on the string.
      return `<path d="M-4 -12Q10 0 -4 12" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>` +
        `<path d="M-4 -12L-4 12M-12 0L11 0" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/><path d="M14 0L9 -3L9 3Z" fill="${ink}"/>`;
  }
}

/** A piece: a square counter with its picture. Heavy pieces are filled in the army colour,
 *  light pieces white with a coloured outline. A wounded piece (below full defense) gets a red edge. */
export function unitSymbol(type: UnitTypeId, owner: Player, hp: number): string {
  const color = armyColor(owner);
  const heavy = CONFIG.units[type].heavy;
  const wounded = hp < CONFIG.units[type].hp;
  const box = `<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="3" fill="${heavy ? color : '#fffdf6'}" stroke="${wounded ? '#ff4d3d' : color}" stroke-width="${wounded ? 3.2 : 2.4}"/>`;
  const ink = heavy ? '#fffdf6' : color;
  return `<g>${box}<g>${picture(type, ink)}</g></g>`;
}

/** A stand-alone icon for lists and the army builder. */
export const unitIcon = (type: UnitTypeId, owner: Player) =>
  `<svg viewBox="-22 -16 44 32" width="44" height="32" aria-hidden="true">${unitSymbol(type, owner, CONFIG.units[type].hp)}</svg>`;
