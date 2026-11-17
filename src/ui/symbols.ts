// Unit counters, drawn as SVG centred on (0,0): a box in the army colour with a picture
// of the piece. Heavy units have a filled box and a light picture; light units the reverse.

import { CONFIG, type UnitTypeId } from '../config';
import { maxHp, type Player } from '../engine';
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
    case 'deputy':
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
    case 'berserker':
      // A big two-handed axe.
      return `<path d="M-9 12L7 -10" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><path d="M2 -13Q13 -14 14 -3Q8 -6 5 -4Z" fill="${ink}"/><path d="M4 -11Q-4 -14 -6 -5Q0 -6 4 -4Z" fill="${ink}"/>`;
    case 'axeThrower':
      // A small axe in flight.
      return `<path d="M-10 9L4 -5" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><path d="M0 -9Q10 -11 11 -1Q6 -3 3 -2Z" fill="${ink}"/><path d="M-13 -6L-8 -6M-14 -1L-10 -1" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`;
    case 'ballista':
      // A bolt-thrower: bow arms, stock and bolt.
      return `<path d="M-3 -12Q8 0 -3 12" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><path d="M-13 0H12" stroke="${ink}" stroke-width="3" stroke-linecap="round"/><path d="M15 0L9 -3.5L9 3.5Z" fill="${ink}"/><path d="M-13 -4V4" stroke="${ink}" stroke-width="2"/>`;
    case 'lineInfantry':
      // A musket with a fixed bayonet.
      return `<path d="M-13 8L9 -5" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/><path d="M-14 4L-8 3L-6 9L-13 12Z" fill="${ink}"/><path d="M9 -5L16 -9" stroke="${ink}" stroke-width="1.3" stroke-linecap="round"/><path d="M7 -6.5L9.5 -2.5" stroke="${ink}" stroke-width="1.6"/>`;
    case 'skirmisher':
      // A short rifle aimed level, with a sight.
      return `<path d="M-12 3H13" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/><path d="M-13 1H-5L-4 4L-12 10L-15 7Z" fill="${ink}"/><path d="M11 3V-0.5" stroke="${ink}" stroke-width="1.6"/><path d="M-1 4L-1 7.5" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`;
    case 'cannon':
      // A field gun: barrel on a two-wheeled carriage.
      return `<path d="M-10 -1L13 -8" stroke="${ink}" stroke-width="4.2" stroke-linecap="round"/><path d="M-6 1L-14 10" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><circle cx="-2" cy="5" r="6" fill="none" stroke="${ink}" stroke-width="2"/><circle cx="-2" cy="5" r="1.4" fill="${ink}"/>`;
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

export function healthBar(hp: number, full: number): string {
  const gap = 1.5;
  const w = (W - 4 - gap * (full - 1)) / full;
  let out = `<rect x="${-W / 2}" y="${H / 2 + 2}" width="${W}" height="5" rx="2.5" fill="#000000aa"/>`;
  for (let i = 0; i < full; i++) {
    const x = -W / 2 + 2 + i * (w + gap);
    out += `<rect x="${x.toFixed(1)}" y="${H / 2 + 3}" width="${w.toFixed(1)}" height="3" rx="1.5" fill="${i < hp ? '#7ed957' : '#ffffff33'}"/>`;
  }
  return out;
}

/** A piece: a square counter with its picture. Heavy pieces are filled in the army colour,
 *  light pieces white with a coloured outline. A wounded piece (below full defense) gets a red edge. */
export function unitSymbol(type: UnitTypeId, owner: Player, hp: number): string {
  const color = armyColor(owner);
  const heavy = CONFIG.units[type].heavy;
  const full = maxHp(type);
  const wounded = hp < full;
  const box = `<rect x="${-W / 2}" y="${-H / 2}" width="${W}" height="${H}" rx="3" fill="${heavy ? color : '#fffdf6'}" stroke="${wounded ? '#ff4d3d' : color}" stroke-width="${wounded ? 3.2 : 2.4}"/>`;
  const ink = heavy ? '#fffdf6' : color;
  const own = factionOf(owner).art?.[type];
  // Once hit, a thin bar under the counter shows the hits it has left.
  const bar = wounded ? healthBar(hp, full) : '';
  return `<g>${box}${bar}<g>${own ? art(own, ink, heavy ? color : '#fffdf6') : picture(type, ink)}</g></g>`;
}

/** A stand-alone icon for lists and the army builder. */
export const unitIcon = (type: UnitTypeId, owner: Player) =>
  `<svg viewBox="-22 -16 44 32" width="44" height="32" aria-hidden="true">${unitSymbol(type, owner, maxHp(type))}</svg>`;
