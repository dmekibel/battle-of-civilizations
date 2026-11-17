// The computer opponent, at three levels. Each call looks at every legal action for the side to move
// and returns the best one by a hand-written score, or null when nothing is worth the points (then
// the caller ends the turn). Normal is greedy, one step at a time. Easy is Normal with chance and
// slack mixed in. Hard plans whole kills for the points it has and weighs every option against what
// the enemy can do back next turn (see "difficulty levels" below).

import { CONFIG, type GameConfig, type UnitTypeId } from '../config';
import { distance, key, neighbors, type Hex } from './hex';
import { armyValue, attack, canReroll, getUnit, previewStrike, weatherRange, endTurn, hasLineOfSight, kingCapturedBy, maxHp, maxRangeAt, kingOf, moveUnit, onBoard, other, reachable, reroll, rollDice, shoot, strikeTargets, takeHex, terrainAt, type Rng } from './game';
import type { GameState, Player, Result, Unit } from './types';

export type AiAction =
  | { kind: 'move'; unitId: string; to: Hex }
  | { kind: 'attack' | 'shoot'; unitId: string; targetId: string }
  | { kind: 'take' }
  | { kind: 'reroll' };

/** How much a piece is worth: its price, and the King above everything. */
function worth(type: UnitTypeId, cfg: GameConfig): number {
  return type === 'king' ? 100 : cfg.army.cost[type];
}

function strikeScore(target: Unit, damage: number, cfg: GameConfig): number {
  if (damage >= target.hp) return target.type === 'king' ? 10000 : 40 + 12 * worth(target.type, cfg);
  return 8 * damage + 2 * worth(target.type, cfg);
}

/** Enemies that could hit a piece standing on `at` next turn (adjacent ones only). */
function danger(s: GameState, u: Unit, at: Hex, cfg: GameConfig): number {
  let d = 0;
  for (const e of s.units) {
    if (e.owner === u.owner) continue;
    const dist = distance(e.pos, at);
    if (dist === 1) d += cfg.units[e.type].attack;
    const r = cfg.units[e.type].ranged;
    if (r && dist >= r.minRange && dist <= r.maxRange) d += r.damage * 0.5;
  }
  return d;
}

/** Best follow-up hit from `at` with the points left after getting there. */
function bestHitFrom(s: GameState, u: Unit, at: Hex, pointsLeft: number, cfg: GameConfig): number {
  const r = cfg.units[u.type];
  let best = 0;
  for (const e of s.units) {
    if (e.owner === u.owner) continue;
    const d = distance(at, e.pos);
    if (r.attack > 0 && d === 1 && pointsLeft >= cfg.combat.attackCost) best = Math.max(best, strikeScore(e, r.attack, cfg));
    if (r.ranged && d >= r.ranged.minRange && d <= maxRangeAt(s, at, r.ranged.maxRange, cfg) && pointsLeft >= r.ranged.cost && hasLineOfSight(s, at, e.pos, cfg)) {
      best = Math.max(best, strikeScore(e, r.ranged.damage, cfg));
    }
  }
  return best;
}

/** Hex this piece is heading for: archers and the King hang back, everyone else marches on the enemy King. */
function goalFor(s: GameState, u: Unit): Hex | null {
  const enemyKing = kingOf(s, other(u.owner));
  const enemies = s.units.filter((e) => e.owner !== u.owner);
  if (!enemies.length) return null;
  const nearest = enemies.reduce((a, b) => (distance(u.pos, b.pos) < distance(u.pos, a.pos) ? b : a));
  // Cavalry and infantry go for the King once they are close to the fight, otherwise the nearest enemy.
  if (enemyKing && distance(u.pos, enemyKing.pos) <= distance(u.pos, nearest.pos) + 4) return enemyKing.pos;
  return nearest.pos;
}

