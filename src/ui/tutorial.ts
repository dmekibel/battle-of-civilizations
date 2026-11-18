// The first-battle tutorial: a tiny scripted battle on a small open field that teaches the
// whole game in about three minutes (dice -> points, select, move, melee, shooting, the
// enemy's turn, and winning by defeating the King).
//
// It plays inside the normal game screen: main.ts swaps in a separate in-memory session
// (the player's saved game is never written while it runs, and comes back afterwards).
// Everything else lives here: the scenario, the scripted dice and enemy moves, the step
// machine, the coach card, the pulsing highlight and the gate that blocks wrong taps.
// The step machine and scenario are pure (no DOM), so tests can play the whole lesson.

import { CONFIG, type GameConfig, type UnitTypeId } from '../config';
import { buildBoard, getUnit, newGame, sameHex, unitAt, type AiAction, type GameState, type Hex, type Player, type Unit } from '../engine';
import { setSides } from './factions';
import type { Lang } from './i18n';

// ---------- the scenario ----------

/** The small open field: 11 x 7 hexes, a few trees in the corners. */
export const TUTORIAL_BOARD: GameConfig['board'] = {
  cols: 11,
  rows: 7,
  riverCol: null,
  bridgeRows: [],
  forests: [[0, 0], [1, 0], [10, 0], [0, 6], [9, 6], [10, 6]],
};

/** The rules as shipped (Dad's rules: every optional rule off), taken before any battle's settings change them. */
const PLAIN_OPTIONS: GameConfig['options'] = { ...CONFIG.options };

/** Plain rules for the lesson: three dice, no optional rules, pieces as tough as on Dad's board. */
export function tutorialConfig(base: GameConfig = CONFIG): GameConfig {
  const options = { ...PLAIN_OPTIONS };
  for (const k of Object.keys(options) as (keyof GameConfig['options'])[]) {
    // Every optional switch off, whatever later rules get added.
    if (typeof options[k] === 'boolean') (options as Record<string, unknown>)[k] = false;
  }
  return {
    ...base,
    board: structuredClone(TUTORIAL_BOARD),
    dice: { count: 3, sides: 6, fixed: null },
    options: {
      ...options,
      firstTurnBonus: 0,
      carryMax: 0,
      routAt: null,
      longShotFrom: null,
      volleys: null,
      rerolls: 0,
      toughness: 1,
      stepMoves: true,
      unitSpeeds: false,
      runLimit: 6,
    },
    combat: { ...base.combat, attackCost: 1, multipleAttacksPerUnit: true, moveAfterAttack: true, advanceAfterKill: 'must' },
    movement: { ...base.movement, passThroughFriendly: true, multipleMovesPerUnit: true },
    win: { killKing: true, captureKing: true },
  };
}

/** Piece ids, so steps and the enemy script can name them. */
export const T = {
  king: 'red-king',
  footman: 'red-footman',
  horseman: 'red-horseman',
  archer: 'red-archer',
  eKing: 'blue-king',
  eFootman: 'blue-footman',
  eRider: 'blue-rider',
  eArcher: 'blue-archer',
} as const;

const PIECES: [string, UnitTypeId, Player, number, number][] = [
  [T.king, 'king', 'red', 1, 3],
  [T.archer, 'archer', 'red', 2, 4],
  [T.footman, 'lightInfantry', 'red', 3, 3],
  [T.horseman, 'heavyCavalry', 'red', 5, 1],
  [T.eFootman, 'lightInfantry', 'blue', 5, 3],
  [T.eArcher, 'archer', 'blue', 7, 4],
  [T.eRider, 'lightCavalry', 'blue', 7, 1],
  [T.eKing, 'king', 'blue', 8, 2],
];

/** Where the footman steps (next to the enemy footman) and where the horseman rides (next to the enemy King). */
export const FOOTMAN_TO: Hex = { col: 4, row: 3 };
export const HORSEMAN_TO: Hex = { col: 7, row: 1 };

/** The battle, ready for Red to roll. */
export function tutorialState(cfg: GameConfig = CONFIG): GameState {
  const units: Unit[] = PIECES.map(([id, type, owner, col, row]) => ({
    id, type, owner, pos: { col, row }, hp: cfg.units[type].hp * (cfg.options.toughness || 1), moved: false, attacked: false,
  }));
  return { ...newGame(cfg), board: buildBoard(cfg), units, seq: units.length, phase: 'roll' };
}

