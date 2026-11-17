// The campaign: eight historical battles (and two clearly labelled "what ifs"), played in order against the computer.
// Each one has a fixed map, fixed armies already standing where they stood, and sometimes a turn limit.
// The player always leads Red (moves first, left side); the computer leads Blue.
// Progress lives in localStorage 'boc-campaign': the stars won per scenario. The normal saved game is only
// replaced when a scenario is actually started (it then becomes the current game like any battle).

import { CONFIG, type GameConfig, type Placement } from '../config';
import { armyValue, makeUnit, newGame, type GameState, type Player } from '../engine';
import { FACTIONS, type FactionId } from './factions';
import type { Lang } from './i18n';
import { boardFor, RECOMMENDED, type MapId, type Settings } from './settings';

export interface Scenario {
  id: string;
  /** Negative = BC. */
  year: number;
  /** A made-up match-up of real armies, labelled as such. */
  whatIf?: boolean;
  title: Record<Lang, string>;
  story: Record<Lang, string>;
  map: MapId;
  /** Red is the player, Blue the computer. */
  sides: Record<Player, FactionId>;
  units: Record<Player, Placement[]>;
  /** Turn limit: this side wins once it has lasted this many full turns. */
  hold?: { side: Player; turns: number };
}

/** Shorthand: one kind of piece on several hexes. */
const at = (type: Placement[0], ...hexes: [number, number][]): Placement[] => hexes.map(([c, r]) => [type, c, r]);

