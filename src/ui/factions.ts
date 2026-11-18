// The armies a side can lead. The rules engine only knows "red" (moves first) and "blue";
// a faction gives a side its name, colours, coat of arms and the pieces it can buy.

import type { UnitTypeId } from '../config';
import { registerArmyMix, type ArmyCounts, type ArmyMix, type Player } from '../engine';
import type { Lang } from './i18n';
import type { ArtId } from './symbols';

export type FactionId = 'novgorod' | 'teutonic' | 'mongols' | 'japanese' | 'frontier' | 'comanche' | 'vikings' | 'romans' | 'british' | 'french' | 'egypt' | 'pirates' | 'ottomans' | 'aztecs' | 'zulus';
/** Armies are grouped by the age they fought in. */
export type Era = 'ancient' | 'medieval' | 'gunpowder';
export const ERAS: Era[] = ['ancient', 'medieval', 'gunpowder'];
export const ERA_OF: Record<FactionId, Era> = { romans: 'ancient', egypt: 'ancient', vikings: 'medieval', novgorod: 'medieval', teutonic: 'medieval', mongols: 'medieval', japanese: 'medieval', frontier: 'gunpowder', comanche: 'gunpowder', british: 'gunpowder', french: 'gunpowder', pirates: 'gunpowder', ottomans: 'gunpowder', aztecs: 'medieval', zulus: 'gunpowder' };

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
  /** One line about the army's Champion, under the blurb on the New battle screen. */
  champion?: Record<Lang, string>;
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
    roster: ['lightInfantry', 'heavyInfantry', 'archer', 'lightCavalry', 'heavyCavalry', 'champion'],
    blurb: { en: 'Balanced Rus army: spearmen, archers and druzhina riders.', ru: 'Сбалансированное русское войско: копейщики, лучники и дружина.' },
    champion: { en: 'Champion: the Bogatyr, a legendary giant hero with a flanged mace and a red shield. Takes 3 hits, hits for 2.', ru: 'Чемпион: богатырь, былинный великан с шестопёром и красным щитом. Выдерживает 3 удара, бьёт на 2.' },
    emblem: shield('#a8201a', '#d9a521', '<path d="M30 8V17M26 11H34" stroke="#e8b923" stroke-width="2.2"/><path d="M30 17Q41 25 38 34H22Q19 25 30 17Z" fill="#e8b923"/><path d="M23 34H37V48H23Z" fill="#e8b923"/><path d="M28 39H32V48H28Z" fill="#a8201a"/><path d="M17 48H43V52H17Z" fill="#e8b923"/>'),
    art: { champion: 'bogatyr', king: 'tsar' },
    names: {
      champion: { en: 'Bogatyr', ru: 'Богатырь' },
      king: { en: 'Prince', ru: 'Князь' },
      lightInfantry: { en: 'Militia', ru: 'Ополчение' },
      heavyInfantry: { en: 'Druzhina foot', ru: 'Пешая дружина' },
      heavyCavalry: { en: 'Druzhina', ru: 'Дружина' },
    },
  },
  teutonic: {
    name: { en: 'German Knights', ru: 'Немецкие рыцари' },
    color: '#1b1b1d',
    text: '#e9e4d6',
    roster: ['lightInfantry', 'heavyInfantry', 'archer', 'lightCavalry', 'heavyCavalry', 'champion'],
    blurb: { en: 'Crusader knights: heavy cavalry and disciplined foot.', ru: 'Рыцари-крестоносцы: тяжёлая конница и стойкая пехота.' },
    champion: { en: 'Champion: the Grand Commander in full plate, eagle wings on his great helm and a giant two-handed sword. Takes 3 hits, hits for 2.', ru: 'Чемпион: великий комтур в полных латах, с орлиными крыльями на шлеме и огромным двуручным мечом. Выдерживает 3 удара, бьёт на 2.' },
    emblem: shield('#f4f1e8', '#1b1b1d', '<path d="M24 12H36L33 28H48V40H33L36 58H24L27 40H12V28H27Z" fill="#1b1b1d"/>'),
    art: { champion: 'wingHelm', king: 'cross' },
    names: {
      champion: { en: 'Grand Commander', ru: 'Великий комтур' },
      king: { en: 'Grand Master', ru: 'Великий магистр' },
      lightInfantry: { en: 'Sergeants', ru: 'Сержанты' },
      heavyInfantry: { en: 'Brother sergeants', ru: 'Братья-сержанты' },
      archer: { en: 'Crossbowmen', ru: 'Арбалетчики' },
      lightCavalry: { en: 'Turcopoles', ru: 'Туркополы' },
      heavyCavalry: { en: 'Knight brothers', ru: 'Братья-рыцари' },
    },
  },
  mongols: {
    name: { en: 'Mongols', ru: 'Монголы' },
    color: '#1f5fa8',
    text: '#86b9f0',
    roster: ['lightInfantry', 'archer', 'lightCavalry', 'heavyCavalry', 'horseArcher', 'championRider'],
    blurb: { en: 'Horse archers: shoot and ride. Few foot soldiers, no heavy infantry.', ru: 'Конные лучники: стреляют на скаку. Мало пехоты, нет тяжёлой пехоты.' },
    champion: { en: "Champion: a Keshig, the Khan's own bodyguard, on an armoured horse with a long glaive. Fast, takes 3 hits, hits for 2.", ru: 'Чемпион: кешиктен, личный телохранитель хана, на коне в броне с длинной глефой. Быстрый, выдерживает 3 удара, бьёт на 2.' },
    emblem: shield('#1f5fa8', '#e1b12c', '<path d="M22 14Q46 32 22 50" fill="none" stroke="#e1b12c" stroke-width="3.2" stroke-linecap="round"/><path d="M22 14V50" stroke="#e1b12c" stroke-width="1.5"/><path d="M12 32H44" stroke="#e1b12c" stroke-width="2.2"/><path d="M50 32L43 28V36Z" fill="#e1b12c"/>'),
    art: { king: 'khan' },
    names: {
      championRider: { en: 'Keshig guard', ru: 'Кешиктен' },
      king: { en: 'Khan', ru: 'Хан' },
      lightInfantry: { en: 'Levy spearmen', ru: 'Ополченцы-копейщики' },
      archer: { en: 'Dismounted archers', ru: 'Пешие лучники' },
      heavyCavalry: { en: 'Heavy lancers', ru: 'Тяжёлые копейщики' },
    },
  },
  japanese: {
    name: { en: 'Japan', ru: 'Япония' },
    color: '#5b2a86',
    text: '#c7a6ef',
    roster: ['ashigaru', 'samurai', 'archer', 'crossbow', 'scout', 'lightCavalry', 'heavyCavalry', 'champion'],
    blurb: { en: 'Samurai who hit hard, cheap ashigaru spearmen that stop cavalry, matchlock volleys that hit for 2, and shinobi who slip through the woods.', ru: 'Самураи бьют сильно, дешёвые асигару с копьями останавливают конницу, залпы аркебуз бьют на 2, а синоби крадутся через лес.' },
    champion: { en: "Champion: the Oni-masked hatamoto, the warlord's guard in black-and-red armour with a nodachi. Takes 3 hits, hits for 2.", ru: 'Чемпион: хатамото в маске демона, страж полководца в чёрно-красных доспехах с нодати. Выдерживает 3 удара, бьёт на 2.' },
    emblem: shield('#f4f1e8', '#5b2a86', kabuto('#5b2a86', '#f4f1e8', 'translate(30 37) scale(0.15) translate(-300 -270)')),
    art: { champion: 'oni', king: 'shogun' },
    names: {
      champion: { en: 'Oni hatamoto', ru: 'Хатамото-они' },
      king: { en: 'Shogun', ru: 'Сёгун' },
      archer: { en: 'Yumi archers', ru: 'Лучники юми' },
      lightCavalry: { en: 'Mounted ashigaru', ru: 'Конные асигару' },
      heavyCavalry: { en: 'Mounted samurai', ru: 'Конные самураи' },
      crossbow: { en: 'Teppō ashigaru', ru: 'Тэппо-асигару' },
      scout: { en: 'Shinobi', ru: 'Синоби' },
    },
  },
  frontier: {
    name: { en: 'Cowboys', ru: 'Ковбои' },
    color: '#8a5a2b',
    text: '#e3b781',
    roster: ['deputy', 'gunslinger', 'rifleman', 'longRifle', 'cowboy', 'heavyCavalry', 'championGun'],
    blurb: { en: 'The Old West: riflemen, gunslingers, deputies with shotguns, cowboys who shoot from the saddle, and a buffalo hunter whose Sharps reaches 8 hexes.', ru: 'Дикий Запад: стрелки, помощники шерифа с дробовиками, ковбои, стреляющие на скаку, и охотник на бизонов, чья винтовка Шарпса бьёт на 8 гексов.' },
    champion: { en: 'Champion: the Bounty hunter, two revolvers drawn, shoots 2-4 hexes for 2. Takes 3 hits.', ru: 'Чемпион: охотник за головами с двумя револьверами, стреляет на 2-4 гекса, попадание на 2. Выдерживает 3 удара.' },
    emblem: shield('#8a5a2b', '#e1b12c', '<path d="M30 14L34 25H45L36 32L39 43L30 36L21 43L24 32L15 25H26Z" fill="#e1b12c" stroke="#6b4410" stroke-width="1.2" stroke-linejoin="round"/>'),
    names: {
      championGun: { en: 'Bounty hunter', ru: 'Охотник за головами' },
      king: { en: 'Sheriff', ru: 'Шериф' },
      heavyCavalry: { en: 'Cavalry troopers', ru: 'Кавалеристы' },
      longRifle: { en: 'Buffalo hunter', ru: 'Охотник на бизонов' },
    },
    art: { king: 'star', deputy: 'shotgun', heavyCavalry: 'saber' },
  },
  comanche: {
    name: { en: 'Comanche', ru: 'Команчи' },
    color: '#1f8a8a',
    text: '#7fd6d0',
    roster: ['lightInfantry', 'archer', 'lightCavalry', 'horseArcher', 'championRider'],
    blurb: { en: 'Plains warriors, the finest riders of the West: fast mounted warriors and archers, no heavy troops.', ru: 'Воины равнин, лучшие всадники Запада: быстрые конные воины и лучники, без тяжёлых войск.' },
    champion: { en: 'Champion: a Comanche war leader on a painted war horse, with lance and shield. Fast, takes 3 hits, hits for 2.', ru: 'Чемпион: военный вождь команчей на расписном боевом коне, с копьём и щитом. Быстрый, выдерживает 3 удара, бьёт на 2.' },
    emblem: shield('#1f8a8a', '#e9e4d6', '<g transform="rotate(-48 30 48)"><path d="M30 48Q24.5 31 30 12Q35.5 31 30 48Z" fill="#f4f1e8"/><path d="M30 12Q27.8 16.5 30 21Q32.2 16.5 30 12Z" fill="#1b1b1d"/></g><g transform="rotate(-24 30 48)"><path d="M30 48Q24.5 31 30 12Q35.5 31 30 48Z" fill="#f4f1e8"/><path d="M30 12Q27.8 16.5 30 21Q32.2 16.5 30 12Z" fill="#1b1b1d"/></g><g transform="rotate(0 30 48)"><path d="M30 48Q24.5 31 30 12Q35.5 31 30 48Z" fill="#f4f1e8"/><path d="M30 12Q27.8 16.5 30 21Q32.2 16.5 30 12Z" fill="#1b1b1d"/></g><g transform="rotate(24 30 48)"><path d="M30 48Q24.5 31 30 12Q35.5 31 30 48Z" fill="#f4f1e8"/><path d="M30 12Q27.8 16.5 30 21Q32.2 16.5 30 12Z" fill="#1b1b1d"/></g><g transform="rotate(48 30 48)"><path d="M30 48Q24.5 31 30 12Q35.5 31 30 48Z" fill="#f4f1e8"/><path d="M30 12Q27.8 16.5 30 21Q32.2 16.5 30 12Z" fill="#1b1b1d"/></g><path d="M17 44H43V50H17Z" fill="#e1b12c"/><path d="M21 47H23M27 47H29M31 47H33M37 47H39" stroke="#a8201a" stroke-width="2"/>'),
    names: {
      championRider: { en: 'War leader', ru: 'Военный вождь' },
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
    roster: ['lightInfantry', 'heavyInfantry', 'shieldbearer', 'berserker', 'axeThrower', 'archer', 'champion'],
    blurb: { en: 'Raiders on foot: berserkers who hit twice as hard but fall to one blow, axes thrown from close range, and shieldmaidens that arrows bounce off. No horses.', ru: 'Пешие налётчики: берсерки бьют вдвое сильнее, но падают от одного удара; топоры летят с близкого расстояния, а от щитов дев щита отскакивают стрелы. Конницы нет.' },
    champion: { en: 'Champion: the Úlfheðinn, a wolf-skin warrior with a huge Dane axe. Takes 3 hits, hits for 2.', ru: 'Чемпион: ульфхеднар, воин в волчьей шкуре с огромной датской секирой. Выдерживает 3 удара, бьёт на 2.' },
    emblem: shield('#2f5f8f', '#e9e4d6', '<circle cx="30" cy="32" r="17" fill="none" stroke="#e9e4d6" stroke-width="3"/><path d="M30 15V49M13 32H47" stroke="#e9e4d6" stroke-width="3"/><circle cx="30" cy="32" r="4.5" fill="#d9a521"/>'),
    names: {
      champion: { en: 'Úlfheðinn', ru: 'Ульфхеднар' },
      king: { en: 'Jarl', ru: 'Ярл' },
      lightInfantry: { en: 'Raiders', ru: 'Налётчики' },
      heavyInfantry: { en: 'Huscarls', ru: 'Хускарлы' },
      shieldbearer: { en: 'Shieldmaidens', ru: 'Девы щита' },
    },
    art: { champion: 'wolf' },
  },
  romans: {
    name: { en: 'Romans', ru: 'Римляне' },
    color: '#7e1830',
    text: '#ef8aa0',
    roster: ['lightInfantry', 'heavyInfantry', 'banner', 'archer', 'heavyCavalry', 'ballista', 'champion'],
    blurb: { en: 'The legion: solid heavy infantry around the eagle, a few riders, and a ballista that hits hard from far away but crawls.', ru: 'Легион: крепкая тяжёлая пехота вокруг орла, немного конницы и баллиста, которая бьёт издалека, но еле ползёт.' },
    champion: { en: 'Champion: the Centurion, the legion\'s first spear, in medals and a white transverse crest, with gladius and scutum. Takes 3 hits, hits for 2.', ru: 'Чемпион: центурион, первое копьё легиона, в наградах и с белым поперечным гребнем, с гладием и скутумом. Выдерживает 3 удара, бьёт на 2.' },
    emblem: shield('#8e1b2e', '#e8b923', '<path d="M30 14L33 26H46L35.5 33.5L39.5 46L30 38.5L20.5 46L24.5 33.5L14 26H27Z" fill="#e8b923"/>'),
    names: {
      king: { en: 'Legate', ru: 'Легат' },
      lightInfantry: { en: 'Auxiliaries', ru: 'Ауксиларии' },
      heavyInfantry: { en: 'Legionaries', ru: 'Легионеры' },
      heavyCavalry: { en: 'Equites', ru: 'Всадники' },
      champion: { en: 'Centurion', ru: 'Центурион' },
      banner: { en: 'Aquilifer', ru: 'Аквилифер' },
    },
  },
  british: {
    name: { en: 'British', ru: 'Британцы' },
    color: '#2f5d3a',
    text: '#8fd19e',
    roster: ['skirmisher', 'lineInfantry', 'lightCavalry', 'heavyCavalry', 'cannon'],
    blurb: { en: 'Napoleonic redcoats: a firing line that shoots and stands, riflemen who pick off targets from far, and cannon.', ru: 'Красные мундиры наполеоновских войн: стойкая стреляющая линия, стрелки, бьющие издалека, и пушки.' },
    emblem: shield('#f4f1e8', '#2f5d3a', '<path d="M26 6H34V28H54V36H34V64H26V36H6V28H26Z" fill="#c8202c"/>'),
    names: {
      king: { en: 'Duke', ru: 'Герцог' },
      lineInfantry: { en: 'Redcoats', ru: 'Красные мундиры' },
      skirmisher: { en: 'Riflemen', ru: 'Стрелки' },
      heavyCavalry: { en: 'Scots Greys', ru: 'Шотландские серые' },
      lightCavalry: { en: 'Hussars', ru: 'Гусары' },
      cannon: { en: 'Cannon', ru: 'Пушка' },
    },
  },
  french: {
    name: { en: 'French', ru: 'Французы' },
    color: '#27408b',
    text: '#9fb4ef',
    roster: ['skirmisher', 'lineInfantry', 'lightCavalry', 'heavyCavalry', 'cannon', 'champion'],
    blurb: { en: "Napoleon's Grande Armée: grenadier volleys, voltigeurs out front, cuirassiers and lancers to break the line, and cannon.", ru: 'Великая армия Наполеона: залпы гренадеров, вольтижёры впереди, кирасиры и уланы ломают строй, и пушки.' },
    champion: { en: 'Champion: a grizzled grenadier of the Old Guard, "the Guard dies, it does not surrender". Takes 3 hits, hits for 2.', ru: 'Чемпион: седой гренадер Старой гвардии: «Гвардия умирает, но не сдаётся». Выдерживает 3 удара, бьёт на 2.' },
    emblem: shield('#27408b', '#e8b923', '<path d="M22 14L26 18L30 12L34 18L38 14L37 21H23Z" fill="#e8b923"/><path d="M22 52V25H26.5L34 42.5V25H38V52H33.5L26 34.5V52Z" fill="#e8b923"/>'),
    names: {
      king: { en: 'Emperor', ru: 'Император' },
      lineInfantry: { en: 'Grenadiers', ru: 'Гренадеры' },
      champion: { en: 'Old Guard', ru: 'Старая гвардия' },
      skirmisher: { en: 'Voltigeurs', ru: 'Вольтижёры' },
      heavyCavalry: { en: 'Cuirassiers', ru: 'Кирасиры' },
      lightCavalry: { en: 'Lancers', ru: 'Уланы' },
      cannon: { en: 'Cannon', ru: 'Пушка' },
    },
  },
  egypt: {
    name: { en: 'Egypt', ru: 'Египет' },
    color: '#b8901f',
    text: '#f0d27a',
    roster: ['lightInfantry', 'heavyInfantry', 'jaguar', 'archer', 'chariot', 'champion'],
    blurb: { en: "Pharaoh's army: spearmen and archers on foot, the royal guard, the Braves of the King with their battle-axes, and war chariots that ride fast and shoot on the move.", ru: 'Войско фараона: копейщики и лучники, царская стража, храбрецы царя с боевыми топорами и боевые колесницы, которые быстро мчатся и стреляют на ходу.' },
    champion: { en: 'Champion: the Khopesh champion, a giant in gold-trimmed scale and a gold-banded wig, with the sickle sword. Takes 3 hits, hits for 2.', ru: 'Чемпион: воин с хопешем, великан в чешуйчатом доспехе с золотом и в парике с золотым обручем, с серповидным мечом. Выдерживает 3 удара, бьёт на 2.' },
    emblem: shield('#1f3f8f', '#d9a521', '<path d="M12 28Q30 14 48 28Q30 40 12 28Z" fill="none" stroke="#e8b923" stroke-width="3" stroke-linejoin="round"/><circle cx="30" cy="27.5" r="5" fill="#e8b923"/><path d="M12 22Q30 10 48 20" fill="none" stroke="#e8b923" stroke-width="3" stroke-linecap="round"/><path d="M27 37L24 52M24 52Q28 56 31 51" fill="none" stroke="#e8b923" stroke-width="2.6" stroke-linecap="round"/><path d="M35 36Q42 44 44 54" fill="none" stroke="#e8b923" stroke-width="2.6" stroke-linecap="round"/>'),
    names: {
      king: { en: 'Pharaoh', ru: 'Фараон' },
      lightInfantry: { en: 'Spearmen', ru: 'Копейщики' },
      heavyInfantry: { en: 'Royal guard', ru: 'Царская стража' },
      jaguar: { en: 'Braves of the King', ru: 'Храбрецы царя' },
      champion: { en: 'Khopesh champion', ru: 'Воин с хопешем' },
      chariot: { en: 'War chariots', ru: 'Боевые колесницы' },
    },
    art: { king: 'pharaoh' },
  },
  pirates: {
    name: { en: 'Pirates', ru: 'Пираты' },
    color: '#0f4d52',
    text: '#7cc9bd',
    roster: ['boarder', 'skirmisher', 'rifleman', 'bomber', 'cannon', 'championGun'],
    blurb: { en: 'Buccaneers: cutlass boarders who hit hard but fall to one blow, musketeers, long-gun hunters, grenadiers whose bombs hit for 2, and a deck cannon.', ru: 'Флибустьеры: абордажники с саблями бьют сильно, но падают от одного удара; мушкетёры, охотники с длинными ружьями, гренадёры, чьи бомбы бьют на 2, и палубная пушка.' },
    champion: { en: 'Champion: Anne Bonny, two pistols drawn, shoots 2-4 hexes for 2. Takes 3 hits.', ru: 'Чемпион: Энн Бонни с двумя пистолетами, стреляет на 2-4 гекса, попадание на 2. Выдерживает 3 удара.' },
    emblem: shield('#1b1b1d', '#e9e4d6', '<path d="M14 54L44 20M46 54L16 20" stroke="#e9e4d6" stroke-width="3" stroke-linecap="round"/><path d="M11 50L18 57M49 50L42 57" stroke="#e9e4d6" stroke-width="3" stroke-linecap="round"/><path d="M30 13Q41 13 41 25Q41 31 37 33V38H23V33Q19 31 19 25Q19 13 30 13Z" fill="#e9e4d6"/><circle cx="25.5" cy="25" r="3.2" fill="#1b1b1d"/><circle cx="34.5" cy="25" r="3.2" fill="#1b1b1d"/><path d="M30 29L28 32H32Z" fill="#1b1b1d"/><path d="M27 35V38M30 35V38M33 35V38" stroke="#1b1b1d" stroke-width="1.2"/>'),
    names: {
      king: { en: 'Captain', ru: 'Капитан' },
      boarder: { en: 'Boarders', ru: 'Абордажники' },
      skirmisher: { en: 'Musketeers', ru: 'Мушкетёры' },
      bomber: { en: 'Grenadiers', ru: 'Гренадёры' },
      rifleman: { en: 'Buccaneers', ru: 'Буканьеры' },
      championGun: { en: 'Anne Bonny', ru: 'Энн Бонни' },
      cannon: { en: 'Deck cannon', ru: 'Палубная пушка' },
    },
    art: { king: 'tricorn' },
  },
  ottomans: {
    name: { en: 'Ottomans', ru: 'Османы' },
    color: '#c0143c',
    text: '#ffd36b',
    roster: ['lightInfantry', 'skirmisher', 'lightCavalry', 'wildRider', 'heavyCavalry', 'cannon'],
    blurb: { en: "The Sultan's army: azap spearmen, Janissary musketeers, akinji raiders, winged Deli madmen, armoured sipahi lancers and a great bronze bombard.", ru: 'Войско султана: азапы с копьями, янычары с мушкетами, лёгкие акынджи, крылатые дели, латные сипахи с копьями и огромная бронзовая бомбарда.' },
    emblem: shield('#c0143c', '#e8b923', '<circle cx="27" cy="33" r="14" fill="#e8b923"/><circle cx="31.5" cy="33" r="11.5" fill="#c0143c"/><path d="M35.5 33.0L39.1 31.6L39.3 27.8L41.7 30.8L45.4 29.8L43.3 33.0L45.4 36.2L41.7 35.2L39.3 38.2L39.1 34.4Z" fill="#e8b923"/>'),
    names: {
      king: { en: 'Sultan', ru: 'Султан' },
      lightInfantry: { en: 'Azaps', ru: 'Азапы' },
      skirmisher: { en: 'Janissaries', ru: 'Янычары' },
      lightCavalry: { en: 'Akinji riders', ru: 'Акынджи' },
      heavyCavalry: { en: 'Sipahis', ru: 'Сипахи' },
      wildRider: { en: 'Delis', ru: 'Дели' },
      cannon: { en: 'Bombard', ru: 'Бомбарда' },
    },
    art: { king: 'turban' },
  },
  aztecs: {
    name: { en: 'Aztecs', ru: 'Ацтеки' },
    color: '#12a4b8',
    text: '#86e4f0',
    roster: ['lightInfantry', 'heavyInfantry', 'jaguar', 'atlatl', 'archer'],
    blurb: { en: 'Warriors of Tenochtitlan: eagle and jaguar warriors with obsidian clubs, spearmen, archers and atlatl darts. No horses.', ru: 'Воины Теночтитлана: воины-орлы и воины-ягуары с обсидиановыми мечами, копейщики, лучники и метатели дротиков. Коней нет.' },
    emblem: shield('#12a4b8', '#c8202c', '<path d="M40.8 30.7L47.0 33.0L40.8 35.3ZM39.2 39.0L42.0 45.0L36.0 42.2ZM32.3 43.8L30.0 50.0L27.7 43.8ZM24.0 42.2L18.0 45.0L20.8 39.0ZM19.2 35.3L13.0 33.0L19.2 30.7ZM20.8 27.0L18.0 21.0L24.0 23.8ZM27.7 22.2L30.0 16.0L32.3 22.2ZM36.0 23.8L42.0 21.0L39.2 27.0Z" fill="#e8b923"/><circle cx="30" cy="33" r="10" fill="#e8b923" stroke="#c8202c" stroke-width="1.6"/><circle cx="30" cy="33" r="5" fill="none" stroke="#c8202c" stroke-width="1.6"/><circle cx="30" cy="33" r="1.8" fill="#c8202c"/>'),
    names: {
      king: { en: 'Tlatoani', ru: 'Тлатоани' },
      lightInfantry: { en: 'Warriors', ru: 'Воины' },
      heavyInfantry: { en: 'Eagle warriors', ru: 'Воины-орлы' },
      jaguar: { en: 'Jaguar warriors', ru: 'Воины-ягуары' },
      atlatl: { en: 'Atlatl throwers', ru: 'Метатели дротиков' },
    },
    art: { king: 'quetzal' },
  },
  zulus: {
    name: { en: 'Zulus', ru: 'Зулусы' },
    color: '#5a3a24',
    text: '#f1e4cc',
    roster: ['lightInfantry', 'impi', 'heavyInfantry', 'thrower', 'scout', 'champion'],
    blurb: { en: 'The impi on foot: stabbing spears that hit hard and stop riders, ringed veterans, young warriors, spear throwers and scouts who slip through the woods. No horses, no guns.', ru: 'Пешие импи: короткие копья бьют сильно и останавливают конницу; ветераны с кольцом, молодые воины, метатели копий и разведчики, которые крадутся через лес. Ни коней, ни ружей.' },
    champion: { en: 'Champion: the Induna, a regiment commander with a great red-brown war shield and the iklwa. Takes 3 hits, hits for 2.', ru: 'Чемпион: индуна, командир полка, с огромным красно-бурым щитом и иклвой. Выдерживает 3 удара, бьёт на 2.' },
    emblem: shield('#5a3a24', '#f1e4cc', '<path d="M15 54L45 14M45 54L15 14" stroke="#e9e4d6" stroke-width="2.4" stroke-linecap="round"/><path d="M45 14Q42 21 38 23Q41 18 45 14ZM15 14Q18 21 22 23Q19 18 15 14Z" fill="#e9e4d6" stroke="#e9e4d6" stroke-width="2.5" stroke-linejoin="round"/><ellipse cx="30" cy="35" rx="9" ry="17" fill="#f4f1e8" stroke="#1b1b1d" stroke-width="1.4"/><path d="M30 18V52" stroke="#5a3a24" stroke-width="2"/><path d="M24 26Q27 24 28 29Q25 31 24 26ZM32 39Q36 37 37 42Q33 45 32 39Z" fill="#5a3a24"/>'),
    names: {
      king: { en: 'Inkosi', ru: 'Инкоси' },
      lightInfantry: { en: 'Young warriors', ru: 'Молодые воины' },
      heavyInfantry: { en: 'Ringed veterans', ru: 'Ветераны с кольцом' },
      impi: { en: 'Iklwa warriors', ru: 'Воины с иклвой' },
      scout: { en: 'Izinhloli scouts', ru: 'Разведчики-изинхлоли' },
      champion: { en: 'Induna', ru: 'Индуна' },
      thrower: { en: 'Spear throwers', ru: 'Метатели копий' },
    },
    art: { king: 'inkosi' },
  },
};