/** Scripted dice, roll by roll: Red 3+4+2 = 9, the enemy 2+1+2 = 5, Red 4+4+3 = 11. */
export const DICE: number[][] = [[3, 4, 2], [2, 1, 2], [4, 4, 3]];

/** A random-number source that gives the scripted dice in order (for `rollDice`), then plain random. */
export function scriptedRng(dice: number[][] = DICE): () => number {
  const faces = dice.flat();
  let i = 0;
  // rollDice turns r into 1 + floor(r * 6): the middle of each face's slice is safe.
  return () => (i < faces.length ? (faces[i++] - 0.5) / 6 : Math.random());
}

/** The enemy's moves, per turn: its rider charges the footman that just pushed forward. */
const ENEMY: Record<number, AiAction[]> = {
  1: [
    { kind: 'move', unitId: T.eRider, to: { col: 6, row: 3 } },
    { kind: 'attack', unitId: T.eRider, targetId: T.footman },
  ],
};

/** The enemy's next scripted action, or null to end its turn. Works out where it is from the log. */
export function enemyAction(s: GameState): AiAction | null {
  if (s.phase !== 'act' || s.current !== 'blue') return null;
  const done = s.log.filter((e) => e.turn === s.turn && e.player === 'blue' && (e.kind === 'move' || e.kind === 'attack' || e.kind === 'shoot')).length;
  const a = ENEMY[s.turn]?.[done];
  if (!a) return null;
  // Anything off-script (a piece gone) just ends the turn.
  if (a.kind !== 'take' && a.kind !== 'reroll' && a.kind !== 'march' && !getUnit(s, a.unitId)) return null;
  if ((a.kind === 'attack' || a.kind === 'shoot') && !getUnit(s, a.targetId)) return null;
  return a;
}

// ---------- the steps ----------

/** What the player should tap: a piece, a hex, a button (data-act) or a part of the screen to look at. */
export type Target =
  | { kind: 'unit'; id: string }
  | { kind: 'hex'; hex: Hex }
  | { kind: 'act'; act: string }
  | { kind: 'look'; sel: string }
  | null;

/** A tap the player made: on a hex (pieces stand on hexes) or on a button. */
export type Tap = { hex: Hex } | { act: string };

type Txt = Record<Lang, string>;

export interface Step {
  id: string;
  /** Which of the seven lessons this belongs to (1-7). */
  lesson: number;
  text: (s: GameState, selected: string | null) => Txt;
  target: (s: GameState, selected: string | null) => Target;
  /** Finished? `acked` holds the info steps the player has tapped Next on. */
  done: (s: GameState, selected: string | null, acked: Set<string>) => boolean;
  /** An info step: a Next button on the card instead of a tap on the board. */
  next?: boolean;
}

const has = (s: GameState, id: string) => !!getUnit(s, id);
const at = (s: GameState, id: string, h: Hex) => { const u = getUnit(s, id); return !!u && sameHex(u.pos, h); };
const pick = (selected: string | null, id: string, then: Target): Target => (selected === id ? then : { kind: 'unit', id });

