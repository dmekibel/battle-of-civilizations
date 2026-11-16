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
  moveUnit,
  newGame,
  other,
  placeUnit,
  quickStart,
  reachable,
  rollDice,
  shoot,
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
  type LogEntry,
  type Player,
  type Result,
  type Session,
} from '../engine';
import { NO_EFFECTS, renderBoard, type Camera, type Effects, type Overlay } from './board';
import { errorText, logText, playerName, reasonText, t, unitName, type Lang } from './i18n';
import { EMBLEM, unitIcon } from './symbols';
import { isMuted, sound, toggleMute } from './sound';

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
    const data: Saved = { board: [CONFIG.board.cols, CONFIG.board.rows], state: sess.state, cover, mode };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked: play on without saving */
  }
}

const saved = loadGame();
let sess: Session = startSession(saved?.state ?? newGame());
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
const CAM_DEFAULT: Camera = { yaw: 0, pitch: 0.75 };
let cam: Camera = (() => {
  try {
    const c = JSON.parse(localStorage.getItem(CAM_KEY) ?? 'null');
    return typeof c?.yaw === 'number' && typeof c?.pitch === 'number' ? c : { ...CAM_DEFAULT };
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

/** Optional: in a two-player game, turn the board to face whoever's turn it is. */
const FACE_KEY = 'boc-face';
let faceTurn = (() => {
  try {
    return localStorage.getItem(FACE_KEY) === '1';
  } catch {
    return false;
  }
})();
let facedFor: Player | null = null;
const view = () => ({ portrait, tilt, cam });

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
const ZOOMS = [1, 1.6, 2.4, 3.2];
const [ZOOM_MIN, ZOOM_MAX] = [ZOOMS[0], ZOOMS[ZOOMS.length - 1]];
let zoom = 1;

type Buyable = keyof ArmyCounts;
const BUY_ORDER: Buyable[] = ['lightInfantry', 'heavyInfantry', 'archer', 'lightCavalry', 'heavyCavalry'];
const TRAY_ORDER: UnitTypeId[] = ['king', 'heavyCavalry', 'lightCavalry', 'heavyInfantry', 'lightInfantry', 'archer'];
const LEGEND_ORDER: UnitTypeId[] = ['king', ...BUY_ORDER];

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
  const def = defenseLeft === undefined ? `${r.hp}` : `${defenseLeft}/${r.hp}`;
  return `<span class="stats">
    <span class="st atk" title="${t(lang, 'keyAtk')}"><i>${t(lang, 'tagAtk')}</i>${r.attack > 0 ? r.attack : '–'}</span>
    <span class="st def" title="${t(lang, 'keyDef')}"><i>${t(lang, 'tagDef')}</i>${def}</span>
    <span class="st mov" title="${t(lang, 'keyMove')}"><i>${t(lang, 'tagMove')}</i>${r.moveCost}</span>
    ${r.ranged ? `<span class="st rng" title="${t(lang, 'keyRange')}"><i>${t(lang, 'tagRange')}</i>${r.ranged.minRange}–${r.ranged.maxRange}</span>` : ''}
  </span>`;
}

/** What the chip colours mean. */
function statKey(): string {
  return `<div class="key">
    <span><i class="st atk">${t(lang, 'tagAtk')}</i> ${t(lang, 'keyAtk')}</span>
    <span><i class="st def">${t(lang, 'tagDef')}</i> ${t(lang, 'keyDef')}</span>
    <span><i class="st mov">${t(lang, 'tagMove')}</i> ${t(lang, 'keyMove')}</span>
    <span><i class="st rng">${t(lang, 'tagRange')}</i> ${t(lang, 'keyRange')}</span>
  </div>`;
}

function unitInfo(s: GameState, id: string): string {
  const u = getUnit(s, id);
  if (!u) return '';
  return `<b class="${u.owner}">${unitName(lang, u.type)}</b> ${stats(u.type, u.hp)}`;
}

function previewText(s: GameState, targetId: string, p: AttackPreview): string {
  const target = getUnit(s, targetId)!;
  const what = p.kind === 'attack' ? t(lang, 'attack') : t(lang, 'shoot');
  const end = p.kills ? `, ${t(lang, 'kills')}` : ` (${t(lang, 'hp')} ${target.hp} → ${p.hpAfter})`;
  return `${what}: ${unitName(lang, target.type).toLowerCase()} −${p.damage} ${t(lang, 'hp')}${end} · ${t(lang, 'cost')} ${p.cost}`;
}

const setupPhase = (s: GameState) => s.phase === 'draft' || s.phase === 'deploy';

function overlay(s: GameState): Overlay {
  const own = selected ? getUnit(s, selected) : undefined;
  const mine = own && own.owner === s.current && s.phase === 'act';
  const targets = new Map<string, AttackPreview>();
  if (mine) for (const x of strikeTargets(s, own.id)) if (!targets.has(x.targetId)) targets.set(x.targetId, x.preview);
  const battle = s.phase === 'act' || s.phase === 'roll';
  return {
    selected,
    reach: mine ? reachable(s, own.id) : new Map(),
    targets,
    zone: s.phase === 'deploy' ? { owner: s.current, hexes: zoneHexes(s, s.current) } : null,
    // During setup the other side's army stays secret.
    hide: setupPhase(s) ? other(s.current) : null,
    spent: s.phase === 'act' ? spentUnits(s) : new Set(),
    trail: battle ? lastEnemyTurn(s) : { moves: [], kills: [] },
    rings: own && CONFIG.units[own.type].ranged && !setupPhase(s) ? shotZone(s, own) : [],
  };
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
  return LEGEND_ORDER.map(
    (type) => `<li>${unitIcon(type, owner)}<div><b>${unitName(lang, type)}</b>${stats(type)}</div></li>`,
  ).join('');
}

// ---------- screens ----------

/** The whole army as small pieces, grouped by type: shown at the bottom of the builder. */
function armyPreview(owner: Player): string {
  const total = 1 + BUY_ORDER.reduce((a, t2) => a + (draft[t2] ?? 0), 0);
  const groups = (['king', ...BUY_ORDER] as UnitTypeId[])
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
  for (const t2 of BUY_ORDER) {
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
  const rows = BUY_ORDER.map((type) => {
    const n = draft[type] ?? 0;
    const price = CONFIG.army.cost[type];
    return `<li data-row="${type}">
      ${unitIcon(type, s.current)}
      <b class="name">${unitName(lang, type)}</b>
      <span class="price" title="${t(lang, 'power')}">${price}<small>${t(lang, 'pts')}</small></span>
      <output class="count">${n}</output>
      ${stats(type)}
      <div class="slide">
        <button data-act="less" data-type="${type}" ${n ? '' : 'disabled'} aria-label="−">−</button>
        <input type="range" id="sl-${type}" data-type="${type}" min="0" max="${Math.floor(CONFIG.army.budget / price)}" step="1" value="${n}" aria-label="${unitName(lang, type)}" style="${sliderFill(type)}">
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
        <li class="king">${unitIcon('king', s.current)}<b class="name">${unitName(lang, 'king')}<span class="free">${t(lang, 'kingFree')}</span></b><span class="price free-badge">0<small>${t(lang, 'pts')}</small></span><output class="count">1</output>${stats('king')}</li>
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

function startScreen(): string {
  const pick = (l: Lang, label: string) =>
    `<button data-act="set-lang" data-lang="${l}" class="${lang === l ? 'on' : ''}" aria-pressed="${lang === l}">${label}</button>`;
  return `<div class="cover"><div class="card start">
    <div class="langs">${pick('en', 'English')}${pick('ru', 'Русский')}</div>
    <div class="emblem">${EMBLEM.red}${EMBLEM.blue}</div>
    <h2>${t(lang, 'title')}</h2>
    <p>${t(lang, 'chooseMode')}</p>
    <button data-act="mode" data-mode="pvp" class="choice"><b>${t(lang, 'twoPlayers')}</b><span>${t(lang, 'twoPlayersSub')}</span></button>
    <button data-act="mode" data-mode="ai" class="choice"><b>${t(lang, 'vsComputer')}</b><span>${t(lang, 'vsComputerSub')}</span></button>
  </div></div>`;
}

function passScreen(s: GameState): string {
  if (s.phase === 'roll') {
    return `<div class="cover"><div class="card">
      <div class="emblem">${EMBLEM.red}${EMBLEM.blue}</div>
      <h2>${t(lang, 'battle')}</h2>
      <p>${t(lang, 'battleText')} <b class="${s.current}">${playerName(lang, s.current)}</b>.</p>
      <button data-act="ack" class="primary wide">${t(lang, 'startBattle')}</button>
    </div></div>`;
  }
  return `<div class="cover ${s.current}"><div class="card">
    <div class="emblem">${EMBLEM[s.current]}</div>
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
  return `<div class="drawer-buttons">
      <button data-act="lang">${t(lang, 'language')}</button>
      <button data-act="view">${tilt ? t(lang, 'viewTilt') : t(lang, 'viewFlat')}</button>
      ${mode === 'pvp' ? `<button data-act="face">${faceTurn ? t(lang, 'faceOn') : t(lang, 'faceOff')}</button>` : ''}
      <button data-act="mute">${isMuted() ? t(lang, 'soundOff') : t(lang, 'soundOn')}</button>
      <button data-act="quick">${t(lang, 'quick')}</button>
      <button data-act="new">${confirmNew ? t(lang, 'confirmNew') : t(lang, 'newGame')}</button>
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
  if (s.phase === 'roll') return `<div class="row"><button data-act="roll" class="primary" ${rolling ? 'disabled' : ''}>🎲 ${t(lang, 'roll')}</button></div>`;
  if (s.phase === 'act') {
    const take = s.advance
      ? `<div class="row"><button data-act="take" class="primary">⚔ ${t(lang, 'takeHex')}</button></div>`
      : '';
    return `${take}<div class="row">
      <button data-act="undo" ${canUndo(sess) ? '' : 'disabled'}>↶ ${t(lang, 'undo')}</button>
      <button data-act="end" class="${s.advance ? '' : 'primary'} ${confirmEnd ? 'warn' : ''}">${confirmEnd ? t(lang, 'endAnyway') : t(lang, 'endTurn')} →</button>
    </div>`;
  }
  return '';
}

// ---------- render ----------

/** Re-rendering replaces the board, so keep where the player had scrolled the zoomed map to. */
function render() {
  const old = app.querySelector<HTMLElement>('.stage');
  const scroll = old ? [old.scrollLeft, old.scrollTop] : [0, 0];
  const list = app.querySelector<HTMLElement>('.sheet-scroll')?.scrollTop ?? 0;
  draw();
  const stage = app.querySelector<HTMLElement>('.stage');
  if (stage) [stage.scrollLeft, stage.scrollTop] = scroll;
  const sheet = app.querySelector<HTMLElement>('.sheet-scroll');
  if (sheet) sheet.scrollTop = list;
}

/** Zoom in or out around the middle of what's on screen. */
function setZoom(next: number) {
  const st = app.querySelector<HTMLElement>('.stage');
  const fx = st ? (st.scrollLeft + st.clientWidth / 2) / st.scrollWidth : 0.5;
  const fy = st ? (st.scrollTop + st.clientHeight / 2) / st.scrollHeight : 0.5;
  zoom = next;
  draw();
  const s2 = app.querySelector<HTMLElement>('.stage');
  if (!s2) return;
  // With a piece selected, keep that piece in the middle; otherwise keep the same middle.
  const u = selected ? getUnit(sess.state, selected) : undefined;
  const hex = u && app.querySelector(`.hex[data-col="${u.pos.col}"][data-row="${u.pos.row}"]`);
  if (hex) {
    const h = hex.getBoundingClientRect();
    const box = s2.getBoundingClientRect();
    s2.scrollLeft += h.left + h.width / 2 - (box.left + box.width / 2);
    s2.scrollTop += h.top + h.height / 2 - (box.top + box.height / 2);
  } else {
    s2.scrollLeft = fx * s2.scrollWidth - s2.clientWidth / 2;
    s2.scrollTop = fy * s2.scrollHeight - s2.clientHeight / 2;
  }
}

/** Effects and sounds for log entries added since the last render. */
function effects(s: GameState): Effects {
  const fresh: LogEntry[] = s.log.length > prevLog ? s.log.slice(prevLog) : [];
  const fx: Effects = { from: fresh.length ? prevPos : new Map(), hits: [] };
  for (const e of fresh) {
    if (e.kind === 'attack' || e.kind === 'shoot') {
      fx.hits.push({ at: e.at, damage: e.damage, killed: e.killed, type: e.target, owner: other(e.player), shotFrom: e.kind === 'shoot' ? e.from : null });
      sound(e.kind === 'shoot' ? 'arrow' : 'clash');
      if (e.killed) setTimeout(() => sound('death'), 180);
    } else if (e.kind === 'move') sound('step');
    else if (e.kind === 'win') setTimeout(() => sound('win'), 400);
  }
  prevLog = s.log.length;
  prevPos = new Map(s.units.map((u) => [u.id, u.pos]));
  return fx;
}

function draw() {
  const s = sess.state;
  // Two players with "face the player" on: swing the board round when the turn changes hands.
  if (faceTurn && mode === 'pvp' && !setupPhase(s) && facedFor !== s.current) {
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

  const over =
    s.phase === 'over' && s.winner
      ? `<div class="cover ${s.winner}"><div class="card ${s.winner}">
           <div class="emblem">${EMBLEM[s.winner]}</div>
           <h2 class="${s.winner}">${playerName(lang, s.winner)} ${t(lang, 'wins')}</h2>
           <p>${reasonText(lang, s.winReason!)}</p>
           <button data-act="restart" class="primary wide">${t(lang, 'newGame')}</button>
         </div></div>`
      : '';

  app.innerHTML = `
    <div class="screen ${portrait ? 'portrait' : 'landscape'} ${withPanel() ? 'desktop' : desktop ? 'full' : ''} ${s.current}">
      <header class="hud">
        <div class="who"><span class="dot ${s.current}"></span><span>${playerName(lang, s.current)}<small>${battle ? `${t(lang, 'turn')} ${s.turn}` : t(lang, 'setup')}</small></span></div>
        <div class="dice">${battle ? [0, 1, 2].slice(0, CONFIG.dice.count).map((i) => die(faces?.[i] ?? null, rolling)).join('') : ''}</div>
        ${right}
        ${desktop ? `<button data-act="fullscreen" class="ghost icon" title="${t(lang, 'fullscreen')}" aria-label="${t(lang, 'fullscreen')}">⛶</button>
          <button data-act="panel" class="ghost icon" title="${panelOpen ? t(lang, 'hidePanel') : t(lang, 'showPanel')}" aria-label="${panelOpen ? t(lang, 'hidePanel') : t(lang, 'showPanel')}">${panelOpen ? '⇥' : '⇤'}</button>` : ''}
        ${withPanel() ? '' : `<button data-act="menu" class="ghost icon" aria-label="${t(lang, 'menu')}">☰</button>`}
      </header>
      <div class="stage-wrap">
        <div class="stage" style="--z:${zoom}">${renderBoard(s, overlay(s), view(), fx)}</div>
        <div class="cam" aria-label="${t(lang, 'camera')}">
          <button data-act="cam-left" title="${t(lang, 'camLeft')}" aria-label="${t(lang, 'camLeft')}">⟲</button>
          <button data-act="cam-right" title="${t(lang, 'camRight')}" aria-label="${t(lang, 'camRight')}">⟳</button>
          <button data-act="cam-up" title="${t(lang, 'camSteeper')}" aria-label="${t(lang, 'camSteeper')}" ${tilt && cam.pitch < 1 ? '' : 'disabled'}>⤒</button>
          <button data-act="cam-down" title="${t(lang, 'camFlatter')}" aria-label="${t(lang, 'camFlatter')}" ${tilt && cam.pitch > 0 ? '' : 'disabled'}>⤓</button>
          <button data-act="cam-mine" title="${t(lang, 'camMine')}" aria-label="${t(lang, 'camMine')}">⬇</button>
          <button data-act="cam-reset" title="${t(lang, 'camReset')}" aria-label="${t(lang, 'camReset')}">⌂</button>
        </div>
        <div class="zoom">
          <button data-act="zoom-in" aria-label="Zoom in" ${zoom >= ZOOM_MAX - 0.01 ? 'disabled' : ''}>+</button>
          <button data-act="zoom-out" aria-label="Zoom out" ${zoom <= ZOOM_MIN + 0.01 ? 'disabled' : ''}>−</button>
        </div>
      </div>
      <p class="info" id="info">${info}</p>
      <footer class="bar">${bar(s)}</footer>
      ${withPanel() ? `<aside class="side">${menuBody(s)}</aside>` : ''}
    </div>
    ${s.phase === 'draft' && !cover && !choosing ? draftSheet(s) : ''}
    ${cover && s.phase !== 'over' && !choosing ? passScreen(s) : ''}
    ${choosing ? startScreen() : ''}
    ${over}
    ${menuOpen && !withPanel() ? menu(s) : ''}`;
  document.documentElement.lang = lang;
  document.title = t(lang, 'title');
  saveGame();
  scheduleAi();
}

// ---------- computer opponent ----------

/** The computer builds and places its army at once (the player never sees it happen). */
function aiSetup() {
  const steps: ((s: GameState) => Result)[] = [(s) => draftArmy(s, suggestArmy()), (s) => autoDeploy(s), (s) => finishDeploy(s)];
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
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    const st = sess.state;
    if (rolling || cover || choosing || !aiTurn(st)) return;
    if (st.phase === 'roll') return roll();
    const a = aiNextAction(st);
    if (a) run((x) => applyAi(x, a));
    else run((x) => endTurn(x), true);
  }, sess.state.phase === 'roll' ? 700 : 650);
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
    run((s) => rollDice(s), true);
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
  if (rolling || s.phase === 'over' || cover || choosing || aiTurn(s)) return;
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
      if (reachable(s, own.id).has(key(hex))) return void run((st) => moveUnit(st, own.id, hex));
      selected = null;
      message = null;
      return render();
    }
  }
  selected = u ? (u.id === selected ? null : u.id) : null;
  message = null;
  render();
}

app.addEventListener('click', (e) => {
  const el = e.target as Element;
  const hex = el.closest('[data-col]');
  if (hex) confirmEnd = false;
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
      draft = suggestArmy();
      message = null;
      return render();
    case 'auto-all': {
      // Build a balanced army, place it in formation and hand over, all in one tap.
      draft = suggestArmy();
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
    case 'mode':
      mode = btn!.getAttribute('data-mode') === 'ai' ? 'ai' : 'pvp';
      return restart(newGame());
    case 'take':
      return void run((s) => takeHex(s));
    case 'roll':
      return aiTurn(sess.state) ? undefined : roll();
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
    case 'cam-left':
    case 'cam-right':
      cam = { ...cam, yaw: cam.yaw + (act === 'cam-left' ? -1 : 1) * (Math.PI / 6) };
      saveCam();
      return render();
    case 'cam-up':
    case 'cam-down':
      cam = { ...cam, pitch: clampPitch(cam.pitch + (act === 'cam-up' ? 0.15 : -0.15)) };
      saveCam();
      return render();
    case 'cam-mine': {
      // Your army at the bottom; against the computer "you" are always Novgorod.
      const me = mode === 'ai' ? 'red' : sess.state.current;
      cam = { ...cam, yaw: yawFor(me) };
      saveCam();
      return render();
    }
    case 'face':
      faceTurn = !faceTurn;
      try {
        localStorage.setItem(FACE_KEY, faceTurn ? '1' : '0');
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
      const next = act === 'zoom-in' ? ZOOMS.find((z) => z > zoom + 0.01) : [...ZOOMS].reverse().find((z) => z < zoom - 0.01);
      return setZoom(next ?? zoom);
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

// ---------- pinch to zoom the map ----------
// Two fingers on the board zoom the map around the point between them, like the + / −
// buttons; the page itself never zooms. During the pinch only the map's size changes
// (no re-render), and the buttons catch up when the fingers lift.

let pinch: { dist: number; zoom: number; angle: number; midY: number; cam: Camera } | null = null;

const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const twist = (t: TouchList) => Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX);

// ---------- camera moves without a full re-render ----------
// While the camera is being dragged only the board is redrawn, once per frame, with the
// highlights frozen as they were when the drag began.
let camOverlay: Overlay | null = null;
let camQueued = false;
function camFrame() {
  if (!camOverlay) camOverlay = overlay(sess.state);
  if (camQueued) return;
  camQueued = true;
  requestAnimationFrame(() => {
    camQueued = false;
    const st = app.querySelector<HTMLElement>('.stage');
    if (st && camOverlay) st.innerHTML = renderBoard(sess.state, camOverlay, view(), NO_EFFECTS);
  });
}
function camDone() {
  camOverlay = null;
  saveCam();
  render();
}
/** Ignores tiny accidental twists and slides while pinching. */
const beyond = (v: number, dead: number) => (Math.abs(v) < dead ? 0 : v - Math.sign(v) * dead);

function zoomAround(next: number, clientX: number, clientY: number) {
  const st = app.querySelector<HTMLElement>('.stage');
  if (!st) return;
  next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
  const box = st.getBoundingClientRect();
  const mx = clientX - box.left;
  const my = clientY - box.top;
  const ratio = next / zoom;
  const [cx, cy] = [st.scrollLeft + mx, st.scrollTop + my];
  zoom = next;
  st.style.setProperty('--z', String(zoom));
  st.scrollLeft = cx * ratio - mx;
  st.scrollTop = cy * ratio - my;
}

app.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length === 2 && (e.target as Element).closest('.stage')) {
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      pinch = { dist: spread(e.touches), zoom, angle: twist(e.touches), midY, cam: { ...cam } };
      e.preventDefault();
    }
  },
  { passive: false },
);

app.addEventListener(
  'touchmove',
  (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    zoomAround(pinch.zoom * (spread(e.touches) / pinch.dist), midX, midY);
    // Twisting two fingers turns the board; sliding them up or down together tilts it.
    let turn = twist(e.touches) - pinch.angle;
    if (turn > Math.PI) turn -= 2 * Math.PI;
    if (turn < -Math.PI) turn += 2 * Math.PI;
    const yaw = pinch.cam.yaw + beyond(turn, 0.08);
    const pitch = tilt ? clampPitch(pinch.cam.pitch - beyond(midY - pinch.midY, 14) * 0.004) : cam.pitch;
    if (yaw !== cam.yaw || pitch !== cam.pitch) {
      cam = { yaw, pitch };
      camFrame();
    }
  },
  { passive: false },
);

app.addEventListener('touchend', (e) => {
  if (pinch && e.touches.length < 2) {
    pinch = null;
    camDone();
  }
});

// Safari's own pinch gestures would zoom the page: stop them everywhere.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

// Trackpad pinch on a computer arrives as ctrl + wheel: zoom the map instead of the page.
app.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey || !(e.target as Element).closest('.stage')) return;
    e.preventDefault();
    zoomAround(zoom * Math.exp(-e.deltaY / 100), e.clientX, e.clientY);
    clearTimeout(wheelEnd);
    wheelEnd = window.setTimeout(render, 200);
  },
  { passive: false },
);
let wheelEnd = 0;

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
  if (k === ' ' || k === 'r') {
    e.preventDefault();
    return click(app.querySelector('.cover [data-act="ack"]') ? 'ack' : 'roll');
  }
  if (k === 'enter' || k === 'e') return click(app.querySelector('.cover [data-act="ack"]') ? 'ack' : sess.state.phase === 'deploy' ? 'done' : 'end');
  if (k === 'u') return click('undo');
  if (k === 'p') return click('panel');
  if (k === 'q') return click('cam-left');
  if (k === 'w') return click('cam-right');
  if (k === 'z') return click('cam-down');
  if (k === 'x') return click('cam-up');
  if (k === 'c') return click('cam-reset');
  if (k === 'v') return click('cam-mine');
  if (k === 'f') return click('fullscreen');
  if (k === 't') return click('take');
  if (k === 'a') return click(sess.state.phase === 'deploy' ? 'auto' : '');
  if (k === '+' || k === '=') return click('zoom-in');
  if (k === '-' || k === '_') return click('zoom-out');
  if (k === 'escape') {
    if (menuOpen) menuOpen = false;
    selected = null;
    message = null;
    return render();
  }
});

/** Click and drag the map with the mouse to move around when zoomed in. */
/** Right-drag (or Shift / Alt + drag) turns and tilts the camera instead. */
let drag: { x: number; y: number; left: number; top: number; moved: boolean; turn: boolean; cam: Camera } | null = null;
app.addEventListener('mousedown', (e) => {
  const st = (e.target as Element).closest<HTMLElement>('.stage');
  if (!st || (e.button !== 0 && e.button !== 2)) return;
  const turn = e.button === 2 || e.shiftKey || e.altKey;
  drag = { x: e.clientX, y: e.clientY, left: st.scrollLeft, top: st.scrollTop, moved: false, turn, cam: { ...cam } };
});
app.addEventListener('contextmenu', (e) => {
  if ((e.target as Element).closest('.stage')) e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) < 6) return;
  drag.moved = true;
  if (drag.turn) {
    cam = { yaw: drag.cam.yaw + dx * 0.008, pitch: tilt ? clampPitch(drag.cam.pitch - dy * 0.004) : cam.pitch };
    return camFrame();
  }
  const st = app.querySelector<HTMLElement>('.stage');
  if (!st) return;
  st.scrollLeft = drag.left - dx;
  st.scrollTop = drag.top - dy;
  st.classList.add('dragging');
});
window.addEventListener('mouseup', () => {
  if (drag?.moved && drag.turn) camDone();
  if (drag?.moved) {
    app.querySelector('.stage')?.classList.remove('dragging');
    // Swallow the click that ends a drag so it doesn't move or select a piece.
    window.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true });
  }
  drag = null;
});

window.addEventListener('resize', () => {
  if (isDesktop() !== desktop && !rolling) return render();
  if (isPortrait() !== portrait && !rolling) render();
});

render();
