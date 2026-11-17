// The armies a side can lead. The rules engine only knows "red" (moves first) and "blue";
// a faction gives a side its name, colours, coat of arms and the pieces it can buy.

import type { UnitTypeId } from '../config';
import type { ArmyCounts, Player } from '../engine';
import type { Lang } from './i18n';
import type { ArtId } from './symbols';

export type FactionId = 'novgorod' | 'teutonic' | 'mongols' | 'japanese' | 'frontier' | 'comanche' | 'vikings' | 'romans';
/** Armies are grouped by the age they fought in. */
export type Era = 'ancient' | 'medieval' | 'gunpowder';
export const ERAS: Era[] = ['ancient', 'medieval', 'gunpowder'];
export const ERA_OF: Record<FactionId, Era> = { romans: 'ancient', vikings: 'medieval', novgorod: 'medieval', teutonic: 'medieval', mongols: 'medieval', japanese: 'medieval', frontier: 'gunpowder', comanche: 'gunpowder' };

export interface Faction {
  name: Record<Lang, string>;
  /** The army's colour on pieces and banners. */
  color: string;
  /** A lighter version for text on the dark panels. */
  text: string;
  /** What this army can buy (its King always comes free). */
  roster: (keyof ArmyCounts)[];
  /** One line on how the army plays, for the New battle screen. */
  blurb: Record<Lang, string>;
  emblem: string;
  /** Some armies call shared pieces by their own names (a Comanche King is a Chief). */
  names?: Partial<Record<UnitTypeId, Record<Lang, string>>>;
  /** Pieces drawn with the army's own picture (the Sheriff's badge, a tomahawk). */
  art?: Partial<Record<UnitTypeId, ArtId>>;
}

/** A samurai helmet (kabuto) drawn about (300, 270), 270 wide: crescent horns, crest,
 *  dome, face mask and stepped neck guards. Gaps come from a stroke in the background colour. */
export function kabuto(ink: string, bg: string, transform: string): string {
  const side = 'M246 284L224 279L204 299L216 304L190 324L206 330L186 354L206 360L212 382L236 412L240 340Z';
  return `<g transform="${transform}" fill="${ink}" stroke="${bg}" stroke-width="9" stroke-linejoin="round">` +
    `<path d="M166 124Q166 304 300 304Q434 304 434 124L390 152Q388 252 300 254Q212 252 210 152Z"/>` +
    `<path d="${side}"/><path d="${side}" transform="translate(600 0) scale(-1 1)"/>` +
    `<path d="M300 164L320 192L300 216L280 192Z"/>` +
    `<path d="M242 266Q242 210 300 210Q358 210 358 266V292H242Z"/>` +
    `<path d="M250 314H350V356L300 394L250 356Z"/></g>`;
}

const shield = (fill: string, rim: string, inner: string) =>
  `<svg viewBox="0 0 60 70" width="60" height="70" aria-hidden="true"><path d="M4 4H56V30Q56 56 30 66Q4 56 4 30Z" fill="${fill}" stroke="${rim}" stroke-width="3"/>${inner}</svg>`;