export const STEPS: Step[] = [
  {
    id: 'roll', lesson: 1,
    text: () => ({ en: 'Every turn starts with a roll of the dice.', ru: 'Каждый ход начинается с броска кубиков.' }),
    target: () => ({ kind: 'look', sel: '.dice' }),
    done: (s) => s.log.length > 0,
  },
  {
    id: 'points', lesson: 1, next: true,
    text: (s) => ({
      en: `The dice gave you ${s.points} move points (at the top): walking, hitting and shooting all spend them.`,
      ru: `Кубики дали вам ${s.points} очков хода (вверху): на них вы ходите, бьёте и стреляете.`,
    }),
    target: () => ({ kind: 'look', sel: '.points' }),
    done: (_s, _sel, acked) => acked.has('points'),
  },
  {
    id: 'select', lesson: 2,
    text: () => ({ en: 'Tap your glowing footman to see where he can go.', ru: 'Нажмите на мерцающего пехотинца, чтобы увидеть, куда он может пойти.' }),
    target: () => ({ kind: 'unit', id: T.footman }),
    done: (s, sel) => sel === T.footman || !at(s, T.footman, { col: 3, row: 3 }),
  },
  {
    id: 'move', lesson: 3,
    text: (_s, sel) => sel === T.footman
      ? { en: 'The lit hexes are where he can go: tap the glowing one to step up to the enemy.', ru: 'Подсвеченные клетки — куда он может пойти: нажмите на мерцающую, чтобы подойти к врагу.' }
      : { en: 'Tap your glowing footman again.', ru: 'Снова нажмите на мерцающего пехотинца.' },
    target: (_s, sel) => pick(sel, T.footman, { kind: 'hex', hex: FOOTMAN_TO }),
    done: (s) => !at(s, T.footman, { col: 3, row: 3 }),
  },
  {
    id: 'attack', lesson: 4,
    text: (_s, sel) => sel === T.footman
      ? { en: 'He stands next to an enemy: tap the enemy to attack him, a hit costs 1 point.', ru: 'Он стоит рядом с врагом: нажмите на врага, чтобы ударить, удар стоит 1 очко.' }
      : { en: 'Tap your glowing footman, then the enemy beside him.', ru: 'Нажмите на мерцающего пехотинца, а затем на врага рядом.' },
    target: (_s, sel) => pick(sel, T.footman, { kind: 'unit', id: T.eFootman }),
    done: (s) => !has(s, T.eFootman),
  },
  {
    id: 'shoot', lesson: 5,
    text: (_s, sel) => sel === T.archer
      ? { en: 'The rings show his range, 2 to 6 hexes: tap the enemy archer to shoot, a shot costs 1 point.', ru: 'Кольца показывают его дальность, от 2 до 6 клеток: нажмите на вражеского лучника, выстрел стоит 1 очко.' }
      : { en: 'Archers shoot from afar: tap your glowing archer.', ru: 'Лучники стреляют издалека: нажмите на мерцающего лучника.' },
    target: (_s, sel) => pick(sel, T.archer, { kind: 'unit', id: T.eArcher }),
    done: (s) => !has(s, T.eArcher),
  },
  {
    id: 'end', lesson: 6,
    text: () => ({ en: 'That is enough for this turn: tap End turn and watch what the enemy does.', ru: 'На этот ход хватит: нажмите «Завершить ход» и посмотрите, что сделает враг.' }),
    target: () => ({ kind: 'act', act: 'end' }),
    done: (s) => s.turn > 1 || s.current === 'blue',
  },
  {
    id: 'watch', lesson: 6,
    text: () => ({ en: 'The enemy’s turn: watch his rider.', ru: 'Ход врага: следите за его всадником.' }),
    target: () => null,
    done: (s) => s.turn > 1 && s.current === 'red' && s.phase !== 'roll',
  },
  {
    id: 'king-select', lesson: 7,
    text: (s) => has(s, T.footman)
      ? { en: 'Your turn again: now win the battle, tap your glowing horseman.', ru: 'Снова ваш ход: пора побеждать, нажмите на мерцающего всадника.' }
      : { en: 'His rider struck down your footman; now win the battle: tap your glowing horseman.', ru: 'Его всадник сразил вашего пехотинца; теперь побеждайте: нажмите на мерцающего всадника.' },
    target: () => ({ kind: 'unit', id: T.horseman }),
    done: (s, sel) => sel === T.horseman || !at(s, T.horseman, { col: 5, row: 1 }),
  },
  {
    id: 'king-ride', lesson: 7,
    text: (_s, sel) => sel === T.horseman
      ? { en: 'Ride to the glowing hex, right next to the enemy King.', ru: 'Скачите на мерцающую клетку, прямо к вражескому королю.' }
      : { en: 'Tap your glowing horseman again.', ru: 'Снова нажмите на мерцающего всадника.' },
    target: (_s, sel) => pick(sel, T.horseman, { kind: 'hex', hex: HORSEMAN_TO }),
    done: (s) => !at(s, T.horseman, { col: 5, row: 1 }),
  },
  {
    id: 'king-hit', lesson: 7,
    text: (_s, sel) => sel === T.horseman
      ? { en: 'Attack the King: defeat the enemy King and the battle is yours!', ru: 'Атакуйте короля: победите вражеского короля, и битва ваша!' }
      : { en: 'Tap your glowing horseman, then the enemy King.', ru: 'Нажмите на мерцающего всадника, а затем на вражеского короля.' },
    target: (_s, sel) => pick(sel, T.horseman, { kind: 'unit', id: T.eKing }),
    done: (s) => s.phase === 'over',
  },
  {
    id: 'ready', lesson: 7,
    text: () => ({ en: 'That is the whole game: roll, move, hit, and go for the King.', ru: 'Вот и вся игра: бросайте кубики, ходите, бейте и охотьтесь на короля.' }),
    target: () => null,
    done: () => false,
  },
];

