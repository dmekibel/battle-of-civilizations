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

/** A Champion's star. */
const STAR = (ink: string, x: number, y: number, r: number) =>
  `<path transform="translate(${x} ${y}) scale(${r / 10})" d="M0 -10L2.9 -4H9.5L4.3 0.5L6.2 7.5L0 3.4L-6.2 7.5L-4.3 0.5L-9.5 -4H-2.9Z" fill="${ink}"/>`;

/** Pictures some armies use in place of the standard ones (no spears for the Cowboys). */
export type ArtId = 'star' | 'tsar' | 'cross' | 'khan' | 'shogun' | 'bonnet' | 'shotgun' | 'saber' | 'tomahawk' | 'lancer' | 'pharaoh' | 'tricorn' | 'turban' | 'quetzal' | 'inkosi' | 'wolf' | 'wingHelm' | 'bogatyr' | 'oni';

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
    case 'pharaoh':
      // The Pharaoh's striped nemes headdress with the cobra on the brow.
      return `<path d="M-6 -11Q0 -14 6 -11L9 -3L12 11H5L4 1H-4L-5 11H-12L-9 -3Z" fill="${ink}"/><path d="M-9.5 -1H9.5M-10.5 3.5H-4.5M4.5 3.5H10.5M-11.3 7.5H-5M5 7.5H11.3" stroke="${bg}" stroke-width="1.1"/><path d="M0 -12V-7" stroke="${bg}" stroke-width="1.6" stroke-linecap="round"/>`;
    case 'tricorn':
      // The pirate Captain's tricorn hat with a little skull.
      return `<path d="M-13 4Q-9 -9 0 -9Q9 -9 13 4Q6 0 0 3Q-6 0 -13 4Z" fill="${ink}"/><circle cx="0" cy="-3.5" r="2.4" fill="${bg}"/><path d="M-1 -1.5V0M1 -1.5V0" stroke="${bg}" stroke-width="0.9"/><path d="M-4 9L4 13M4 9L-4 13" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`;
    case 'turban':
      // The Sultan's great round turban with a jewel and a plume.
      return `<path d="M-11 5Q-13 -8 0 -9Q13 -8 11 5Z" fill="${ink}"/><path d="M-11.5 -0.5Q0 -6 11.5 -0.5M-11 3Q0 -2 11 3" stroke="${bg}" stroke-width="1" fill="none"/><circle cx="0" cy="-4.5" r="1.8" fill="${bg}"/><path d="M0 -8.5Q-2.5 -12 1.5 -15" stroke="${ink}" stroke-width="2.2" fill="none" stroke-linecap="round"/><rect x="-7.5" y="5" width="15" height="5.5" rx="1.5" fill="${ink}"/>`;
    case 'quetzal':
      // The Aztec emperor's fan of quetzal feathers on a band.
      return `<g transform="rotate(-56 0 9)"><path d="M0 9Q-2.8 -1 0 -13Q2.8 -1 0 9Z" fill="${ink}"/></g><g transform="rotate(-37 0 9)"><path d="M0 9Q-2.8 -1 0 -13Q2.8 -1 0 9Z" fill="${ink}"/></g><g transform="rotate(-18 0 9)"><path d="M0 9Q-2.8 -1 0 -13Q2.8 -1 0 9Z" fill="${ink}"/></g><g transform="rotate(0 0 9)"><path d="M0 9Q-2.8 -1 0 -13Q2.8 -1 0 9Z" fill="${ink}"/></g><g transform="rotate(18 0 9)"><path d="M0 9Q-2.8 -1 0 -13Q2.8 -1 0 9Z" fill="${ink}"/></g><g transform="rotate(37 0 9)"><path d="M0 9Q-2.8 -1 0 -13Q2.8 -1 0 9Z" fill="${ink}"/></g><g transform="rotate(56 0 9)"><path d="M0 9Q-2.8 -1 0 -13Q2.8 -1 0 9Z" fill="${ink}"/></g><rect x="-9" y="7" width="18" height="4.5" rx="1.5" fill="${ink}"/><path d="M-5 9.2H-3M-1 9.2H1M3 9.2H5" stroke="${bg}" stroke-width="1.4"/>`;
    case 'wolf':
      // The Ulfhednar's wolf-head hood: ears up, slit eyes, fangs.
      return `<path d="M-11 -12L-5 -4H5L11 -12L12 0L7 5L4 12H-4L-7 5L-12 0Z" fill="${ink}"/><path d="M-7 -1L-2.5 1.5M7 -1L2.5 1.5" stroke="${bg}" stroke-width="1.6" stroke-linecap="round"/><path d="M-3 7L-2 10L-1 7ZM1 7L2 10L3 7Z" fill="${bg}"/>`;
    case 'wingHelm':
      // The Grand Commander's great helm with black eagle wings.
      return `<path d="M-6 -5H6V9Q0 12.5 -6 9Z" fill="${ink}"/><path d="M-5 1H5M0 1V7" stroke="${bg}" stroke-width="1.4"/><g fill="${ink}"><path d="M-5 -6Q-15 -6 -14 -16Q-12 -12 -10 -12Q-11 -15 -8 -16Q-7 -11 -3 -8Z"/><path d="M5 -6Q15 -6 14 -16Q12 -12 10 -12Q11 -15 8 -16Q7 -11 3 -8Z"/></g>`;
    case 'bogatyr':
      // The Bogatyr: a tall pointed helmet over a long beard.
      return `<path d="M0 -15L7.5 -4H-7.5Z" fill="${ink}"/><rect x="-8.5" y="-4.5" width="17" height="3" rx="1" fill="${ink}"/><path d="M-6.5 0H6.5L5.5 7L0 13L-5.5 7Z" fill="${ink}"/><path d="M-4 -0.5H-1.5M1.5 -0.5H4" stroke="${bg}" stroke-width="1.3"/>`;
    case 'oni':
      // The hatamoto's demon mask: horns, glaring eyes, fangs.
      return `<g fill="${ink}"><path d="M-7 -6Q-13 -9 -11 -15Q-8 -11 -4 -8Z"/><path d="M7 -6Q13 -9 11 -15Q8 -11 4 -8Z"/><path d="M-8 -6Q0 -10 8 -6L9 3Q6 12 0 12Q-6 12 -9 3Z"/></g><path d="M-6.5 -2L-2 0M6.5 -2L2 0" stroke="${bg}" stroke-width="1.7" stroke-linecap="round"/><path d="M-5 4.5H5L4 8.5H-4Z" fill="${bg}"/><path d="M-3 4.5L-2 7.5L-1 4.5ZM1 4.5L2 7.5L3 4.5Z" fill="${ink}"/>`;
    case 'inkosi':
      // The Zulu king: a tall cowhide shield with a crane feather above it.
      return `<ellipse cx="0" cy="1" rx="7" ry="11.5" fill="${ink}"/><path d="M0 -10.5V12.5" stroke="${bg}" stroke-width="1.4"/><circle cx="-3" cy="-3" r="1.6" fill="${bg}"/><circle cx="3.2" cy="5" r="1.8" fill="${bg}"/><path d="M0 -10Q5 -15 11 -13" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    case 'tomahawk':
      // A war hatchet: a handle with a stone head.
      return `<path d="M-9 12L6 -9" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><path d="M1 -14L10 -11L9 -4L4 -8Z" fill="${ink}"/>`;
  }
}

function picture(type: UnitTypeId, ink: string, bg = '#fffdf6'): string {
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
    case 'champion':
      // A Champion: a big two-handed greatsword with a star.
      return `<path d="M-11 11L9 -9" stroke="${ink}" stroke-width="3" stroke-linecap="round"/><path d="M-9 3L-3 9" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><path d="M9 -9L13 -13" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>${STAR(ink, -7, -6, 6)}`;
    case 'championRider':
      // A mounted Champion: a horse, a long glaive and a star.
      return `${HORSE(ink, -4)}<path d="M-17 -1L12 -11" stroke="${ink}" stroke-width="2" stroke-linecap="round"/><path d="M10 -10Q15 -16 18 -14Q16 -10 12 -8Z" fill="${ink}"/>${STAR(ink, -11, -9, 5)}`;
    case 'championGun':
      // The bounty hunter: two crossed revolvers.
      return `<g transform="rotate(-25) translate(-1 -2) scale(0.8)"><path d="M-12 -5H9L11 -8H13V-2H4L0 2L-3 10H-9L-6 1H-12Z" fill="${ink}"/></g><g transform="scale(-1 1) rotate(-25) translate(-1 -2) scale(0.8)"><path d="M-12 -5H9L11 -8H13V-2H4L0 2L-3 10H-9L-6 1H-12Z" fill="${ink}"/></g>`;
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
    case 'chariot':
      // A horse pulling a two-wheeled chariot.
      return `${HORSE(ink, 3)}<path d="M-9 1H1" stroke="${ink}" stroke-width="2" stroke-linecap="round"/><path d="M-15 -6H-6V1H-15Z" fill="${ink}"/><circle cx="-10" cy="6" r="5.5" fill="none" stroke="${ink}" stroke-width="2"/><path d="M-10 0.5V11.5M-15.5 6H-4.5" stroke="${ink}" stroke-width="1.2"/>`;
    case 'boarder':
      // A cutlass: a short curved blade with a cup guard.
      return `<path d="M-6 7Q6 3 12 -11" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/><path d="M-11 4Q-9 12 -2 10" fill="none" stroke="${ink}" stroke-width="2"/><path d="M-9 9L-13 12" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
    case 'bomber':
      // A round bomb with a lit fuse.
      return `<circle cx="-2" cy="3" r="8" fill="${ink}"/><path d="M3 -3L6 -7Q8 -10 11 -9" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/><path d="M13 -13V-10M15.5 -9H12.5M13 -8L14.5 -6.5M11 -11L9.5 -12.5" stroke="${ink}" stroke-width="1.3" stroke-linecap="round"/>`;
    case 'jaguar':
      // A macuahuitl: a flat wooden club edged with obsidian teeth.
      return `<g transform="rotate(38)"><path d="M0 13V6" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/><rect x="-3" y="-14" width="6" height="21" rx="3" fill="${ink}"/><path d="M-3 -11L-6.5 -9.5L-3 -8ZM-3 -5.5L-6.5 -4L-3 -2.5ZM-3 0L-6.5 1.5L-3 3ZM3 -11L6.5 -9.5L3 -8ZM3 -5.5L6.5 -4L3 -2.5ZM3 0L6.5 1.5L3 3Z" fill="${ink}"/></g>`;
    case 'atlatl':
      // A feathered dart on its throwing stick.
      return `<path d="M-14 7L12 -6" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/><path d="M16 -8L8 -6.5L10.5 -2Z" fill="${ink}"/><path d="M-14 7L-15 1.5M-14 7L-9.5 9.5M-11 5.5L-12 0.5M-11 5.5L-6.5 8" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/><path d="M-6 9L6 3L6 0" stroke="${ink}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'impi':
      // A tall cowhide shield with the short stabbing spear behind it.
      return `<path d="M-13 12L9 -8" stroke="${ink}" stroke-width="2" stroke-linecap="round"/><path d="M14 -13Q8 -11 7 -6Q12 -7 14 -13Z" fill="${ink}"/><ellipse cx="-2" cy="1" rx="6.5" ry="12" fill="${ink}"/><path d="M-2 -10.5V12.5" stroke="${bg}" stroke-width="1.4"/><path d="M-5 -4V-1M1 3V6" stroke="${bg}" stroke-width="1.6" stroke-linecap="round"/>`;
    case 'thrower':
      // A throwing spear in flight.
      return `<path d="M-11 10L6 -6" stroke="${ink}" stroke-width="2" stroke-linecap="round"/><path d="M13 -12Q6 -10 4.5 -5Q10 -5.5 13 -12Z" fill="${ink}"/><path d="M-14 -3L-8 -3M-15 2L-10 2M-12 -8L-7 -8" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`;
    case 'samurai':
      // A katana: a long, slightly curved blade with a round guard.
      return `<path d="M-11 10Q1 4 12 -11" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><circle cx="-5" cy="6.3" r="2.6" fill="none" stroke="${ink}" stroke-width="1.8"/>`;
    case 'ashigaru':
      // A yari: a tall straight spear with a cross-bar.
      return `<path d="M0 12V-8M-5 -5H5" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><path d="M0 -14L-3 -7H3Z" fill="${ink}"/>`;
    case 'banner':
      // A standard: a pole with a swallow-tailed flag.
      return `<path d="M-6 13V-13" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><path d="M-5 -12H12L7 -6.5L12 -1H-5Z" fill="${ink}"/>`;
    case 'scout':
      // A fir tree with a dagger across it: the scout who walks through the woods.
      return `<path d="M-4 -13L-11 -2H-7L-12 6H4L-1 -2H3Z" fill="${ink}"/><path d="M-4 6V10" stroke="${ink}" stroke-width="2.2"/><path d="M2 11L13 -3" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><path d="M0 6L5 10" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`;
    case 'shieldbearer':
      // A big round shield with an arrow glancing off it.
      return `<circle cx="-1" cy="1" r="10" fill="none" stroke="${ink}" stroke-width="2.4"/><circle cx="-1" cy="1" r="3" fill="${ink}"/><path d="M5 -12L14 -7" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/><path d="M3 -13L8 -13L6 -9Z" fill="${ink}"/>`;
    case 'rocket':
      // A rocket on its long stick, climbing in an arc.
      return `<path d="M-14 12Q-6 -2 6 -7" fill="none" stroke="${ink}" stroke-width="1.6" stroke-dasharray="2.5 2" stroke-linecap="round"/><path d="M4 -5L13 -11" stroke="${ink}" stroke-width="4.6" stroke-linecap="round"/><path d="M14 -12L18 -13L16 -9Z" fill="${ink}"/>`;
    case 'crossbow':
      // A crossbow (or matchlock): a stock with a bow across its front.
      return `<path d="M-12 8L10 -6" stroke="${ink}" stroke-width="3" stroke-linecap="round"/><path d="M1 -12Q9 -4 14 3" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round"/><path d="M1 -12L14 3" stroke="${ink}" stroke-width="1"/><path d="M-14 4L-8 4L-7 9L-13 12Z" fill="${ink}"/>`;
    case 'longRifle':
      // A long rifle resting on crossed shooting sticks.
      return `<path d="M-15 0L15 -6" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/><path d="M-16 -3L-9 -3L-8 2L-15 4Z" fill="${ink}"/><path d="M2 12L9 -6M9 12L2 -6" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>`;
    case 'wildRider':
      // A horse with a wing above it: the wild rider.
      return `${HORSE(ink, -4)}<path d="M2 -9Q8 -17 16 -15Q12 -13 13 -10Q9 -11 8 -8Q5 -9 2 -9Z" fill="${ink}"/>`;
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
  return `<g>${box}${bar}<g>${own ? art(own, ink, heavy ? color : '#fffdf6') : picture(type, ink, heavy ? color : '#fffdf6')}</g></g>`;
}

/** A stand-alone icon for lists and the army builder. */
export const unitIcon = (type: UnitTypeId, owner: Player) =>
  `<svg viewBox="-22 -16 44 32" width="44" height="32" aria-hidden="true">${unitSymbol(type, owner, maxHp(type))}</svg>`;
