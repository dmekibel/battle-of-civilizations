// The New battle screen's summary rows and sub-pages, and the army showcase ("View army" / title-screen "Armies").
// Kept out of main.ts so the setup flow's text and markup live in one place; main.ts owns the state and handlers.
import { CONFIG, type UnitTypeId } from '../config';
import { hexesPerPoint, maxHp, stepCost } from '../engine';
import { ERAS, ERA_OF, FACTIONS, FACTION_ORDER, type FactionId } from './factions';
import { t, unitName, type Key, type Lang } from './i18n';
import { ART_VERSION, SPRITES } from './sprites';

// ---------- strings (EN + RU) ----------
const TXT = {
  en: {
    army: 'Army', armySize: 'Army size', points: 'points', more: 'More options', viewArmy: 'View army',
    chooseArmy: 'Choose this army', armies: 'Armies', armiesSub: 'Every army, piece by piece', dragTurn: 'Drag a figure to turn it',
    king: 'King', champion: 'Champion', cost: 'COST', free: 'free', hp: 'HP', prev: 'Previous army', next: 'Next army',
    turnL: 'Turn left', turnR: 'Turn right', armyHome: 'Army home', pieces: 'pieces',
  },
  ru: {
    army: 'Армия', armySize: 'Размер армии', points: 'очков', more: 'Ещё настройки', viewArmy: 'Смотреть армию',
    chooseArmy: 'Выбрать эту армию', armies: 'Армии', armiesSub: 'Все армии, фигура за фигурой', dragTurn: 'Потяните фигуру, чтобы повернуть',
    king: 'Король', champion: 'Чемпион', cost: 'ЦЕНА', free: 'даром', hp: 'ЖИЗНИ', prev: 'Предыдущая армия', next: 'Следующая армия',
    turnL: 'Повернуть влево', turnR: 'Повернуть вправо', armyHome: 'Дом армии', pieces: 'фигур',
  },
};
export type SetupKey = keyof (typeof TXT)['en'];
export const st = (lang: Lang, k: SetupKey) => TXT[lang][k];

