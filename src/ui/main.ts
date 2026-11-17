import './style.css';
import { CONFIG, type UnitTypeId } from '../config';
import {
  apply,
  armyCost,
  attack,
  autoDeploy,
  canUndo,
  draftArmy,
  endTurn,
  finishDeploy,
  getUnit,
  key,
  liftUnit,
  maxHp,
  stepCost,
  hexesPerPoint,
  moveUnit,
  newGame,
  other,
  placeUnit,
  quickStart,
  reachable,
  rollDice,
  reroll,
  canReroll,
  shoot,
  routeTo,
  startSession,
  takeHex,
  strikeTargets,
  undo,
  unitAt,
  zoneHexes,
  type ArmyCounts,
  aiNextAction,
  applyAi,
  suggestArmy,
  type AttackPreview,
  type GameState,
  type Hex,
  type Unit,
  distance,
  hasLineOfSight,
  neighbors,
  type LogEntry,
  type Player,
  type Result,
  type Session,
} from '../engine';
import { NO_EFFECTS, STEP_MS, hexOnMap, mapSize, renderBoard, screenToGround, viewCube, type Camera, type Effects, type Overlay } from './board';
import { errorText, logText, playerName, reasonText, t, unitName, type Key, type Lang } from './i18n';
import { unitIcon } from './symbols';
import { FACTIONS, FACTION_ORDER, factionOf, rosterOf, type FactionId } from './factions';
import { isMuted, sound, toggleMute } from './sound';
import { DADS_RULES, RECOMMENDED, applySettings, fixedPoints, loadSettings, saveSettings, type DiceId, type MapId, type Settings } from './settings';

const app = document.getElementById('app')!;

const LANG_KEY = 'boc-lang';
function loadLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'ru' ? 'ru' : 'en';
  } catch {
    return 'en';
  }
}

// ---------- saving ----------
// The game is saved after every change, so closing the app or locking the phone loses nothing.

const SAVE_KEY = 'boc-save-v1';

type Mode = 'pvp' | 'ai';
/** In a game against the computer, it plays the Teutonic Order. */
const AI_SIDE: Player = 'blue';

interface Saved {
  board: [number, number];
  state: GameState;
  cover: boolean;
  mode: Mode;
  settings?: Settings;
}

function loadGame(): Saved | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    const ok = saved?.state?.phase && Array.isArray(saved.state.units) && saved.state.reserve && 'advance' in saved.state;
    const sameBoard = saved.board?.[0] === CONFIG.board.cols && saved.board?.[1] === CONFIG.board.rows;
    return ok && sameBoard ? saved : null;
  } catch {
    return null;
  }
}

function saveGame() {
  try {
    const data: Saved = { board: [CONFIG.board.cols, CONFIG.board.rows], state: sess.state, cover, mode, settings };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked: play on without saving */
  }
}

const saved = loadGame();
/** The battle's settings; a saved game brings its own, a new one starts from the last used. */
// A game saved before a rule existed gets that rule's default.
let settings: Settings = saved?.settings ? { ...saved.settings, options: { ...DADS_RULES, ...saved.settings.options } } : loadSettings();
applySettings(settings);
let sess: Session = startSession(saved?.state ?? newGame());
/** The "New battle" screen, shown after picking how to play. */
let setupOpen = false;
let selected: string | null = null;
let lang: Lang = loadLang();
let message: string | null = null;
let rolling = false;
let rollFaces: number[] = [];
let confirmNew = false;
/** First press of End turn with points left only warns; the second press ends the turn. */
let confirmEnd = false;
let lastPoints = 0;
let menuOpen = false;
/** Pass-the-phone screen: shown whenever the other player must look away. */
// A game reopened during secret setup always starts behind the cover, so nothing leaks.
let mode: Mode = saved?.mode === 'ai' ? 'ai' : 'pvp';
let cover = saved ? saved.cover || (mode === 'pvp' && (saved.state.phase === 'draft' || saved.state.phase === 'deploy')) : false;
/** The "how do you want to play" screen: first launch and every new game. */
let choosing = !saved;
let aiTimer: number | null = null;
const aiTurn = (s: GameState) => mode === 'ai' && s.current === AI_SIDE && s.phase !== 'over' && setupPhase(s) === false;
let draft: ArmyCounts = {};
let tray: UnitTypeId | null = null;
/** What the last render showed, so the next one can animate what changed. */
let prevLog = sess.state.log.length;
let prevPos = new Map<string, Hex>(sess.state.units.map((u) => [u.id, u.pos]));

const isPortrait = () => window.innerHeight > window.innerWidth;
let portrait = isPortrait();
/** Wide landscape screens get a permanent side panel instead of the ☰ drawer. */
const isDesktop = () => window.innerWidth >= 1000 && window.innerHeight >= 560 && !isPortrait();
let desktop = isDesktop();
/** Desktop side panel shown or tucked away (board full width); remembered per device. */
const PANEL_KEY = 'boc-panel';
let panelOpen = (() => {
  try {
    return localStorage.getItem(PANEL_KEY) !== 'hidden';
  } catch {
    return true;
  }
})();
const withPanel = () => desktop && panelOpen;

/** Camera: how far the board is turned (yaw, radians) and tilted (pitch 0..1); remembered per device. */
const CAM_KEY = 'boc-cam';
const CAM_DEFAULT: Camera = { yaw: 0, pitch: 0.6, zoom: 1, x: null, y: null };
let cam: Camera = (() => {
  try {
    const c = JSON.parse(localStorage.getItem(CAM_KEY) ?? 'null');
    return typeof c?.yaw === 'number' && typeof c?.pitch === 'number'
      ? { ...CAM_DEFAULT, yaw: c.yaw, pitch: c.pitch, zoom: typeof c.zoom === 'number' ? c.zoom : 1 }
      : { ...CAM_DEFAULT };
  } catch {
    return { ...CAM_DEFAULT };
  }
})();
function saveCam() {
  try {
    localStorage.setItem(CAM_KEY, JSON.stringify(cam));
  } catch {
    /* keep the camera for this visit only */
  }
}
const clampPitch = (p: number) => Math.min(1, Math.max(0, p));

/** The camera turn that puts this side's army at the bottom of the screen, enemy at the top. */
function yawFor(p: Player): number {
  // Portrait already shows Novgorod at the bottom; landscape has it on the left.
  const novgorodBottom = portrait ? 0 : -Math.PI / 2;
  return p === 'red' ? novgorodBottom : novgorodBottom + Math.PI;
}

/** Two players on one device:
 *  'pass'   = they hand it over; the board turns to face whoever's turn it is.
 *  'across' = it lies flat between them. On the far player's turn the camera swings round to
 *             their side and the whole screen turns 180°, so the board stays where it lies on
 *             the phone while each player gets the 3D view from their own seat. */
type Table = 'pass' | 'across';
const TABLE_KEY = 'boc-table';
let table: Table = (() => {
  try {
    return localStorage.getItem(TABLE_KEY) === 'across' ? 'across' : 'pass';
  } catch {
    return 'pass';
  }
})();
let facedFor: Player | null = null;
const acrossTable = () => mode === 'pvp' && table === 'across';
/** Across the table, the far player (Teutonic Order, sitting opposite) sees the screen turned round. */
const upsideDown = () => acrossTable() && sideShown === 'blue';
/** Whose seat the screen currently faces across the table; it catches up with the turn by a
 *  tilt over the top (see tiltOver), so the board never spins round. */
let sideShown: Player = sess.state.current;
/** During the tilt-over, the camera tilt being shown instead of the player's own. */
let tiltShown: number | null = null;
/** The drawing area's size in pixels: the board picture is drawn to fill it exactly. */
let stageSize: [number, number] = [window.innerWidth, Math.max(300, window.innerHeight * 0.7)];
const view = () => {
  const c = tiltShown === null ? cam : { ...cam, pitch: tiltShown };
  return { portrait, tilt, cam: upsideDown() ? { ...c, yaw: c.yaw + Math.PI } : c, vw: stageSize[0], vh: stageSize[1] };
};

/** Across the table, a new turn tips the camera down flat, swaps to the other player's seat at
 *  the flat point (where both seats see the same picture), then tips back up for them. */
let tilting = false;
function tiltOver(to: Player) {
  if (tilting) return;
  tilting = true;
  const top = cam.pitch;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const run = (from: number, end: number, ms: number, done: () => void) => {
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      tiltShown = from + (end - from) * ease(t);
      camFrame();
      if (t < 1) setTimeout(step, 16);
      else done();
    };
    step();
  };
  run(top, 0, 320, () => {
    sideShown = to;
    render();
    run(0, top, 380, () => {
      tiltShown = null;
      tilting = false;
      camDone();
    });
  });
}
/** Screen directions are reversed for the far player, whose screen is turned round. */
const flipSign = () => (upsideDown() ? -1 : 1);

/** 2.5D board (tilted, pieces standing) or the flat map; remembered per device. */
const VIEW_KEY = 'boc-view';
let tilt = (() => {
  try {
    return localStorage.getItem(VIEW_KEY) !== 'flat';
  } catch {
    return true;
  }
})();
/** Steps for the + / − buttons; pinching can stop anywhere between the first and last. */
const [ZOOM_MIN, ZOOM_MAX] = [0.7, 10];

type Buyable = keyof ArmyCounts;
/** The side to move's faction decides what it can buy and what the pieces list shows. */
const buyOrder = () => rosterOf(sess.state.current) as Buyable[];
const TRAY_ORDER: UnitTypeId[] = ['king', 'heavyCavalry', 'lightCavalry', 'horseArcher', 'heavyInfantry', 'samurai', 'lightInfantry', 'ashigaru', 'archer'];

// ---------- view helpers ----------

const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function die(face: number | null, spin: boolean): string {
  const on = face ? PIPS[face] ?? [] : [];
  const cells = Array.from({ length: 9 }, (_, i) => `<i class="${on.includes(i) ? 'on' : ''}"></i>`).join('');
  return `<div class="die ${spin ? 'spin' : ''} ${face ? '' : 'blank'}">${cells}</div>`;
}

/** Coloured stat chips, always in the same order: attack, defense, move, range. */
function stats(type: UnitTypeId, defenseLeft?: number): string {
  const r = CONFIG.units[type];
  const full = maxHp(type);
  const def = defenseLeft === undefined ? `${full}` : `${defenseLeft}/${full}`;
  return `<span class="stats">
    <span class="st atk" title="${t(lang, 'keyAtk')}"><i>${t(lang, 'tagAtk')}</i>${r.attack > 0 ? r.attack : '–'}</span>
    <span class="st def" title="${t(lang, 'keyDef')}"><i>${t(lang, 'tagDef')}</i>${def}</span>
    <span class="st mov" title="${t(lang, CONFIG.options.unitSpeeds ? 'keyMove' : 'keyMoveFlat')}"><i>${t(lang, 'tagMove')}</i>${CONFIG.options.unitSpeeds ? stepCost(type) : hexesPerPoint(type)}</span>
    ${r.ranged ? `<span class="st rng" title="${t(lang, 'keyRange')}"><i>${t(lang, 'tagRange')}</i>${r.ranged.minRange}–${r.ranged.maxRange}</span>` : ''}
  </span>`;
}