export const LESSONS = 7;

/** The step the player is on: the first one not yet done. */
export function stepAt(s: GameState, selected: string | null, acked: Set<string>): number {
  let i = 0;
  while (i < STEPS.length - 1 && STEPS[i].done(s, selected, acked)) i++;
  return i;
}

/** Is this tap what the step asks for? Wrong taps are blocked (with a gentle nudge). */
export function allows(step: Step, s: GameState, selected: string | null, tap: Tap): boolean {
  const want = step.target(s, selected);
  if (!want) return false;
  if ('act' in tap) return want.kind === 'act' && want.act === tap.act;
  if (want.kind === 'hex') return sameHex(want.hex, tap.hex);
  if (want.kind === 'unit') {
    const u = getUnit(s, want.id);
    return !!u && sameHex(u.pos, tap.hex) && unitAt(s, tap.hex)?.id === u.id;
  }
  return false;
}

// ---------- the words around the steps ----------

const W = {
  en: {
    menu: 'Tutorial', skip: 'Skip', next: 'Next', step: 'Step {n} of {m}', enemy: 'Enemy turn',
    nudgePiece: 'Tap the glowing piece.', nudgeHex: 'Tap the glowing hex.', nudgeButton: 'Tap the glowing button.', nudgeNext: 'Tap Next to go on.', nudgeWait: 'Wait for the enemy to finish.',
    readyTitle: 'You’re ready!', quick: 'Quick battle', back: 'Back to my battle',
    offerTitle: 'New here?', offerText: 'Learn to play in 3 minutes with a tiny guided battle.', offerGo: 'Start the tutorial', offerNo: 'Not now',
  },
  ru: {
    menu: 'Обучение', skip: 'Пропустить', next: 'Дальше', step: 'Шаг {n} из {m}', enemy: 'Ход врага',
    nudgePiece: 'Нажмите на мерцающую фигуру.', nudgeHex: 'Нажмите на мерцающую клетку.', nudgeButton: 'Нажмите на мерцающую кнопку.', nudgeNext: 'Нажмите «Дальше».', nudgeWait: 'Подождите, пока враг закончит ход.',
    readyTitle: 'Вы готовы!', quick: 'Быстрая битва', back: 'Вернуться к своей битве',
    offerTitle: 'Впервые здесь?', offerText: 'Научитесь играть за 3 минуты в маленькой битве с подсказками.', offerGo: 'Начать обучение', offerNo: 'Не сейчас',
  },
} satisfies Record<Lang, Record<string, string>>;

/** The menu row's label. */
export const tutorialLabel = (lang: Lang) => W[lang].menu;

// ---------- running it in the page ----------

/** What main.ts lends the tutorial. `enter` swaps in the lesson's session and returns how to put everything back. */
export interface TutorialHost {
  app: HTMLElement;
  /** No saved game yet: a first launch, so the tutorial is offered once. */
  fresh: boolean;
  lang: () => Lang;
  state: () => GameState;
  selected: () => string | null;
  /** Sets the rules for the lesson (call `configure` first), loads `state`, and returns a restore function. */
  enter: (state: GameState) => () => void;
  /** After restoring: start a quick battle against the computer. */
  quickBattle: () => void;
  /** The game the player had before (shown as "Back to my battle" at the end). */
  hadGame: () => boolean;
}

const DONE_KEY = 'boc-tutorial-done';
const markDone = () => { try { localStorage.setItem(DONE_KEY, '1'); } catch { /* private window */ } };
const wasDone = () => { try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return true; } };

let host: TutorialHost | null = null;
let restore: (() => void) | null = null;
let rng: (() => number) | null = null;
let acked = new Set<string>();
let nudge: string | null = null;
let nudgeTimer = 0;
let readyAt = 0;
let hadGame = false;
let card: HTMLElement | null = null;
let shownKey = '';
let lit: Element[] = [];
/** A bouncing arrow over the piece or hex to tap (the board's own marks can hide a glowing hex). */
let pointer: HTMLElement | null = null;

/** True while the lesson is running (main.ts then skips saving and uses the scripted dice and enemy). */
export const tutorialOn = () => restore !== null;
/** Dice for a roll: the scripted ones during the lesson. */
export const tutorialRng = (): (() => number) => rng ?? Math.random;

