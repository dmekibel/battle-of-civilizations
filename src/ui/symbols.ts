// Unit counters, drawn as SVG centred on (0,0): a box in the army colour with a picture
// of the piece. Heavy units have a filled box and a light picture; light units the reverse.

import { CONFIG, type UnitTypeId } from '../config';
import type { Player } from '../engine';
import { factionOf, kabuto } from './factions';

/** A side's army colour comes from the faction it leads. */
export const armyColor = (p: Player) => factionOf(p).color;

const W = 40;
const H = 28;

const SWORD = (ink: string) =>
  `<path d="M0 -11L0 5M-5 4L5 4M0 5L0 9" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/>` +
  `<circle cx="0" cy="10.5" r="1.6" fill="${ink}"/>`;

const HORSE = (ink: string, dx = 0) =>
  `<path transform="translate(${dx} 0)" d="M-7 12L-7 3C-7 -5 -2 -10 4 -10L6 -13L7.5 -9C11 -7 13 -3 13 1L13 3L9 4L5 1L3 3L3 12Z" fill="${ink}"/>`;

/** Pictures some armies use in place of the standard ones (no spears for the Cowboys). */
export type ArtId = 'star' | 'tsar' | 'cross' | 'khan' | 'shogun' | 'bonnet' | 'shotgun' | 'saber' | 'tomahawk' | 'lancer';

function art(id: ArtId, ink: string, bg: string): string {
  switch (id) {
    case 'star':
      // The Sheriff's badge.
      return `<path d="M0 -11L3 -3.5H11L4.5 1.5L7 9.5L0 4.5L-7 9.5L-4.5 1.5L-11 -3.5H-3Z" fill="${ink}"/>`;
    case 'tsar':
      // The Tsar's fur-trimmed cap with a cross.
      return `<path d="M0 -13V-7M-2.6 -10.5H2.6" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/><path d="M-8 3Q-8 -7.5 0 -7.5Q8 -7.5 8 3Z" fill="${ink}"/><rect x="-10.5" y="3" width="21" height="6.5" rx="3" fill="${ink}"/><path d="M-6 5.5V7M-2 5.5V7M2 5.5V7M6 5.5V7" stroke="${bg}" stroke-width="1.2"/>`;
    case 'cross':
      // The Grand Master's black cross (cross pattée).
      return `<path d="M-4 -12H4L2 -3.5L10.5 -5.5V2.5L2 0.5L4 12H-4L-2 0.5L-10.5 2.5V-5.5L-2 -3.5Z" fill="${ink}"/>`;
    case 'khan':
      // The Khan's pointed hat with a fur brim.
      return `<path d="M-8 4Q-7 -4 0 -13Q7 -4 8 4Z" fill="${ink}"/><rect x="-11" y="3.5" width="22" height="6.5" rx="3" fill="${ink}"/><path d="M0 -13L4 -9" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/><path d="M-11 6.7H11" stroke="${bg}" stroke-width="1"/>`;
    case 'shogun':
      // A shogun's horned helmet (kabuto).
      return kabuto(ink, bg, 'scale(0.088) translate(-300 -272)');
    case 'bonnet':
      // A chief's feathered war bonnet.
      return `<g transform="rotate(-60 0 8)"><path d="M0 8Q-3.2 -2 0 -12Q3.2 -2 0 8Z" fill="${ink}"/><path d="M0 -12Q-1.4 -9.5 0 -7Q1.4 -9.5 0 -12Z" fill="${bg}"/></g><g transform="rotate(-30 0 8)"><path d="M0 8Q-3.2 -2 0 -12Q3.2 -2 0 8Z" fill="${ink}"/><path d="M0 -12Q-1.4 -9.5 0 -7Q1.4 -9.5 0 -12Z" fill="${bg}"/></g><g transform="rotate(0 0 8)"><path d="M0 8Q-3.2 -2 0 -12Q3.2 -2 0 8Z" fill="${ink}"/><path d="M0 -12Q-1.4 -9.5 0 -7Q1.4 -9.5 0 -12Z" fill="${bg}"/></g><g transform="rotate(30 0 8)"><path d="M0 8Q-3.2 -2 0 -12Q3.2 -2 0 8Z" fill="${ink}"/><path d="M0 -12Q-1.4 -9.5 0 -7Q1.4 -9.5 0 -12Z" fill="${bg}"/></g><g transform="rotate(60 0 8)"><path d="M0 8Q-3.2 -2 0 -12Q3.2 -2 0 8Z" fill="${ink}"/><path d="M0 -12Q-1.4 -9.5 0 -7Q1.4 -9.5 0 -12Z" fill="${bg}"/></g><rect x="-9" y="6" width="18" height="4.5" rx="1.5" fill="${ink}"/>`;
    case 'shotgun':
      // A short double-barrelled shotgun.
      return `<path d="M-6 -1L14 -7M-6 2.5L14 -3.5" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/><path d="M-6 -2L-4 3L-13 10L-15 6Z" fill="${ink}"/>`;
    case 'saber':
      // A cavalry trooper: horse with an upright, curved saber beside it.
      return `${HORSE(ink, -7)}<path d="M13 8Q17 -3 12 -13" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><path d="M10 6.5L17 8.5M13.5 8L12.5 12" stroke="${ink}" stroke-width="2" stroke-linecap="round"/>`;
    case 'lancer':
      // A rider with a long lance (Comanche mounted warriors).
      return picture('heavyCavalry', ink);
    case 'tomahawk':
      // A war hatchet: a handle with a stone head.
      return `<path d="M-9 12L6 -9" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><path d="M1 -14L10 -11L9 -4L4 -8Z" fill="${ink}"/>`;
  }
}

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
    case 'gunslinger':
      // A revolver.
      return `<path d="M-12 -5H9L11 -8H13V-2H4L0 2L-3 10H-9L-6 1H-12Z" fill="${ink}"/>`;
    case 'rifleman':
      // A long rifle with its stock.
      return `<path d="M-14 6L12 -6" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/><path d="M-15 2L-8 2L-6 8L-14 11Z" fill="${ink}"/><path d="M12 -6L15 -7" stroke="${ink}" stroke-width="1.6"/>`;
    case 'cowboy':
      // A horse with a lasso loop beside it.
      return `${HORSE(ink, -7)}<ellipse cx="13" cy="-5" rx="4.6" ry="6.5" fill="none" stroke="${ink}" stroke-width="2"/><path d="M12 1.5Q11 8 15 12" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`;
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
  const own = factionOf(owner).art?.[type];
  return `<g>${box}<g>${own ? art(own, ink, heavy ? color : '#fffdf6') : picture(type, ink)}</g></g>`;
}

/** A stand-alone icon for lists and the army builder. */
export const unitIcon = (type: UnitTypeId, owner: Player) =>
  `<svg viewBox="-22 -16 44 32" width="44" height="32" aria-hidden="true">${unitSymbol(type, owner, CONFIG.units[type].hp)}</svg>`;