/** What the chip colours mean. */
function statKey(): string {
  return `<div class="key">
    <span><i class="st atk">${t(lang, 'tagAtk')}</i> ${t(lang, 'keyAtk')}</span>
    <span><i class="st def">${t(lang, 'tagDef')}</i> ${t(lang, 'keyDef')}</span>
    <span><i class="st mov">${t(lang, 'tagMove')}</i> ${t(lang, CONFIG.options.unitSpeeds ? 'keyMove' : 'keyMoveFlat')}</span>
    <span><i class="st rng">${t(lang, 'tagRange')}</i> ${t(lang, 'keyRange')}</span>
  </div>`;
}

function unitInfo(s: GameState, id: string): string {
  const u = getUnit(s, id);
  if (!u) return '';
  return `<b class="${u.owner}">${unitName(lang, u.type, u.owner)}</b> ${stats(u.type, u.hp)}`;
}

function previewText(s: GameState, targetId: string, p: AttackPreview): string {
  const target = getUnit(s, targetId)!;
  const what = p.kind === 'attack' ? t(lang, 'attack') : t(lang, 'shoot');
  const end = p.kills ? `, ${t(lang, 'kills')}` : ` (${t(lang, 'hp')} ${target.hp} → ${p.hpAfter})`;
  const back = p.counter ? ` · ${t(lang, 'spearsBack')} −${p.counter}` : '';
  return `${what}: ${unitName(lang, target.type, target.owner).toLowerCase()} −${p.damage} ${t(lang, 'hp')}${end} · ${t(lang, 'cost')} ${p.cost}${back}`;
}

const setupPhase = (s: GameState) => s.phase === 'draft' || s.phase === 'deploy';

function overlay(s: GameState): Overlay {
  const own = selected ? getUnit(s, selected) : undefined;
  const mine = own && own.owner === s.current && s.phase === 'act';
  const targets = new Map<string, AttackPreview>();
  if (mine) for (const x of strikeTargets(s, own.id)) if (!targets.has(x.targetId) && (!aiAim || x.targetId === aiAim)) targets.set(x.targetId, x.preview);
  const battle = s.phase === 'act' || s.phase === 'roll';
  return {
    selected,
    reach: mine && !aiAim ? reachable(s, own.id) : new Map(),
    targets,
    zone: s.phase === 'deploy' ? { owner: s.current, hexes: zoneHexes(s, s.current) } : null,
    // During setup the other side's army stays secret.
    hide: setupPhase(s) ? other(s.current) : null,
    spent: s.phase === 'act' ? spentUnits(s) : new Set(),
    trail: battle ? lastEnemyTurn(s) : { moves: [], kills: [] },
    rings: own && CONFIG.units[own.type].ranged && !setupPhase(s) ? shotZone(s, own) : [],
    danger: dangerOn && battle ? threatZone(s) : [],
    route: mine && pending ? routeTo(s, own.id, pending) : [],
  };
}

/** On a touch screen the first tap on a hex shows the route and its cost; a second tap moves. */
let pending: Hex | null = null;
/** The enemy the computer is about to hit, ringed on the board for a moment first. */
let aiAim: string | null = null;

/** Threat view: every hex the other side could attack or shoot next turn with an average
 *  roll (10 points), so you can see where it's safe to stand. */
let dangerOn = false;
const AVERAGE_ROLL = 10;
function threatZone(s: GameState): Hex[] {
  const them = other(s.current);
  const theirTurn: GameState = { ...s, current: them, phase: 'act', points: AVERAGE_ROLL, advance: null };
  const hit = new Map<string, Hex>();
  const add = (h: Hex) => {
    if (h.row >= 0 && h.col >= 0 && h.row < s.board.length && h.col < s.board[0].length) hit.set(key(h), h);
  };
  for (const u of s.units.filter((x) => x.owner === them)) {
    const r = CONFIG.units[u.type];
    const stands = [{ hex: u.pos, cost: 0 }, ...reachable(theirTurn, u.id).values()];
    for (const { hex, cost } of stands) {
      const left = AVERAGE_ROLL - cost;
      if (r.attack > 0 && left >= CONFIG.combat.attackCost) for (const n of neighbors(hex)) add(n);
      if (r.ranged && left >= r.ranged.cost) {
        for (let row = hex.row - r.ranged.maxRange; row <= hex.row + r.ranged.maxRange; row++)
          for (let col = hex.col - r.ranged.maxRange; col <= hex.col + r.ranged.maxRange; col++) {
            const h = { col, row };
            const d = distance(hex, h);
            if (d >= r.ranged.minRange && d <= r.ranged.maxRange && row >= 0 && col >= 0 && row < s.board.length && col < s.board[0].length && hasLineOfSight(s, hex, h)) add(h);
          }
      }
    }
  }
  return [...hit.values()];
}

/** Next piece: select your next piece that can still do something, and point the camera at it. */
function nextPiece() {
  const s = sess.state;
  if (s.phase !== 'act') return;
  const spent = spentUnits(s);
  const ready = s.units.filter((u) => u.owner === s.current && !spent.has(u.id)).sort((a, b) => a.pos.col - b.pos.col || a.pos.row - b.pos.row);
  if (!ready.length) return;
  const i = ready.findIndex((u) => u.id === selected);
  const u = ready[(i + 1) % ready.length];
  selected = u.id;
  const [x, y] = hexOnMap(u.pos, { portrait });
  cam = { ...cam, x, y };
  saveCam();
  message = null;
  render();
}

/** The side to move's pieces with no move and no hit left for the points remaining. */
function spentUnits(s: GameState): Set<string> {
  const out = new Set<string>();
  for (const u of s.units) {
    if (u.owner !== s.current) continue;
    if (reachable(s, u.id).size === 0 && strikeTargets(s, u.id).length === 0) out.add(u.id);
  }
  return out;
}

/** Moves and kills from the other side's most recent turn, read from the log. */
function lastEnemyTurn(s: GameState) {
  const them = other(s.current);
  const moves: { from: Hex; to: Hex }[] = [];
  const kills: Hex[] = [];
  let i = s.log.length - 1;
  while (i >= 0 && s.log[i].player === s.current) i--; // skip what this side has done so far
  for (; i >= 0 && s.log[i].player === them; i--) {
    const e = s.log[i];
    if (e.kind === 'move') moves.push({ from: e.from, to: e.to });
    if ((e.kind === 'attack' || e.kind === 'shoot') && e.killed) kills.push(e.at);
  }
  return { moves, kills };
}

/** Every hex an archer could shoot at from where it stands: in range and not behind forest. */
function shotZone(s: GameState, u: Unit): Hex[] {
  const r = CONFIG.units[u.type].ranged!;
  const out: Hex[] = [];
  for (let row = 0; row < s.board.length; row++)
    for (let col = 0; col < s.board[0].length; col++) {
      const h = { col, row };
      const d = distance(u.pos, h);
      if (d >= r.minRange && d <= r.maxRange && hasLineOfSight(s, u.pos, h)) out.push(h);
    }
  return out;
}

function legendList(owner: Player): string {
  return (['king', ...rosterOf(owner)] as UnitTypeId[]).map(
    (type) => `<li>${unitIcon(type, owner)}<div><b>${unitName(lang, type, owner)}</b>${stats(type)}</div></li>`,
  ).join('');
}

// ---------- screens ----------

/** The whole army as small pieces, grouped by type: shown at the bottom of the builder. */
function armyPreview(owner: Player): string {
  const total = 1 + buyOrder().reduce((a, t2) => a + (draft[t2] ?? 0), 0);
  const groups = (['king', ...buyOrder()] as UnitTypeId[])
    .map((type) => {
      const n = type === 'king' ? 1 : draft[type as Buyable] ?? 0;
      return n ? `<span class="group">${Array.from({ length: n }, () => unitIcon(type, owner)).join('')}</span>` : '';
    })
    .join('');
  return `<div class="army-head"><b>${t(lang, 'yourArmy')}</b><span>${total} ${t(lang, 'piecesN')}</span></div><div class="army-pieces">${groups}</div>`;
}

/** Slider track: gold up to the value, pale up to what the budget still allows. */
function sliderFill(type: Buyable): string {
  const price = CONFIG.army.cost[type];
  const max = Math.floor(CONFIG.army.budget / price);
  const n = draft[type] ?? 0;
  const reach = n + Math.floor((CONFIG.army.budget - armyCost(draft)) / price);
  return `--v:${(n / max) * 100}%;--r:${(Math.min(reach, max) / max) * 100}%`;
}

/** Live update while a slider is dragged: rebuilding the sheet would cancel the drag. */
function onSlide(input: HTMLInputElement) {
  const type = input.dataset.type as Buyable;
  const price = CONFIG.army.cost[type];
  const others = armyCost({ ...draft, [type]: 0 });
  const n = Math.min(Number(input.value), Math.floor((CONFIG.army.budget - others) / price));
  if (Number(input.value) !== n) input.value = String(n);
  if ((draft[type] ?? 0) === n) return;
  draft = { ...draft, [type]: n };
  const owner = sess.state.current;
  const row = app.querySelector(`[data-row="${type}"]`)!;
  row.querySelector('.count')!.textContent = String(n);
  app.querySelector('#army')!.innerHTML = armyPreview(owner);
  const left = CONFIG.army.budget - armyCost(draft);
  app.querySelector('#left')!.textContent = String(left);
  (app.querySelector('#meter') as HTMLElement).style.width = `${((CONFIG.army.budget - left) / CONFIG.army.budget) * 100}%`;
  for (const t2 of buyOrder()) {
    const r = app.querySelector(`[data-row="${t2}"]`)!;
    (r.querySelector('input') as HTMLInputElement).style.cssText = sliderFill(t2);
    (r.querySelector('[data-act="less"]') as HTMLButtonElement).disabled = !(draft[t2] ?? 0);
    (r.querySelector('[data-act="more"]') as HTMLButtonElement).disabled = CONFIG.army.cost[t2] > left;
  }
  sound('tick');
}