/** Puts the lesson's rules into the live CONFIG (main.ts restores the player's own settings afterwards). */
function configure() {
  const cfg = tutorialConfig(CONFIG);
  CONFIG.board = cfg.board;
  CONFIG.dice = cfg.dice;
  CONFIG.options = cfg.options;
  CONFIG.combat = cfg.combat;
  CONFIG.movement = cfg.movement;
  CONFIG.win = cfg.win;
  // A clear day (main.ts puts the player's own light and weather back with their settings).
  delete CONFIG.weather;
  // The two armies whose pieces the lesson names (footman, horseman, archer).
  setSides({ red: 'novgorod', blue: 'teutonic' });
}

export function startTutorial() {
  if (!host || restore) return;
  markDone();
  hadGame = host.hadGame();
  // The player's own rules come back with their settings; the combat/movement/win blocks are not
  // part of the settings, so keep them here and put them back too.
  const keep = { combat: CONFIG.combat, movement: CONFIG.movement, win: CONFIG.win };
  configure();
  rng = scriptedRng();
  acked = new Set();
  nudge = null;
  readyAt = 0;
  // Switched on before the lesson's first render, so that render already skips saving.
  let back: (() => void) | null = null;
  restore = () => {
    Object.assign(CONFIG, keep);
    back?.();
  };
  back = host.enter(tutorialState());
  closeOffer();
  tick();
}

function stop(then?: () => void) {
  const r = restore;
  restore = null;
  rng = null;
  card?.remove();
  card = null;
  shownKey = '';
  unlight();
  r?.();
  then?.();
}

function step(): Step {
  return STEPS[stepAt(host!.state(), host!.selected(), acked)];
}

/** Blocks taps the current step doesn't ask for (runs before main.ts's own click handler). */
function gate(e: MouseEvent) {
  if (!restore || !host) return;
  const el = e.target as Element;
  const hexEl = el.closest('[data-col]');
  const act = el.closest('[data-act]')?.getAttribute('data-act');
  // Looking around is always fine.
  if (!hexEl && (!act || ['zoom-in', 'zoom-out', 'cam-flip'].includes(act))) return;
  const st = step();
  const tap: Tap = hexEl ? { hex: { col: Number(hexEl.getAttribute('data-col')), row: Number(hexEl.getAttribute('data-row')) } } : { act: act! };
  if (allows(st, host.state(), host.selected(), tap)) {
    nudge = null;
    return;
  }
  e.stopImmediatePropagation();
  e.preventDefault();
  const want = st.target(host.state(), host.selected());
  const w = W[host.lang()];
  nudge = st.next ? w.nudgeNext : st.id === 'watch' ? w.nudgeWait : want?.kind === 'hex' ? w.nudgeHex : want?.kind === 'act' ? w.nudgeButton : want ? w.nudgePiece : w.nudgeWait;
  shownKey = '';
  card?.classList.remove('tut-shake');
  void card?.offsetWidth;
  card?.classList.add('tut-shake');
  clearTimeout(nudgeTimer);
  nudgeTimer = window.setTimeout(() => ((nudge = null), (shownKey = '')), 3500);
}

function unlight() {
  for (const el of lit) el.classList.remove('tut-glow');
  lit = [];
  pointer?.remove();
  pointer = null;
}

/** Puts the arrow just above the target: over the standing piece when there is one, else over the hex. */
function point(els: Element[], board: boolean) {
  // While the camera moves there can be two boards; the live copy is the one on show.
  const pick = (sel: string) => els.filter((e) => e.matches(sel)).map((e) => e.getBoundingClientRect()).find((r) => r.width > 0);
  const r = board ? pick('svg.live g') ?? pick('g') ?? pick('svg.live polygon') ?? pick('polygon') : undefined;
  if (!r) {
    pointer?.remove();
    pointer = null;
    return;
  }
  if (!pointer) {
    pointer = document.createElement('div');
    pointer.className = 'tut-pointer';
    pointer.setAttribute('aria-hidden', 'true');
    document.body.append(pointer);
  }
  pointer.style.left = `${r.left + r.width / 2}px`;
  pointer.style.top = `${r.top}px`;
}

