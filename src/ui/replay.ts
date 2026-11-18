// End-of-battle replay. A battle is recorded as its opening position (`state.start`, kept by the
// engine at the first roll) plus the log it already writes: every roll with its dice, every move,
// blow and end of turn. Replaying feeds the log back through the same pure rules, so the result is
// the exact same battle. Nothing here touches the live game: the replay is a list of separate states
// that main.ts shows on its board instead of the real one while the player watches.
//
// Also: the "Share" card, a small PNG drawn on a canvas (who won, both Kings, turns, pieces lost).

import { CONFIG, type GameConfig } from '../config';
import { attack, endTurn, moveUnit, reroll, rollDice, shoot, takeHex, unitAt, type GameState, type Hex, type LogEntry, type Player, type Result } from '../engine';
import { factionOf, sides } from './factions';
import { logText, playerName, reasonText, t, type Lang } from './i18n';
import { ART_VERSION, SPRITES } from './sprites';

// ---------- the pure part: rebuild every state of the battle ----------

export interface Frame {
  state: GameState;
  /** The log entries this step added (empty for the opening position). */
  entries: LogEntry[];
}

export interface Replay {
  frames: Frame[];
  /** Frame index where each turn begins (its first roll), in order. */
  turns: number[];
  /** True when every logged action replayed to the same result as the real battle. */
  complete: boolean;
}

/** True when a finished battle carries what a replay needs (older saves don't). */
export const canReplay = (s: GameState) => s.phase === 'over' && !!s.start && s.start.logAt <= s.log.length;

/** Dice that come up exactly as they did in the battle. */
function loaded(dice: number[], cfg: GameConfig): () => number {
  const q = [...dice];
  return () => ((q.shift() ?? 1) - 0.5) / cfg.dice.sides;
}

/** The action that wrote this log entry, run again on `s`. Null for entries that only follow another (a win). */
function redo(s: GameState, e: LogEntry, cfg: GameConfig): Result | null {
  switch (e.kind) {
    case 'roll':
      return e.reroll ? reroll(s, loaded(e.dice, cfg), cfg) : rollDice(s, loaded(e.dice, cfg), cfg);
    case 'move': {
      // A free step into a beaten piece's hex is logged without a path.
      if (!e.path && e.cost === 0 && s.advance) return takeHex(s);
      const u = unitAt(s, e.from);
      return u ? moveUnit(s, u.id, e.to, cfg) : { ok: false, error: 'noSuchUnit' };
    }
    case 'attack':
    case 'shoot': {
      const a = unitAt(s, e.from);
      const d = unitAt(s, e.at);
      if (!a || !d) return { ok: false, error: 'noSuchUnit' };
      return e.kind === 'attack' ? attack(s, a.id, d.id, cfg) : shoot(s, a.id, d.id, cfg);
    }
    case 'endTurn':
      return endTurn(s, cfg);
    default:
      return null;
  }
}

/** Every state of a finished battle, from its opening position to the end, one per action. */
export function buildReplay(final: GameState, cfg: GameConfig = CONFIG): Replay | null {
  if (!final.start) return null;
  const { logAt, ...opening } = final.start;
  let s: GameState = { ...opening, board: final.board, log: final.log.slice(0, logAt), start: final.start };
  const frames: Frame[] = [{ state: s, entries: [] }];
  const turns: number[] = [];
  let i = logAt;
  while (i < final.log.length) {
    const e = final.log[i];
    const r = redo(s, e, cfg);
    if (r === null) {
      i++;
      continue;
    }
    if (!r.ok) break;
    const added = r.state.log.slice(s.log.length);
    // The rules gave something else than the real battle (another version of them): stop here.
    if (!added.length || JSON.stringify(added) !== JSON.stringify(final.log.slice(i, i + added.length))) break;
    if (e.kind === 'roll' && !e.reroll) turns.push(frames.length);
    s = r.state;
    frames.push({ state: s, entries: added });
    i += added.length;
  }
  return { frames, turns, complete: i >= final.log.length };
}

// ---------- the player ----------

/** What main.ts lends the replay: its board, camera and the finished battle. */
export interface ReplayHost {
  /** The finished battle (the live game, never changed here). */
  live(): GameState;
  lang(): Lang;
  render(): void;
  /** The next render shows `s` as it stands, without playing what led to it. */
  settle(s: GameState): void;
  /** Glide the camera gently towards these hexes (only if they are away from the middle). */
  follow(hexes: Hex[], ms: number): void;
  /** Called when the replay opens (keep the camera) and closes (put it back, show the result). */
  begin(): void;
  end(): void;
}

const SPEEDS = [1, 2, 4];
/** One action at 1×, in ms. */
const STEP = 400;