function draftSheet(s: GameState): string {
  const spent = armyCost(draft);
  const left = CONFIG.army.budget - spent;
  const rows = buyOrder().map((type) => {
    const n = draft[type] ?? 0;
    const price = CONFIG.army.cost[type];
    return `<li data-row="${type}">
      ${unitIcon(type, s.current)}
      <b class="name">${unitName(lang, type, s.current)}</b>
      <span class="price" title="${t(lang, 'power')}">${price}<small>${t(lang, 'pts')}</small></span>
      <output class="count">${n}</output>
      ${stats(type)}
      <div class="slide">
        <button data-act="less" data-type="${type}" ${n ? '' : 'disabled'} aria-label="−">−</button>
        <input type="range" id="sl-${type}" data-type="${type}" min="0" max="${Math.floor(CONFIG.army.budget / price)}" step="1" value="${n}" aria-label="${unitName(lang, type, s.current)}" style="${sliderFill(type)}">
        <button data-act="more" data-type="${type}" ${price <= left ? '' : 'disabled'} aria-label="+">+</button>
      </div>
    </li>`;
  }).join('');
  return `<div class="sheet ${s.current}">
    <div class="sheet-body">
      <h2><span class="dot ${s.current}"></span>${playerName(lang, s.current)}: ${t(lang, 'build')}</h2>
      <div class="budget"><b id="left">${left}</b> / ${CONFIG.army.budget} ${t(lang, 'pointsLeft')}
        <div class="meter"><i id="meter" style="width:${(spent / CONFIG.army.budget) * 100}%"></i></div></div>
      <div class="sheet-scroll">
      <ul class="buy">
        <li class="king">${unitIcon('king', s.current)}<b class="name">${unitName(lang, 'king', s.current)}<span class="free">${t(lang, 'kingFree')}</span></b><span class="price free-badge">0<small>${t(lang, 'pts')}</small></span><output class="count">1</output>${stats('king')}</li>
        ${rows}
      </ul>
      ${statKey()}
      </div>
      <div class="sheet-foot">
        <div class="army" id="army">${armyPreview(s.current)}</div>
        ${message ? `<p class="error">${message}</p>` : ''}
        <div class="row">
          <button data-act="auto-army">${t(lang, 'autoArmy')}</button>
          <button data-act="auto-all">${t(lang, 'autoAll')}</button>
        </div>
        <button data-act="draft" class="primary wide">${t(lang, 'toDeploy')} →</button>
      </div>
    </div>
  </div>`;
}

/** The optional rules as shown on the New battle screen, with the value each switches to. */
const RULES: { key: keyof Settings['options']; on: Settings['options'][keyof Settings['options']] }[] = [
  { key: 'toughness', on: 2 },
  { key: 'unitSpeeds', on: true },
  { key: 'routAt', on: 0.5 },
  { key: 'shieldWall', on: true },
  { key: 'spears', on: true },
  { key: 'charge', on: true },
  { key: 'kingAura', on: true },
  { key: 'zoneOfControl', on: true },
  { key: 'stepMoves', on: true },
  { key: 'kingsGuard', on: true },
  { key: 'flanking', on: true },
  { key: 'longShotFrom', on: 3 },
  { key: 'volleys', on: 6 },
  { key: 'carryMax', on: 3 },
  { key: 'rerolls', on: 1 },
  { key: 'firstTurnBonus', on: 2 },
];

/** Which side's army the New battle screen is choosing, and whether the detailed rules are open. */
let pickSide: Player = 'red';
let rulesOpen = false;

/** Small white glyphs (24 x 24) for the rule rows, drawn on a coloured square. */
const RULE_ICON: Record<keyof Settings['options'], string> = {
  toughness: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  shieldWall: '<path d="M3 5h8v5q0 5-4 7q-4-2-4-7zM13 5h8v5q0 5-4 7q-4-2-4-7z"/>',
  spears: '<path d="M5 19L17 7M17 7l3-3-1 5zM8 19l-3 0 0-3" fill="none"/>',
  charge: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  kingAura: '<path d="M5 15V8l3.5 3L12 6l3.5 5L19 8v7z"/><path d="M3 19h18" fill="none"/>',
  unitSpeeds: '<path d="M4 17h4l3-8 3 8h6" fill="none"/><circle cx="6" cy="8" r="2.2"/>',
  runLimit: '<circle cx="12" cy="13" r="8" fill="none"/><path d="M12 13l4-4M10 3h4" fill="none"/>',
  zoneOfControl: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" fill="none"/><path d="M8 12h8" fill="none"/>',
  longShotFrom: '<circle cx="12" cy="12" r="8" fill="none"/><circle cx="12" cy="12" r="3"/>',
  volleys: '<path d="M6 21L18 3M9 21L21 3M3 21L15 3" fill="none"/>',
  carryMax: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" fill="none"/>',
  firstTurnBonus: '<path d="M12 5v14M5 12h14" fill="none"/>',
  routAt: '<path d="M6 21V3M6 4h11l-3 4 3 4H6" />',
  flanking: '<path d="M3 7l6 5-6 5M21 7l-6 5 6 5" fill="none"/><circle cx="12" cy="12" r="2.5"/>',
  stepMoves: '<path d="M5 19h4v-4h4v-4h4V7h3" fill="none"/>',
  rerolls: '<path d="M19 8a8 8 0 1 0 1 6" fill="none"/><path d="M20 3v5h-5"/>',
  kingsGuard: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" fill="none"/><path d="M8.5 13.5V10l2 1.5L12 9l1.5 2.5 2-1.5v3.5z"/>',
};

const RULE_GROUPS: { title: Key; color: string; keys: (keyof Settings['options'])[] }[] = [
  { title: 'groupCombat', color: '#c2453a', keys: ['toughness', 'flanking', 'shieldWall', 'spears', 'charge', 'kingAura', 'kingsGuard'] },
  { title: 'groupRanged', color: '#3f8f5a', keys: ['longShotFrom', 'volleys'] },
  { title: 'groupMove', color: '#3a6fb0', keys: ['stepMoves', 'unitSpeeds', 'zoneOfControl'] },
  { title: 'groupTurn', color: '#a8811a', keys: ['routAt', 'carryMax', 'rerolls', 'firstTurnBonus'] },
];