/** Steps from every hex to `goal` walking around forest and over bridges (pieces ignored). */
function pathField(s: GameState, goal: Hex, cfg: GameConfig): Map<string, number> {
  const dist = new Map<string, number>([[key(goal), 0]]);
  const queue = [goal];
  for (let i = 0; i < queue.length; i++) {
    const h = queue[i];
    const d = dist.get(key(h))!;
    for (const n of neighbors(h)) {
      if (!onBoard(s, n) || dist.has(key(n)) || !cfg.terrain[terrainAt(s, n)].passable) continue;
      dist.set(key(n), d + 1);
      queue.push(n);
    }
  }
  return dist;
}

type Fields = Map<string, { dist: Map<string, number>; line: number }>;

/** Path field towards `goal`, plus how far the army's middle (median piece) is from it. */
function fieldFor(s: GameState, u: Unit, goal: Hex, cfg: GameConfig, fields: Fields) {
  let f = fields.get(key(goal));
  if (!f) {
    const dist = pathField(s, goal, cfg);
    const own = s.units.filter((x) => x.owner === u.owner && x.type !== 'king').map((x) => dist.get(key(x.pos)) ?? 99).sort((a, b) => a - b);
    f = { dist, line: own.length ? own[Math.floor(own.length / 2)] : 0 };
    fields.set(key(goal), f);
  }
  return f;
}

/** The turn of the last attack or shot (0 if none yet). */
function lastFight(s: GameState): number {
  for (let i = s.log.length - 1; i >= 0; i--) {
    const e = s.log[i];
    if (e.kind === 'attack' || e.kind === 'shoot') return e.turn;
  }
  return 0;
}

function moveScore(s: GameState, u: Unit, to: Hex, cost: number, cfg: GameConfig, fields: Fields): number {
  const left = s.points - cost;
  const rules = cfg.units[u.type];
  if (u.type === 'king') {
    // The King only moves to get out of reach.
    const now = danger(s, u, u.pos, cfg);
    const then = danger(s, u, to, cfg);
    return now > 0 ? (now - then) * 30 - cost : -1;
  }
  const hit = bestHitFrom(s, u, to, left, cfg);
  if (hit > 0) return hit * 0.9 - cost * 0.3 - danger(s, u, to, cfg) * (worth(u.type, cfg) / 2);
  const goal = goalFor(s, u);
  if (!goal) return -1;
  const { dist, line } = fieldFor(s, u, goal, cfg, fields);
  const after = dist.get(key(to)) ?? Infinity;
  const gain = (dist.get(key(u.pos)) ?? Infinity) - after;
  if (!(gain > 0)) return -1;
  // March as an army: pieces running far ahead of the middle of their own line are held back.
  const quiet = s.turn - lastFight(s);
  const caution = Math.max(0, 1 - Math.max(0, quiet - 3) / 4);
  const ahead = Math.max(0, line - after - 3) * caution;
  // Archers stop at shooting range rather than walking into the enemy line.
  if (rules.ranged && distance(to, goal) < rules.ranged.minRange) return -1;
  // Caution fades as a quiet battle drags on, so two careful armies never just stare at each other.
  const risk = danger(s, u, to, cfg) >= u.hp ? worth(u.type, cfg) * 2 * caution : 0;
  return gain * 2 - cost * 0.15 - risk - ahead * 2.5;
}

/** How well the computer plays. Normal is the original greedy player; Easy and Hard are built on it below. */
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

/** The next action for the side to move at this difficulty, or null to end the turn. The same state
 *  always gives the same answer (Easy's randomness comes from the position itself). */
export function aiNextAction(s: GameState, cfg: GameConfig = CONFIG, level: Difficulty = 'normal'): AiAction | null {
  if (level === 'easy') return easyAction(s, cfg);
  if (level === 'hard') return hardAction(s, cfg);
  return normalAction(s, cfg);
}