/** Each army's doctrine for the Auto army (the computer's and the "Auto" button's): the share of the budget it
 *  spends on each piece, after its real way of fighting. Same budget for everyone; suggestArmy still opens with a
 *  shooter and a spearman where the roster has them, so no auto army is all one kind of piece. */
export const DOCTRINE: Record<FactionId, ArmyMix> = {
  // The legion: a heavy-infantry core round the eagle, auxiliaries and archers on the flanks, a few horse, one engine.
  romans: { heavyInfantry: 0.4, lightInfantry: 0.15, banner: 0.08, archer: 0.15, heavyCavalry: 0.12, ballista: 0.1, champion: 0.12 },
  // Pharaoh's host: chariots and archers win, spearmen and guards hold.
  egypt: { chariot: 0.25, archer: 0.25, lightInfantry: 0.2, heavyInfantry: 0.15, jaguar: 0.15, champion: 0.1 },
  // A foot army: the shield wall with berserkers behind it, a few axes and bows.
  vikings: { heavyInfantry: 0.25, shieldbearer: 0.15, lightInfantry: 0.2, berserker: 0.2, axeThrower: 0.1, archer: 0.1, champion: 0.12 },
  // Rus: the druzhina riders with a militia and archer screen.
  novgorod: { heavyCavalry: 0.25, heavyInfantry: 0.2, lightInfantry: 0.2, archer: 0.2, lightCavalry: 0.1, champion: 0.1 },
  // The Order: the knights' charge is everything, crossbows and sergeants support it.
  teutonic: { heavyCavalry: 0.35, heavyInfantry: 0.2, archer: 0.2, lightInfantry: 0.1, lightCavalry: 0.1, champion: 0.1 },
  // Nearly all riders: horse archers first, lancers to finish, almost no foot.
  mongols: { horseArcher: 0.45, heavyCavalry: 0.25, lightCavalry: 0.2, archer: 0.08, lightInfantry: 0.05, championRider: 0.12 },
  // Ashigaru masses with samurai as the elite, matchlocks and bows, few horse.
  japanese: { ashigaru: 0.3, samurai: 0.25, crossbow: 0.12, archer: 0.12, heavyCavalry: 0.1, lightCavalry: 0.06, scout: 0.05, champion: 0.1 },
  // Massed warriors, eagle and jaguar elites, darts and arrows.
  aztecs: { lightInfantry: 0.3, heavyInfantry: 0.2, jaguar: 0.2, atlatl: 0.15, archer: 0.15 },
  // Janissary firepower, azaps, akinji and sipahi horse, the great gun.
  ottomans: { skirmisher: 0.3, heavyCavalry: 0.2, lightInfantry: 0.15, lightCavalry: 0.15, wildRider: 0.1, cannon: 0.1 },
  // Guns everywhere, cowboys in the saddle, a few troopers.
  frontier: { gunslinger: 0.2, rifleman: 0.2, cowboy: 0.2, deputy: 0.15, heavyCavalry: 0.12, longRifle: 0.08, championGun: 0.1 },
  // Riders above all: horse archers and mounted warriors, few on foot.
  comanche: { horseArcher: 0.4, lightCavalry: 0.3, lightInfantry: 0.1, archer: 0.1, championRider: 0.12 },
  // The thin red line: line infantry core, riflemen out front, cavalry and guns.
  british: { lineInfantry: 0.45, skirmisher: 0.15, heavyCavalry: 0.15, lightCavalry: 0.1, cannon: 0.12 },
  // The column: line infantry, voltigeurs, cuirassiers and lancers, the guns and the Guard.
  french: { lineInfantry: 0.4, skirmisher: 0.15, heavyCavalry: 0.15, lightCavalry: 0.12, cannon: 0.1, champion: 0.1 },
  // Boarding parties with musket cover, grenades and a deck gun.
  pirates: { boarder: 0.35, skirmisher: 0.2, bomber: 0.15, rifleman: 0.1, cannon: 0.1, championGun: 0.1 },
  // The impi: masses of stabbing spears, veterans and young warriors, throwers, a few scouts.
  zulus: { impi: 0.35, lightInfantry: 0.25, heavyInfantry: 0.15, thrower: 0.15, scout: 0.05, champion: 0.1 },
};
for (const id of Object.keys(FACTIONS) as FactionId[]) registerArmyMix(FACTIONS[id].roster, DOCTRINE[id]);

export const FACTION_ORDER: FactionId[] = ['romans', 'egypt', 'vikings', 'novgorod', 'teutonic', 'mongols', 'japanese', 'aztecs', 'ottomans', 'frontier', 'comanche', 'british', 'french', 'pirates', 'zulus'];

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
