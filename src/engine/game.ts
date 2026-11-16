// The rules. Every function is pure: it takes a state and returns a new one (or an
// error code) without touching the DOM, so an AI or online play can reuse it.

import { CONFIG, type GameConfig, type TerrainId } from '../config';
import { between, distance, key, neighbors, sameHex, type Hex } from './hex';
import type { ErrorCode, GameState, LogEntry, Player, Result, Unit } from './types';

export type Rng = () => number;

export const other = (p: Player): Player => (p === 'red' ? 'blue' : 'red');

export function buildBoard(cfg: GameConfig = CONFIG): TerrainId[][] {
  const { cols, rows, riverCol, bridgeRows, forests } = cfg.board;
  const board: TerrainId[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: TerrainId[] = [];
    for (let c = 0; c < cols; c++) {
      if (c === riverCol) line.push(bridgeRows.includes(r) ? 'bridge' : 'river');
      else line.push('plain');
    }
    board.push(line);
  }
  for (const [c, r] of forests) if (onBoardSize(cfg, { col: c, row: r })) board[r][c] = 'forest';
  return board;
}

function onBoardSize(cfg: GameConfig, h: Hex) {
  return h.col >= 0 && h.row >= 0 && h.col < cfg.board.cols && h.row < cfg.board.rows;
}

export function newGame(cfg: GameConfig = CONFIG): GameState {
  const units: Unit[] = [];
  const count: Record<string, number> = {};
  for (const owner of ['red', 'blue'] as Player[]) {
    for (const [type, col, row] of cfg.setup) {
      const n = (count[owner + type] = (count[owner + type] ?? 0) + 1);
      units.push({
        id: `${owner}-${type}-${n}`,
        type,
        owner,
        pos: owner === 'red' ? { col, row } : { col: cfg.board.cols - 1 - col, row },
        hp: cfg.units[type].hp,
        moved: false,
        attacked: false,
      });
    }
  }
  return {
    board: buildBoard(cfg),
    units,
    turn: 1,
    current: 'red',
    phase: 'roll',
    dice: null,
    points: 0,
    winner: null,
    winReason: null,
    log: [],
  };
}

// ---------- queries ----------

export const onBoard = (s: GameState, h: Hex) =>
  h.row >= 0 && h.row < s.board.length && h.col >= 0 && h.col < s.board[0].length;

export const terrainAt = (s: GameState, h: Hex): TerrainId => s.board[h.row][h.col];

export const unitAt = (s: GameState, h: Hex) => s.units.find((u) => sameHex(u.pos, h));

export const getUnit = (s: GameState, id: string) => s.units.find((u) => u.id === id);

export const kingOf = (s: GameState, p: Player) =>
  s.units.find((u) => u.owner === p && u.type === 'king');

export interface Reach {
  hex: Hex;
  cost: number;
}

/** Every empty hex the unit can end a move on with the points left, and its cheapest cost. */
export function reachable(s: GameState, unitId: string, cfg: GameConfig = CONFIG): Map<string, Reach> {
  const out = new Map<string, Reach>();
  const u = getUnit(s, unitId);
  if (!u || s.phase !== 'act' || u.owner !== s.current) return out;
  if (u.moved && !cfg.movement.multipleMovesPerUnit) return out;
  if (u.attacked && !cfg.combat.moveAfterAttack) return out;

  const base = cfg.units[u.type].moveCost;
  const best = new Map<string, number>([[key(u.pos), 0]]);
  // Small boards: a simple priority list is plenty.
  const open: Reach[] = [{ hex: u.pos, cost: 0 }];
  while (open.length) {
    open.sort((a, b) => a.cost - b.cost);
    const cur = open.shift()!;
    if (cur.cost > (best.get(key(cur.hex)) ?? Infinity)) continue;
    for (const n of neighbors(cur.hex)) {
      if (!onBoard(s, n)) continue;
      const t = cfg.terrain[terrainAt(s, n)];
      if (!t.passable) continue;
      const occ = unitAt(s, n);
      if (occ && (occ.owner !== u.owner || !cfg.movement.passThroughFriendly)) continue;
      const cost = cur.cost + base * t.moveCostMultiplier;
      if (cost > s.points || cost >= (best.get(key(n)) ?? Infinity)) continue;
      best.set(key(n), cost);
      open.push({ hex: n, cost });
      if (!occ) out.set(key(n), { hex: n, cost });
    }
  }
  return out;
}