export const SCENARIOS: Scenario[] = [
  {
    id: 'ice-1242',
    year: 1242,
    title: { en: 'Battle on the Ice', ru: 'Ледовое побоище' },
    story: {
      en: 'April 1242. The German knights ride east to take Novgorod, and Prince Alexander Nevsky waits for them on the shore of frozen Lake Peipus. The spring ice in the middle is too thin to hold a horse, so the fight goes round it. Break the charge of the knights.',
      ru: 'Апрель 1242 года. Немецкие рыцари идут на Новгород, а князь Александр Невский ждёт их на берегу замёрзшего Чудского озера. Весенний лёд посередине не выдержит коня, поэтому бой идёт в обход. Сломите натиск рыцарей.',
    },
    map: 'lake',
    sides: { red: 'novgorod', blue: 'teutonic' },
    units: {
      red: [
        ['king', 1, 7], ['champion', 3, 7],
        ...at('heavyInfantry', [4, 5], [4, 6], [4, 8], [4, 9]),
        ...at('lightInfantry', [5, 4], [5, 5], [5, 6], [5, 8], [5, 9], [5, 10]),
        ...at('archer', [3, 5], [3, 9]),
        ['lightInfantry', 2, 6],
        ...at('lightCavalry', [3, 1], [3, 13]),
        ...at('heavyCavalry', [2, 2], [2, 12]),
      ],
      blue: [
        ['king', 23, 7], ['champion', 19, 7],
        // The "boar's head": a wedge of armoured riders.
        ...at('heavyCavalry', [18, 6], [18, 8], [19, 5], [19, 9], [20, 4], [20, 10]),
        ...at('heavyInfantry', [21, 6], [21, 7], [21, 8], [22, 7]),
        ...at('archer', [22, 5], [22, 9]),
        ...at('lightInfantry', [20, 7], [21, 5], [21, 9]),
      ],
    },
  },
  {
    id: 'hakata-1274',
    year: 1274,
    title: { en: 'Hakata Bay', ru: 'Бухта Хаката' },
    story: {
      en: 'October 1274. A Mongol fleet lands at Hakata Bay with archers, riders and exploding bombs, and the samurai of Kyushu come down to the beach to meet them. Legend says a storm wrecked the fleet that night, but first the day must be won. Drive the invaders back to their ships.',
      ru: 'Октябрь 1274 года. Монгольский флот высаживается в бухте Хаката: лучники, всадники, взрывающиеся бомбы. Самураи острова Кюсю выходят встретить их на берегу. Говорят, в ту ночь флот разбила буря, но сначала надо выстоять днём. Отбросьте захватчиков к их кораблям.',
    },
    map: 'open',
    sides: { red: 'japanese', blue: 'mongols' },
    units: {
      red: [
        ['king', 1, 7], ['champion', 4, 7],
        ...at('samurai', [5, 5], [5, 6], [5, 7], [5, 8], [5, 9]),
        ...at('ashigaru', [4, 5], [4, 6], [4, 8], [4, 9], [5, 4], [5, 10]),
        ...at('archer', [3, 6], [3, 8], [2, 7], [3, 4]),
        ...at('heavyCavalry', [3, 2], [3, 12]),
      ],
      blue: [
        ['king', 23, 7], ['championRider', 22, 7],
        ...at('lightInfantry', [19, 5], [19, 6], [19, 7], [19, 8], [19, 9], [18, 7]),
        ['archer', 20, 7],
        ['lightCavalry', 21, 2],
        ...at('heavyCavalry', [20, 3], [20, 11]),
        ...at('lightCavalry', [22, 2], [22, 12]),
      ],
    },
  },
  {
    id: 'constantinople-1453',
    year: 1453,
    title: { en: 'Fall of Constantinople', ru: 'Падение Константинополя' },
    story: {
      en: 'May 1453. Sultan Mehmed II has dragged giant cannons up to the walls of Constantinople, the last city of the Roman Empire. The defenders are few, but they pray for help to come by sea.',
      ru: 'Май 1453 года. Султан Мехмед II подтащил огромные пушки к стенам Константинополя, последнего города Римской империи. Защитников мало, но они молятся, чтобы помощь пришла с моря.',
    },
    map: 'siege',
    sides: { red: 'ottomans', blue: 'romans' },
    hold: { side: 'blue', turns: 8 },
    units: {
      red: [
        ['king', 2, 7],
        ...at('cannon', [10, 5], [10, 9], [11, 7]),
        ...at('skirmisher', [12, 4], [12, 6], [12, 8], [12, 10], [13, 7]),
        ...at('lightInfantry', [14, 4], [14, 5], [14, 6], [14, 7], [14, 8], [14, 9], [13, 3], [13, 11]),
        ...at('heavyCavalry', [9, 3], [9, 11]),
        ...at('lightCavalry', [15, 1], [15, 13]),
      ],
      blue: [
        ['king', 23, 7],
        // Heavy foot holds both gateways.
        ...at('heavyInfantry', [19, 5], [19, 9], [20, 6], [20, 8], [21, 6], [21, 8]),
        ...at('archer', [21, 5], [21, 9], [22, 6], [22, 8]),
        ...at('ballista', [22, 4], [22, 10]),
        ...at('lightInfantry', [20, 4], [20, 10], [20, 7], [21, 7]),
        ['heavyCavalry', 23, 5],
      ],
    },
  },
  {
    id: 'waterloo-1815',
    year: 1815,
    title: { en: 'Waterloo', ru: 'Ватерлоо' },
    story: {
      en: '18 June 1815. Napoleon is back, and Wellington\'s army stands on the ridge of Mont-Saint-Jean, with farmhouses out in front held like forts. The French have more men and more guns, but the Prussians are marching to help.',
      ru: '18 июня 1815 года. Наполеон вернулся, а армия Веллингтона стоит на гребне Мон-Сен-Жан, и фермы перед ней держатся как крепости. У французов больше солдат и пушек, но на помощь уже идут пруссаки.',
    },
    map: 'waterloo',
    sides: { red: 'british', blue: 'french' },
    hold: { side: 'red', turns: 6 },
    units: {
      red: [
        ['king', 2, 7],
        ...at('lineInfantry', [6, 4], [6, 5], [6, 6], [6, 8], [6, 9], [6, 10]),
        ...at('skirmisher', [8, 7], [8, 10], [7, 2]),
        ...at('cannon', [5, 5], [5, 9]),
        ...at('heavyCavalry', [3, 4], [3, 10]),
        ['lightCavalry', 4, 12],
      ],
      blue: [
        ['king', 22, 7],
        ...at('lineInfantry', [17, 4], [17, 5], [17, 6], [17, 7], [17, 8], [17, 9], [17, 10]),
        ...at('skirmisher', [15, 5], [15, 7], [15, 9]),
        ...at('cannon', [19, 5], [19, 7], [19, 9]),
        ...at('heavyCavalry', [20, 3], [20, 11], [21, 6]),
        ...at('lightCavalry', [18, 1], [18, 13]),
      ],
    },
  },
  {
    id: 'adobe-walls-1874',
    year: 1874,
    title: { en: 'Adobe Walls', ru: 'Эдоби-Уоллс' },
    story: {
      en: 'June 1874. Buffalo hunters are killing off the herds the Comanche live on, and Quanah Parker leads a dawn raid on their trading post at Adobe Walls. The hunters shoot from among the buildings with long-range rifles. In history the rifles won: ride fast and get in close.',
      ru: 'Июнь 1874 года. Охотники истребляют стада бизонов, которыми живут команчи, и Куана Паркер ведёт рассветный набег на их факторию Эдоби-Уоллс. Охотники стреляют из-за домов из дальнобойных винтовок. В истории победили винтовки: скачите быстро и сходитесь вплотную.',
    },
    map: 'village',
    sides: { red: 'comanche', blue: 'frontier' },
    units: {
      red: [
        ['king', 1, 7], ['championRider', 4, 7],
        ...at('lightCavalry', [4, 3], [4, 11], [3, 2], [3, 12], [5, 5], [5, 9]),
        ...at('horseArcher', [3, 5], [3, 9], [4, 5], [4, 9], [3, 7]),
        ...at('lightInfantry', [5, 4], [5, 6], [5, 7], [5, 8]),
        ...at('archer', [2, 6], [2, 8]),
      ],
      blue: [
        ['king', 13, 7], ['championGun', 14, 7],
        ...at('rifleman', [12, 5], [12, 9], [11, 7], [13, 5], [13, 10]),
        ...at('gunslinger', [12, 6], [12, 8]),
        ...at('deputy', [14, 8], [15, 7]),
        ['cowboy', 16, 7],
      ],
    },
  },
  {
    id: 'isandlwana-1879',
    year: 1879,
    title: { en: 'Isandlwana', ru: 'Исандлвана' },
    story: {
      en: '22 January 1879. A British army has marched into Zululand and camped below the rocky hill of Isandlwana, with its rifle line spread thin. King Cetshwayo\'s regiments attack as the "horns of the buffalo": the chest strikes the front while the horns sweep round both sides. Close in fast, because the rifles kill from afar.',
      ru: '22 января 1879 года. Британская армия вошла в Зулуленд и встала лагерем под скалистым холмом Исандлвана, растянув стрелковую цепь. Полки короля Кечвайо атакуют «рогами буйвола»: грудь бьёт в лоб, а рога охватывают с обеих сторон. Сближайтесь быстро: издалека винтовки убивают.',
    },
    map: 'isandlwana',
    sides: { red: 'zulus', blue: 'british' },
    units: {
      red: [
        ['king', 1, 7],
        // The chest, the two horns and the loins (veterans held back).
        ...at('impi', [15, 4], [15, 6], [15, 8], [15, 10], [12, 5], [12, 7], [12, 9], [14, 1], [14, 13], [15, 0], [15, 14]),
        ...at('lightInfantry', [13, 2], [13, 12], [12, 1], [12, 13], [11, 3], [11, 11]),
        ...at('heavyInfantry', [11, 6], [11, 7], [11, 8], [10, 7]),
        ...at('thrower', [12, 3], [12, 11], [11, 5], [11, 9]),
      ],
      blue: [
        ['king', 22, 7],
        ...at('lineInfantry', [17, 3], [17, 5], [17, 7], [17, 9], [17, 11]),
        ...at('skirmisher', [18, 1], [18, 13]),
        ...at('lightCavalry', [19, 2], [19, 12]),
      ],
    },
  },
  {
    id: 'vikings-romans',
    year: 400,
    whatIf: true,
    title: { en: 'Northmen at the Wall', ru: 'Северяне у Вала' },
    story: {
      en: 'What if longships had reached Roman Britain four hundred years early? The Vikings land, and a legion marches out through the forest to meet them. Shield wall against shield wall, axe against short sword: find a gap in the woods and break the legion.',
      ru: 'Что если бы драккары доплыли до римской Британии на четыреста лет раньше? Викинги высаживаются, и легион выходит им навстречу через лес. Стена щитов против стены щитов, топор против короткого меча: найдите проход в лесу и разбейте легион.',
    },
    map: 'longwood',
    sides: { red: 'vikings', blue: 'romans' },
    units: {
      red: [
        ['king', 2, 7], ['champion', 9, 7],
        ...at('berserker', [10, 4], [10, 6], [10, 8], [10, 10]),
        ...at('heavyInfantry', [9, 5], [9, 6], [9, 8]),
        ...at('axeThrower', [8, 5], [8, 7], [8, 9]),
        ...at('lightInfantry', [10, 2], [10, 12], [9, 2], [9, 12]),
        ...at('archer', [7, 6], [7, 8]),
      ],
      blue: [
        ['king', 23, 7],
        ...at('heavyInfantry', [19, 5], [19, 6], [19, 8], [19, 9]),
        ...at('heavyInfantry', [20, 6], [20, 8], [20, 7]),
        ...at('heavyCavalry', [20, 2], [20, 12]),
        ...at('lightInfantry', [18, 5], [18, 9], [19, 7], [18, 7]),
      ],
    },
  },
  {
    id: 'pirates-egypt',
    year: -1175,
    whatIf: true,
    title: { en: 'Raiders of the Nile', ru: 'Налёт на Нил' },
    story: {
      en: 'Around 1175 BC raiders called the Sea Peoples really did attack Egypt through the Nile delta, and Pharaoh Ramesses III beat them back. What if the raiders had been Caribbean pirates with cannons and powder kegs? Cross the river and take the Pharaoh\'s camp.',
      ru: 'Около 1175 года до н. э. налётчики, «народы моря», и правда напали на Египет через дельту Нила, и фараон Рамсес III отбил их. А что если бы налётчиками были карибские пираты с пушками и пороховыми бочонками? Переправьтесь через реку и захватите лагерь фараона.',
    },
    map: 'fords',
    sides: { red: 'pirates', blue: 'egypt' },
    units: {
      red: [
        ['king', 1, 7],
        ...at('boarder', [9, 6], [9, 7], [9, 8], [10, 1], [10, 13], [9, 12]),
        ...at('bomber', [7, 6], [7, 8], [9, 1]),
        ...at('skirmisher', [6, 5], [6, 9], [8, 13]),
        ...at('cannon', [4, 5], [4, 9]),
      ],
      blue: [
        ['king', 22, 7],
        ...at('chariot', [19, 3], [19, 11]),
        ['archer', 15, 7],
        ...at('lightInfantry', [16, 12], [16, 2]),
        // Spearmen hold the bridge; light troops watch the fords.
        ...at('heavyInfantry', [13, 7], [14, 6], [14, 8]),
        ...at('lightInfantry', [13, 1], [13, 13], [14, 2], [14, 12]),
      ],
    },
  },
];