export const FACTIONS: Record<FactionId, Faction> = {
  novgorod: {
    name: { en: 'Russians', ru: 'Русь' },
    color: '#a8201a',
    text: '#ec6a5c',
    roster: ['lightInfantry', 'heavyInfantry', 'archer', 'lightCavalry', 'heavyCavalry'],
    blurb: { en: 'Balanced Rus army: spearmen, archers and druzhina riders.', ru: 'Сбалансированное русское войско: копейщики, лучники и дружина.' },
    emblem: shield('#a8201a', '#d9a521', '<path d="M30 8V17M26 11H34" stroke="#e8b923" stroke-width="2.2"/><path d="M30 17Q41 25 38 34H22Q19 25 30 17Z" fill="#e8b923"/><path d="M23 34H37V48H23Z" fill="#e8b923"/><path d="M28 39H32V48H28Z" fill="#a8201a"/><path d="M17 48H43V52H17Z" fill="#e8b923"/>'),
    art: { king: 'tsar' },
  },
  teutonic: {
    name: { en: 'German Knights', ru: 'Немецкие рыцари' },
    color: '#1b1b1d',
    text: '#e9e4d6',
    roster: ['lightInfantry', 'heavyInfantry', 'archer', 'lightCavalry', 'heavyCavalry'],
    blurb: { en: 'Crusader knights: heavy cavalry and disciplined foot.', ru: 'Рыцари-крестоносцы: тяжёлая конница и стойкая пехота.' },
    emblem: shield('#f4f1e8', '#1b1b1d', '<path d="M24 12H36L33 28H48V40H33L36 58H24L27 40H12V28H27Z" fill="#1b1b1d"/>'),
    art: { king: 'cross' },
  },
  mongols: {
    name: { en: 'Mongols', ru: 'Монголы' },
    color: '#1f5fa8',
    text: '#86b9f0',
    roster: ['lightInfantry', 'archer', 'lightCavalry', 'heavyCavalry', 'horseArcher'],
    blurb: { en: 'Horse archers: shoot and ride. Few foot soldiers, no heavy infantry.', ru: 'Конные лучники: стреляют на скаку. Мало пехоты, нет тяжёлой пехоты.' },
    emblem: shield('#1f5fa8', '#e1b12c', '<path d="M22 14Q46 32 22 50" fill="none" stroke="#e1b12c" stroke-width="3.2" stroke-linecap="round"/><path d="M22 14V50" stroke="#e1b12c" stroke-width="1.5"/><path d="M12 32H44" stroke="#e1b12c" stroke-width="2.2"/><path d="M50 32L43 28V36Z" fill="#e1b12c"/>'),
    art: { king: 'khan' },
  },
  japanese: {
    name: { en: 'Japan', ru: 'Япония' },
    color: '#5b2a86',
    text: '#c7a6ef',
    roster: ['ashigaru', 'samurai', 'archer', 'lightCavalry', 'heavyCavalry'],
    blurb: { en: 'Samurai who hit hard, and cheap ashigaru spearmen that stop cavalry.', ru: 'Самураи бьют сильно, дешёвые асигару с копьями останавливают конницу.' },
    emblem: shield('#f4f1e8', '#5b2a86', kabuto('#5b2a86', '#f4f1e8', 'translate(30 37) scale(0.15) translate(-300 -270)')),
    art: { king: 'shogun' },
  },
  frontier: {
    name: { en: 'Cowboys', ru: 'Ковбои' },
    color: '#8a5a2b',
    text: '#e3b781',
    roster: ['deputy', 'gunslinger', 'rifleman', 'cowboy', 'heavyCavalry'],
    blurb: { en: 'The Old West: riflemen, gunslingers, deputies with shotguns and cowboys who shoot from the saddle.', ru: 'Дикий Запад: стрелки, помощники шерифа с дробовиками и ковбои, стреляющие на скаку.' },
    emblem: shield('#8a5a2b', '#e1b12c', '<path d="M30 14L34 25H45L36 32L39 43L30 36L21 43L24 32L15 25H26Z" fill="#e1b12c" stroke="#6b4410" stroke-width="1.2" stroke-linejoin="round"/>'),
    names: {
      king: { en: 'Sheriff', ru: 'Шериф' },
      lightInfantry: { en: 'Deputies', ru: 'Помощники шерифа' },
      heavyCavalry: { en: 'Cavalry troopers', ru: 'Кавалеристы' },
    },
    art: { king: 'star', lightInfantry: 'shotgun', deputy: 'shotgun', heavyCavalry: 'saber' },
  },
  comanche: {
    name: { en: 'Indians', ru: 'Индейцы' },
    color: '#1f8a8a',
    text: '#7fd6d0',
    roster: ['lightInfantry', 'archer', 'lightCavalry', 'horseArcher'],
    blurb: { en: 'Plains warriors, the finest riders of the West: fast mounted warriors and archers, no heavy troops.', ru: 'Воины равнин, лучшие всадники Запада: быстрые конные воины и лучники, без тяжёлых войск.' },
    emblem: shield('#1f8a8a', '#e9e4d6', '<g transform="rotate(-48 30 48)"><path d="M30 48Q24.5 31 30 12Q35.5 31 30 48Z" fill="#f4f1e8"/><path d="M30 12Q27.8 16.5 30 21Q32.2 16.5 30 12Z" fill="#1b1b1d"/></g><g transform="rotate(-24 30 48)"><path d="M30 48Q24.5 31 30 12Q35.5 31 30 48Z" fill="#f4f1e8"/><path d="M30 12Q27.8 16.5 30 21Q32.2 16.5 30 12Z" fill="#1b1b1d"/></g><g transform="rotate(0 30 48)"><path d="M30 48Q24.5 31 30 12Q35.5 31 30 48Z" fill="#f4f1e8"/><path d="M30 12Q27.8 16.5 30 21Q32.2 16.5 30 12Z" fill="#1b1b1d"/></g><g transform="rotate(24 30 48)"><path d="M30 48Q24.5 31 30 12Q35.5 31 30 48Z" fill="#f4f1e8"/><path d="M30 12Q27.8 16.5 30 21Q32.2 16.5 30 12Z" fill="#1b1b1d"/></g><g transform="rotate(48 30 48)"><path d="M30 48Q24.5 31 30 12Q35.5 31 30 48Z" fill="#f4f1e8"/><path d="M30 12Q27.8 16.5 30 21Q32.2 16.5 30 12Z" fill="#1b1b1d"/></g><path d="M17 44H43V50H17Z" fill="#e1b12c"/><path d="M21 47H23M27 47H29M31 47H33M37 47H39" stroke="#a8201a" stroke-width="2"/>'),
    names: {
      king: { en: 'Chief', ru: 'Вождь' },
      lightInfantry: { en: 'Warriors', ru: 'Воины' },
      lightCavalry: { en: 'Mounted warriors', ru: 'Конные воины' },
      horseArcher: { en: 'Mounted archers', ru: 'Конные лучники' },
    },
    art: { king: 'bonnet', lightInfantry: 'tomahawk', lightCavalry: 'lancer' },
  },
  vikings: {
    name: { en: 'Vikings', ru: 'Викинги' },
    color: '#2f5f8f',
    text: '#8fc0ee',
    roster: ['lightInfantry', 'heavyInfantry', 'berserker', 'axeThrower', 'archer'],
    blurb: { en: 'Raiders on foot: berserkers who hit twice as hard but fall to one blow, and axes thrown from close range. No horses.', ru: 'Пешие налётчики: берсерки бьют вдвое сильнее, но падают от одного удара; топоры летят с близкого расстояния. Конницы нет.' },
    emblem: shield('#2f5f8f', '#e9e4d6', '<circle cx="30" cy="32" r="17" fill="none" stroke="#e9e4d6" stroke-width="3"/><path d="M30 15V49M13 32H47" stroke="#e9e4d6" stroke-width="3"/><circle cx="30" cy="32" r="4.5" fill="#d9a521"/>'),
    names: {
      king: { en: 'Jarl', ru: 'Ярл' },
      lightInfantry: { en: 'Raiders', ru: 'Налётчики' },
      heavyInfantry: { en: 'Huscarls', ru: 'Хускарлы' },
    },
  },
  romans: {
    name: { en: 'Romans', ru: 'Римляне' },
    color: '#c08a14',
    text: '#f0c95a',
    roster: ['lightInfantry', 'heavyInfantry', 'archer', 'heavyCavalry', 'ballista'],
    blurb: { en: 'The legion: solid heavy infantry, a few riders, and a ballista that hits hard from far away but crawls.', ru: 'Легион: крепкая тяжёлая пехота, немного конницы и баллиста, которая бьёт издалека, но еле ползёт.' },
    emblem: shield('#8e1b2e', '#e8b923', '<path d="M30 14L33 26H46L35.5 33.5L39.5 46L30 38.5L20.5 46L24.5 33.5L14 26H27Z" fill="#e8b923"/>'),
    names: {
      king: { en: 'Legate', ru: 'Легат' },
      lightInfantry: { en: 'Auxiliaries', ru: 'Ауксиларии' },
      heavyInfantry: { en: 'Legionaries', ru: 'Легионеры' },
      heavyCavalry: { en: 'Equites', ru: 'Всадники' },
    },
  },
};

