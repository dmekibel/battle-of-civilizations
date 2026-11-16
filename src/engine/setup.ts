// Before the battle: each side buys an army with a points budget, then places it in
// its own deployment zone. Red does both first while Blue looks away, then Blue.

import { CONFIG, type GameConfig, type UnitTypeId } from '../config';
import type { Hex } from './hex';
import { getUnit, makeUnit, onBoard, other, terrainAt, unitAt, type Rng } from './game';
import type { GameState, Player, Result } from './types';

export type ArmyCounts = Partial<Record<Exclude<UnitTypeId, 'king'>, number>>;

const fail = (error: Extract<Result, { ok: false }>['error']): Result => ({ ok: false, error });

export function armyCost(counts: ArmyCounts, cfg: GameConfig = CONFIG): number {
  return Object.entries(counts).reduce((sum, [t, n]) => sum + cfg.army.cost[t as keyof ArmyCounts] * (n ?? 0), 0);
}

export function inZone(p: Player, h: Hex, cfg: GameConfig = CONFIG): boolean {
  const { cols } = cfg.board;
  return p === 'red' ? h.col < cfg.deploy.depth : h.col >= cols - cfg.deploy.depth;
}

/** Free hexes in a side's zone where a piece could stand. */
export function zoneHexes(s: GameState, p: Player, cfg: GameConfig = CONFIG): Hex[] {
  const out: Hex[] = [];
  for (let row = 0; row < s.board.length; row++)
    for (let col = 0; col < s.board[0].length; col++) {
      const h = { col, row };
      if (inZone(p, h, cfg) && cfg.terrain[terrainAt(s, h)].passable) out.push(h);
    }
  return out;
}

/** Buys the army for the side whose turn it is. The King comes free. */
export function draftArmy(s: GameState, counts: ArmyCounts, cfg: GameConfig = CONFIG): Result {
  if (s.phase !== 'draft') return fail('wrongPhase');
  const types = Object.keys(counts) as (keyof ArmyCounts)[];
  if (types.some((t) => !(t in cfg.army.cost) || !Number.isInteger(counts[t]) || counts[t]! < 0)) return fail('badArmy');
  if (armyCost(counts, cfg) > cfg.army.budget) return fail('overBudget');
  const reserve: UnitTypeId[] = ['king'];
  for (const t of types) for (let i = 0; i < counts[t]!; i++) reserve.push(t);
  if (reserve.length > zoneHexes(s, s.current, cfg).length) return fail('tooManyPieces');
  return { ok: true, state: { ...s, phase: 'deploy', reserve: { ...s.reserve, [s.current]: reserve } } };
}

export function placeUnit(s: GameState, type: UnitTypeId, at: Hex, cfg: GameConfig = CONFIG): Result {
  if (s.phase !== 'deploy') return fail('wrongPhase');
  const left = s.reserve[s.current];
  const i = left.indexOf(type);
  if (i < 0) return fail('notInReserve');
  if (!onBoard(s, at) || !inZone(s.current, at, cfg)) return fail('outsideZone');
  if (!cfg.terrain[terrainAt(s, at)].passable) return fail('blocked');
  if (unitAt(s, at)) return fail('occupied');
  const [u, next] = makeUnit(s, type, s.current, at, cfg);
  const rest = [...left.slice(0, i), ...left.slice(i + 1)];
  return { ok: true, state: { ...next, units: [...next.units, u], reserve: { ...s.reserve, [s.current]: rest } } };
}

/** Picks a placed piece back up during deployment. */
export function liftUnit(s: GameState, unitId: string): Result {
  if (s.phase !== 'deploy') return fail('wrongPhase');
  const u = getUnit(s, unitId);
  if (!u) return fail('noSuchUnit');
  if (u.owner !== s.current) return fail('notYourUnit');
  return {
    ok: true,
    state: {
      ...s,
      units: s.units.filter((x) => x.id !== unitId),
      reserve: { ...s.reserve, [s.current]: [...s.reserve[s.current], u.type] },
    },
  };
}

// Where each kind of piece wants to stand, like a real battle line facing the enemy:
// heavy infantry holds the front centre, light infantry extends the line, archers stand
// one rank behind the infantry, cavalry guards the wings (light cavalry furthest out),
// and the King stays at the back in the middle.
const DEPLOY_ORDER: UnitTypeId[] = ['king', 'heavyInfantry', 'archer', 'lightInfantry', 'heavyCavalry', 'lightCavalry'];

