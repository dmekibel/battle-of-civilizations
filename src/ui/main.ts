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
  type AttackPreview,
  type GameState,
  type Player,
  type Result,
  type Session,
} from '../engine';
import { renderBoard, type Overlay } from './board';
import { errorText, logText, playerName, reasonText, t, unitName, type Lang } from './i18n';
import { unitIcon } from './symbols';

const app = document.getElementById('app')!;

const LANG_KEY = 'boc-lang';
function loadLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'ru' ? 'ru' : 'en';
  } catch {
    return 'en';
  }
}

let sess: Session = startSession(newGame());
let selected: string | null = null;
let lang: Lang = loadLang();
let message: string | null = null;
let rolling = false;
let rollFaces: number[] = [];
let confirmNew = false;
let lastPoints = 0;
let menuOpen = false;
/** Pass-the-phone screen: shown whenever the other player must look away. */
let cover = true;
let draft: ArmyCounts = {};
let tray: UnitTypeId | null = null;

const isPortrait = () => window.innerHeight > window.innerWidth;
let portrait = isPortrait();
const ZOOMS = [1, 1.6, 2.4];
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
  return {
    selected,
    reach: mine ? reachable(s, own.id) : new Map(),
    targets,
    zone: s.phase === 'deploy' ? { owner: s.current, hexes: zoneHexes(s, s.current) } : null,
    // During setup the other side's army stays secret.
    hide: setupPhase(s) ? other(s.current) : null,
  };
}

function legendList(owner: Player): string {
  return LEGEND_ORDER.map(
    (type) => `<li>${unitIcon(type, owner)}<div><b>${unitName(lang, type)}</b>${stats(type)}</div></li>`,
  ).join('');
}

// ---------- screens ----------

function draftSheet(s: GameState): string {
  const spent = armyCost(draft);
  const left = CONFIG.army.budget - spent;
  const rows = BUY_ORDER.map((type) => {
    const n = draft[type] ?? 0;
    const price = CONFIG.army.cost[type];
    return `<li>
      ${unitIcon(type, s.current)}
      <b class="name">${unitName(lang, type)}</b>
      <span class="price" title="${t(lang, 'power')}">${price}<small>${t(lang, 'pts')}</small></span>
      <div class="stepper">
        <button data-act="less" data-type="${type}" ${n ? '' : 'disabled'} aria-label="−">−</button>
        <output>${n}</output>
        <button data-act="more" data-type="${type}" ${price <= left ? '' : 'disabled'} aria-label="+">+</button>
      </div>
      ${stats(type)}
    </li>`;
  }).join('');
  return `<div class="sheet ${s.current}">
    <div class="sheet-body">
      <h2><span class="dot ${s.current}"></span>${playerName(lang, s.current)}: ${t(lang, 'build')}</h2>
      <div class="budget"><b>${left}</b> / ${CONFIG.army.budget} ${t(lang, 'pointsLeft')}
        <div class="meter"><i style="width:${(spent / CONFIG.army.budget) * 100}%"></i></div></div>
      <ul class="buy">
        <li class="king">${unitIcon('king', s.current)}<b class="name">${unitName(lang, 'king')}<span class="free">${t(lang, 'kingFree')}</span></b><span class="price free-badge">0<small>${t(lang, 'pts')}</small></span><div class="stepper"><output>1</output></div>${stats('king')}</li>
        ${rows}
      </ul>
      ${statKey()}
      ${message ? `<p class="error">${message}</p>` : ''}
      <button data-act="draft" class="primary wide">${t(lang, 'toDeploy')} →</button>
    </div>
  </div>`;
}

function passScreen(s: GameState): string {
  if (s.phase === 'roll') {
    return `<div class="cover"><div class="card">
      <h2>${t(lang, 'battle')}</h2>
      <p>${t(lang, 'battleText')} <b class="${s.current}">${playerName(lang, s.current)}</b>.</p>
      <button data-act="ack" class="primary wide">${t(lang, 'startBattle')}</button>
    </div></div>`;
  }
  return `<div class="cover ${s.current}"><div class="card">
    <p class="small">${t(lang, 'handTo')}</p>
    <h2 class="${s.current}">${playerName(lang, s.current)}</h2>
    <p>${playerName(lang, other(s.current))} — ${t(lang, 'noPeek')}</p>
    <button data-act="ack" class="primary wide">${t(lang, 'imReady')}</button>
  </div></div>`;
}

function menu(s: GameState): string {
  const log = s.log
    .filter((e) => e.kind !== 'endTurn')
    .slice()
    .reverse()
    .map((e) => `<li><span class="dot ${e.player}"></span><span class="tn">${e.turn}</span>${logText(lang, e)}</li>`)
    .join('');
  return `<div class="drawer-bg" data-act="menu"></div>
  <aside class="drawer">
    <div class="drawer-head"><b>${t(lang, 'title')}</b><button data-act="menu" class="ghost">${t(lang, 'close')}</button></div>
    <div class="drawer-buttons">
      <button data-act="lang">${t(lang, 'language')}</button>
      <button data-act="quick">${t(lang, 'quick')}</button>
      <button data-act="new">${confirmNew ? t(lang, 'confirmNew') : t(lang, 'newGame')}</button>
    </div>
    <section><h3>${t(lang, 'pieces')}</h3><ul class="legend">${legendList(s.current)}</ul>${statKey()}<p class="note">${t(lang, 'legendNote')}</p></section>
    <section><h3>${t(lang, 'log')}</h3><ol class="log">${log || `<li class="empty">${t(lang, 'emptyLog')}</li>`}</ol></section>
  </aside>`;
}