/** One line on what each piece is for. */
const ROLE: Record<UnitTypeId, [string, string]> = {
  king: ['Leads the army. Lose him and the battle is lost.', 'Ведёт армию. Падёт король — проиграна битва.'],
  heavyInfantry: ['Slow, armoured line that holds its ground.', 'Медленный бронированный строй, держит позицию.'],
  lightInfantry: ['Cheap, quick foot soldiers.', 'Дешёвые и быстрые пешие воины.'],
  heavyCavalry: ['Hard-hitting armoured riders.', 'Бронированные всадники с тяжёлым ударом.'],
  lightCavalry: ['Fast riders for flanks and raids.', 'Быстрые всадники для флангов и набегов.'],
  archer: ['Shoot from far away; no use up close.', 'Стреляют издалека, в ближнем бою бессильны.'],
  horseArcher: ['Ride in and shoot, but must stay after shooting.', 'Подскакать и выстрелить, но после выстрела стоят на месте.'],
  samurai: ['Elite swordsmen, quick for their armour.', 'Элитные мечники, быстрые для своей брони.'],
  ashigaru: ['Cheap spearmen, deadly against riders.', 'Дешёвые копейщики, опасные для конницы.'],
  gunslinger: ['Short-range pistols on the move.', 'Револьверы на ходу, бьют недалеко.'],
  rifleman: ['Long-range marksmen; no melee.', 'Меткие стрелки издалека, без ближнего боя.'],
  cowboy: ['Riders who shoot from the saddle.', 'Всадники, стреляющие из седла.'],
  deputy: ['Lawmen with a short shot.', 'Служители закона с коротким выстрелом.'],
  berserker: ['Fierce and hard-hitting, lightly protected.', 'Яростные, бьют сильно, защищены слабо.'],
  axeThrower: ['Throw axes a short way.', 'Мечут топоры недалеко.'],
  ballista: ['Siege bolt: long range, hits for 2.', 'Осадная стрела: бьёт далеко и на 2.'],
  lineInfantry: ['Musket line: shoots and holds.', 'Мушкетный строй: стреляет и держит линию.'],
  skirmisher: ['Loose-order shooters with good range.', 'Стрелки в рассыпном строю, бьют далеко.'],
  cannon: ['Artillery: long range, hits for 2.', 'Артиллерия: далеко и на 2.'],
  chariot: ['Fast war cart with an archer aboard.', 'Быстрая колесница с лучником.'],
  boarder: ['Cutlass fighters who hit hard.', 'Абордажники с саблями, бьют сильно.'],
  bomber: ['Throw grenades a short way for 2.', 'Бросают гранаты недалеко, урон 2.'],
  champion: ['One per army: a towering elite warrior.', 'Один на армию: могучий элитный воин.'],
  championRider: ['One per army: an elite rider.', 'Один на армию: элитный всадник.'],
  championGun: ['One per army: a deadly gunfighter.', 'Один на армию: смертельный стрелок.'],
  jaguar: ['Elite warriors with obsidian clubs.', 'Элитные воины с обсидиановыми дубинами.'],
  atlatl: ['Dart throwers with good reach.', 'Метатели дротиков с хорошей дальностью.'],
  impi: ['Stabbing spears, double damage to riders.', 'Короткие копья, двойной урон по коннице.'],
  thrower: ['Quick on their feet; hurl assegais up to 4 hexes.', 'Быстрые на ногу; мечут ассегаи на 4 гекса.'],
  banner: ['One per army: friends next to it hit +1 in melee.', 'Один на армию: соседи бьют в ближнем бою на 1 сильнее.'],
  scout: ['Cheap; the only foot that walks through forest.', 'Дёшевы; единственные, кто проходит через лес.'],
  shieldbearer: ['Big shields: every shot does 1 less.', 'Большие щиты: каждый выстрел наносит на 1 меньше.'],
  rocket: ['Lobs over trees and walls: far, hits for 2.', 'Бьют навесом через лес и стены: далеко и на 2.'],
  crossbow: ['Slow reload, but each shot hits for 2.', 'Долго заряжают, но каждый выстрел на 2.'],
  longRifle: ['The longest reach on foot: hits for 2.', 'Самый дальний пеший выстрел: на 2.'],
  wildRider: ['Fast and fierce, falls to one blow.', 'Быстрые и яростные, падают от одного удара.'],
};
const CHAMPS: UnitTypeId[] = ['champion', 'championRider', 'championGun'];

// ---------- summary rows ----------
const CHEV = '<i class="srow-chev" aria-hidden="true">›</i>';
/** A tappable summary row (iOS Settings: label left, current value right in grey, chevron). */
export function summaryRow(page: string, label: string, value: string, pic = ''): string {
  return `<button data-act="setup-page" data-page="${page}" class="srow"><span class="srow-l">${label}</span><span class="srow-v">${pic}<span>${value}</span></span>${CHEV}</button>`;
}
/** A single-choice list (iOS Settings checkmark list); each option uses the existing `set` handler. */
export function choiceList(field: string, options: [string, string, string?][], current: string): string {
  return `<div class="olist" role="radiogroup">${options
    .map(([v, label, sub]) => `<button role="radio" data-act="set" data-field="${field}" data-value="${v}" class="orow ${v === current ? 'on' : ''}" aria-checked="${v === current}"><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span><i class="ocheck" aria-hidden="true">${v === current ? '✓' : ''}</i></button>`)
    .join('')}</div>`;
}

// ---------- army showcase ----------
/** The eight turns of a figure, going round. */
const VIEWS = ['front', 'front-left', 'left', 'back-left', 'back', 'back-right', 'right', 'front-right'];
let view = 1; // starts three-quarter, like the menus
let autoPausedUntil = 0; void autoPausedUntil; // kept for the turn-by-hand pause; auto-turn is off