export const FACTION_ORDER: FactionId[] = ['romans', 'vikings', 'novgorod', 'teutonic', 'mongols', 'japanese', 'frontier', 'comanche'];

/** Which faction each side leads in the current battle. */
export let sides: Record<Player, FactionId> = { red: 'novgorod', blue: 'teutonic' };

/** Older saves may name an army that was renamed or removed. */
export function known(id: string | undefined, fallback: FactionId): FactionId {
  const f = id === 'lakota' ? 'comanche' : id;
  return f && f in FACTIONS ? (f as FactionId) : fallback;
}

/** Sets both sides' factions and repaints the colours the page uses for them. */
export function setSides(wanted: Record<Player, string>) {
  const next = { red: known(wanted.red, 'novgorod'), blue: known(wanted.blue, 'teutonic') };
  sides = next;
  const root = document.documentElement.style;
  root.setProperty('--red', FACTIONS[next.red].color);
  root.setProperty('--red-text', FACTIONS[next.red].text);
  root.setProperty('--blue', FACTIONS[next.blue].color);
  root.setProperty('--blue-text', FACTIONS[next.blue].text);
}

export const factionOf = (p: Player) => FACTIONS[sides[p]];

/** Pieces in the order the army builder and the pieces list show them. */
export const rosterOf = (p: Player): UnitTypeId[] => factionOf(p).roster;
