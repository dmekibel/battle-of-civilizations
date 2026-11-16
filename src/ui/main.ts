import './style.css';
import { CONFIG, type UnitTypeId } from '../config';
import {
  apply,
  attack,
  canUndo,
  endTurn,
  getUnit,
  key,
  moveUnit,
  newGame,
  reachable,
  rollDice,
  shoot,
  startSession,
  strikeTargets,
  undo,
  unitAt,
  type AttackPreview,
  type GameState,
  type Player,
  type Result,
  type Session,
} from '../engine';
import { renderBoard } from './board';
import { unitIcon } from './symbols';
import { errorText, logText, playerName, reasonText, t, unitName, type Lang } from './i18n';

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

// ---------- view helpers ----------

const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function die(face: number | null, spin: boolean): string {
  const on = face ? PIPS[face] ?? [] : [];
  const cells = Array.from({ length: 9 }, (_, i) => `<i class="${on.includes(i) ? 'on' : ''}"></i>`).join('');
  return `<div class="die ${spin ? 'spin' : ''} ${face ? '' : 'blank'}">${cells}</div>`;
}

function unitInfo(s: GameState, id: string): string {
  const u = getUnit(s, id);
  if (!u) return '';
  const r = CONFIG.units[u.type];
  let line = `<b class="${u.owner}">${unitName(lang, u.type)}</b> · ${t(lang, 'hp')} ${u.hp}/${r.hp}`;
  if (r.attack > 0) line += ` · ${t(lang, 'atk')} ${r.attack}`;
  line += ` · ${r.moveCost} ${t(lang, 'perHex')}`;
  if (r.ranged) {
    line += ` · ${t(lang, 'shot')} ${r.ranged.minRange}–${r.ranged.maxRange}, −${r.ranged.damage} ${t(lang, 'hp')}, ${r.ranged.cost} ${t(lang, 'points')}`;
  }
  return line;
}

const LEGEND_ORDER: UnitTypeId[] = ['king', 'heavyInfantry', 'lightInfantry', 'heavyCavalry', 'lightCavalry', 'archer'];

function legend(owner: Player): string {
  return LEGEND_ORDER.map((type) => {
    const r = CONFIG.units[type];
    const fight = r.attack > 0 ? `${t(lang, 'atk')} ${r.attack}` : t(lang, 'noMelee');
    const shot = r.ranged ? ` · ${t(lang, 'shot')} ${r.ranged.minRange}–${r.ranged.maxRange}` : '';
    return `<li>${unitIcon(type, owner)}<div><b>${unitName(lang, type)}</b>
      <span>${r.moveCost} ${t(lang, 'perHex')} · ${fight} · ${t(lang, 'hp')} ${r.hp}${shot}</span></div></li>`;
  }).join('');
}

function previewText(s: GameState, targetId: string, p: AttackPreview): string {
  const target = getUnit(s, targetId)!;
  const what = p.kind === 'attack' ? t(lang, 'attack') : t(lang, 'shoot');
  const end = p.kills ? `, ${t(lang, 'kills')}` : ` (${t(lang, 'hp')} ${target.hp} → ${p.hpAfter})`;
  return `${what}: ${unitName(lang, target.type).toLowerCase()} −${p.damage} ${t(lang, 'hp')}${end} · ${t(lang, 'cost')} ${p.cost}`;
}

function overlay(s: GameState) {
  const own = selected ? getUnit(s, selected) : undefined;
  const mine = own && own.owner === s.current && s.phase === 'act';
  const targets = new Map<string, AttackPreview>();
  if (mine) for (const x of strikeTargets(s, own.id)) if (!targets.has(x.targetId)) targets.set(x.targetId, x.preview);
  return { selected, reach: mine ? reachable(s, own.id) : new Map(), targets };
}

// ---------- render ----------