/** Normal: the single best action by the hand-written score, or null to end the turn. */
function normalAction(s: GameState, cfg: GameConfig): AiAction | null {
  if (s.phase !== 'act') return null;
  if (s.advance) return { kind: 'take' };
  // A poor roll (below 9) is worth throwing again when a reroll is left.
  if (canReroll(s, cfg) && (s.dice ?? []).reduce((a, b) => a + b, 0) < 3 * cfg.dice.count) return { kind: 'reroll' };
  let best: AiAction | null = null;
  let bestScore = 0.5; // anything below this is not worth the points

  const mine = s.units.filter((u) => u.owner === s.current);
  for (const u of mine) {
    for (const { targetId, preview } of strikeTargets(s, u.id, cfg)) {
      const target = s.units.find((e) => e.id === targetId)!;
      const score = strikeScore(target, preview.damage, cfg) - preview.cost * 0.2;
      if (score > bestScore) [best, bestScore] = [{ kind: preview.kind, unitId: u.id, targetId }, score];
    }
  }
  const fields: Fields = new Map();
  for (const u of mine) {
    for (const { hex, cost } of reachable(s, u.id, cfg).values()) {
      const score = moveScore(s, u, hex, cost, cfg, fields);
      if (score > bestScore) [best, bestScore] = [{ kind: 'move', unitId: u.id, to: hex }, score];
    }
  }
  return best;
}

/** Applies an action chosen by aiNextAction. */
export function applyAi(s: GameState, a: AiAction, cfg: GameConfig = CONFIG, rng: Rng = Math.random): Result {
  switch (a.kind) {
    case 'reroll':
      return reroll(s, rng, cfg);
    case 'move':
      return moveUnit(s, a.unitId, a.to, cfg);
    case 'attack':
      return attack(s, a.unitId, a.targetId, cfg);
    case 'shoot':
      return shoot(s, a.unitId, a.targetId, cfg);
    case 'take':
      return takeHex(s);
  }
}

/** A whole computer turn in one go: roll, act until nothing is worth doing, end the turn. */
export function playAiTurn(s: GameState, rng: Rng = Math.random, cfg: GameConfig = CONFIG, level: Difficulty = 'normal'): GameState {
  let r = rollDice(s, rng, cfg);
  if (!r.ok) return s;
  let state = r.state;
  for (let i = 0; i < 100 && state.phase === 'act'; i++) {
    const a = aiNextAction(state, cfg, level);
    if (!a) break;
    r = applyAi(state, a, cfg, rng);
    if (!r.ok) break;
    state = r.state;
  }
  if (state.phase !== 'act') return state;
  r = endTurn(state, cfg);
  return r.ok ? r.state : state;
}

// ---------- difficulty levels ----------

interface Scored {
  action: AiAction;
  score: number;
  unit: Unit;
  /** Strikes: the target and the predicted blow. */
  target?: Unit;
  damage?: number;
  /** Moves: where to and for how much. */
  to?: Hex;
  cost?: number;
}

/** Every strike and move Normal would consider, with Normal's own score (same loops as normalAction). */
function normalCandidates(s: GameState, cfg: GameConfig): Scored[] {
  const out: Scored[] = [];
  const mine = s.units.filter((u) => u.owner === s.current);
  for (const u of mine) {
    for (const { targetId, preview } of strikeTargets(s, u.id, cfg)) {
      const target = s.units.find((e) => e.id === targetId)!;
      out.push({ action: { kind: preview.kind, unitId: u.id, targetId }, score: strikeScore(target, preview.damage, cfg) - preview.cost * 0.2, unit: u, target, damage: preview.damage });
    }
  }
  const fields: Fields = new Map();
  for (const u of mine) {
    for (const { hex, cost } of reachable(s, u.id, cfg).values()) {
      out.push({ action: { kind: 'move', unitId: u.id, to: hex }, score: moveScore(s, u, hex, cost, cfg, fields), unit: u, to: hex, cost });
    }
  }
  return out;
}