interface Player_ {
  rp: Replay;
  i: number;
  playing: boolean;
  speed: number;
  timer: number | null;
  /** The turn banner ("Turn 3 · Romans") shows until this time. */
  bannerUntil: number;
}

let host: ReplayHost | null = null;
let P: Player_ | null = null;

export const replaying = () => P !== null;
/** The state to draw instead of the live game while a replay is open. */
export const replayState = (): GameState | null => (P ? P.rp.frames[P.i].state : null);

/** Strings the replay needs, kept here so the shared dictionary stays untouched. */
const TXT = {
  en: { watch: 'Watch replay', share: 'Share', exit: 'Exit replay', newGame: 'New game', play: 'Play', pause: 'Pause', speed: 'Speed', of: 'of', lost: 'Pieces lost', turns: 'Turns', title: 'Battle of Civilizations', saved: 'Picture saved', partial: 'Replay stops early: the rules changed since this battle.', next: 'Next turn', prev: 'Previous turn' },
  ru: { watch: 'Смотреть повтор', share: 'Поделиться', exit: 'Выйти из повтора', newGame: 'Новая игра', play: 'Играть', pause: 'Пауза', speed: 'Скорость', of: 'из', lost: 'Потеряно фигур', turns: 'Ходов', title: 'Битва цивилизаций', saved: 'Картинка сохранена', partial: 'Повтор обрывается: правила изменились после этой битвы.', next: 'Следующий ход', prev: 'Предыдущий ход' },
} as const;
const tx = (k: keyof (typeof TXT)['en']) => TXT[host?.lang() ?? 'en'][k];

/** Hooks the replay up to main.ts once, at start. */
export function initReplay(h: ReplayHost) {
  host = h;
  // Own listeners, so main.ts' click and key handling needs no changes.
  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest?.('[data-rp]');
    if (!el) return;
    e.stopPropagation();
    onControl(el.getAttribute('data-rp')!);
  }, true);
  document.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    if (!P || el.dataset?.rpScrub === undefined) return;
    e.stopPropagation();
    jumpTo(P.rp.turns[Number(el.value)] ?? 0, true);
  }, true);
  // While watching, the keyboard only drives the replay (so nothing reaches the finished game).
  window.addEventListener('keydown', (e) => {
    if (!P) return;
    e.stopImmediatePropagation();
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') (e.preventDefault(), onControl('play'));
    else if (k === 'escape') onControl('exit');
    else if (k === 'arrowright' || k === 'l') onControl('next');
    else if (k === 'arrowleft' || k === 'j') onControl('prev');
  }, true);
}

/** The buttons under the result: watch the replay and share the card. */
export function resultButtons(s: GameState): string {
  if (!canReplay(s)) return '';
  return `<div class="rp-result">
    <button data-rp="start" class="wide rp-watch"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg><span>${tx('watch')}</span></button>
    <button data-rp="share" class="ghost rp-share" aria-label="${tx('share')}" title="${tx('share')}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 13v6h14v-6"/></svg><span>${tx('share')}</span></button>
  </div>`;
}

function onControl(act: string) {
  if (!host) return;
  if (act === 'start') return start();
  if (act === 'share') return void shareCard(host.live(), host.lang());
  if (!P) return;
  if (act === 'exit') return stop();
  if (act === 'new') {
    // Leave the replay, then the result screen's New game (David 2026-11-18: there was no way out to a new game).
    stop();
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-act="restart"]')?.click());
    return;
  }
  if (act === 'play') {
    if (!P.playing && P.i >= P.rp.frames.length - 1) jumpTo(0, false);
    P.playing = !P.playing;
    host.render();
    return schedule();
  }
  if (act === 'speed') {
    P.speed = SPEEDS[(SPEEDS.indexOf(P.speed) + 1) % SPEEDS.length];
    host.render();
    return schedule();
  }
  if (act === 'next' || act === 'prev') {
    const k = turnIndex(P.i) + (act === 'next' ? 1 : P.i > (P.rp.turns[turnIndex(P.i)] ?? 0) ? 0 : -1);
    return jumpTo(P.rp.turns[Math.max(0, Math.min(P.rp.turns.length - 1, k))] ?? 0, true);
  }
}

function start() {
  if (!host || P) return;
  const rp = buildReplay(host.live());
  if (!rp || rp.frames.length < 2) return;
  P = { rp, i: 0, playing: true, speed: 1, timer: null, bannerUntil: 0 };
  document.body.classList.add('replaying');
  host.begin();
  host.settle(rp.frames[0].state);
  host.render();
  schedule(700);
}

function stop() {
  if (!host || !P) return;
  if (P.timer !== null) clearTimeout(P.timer);
  P = null;
  document.body.classList.remove('replaying');
  host.settle(host.live());
  host.end();
  host.render();
}

