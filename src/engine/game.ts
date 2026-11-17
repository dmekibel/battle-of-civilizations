// The rules. Every function is pure: it takes a state and returns a new one (or an
// error code) without touching the DOM, so an AI or online play can reuse it.

import { CONFIG, type GameConfig, type TerrainId } from '../config';
import { between, distance, key, neighbors, sameHex, type Hex } from './hex';
import type { ErrorCode, GameState, LogEntry, Player, Result, Unit } from './types';

export type Rng = () => number;

export const other = (p: Player): Player => (p === 'red' ? 'blue' : 'red');

export function buildBoard(cfg: GameConfig = CONFIG): TerrainId[][] {
  const { cols, rows, riverCol, bridgeRows, forests } = cfg.board;
  const fordRows = cfg.board.fordRows ?? [];
  const rivers = [...(riverCol === null ? [] : [{ col: riverCol, bridges: bridgeRows, fords: fordRows }]), ...(cfg.board.rivers ?? [])];
  const board: TerrainId[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: TerrainId[] = [];
    for (let c = 0; c < cols; c++) {
      const rv = rivers.find((x) => x.col === c);
      if (rv) line.push(rv.bridges.includes(r) ? 'bridge' : rv.fords.includes(r) ? 'ford' : 'river');
      else line.push('plain');
    }
    board.push(line);
  }
  for (const [kind, list] of [['hill', cfg.board.hills], ['swamp', cfg.board.swamps], ['lake', cfg.board.lakes]] as const)
    for (const [c, r] of list ?? []) if (onBoardSize(cfg, { col: c, row: r })) board[r][c] = kind;
  for (const [c, r] of forests) if (onBoardSize(cfg, { col: c, row: r })) board[r][c] = 'forest';
  // Castles and villages go on last: a wall or house stands wherever it is drawn.
  for (const [kind, list] of [['wall', cfg.board.walls], ['tower', cfg.board.towers], ['house', cfg.board.houses]] as const)
    for (const [c, r] of list ?? []) if (onBoardSize(cfg, { col: c, row: r })) board[r][c] = kind;
  for (const g of cfg.board.gates ?? []) if (onBoardSize(cfg, g)) board[g.row][g.col] = 'gate';
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

/** Points one step costs: 1 for everyone, or the piece's own cost when "different speeds" is on. */
export const stepCost = (type: Unit['type'], cfg: GameConfig = CONFIG) => (cfg.options.unitSpeeds ? cfg.units[type].moveCost : 1);
/** Hexes one point buys: horses go 2 (heavy) or 3 (light) when every step costs 1. */
export const hexesPerPoint = (type: Unit['type'], cfg: GameConfig = CONFIG) => (cfg.options.unitSpeeds ? 1 : (cfg.units[type].speed ?? 1));
/** Points a walk of this many hexes costs, rounded up: a light rider pays 1 point for 1 to 3 hexes. */
export const walkCost = (type: Unit['type'], steps: number, cfg: GameConfig = CONFIG) => Math.ceil((steps * stepCost(type, cfg)) / hexesPerPoint(type, cfg));

/** How many hits a fresh piece can take: its defense, times toughness when that rule is on. */
export const maxHp = (type: Unit['type'], cfg: GameConfig = CONFIG) => cfg.units[type].hp * (cfg.options.toughness || 1);

export function makeUnit(s: GameState, type: Unit['type'], owner: Player, pos: Hex, cfg: GameConfig = CONFIG): [Unit, GameState] {
  const seq = s.seq + 1;
  const unit: Unit = { id: `${owner}-${type}-${seq}`, type, owner, pos, hp: maxHp(type, cfg), moved: false, attacked: false };
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
  /** Points the move costs. */
  cost: number;
  /** Hexes walked. */
  steps: number;
}

/** Every empty hex the unit can end a move on with the points left, and its cheapest cost. */
export function reachable(s: GameState, unitId: string, cfg: GameConfig = CONFIG): Map<string, Reach> {
  return search(s, unitId, cfg).out;
}

/** The cheapest route from a unit to a hex it can reach (start excluded), for showing the path. */
export function routeTo(s: GameState, unitId: string, to: Hex, cfg: GameConfig = CONFIG): Hex[] {
  const { out, prev } = search(s, unitId, cfg);
  if (!out.has(key(to))) return [];
  const path: Hex[] = [];
  for (let h: Hex | undefined = to; h; h = prev.get(key(h))) path.unshift(h);
  return path.slice(1);
}

function search(s: GameState, unitId: string, cfg: GameConfig): { out: Map<string, Reach>; prev: Map<string, Hex> } {
  const out = new Map<string, Reach>();
  const prev = new Map<string, Hex>();
  const u = getUnit(s, unitId);
  if (!u || s.phase !== 'act' || u.owner !== s.current) return { out, prev };
  if (u.moved && !cfg.movement.multipleMovesPerUnit) return { out, prev };
  if (u.attacked && !cfg.combat.moveAfterAttack) return { out, prev };

  // Search by hexes walked (every step is one hex); the price in points comes from the walk's length.
  // Top speed: what's left of this piece's hexes for the turn. Riders get one point's worth less than
  // foot pieces (4 on foot, 6 heavy horse, 9 light horse by default), so horses don't cross half the board.
  const limit = cfg.options.runLimit !== null && !cfg.options.unitSpeeds ? (mounted(u, cfg) ? Math.max(1, cfg.options.runLimit - 1) : cfg.options.runLimit) * hexesPerPoint(u.type, cfg) - (u.ran ?? 0) : null;
  // One step at a time: a single move covers at most one point's worth of hexes.
  const stepLimit = cfg.options.stepMoves && !cfg.options.unitSpeeds ? Math.min(limit ?? Infinity, hexesPerPoint(u.type, cfg)) : limit;
  const best = new Map<string, number>([[key(u.pos), 0]]);
  // Small boards: a simple priority list is plenty.
  const open: Reach[] = [{ hex: u.pos, cost: 0, steps: 0 }];
  while (open.length) {
    open.sort((a, b) => a.steps - b.steps);
    const cur = open.shift()!;
    if (cur.steps > (best.get(key(cur.hex)) ?? Infinity)) continue;
    // Zone of control: having stepped next to an enemy, the move ends there.
    if (cfg.options.zoneOfControl && cur.steps > 0 && enemyNext(s, cur.hex, u.owner)) continue;
    for (const n of neighbors(cur.hex)) {
      if (!onBoard(s, n)) continue;
      const t = cfg.terrain[terrainAt(s, n)];
      if (!t.passable || (t.noMounted && mounted(u, cfg))) continue;
      const occ = unitAt(s, n);
      if (occ && (occ.owner !== u.owner || !cfg.movement.passThroughFriendly)) continue;
      const steps = cur.steps + t.moveCostMultiplier;
      if (stepLimit !== null && steps > stepLimit) continue;
      const cost = walkCost(u.type, steps, cfg);
      if (cost > s.points || steps >= (best.get(key(n)) ?? Infinity)) continue;
      best.set(key(n), steps);
      prev.set(key(n), cur.hex);
      open.push({ hex: n, cost, steps });
      if (!occ) out.set(key(n), { hex: n, cost, steps });
    }
  }
  return { out, prev };
}

const enemyNext = (s: GameState, h: Hex, owner: Player) => s.units.some((e) => e.owner !== owner && distance(e.pos, h) === 1);

const mounted = (u: Unit, cfg: GameConfig) => !!cfg.units[u.type].mounted;
const INFANTRY = new Set(['heavyInfantry', 'lightInfantry', 'deputy', 'samurai', 'ashigaru', 'berserker', 'axeThrower', 'lineInfantry', 'skirmisher', 'boarder', 'bomber']);

/** Points value of an army (its King not counted), for the morale rule. */
export function armyValue(s: GameState, p: Player, cfg: GameConfig = CONFIG): number {
  return s.units.filter((u) => u.owner === p && u.type !== 'king').reduce((sum, u) => sum + cfg.army.cost[u.type as keyof GameConfig['army']['cost']], 0);
}

/** How far a shooter standing on this hex reaches: one hex further from high ground. */
export const maxRangeAt = (s: GameState, at: Hex, base: number, cfg: GameConfig = CONFIG): number => base + (cfg.terrain[terrainAt(s, at)].highGround ? 1 : 0);

export function hasLineOfSight(s: GameState, a: Hex, b: Hex, cfg: GameConfig = CONFIG): boolean {
  if (cfg.terrain[terrainAt(s, a)].highGround) return true; // from a hill you see over the trees
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

/** Flanking: another of the attacker's pieces touches the target, and not from the attacker's side
 *  (it isn't next to the attacker), so the target is hit from two directions. */
export function isFlanked(s: GameState, a: Unit, t: Unit): boolean {
  return s.units.some((f) => f.id !== a.id && f.owner === a.owner && distance(f.pos, t.pos) === 1 && distance(f.pos, a.pos) > 1);
}

/** Melee bonuses from the optional rules: cavalry charge, the King's command and flanking. */
function meleeBonus(s: GameState, a: Unit, t: Unit, cfg: GameConfig): number {
  let bonus = 0;
  if (cfg.options.flanking && isFlanked(s, a, t)) bonus += 1;
  if (cfg.options.charge && mounted(a, cfg) && (a.ran ?? 0) >= 3) bonus += 1;
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
  // King's guard: while one of his own pieces stands beside him, the King can't be hit.
  if (cfg.options.kingsGuard && t.type === 'king' && s.units.some((f) => f.id !== t.id && f.owner === t.owner && distance(f.pos, t.pos) === 1)) return 'kingGuarded';
  const rules = cfg.units[a.type];
  let cost: number;
  let raw: number;
  if (kind === 'attack') {
    if (rules.attack <= 0) return 'cannotMelee';
    if (distance(a.pos, t.pos) !== 1) return 'notAdjacent';
    cost = cfg.combat.attackCost;
    raw = rules.attack + meleeBonus(s, a, t, cfg);
    // Spearmen hit riders twice as hard.
    if (rules.antiCavalry && mounted(t, cfg)) raw *= 2;
  } else {
    const r = rules.ranged;
    if (!r) return 'cannotShoot';
    const d = distance(a.pos, t.pos);
    if (d < r.minRange || d > maxRangeAt(s, a.pos, r.maxRange, cfg)) return 'outOfRange';
    if (!hasLineOfSight(s, a.pos, t.pos, cfg)) return 'noLineOfSight';
    if (cfg.options.volleys !== null && (a.shots ?? 0) >= cfg.options.volleys) return 'outOfArrows';
    cost = r.cost * (cfg.options.longShotFrom !== null && d > cfg.options.longShotFrom ? 2 : 1);
    // Two hits from a bow or gun are always enough: a shot takes at least half the target's full health
    // (this only matters when pieces are made tougher). David, 2026-11-17.
    raw = Math.max(r.damage, Math.ceil(maxHp(t.type, cfg) / 2));
  }
  if (s.points < cost) return 'notEnoughPoints';
  const damage = damageOn(s, t, raw, cfg);
  // Spears: cavalry charging into infantry takes a hit back, unless the infantry falls.
  const counter = kind === 'attack' && cfg.options.spears && mounted(a, cfg) && INFANTRY.has(t.type) && t.hp > damage ? 1 : 0;
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
  const dice = cfg.dice.fixed ? [] : Array.from({ length: cfg.dice.count }, () => 1 + Math.floor(rng() * cfg.dice.sides));
  const carried = s.carry?.[s.current] ?? 0;
  // The second player's first turn gets the optional catch-up bonus.
  const bonus = s.turn === 1 && s.current === 'blue' ? cfg.options.firstTurnBonus : 0;
  const total = (cfg.dice.fixed ?? dice.reduce((a, b) => a + b, 0)) + carried + bonus;
  // Remember both armies' size when the battle starts, for the morale rule.
  const startValue = s.startValue ?? { red: armyValue(s, 'red', cfg), blue: armyValue(s, 'blue', cfg) };
  const next: GameState = { ...s, dice, points: total, phase: 'act', startValue, carry: { red: 0, blue: 0, ...s.carry, [s.current]: 0 } };
  return { ok: true, state: withLog(next, { kind: 'roll', turn: s.turn, player: s.current, dice, total }) };
}

/** Rerolls the side has left this battle (optional rule). */
export const rerollsLeft = (s: GameState, p: Player, cfg: GameConfig = CONFIG) =>
  Math.max(0, cfg.options.rerolls - (s.rerolled?.[p] ?? 0));

/** A reroll is allowed straight after rolling, before the turn's first move or strike. */
export function canReroll(s: GameState, cfg: GameConfig = CONFIG): boolean {
  const last = s.log[s.log.length - 1];
  return s.phase === 'act' && !cfg.dice.fixed && last?.kind === 'roll' && last.player === s.current && rerollsLeft(s, s.current, cfg) > 0;
}

/** Throws the dice again, keeping saved points and any bonus. Uses one of the side's rerolls. */
export function reroll(s: GameState, rng: Rng = Math.random, cfg: GameConfig = CONFIG): Result {
  if (!canReroll(s, cfg)) return fail('noReroll');
  const last = s.log[s.log.length - 1] as Extract<LogEntry, { kind: 'roll' }>;
  const extra = last.total - last.dice.reduce((a, b) => a + b, 0);
  const dice = Array.from({ length: cfg.dice.count }, () => 1 + Math.floor(rng() * cfg.dice.sides));
  const total = dice.reduce((a, b) => a + b, 0) + extra;
  const next: GameState = { ...s, dice, points: total, rerolled: { red: 0, blue: 0, ...s.rerolled, [s.current]: (s.rerolled?.[s.current] ?? 0) + 1 } };
  return { ok: true, state: withLog(next, { kind: 'roll', turn: s.turn, player: s.current, dice, total, reroll: true }) };
}

export function moveUnit(s: GameState, unitId: string, to: Hex, cfg: GameConfig = CONFIG): Result {
  if (s.phase !== 'act') return fail('wrongPhase');
  const u = getUnit(s, unitId);
  if (!u) return fail('noSuchUnit');
  if (u.owner !== s.current) return fail('notYourUnit');
  if (u.moved && !cfg.movement.multipleMovesPerUnit) return fail('alreadyMoved');
  const r = reachable(s, unitId, cfg).get(key(to));
  if (!r) return fail('unreachable');
  const hexes = r.steps;
  const path = routeTo(s, unitId, to, cfg);
  const units = s.units.map((x) => (x.id === unitId ? { ...x, pos: to, moved: true, ran: (x.ran ?? 0) + hexes } : x));
  const next: GameState = { ...s, units, points: s.points - r.cost, advance: null };
  return {
    ok: true,
    state: withLog(next, { kind: 'move', turn: s.turn, player: s.current, unit: u.type, from: u.pos, to, cost: r.cost, path }),
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