/** A tiny picture of each map type for the map tiles. */
function mapThumb(m: MapId): string {
  const tree = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="3.2" fill="#2f5a22"/>`;
  const inner =
    m === 'river'
      ? `<rect x="33" y="0" width="6" height="44" fill="#4f8fc4"/><rect x="31" y="9" width="10" height="4" fill="#8a6038"/><rect x="31" y="31" width="10" height="4" fill="#8a6038"/>${tree(14, 12)}${tree(58, 32)}`
      : m === 'open'
        ? `${tree(20, 30)}${tree(52, 14)}`
        : m === 'forest'
          ? [[10, 10], [20, 22], [12, 34], [30, 12], [42, 30], [52, 10], [62, 24], [56, 36], [28, 34]].map(([x, y]) => tree(x, y)).join('')
          : `<text x="36" y="30" text-anchor="middle" font-size="22" font-weight="700" fill="#f1e8d2">?</text>`;
  return `<svg viewBox="0 0 72 44" width="72" height="44" aria-hidden="true"><rect width="72" height="44" rx="6" fill="#6f9a4a"/>${inner}</svg>`;
}

function setupScreen(): string {
  const seg = (field: string, values: [string, string][], current: string) =>
    `<div class="seg" role="radiogroup">${values
      .map(([v, label]) => `<button role="radio" data-act="set" data-field="${field}" data-value="${v}" class="${v === current ? 'on' : ''}" aria-checked="${v === current}">${label}</button>`)
      .join('')}</div>`;
  const isDad = RULES.every((r) => settings.options[r.key] === DADS_RULES[r.key]);
  const isRec = RULES.every((r) => settings.options[r.key] === RECOMMENDED[r.key]);
  const onCount = RULES.filter((r) => settings.options[r.key] !== DADS_RULES[r.key]).length;

  // The face-off: each side's coat of arms, name and who plays it. Tap one to pick its army.
  const side = (p: Player, who: string) => {
    const f = FACTIONS[settings.sides[p]];
    const on = pickSide === p;
    return `<button data-act="pick-side" data-side="${p}" class="vs-card ${on ? 'on' : ''}" aria-pressed="${on}" style="--fc:${f.color}">
      <span class="vs-who">${who}</span>${f.emblem}<b>${f.name[lang]}</b></button>`;
  };
  const tiles = FACTION_ORDER.map((id) => {
    const f = FACTIONS[id];
    const mine = settings.sides[pickSide] === id;
    const theirs = settings.sides[other(pickSide)] === id;
    return `<button data-act="faction" data-side="${pickSide}" data-value="${id}" class="ftile ${mine ? 'on' : ''} ${theirs ? 'taken' : ''}" aria-pressed="${mine}" style="--fc:${f.color}">
      ${f.emblem}<span>${f.name[lang]}</span></button>`;
  }).join('');

  const mapTiles = (['river', 'open', 'forest', 'random'] as MapId[])
    .map((m) => {
      const label = t(lang, `map${m[0].toUpperCase()}${m.slice(1)}` as Key);
      return `<button data-act="set" data-field="map" data-value="${m}" class="mtile ${settings.map === m ? 'on' : ''}" aria-pressed="${settings.map === m}">${mapThumb(m)}<span>${label}</span></button>`;
    })
    .join('');

  const preset = (value: string, on: boolean, title: string, sub: string, icon: string) =>
    `<button data-act="preset" data-value="${value}" class="preset ${on ? 'on' : ''}" aria-pressed="${on}">
      <span class="picon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22">${icon}</svg></span>
      <b>${title}</b><small>${sub}</small></button>`;

  const groups = RULE_GROUPS.map((g) => `
      <div class="rgroup"><h4>${t(lang, g.title)}</h4><div class="rlist">${g.keys
        .map((k) => {
          const on = settings.options[k] !== DADS_RULES[k];
          return `<button data-act="opt" data-key="${k}" class="rule ${on ? 'on' : ''}" role="switch" aria-checked="${on}">
            <span class="ricon" style="background:${g.color}" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18">${RULE_ICON[k]}</svg></span>
            <span class="what"><b>${t(lang, `rule_${k}` as Key)}</b><small>${t(lang, `ruleHelp_${k}` as Key)}</small></span>
            <span class="switch" aria-hidden="true"><i></i></span>
          </button>`;
        })
        .join('')}</div></div>`).join('');

  return `<div class="sheet"><div class="sheet-body setup">
    <h2><button data-act="setup-back" class="ghost back" aria-label="${t(lang, 'back')}">${icon('back')}</button>${t(lang, 'newBattle')}</h2>
    <div class="sheet-scroll">
      <div class="vs">
        ${side('red', mode === 'ai' ? t(lang, 'sideYou') : t(lang, 'sideFirst'))}
        <span class="vs-mid">${t(lang, 'vs')}</span>
        ${side('blue', mode === 'ai' ? t(lang, 'sideComputer') : t(lang, 'sideSecond'))}
      </div>
      <div class="ftiles">${tiles}</div>
      <p class="blurb">${FACTIONS[settings.sides[pickSide]].blurb[lang]}</p>

      <h3>${t(lang, 'map')}</h3>
      <div class="mtiles">${mapTiles}</div>

      <h3>${t(lang, 'armyPoints')}</h3>
      ${seg('budget', [['20', `20 <small>${t(lang, 'skirmish')}</small>`], ['30', '30'], ['50', '50'], ['80', `80 <small>${t(lang, 'epic')}</small>`]], String(settings.budget))}

      <h3>${t(lang, 'pointsEachTurn')}</h3>
      ${seg('dice', [['1d6', t(lang, 'dice1')], ['2d6', t(lang, 'dice2')], ['3d6', t(lang, 'dice3')], ['fixed', `${t(lang, 'always')} ${fixedPoints(settings)}`]], settings.dice)}

      <h3>${t(lang, 'rules')}</h3>
      <div class="presets">
        ${preset('dad', isDad, t(lang, 'presetDad'), t(lang, 'presetSimpleSub'), '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/>')}
        ${preset('recommended', isRec, t(lang, 'presetRecommended'), t(lang, 'presetRecSub'), '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" fill="currentColor"/>')}
      </div>
      <button data-act="rules-open" class="disclose ${rulesOpen ? 'open' : ''}" aria-expanded="${rulesOpen}">
        <span>${t(lang, 'customize')}</span><small>${!isDad && !isRec ? `${t(lang, 'presetCustom')} · ` : ''}${onCount} ${t(lang, 'rulesOnCount')}</small><i aria-hidden="true">›</i>
      </button>
      ${rulesOpen ? `<div class="rgroups">${groups}</div>` : ''}
    </div>
    <div class="sheet-foot"><button data-act="begin" class="primary wide">${t(lang, 'startBattle')}</button></div>
  </div></div>`;
}

/** The game's mark (same as the app icon): a shield split crimson and black, crown and cross. */
const LOGO = `<svg viewBox="0 0 60 70" width="96" height="112" aria-hidden="true">
  <defs><clipPath id="logo-clip"><path d="M4 4H56V30Q56 56 30 66Q4 56 4 30Z"/></clipPath></defs>
  <g clip-path="url(#logo-clip)"><rect x="0" y="0" width="30" height="70" fill="#a8201a"/><rect x="30" y="0" width="30" height="70" fill="#1b1b1d"/></g>
  <path d="M4 4H56V30Q56 56 30 66Q4 56 4 30Z" fill="none" stroke="#e1b12c" stroke-width="3"/>
  <path d="M10 33V25L13.5 28.5L17 22L20.5 28.5L24 25V33Z" fill="#e1b12c"/>
  <path d="M40 22H46V26.5H50.5V32.5H46V37H40V32.5H35.5V26.5H40Z" fill="#f4f1e8"/>
</svg>`;

function startScreen(): string {
  const pick = (l: Lang, label: string) =>
    `<button data-act="set-lang" data-lang="${l}" class="${lang === l ? 'on' : ''}" aria-pressed="${lang === l}">${label}</button>`;
  const icon = (d: string) => `<span class="cicon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22">${d}</svg></span>`;
  const people = '<circle cx="8" cy="8" r="3.2"/><circle cx="16.5" cy="8" r="3.2"/><path d="M2.5 19c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2zM11.5 19c.5-3 2.4-5.2 5-5.2 2.7 0 4.6 1.8 5.2 5.2z"/>';
  const robot = '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="3.5" r="1.6"/><circle cx="9.3" cy="13.5" r="1.5" fill="var(--panel-2)"/><circle cx="14.7" cy="13.5" r="1.5" fill="var(--panel-2)"/>';
  return `<div class="cover"><div class="card start">
    <div class="seg langs" role="radiogroup">${pick('en', 'English')}${pick('ru', 'Русский')}</div>
    <div class="hero">
      <div class="logo">${LOGO}</div>
      <h2>${t(lang, 'title')}</h2>
      <p>${t(lang, 'chooseMode')}</p>
    </div>
    <button data-act="mode" data-mode="pvp" class="choice">${icon(people)}<span class="ctext"><b>${t(lang, 'twoPlayers')}</b><span>${t(lang, 'twoPlayersSub')}</span></span><i aria-hidden="true">›</i></button>
    <button data-act="mode" data-mode="ai" class="choice">${icon(robot)}<span class="ctext"><b>${t(lang, 'vsComputer')}</b><span>${t(lang, 'vsComputerSub')}</span></span><i aria-hidden="true">›</i></button>
  </div></div>`;
}

/** The end of a battle: the winner's banner, how it was won, and the battle in numbers. */
function victory(s: GameState, w: Player): string {
  const sides: Player[] = [w, other(w)];
  const stat = { kills: { red: 0, blue: 0 }, damage: { red: 0, blue: 0 } };
  const killsBy = new Map<UnitTypeId, number>();
  for (const e of s.log) {
    if (e.kind !== 'attack' && e.kind !== 'shoot') continue;
    stat.damage[e.player] += e.damage;
    if (e.killed) {
      stat.kills[e.player] += 1;
      if (e.player === w) killsBy.set(e.unit, (killsBy.get(e.unit) ?? 0) + 1);
    }
  }
  const best = [...killsBy].sort((a, b) => b[1] - a[1])[0];
  const left = (p: Player) => s.units.filter((u) => u.owner === p).length;
  const row = (label: string, f: (p: Player) => number) =>
    `<div class="vrow"><b>${f(sides[0])}</b><span>${label}</span><b>${f(sides[1])}</b></div>`;
  return `<div class="cover victory ${w}"><div class="card ${w}">
    <div class="vbanner"><div class="vrays" aria-hidden="true"></div><div class="vemblem">${factionOf(w).emblem}</div></div>
    <p class="small">${t(lang, 'victory')}</p>
    <h2 class="${w}">${playerName(lang, w)}</h2>
    <p>${reasonText(lang, s.winReason!)}<br>${t(lang, 'onTurn')} ${s.turn}.</p>
    <div class="vstats">
      <div class="vrow vhead"><span class="vcrest">${factionOf(sides[0]).emblem}</span><span></span><span class="vcrest">${factionOf(sides[1]).emblem}</span></div>
      ${row(t(lang, 'statKills'), (p) => stat.kills[p])}
      ${row(t(lang, 'statDamage'), (p) => stat.damage[p])}
      ${row(t(lang, 'statLeft'), left)}
    </div>
    ${best ? `<p class="vbest">${t(lang, 'bestFighter')}: <b>${unitName(lang, best[0], w)}</b> · ${best[1]} ${t(lang, best[1] === 1 ? 'killOne' : 'killMany')}</p>` : ''}
    <button data-act="restart" class="primary wide">${t(lang, 'newGame')}</button>
    <button data-act="see-board" class="ghost wide">${t(lang, 'seeBoard')}</button>
  </div></div>`;
}

/** The winner's screen can be put away to look at the final board. */
let overHidden = false;

function passScreen(s: GameState): string {
  if (s.phase === 'roll') {
    return `<div class="cover"><div class="card">
      <div class="emblem">${factionOf('red').emblem}<span class="hero-vs">${t(lang, 'vs')}</span>${factionOf('blue').emblem}</div>
      <h2>${t(lang, 'battle')}</h2>
      <p>${t(lang, 'battleText')} <b class="${s.current}">${playerName(lang, s.current)}</b>.</p>
      <button data-act="ack" class="primary wide">${t(lang, 'startBattle')}</button>
    </div></div>`;
  }
  return `<div class="cover ${s.current}"><div class="card">
    <div class="emblem">${factionOf(s.current).emblem}</div>
    <p class="small">${t(lang, 'handTo')}</p>
    <h2 class="${s.current}">${playerName(lang, s.current)}</h2>
    <p>${playerName(lang, other(s.current))} — ${t(lang, 'noPeek')}</p>
    <button data-act="ack" class="primary wide">${t(lang, 'imReady')}</button>
  </div></div>`;
}

/** Settings, the pieces list and the log: in the ☰ drawer on phones, always visible on desktop. */
function menuBody(s: GameState): string {
  const log = s.log
    .filter((e) => e.kind !== 'endTurn')
    .slice()
    .reverse()
    .map((e) => `<li><span class="dot ${e.player}"></span><span class="tn">${e.turn}</span>${logText(lang, e)}</li>`)
    .join('');
  // iOS-style settings rows: a coloured icon, a name, and the current value or a switch.
  const row = (act: string, color: string, glyph: string, title: string, value = '', sw?: boolean, cls = '') =>
    `<button data-act="${act}" class="mrow ${cls}"${sw === undefined ? '' : ` role="switch" aria-checked="${sw}"`}>
      <span class="ricon" style="background:${color}" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18">${glyph}</svg></span>
      <span class="mtitle">${title}</span>
      ${sw === undefined ? `<span class="mval">${value}</span><i aria-hidden="true">›</i>` : `<span class="switch ${sw ? 'is-on' : ''}" aria-hidden="true"><i></i></span>`}
    </button>`;
  const G = {
    globe: '<circle cx="12" cy="12" r="8.5" fill="none"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17" fill="none"/>',
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="none"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" fill="none"/>',
    target: '<circle cx="12" cy="12" r="7" fill="none"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" fill="none"/>',
    seats: '<circle cx="12" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><rect x="7" y="10" width="10" height="4" rx="1" fill="none"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9c1.5 1.5 1.5 4.5 0 6M18.5 6.5c3 3 3 8 0 11" fill="none"/>',
    bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
    plus: '<path d="M12 5v14M5 12h14" fill="none"/>',
  };
  return `<div class="mgroup">
      ${row('lang', '#3a6fb0', G.globe, t(lang, 'rowLanguage'), lang === 'en' ? 'English' : 'Русский')}
      ${row('view', '#7a5bb0', G.cube, t(lang, 'rowView'), tilt ? t(lang, 'view25') : t(lang, 'viewFlatShort'))}
      ${row('cam-reset', '#5b6b7a', G.target, t(lang, 'camResetMenu'))}
      ${mode === 'pvp' ? row('table', '#a8811a', G.seats, t(lang, 'rowSeating'), table === 'pass' ? t(lang, 'seatPass') : t(lang, 'seatAcross')) : ''}
      ${row('mute', '#3f8f5a', G.sound, t(lang, 'rowSound'), '', !isMuted())}
    </div>
    <div class="mgroup">
      ${row('quick', '#c2453a', G.bolt, t(lang, 'quick'))}
      ${row('new', '#c2453a', G.plus, confirmNew ? t(lang, 'confirmNew') : t(lang, 'newGame'), '', undefined, confirmNew ? 'danger' : '')}
    </div>
    <section><h3>${t(lang, 'pieces')}</h3><ul class="legend">${legendList(s.current)}</ul>${statKey()}<p class="note">${t(lang, 'legendNote')}</p></section>
    <section><h3>${t(lang, 'log')}</h3><ol class="log">${log || `<li class="empty">${t(lang, 'emptyLog')}</li>`}</ol></section>
    ${desktop ? `<p class="keys">${t(lang, 'keys')}</p>` : ''}`;
}

function menu(s: GameState): string {
  return `<div class="drawer-bg" data-act="menu"></div>
  <aside class="drawer">
    <div class="drawer-head"><b>${t(lang, 'title')}</b><button data-act="menu" class="ghost">${t(lang, 'close')}</button></div>
    ${menuBody(s)}
  </aside>`;
}

/** One icon family for the game's buttons: 24-point grid, 2.2 stroke, round ends. */
const ICON = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a5 5 0 0 1 0 10h-3"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  flip: '<path d="M7 4v16M7 4L3.5 7.5M7 4l3.5 3.5M17 20V4M17 20l-3.5-3.5M17 20l3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  reroll: '<path d="M19 8a8 8 0 1 0 1 6"/><path d="M20 3v5h-5"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/>',
};
const icon = (name: keyof typeof ICON) =>
  `<svg class="ic" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

function bar(s: GameState): string {
  if (aiTurn(s)) return `<div class="row"><p class="thinking">${playerName(lang, s.current)} ${t(lang, 'thinking')}</p></div>`;
  if (s.phase === 'deploy') {
    const left = s.reserve[s.current];
    if (!tray || !left.includes(tray)) tray = TRAY_ORDER.find((x) => left.includes(x)) ?? null;
    const chips = TRAY_ORDER.filter((x) => left.includes(x))
      .map((x) => `<button data-act="tray" data-type="${x}" class="chip ${x === tray ? 'on' : ''}">${unitIcon(x, s.current)}<span>×${left.filter((y) => y === x).length}</span></button>`)
      .join('');
    return `<div class="tray">${chips}</div>
      <div class="row">
        <button data-act="auto" ${left.length ? '' : 'disabled'}>${t(lang, 'autoPlace')}</button>
        <button data-act="done" class="primary" ${left.length ? 'disabled' : ''}>${t(lang, 'done')} →</button>
      </div>`;
  }
  if (s.phase === 'over' && overHidden) return `<div class="row"><button data-act="show-result">${t(lang, 'result')}</button><button data-act="restart" class="primary">${t(lang, 'newGame')}</button></div>`;
  if (s.phase === 'roll') return `<div class="row"><button data-act="roll" class="primary" ${rolling ? 'disabled' : ''}>${t(lang, 'roll')}</button></div>`;
  if (s.phase === 'act') {
    const take = s.advance
      ? `<div class="row"><button data-act="take" class="primary">${t(lang, 'takeHex')}</button></div>`
      : '';
    return `${take}<div class="row">
      ${canReroll(s) ? `<button data-act="reroll" class="withicon" ${rolling ? 'disabled' : ''}>${icon('reroll')}<span>${t(lang, 'reroll')}</span></button>` : ''}
      <button data-act="undo" class="withicon" ${canUndo(sess) ? '' : 'disabled'}>${icon('undo')}<span>${t(lang, 'undo')}</span></button>
      <button data-act="end" class="${s.advance ? '' : 'primary'} ${confirmEnd ? 'warn' : ''}">${confirmEnd ? t(lang, 'endAnyway') : t(lang, 'endTurn')}</button>
    </div>`;
  }
  return '';
}

// ---------- render ----------

/** Re-rendering replaces the board, so keep where the player had scrolled the zoomed map to. */
function render() {
  const list = app.querySelector<HTMLElement>('.sheet-scroll')?.scrollTop ?? 0;
  draw();
  // The board is drawn to the stage's exact size; if the layout changed it, draw once more.
  const stage = app.querySelector<HTMLElement>('.stage');
  if (stage && stage.clientWidth > 0 && (stage.clientWidth !== stageSize[0] || stage.clientHeight !== stageSize[1])) {
    stageSize = [stage.clientWidth, stage.clientHeight];
    stage.innerHTML = renderBoard(sess.state, overlay(sess.state), view(), NO_EFFECTS);
  }
  const sheet = app.querySelector<HTMLElement>('.sheet-scroll');
  if (sheet) sheet.scrollTop = list;
}

/** Zoom by a factor about a screen point (pixels inside the stage), keeping the ground under it still. */
function zoomAt(factor: number, X: number, Y: number) {
  const before = screenToGround(view(), X, Y);
  cam = { ...cam, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom * factor)) };
  const after = screenToGround(view(), X, Y);
  moveTarget(before[0] - after[0], before[1] - after[1]);
}