/** Which turn frame `i` belongs to (index into `turns`). */
function turnIndex(i: number): number {
  if (!P) return 0;
  let k = 0;
  P.rp.turns.forEach((f, n) => { if (f <= i) k = n; });
  return k;
}

/** Shows frame `i` straight away (scrubbing), without animating the steps in between. */
function jumpTo(i: number, banner: boolean) {
  if (!host || !P) return;
  P.i = Math.max(0, Math.min(P.rp.frames.length - 1, i));
  const st = P.rp.frames[P.i].state;
  P.bannerUntil = banner ? Date.now() + 1200 : 0;
  host.settle(st);
  const hexes = units(P.rp.frames[P.i].entries);
  if (hexes.length) host.follow(hexes, 500);
  host.render();
  schedule();
}

/** Hexes where an action happened, for the camera. */
function units(entries: LogEntry[]): Hex[] {
  const out: Hex[] = [];
  for (const e of entries) {
    if (e.kind === 'move') out.push(e.from, e.to);
    if (e.kind === 'attack' || e.kind === 'shoot') out.push(e.from, e.at);
  }
  return out;
}

function schedule(first?: number) {
  if (!P) return;
  if (P.timer !== null) clearTimeout(P.timer);
  P.timer = null;
  if (!P.playing) return;
  // Long walks get a little longer so the piece reaches its hex before the next action.
  const next = P.rp.frames[P.i + 1];
  const walk = next?.entries[0]?.kind === 'move' ? Math.min(900, (next.entries[0].path?.length ?? 1) * 130) : 0;
  const ms = first ?? Math.max(STEP, walk) / P.speed;
  P.timer = window.setTimeout(step, ms);
}

function step() {
  if (!host || !P) return;
  P.timer = null;
  if (P.i >= P.rp.frames.length - 1) {
    P.playing = false;
    host.render();
    return;
  }
  P.i++;
  const f = P.rp.frames[P.i];
  if (P.rp.turns.includes(P.i)) P.bannerUntil = Date.now() + 1300 / Math.sqrt(P.speed);
  const hexes = units(f.entries);
  if (hexes.length) host.follow(hexes, 600 / P.speed);
  host.render();
  schedule();
}

/** The replay's controls, drawn by main.ts over its footer while a replay is open. */
export function replayControls(): string {
  if (!P || !host) return '';
  const lang = host.lang();
  const f = P.rp.frames[P.i];
  const s = f.state;
  const k = turnIndex(P.i);
  const last = f.entries.find((e) => e.kind !== 'win') ?? f.entries[0];
  const what = last ? `<b class="${last.player}">${playerName(lang, last.player)}</b> ${logText(lang, last)}` : '';
  const done = P.i >= P.rp.frames.length - 1;
  const banner = P.bannerUntil > Date.now()
    ? `<div class="rp-banner ${s.current}" aria-live="polite"><span>${t(lang, 'turn')} ${s.turn}</span><b>${playerName(lang, s.current)}</b></div>`
    : '';
  const play = P.playing
    ? `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z" fill="currentColor"/></svg>`
    : `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>`;
  const top = `<div class="rp-top"><button data-rp="exit" class="ghost">✕ ${tx('exit')}</button><button data-rp="new" class="primary">${tx('newGame')}</button></div>`;
  return `${banner}${top}<div class="rp-bar" role="toolbar" aria-label="Replay">
    <div class="rp-line">
      <button data-rp="exit" class="ghost rp-exit" aria-label="${tx('exit')}" title="${tx('exit')} (Esc)"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button data-rp="play" class="rp-play" aria-label="${P.playing ? tx('pause') : tx('play')}" title="${P.playing ? tx('pause') : tx('play')} (Space)">${play}</button>
      <div class="rp-scrub">
        <div class="rp-turn"><span>${t(lang, 'turn')} <b>${s.turn}</b></span><span class="rp-what">${what}</span></div>
        <input type="range" data-rp-scrub min="0" max="${Math.max(0, P.rp.turns.length - 1)}" step="1" value="${k}" aria-label="${t(lang, 'turn')}" style="--fill:${P.rp.turns.length > 1 ? (k / (P.rp.turns.length - 1)) * 100 : 100}%">
      </div>
      <button data-rp="speed" class="ghost rp-speed" aria-label="${tx('speed')} ${P.speed}×" title="${tx('speed')}">${P.speed}×</button>
    </div>
    ${done && !P.rp.complete ? `<p class="rp-note">${tx('partial')}</p>` : ''}
  </div>`;
}

// ---------- the share card ----------

/** Pieces each side lost in the battle. */
function lost(s: GameState, p: Player): number {
  const before = s.start?.units.filter((u) => u.owner === p).length ?? 0;
  return Math.max(0, before - s.units.filter((u) => u.owner === p).length);
}