export function hasLineOfSight(s: GameState, a: Hex, b: Hex, cfg: GameConfig = CONFIG): boolean {
  return between(a, b).every((h) => !onBoard(s, h) || !cfg.terrain[terrainAt(s, h)].blocksSight);
}

export interface AttackPreview {
  kind: 'attack' | 'shoot';
  damage: number;
  hpAfter: number;
  kills: boolean;
  cost: number;
}

function damageOn(s: GameState, target: Unit, raw: number, cfg: GameConfig) {
  return Math.max(0, raw - cfg.terrain[terrainAt(s, target.pos)].defenseBonus);
}

function checkStrike(
  s: GameState,
  attackerId: string,
  targetId: string,
  kind: 'attack' | 'shoot',
  cfg: GameConfig,
): ErrorCode | { a: Unit; t: Unit; cost: number; damage: number } {
  if (s.phase !== 'act') return 'wrongPhase';
  const a = getUnit(s, attackerId);
  const t = getUnit(s, targetId);
  if (!a || !t) return 'noSuchUnit';
  if (a.owner !== s.current) return 'notYourUnit';
  if (t.owner === a.owner) return 'notEnemy';
  if (a.attacked && !cfg.combat.multipleAttacksPerUnit) return 'alreadyAttacked';
  const rules = cfg.units[a.type];
  let cost: number;
  let raw: number;
  if (kind === 'attack') {
    if (rules.attack <= 0) return 'cannotMelee';
    if (distance(a.pos, t.pos) !== 1) return 'notAdjacent';
    cost = cfg.combat.attackCost;
    raw = rules.attack;
  } else {
    const r = rules.ranged;
    if (!r) return 'cannotShoot';
    const d = distance(a.pos, t.pos);
    if (d < r.minRange || d > r.maxRange) return 'outOfRange';
    if (!hasLineOfSight(s, a.pos, t.pos, cfg)) return 'noLineOfSight';
    cost = r.cost;
    raw = r.damage;
  }
  if (s.points < cost) return 'notEnoughPoints';
  return { a, t, cost, damage: damageOn(s, t, raw, cfg) };
}

export function previewStrike(
  s: GameState,
  attackerId: string,
  targetId: string,
  kind: 'attack' | 'shoot',
  cfg: GameConfig = CONFIG,
): AttackPreview | null {
  const c = checkStrike(s, attackerId, targetId, kind, cfg);
  if (typeof c === 'string') return null;
  const hpAfter = Math.max(0, c.t.hp - c.damage);
  return { kind, damage: c.damage, hpAfter, kills: hpAfter === 0, cost: c.cost };
}

/** Enemy units this unit can hit right now, with what would happen. */
export function strikeTargets(
  s: GameState,
  unitId: string,
  cfg: GameConfig = CONFIG,
): { targetId: string; preview: AttackPreview }[] {
  const out: { targetId: string; preview: AttackPreview }[] = [];
  for (const t of s.units) {
    for (const kind of ['attack', 'shoot'] as const) {
      const p = previewStrike(s, unitId, t.id, kind, cfg);
      if (p) out.push({ targetId: t.id, preview: p });
    }
  }
  return out;
}

// ---------- actions ----------

const fail = (error: ErrorCode): Result => ({ ok: false, error });

function withLog(s: GameState, e: LogEntry): GameState {
  return { ...s, log: [...s.log, e] };
}