function bar(s: GameState): string {
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
      <button data-act="end" class="${s.advance ? '' : 'primary'}">${t(lang, 'endTurn')} →</button>
    </div>`;
  }
  return '';
}

// ---------- render ----------

/** Re-rendering replaces the board, so keep where the player had scrolled the zoomed map to. */
function render() {
  const old = app.querySelector<HTMLElement>('.stage');
  const scroll = old ? [old.scrollLeft, old.scrollTop] : [0, 0];
  draw();
  const stage = app.querySelector<HTMLElement>('.stage');
  if (stage) [stage.scrollLeft, stage.scrollTop] = scroll;
}

/** Zoom in or out around the middle of what's on screen. */
function setZoom(next: number) {
  const st = app.querySelector<HTMLElement>('.stage');
  const fx = st ? (st.scrollLeft + st.clientWidth / 2) / st.scrollWidth : 0.5;
  const fy = st ? (st.scrollTop + st.clientHeight / 2) / st.scrollHeight : 0.5;
  zoom = next;
  draw();
  const s2 = app.querySelector<HTMLElement>('.stage');
  if (s2) {
    s2.scrollLeft = fx * s2.scrollWidth - s2.clientWidth / 2;
    s2.scrollTop = fy * s2.scrollHeight - s2.clientHeight / 2;
  }
}

function draw() {
  const s = sess.state;
  portrait = isPortrait();
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
      ? `<div class="cover"><div class="card ${s.winner}">
           <h2 class="${s.winner}">${playerName(lang, s.winner)} ${t(lang, 'wins')}</h2>
           <p>${reasonText(lang, s.winReason!)}</p>
           <button data-act="restart" class="primary wide">${t(lang, 'newGame')}</button>
         </div></div>`
      : '';

  app.innerHTML = `
    <div class="screen ${portrait ? 'portrait' : 'landscape'} ${s.current}">
      <header class="hud">
        <div class="who"><span class="dot ${s.current}"></span><span>${playerName(lang, s.current)}<small>${battle ? `${t(lang, 'turn')} ${s.turn}` : t(lang, 'setup')}</small></span></div>
        <div class="dice">${battle ? [0, 1, 2].slice(0, CONFIG.dice.count).map((i) => die(faces?.[i] ?? null, rolling)).join('') : ''}</div>
        ${right}
        <button data-act="menu" class="ghost icon" aria-label="${t(lang, 'menu')}">☰</button>
      </header>
      <div class="stage-wrap">
        <div class="stage" style="--z:${zoom}">${renderBoard(s, overlay(s), { portrait })}</div>
        <div class="zoom">
          <button data-act="zoom-in" aria-label="Zoom in" ${zoom >= ZOOMS[ZOOMS.length - 1] ? 'disabled' : ''}>+</button>
          <button data-act="zoom-out" aria-label="Zoom out" ${zoom <= ZOOMS[0] ? 'disabled' : ''}>−</button>
        </div>
      </div>
      <p class="info" id="info">${info}</p>
      <footer class="bar">${bar(s)}</footer>
    </div>
    ${s.phase === 'draft' && !cover ? draftSheet(s) : ''}
    ${cover && s.phase !== 'over' ? passScreen(s) : ''}
    ${over}
    ${menuOpen ? menu(s) : ''}`;
  document.documentElement.lang = lang;
  document.title = t(lang, 'title');
}

// ---------- actions ----------

function run(act: (s: GameState) => Result, checkpoint = false): boolean {
  const { sess: next, result } = apply(sess, act, checkpoint);
  sess = next;
  message = result.ok ? null : errorText(lang, result.error);
  render();
  return result.ok;
}

function restart(state: GameState) {
  sess = startSession(state);
  selected = null;
  message = null;
  draft = {};
  tray = null;
  confirmNew = false;
  menuOpen = false;
  cover = state.phase === 'draft';
  render();
}

function roll() {
  if (rolling || sess.state.phase !== 'roll') return;
  rolling = true;
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
  if (rolling || s.phase === 'over' || cover) return;
  const hex = { col, row };
  if (s.phase === 'deploy') return onDeployHex(s, hex);
  if (s.phase === 'draft') return;
  const u = unitAt(s, hex);
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
  if (hex) return onHex(Number(hex.getAttribute('data-col')), Number(hex.getAttribute('data-row')));
  const btn = el.closest('[data-act]');
  const act = btn?.getAttribute('data-act');
  if (!act) return;
  const type = btn!.getAttribute('data-type') as UnitTypeId | null;
  if (act !== 'new') confirmNew = false;
  switch (act) {
    case 'ack':
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
        cover = true;
        tray = null;
        render();
      }
      return;
    case 'take':
      return void run((s) => takeHex(s));
    case 'roll':
      return roll();
    case 'undo':
      sess = undo(sess);
      message = null;
      if (selected && !getUnit(sess.state, selected)) selected = null;
      return render();
    case 'end':
      selected = null;
      return void run((s) => endTurn(s), true);
    case 'zoom-in':
    case 'zoom-out': {
      const i = ZOOMS.indexOf(zoom) + (act === 'zoom-in' ? 1 : -1);
      return setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i))]);
    }
    case 'menu':
      menuOpen = !menuOpen;
      return render();
    case 'lang':
      lang = lang === 'ru' ? 'en' : 'ru';
      try {
        localStorage.setItem(LANG_KEY, lang);
      } catch {
        /* storage unavailable: keep the choice for this visit only */
      }
      message = null;
      return render();
    case 'quick':
      return restart(quickStart());
    case 'new':
      if (!confirmNew && sess.state.log.length + sess.state.units.length > 0) {
        confirmNew = true;
        return render();
      }
      return restart(newGame());
    case 'restart':
      return restart(newGame());
  }
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

window.addEventListener('resize', () => {
  if (isPortrait() !== portrait && !rolling) render();
});

render();