export const scenarioById = (id: string | undefined): Scenario | undefined => SCENARIOS.find((s) => s.id === id);

/** The battle settings a scenario plays with: its map and armies, three dice, the Recommended rules. */
export function scenarioSettings(sc: Scenario): Settings {
  return { budget: 50, map: sc.map, size: 'standard', dice: '3d6', options: { ...RECOMMENDED }, sides: { ...sc.sides }, scenario: sc.id };
}

/** The rules for a scenario without touching the shared CONFIG (for tests). */
export function scenarioConfig(sc: Scenario): GameConfig {
  return { ...CONFIG, board: boardFor(sc.map), dice: { count: 3, sides: 6, fixed: null }, options: { ...RECOMMENDED }, deploy: { depth: 5 } };
}

/** The battle at its first roll: both armies standing where the scenario puts them. Call after applySettings. */
export function buildScenario(sc: Scenario, cfg: GameConfig = CONFIG): GameState {
  let s: GameState = { ...newGame(cfg), phase: 'roll', current: 'red' };
  for (const owner of ['red', 'blue'] as Player[])
    for (const [type, col, row] of sc.units[owner]) {
      const [u, next] = makeUnit(s, type, owner, { col, row }, cfg);
      s = { ...next, units: [...next.units, u] };
    }
  return s;
}