/** Slide what the camera looks at across the map, keeping it over the board. */
function moveTarget(dx: number, dy: number) {
  const [fw, fh] = mapSize(portrait);
  cam = {
    ...cam,
    x: Math.min(fw, Math.max(0, (cam.x ?? fw / 2) + dx)),
    y: Math.min(fh, Math.max(0, (cam.y ?? fh / 2) + dy)),
  };
}

/** Moves the picture by a screen distance, the way a finger drags the ground in a maps app. */
function panBy(dX: number, dY: number) {
  const [cx, cy] = [stageSize[0] / 2, stageSize[1] / 2];
  const a = screenToGround(view(), cx, cy);
  const b = screenToGround(view(), cx - dX, cy - dY);
  moveTarget(b[0] - a[0], b[1] - a[1]);
}

/** Zoom buttons: zoom on the selected piece if there is one, else on the middle of the screen. */
function setZoom(factor: number) {
  const u = selected ? getUnit(sess.state, selected) : undefined;
  if (u) {
    const [x, y] = hexOnMap(u.pos, { portrait });
    cam = { ...cam, x, y };
  }
  zoomAt(factor, stageSize[0] / 2, stageSize[1] / 2);
  saveCam();
  render();
}

/** Pieces that fire guns, and which gunshot they make. */
const GUN_SOUND: Partial<Record<UnitTypeId, 'pistol' | 'rifle'>> = { gunslinger: 'pistol', cowboy: 'pistol', rifleman: 'rifle' };

/** Effects and sounds for log entries added since the last render. */
function effects(s: GameState): Effects {
  const fresh: LogEntry[] = s.log.length > prevLog ? s.log.slice(prevLog) : [];
  const fx: Effects = { from: fresh.length ? prevPos : new Map(), hits: [], walks: new Map() };
  for (const e of fresh) {
    if (e.kind === 'move' && e.path?.length) {
      // The piece now standing where the move ended walks the route hex by hex.
      const u = s.units.find((x) => x.pos.col === e.to.col && x.pos.row === e.to.row);
      if (u) fx.walks.set(u.id, [e.from, ...e.path]);
    }
    if (e.kind === 'attack' || e.kind === 'shoot') {
      fx.hits.push({ at: e.at, damage: e.damage, killed: e.killed, type: e.target, owner: other(e.player), shotFrom: e.kind === 'shoot' ? e.from : null, by: e.unit, from: e.from, advanced: !!e.advanced });
      // Timed to the board's animation: the blow lands at the same moment the hit flashes.
      const gun = e.kind === 'shoot' && GUN_SOUND[e.unit];
      let lands = 0.14;
      if (gun) (sound(gun), (lands = 0.22));
      else if (e.kind === 'shoot') (sound('bow'), sound('thunk', 0.42), (lands = 0.42));
      else sound('clash', 0.1);
      if (e.killed) sound('death', lands + 0.15);
    } else if (e.kind === 'move') {
      // A footstep (or hoofbeat) for every hex walked, in time with the piece.
      const hoof = !!CONFIG.units[e.unit]?.mounted;
      const steps = Math.max(1, e.path?.length ?? 1);
      for (let i = 0; i < steps; i++) sound(hoof ? 'hoof' : 'step', (i * STEP_MS) / 1000);
    } else if (e.kind === 'win') setTimeout(() => sound(mode === 'ai' && e.player === AI_SIDE ? 'lose' : 'win'), 400);
  }
  prevLog = s.log.length;
  prevPos = new Map(s.units.map((u) => [u.id, u.pos]));
  return fx;
}

let drawnPortrait = portrait;
function draw() {
  const s = sess.state;
  if (isPortrait() !== drawnPortrait) {
    // The flat map turns with the screen, so aim back at the middle of the board.
    drawnPortrait = isPortrait();
    cam = { ...cam, x: null, y: null };
  }
  // Across the table: tip the camera over to the player whose turn it now is.
  if (acrossTable() && sideShown !== s.current && !tilting) {
    if (setupPhase(s) || !tilt) sideShown = s.current;
    else setTimeout(() => tiltOver(s.current), 0);
  }
  if (!acrossTable()) sideShown = s.current;
  // Two players passing the phone: swing the board round when the turn changes hands.
  if (mode === 'pvp' && table === 'pass' && !setupPhase(s) && facedFor !== s.current) {
    facedFor = s.current;
    cam = { ...cam, yaw: yawFor(s.current) };
    saveCam();
  }
  const fx = effects(s);
  portrait = isPortrait();
  desktop = isDesktop();
  const faces = rolling ? rollFaces : s.dice;
  const bump = s.points !== lastPoints ? 'bump' : '';
  lastPoints = s.points;
  const battle = !setupPhase(s);

  let info = message ?? '';
  if (!info) {
    if (s.phase === 'deploy') info = t(lang, 'deployHint');
    else if (s.advance) info = `${t(lang, 'takeHex')}, ${t(lang, 'orKeep')}`;
    else if (s.phase === 'roll') info = `${playerName(lang, s.current)}: ${t(lang, 'rollFirst')}`;
    else if (selected) info = unitInfo(s, selected);
    else if (s.phase === 'act') info = `${t(lang, 'pickUnit')}. ${t(lang, 'help')}`;
  }

  const right = battle
    ? `<div class="points ${bump}"><b>${s.points}</b><span>${t(lang, 'points')}</span></div>`
    : s.phase === 'deploy'
      ? `<div class="points"><b>${s.reserve[s.current].length}</b><span>${t(lang, 'left')}</span></div>`
      : '';

  if (s.phase !== 'over') overHidden = false;
  // The result stays put while a new battle is being set up on top of the finished one.
  const over = s.phase === 'over' && s.winner && !overHidden && !choosing && !setupOpen ? victory(s, s.winner) : '';

  app.innerHTML = `
    <div class="screen ${portrait ? 'portrait' : 'landscape'} ${withPanel() ? 'desktop' : desktop ? 'full' : portrait ? '' : 'phone'} ${message ? 'has-msg' : ''} ${s.current} ${upsideDown() ? 'flipped' : ''}">
      <header class="hud">
        <div class="who"><span class="crest">${factionOf(s.current).emblem}</span><span>${playerName(lang, s.current)}<small>${battle ? `${t(lang, 'turn')} ${s.turn}` : t(lang, 'setup')}</small></span></div>
        <div class="dice">${battle ? [0, 1, 2].slice(0, CONFIG.dice.count).map((i) => die(faces?.[i] ?? null, rolling)).join('') : ''}</div>
        ${right}
        ${desktop ? `<button data-act="fullscreen" class="ghost icon" title="${t(lang, 'fullscreen')}" aria-label="${t(lang, 'fullscreen')}">${icon('expand')}</button>
          <button data-act="panel" class="ghost icon" title="${panelOpen ? t(lang, 'hidePanel') : t(lang, 'showPanel')}" aria-label="${panelOpen ? t(lang, 'hidePanel') : t(lang, 'showPanel')}">${icon('panel')}</button>` : ''}
        ${withPanel() ? '' : `<button data-act="menu" class="ghost icon" aria-label="${t(lang, 'menu')}">${icon('menu')}</button>`}
      </header>
      <div class="stage-wrap">
        <div class="stage">${renderBoard(s, overlay(s), view(), fx)}</div>
        <div class="viewcube" title="${t(lang, 'cubeHelp')}" aria-label="${t(lang, 'cubeHelp')}">${viewCube(view())}</div>
        <div class="cam" aria-label="${t(lang, 'camera')}">
          <button data-act="cam-flip" title="${t(lang, 'camFlip')}" aria-label="${t(lang, 'camFlip')}">${icon('flip')}</button>
        </div>
        <div class="zoom">
          <button data-act="zoom-in" aria-label="Zoom in" ${cam.zoom >= ZOOM_MAX - 0.01 ? 'disabled' : ''}>${icon('plus')}</button>
          <button data-act="zoom-out" aria-label="Zoom out" ${cam.zoom <= ZOOM_MIN + 0.01 ? 'disabled' : ''}>${icon('minus')}</button>
        </div>
      </div>
      <p class="info" id="info">${info}</p>
      <footer class="bar">${bar(s)}</footer>
      ${withPanel() ? `<aside class="side">${menuBody(s)}</aside>` : ''}
    </div>
    ${s.phase === 'draft' && !cover && !choosing && !setupOpen ? draftSheet(s) : ''}
    ${cover && s.phase !== 'over' && !choosing && !setupOpen ? passScreen(s) : ''}
    ${choosing ? startScreen() : ''}
    ${setupOpen ? setupScreen() : ''}
    ${over}
    ${menuOpen && !withPanel() ? menu(s) : ''}`;
  app.classList.toggle('upside', upsideDown());
  document.documentElement.lang = lang;
  document.title = t(lang, 'title');
  saveGame();
  scheduleAi();
  scheduleRoll();
}