function render() {
  const s = sess.state;
  const o = overlay(s);
  const faces = rolling ? rollFaces : s.dice;
  const bump = s.points !== lastPoints ? 'bump' : '';
  lastPoints = s.points;

  let info = message ?? '';
  if (!info) {
    if (s.phase === 'roll') info = `${playerName(lang, s.current)}: ${t(lang, 'rollFirst')}`;
    else if (selected) info = unitInfo(s, selected);
    else if (s.phase === 'act') info = `${t(lang, 'pickUnit')}. ${t(lang, 'help')}`;
  }

  const log = s.log
    .filter((e) => e.kind !== 'endTurn')
    .slice()
    .reverse()
    .map((e) => `<li><span class="dot ${e.player}"></span><span class="tn">${e.turn}</span>${logText(lang, e)}</li>`)
    .join('');

  const over =
    s.phase === 'over' && s.winner
      ? `<div class="over"><div class="card ${s.winner}">
           <h2>${playerName(lang, s.winner)} ${t(lang, 'wins')}</h2>
           <p>${reasonText(lang, s.winReason!)}</p>
           <button data-act="restart" class="primary">${t(lang, 'newGame')}</button>
         </div></div>`
      : '';

  app.innerHTML = `
    <header class="top">
      <h1>${t(lang, 'title')}</h1>
      <button data-act="lang" class="ghost" aria-label="language">${lang === 'ru' ? 'EN' : 'RU'}</button>
    </header>
    <main class="layout">
      <div class="board-wrap">${renderBoard(s, o)}</div>
      <aside class="panel">
        <section class="status ${s.current}">
          <div class="who"><span class="dot ${s.current}"></span>${playerName(lang, s.current)} · ${t(lang, 'turn')} ${s.turn}</div>
          <div class="dice">${[0, 1, 2].slice(0, CONFIG.dice.count).map((i) => die(faces?.[i] ?? null, rolling)).join('')}</div>
          <div class="points ${bump}"><b>${s.points}</b><span>${t(lang, 'points')}</span></div>
        </section>
        <p class="info" id="info">${info}</p>
        <div class="actions">
          ${
            s.phase === 'roll'
              ? `<button data-act="roll" class="primary wide" ${rolling ? 'disabled' : ''}>🎲 ${t(lang, 'roll')}</button>`
              : `<button data-act="undo" ${canUndo(sess) && s.phase === 'act' ? '' : 'disabled'}>↶ ${t(lang, 'undo')}</button>
                 <button data-act="end" class="primary" ${s.phase === 'act' ? '' : 'disabled'}>${t(lang, 'endTurn')} →</button>`
          }
        </div>
        <details class="legend" open>
          <summary>${t(lang, 'pieces')}</summary>
          <ul>${legend(s.current)}</ul>
          <p>${t(lang, 'legendNote')}</p>
        </details>
        <details class="log" open>
          <summary>${t(lang, 'log')}</summary>
          <ol>${log || `<li class="empty">${t(lang, 'emptyLog')}</li>`}</ol>
        </details>
        <button data-act="new" class="ghost small">${confirmNew ? t(lang, 'confirmNew') : t(lang, 'newGame')}</button>
      </aside>
    </main>
    ${over}`;
  document.documentElement.lang = lang;
  document.title = t(lang, 'title');
}

// ---------- actions ----------

function run(act: (s: GameState) => Result, checkpoint = false) {
  const { sess: next, result } = apply(sess, act, checkpoint);
  sess = next;
  message = result.ok ? null : errorText(lang, result.error);
  render();
}

function roll() {
  if (rolling || sess.state.phase !== 'roll') return;
  rolling = true;
  selected = null;
  message = null;
  const spin = () => (rollFaces = Array.from({ length: CONFIG.dice.count }, () => 1 + Math.floor(Math.random() * 6)));
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

function onHex(col: number, row: number) {
  const s = sess.state;
  if (rolling || s.phase === 'over') return;
  const hex = { col, row };
  const u = unitAt(s, hex);
  const own = selected ? getUnit(s, selected) : undefined;
  confirmNew = false;

  if (own && own.owner === s.current && s.phase === 'act') {
    if (u && u.owner !== own.owner) {
      const hit = strikeTargets(s, own.id).find((x) => x.targetId === u.id);
      if (hit) return run((st) => (hit.preview.kind === 'attack' ? attack(st, own.id, u.id) : shoot(st, own.id, u.id)));
      // Explain why not, then show the enemy's stats.
      const why = CONFIG.units[own.type].ranged ? shoot(s, own.id, u.id) : attack(s, own.id, u.id);
      message = !why.ok ? `${errorText(lang, why.error)} ${unitInfo(s, u.id)}` : null;
      return render();
    }
    if (!u) {
      if (reachable(s, own.id).has(key(hex))) return run((st) => moveUnit(st, own.id, hex));
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
  const act = el.closest('[data-act]')?.getAttribute('data-act');
  if (!act) return;
  if (act !== 'new') confirmNew = false;
  switch (act) {
    case 'roll':
      return roll();
    case 'undo':
      sess = undo(sess);
      message = null;
      if (selected && !getUnit(sess.state, selected)) selected = null;
      return render();
    case 'end':
      selected = null;
      return run((s) => endTurn(s), true);
    case 'lang':
      lang = lang === 'ru' ? 'en' : 'ru';
      try {
        localStorage.setItem(LANG_KEY, lang);
      } catch {
        /* storage unavailable: keep the choice for this visit only */
      }
      message = null;
      return render();
    case 'new':
    case 'restart':
      if (act === 'new' && !confirmNew && sess.state.log.length) {
        confirmNew = true;
        return render();
      }
      confirmNew = false;
      sess = startSession(newGame());
      selected = null;
      message = null;
      return render();
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

render();
