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

/** A fresh game: Red builds an army first, then deploys; then Blue does the same. */
export function newGame(cfg: GameConfig = CONFIG): GameState {
  return {
    board: buildBoard(cfg),
    units: [],
    reserve: { red: [], blue: [] },
    seq: 0,
    turn: 1,
    current: 'red',
    phase: 'draft',
    dice: null,
    points: 0,
    winner: null,
    winReason: null,
    advance: null,
    log: [],
  };
}

export function makeUnit(s: GameState, type: Unit['type'], owner: Player, pos: Hex, cfg: GameConfig = CONFIG): [Unit, GameState] {
  const seq = s.seq + 1;
  const unit: Unit = { id: `${owner}-${type}-${seq}`, type, owner, pos, hp: cfg.units[type].hp, moved: false, attacked: false };
  return [unit, { ...s, seq }];
}

/** Skips army building: both sides get the fixed `cfg.setup` army, ready for Red to roll. */
export function quickStart(cfg: GameConfig = CONFIG): GameState {
  let s: GameState = { ...newGame(cfg), phase: 'roll' };
  for (const owner of ['red', 'blue'] as Player[]) {
    for (const [type, col, row] of cfg.setup) {
      const pos = owner === 'red' ? { col, row } : { col: cfg.board.cols - 1 - col, row };
      const [u, next] = makeUnit(s, type, owner, pos, cfg);
      s = { ...next, units: [...next.units, u] };
    }
  }
  return s;
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
    // Zone of control: having stepped next to an enemy, the move ends there.
    if (cfg.options.zoneOfControl && cur.cost > 0 && enemyNext(s, cur.hex, u.owner)) continue;
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

const enemyNext = (s: GameState, h: Hex, owner: Player) => s.units.some((e) => e.owner !== owner && distance(e.pos, h) === 1);

const CAVALRY = new Set(['heavyCavalry', 'lightCavalry']);
const INFANTRY = new Set(['heavyInfantry', 'lightInfantry']);

/** Points value of an army (its King not counted), for the morale rule. */
export function armyValue(s: GameState, p: Player, cfg: GameConfig = CONFIG): number {
  return s.units.filter((u) => u.owner === p && u.type !== 'king').reduce((sum, u) => sum + cfg.army.cost[u.type as keyof GameConfig['army']['cost']], 0);
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
  /** Damage the attacker would take back (spears against cavalry). */
  counter: number;
}

/** Damage after the target's ground and, with the shield-wall rule, its neighbours. */
function damageOn(s: GameState, target: Unit, raw: number, cfg: GameConfig) {
  let guard = cfg.terrain[terrainAt(s, target.pos)].defenseBonus;
  if (cfg.options.shieldWall && target.type === 'heavyInfantry') {
    if (s.units.some((f) => f.id !== target.id && f.owner === target.owner && f.type === 'heavyInfantry' && distance(f.pos, target.pos) === 1)) guard += 1;
  }
  return Math.max(0, raw - guard);
}

/** Melee bonuses from the optional rules: cavalry charge and the King's command. */
function meleeBonus(s: GameState, a: Unit, cfg: GameConfig): number {
  let bonus = 0;
  if (cfg.options.charge && CAVALRY.has(a.type) && (a.ran ?? 0) >= 3) bonus += 1;
  if (cfg.options.kingAura && a.type !== 'king') {
    const king = kingOf(s, a.owner);
    if (king && distance(king.pos, a.pos) <= 2) bonus += 1;
  }
  return bonus;
}

function checkStrike(
  s: GameState,
  attackerId: string,
  targetId: string,
  kind: 'attack' | 'shoot',
  cfg: GameConfig,
): ErrorCode | { a: Unit; t: Unit; cost: number; damage: number; counter: number } {
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
    raw = rules.attack + meleeBonus(s, a, cfg);
  } else {
    const r = rules.ranged;
    if (!r) return 'cannotShoot';
    const d = distance(a.pos, t.pos);
    if (d < r.minRange || d > r.maxRange) return 'outOfRange';
    if (!hasLineOfSight(s, a.pos, t.pos, cfg)) return 'noLineOfSight';
    if (cfg.options.volleys !== null && (a.shots ?? 0) >= cfg.options.volleys) return 'outOfArrows';
    cost = r.cost * (cfg.options.longShotFrom !== null && d > cfg.options.longShotFrom ? 2 : 1);
    raw = r.damage;
  }
  if (s.points < cost) return 'notEnoughPoints';
  const damage = damageOn(s, t, raw, cfg);
  // Spears: cavalry charging into infantry takes a hit back, unless the infantry falls.
  const counter = kind === 'attack' && cfg.options.spears && CAVALRY.has(a.type) && INFANTRY.has(t.type) && t.hp > damage ? 1 : 0;
  return { a, t, cost, damage, counter };
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
  return { kind, damage: c.damage, hpAfter, kills: hpAfter === 0, cost: c.cost, counter: c.counter };
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
  const carried = s.carry?.[s.current] ?? 0;
  // The second player's first turn gets the optional catch-up bonus.
  const bonus = s.turn === 1 && s.current === 'blue' ? cfg.options.firstTurnBonus : 0;
  const total = dice.reduce((a, b) => a + b, 0) + carried + bonus;
  // Remember both armies' size when the battle starts, for the morale rule.
  const startValue = s.startValue ?? { red: armyValue(s, 'red', cfg), blue: armyValue(s, 'blue', cfg) };
  const next: GameState = { ...s, dice, points: total, phase: 'act', startValue, carry: { red: 0, blue: 0, ...s.carry, [s.current]: 0 } };
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
  const hexes = Math.round(r.cost / cfg.units[u.type].moveCost);
  const units = s.units.map((x) => (x.id === unitId ? { ...x, pos: to, moved: true, ran: (x.ran ?? 0) + hexes } : x));
  const next: GameState = { ...s, units, points: s.points - r.cost, advance: null };
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
  const attackerHp = c.a.hp - c.counter;
  const attackerKilled = attackerHp <= 0;
  const mode = kind === 'attack' && killed && !attackerKilled ? cfg.combat.advanceAfterKill : 'never';
  const units = s.units
    .filter((x) => !(killed && x.id === c.t.id) && !(attackerKilled && x.id === c.a.id))
    .map((x) =>
      x.id === c.t.id
        ? { ...x, hp }
        : x.id === c.a.id
          ? { ...x, hp: attackerHp, attacked: true, pos: mode === 'must' ? c.t.pos : x.pos, shots: (x.shots ?? 0) + (kind === 'shoot' ? 1 : 0) }
          : x,
    );
  let next = withLog(
    { ...s, units, points: s.points - c.cost, advance: mode === 'may' ? { unitId: c.a.id, to: c.t.pos } : null },
    {
      kind, turn: s.turn, player: s.current, unit: c.a.type, target: c.t.type, damage: c.damage, killed, cost: c.cost,
      advanced: mode === 'must',
      from: c.a.pos,
      at: c.t.pos,
      ...(c.counter ? { counter: c.counter, attackerKilled } : {}),
    },
  );
  if (killed && c.t.type === 'king' && cfg.win.killKing) return { ok: true, state: declareWin(next, s.current, 'kingKilled') };
  // Morale: an army that has lost its share of points breaks and flees.
  if (cfg.options.routAt !== null && next.startValue) {
    for (const p of [other(s.current), s.current] as Player[]) {
      const start = next.startValue[p];
      if (start > 0 && start - armyValue(next, p, cfg) >= cfg.options.routAt * start) {
        next = declareWin(next, other(p), 'routed');
        break;
      }
    }
  }
  return { ok: true, state: next };
}

/** Steps into the hex of the piece just killed, when advancing is optional. Free. */
export function takeHex(s: GameState): Result {
  if (s.phase !== 'act') return fail('wrongPhase');
  const a = s.advance;
  const u = a && getUnit(s, a.unitId);
  if (!a || !u || unitAt(s, a.to)) return fail('nothingToTake');
  const units = s.units.map((x) => (x.id === u.id ? { ...x, pos: a.to } : x));
  return {
    ok: true,
    state: withLog({ ...s, units, advance: null }, { kind: 'move', turn: s.turn, player: s.current, unit: u.type, from: u.pos, to: a.to, cost: 0 }),
  };
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
    // Leftover points carry over when that optional rule is on.
    carry: { red: 0, blue: 0, ...next.carry, [s.current]: Math.min(cfg.options.carryMax, s.points) },
    units: next.units.map((u) => ({ ...u, moved: false, attacked: false, ran: 0 })),
    current: other(s.current),
    turn: s.current === 'blue' ? s.turn + 1 : s.turn,
    phase: 'roll',
    dice: null,
    points: 0,
    advance: null,
  };
  return { ok: true, state: next };
}