/** A turn limit ran out: the holding side wins. Returns the finished battle, or null while it goes on. */
export function checkHold(s: GameState, sc: Scenario | undefined): GameState | null {
  if (!sc?.hold || s.phase !== 'roll' || s.winner || s.turn <= sc.hold.turns) return null;
  const player = sc.hold.side;
  return { ...s, phase: 'over', winner: player, winReason: 'held', log: [...s.log, { kind: 'win', turn: sc.hold.turns, player, reason: 'held' }] };
}

/** Stars for a win: 3 if the side lost under a quarter of its army, 2 under half, else 1. */
export function starsFor(s: GameState, p: Player, cfg: GameConfig = CONFIG): number {
  const start = s.startValue?.[p] ?? 0;
  if (!start) return 1;
  const lost = (start - armyValue(s, p, cfg)) / start;
  return lost < 0.25 ? 3 : lost < 0.5 ? 2 : 1;
}

// ---------- progress ----------

const KEY = 'boc-campaign';
export interface Progress {
  /** Best stars per won scenario. */
  won: Record<string, number>;
}

export function loadProgress(): Progress {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (p && typeof p.won === 'object' && p.won) return { won: { ...p.won } };
  } catch {
    /* blocked or broken storage: start fresh */
  }
  return { won: {} };
}

