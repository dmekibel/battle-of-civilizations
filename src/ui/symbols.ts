// Unit counters, drawn as SVG centred on (0,0): a box in the army colour with a picture
// of the piece. Heavy units have a filled box and a light picture; light units the reverse.

import { CONFIG, type UnitTypeId } from '../config';
import type { Player } from '../engine';

// Novgorod: crimson. Teutonic Order: black (their white mantles with the black cross).
export const ARMY_COLOR: Record<Player, string> = { red: '#a8201a', blue: '#1b1b1d' };

/** Coat of arms for each side, for the pass-the-phone and battle screens. */
export const EMBLEM: Record<Player, string> = {
  red: `<svg viewBox="0 0 60 70" width="60" height="70" aria-hidden="true"><path d="M4 4H56V30Q56 56 30 66Q4 56 4 30Z" fill="#a8201a" stroke="#d9a521" stroke-width="3"/><path d="M15 44L15 24L22.5 32L30 18L37.5 32L45 24L45 44Z" fill="#e8b923" stroke="#8a6410" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  blue: `<svg viewBox="0 0 60 70" width="60" height="70" aria-hidden="true"><path d="M4 4H56V30Q56 56 30 66Q4 56 4 30Z" fill="#f4f1e8" stroke="#1b1b1d" stroke-width="3"/><path d="M24 12H36L33 28H48V40H33L36 58H24L27 40H12V28H27Z" fill="#1b1b1d"/></svg>`,
};

const HORSE = (ink: string, dx = 0) =>
  `<path transform="translate(${dx} 0)" d="M-7 12L-7 3C-7 -5 -2 -10 4 -10L6 -13L7.5 -9C11 -7 13 -3 13 1L13 3L9 4L5 1L3 3L3 12Z" fill="${ink}"/>`;

/** The sign of each piece type, drawn about 26 units wide around (0,0). */
function picture(type: UnitTypeId, ink: string): string {
  const line = `stroke="${ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  switch (type) {
    case 'king':
      return `<path d="M-11 7L-11 -6L-5.5 0L0 -9L5.5 0L11 -6L11 7Z" fill="${ink}" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round"/>`;
    case 'heavyInfantry':
      // A sword, point up.
      return `<path d="M0 -12L0 10M-6 4L6 4" ${line}/><path d="M-2 -12L0 -15L2 -12Z" fill="${ink}"/>`;
    case 'lightInfantry':
      // A spear.
      return `<path d="M-12 11L8 -7" ${line}/><path d="M14 -12L5 -9L9 -4Z" fill="${ink}"/>`;
    case 'heavyCavalry':
      // A horse with a couched lance.
      return `${HORSE(ink, -3)}<path d="M-15 -2L16 -12" ${line}/>`;
    case 'lightCavalry':
      return HORSE(ink, -3);
    case 'archer':
      // A bow drawn with an arrow on the string.
      return `<path d="M-4 -12Q10 0 -4 12" ${line}/><path d="M-4 -12L-4 12M-12 0L11 0" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/><path d="M14 0L9 -3L9 3Z" fill="${ink}"/>`;
  }
}

// Heater shield, centred on (0,0): flat top at y -21, point at y 24.
const SHIELD = 'M-18 -21H18V-3Q18 15 0 24Q-18 15 -18 -3Z';

/** Rank sets the size, as in shogi: the King is biggest, light pieces the smallest. */
const RANK: Record<UnitTypeId, number> = {
  king: 1.12, heavyInfantry: 1, heavyCavalry: 1, lightInfantry: 0.88, lightCavalry: 0.88, archer: 0.88,
};

/** Each army's coat of arms on the shield face. */
function arms(owner: Player): string {
  return owner === 'blue'
    ? // Teutonic Order: white field, black cross.
      `<path d="${SHIELD}" fill="#f2efe6"/><path d="M-4 -21H4V17H-4ZM-18 -6H18V2H-18Z" fill="#151517"/>`
    : // Novgorod: crimson field, gold chief.
      `<path d="${SHIELD}" fill="#a8201a"/><path d="M-18 -21H18V-13H-18Z" fill="#e1b12c"/>`;
}

/** A piece: a heraldic shield in its army's arms with the piece's sign in a round badge.
 *  Heavy pieces have a thick metal rim, light pieces a thin leather edge. A wounded piece
 *  (below full defense) has its rim and badge ring turned red. */
export function unitSymbol(type: UnitTypeId, owner: Player, hp: number): string {
  const heavy = CONFIG.units[type].heavy;
  const wounded = hp < CONFIG.units[type].hp;
  const blue = owner === 'blue';
  const [outer, inner] = wounded ? ['#6d0d08', '#ff4d3d'] : blue ? ['#4b5055', '#a9afb5'] : ['#8a6410', '#e1b12c'];
  const rim = heavy
    ? `<path d="${SHIELD}" fill="none" stroke="${outer}" stroke-width="5"/><path d="${SHIELD}" fill="none" stroke="${inner}" stroke-width="2.4"/>`
    : `<path d="${SHIELD}" fill="none" stroke="#5b3a1e" stroke-width="2"/>`;
  const ring = wounded ? '#ff4d3d' : blue ? '#f2efe6' : '#8a6410';
  const badge =
    `<circle cy="2" r="12.5" fill="${blue ? '#151517' : '#f6e7cf'}" stroke="${ring}" stroke-width="${wounded ? 2.6 : 1.5}"/>` +
    `<g transform="translate(0 2) scale(.66)">${picture(type, blue ? '#f2efe6' : '#a8201a')}</g>`;
  return `<g transform="scale(${RANK[type]})">${arms(owner)}${rim}${badge}</g>`;
}

/** A stand-alone icon for lists and the army builder. */
export const unitIcon = (type: UnitTypeId, owner: Player) =>
  `<svg viewBox="-23 -27 46 54" width="38" height="44" aria-hidden="true">${unitSymbol(type, owner, CONFIG.units[type].hp)}</svg>`;