function kingUrl(p: Player): string | null {
  const id = sides[p];
  const set = SPRITES[id]?.king;
  if (!set) return null;
  const v = set['front-left'] ? 'front-left' : set.front ? 'front' : Object.keys(set)[0];
  return v ? `${import.meta.env.BASE_URL}pieces/${id}/king-${v}.webp?v=${ART_VERSION}` : null;
}

function loadImg(src: string | null): Promise<HTMLImageElement | null> {
  return new Promise((done) => {
    if (!src) return done(null);
    const im = new Image();
    im.onload = () => done(im);
    im.onerror = () => done(null);
    im.src = src;
  });
}

/** Draws the summary card: 1200 × 630, the size link previews use. */
export async function drawCard(s: GameState, lang: Lang): Promise<HTMLCanvasElement> {
  const W = 1200;
  const H = 630;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const w = s.winner ?? 'red';
  const sides: Player[] = [w, w === 'red' ? 'blue' : 'red'];
  const fw = factionOf(w);
  try { await document.fonts?.load('64px Kurale'); } catch { /* the fallback serif will do */ }

  // Dark leather, lit from the winner's colour.
  const bg = g.createRadialGradient(W / 2, 120, 40, W / 2, 260, 760);
  bg.addColorStop(0, mix(fw.color, '#1f1a16', 0.45));
  bg.addColorStop(1, '#14110e');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#c99a00';
  g.lineWidth = 4;
  g.strokeRect(18, 18, W - 36, H - 36);

  g.textAlign = 'center';
  g.fillStyle = '#b3a585';
  g.font = '700 26px "PT Sans", system-ui, sans-serif';
  g.fillText(`${tx('title')} · ${t(lang, 'victory')}`.toUpperCase(), W / 2, 72);
  g.fillStyle = '#f1e8d2';
  g.font = '64px Kurale, "PT Serif", Georgia, serif';
  g.fillText(playerName(lang, w), W / 2, 148);
  g.fillStyle = '#d8ccb0';
  g.font = '28px "PT Serif", Georgia, serif';
  g.fillText(`${s.winReason ? reasonText(lang, s.winReason) : ''} · ${t(lang, 'onTurn')} ${s.turn}`, W / 2, 196);

  const kings = await Promise.all(sides.map((p) => loadImg(kingUrl(p))));
  sides.forEach((p, n) => {
    const cx = n === 0 ? 330 : W - 330;
    const f = factionOf(p);
    // A plinth in the army's colour, the King standing on it.
    g.fillStyle = 'rgba(0, 0, 0, .45)';
    g.beginPath();
    g.ellipse(cx, 462, 112, 28, 0, 0, Math.PI * 2);
    g.fill();
    const im = kings[n];
    if (im) {
      const h = 250;
      const wd = (im.naturalWidth / im.naturalHeight) * h;
      g.drawImage(im, cx - wd / 2, 470 - h + 6, wd, h);
    } else {
      g.fillStyle = f.color;
      g.beginPath();
      g.arc(cx, 380, 70, 0, Math.PI * 2);
      g.fill();
    }
    if (p === w) {
      // A gold ring under the winner's King.
      g.strokeStyle = '#c99a00';
      g.lineWidth = 4;
      g.beginPath();
      g.ellipse(cx, 462, 120, 32, 0, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = p === w ? '#f1e8d2' : '#b3a585';
    g.font = '36px Kurale, "PT Serif", Georgia, serif';
    g.fillText(playerName(lang, p), cx, 545);
    g.font = '24px "PT Sans", system-ui, sans-serif';
    g.fillStyle = '#b3a585';
    g.fillText(`${tx('lost')}: ${lost(s, p)}`, cx, 582);
  });
  // The battle in the middle: how many turns.
  g.fillStyle = '#f1e8d2';
  g.font = '96px Kurale, "PT Serif", Georgia, serif';
  g.fillText(String(s.turn), W / 2, 420);
  g.fillStyle = '#b3a585';
  g.font = '700 24px "PT Sans", system-ui, sans-serif';
  g.fillText(tx('turns').toUpperCase(), W / 2, 456);
  return cv;
}

/** Blends two #rrggbb colours (t = share of the second). */
function mix(a: string, b: string, k: number): string {
  const p = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [x, y] = [p(/^#[0-9a-f]{6}$/i.test(a) ? a : '#555555'), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * k)).join(',')})`;
}

/** Makes the card and offers it through the phone's share sheet, or saves it as a file. */
export async function shareCard(s: GameState, lang: Lang) {
  const cv = await drawCard(s, lang);
  const blob = await new Promise<Blob | null>((done) => cv.toBlob(done, 'image/png'));
  if (!blob) return;
  const name = `battle-${playerName('en', s.winner ?? 'red').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-turn-${s.turn}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: tx('title') });
      return;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
