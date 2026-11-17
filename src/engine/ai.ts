// A simple computer opponent. Each call looks at every legal action for the side to move
// and returns the best one by a hand-written score, or null when nothing is worth the
// points (then the caller ends the turn). Greedy, one step at a time: no look-ahead.

import { CONFIG, type GameConfig, type UnitTypeId } from '../config';
import { distance, key, neighbors, type Hex } from './hex';
import { attack, canReroll, endTurn, hasLineOfSight, kingOf, moveUnit, onBoard, other, reachable, reroll, rollDice, shoot, strikeTargets, takeHex, terrainAt, type Rng } from './game';
import type { GameState, Result, Unit } from './types';

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
    if (r.ranged && d >= r.ranged.minRange && d <= r.ranged.maxRange && pointsLeft >= r.ranged.cost && hasLineOfSight(s, at, e.pos, cfg)) {
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
  const ahead = Math.max(0, line - after - 3);
  // Archers stop at shooting range rather than walking into the enemy line.
  if (rules.ranged && distance(to, goal) < rules.ranged.minRange) return -1;
  const risk = danger(s, u, to, cfg) >= u.hp ? worth(u.type, cfg) * 2 : 0;
  return gain * 2 - cost * 0.15 - risk - ahead * 2.5;
}

/** The single best action for the side to move, or null to end the turn. */
export function aiNextAction(s: GameState, cfg: GameConfig = CONFIG): AiAction | null {
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
export function playAiTurn(s: GameState, rng: Rng = Math.random, cfg: GameConfig = CONFIG): GameState {
  let r = rollDice(s, rng, cfg);
  if (!r.ok) return s;
  let state = r.state;
  for (let i = 0; i < 100 && state.phase === 'act'; i++) {
    const a = aiNextAction(state, cfg);
    if (!a) break;
    r = applyAi(state, a, cfg, rng);
    if (!r.ok) break;
    state = r.state;
  }
  if (state.phase !== 'act') return state;
  r = endTurn(state, cfg);
  return r.ok ? r.state : state;
}