/** Every frame: light up the target (the board is redrawn often, so the mark is put back each time) and refresh the card. */
function tick() {
  if (!restore || !host) return;
  requestAnimationFrame(tick);
  const s = host.state();
  const sel = host.selected();
  const i = stepAt(s, sel, acked);
  const st = STEPS[i];
  const want = st.target(s, sel);
  const els: Element[] = [];
  if (want?.kind === 'act') els.push(...host.app.querySelectorAll(`[data-act="${want.act}"]`));
  else if (want?.kind === 'look') els.push(...host.app.querySelectorAll(want.sel));
  else if (want) {
    const h = want.kind === 'hex' ? want.hex : getUnit(s, want.id)?.pos;
    if (h) els.push(...host.app.querySelectorAll(`[data-col="${h.col}"][data-row="${h.row}"]`));
  }
  for (const el of lit) if (!els.includes(el)) el.classList.remove('tut-glow');
  for (const el of els) el.classList.add('tut-glow');
  lit = els;
  point(els, want?.kind === 'unit' || want?.kind === 'hex');
  if (st.id === 'ready' && !readyAt) readyAt = Date.now() + 1600;
  const ready = st.id === 'ready' && Date.now() >= readyAt;
  const lang = host.lang();
  const key = `${i}|${sel}|${lang}|${nudge}|${ready}|${s.points}|${s.current}`;
  if (key !== shownKey) {
    shownKey = key;
    showCard(st, s, sel, lang, ready);
  }
}

function showCard(st: Step, s: GameState, sel: string | null, lang: Lang, ready: boolean) {
  const w = W[lang];
  if (!card) {
    card = document.createElement('div');
    card.addEventListener('click', onCard);
    document.body.append(card);
  }
  if (ready) {
    card.className = 'tut-final';
    card.innerHTML = `<div class="tut-final-card" role="dialog" aria-modal="true" aria-labelledby="tut-final-h">
      <div class="tut-medal" aria-hidden="true">★</div>
      <h2 id="tut-final-h">${w.readyTitle}</h2>
      <p>${st.text(s, sel)[lang]}</p>
      <button data-tut="quick" class="primary wide">${w.quick}</button>
      ${hadGame ? `<button data-tut="back" class="ghost wide">${w.back}</button>` : ''}
    </div>`;
    return;
  }
  const enemy = s.current === 'blue' && s.phase !== 'over';
  card.className = 'tut-coach';
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  card.innerHTML = `<div class="tut-head">
      <span class="tut-step">${enemy ? w.enemy : w.step.replace('{n}', String(st.lesson)).replace('{m}', String(LESSONS))}</span>
      <span class="tut-dots" aria-hidden="true">${Array.from({ length: LESSONS }, (_, k) => `<i class="${k < st.lesson ? 'on' : ''}"></i>`).join('')}</span>
      <button data-tut="skip" class="ghost tut-skip">${w.skip}</button>
    </div>
    <p class="tut-text">${st.text(s, sel)[lang]}</p>
    ${nudge ? `<p class="tut-nudge">${nudge}</p>` : ''}
    ${st.next ? `<button data-tut="next" class="primary tut-next">${w.next} →</button>` : ''}`;
}

function onCard(e: MouseEvent) {
  const act = (e.target as Element).closest('[data-tut]')?.getAttribute('data-tut');
  if (act === 'skip' || act === 'back') return stop();
  if (act === 'quick') return stop(() => host?.quickBattle());
  if (act === 'next') {
    acked.add(step().id);
    nudge = null;
    shownKey = '';
  }
}

// ---------- offered once, on the very first launch ----------

let offer: HTMLElement | null = null;
function closeOffer() {
  offer?.remove();
  offer = null;
}
function showOffer() {
  if (!host) return;
  const w = W[host.lang()];
  offer = document.createElement('div');
  offer.className = 'tut-final tut-offer';
  offer.innerHTML = `<div class="tut-final-card" role="dialog" aria-modal="true" aria-labelledby="tut-offer-h">
    <div class="tut-medal" aria-hidden="true">?</div>
    <h2 id="tut-offer-h">${w.offerTitle}</h2>
    <p>${w.offerText}</p>
    <button data-tut="go" class="primary wide">${w.offerGo}</button>
    <button data-tut="no" class="ghost wide">${w.offerNo}</button>
  </div>`;
  offer.addEventListener('click', (e) => {
    const act = (e.target as Element).closest('[data-tut]')?.getAttribute('data-tut');
    if (act === 'go') startTutorial();
    if (act === 'no') {
      markDone();
      closeOffer();
    }
  });
  document.body.append(offer);
}

/** Called once by main.ts after the first render. */
export function initTutorial(h: TutorialHost) {
  host = h;
  h.app.addEventListener('click', gate, true);
  // The keyboard shortcuts click buttons too, so the gate covers them; Tab/N (next piece) only selects.
  if (h.fresh && !wasDone()) showOffer();
}