/** Records a win (keeps the best stars). Returns true the first time this scenario is won. */
export function recordWin(id: string, stars: number): boolean {
  const p = loadProgress();
  const first = !p.won[id];
  if ((p.won[id] ?? 0) >= stars) return first;
  p.won[id] = stars;
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, ...p }));
  } catch {
    /* progress kept for this visit only */
  }
  return first;
}

/** The first is always open; each next one opens when the one before it is won. */
export const unlocked = (i: number, p: Progress = loadProgress()) => i === 0 || !!p.won[SCENARIOS[i - 1]?.id];

// ---------- screens ----------

const TXT = {
  en: {
    campaign: 'Campaign',
    campaignSub: 'Eight famous battles, one after another',
    play: 'Play',
    replay: 'Replay',
    locked: 'Win the battle before this one to unlock it',
    whatIf: 'What if',
    you: 'You',
    back: 'Back',
    goalWin: 'Win: kill or capture the enemy leader, or break his army.',
    goalHold: (n: number) => `Hold out for ${n} turns, or win outright.`,
    goalBeat: (n: number) => `Win before turn ${n} ends, or the enemy holds out.`,
    turnOf: (t: number, n: number) => `Turn ${t} of ${n}`,
    next: 'Next battle',
    again: 'Try again',
    allDone: 'Campaign complete!',
    bc: 'BC',
  },
  ru: {
    campaign: 'Кампания',
    campaignSub: 'Восемь знаменитых битв, одна за другой',
    play: 'Играть',
    replay: 'Переиграть',
    locked: 'Победите в предыдущей битве, чтобы открыть эту',
    whatIf: 'Что если',
    you: 'Вы',
    back: 'Назад',
    goalWin: 'Победа: убейте или возьмите в плен вражеского вождя либо обратите его армию в бегство.',
    goalHold: (n: number) => `Продержитесь ${n} ходов или победите раньше.`,
    goalBeat: (n: number) => `Победите до конца ${n}-го хода, иначе враг выстоит.`,
    turnOf: (t: number, n: number) => `Ход ${t} из ${n}`,
    next: 'Следующая битва',
    again: 'Ещё раз',
    allDone: 'Кампания пройдена!',
    bc: 'до н. э.',
  },
};
export const campaignText = (l: Lang) => TXT[l];