/** A new turn rolls its own dice after a short beat, so the handover is visible first. */
let rollTimer: number | null = null;
function scheduleRoll() {
  const s = sess.state;
  if (rollTimer !== null || rolling || cover || choosing || s.phase !== 'roll' || aiTurn(s)) return;
  rollTimer = window.setTimeout(() => {
    rollTimer = null;
    const st = sess.state;
    if (!rolling && !cover && !choosing && st.phase === 'roll' && !aiTurn(st)) roll(selected);
  }, 600);
}

// ---------- computer opponent ----------

/** The computer builds and places its army at once (the player never sees it happen). */
function aiSetup() {
  const steps: ((s: GameState) => Result)[] = [(s) => draftArmy(s, suggestArmy(Math.random, CONFIG, rosterOf(s.current) as Buyable[])), (s) => autoDeploy(s), (s) => finishDeploy(s)];
  for (const step of steps) {
    const { sess: next, result } = apply(sess, step, true);
    if (!result.ok) return;
    sess = next;
  }
}

/** On the computer's turn, take one step every so often so the player can follow it. */
function scheduleAi() {
  const s = sess.state;
  if (aiTimer !== null || rolling || cover || choosing || !aiTurn(s)) return;
  // Each computer attack gets its own beat: the target is marked first, then the hit lands,
  // so a volley never looks like one click doing several attacks at once.
  const next = s.phase === 'act' ? aiNextAction(s) : null;
  const strike = next && (next.kind === 'attack' || next.kind === 'shoot');
  if (strike) {
    aiAim = next.targetId;
    selected = next.unitId;
    message = `${playerName(lang, s.current)}: ${unitName(lang, getUnit(s, next.unitId)!.type, s.current)} → ${unitName(lang, getUnit(s, next.targetId)!.type, other(s.current)).toLowerCase()}`;
  }
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    aiAim = null;
    const st = sess.state;
    if (rolling || cover || choosing || !aiTurn(st)) return;
    if (st.phase === 'roll') return roll();
    const a = aiNextAction(st);
    if (a) {
      run((x) => applyAi(x, a));
      if (a.kind === 'attack' || a.kind === 'shoot') selected = null;
    } else run((x) => endTurn(x), true);
  }, s.phase === 'roll' ? 700 : strike ? 1300 : Math.max(650, 350 + walkTime(s)));
  // Drawn after the timer is set, so this render doesn't schedule a second move.
  if (strike) render();
}

/** How long the last move's walk takes to play, in ms (the computer waits for it). */
function walkTime(s: GameState): number {
  const e = s.log[s.log.length - 1];
  return e?.kind === 'move' && e.path ? e.path.length * STEP_MS : 0;
}

// ---------- actions ----------

function run(act: (s: GameState) => Result, checkpoint = false): boolean {
  const { sess: next, result } = apply(sess, act, checkpoint);
  sess = next;
  message = result.ok ? null : errorText(lang, result.error);
  if (result.ok) autoEndIfDone();
  render();
  return result.ok;
}

/** When the player can't do anything more (no points, or none their pieces can use), the
 *  turn ends by itself after a moment, so the last move is seen and can still be undone. */
function autoEndIfDone() {
  const s = sess.state;
  if (s.phase !== 'act' || s.advance || aiTurn(s)) return;
  const mine = s.units.filter((u) => u.owner === s.current).length;
  if (s.points > 0 && spentUnits(s).size < mine) return;
  const at = s;
  message = t(lang, 'outOfPoints');
  setTimeout(() => {
    // Only if nothing happened meanwhile (an undo, for example, cancels it).
    if (sess.state !== at) return;
    selected = null;
    run((st) => endTurn(st), true);
  }, 1400);
}

function restart(state: GameState) {
  sess = startSession(state);
  selected = null;
  message = null;
  draft = {};
  tray = null;
  confirmNew = false;
  menuOpen = false;
  choosing = false;
  cover = mode === 'pvp' && state.phase === 'draft';
  render();
}

/** Rolls the dice. `keep` is a piece the player tapped before rolling: it stays selected. */
function roll(keep: string | null = null) {
  if (rolling || sess.state.phase !== 'roll') return;
  rolling = true;
  sound('dice');
  selected = keep;
  message = null;
  const spin = () => (rollFaces = Array.from({ length: CONFIG.dice.count }, () => 1 + Math.floor(Math.random() * CONFIG.dice.sides)));
  spin();
  render();
  const timer = setInterval(() => {
    spin();
    const dice = app.querySelector('.dice');
    if (dice) dice.innerHTML = rollFaces.map((f) => die(f, true)).join('');
  }, 80);
  setTimeout(() => {
    clearInterval(timer);
    rolling = false;
    rolledAt = Date.now();
    run((s) => rollDice(s), true);
  }, 700);
}

let rolledAt = 0;

/** Throws the dice again (optional rule): the same spin as a roll, and it can't be undone. */
function rerollDice() {
  // A double tap on Roll dice must not spend the reroll: ignore it for a moment after the roll lands.
  if (rolling || !canReroll(sess.state) || Date.now() - rolledAt < 600) return;
  rolling = true;
  sound('dice');
  selected = null;
  message = null;
  const spin = () => (rollFaces = Array.from({ length: CONFIG.dice.count }, () => 1 + Math.floor(Math.random() * CONFIG.dice.sides)));
  spin();
  render();
  const timer = setInterval(() => {
    spin();
    const dice = app.querySelector('.dice');
    if (dice) dice.innerHTML = rollFaces.map((f) => die(f, true)).join('');
  }, 80);
  setTimeout(() => {
    clearInterval(timer);
    rolling = false;
    run((s) => reroll(s), true);
  }, 700);
}

function onDeployHex(s: GameState, hex: { col: number; row: number }) {
  const u = unitAt(s, hex);
  if (u && u.owner === s.current) {
    tray = u.type;
    run((st) => liftUnit(st, u.id));
  } else if (tray) {
    const type = tray;
    run((st) => placeUnit(st, type, hex));
  }
}

function onHex(col: number, row: number) {
  const s = sess.state;
  if (rolling || s.phase === 'over' || cover || choosing || setupOpen || aiTurn(s)) return;
  const hex = { col, row };
  if (s.phase === 'deploy') return onDeployHex(s, hex);
  if (s.phase === 'draft') return;
  const u = unitAt(s, hex);
  // Tapping one of your pieces before rolling rolls the dice for you and keeps it selected.
  if (s.phase === 'roll' && u && u.owner === s.current) return roll(u.id);
  const own = selected ? getUnit(s, selected) : undefined;

  if (own && own.owner === s.current && s.phase === 'act') {
    if (u && u.owner !== own.owner) {
      const hit = strikeTargets(s, own.id).find((x) => x.targetId === u.id);
      if (hit) return void run((st) => (hit.preview.kind === 'attack' ? attack(st, own.id, u.id) : shoot(st, own.id, u.id)));
      // Explain why not, then show the enemy's stats.
      const why = CONFIG.units[own.type].ranged ? shoot(s, own.id, u.id) : attack(s, own.id, u.id);
      message = !why.ok ? `${errorText(lang, why.error)} ${unitInfo(s, u.id)}` : null;
      return render();
    }
    if (!u) {
      const reach = reachable(s, own.id).get(key(hex));
      if (reach) {
        pending = null;
        return void run((st) => moveUnit(st, own.id, hex));
      }
      selected = null;
      message = null;
      return render();
    }
  }
  selected = u ? (u.id === selected ? null : u.id) : null;
  pending = null;
  message = null;
  render();
}

