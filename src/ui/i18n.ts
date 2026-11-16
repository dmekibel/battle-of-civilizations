import type { UnitTypeId } from '../config';
import type { ErrorCode, LogEntry, Player, WinReason } from '../engine';
import type { Hex } from '../engine';

export type Lang = 'ru' | 'en';

const STR = {
  ru: {
    title: 'Битва цивилизаций',
    turn: 'Ход',
    red: 'Новгород',
    blue: 'Тевтонский орден',
    roll: 'Бросить кубики',
    points: 'очки хода',
    undo: 'Отменить',
    endTurn: 'Завершить ход',
    newGame: 'Новая игра',
    log: 'Журнал',
    emptyLog: 'Пока ничего не произошло.',
    rollFirst: 'бросьте кубики',
    pickUnit: 'Выберите свою фигуру',
    hp: 'защита',
    atk: 'атака',
    perHex: 'очк. за клетку',
    shot: 'выстрел',
    range: 'дальность',
    attack: 'Атака',
    shoot: 'Выстрел',
    kills: 'цель погибнет',
    cost: 'стоит',
    wins: 'побеждает!',
    confirmNew: 'Начать заново? Нажмите ещё раз.',
    help: 'Нажмите на фигуру: зелёные клетки — куда она дойдёт, красные — кого она может ударить.',
    pieces: 'Фигуры',
    legendNote: 'Залитые — тяжёлые, контурные — лёгкие. Точки под фигурой — сколько защиты осталось.',
    noMelee: 'без ближнего боя',
    build: 'соберите армию',
    pointsLeft: 'очков осталось',
    kingFree: 'Король входит в армию бесплатно.',
    power: 'сила',
    toDeploy: 'Расставить армию',
    deploy: 'расставьте армию',
    deployHint: 'Выберите фигуру внизу и нажмите клетку в своей зоне. Нажмите поставленную фигуру, чтобы убрать её.',
    autoPlace: 'Авто',
    done: 'Готово',
    handTo: 'Передайте телефон:',
    noPeek: 'не подглядывает.',
    imReady: 'Я готов',
    battle: 'К бою!',
    battleText: 'Обе армии на поле. Первыми ходят',
    startBattle: 'Начать битву',
    quick: 'Быстрая битва',
    menu: 'Меню',
    close: 'Закрыть',
    language: 'English',
    setup: 'расстановка',
    left: 'осталось',
    takeHex: 'Занять клетку',
    keyAtk: 'атака',
    keyDef: 'защита',
    keyMove: 'очков за 1 клетку хода',
    keyRange: 'дальность стрельбы',
    pts: 'очк.',
    soundOn: '🔊 Звук вкл.',
    yourArmy: 'Ваша армия',
    piecesN: 'фигур',
    autoArmy: '🎲 Авто-армия',
    autoAll: '⚡ Всё авто',
    chooseMode: 'Как будете играть?',
    twoPlayers: 'Два игрока',
    twoPlayersSub: 'Один телефон, ходите по очереди',
    vsComputer: 'Против компьютера',
    vsComputerSub: 'Вы — Новгород, компьютер — Тевтонский орден',
    thinking: 'думает…',
    keys: 'Клавиши: Пробел — бросок, Enter — конец хода, U или Ctrl+Z — отменить, + / − — масштаб, Esc — снять выбор. Карту можно тянуть мышью.',
    soundOff: '🔇 Звук выкл.',
    tagAtk: 'АТК',
    tagDef: 'ЗАЩ',
    tagMove: 'ХОД',
    tagRange: 'ДАЛЬН',
    orKeep: 'или сделайте другой ход, чтобы остаться.',
  },
  en: {
    title: 'Battle of Civilizations',
    turn: 'Turn',
    red: 'Novgorod',
    blue: 'Teutonic Order',
    roll: 'Roll dice',
    points: 'move points',
    undo: 'Undo',
    endTurn: 'End turn',
    newGame: 'New game',
    log: 'Log',
    emptyLog: 'Nothing has happened yet.',
    rollFirst: 'roll the dice',
    pickUnit: 'Pick one of your pieces',
    hp: 'defense',
    atk: 'attack',
    perHex: 'pts per hex',
    shot: 'shot',
    range: 'range',
    attack: 'Attack',
    shoot: 'Shoot',
    kills: 'target dies',
    cost: 'costs',
    wins: 'wins!',
    confirmNew: 'Start over? Tap again.',
    help: 'Tap a piece: green hexes show where it can reach, red ones who it can hit.',
    pieces: 'Pieces',
    legendNote: 'Filled = heavy, outline = light. Dots under a piece = defense left.',
    noMelee: 'no melee',
    build: 'build your army',
    pointsLeft: 'points left',
    kingFree: 'Your King joins for free.',
    power: 'power',
    toDeploy: 'Place army',
    deploy: 'place your army',
    deployHint: 'Pick a piece below, then tap a hex in your zone. Tap a placed piece to pick it up.',
    autoPlace: 'Auto',
    done: 'Done',
    handTo: 'Hand the phone to',
    noPeek: 'no peeking.',
    imReady: 'I’m ready',
    battle: 'To battle!',
    battleText: 'Both armies are on the field. First move:',
    startBattle: 'Start the battle',
    quick: 'Quick battle',
    menu: 'Menu',
    close: 'Close',
    language: 'Русский',
    setup: 'setup',
    left: 'left',
    takeHex: 'Take the hex',
    keyAtk: 'attack',
    keyDef: 'defense',
    keyMove: 'points to move 1 hex',
    keyRange: 'shooting range',
    pts: 'pts',
    soundOn: '🔊 Sound on',
    yourArmy: 'Your army',
    piecesN: 'pieces',
    autoArmy: '🎲 Auto army',
    autoAll: '⚡ Auto everything',
    chooseMode: 'How do you want to play?',
    twoPlayers: 'Two players',
    twoPlayersSub: 'One phone, take turns',
    vsComputer: 'Against the computer',
    vsComputerSub: 'You lead Novgorod, the computer leads the Teutonic Order',
    thinking: 'is thinking…',
    keys: 'Keys: Space roll, Enter end turn, U or Ctrl+Z undo, + / − zoom, Esc deselect. Drag the map with the mouse.',
    soundOff: '🔇 Sound off',
    tagAtk: 'ATK',
    tagDef: 'DEF',
    tagMove: 'MOVE',
    tagRange: 'RANGE',
    orKeep: 'or make any other move to stay put.',
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
    overBudget: 'Не хватает очков на такую армию.',
    badArmy: 'Неверный состав армии.',
    tooManyPieces: 'Столько фигур не поместится в вашей зоне.',
    notInReserve: 'Таких фигур больше нет.',
    outsideZone: 'Ставить можно только в своей зоне.',
    blocked: 'Сюда нельзя поставить фигуру.',
    occupied: 'Клетка занята.',
    reserveNotEmpty: 'Сначала расставьте все фигуры.',
    nothingToTake: 'Занять нечего.',
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
    overBudget: 'Not enough points for that army.',
    badArmy: 'That army isn’t valid.',
    tooManyPieces: 'That many pieces won’t fit in your zone.',
    notInReserve: 'None of those left to place.',
    outsideZone: 'You can only set up in your own zone.',
    blocked: 'A piece can’t stand there.',
    occupied: 'That hex is taken.',
    reserveNotEmpty: 'Place all your pieces first.',
    nothingToTake: 'There’s no hex to take.',
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
      const end = e.killed ? (ru ? ', убит' : ', killed') + (e.advanced ? (ru ? ', клетка занята' : ', took the hex') : '') : '';
      return `${unitName(l, e.unit)} ${verb} ${unitName(l, e.target).toLowerCase()}: −${e.damage} ${t(l, 'hp')}${end}`;
    }
    case 'endTurn':
      return ru ? 'конец хода' : 'ended turn';
    case 'win':
      return `${playerName(l, e.player)} ${t(l, 'wins')} ${reasonText(l, e.reason)}`;
  }
}