const artOf = (type: UnitTypeId) => (type === 'deputy' ? 'lightInfantry' : type);
function figSrc(fac: string, type: UnitTypeId, v: string): string | null {
  const set = SPRITES[fac]?.[artOf(type)];
  const pick = set?.[v] ? v : set?.front ? 'front' : null;
  return pick ? `${import.meta.env.BASE_URL}pieces/${fac}/${artOf(type)}-${pick}.webp?v=${ART_VERSION}` : null;
}
const nameOf = (lang: Lang, fac: FactionId, u: UnitTypeId) => FACTIONS[fac].names?.[u]?.[lang] || unitName(lang, u);

function chips(lang: Lang, type: UnitTypeId): string {
  const r = CONFIG.units[type];
  const price = type === 'king' ? st(lang, 'free') : String((CONFIG.army.cost as Record<string, number>)[type] ?? '–');
  const mv = CONFIG.options.unitSpeeds ? stepCost(type) : hexesPerPoint(type);
  return `<span class="stats">
    <span class="st mov"><i>${t(lang, 'tagMove')}</i>${mv}</span>
    <span class="st atk"><i>${t(lang, 'tagAtk')}</i>${r.attack > 0 ? r.attack : '–'}</span>
    <span class="st def"><i>${st(lang, 'hp')}</i>${maxHp(type)}</span>
    ${r.ranged ? `<span class="st rng"><i>${t(lang, 'tagRange')}</i>${r.ranged.minRange}–${r.ranged.maxRange}</span>` : ''}
    <span class="st cost"><i>${st(lang, 'cost')}</i>${price}</span>
  </span>`;
}

/** Armies with art, in menu order. */
export const READY_ARMIES = () => FACTION_ORDER.filter((id) => SPRITES[id]?.king?.front);

/** The showcase page for one army. `choose` adds "Choose this army" for the side being picked. */
export function armyShowcase(lang: Lang, fac: FactionId, back: string, choose?: { side: string }): string {
  const f = FACTIONS[fac];
  const era = ERA_OF[fac];
  const units = ['king', ...f.roster] as UnitTypeId[];
  // True scale inside the army: each figure as tall as it stands on the board, against the army's tallest
  // (one Comanche looked like a giant next to the rest, David 2026-11-18).
  const hOf = (u: UnitTypeId) => SPRITES[fac]?.[artOf(u)]?.front?.[1] ?? 0;
  const tallest = Math.max(1, ...units.map(hOf));
  const cards = units.map((u) => {
    const src = figSrc(fac, u, VIEWS[view]);
    const sc = Math.max(0.55, hOf(u) / tallest);
    const king = u === 'king';
    const champ = CHAMPS.includes(u);
    const label = king ? st(lang, 'king') : champ ? st(lang, 'champion') : '';
    const badge = label && label !== nameOf(lang, fac, u) ? label : '';
    return `<div class="ap-unit ${king ? 'king' : ''} ${champ ? 'champ' : ''}">
      <div class="ap-fig" data-fac="${fac}" data-type="${u}">${src ? `<img src="${src}" alt="" draggable="false" style="transform:scale(${sc.toFixed(3)});transform-origin:50% 100%">` : ''}</div>
      <div class="ap-info">${badge ? `<span class="ap-badge">${badge}</span>` : ''}<b>${nameOf(lang, fac, u)}</b><small>${ROLE[u]?.[lang === 'ru' ? 1 : 0] ?? ''}</small>${champ && f.champion ? `<small class="ap-champ">${f.champion[lang]}</small>` : ''}${chips(lang, u)}</div>
    </div>`;
  }).join('');
  preload(fac, units);
  return `<div class="sheet"><div class="sheet-body setup ap" data-fac="${fac}" style="--fc:${f.color}">
    <h2><button data-act="ap-back" class="ghost back" aria-label="${t(lang, 'back')}">${back}</button><span class="ap-title">${f.name[lang]}</span>
      <span class="ap-nav"><button data-act="ap-prev" class="ghost" aria-label="${st(lang, 'prev')}">‹</button><button data-act="ap-next" class="ghost" aria-label="${st(lang, 'next')}">›</button></span></h2>
    <div class="sheet-scroll">
      <div class="ap-hero">
        <span class="ap-emblem" aria-hidden="true">${f.emblem}</span>
        <span class="ap-era">${t(lang, `era${era[0].toUpperCase()}${era.slice(1)}` as Key)} · ${units.length} ${st(lang, 'pieces')}</span>
        <p class="ap-blurb">${f.blurb[lang]}</p>
      </div>
      <div class="ap-turnbar"><button data-act="ap-turn" data-dir="-1" class="ghost" aria-label="${st(lang, 'turnL')}">⟲</button><small>${st(lang, 'dragTurn')}</small><button data-act="ap-turn" data-dir="1" class="ghost" aria-label="${st(lang, 'turnR')}">⟳</button></div>
      <div class="ap-units">${cards}</div>
    </div>
    ${choose ? `<div class="sheet-foot"><button data-act="faction" data-side="${choose.side}" data-value="${fac}" class="primary wide">${st(lang, 'chooseArmy')}</button></div>` : ''}
  </div></div>`;
}