app.addEventListener('click', (e) => {
  const el = e.target as Element;
  const hex = el.closest('[data-col]');
  if (hex) confirmEnd = false;
  if (!hex) pending = null;
  if (hex) return onHex(Number(hex.getAttribute('data-col')), Number(hex.getAttribute('data-row')));
  const btn = el.closest('[data-act]');
  const act = btn?.getAttribute('data-act');
  if (!act) return;
  const type = btn!.getAttribute('data-type') as UnitTypeId | null;
  if (act !== 'new') confirmNew = false;
  if (act !== 'end') confirmEnd = false;
  switch (act) {
    case 'ack':
      if (sess.state.phase === 'roll') sound('horn');
      cover = false;
      message = null;
      return render();
    case 'more':
    case 'less': {
      const b = type as Buyable;
      const n = Math.max(0, (draft[b] ?? 0) + (act === 'more' ? 1 : -1));
      const next = { ...draft, [b]: n };
      if (armyCost(next) <= CONFIG.army.budget) draft = next;
      message = null;
      return render();
    }
    case 'draft':
      if (run((s) => draftArmy(s, draft))) draft = {};
      return;
    case 'tray':
      tray = type;
      return render();
    case 'auto':
      return void run((s) => autoDeploy(s));
    case 'done':
      if (run((s) => finishDeploy(s), true)) {
        if (mode === 'ai' && sess.state.current === AI_SIDE) aiSetup();
        cover = true;
        tray = null;
        render();
      }
      return;
    case 'auto-army':
      draft = suggestArmy(Math.random, CONFIG, buyOrder());
      message = null;
      return render();
    case 'auto-all': {
      // Build a balanced army, place it in formation and hand over, all in one tap.
      draft = suggestArmy(Math.random, CONFIG, buyOrder());
      if (!run((s) => draftArmy(s, draft))) return;
      draft = {};
      run((s) => autoDeploy(s));
      if (run((s) => finishDeploy(s), true)) {
        if (mode === 'ai' && sess.state.current === AI_SIDE) aiSetup();
        cover = true;
        tray = null;
        render();
      }
      return;
    }
    case 'setup-back':
      // Picked the wrong mode: back to "how do you want to play?".
      setupOpen = false;
      choosing = true;
      return render();
    case 'mode':
      mode = btn!.getAttribute('data-mode') === 'ai' ? 'ai' : 'pvp';
      choosing = false;
      setupOpen = true;
      settings = loadSettings();
      return render();
    case 'set': {
      // One choice on the New battle screen: army points, map or points per turn.
      const field = btn!.getAttribute('data-field');
      const value = btn!.getAttribute('data-value')!;
      if (field === 'budget') settings = { ...settings, budget: Number(value) };
      if (field === 'map') settings = { ...settings, map: value as MapId };
      if (field === 'dice') settings = { ...settings, dice: value as DiceId };
      return render();
    }
    case 'faction': {
      // Both sides can't lead the same army: picking the other side's faction swaps them.
      const side = btn!.getAttribute('data-side') as Player;
      const f = btn!.getAttribute('data-value') as FactionId;
      const otherSide = other(side);
      const sidesNext = { ...settings.sides, [side]: f };
      if (settings.sides[otherSide] === f) sidesNext[otherSide] = settings.sides[side];
      settings = { ...settings, sides: sidesNext };
      return render();
    }
    case 'pick-side':
      pickSide = btn!.getAttribute('data-side') as Player;
      return render();
    case 'rules-open':
      rulesOpen = !rulesOpen;
      return render();
    case 'preset':
      settings = { ...settings, options: { ...(btn!.getAttribute('data-value') === 'recommended' ? RECOMMENDED : DADS_RULES) } };
      return render();
    case 'opt': {
      const k = btn!.getAttribute('data-key') as keyof Settings['options'];
      const rule = RULES.find((r) => r.key === k)!;
      const on = settings.options[k] !== DADS_RULES[k];
      settings = { ...settings, options: { ...settings.options, [k]: on ? DADS_RULES[k] : rule.on } };
      return render();
    }
    case 'begin':
      setupOpen = false;
      saveSettings(settings);
      applySettings(settings);
      return restart(newGame());
    case 'take':
      return void run((s) => takeHex(s));
    case 'roll':
      return aiTurn(sess.state) ? undefined : roll();
    case 'reroll':
      return aiTurn(sess.state) ? undefined : rerollDice();
    case 'undo':
      sess = undo(sess);
      message = null;
      if (selected && !getUnit(sess.state, selected)) selected = null;
      return render();
    case 'end': {
      // Ending with points left that could still be used asks once before ending.
      const s = sess.state;
      const canStillAct = s.units.some((u) => u.owner === s.current) && spentUnits(s).size < s.units.filter((u) => u.owner === s.current).length;
      if (!confirmEnd && s.points > 0 && canStillAct) {
        confirmEnd = true;
        message = `${t(lang, 'pointsLeftWarn').replace('{n}', String(s.points))}`;
        sound('tick');
        return render();
      }
      confirmEnd = false;
      selected = null;
      return void run((st) => endTurn(st), true);
    }
    case 'next':
      return nextPiece();
    case 'danger':
      dangerOn = !dangerOn;
      message = dangerOn ? t(lang, 'threatHelp') : null;
      return render();
    case 'cam-flip':
      // Turn the board half way round; press again to turn it back.
      cam = { ...cam, yaw: cam.yaw + Math.PI };
      saveCam();
      return render();
    case 'table':
      table = table === 'pass' ? 'across' : 'pass';
      // Across the table starts from Novgorod's side; the far player's turn adds the half turn.
      if (table === 'across') cam = { ...cam, yaw: yawFor('red') };
      try {
        localStorage.setItem(TABLE_KEY, table);
      } catch {
        /* keep the choice for this visit only */
      }
      facedFor = null;
      return render();
    case 'cam-reset':
      cam = { ...CAM_DEFAULT };
      saveCam();
      return render();
    case 'zoom-in':
    case 'zoom-out': {
      return setZoom(act === 'zoom-in' ? 1.4 : 1 / 1.4);
    }
    case 'menu':
      menuOpen = !menuOpen;
      return render();
    case 'set-lang':
    case 'lang':
      lang = act === 'set-lang' ? (btn!.getAttribute('data-lang') === 'ru' ? 'ru' : 'en') : lang === 'ru' ? 'en' : 'ru';
      try {
        localStorage.setItem(LANG_KEY, lang);
      } catch {
        /* storage unavailable: keep the choice for this visit only */
      }
      message = null;
      return render();
    case 'panel':
      panelOpen = !panelOpen;
      try {
        localStorage.setItem(PANEL_KEY, panelOpen ? 'open' : 'hidden');
      } catch {
        /* keep the choice for this visit only */
      }
      return render();
    case 'fullscreen':
      // Real full screen where the browser allows it (not on iPhone Safari).
      if (document.fullscreenElement) void document.exitFullscreen?.();
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      return;
    case 'view':
      tilt = !tilt;
      try {
        localStorage.setItem(VIEW_KEY, tilt ? 'tilt' : 'flat');
      } catch {
        /* keep the choice for this visit only */
      }
      return render();
    case 'mute':
      toggleMute();
      sound('tick');
      return render();
    case 'quick':
      return restart(quickStart());
    case 'new':
      if (!confirmNew && sess.state.log.length + sess.state.units.length > 0) {
        confirmNew = true;
        return render();
      }
      confirmNew = false;
      menuOpen = false;
      choosing = true;
      return render();
    case 'restart':
      choosing = true;
      overHidden = false;
      return render();
    case 'show-result':
      overHidden = false;
      return render();
    case 'see-board':
      overHidden = true;
      return render();
  }
});

app.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.type === 'range' && el.dataset.type) onSlide(el);
});

// Desktop: hovering a target shows the attack preview in the info line.
app.addEventListener('mouseover', (e) => {
  const hex = (e.target as Element).closest('[data-col]');
  const info = document.getElementById('info');
  if (!hex || !info || !selected) return;
  const s = sess.state;
  const u = unitAt(s, { col: Number(hex.getAttribute('data-col')), row: Number(hex.getAttribute('data-row')) });
  const p = u && overlay(s).targets.get(u.id);
  if (u && p) info.innerHTML = previewText(s, u.id, p);
});

// ---------- camera moves without a full re-render ----------
// While the camera moves only the board is redrawn, once per frame, with the highlights
// frozen as they were when the move began.

let camOverlay: Overlay | null = null;
let camQueued = false;
function camFrame() {
  if (!camOverlay) camOverlay = overlay(sess.state);
  if (camQueued) return;
  camQueued = true;
  requestAnimationFrame(() => {
    camQueued = false;
    const st = app.querySelector<HTMLElement>('.stage');
    if (!st || !camOverlay) return;
    // On iPhone the rest of a touch goes to the exact element the finger first landed on; if
    // that element left the page the gesture would stop. So the board drawn when the move
    // began stays in place, invisible, and each frame only swaps the live copy drawn over it.
    let anchor = st.querySelector<SVGElement>('svg.board.anchor');
    if (!anchor) {
      anchor = st.querySelector<SVGElement>('svg.board');
      anchor?.classList.add('anchor');
    }
    const tmp = document.createElement('div');
    tmp.innerHTML = renderBoard(sess.state, camOverlay, view(), NO_EFFECTS);
    const live = tmp.firstElementChild as SVGElement;
    live.classList.add('live');
    const old = st.querySelector('svg.board.live');
    if (old) old.replaceWith(live);
    else st.append(live);
    const cube = app.querySelector('.viewcube');
    if (cube) cube.innerHTML = viewCube(view());
  });
}
function camDone() {
  camOverlay = null;
  saveCam();
  render();
}

/** A pointer position inside the stage, in the same pixels the board is drawn in. */
function stagePoint(clientX: number, clientY: number): [number, number] {
  const box = app.querySelector<HTMLElement>('.stage')!.getBoundingClientRect();
  // On a screen turned round for the far player, its own left/top are the page's right/bottom.
  return upsideDown() ? [box.right - clientX, box.bottom - clientY] : [clientX - box.left, clientY - box.top];
}

/** After a drag, the click that ends it must not move or select a piece. */
function swallowNextClick() {
  const stop = (ev: Event) => ev.stopPropagation();
  window.addEventListener('click', stop, { capture: true, once: true });
  // If the drag ended off the piece no click comes at all: don't eat the next real one.
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 60);
}

// ---------- touch: like a maps app ----------
// One finger drags the ground. Two fingers: pinch zooms about the fingers, twist orbits,
// sliding both up or down tilts. Each two-finger move only starts once it is clearly meant.

let touch:
  | { kind: 'one'; x: number; y: number; ground: [number, number]; moved: boolean }
  | { kind: 'two'; dist: number; angle: number; midY: number; zoom: number; yaw: number; pitch: number; live: Set<string> }
  | null = null;

const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const twist = (t: TouchList) => Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX);
const middle = (t: TouchList): [number, number] => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];

app.addEventListener(
  'touchstart',
  (e) => {
    if (!(e.target as Element).closest('.stage')) return;
    if (e.touches.length === 1) {
      const [x, y] = stagePoint(e.touches[0].clientX, e.touches[0].clientY);
      touch = { kind: 'one', x, y, ground: screenToGround(view(), x, y), moved: false };
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const [, midY] = middle(e.touches);
      touch = { kind: 'two', dist: spread(e.touches), angle: twist(e.touches), midY, zoom: cam.zoom, yaw: cam.yaw, pitch: cam.pitch, live: new Set() };
    }
  },
  { passive: false },
);