/** A number in [0, 1) that depends only on the position (and `salt`), so the same state always plays the same way. */
function positionNoise(s: GameState, salt: number): number {
  let h = 2166136261 ^ salt;
  const mix = (n: number) => {
    h ^= n;
    h = Math.imul(h, 16777619);
  };
  mix(s.turn);
  mix(s.points);
  mix(s.log.length);
  for (const u of s.units) {
    mix(u.pos.col * 64 + u.pos.row);
    mix(u.hp);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Easy: picks among decent moves with a good deal of chance, hits whatever is handy instead of finishing
 *  wounded pieces, barely guards its King, keeps poor rolls and sometimes ends its turn with points unspent.
 *  It still never walks into anything silly: every option it picks is one Normal also rates as worth doing. */
function easyAction(s: GameState, cfg: GameConfig): AiAction | null {
  if (s.phase !== 'act') return null;
  if (s.advance) return { kind: 'take' };
  // Only a truly awful roll is thrown again.
  if (canReroll(s, cfg) && (s.dice ?? []).reduce((a, b) => a + b, 0) < 2 * cfg.dice.count + 1) return { kind: 'reroll' };
  const list = normalCandidates(s, cfg).filter((c) => c.score > 0.5);
  if (!list.length) return null;
  // Killing the King when it is right there is not a mistake even a beginner makes.
  const kingKill = list.find((c) => c.target?.type === 'king' && c.damage! >= c.target.hp);
  if (kingKill) return kingKill.action;
  const strikes = list.some((c) => c.target);
  // Now and then it simply stops for the turn while there are no blows to strike.
  if (!strikes && positionNoise(s, 1) < 0.3) return null;
  let best: Scored | null = null;
  let bestScore = -Infinity;
  list.forEach((c, i) => {
    const r = positionNoise(s, 100 + i);
    let score: number;
    if (c.target) score = 30 + 4 * c.damage! + 30 * r; // no favourites: a scratch is as good as a kill
    else if (c.unit.type === 'king') score = r < 0.7 ? -Infinity : c.score; // the King mostly stays where he is
    else score = Math.min(c.score, 40) * (0.3 + r);
    if (score > bestScore) [best, bestScore] = [c, score];
  });
  return best && bestScore > 0.5 ? (best as Scored).action : null;
}

// ----- Hard -----

/** Chance that a turn's points reach at least `need`, for this dice setup plus a fixed `extra`. */
function chanceAtLeast(need: number, extra: number, cfg: GameConfig): number {
  if (cfg.dice.fixed) return cfg.dice.fixed + extra >= need ? 1 : 0;
  let dist = [1];
  for (let i = 0; i < cfg.dice.count; i++) {
    const next: number[] = [];
    dist.forEach((p, sum) => {
      for (let f = 1; f <= cfg.dice.sides; f++) next[sum + f] = (next[sum + f] ?? 0) + p / cfg.dice.sides;
    });
    dist = next;
  }
  let p = 0;
  dist.forEach((q, sum) => {
    if (sum + extra >= need) p += q ?? 0;
  });
  return p;
}

/** One enemy piece's reach for its next turn: where it can stand and what that costs. */
interface Reacher {
  u: Unit;
  cost: Map<string, number>;
  /** Cheapest cost to melee / shoot each hex, worked out on demand. */
  melee: Map<string, number>;
  field?: { near: Float64Array; far: Float64Array };
}

/** What the side that just moved can expect the other side to do to it next turn. */
interface Threat {
  me: Player;
  foe: Player;
  reachers: Reacher[];
  /** Points the enemy will most likely have, and what it adds on top of its dice. */
  avg: number;
  extra: number;
  /** Kill costs already worked out, by piece, place and health. */
  cache: Map<string, number>;
}

function threatOf(s: GameState, me: Player, cfg: GameConfig): Threat {
  const foe = other(me);
  // The enemy's next turn as it will look: its pieces fresh, plenty of points to see their full reach.
  const hs: GameState = {
    ...s,
    current: foe,
    phase: 'act',
    points: 99,
    advance: null,
    units: s.units.map((u) => (u.owner === foe ? { ...u, moved: false, attacked: false, ran: 0 } : u)),
  };
  const reachers: Reacher[] = [];
  for (const u of hs.units) {
    if (u.owner !== foe) continue;
    const cost = new Map<string, number>([[key(u.pos), 0]]);
    for (const [k, r] of reachable(hs, u.id, cfg)) cost.set(k, r.cost);
    reachers.push({ u, cost, melee: new Map() });
  }
  const extra = Math.min(cfg.options.carryMax, s.carry?.[foe] ?? 0) + (foe === 'blue' && s.turn === 1 ? cfg.options.firstTurnBonus : 0);
  const avg = (cfg.dice.fixed ?? cfg.dice.count * (cfg.dice.sides + 1) / 2) + extra;
  return { me, foe, reachers, avg, extra, cache: new Map() };
}

/** Cheapest points for reacher `r` to stand next to hex `h` (Infinity if it can't). */
function meleeReach(r: Reacher, h: Hex): number {
  const k = key(h);
  let c = r.melee.get(k);
  if (c === undefined) {
    c = Infinity;
    for (const n of neighbors(h)) c = Math.min(c, r.cost.get(key(n)) ?? Infinity);
    r.melee.set(k, c);
  }
  return c;
}

/** For a shooter: the cheapest points to get within shooting range of every hex (`near` = within the
 *  normal-price range, `far` = full range), spreading its reach outwards one ring at a time.
 *  Sight lines are not checked: close enough for judging danger, and quick. */
function shotField(s: GameState, r: Reacher, cfg: GameConfig): { near: Float64Array; far: Float64Array } {
  if (r.field) return r.field;
  const rows = s.board.length;
  const cols = s.board[0].length;
  let f = new Float64Array(rows * cols).fill(Infinity);
  for (const [hk, c] of r.cost) {
    const [col, row] = hk.split(',').map(Number);
    f[row * cols + col] = c;
  }
  const rg = cfg.units[r.u.type].ranged!;
  const max = weatherRange(rg.maxRange, cfg);
  const cheap = Math.min(max, cfg.options.longShotFrom ?? max);
  let near = f;
  for (let step = 1; step <= max; step++) {
    const g = f.slice();
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        let m = g[row * cols + col];
        for (const n of neighbors({ col, row })) if (n.row >= 0 && n.row < rows && n.col >= 0 && n.col < cols) m = Math.min(m, f[n.row * cols + n.col]);
        g[row * cols + col] = m;
      }
    f = g;
    if (step === cheap) near = f;
  }
  r.field = { near, far: f };
  return r.field;
}

const shielded = (s: GameState, t: Unit, cfg: GameConfig) =>
  cfg.options.shieldWall && t.type === 'heavyInfantry' && s.units.some((f) => f.id !== t.id && f.owner === t.owner && f.type === 'heavyInfantry' && distance(f.pos, t.pos) === 1);

/** Points the enemy needs to kill piece `t` where it stands in `s` (Infinity if it can't). */
function killCost(s: GameState, t: Unit, th: Threat, cfg: GameConfig, dead: Set<string>): number {
  const guard = cfg.terrain[terrainAt(s, t.pos)].defenseBonus + (shielded(s, t, cfg) ? 1 : 0);
  const tm = !!cfg.units[t.type].mounted;
  let best = Infinity;
  for (const r of th.reachers) {
    if (dead.has(r.u.id)) continue;
    const rules = cfg.units[r.u.type];
    if (rules.attack > 0) {
      const dmg = rules.attack * (rules.antiCavalry && tm ? 2 : 1) - guard;
      if (dmg > 0) best = Math.min(best, meleeReach(r, t.pos) + Math.ceil(t.hp / dmg) * cfg.combat.attackCost);
    }
    const rg = rules.ranged;
    if (rg && !(cfg.options.volleys !== null && (r.u.shots ?? 0) >= cfg.options.volleys)) {
      const dmg = Math.max(rg.damage, Math.ceil(maxHp(t.type, cfg) / 2)) - guard;
      if (dmg > 0) {
        const { near, far } = shotField(s, r, cfg);
        const i = t.pos.row * s.board[0].length + t.pos.col;
        const hits = Math.ceil(t.hp / dmg) * rg.cost;
        best = Math.min(best, near[i] + hits, far[i] + hits * (cfg.options.longShotFrom !== null ? 2 : 1));
      }
    }
  }
  return best;
}

const GAME_LOST = 20000;
/** How much Hard minds the pieces it may lose next turn (the King and a rout always count in full). */
const PIECE_W = 0.2;
/** What one point is worth when choosing between kills (cheaper kills first). */
const POINT_W = 3;

/** Kill value of a piece, on the same scale as Normal's strike score. */
const killValue = (t: Unit, cfg: GameConfig) => 40 + 12 * worth(t.type, cfg);

/** How much the side `th.me` can expect to lose on the enemy's next turn if its pieces stand as in `s`:
 *  the King (killed or captured, weighed by the chance the dice allow it) plus the pieces a greedy enemy
 *  can afford to kill with an average roll. `dead` = enemy pieces no longer there. */
function expectedLoss(s: GameState, th: Threat, cfg: GameConfig, dead: Set<string> = new Set()): number {
  const mine = s.units.filter((u) => u.owner === th.me);
  const king = mine.find((u) => u.type === 'king');
  const costs = new Map<string, number>();
  const costOf = (u: Unit) => {
    let c = costs.get(u.id);
    if (c === undefined) {
      // Pieces that haven't moved keep their cost between the options weighed in one decision.
      const k = dead.size ? '' : `${u.id}@${u.pos.col},${u.pos.row}#${u.hp}#${shielded(s, u, cfg) ? 1 : 0}`;
      c = k ? th.cache.get(k) : undefined;
      if (c === undefined) {
        c = killCost(s, u, th, cfg, dead);
        if (k) th.cache.set(k, c);
      }
      costs.set(u.id, c);
    }
    return c;
  };
  let loss = 0;
  if (king) {
    const guards = mine.filter((u) => u.id !== king.id && distance(u.pos, king.pos) === 1);
    // Every guard must fall before the King can be struck (King's guard) or captured.
    const clear = guards.reduce((a, g) => a + costOf(g), 0);
    let need = Infinity;
    if (cfg.win.killKing) need = (cfg.options.kingsGuard ? clear : 0) + costOf(king);
    if (cfg.win.captureKing) {
      let near = Infinity;
      for (const r of th.reachers) if (!dead.has(r.u.id)) near = Math.min(near, meleeReach(r, king.pos));
      need = Math.min(need, clear + near);
    }
    if (need < Infinity) loss += (GAME_LOST * chanceAtLeast(need, th.extra, cfg)) / PIECE_W;
  }
  // The rest: the enemy picks off what it can afford, best value for points first.
  const options = mine
    .filter((u) => u.type !== 'king')
    .map((u) => ({ u, c: Math.max(1, costOf(u)), v: killValue(u, cfg) }))
    .filter((o) => o.c <= th.avg)
    .sort((a, b) => b.v / b.c - a.v / a.c);
  let budget = th.avg;
  let lostWorth = 0;
  for (const o of options) {
    if (o.c > budget) continue;
    budget -= o.c;
    loss += o.v;
    lostWorth += worth(o.u.type, cfg);
  }
  // Morale: losses that would break the army lose the battle.
  if (cfg.options.routAt !== null && s.startValue) {
    const start = s.startValue[th.me];
    const already = start - armyValue(s, th.me, cfg);
    if (start > 0 && already + lostWorth >= cfg.options.routAt * start) loss += (GAME_LOST * 0.5) / PIECE_W;
  }
  return loss;
}

/** Hex this piece should head for (Hard): like Normal, but the King and shooters keep behind the line. */
function hardMarch(s: GameState, u: Unit, to: Hex, cost: number, cfg: GameConfig, fields: Fields): number {
  const goal = goalFor(s, u);
  if (!goal) return 0;
  const { dist, line } = fieldFor(s, u, goal, cfg, fields);
  const after = dist.get(key(to)) ?? Infinity;
  const gain = (dist.get(key(u.pos)) ?? Infinity) - after;
  if (!Number.isFinite(gain)) return -5;
  const quiet = s.turn - lastFight(s);
  const caution = Math.max(0, 1 - Math.max(0, quiet - 3) / 4);
  const ahead = Math.max(0, line - after - 3) * caution;
  const rules = cfg.units[u.type];
  // Shooters like to stand where they can shoot next turn, ideally from high ground.
  let place = 0;
  if (rules.ranged) {
    if (distance(to, goal) < rules.ranged.minRange) return -5;
    if (cfg.terrain[terrainAt(s, to)].highGround) place += 3;
  }
  return gain * 2 - cost * 0.15 - ahead * 2.5 + place;
}

const hardMemo = new WeakMap<GameState, AiAction | null>();

/** Hard: Normal's ideas, but every option is weighed against what the enemy can do back next turn
 *  (which pieces it can reach and kill with an average roll, and whether the King can be killed or
 *  captured on any roll). It finishes wounded and dangerous pieces first, keeps a guard by its King,
 *  keeps shooters out of reach, uses gates and hills, goes for a King capture when one is open and
 *  avoids blows that cost it more than they win. */
function hardAction(s: GameState, cfg: GameConfig): AiAction | null {
  if (s.phase !== 'act') return null;
  if (s.advance) return { kind: 'take' };
  const cached = hardMemo.get(s);
  if (cached !== undefined) return cached;
  const a = hardDecide(s, cfg);
  hardMemo.set(s, a);
  return a;
}

function hardDecide(s: GameState, cfg: GameConfig): AiAction | null {
  const me = s.current;
  const foe = other(me);
  if (canReroll(s, cfg) && (s.dice ?? []).reduce((a, b) => a + b, 0) < 3 * cfg.dice.count) return { kind: 'reroll' };
  // A capture is already set up: ending the turn now wins (unless the King can simply be struck down first).
  const captured = cfg.win.captureKing && kingCapturedBy(s, me);
  if (captured && !s.units.some((u) => u.owner === me && strikeTargets(s, u.id, cfg).some((t) => t.preview.kills && getUnit(s, t.targetId)?.type === 'king'))) return null;
  const th = threatOf(s, me, cfg);
  const base = expectedLoss(s, th, cfg);
  // Losses count in full while armies are close; in a long standoff caution fades (as in Normal) so the battle moves on.
  const quiet = s.turn - lastFight(s);
  const care = PIECE_W * (0.35 + 0.65 * Math.max(0, 1 - Math.max(0, quiet - 3) / 4));
  let best: AiAction | null = null;
  let bestScore = 0.5;
  const consider = (a: AiAction, score: number) => {
    if (score > bestScore) [best, bestScore] = [a, score];
  };
  const mine = s.units.filter((u) => u.owner === me);
  const enemies = s.units.filter((u) => u.owner === foe);
  const enemyKing = kingOf(s, foe);
  const startFoe = s.startValue?.[foe] ?? 0;
  const foeValue = armyValue(s, foe, cfg);

  // Focus fire: every kill this turn can still pay for (moving first if need be), best value for the points.
  // Blows that can't finish anything only chip, and count for much less.
  for (const u of mine) {
    const rules = cfg.units[u.type];
    if (u.attacked && !cfg.combat.multipleAttacksPerUnit) continue;
    const spots: { hex: Hex; cost: number; steps: number }[] = [{ hex: u.pos, cost: 0, steps: 0 }, ...reachable(s, u.id, cfg).values()];
    for (const spot of spots) {
      if (spot.cost >= s.points) continue;
      const reach = rules.ranged ? maxRangeAt(s, spot.hex, rules.ranged.maxRange, cfg) : 0;
      const near = enemies.filter((e) => {
        const d = distance(spot.hex, e.pos);
        return (rules.attack > 0 && d === 1) || (!!rules.ranged && d >= rules.ranged.minRange && d <= reach);
      });
      if (!near.length) continue;
      const st: GameState = spot.cost === 0 ? s : { ...s, points: s.points - spot.cost, units: s.units.map((x) => (x.id === u.id ? { ...x, pos: spot.hex, moved: true, ran: (x.ran ?? 0) + spot.steps } : x)) };
      for (const e of near) {
        for (const kind of ['attack', 'shoot'] as const) {
          const p = previewStrike(st, u.id, e.id, kind, cfg);
          if (!p || p.damage <= 0) continue;
          const act: AiAction = spot.cost === 0 ? { kind, unitId: u.id, targetId: e.id } : { kind: 'move', unitId: u.id, to: spot.hex };
          const hits = Math.ceil(e.hp / p.damage);
          const total = spot.cost + hits * p.cost;
          // Spears answer every blow but the killing one.
          const ctr = p.counter * (hits - 1);
          const ctrLoss = ctr >= u.hp ? killValue(u, cfg) : (ctr / u.hp) * killValue(u, cfg) * 0.7;
          if (total <= s.points) {
            if (e.type === 'king' && cfg.win.killKing && ctr < u.hp) {
              if (spot.cost === 0) return act;
              consider(act, 50000 - total);
              continue;
            }
            // A kill that breaks the enemy army wins outright.
            if (cfg.options.routAt !== null && startFoe > 0 && startFoe - (foeValue - worth(e.type, cfg)) >= cfg.options.routAt * startFoe && ctr < u.hp) {
              consider(act, 40000 - total);
              continue;
            }
            let value = killValue(e, cfg) - ctrLoss;
            if (enemyKing && distance(e.pos, enemyKing.pos) === 1) value += 25; // opens the way to the King
            const plain = value - total * POINT_W;
            if (plain + care * base <= bestScore) continue;
            const endAt = kind === 'attack' && cfg.combat.advanceAfterKill === 'must' && ctr < u.hp ? e.pos : spot.hex;
            const endState: GameState = { ...st, units: st.units.filter((x) => x.id !== e.id && !(x.id === u.id && ctr >= u.hp)).map((x) => (x.id === u.id ? { ...x, pos: endAt } : x)) };
            const loss = expectedLoss(endState, th, cfg, new Set([e.id]));
            consider(act, plain + care * (base - loss));
          } else if (spot.cost === 0) {
            const value = (p.damage / e.hp) * killValue(e, cfg) * 0.5 - (p.counter >= u.hp ? killValue(u, cfg) : (p.counter / u.hp) * killValue(u, cfg) * 0.7);
            consider(act, value - p.cost * 3);
          }
        }
      }
    }
  }

  // Moves: march like Normal, keep the King safe and guarded, stay out of reach where it costs little.
  const fields: Fields = new Map();
  for (const u of mine) {
    const self = u.type === 'king';
    for (const { hex, cost, steps } of reachable(s, u.id, cfg).values()) {
      const moved: GameState = { ...s, points: s.points - cost, units: s.units.map((x) => (x.id === u.id ? { ...x, pos: hex, moved: true, ran: (x.ran ?? 0) + steps } : x)) };
      // Stepping next to the enemy King with nobody guarding him wins when the turn ends.
      if (cfg.win.captureKing && enemyKing && kingCapturedBy(moved, me)) {
        consider({ kind: 'move', unitId: u.id, to: hex }, 30000 - cost);
        continue;
      }
      // The King moves only to be safer, and not for small change.
      const plain = self ? -2 - cost * 0.5 : hardMarch(s, u, hex, cost, cfg, fields);
      // Losses can't go below nothing: skip the costly danger check when even that couldn't win.
      if (plain + care * base <= bestScore) continue;
      consider({ kind: 'move', unitId: u.id, to: hex }, plain + care * (base - expectedLoss(moved, th, cfg)));
    }
  }
  return best;
}