function formationScore(type: UnitTypeId, depth: number, front: number, lateral: number, maxLateral: number): number {
  const wing = maxLateral - lateral; // 0 at the very edge of the board
  switch (type) {
    case 'king':
      return depth * 10 + lateral;
    case 'heavyInfantry':
    case 'lightInfantry':
      return (front - depth) * 10 + lateral;
    case 'archer':
      return Math.abs(front - 1 - depth) * 10 + lateral;
    case 'heavyCavalry':
      return Math.abs(front - 1 - depth) * 3 + Math.max(0, wing - 2) * 6;
    case 'lightCavalry':
      return wing * 10 + (front - depth) * 2;
  }
}

/** Places everything left in reserve in a battle formation (see formationScore). */
export function autoDeploy(s: GameState, cfg: GameConfig = CONFIG): Result {
  if (s.phase !== 'deploy') return fail('wrongPhase');
  let state = s;
  const p = s.current;
  const mid = (cfg.board.rows - 1) / 2;
  const front = cfg.deploy.depth - 1;
  const depthOf = (h: Hex) => (p === 'red' ? h.col : cfg.board.cols - 1 - h.col);
  const left = state.reserve[p];
  for (const type of DEPLOY_ORDER) {
    for (let n = left.filter((t) => t === type).length; n > 0; n--) {
      // Keep the two wings even: prefer the side with fewer pieces of this type.
      const mine = state.units.filter((u) => u.owner === p && u.type === type);
      const above = mine.filter((u) => u.pos.row < mid).length;
      const below = mine.filter((u) => u.pos.row > mid).length;
      const spots = zoneHexes(state, p, cfg).filter((h) => !unitAt(state, h));
      let best: Hex | null = null;
      let bestScore = Infinity;
      for (const h of spots) {
        const lateral = Math.abs(h.row - mid);
        const side = h.row < mid ? above - below : h.row > mid ? below - above : 0;
        const score = formationScore(type, depthOf(h), front, lateral, mid) + side * 0.5;
        if (score < bestScore) [best, bestScore] = [h, score];
      }
      if (!best) return fail('tooManyPieces');
      const r = placeUnit(state, type, best, cfg);
      if (!r.ok) return r;
      state = r.state;
    }
  }
  return { ok: true, state };
}

/** Share of the budget a balanced army spends on each kind of piece. */
const ARMY_MIX: Record<keyof ArmyCounts, number> = {
  heavyInfantry: 0.3,
  archer: 0.2,
  heavyCavalry: 0.2,
  lightInfantry: 0.15,
  lightCavalry: 0.15,
};

/** A balanced army that spends the budget: each step buys whatever is furthest below its share. */
export function suggestArmy(rng: Rng = Math.random, cfg: GameConfig = CONFIG): ArmyCounts {
  const types = Object.keys(ARMY_MIX) as (keyof ArmyCounts)[];
  // A little randomness so two auto armies are rarely identical.
  const want = Object.fromEntries(types.map((t) => [t, ARMY_MIX[t] * (0.75 + rng() * 0.5)])) as Record<keyof ArmyCounts, number>;
  const total = types.reduce((a, t) => a + want[t], 0);
  const counts: ArmyCounts = {};
  for (;;) {
    const spent = armyCost(counts, cfg);
    const left = cfg.army.budget - spent;
    const affordable = types.filter((t) => cfg.army.cost[t] <= left);
    if (!affordable.length) return counts;
    const gap = (t: keyof ArmyCounts) => (want[t] / total) * cfg.army.budget - (counts[t] ?? 0) * cfg.army.cost[t];
    const pick = affordable.reduce((a, b) => (gap(b) > gap(a) ? b : a));
    counts[pick] = (counts[pick] ?? 0) + 1;
  }
}

/** Red's setup done: Blue builds next. Blue's done: the battle starts with Red rolling. */
export function finishDeploy(s: GameState): Result {
  if (s.phase !== 'deploy') return fail('wrongPhase');
  if (s.reserve[s.current].length) return fail('reserveNotEmpty');
  if (s.current === 'red') return { ok: true, state: { ...s, current: other(s.current), phase: 'draft' } };
  return { ok: true, state: { ...s, current: 'red', phase: 'roll' } };
}