export function rollDice(s: GameState, rng: Rng = Math.random, cfg: GameConfig = CONFIG): Result {
  if (s.phase !== 'roll') return fail('wrongPhase');
  const dice = Array.from({ length: cfg.dice.count }, () => 1 + Math.floor(rng() * cfg.dice.sides));
  const total = dice.reduce((a, b) => a + b, 0);
  const next: GameState = { ...s, dice, points: total, phase: 'act' };
  return { ok: true, state: withLog(next, { kind: 'roll', turn: s.turn, player: s.current, dice, total }) };
}

export function moveUnit(s: GameState, unitId: string, to: Hex, cfg: GameConfig = CONFIG): Result {
  if (s.phase !== 'act') return fail('wrongPhase');
  const u = getUnit(s, unitId);
  if (!u) return fail('noSuchUnit');
  if (u.owner !== s.current) return fail('notYourUnit');
  if (u.moved && !cfg.movement.multipleMovesPerUnit) return fail('alreadyMoved');
  const r = reachable(s, unitId, cfg).get(key(to));
  if (!r) return fail('unreachable');
  const units = s.units.map((x) => (x.id === unitId ? { ...x, pos: to, moved: true } : x));
  const next: GameState = { ...s, units, points: s.points - r.cost };
  return {
    ok: true,
    state: withLog(next, { kind: 'move', turn: s.turn, player: s.current, unit: u.type, from: u.pos, to, cost: r.cost }),
  };
}

function strike(s: GameState, attackerId: string, targetId: string, kind: 'attack' | 'shoot', cfg: GameConfig): Result {
  const c = checkStrike(s, attackerId, targetId, kind, cfg);
  if (typeof c === 'string') return fail(c);
  const hp = c.t.hp - c.damage;
  const killed = hp <= 0;
  const units = s.units
    .filter((x) => !(killed && x.id === c.t.id))
    .map((x) => (x.id === c.t.id ? { ...x, hp } : x.id === c.a.id ? { ...x, attacked: true } : x));
  let next = withLog(
    { ...s, units, points: s.points - c.cost },
    { kind, turn: s.turn, player: s.current, unit: c.a.type, target: c.t.type, damage: c.damage, killed, cost: c.cost },
  );
  if (killed && c.t.type === 'king' && cfg.win.killKing) next = declareWin(next, s.current, 'kingKilled');
  return { ok: true, state: next };
}

export const attack = (s: GameState, attackerId: string, targetId: string, cfg: GameConfig = CONFIG) =>
  strike(s, attackerId, targetId, 'attack', cfg);

export const shoot = (s: GameState, archerId: string, targetId: string, cfg: GameConfig = CONFIG) =>
  strike(s, archerId, targetId, 'shoot', cfg);

function declareWin(s: GameState, player: Player, reason: GameState['winReason'] & string): GameState {
  return withLog({ ...s, phase: 'over', winner: player, winReason: reason }, { kind: 'win', turn: s.turn, player, reason });
}

/** True if `p` has a unit next to the enemy King and no other enemy unit stands beside that King. */
export function kingCapturedBy(s: GameState, p: Player): boolean {
  const king = kingOf(s, other(p));
  if (!king) return false;
  const around = s.units.filter((u) => u.id !== king.id && distance(u.pos, king.pos) === 1);
  return around.some((u) => u.owner === p) && !around.some((u) => u.owner === king.owner);
}

export function endTurn(s: GameState, cfg: GameConfig = CONFIG): Result {
  if (s.phase !== 'act') return fail('wrongPhase');
  let next = withLog(s, { kind: 'endTurn', turn: s.turn, player: s.current });
  if (cfg.win.captureKing && kingCapturedBy(next, s.current)) {
    return { ok: true, state: declareWin(next, s.current, 'kingCaptured') };
  }
  next = {
    ...next,
    units: next.units.map((u) => ({ ...u, moved: false, attacked: false })),
    current: other(s.current),
    turn: s.current === 'blue' ? s.turn + 1 : s.turn,
    phase: 'roll',
    dice: null,
    points: 0,
  };
  return { ok: true, state: next };
}
