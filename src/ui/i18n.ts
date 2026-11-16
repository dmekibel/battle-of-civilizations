import type { UnitTypeId } from '../config';
import type { ErrorCode, LogEntry, Player, WinReason } from '../engine';
import type { Hex } from '../engine';

export type Lang = 'ru' | 'en';

const STR = {
  ru: {
    title: 'Битва цивилизаций',
    turn: 'Ход',
    red: 'Красные',
    blue: 'Синие',
    roll: 'Бросить кубики',
    points: 'очки хода',
    undo: 'Отменить',
    endTurn: 'Завершить ход',
    newGame: 'Новая игра',
    log: 'Журнал',
    emptyLog: 'Пока ничего не произошло.',
    rollFirst: 'бросьте кубики',
    pickUnit: 'Выберите свою фигуру',
    hp: 'ОЗ',
    atk: 'атака',
    perHex: 'очк. за клетку',
    shot: 'выстрел',
    range: 'дальность',
    attack: 'Атака',
    shoot: 'Выстрел',
    kills: 'цель погибнет',
    cost: 'стоит',
    wins: 'победили!',
    confirmNew: 'Начать заново? Нажмите ещё раз.',
    help: 'Нажмите на фигуру: зелёные клетки — куда она дойдёт, красные — кого она может ударить.',
    pieces: 'Фигуры',
    legendNote: 'Залитые — тяжёлые, контурные — лёгкие. Точки под фигурой — её ОЗ.',
    noMelee: 'без ближнего боя',
  },
  en: {
    title: 'Battle of Civilizations',
    turn: 'Turn',
    red: 'Red',
    blue: 'Blue',
    roll: 'Roll dice',
    points: 'move points',
    undo: 'Undo',
    endTurn: 'End turn',
    newGame: 'New game',
    log: 'Log',
    emptyLog: 'Nothing has happened yet.',
    rollFirst: 'roll the dice',
    pickUnit: 'Pick one of your pieces',
    hp: 'HP',
    atk: 'attack',
    perHex: 'pts per hex',
    shot: 'shot',
    range: 'range',
    attack: 'Attack',
    shoot: 'Shoot',
    kills: 'target dies',
    cost: 'costs',
    wins: 'win!',
    confirmNew: 'Start over? Tap again.',
    help: 'Tap a piece: green hexes show where it can reach, red ones who it can hit.',
    pieces: 'Pieces',
    legendNote: 'Filled = heavy, outline = light. Dots under a piece = its HP.',
    noMelee: 'no melee',
  },
};

export type Key = keyof (typeof STR)['ru'];

const UNITS: Record<Lang, Record<UnitTypeId, string>> = {
  ru: {
    king: 'Король',
    heavyInfantry: 'Тяжёлая пехота',
    lightInfantry: 'Лёгкая пехота',
    heavyCavalry: 'Тяжёлая кавалерия',
    lightCavalry: 'Лёгкая кавалерия',
    archer: 'Лучники',
  },
  en: {
    king: 'King',
    heavyInfantry: 'Heavy infantry',
    lightInfantry: 'Light infantry',
    heavyCavalry: 'Heavy cavalry',
    lightCavalry: 'Light cavalry',
    archer: 'Archers',
  },
};

const ERRORS: Record<Lang, Record<ErrorCode, string>> = {
  ru: {
    wrongPhase: 'Сейчас этого сделать нельзя.',
    noSuchUnit: 'Такой фигуры нет.',
    notYourUnit: 'Это фигура противника.',
    notEnemy: 'Своих не бьют.',
    unreachable: 'Туда не дойти с оставшимися очками.',
    notAdjacent: 'Для атаки нужно стоять рядом.',
    notEnoughPoints: 'Не хватает очков.',
    cannotMelee: 'Эта фигура не бьётся врукопашную.',
    cannotShoot: 'Эта фигура не стреляет.',
    outOfRange: 'Цель вне дальности выстрела.',
    noLineOfSight: 'Лес закрывает цель.',
    alreadyAttacked: 'Эта фигура уже атаковала.',
    alreadyMoved: 'Эта фигура уже ходила.',
  },
  en: {
    wrongPhase: 'You can’t do that right now.',
    noSuchUnit: 'No such piece.',
    notYourUnit: 'That’s an enemy piece.',
    notEnemy: 'You can’t attack your own side.',
    unreachable: 'Can’t reach there with the points left.',
    notAdjacent: 'You must be next to the target to attack.',
    notEnoughPoints: 'Not enough points.',
    cannotMelee: 'This piece can’t fight hand to hand.',
    cannotShoot: 'This piece can’t shoot.',
    outOfRange: 'Target is out of range.',
    noLineOfSight: 'A forest blocks the shot.',
    alreadyAttacked: 'This piece has already attacked.',
    alreadyMoved: 'This piece has already moved.',
  },
};

const REASONS: Record<Lang, Record<WinReason, string>> = {
  ru: { kingKilled: 'Король противника убит.', kingCaptured: 'Король противника взят в плен.' },
  en: { kingKilled: 'The enemy King was killed.', kingCaptured: 'The enemy King was captured.' },
};

export const t = (l: Lang, k: Key) => STR[l][k];
export const unitName = (l: Lang, u: UnitTypeId) => UNITS[l][u];
export const errorText = (l: Lang, e: ErrorCode) => ERRORS[l][e];
export const reasonText = (l: Lang, r: WinReason) => REASONS[l][r];
export const playerName = (l: Lang, p: Player) => STR[l][p];

/** Board coordinate like "D5": column letter, row number. */
export const hexName = (h: Hex) => `${String.fromCharCode(65 + h.col)}${h.row + 1}`;

export function logText(l: Lang, e: LogEntry): string {
  const ru = l === 'ru';
  switch (e.kind) {
    case 'roll':
      return ru ? `бросок ${e.dice.join('+')} = ${e.total}` : `rolled ${e.dice.join('+')} = ${e.total}`;
    case 'move':
      return `${unitName(l, e.unit)} ${hexName(e.from)} → ${hexName(e.to)} (−${e.cost})`;
    case 'attack':
    case 'shoot': {
      const verb = e.kind === 'attack' ? (ru ? 'бьёт' : 'hits') : ru ? 'стреляет в' : 'shoots';
      const end = e.killed ? (ru ? ', убит' : ', killed') : '';
      return `${unitName(l, e.unit)} ${verb} ${unitName(l, e.target).toLowerCase()}: −${e.damage} ${t(l, 'hp')}${end}`;
    }
    case 'endTurn':
      return ru ? 'конец хода' : 'ended turn';
    case 'win':
      return `${playerName(l, e.player)} ${t(l, 'wins')} ${reasonText(l, e.reason)}`;
  }
}