app.addEventListener(
  'touchmove',
  (e) => {
    if (!touch) return;
    if (touch.kind === 'one' && e.touches.length === 1) {
      const [x, y] = stagePoint(e.touches[0].clientX, e.touches[0].clientY);
      if (!touch.moved && Math.hypot(x - touch.x, y - touch.y) < 8) return;
      touch.moved = true;
      e.preventDefault();
      // Keep the same spot of ground under the finger.
      const now = screenToGround(view(), x, y);
      moveTarget(touch.ground[0] - now[0], touch.ground[1] - now[1]);
      return camFrame();
    }
    if (touch.kind === 'two' && e.touches.length === 2) {
      e.preventDefault();
      const ratio = spread(e.touches) / touch.dist;
      let turn = twist(e.touches) - touch.angle;
      if (turn > Math.PI) turn -= 2 * Math.PI;
      if (turn < -Math.PI) turn += 2 * Math.PI;
      const [mx, my] = middle(e.touches);
      const slide = (my - touch.midY) * flipSign();
      // Decide once what the two fingers are doing: sliding together up or down tilts;
      // spreading zooms; twisting turns (zoom and turn can mix, tilt stays on its own).
      if (!touch.live.size) {
        if (Math.abs(slide) > 12 && Math.abs(ratio - 1) < 0.1 && Math.abs(turn) < 0.12) touch.live.add('tilt');
        else {
          if (Math.abs(ratio - 1) > 0.05) touch.live.add('zoom');
          if (Math.abs(turn) > 0.1) touch.live.add('turn');
        }
      } else if (!touch.live.has('tilt')) {
        if (Math.abs(ratio - 1) > 0.05) touch.live.add('zoom');
        if (Math.abs(turn) > 0.1) touch.live.add('turn');
      }
      if (touch.live.has('zoom')) {
        const [px, py] = stagePoint(mx, my);
        zoomAt((touch.zoom * ratio) / cam.zoom, px, py);
      }
      if (touch.live.has('turn')) cam = { ...cam, yaw: touch.yaw + turn };
      if (touch.live.has('tilt') && tilt) cam = { ...cam, pitch: clampPitch(touch.pitch - slide * 0.005) };
      return camFrame();
    }
  },
  { passive: false },
);

app.addEventListener('touchend', (e) => {
  if (!touch) return;
  const moved = touch.kind === 'two' || touch.moved;
  if (e.touches.length === 0) {
    touch = null;
    if (moved) {
      e.preventDefault(); // no click after a drag
      camDone();
    }
  }
});

// Safari's own pinch gestures would zoom the page: stop them everywhere. On a Mac trackpad
// (no touch screen) Safari's two-finger rotate orbits the camera.
const touchScreen = 'ontouchstart' in window;
let gestureYaw = 0;
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(
    type,
    (e) => {
      e.preventDefault();
      if (touchScreen) return;
      const rotation = (e as Event & { rotation?: number }).rotation ?? 0;
      if (type === 'gesturestart') gestureYaw = cam.yaw;
      else if (type === 'gesturechange') {
        cam = { ...cam, yaw: gestureYaw + (rotation * Math.PI) / 180 };
        camFrame();
      } else camDone();
    },
    { passive: false },
  );
}

// ---------- trackpad and mouse wheel ----------
// Two-finger swipe slides the camera over the board; pinch (ctrl + wheel) zooms about the
// pointer; Option + swipe up / down zooms (Option + click-drag orbits, as in Maya). A mouse wheel's
// big, whole-line steps zoom instead, as in most 3D programs.
app.addEventListener(
  'wheel',
  (e) => {
    if (!(e.target as Element).closest('.stage')) return;
    e.preventDefault();
    const [px, py] = stagePoint(e.clientX, e.clientY);
    const unit = e.deltaMode === 1 ? 16 : 1;
    const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (e.ctrlKey) zoomAt(Math.exp(-e.deltaY / 100), px, py);
    else if (e.altKey) zoomAt(Math.exp((-e.deltaY * unit) / 300), px, py); // Option + swipe up/down zooms, as in Maya
    else if (mouseWheel) zoomAt(Math.exp((-e.deltaY * unit) / 500), px, py);
    else panBy(-e.deltaX * flipSign(), -e.deltaY * flipSign());
    camFrame();
    clearTimeout(wheelEnd);
    wheelEnd = window.setTimeout(camDone, 200);
  },
  { passive: false },
);
let wheelEnd = 0;

// ---------- mouse ----------
// Drag slides the camera over the ground; right-drag (or Shift / Option + drag) orbits and tilts.
let drag: { x: number; y: number; ground: [number, number]; moved: boolean; orbit: boolean; yaw: number; pitch: number } | null = null;
app.addEventListener('mousedown', (e) => {
  if (!(e.target as Element).closest('.stage') || (e.button !== 0 && e.button !== 2)) return;
  const [x, y] = stagePoint(e.clientX, e.clientY);
  const orbit = e.button === 2 || e.shiftKey || e.altKey;
  drag = { x, y, ground: screenToGround(view(), x, y), moved: false, orbit, yaw: cam.yaw, pitch: cam.pitch };
});
app.addEventListener('contextmenu', (e) => {
  if ((e.target as Element).closest('.stage')) e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!drag || !app.querySelector('.stage')) return;
  const [x, y] = stagePoint(e.clientX, e.clientY);
  if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 6) return;
  drag.moved = true;
  app.querySelector('.stage')?.classList.add('dragging');
  if (drag.orbit) {
    cam = { ...cam, yaw: drag.yaw - (x - drag.x) * 0.008, pitch: tilt ? clampPitch(drag.pitch - (y - drag.y) * 0.004) : cam.pitch };
  } else {
    const now = screenToGround(view(), x, y);
    moveTarget(drag.ground[0] - now[0], drag.ground[1] - now[1]);
  }
  camFrame();
});
window.addEventListener('mouseup', () => {
  if (drag?.moved) {
    app.querySelector('.stage')?.classList.remove('dragging');
    swallowNextClick();
    camDone();
  }
  drag = null;
});

// ---------- desktop: keyboard and drag-to-pan ----------

document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const click = (act: string) => app.querySelector<HTMLButtonElement>(`[data-act="${act}"]:not(:disabled)`)?.click();
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === 'z') {
    e.preventDefault();
    return click('undo');
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Space rolls when the dice are waiting, otherwise it ends the turn like Enter.
  if (k === 'r' || (k === ' ' && sess.state.phase === 'roll' && !app.querySelector('.cover [data-act="ack"]'))) {
    e.preventDefault();
    return click('roll');
  }
  if (k === ' ') e.preventDefault();
  if (k === 'enter' || k === 'e' || k === ' ') return click(app.querySelector('.cover [data-act="ack"]') ? 'ack' : sess.state.phase === 'deploy' ? 'done' : 'end');
  if (k === 'u') return click('undo');
  if (k === 'n' || k === 'tab') {
    e.preventDefault();
    return nextPiece();
  }
  if (k === 'h') return click('danger');
  if (k === 'p') return click('panel');
  // Camera keys: Q / W turn, Z / X tilt, C reset.
  const nudge = (yaw: number, pitch: number) => {
    cam = { ...cam, yaw: cam.yaw + yaw, pitch: tilt ? clampPitch(cam.pitch + pitch) : cam.pitch };
    saveCam();
    render();
  };
  if (k === 'q') return nudge(-Math.PI / 12, 0);
  if (k === 'w') return nudge(Math.PI / 12, 0);
  if (k === 'z') return nudge(0, -0.1);
  if (k === 'x') return nudge(0, 0.1);
  if (k === 'c') {
    cam = { ...CAM_DEFAULT };
    saveCam();
    return render();
  }
  if (k === 'v') return click('cam-flip');
  if (k === 'f') return click('fullscreen');
  if (k === 't') return click('take');
  if (k === 'a') return click(sess.state.phase === 'deploy' ? 'auto' : '');
  if (k.startsWith('arrow')) {
    e.preventDefault();
    const step = 80;
    panBy(k === 'arrowleft' ? step : k === 'arrowright' ? -step : 0, k === 'arrowup' ? step : k === 'arrowdown' ? -step : 0);
    saveCam();
    return render();
  }
  if (k === '+' || k === '=') return click('zoom-in');
  if (k === '-' || k === '_') return click('zoom-out');
  if (k === 'escape') {
    if (menuOpen) menuOpen = false;
    selected = null;
    message = null;
    return render();
  }
});

// ---------- view cube ----------
// Dragging the little cube in the corner orbits and tilts the camera, like Option + drag.
let cubeDrag: { x: number; y: number; yaw: number; pitch: number; id: number } | null = null;
app.addEventListener('pointerdown', (e) => {
  const cube = (e.target as Element).closest<HTMLElement>('.viewcube');
  if (!cube) return;
  e.preventDefault();
  try {
    cube.setPointerCapture(e.pointerId);
  } catch {
    /* keep going without capture */
  }
  cubeDrag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, id: e.pointerId };
});
app.addEventListener('pointermove', (e) => {
  if (!cubeDrag || e.pointerId !== cubeDrag.id) return;
  cam = {
    ...cam,
    yaw: cubeDrag.yaw + (e.clientX - cubeDrag.x) * flipSign() * 0.012,
    pitch: tilt ? clampPitch(cubeDrag.pitch + (e.clientY - cubeDrag.y) * flipSign() * 0.006) : cam.pitch,
  };
  camFrame();
});
const endCube = (e: PointerEvent) => {
  if (!cubeDrag || e.pointerId !== cubeDrag.id) return;
  cubeDrag = null;
  camDone();
};
app.addEventListener('pointerup', endCube);
app.addEventListener('pointercancel', endCube);

window.addEventListener('resize', () => {
  if (isDesktop() !== desktop && !rolling) return render();
  if (isPortrait() !== portrait && !rolling) render();
});

// Offline play and "Add to Home Screen" as an app (only for the published game).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => undefined);
}

render();

// Dev only: lets the test browser read and set the session (stripped from the built game).
if (import.meta.env.DEV) {
  (window as unknown as { boc: object }).boc = {
    get sess() { return sess; },
    set sess(v: typeof sess) { sess = v; render(); },
    get selected() { return selected; },
    get message() { return message; },
    set mode(m: typeof mode) { mode = m; },
    scheduleAi,
  };
}

/** When the game comes back on screen (or every few minutes), check whether a newer version has been put online:
 *  the page's script has a new name after every update, so a different name means reload to get it. A game in
 *  progress is saved, so the reload loses nothing. */
async function checkForUpdate() {
  if (import.meta.env.DEV) return;
  try {
    const html = await (await fetch('./', { cache: 'no-store' })).text();
    const live = html.match(/assets\/index-[\w-]+\.js/)?.[0];
    const mine = [...document.scripts].map((x) => x.src).find((src) => /assets\/index-[\w-]+\.js/.test(src));
    if (live && mine && !mine.includes(live)) location.reload();
  } catch {
    /* offline: keep playing this version */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkForUpdate();
});
setInterval(() => void checkForUpdate(), 5 * 60 * 1000);

