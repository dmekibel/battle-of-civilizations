// Before the battle: each side buys an army with a points budget, then places it in
// its own deployment zone. Red does both first while Blue looks away, then Blue.

import { CONFIG, type GameConfig, type UnitTypeId } from '../config';
import { distance, type Hex } from './hex';
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

/** Places everything left in reserve: the King at the back, the rest in random free hexes. */
export function autoDeploy(s: GameState, rng: Rng = Math.random, cfg: GameConfig = CONFIG): Result {
  if (s.phase !== 'deploy') return fail('wrongPhase');
  let state = s;
  const p = s.current;
  const edge = p === 'red' ? 0 : cfg.board.cols - 1;
  const middle = { col: edge, row: Math.floor(cfg.board.rows / 2) };
  const free = () => zoneHexes(state, p, cfg).filter((h) => !unitAt(state, h));
  const left = state.reserve[p];
  for (const type of [...left.filter((t) => t === 'king'), ...left.filter((t) => t !== 'king')]) {
    let spots = free();
    if (type === 'king') spots = spots.sort((a, b) => distance(a, middle) - distance(b, middle)).slice(0, 1);
    const at = spots[Math.floor(rng() * spots.length)];
    const r = placeUnit(state, type, at, cfg);
    if (!r.ok) return r;
    state = r.state;
  }
  return { ok: true, state };
}

/** Red's setup done: Blue builds next. Blue's done: the battle starts with Red rolling. */
export function finishDeploy(s: GameState): Result {
  if (s.phase !== 'deploy') return fail('wrongPhase');
  if (s.reserve[s.current].length) return fail('reserveNotEmpty');
  if (s.current === 'red') return { ok: true, state: { ...s, current: other(s.current), phase: 'draft' } };
  return { ok: true, state: { ...s, current: 'red', phase: 'roll' } };
}