const yearText = (l: Lang, y: number) => (y < 0 ? `${-y} ${TXT[l].bc}` : String(y));

export function goalText(l: Lang, sc: Scenario): string {
  if (!sc.hold) return TXT[l].goalWin;
  return sc.hold.side === 'red' ? TXT[l].goalHold(sc.hold.turns) : TXT[l].goalBeat(sc.hold.turns);
}

const starRow = (n: number) =>
  `<span class="cstars" aria-label="${n}/3">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}">★</i>`).join('')}</span>`;

/** The campaign list: one card per battle, locked until the one before is won. */
export function campaignScreen(l: Lang): string {
  const T = TXT[l];
  const p = loadProgress();
  const cards = SCENARIOS.map((sc, i) => {
    const open = unlocked(i, p);
    const stars = p.won[sc.id] ?? 0;
    const r = FACTIONS[sc.sides.red];
    const b = FACTIONS[sc.sides.blue];
    return `<li class="ccard ${open ? '' : 'locked'} ${stars ? 'won' : ''}">
      <div class="chead">
        <span class="cnum">${i + 1}</span>
        <span class="cyear">${yearText(l, sc.year)}${sc.whatIf ? ` · <em>${T.whatIf}</em>` : ''}</span>
        ${stars ? starRow(stars) : ''}
      </div>
      <h3>${sc.title[l]}</h3>
      <div class="cvs"><span class="cside" style="--fc:${r.color}">${r.emblem}<b>${r.name[l]}</b><small>${T.you}</small></span><span class="hero-vs">vs</span><span class="cside" style="--fc:${b.color}">${b.emblem}<b>${b.name[l]}</b></span></div>
      ${open ? `<p class="cstory">${sc.story[l]}</p><p class="cgoal">${goalText(l, sc)}</p>
      <button data-act="scenario" data-value="${sc.id}" class="${stars ? '' : 'primary'} wide">${stars ? T.replay : T.play}</button>` : `<p class="clock">🔒 ${T.locked}</p>`}
    </li>`;
  }).join('');
  return `<div class="cover campaign"><div class="card start campaign-card">
    <div class="chero"><button data-act="campaign-back" class="ghost">‹ ${T.back}</button><h2>${T.campaign}</h2><p>${T.campaignSub}</p></div>
    <ol class="clist">${cards}</ol>
  </div></div>`;
}

/** Extra lines and buttons on the result screen of a campaign battle. Records the win. */
export function scenarioResult(l: Lang, sc: Scenario, s: GameState): string {
  const T = TXT[l];
  if (s.winner !== 'red') return `<button data-act="scenario" data-value="${sc.id}" class="primary wide">${T.again}</button>`;
  const stars = starsFor(s, 'red');
  recordWin(sc.id, stars);
  const i = SCENARIOS.indexOf(sc);
  const next = SCENARIOS[i + 1];
  return `<p class="cresult">${starRow(stars)}</p>
    ${next ? `<button data-act="scenario" data-value="${next.id}" class="primary wide">${T.next}: ${next.title[l]}</button>` : `<p class="vbest"><b>${T.allDone}</b></p>`}
    <button data-act="campaign" class="${next ? '' : 'primary '}wide">${T.campaign}</button>`;
}