/** The title screen's "Armies": every army as a tile, grouped by age; a tap opens its showcase. */
export function armyGallery(lang: Lang, back: string, pic: (fac: FactionId) => string): string {
  const groups = ERAS.filter((era) => READY_ARMIES().some((id) => ERA_OF[id] === era))
    .map((era) => `<h4 class="era">${t(lang, `era${era[0].toUpperCase()}${era.slice(1)}` as Key)}</h4><div class="ftiles">${READY_ARMIES()
      .filter((id) => ERA_OF[id] === era)
      .map((id) => `<button data-act="ap-open" data-value="${id}" class="ftile" style="--fc:${FACTIONS[id].color}">${pic(id) || FACTIONS[id].emblem}<span>${FACTIONS[id].name[lang]}</span></button>`)
      .join('')}</div>`).join('');
  return `<div class="sheet"><div class="sheet-body setup">
    <h2><button data-act="gallery-back" class="ghost back" aria-label="${t(lang, 'back')}">${back}</button>${st(lang, 'armies')}</h2>
    <div class="sheet-scroll"><p class="blurb" style="margin-top:6px">${st(lang, 'armiesSub')}</p>${groups}</div>
  </div></div>`;
}

/** Fetch the other turns of this army's figures only (one army at a time keeps a phone light). */
const preloaded = new Set<string>();
function preload(fac: FactionId, units: UnitTypeId[]) {
  if (preloaded.has(fac) || typeof Image === 'undefined') return;
  preloaded.add(fac);
  setTimeout(() => {
    for (const u of units) for (const v of VIEWS) {
      const src = figSrc(fac, u, v);
      if (src) new Image().src = src;
    }
  }, 400);
}

/** Turn every figure on the showcase by `d` eighths, in place (no full redraw). */
export function turnFigures(d: number, byHand = true) {
  view = (view + d + VIEWS.length) % VIEWS.length;
  if (byHand) autoPausedUntil = Date.now() + 8000;
  document.querySelectorAll<HTMLElement>('.ap-fig').forEach((el) => {
    const src = figSrc(el.dataset.fac!, el.dataset.type as UnitTypeId, VIEWS[view]);
    const im = el.querySelector('img');
    if (src && im && im.getAttribute('src') !== src) im.setAttribute('src', src);
  });
}

/** Drag a figure to turn it, swipe the header to change army, and a slow turn when left alone. Call once. */
export function initShowcase() {
  let drag: { x: number; y: number; done: number; fig: boolean } | null = null;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target as Element;
    if (!el.closest('.ap')) return;
    drag = { x: e.clientX, y: e.clientY, done: 0, fig: !!el.closest('.ap-fig') };
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag?.fig) return;
    const steps = Math.trunc((e.clientX - drag.x) / 34);
    if (steps !== drag.done) {
      turnFigures(drag.done - steps); // drag right turns the figure toward you from the left
      drag.done = steps;
    }
  });
  const end = (e: PointerEvent) => {
    if (drag && !drag.fig) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 50) document.querySelector<HTMLButtonElement>(`.ap [data-act="${dx < 0 ? 'ap-next' : 'ap-prev'}"]`)?.click();
    }
    drag = null;
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', () => (drag = null));
  // No turning on its own (David 2026-11-18): figures turn only when dragged or with the turn buttons.
}
