import { describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig, type UnitTypeId } from '../src/config';
import { attack, buildBoard, makeUnit, endTurn, getUnit, moveUnit, newGame, previewStrike, reachable, rollDice, shoot, type GameState, type Player, type Result } from '../src/engine';

/** An open field (no river, no forest) with one optional rule switched on. */
const withRule = (o: Partial<GameConfig['options']>): GameConfig => ({
  ...CONFIG,
  board: { ...CONFIG.board, riverCol: null, bridgeRows: [], forests: [] },
  options: { ...CONFIG.options, ...o },
});

function scenario(cfg: GameConfig, specs: [Player, UnitTypeId, number, number][], points = 18): GameState {
  return {
    ...newGame(cfg),
    board: buildBoard(cfg),
    units: specs.map(([owner, type, col, row], i) => ({ id: `${owner}-${type}-${i}`, type, owner, pos: { col, row }, hp: cfg.units[type].hp, moved: false, attacked: false })),
    phase: 'act',
    points,
  };
}

const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const sixes = () => 5.5 / 6;

describe('optional rules', () => {
  it('all are off by default', () => {
    expect(CONFIG.options).toEqual({ firstTurnBonus: 0, carryMax: 0, routAt: null, shieldWall: false, spears: false, longShotFrom: null, volleys: null, charge: false, kingAura: false, zoneOfControl: false, toughness: 1, unitSpeeds: false, runLimit: 3 });
  });

  it('first-turn bonus: the second player gets extra points on turn 1 only', () => {
    const cfg = withRule({ firstTurnBonus: 2 });
    let s = scenario(cfg, [['red', 'king', 0, 0], ['blue', 'king', 20, 0]]);
    s = { ...s, phase: 'roll', current: 'blue' };
    expect(ok(rollDice(s, sixes, cfg)).points).toBe(20);
    expect(ok(rollDice({ ...s, turn: 2 }, sixes, cfg)).points).toBe(18);
  });

  it('carry: up to the limit of unused points comes back next turn', () => {
    const cfg = withRule({ carryMax: 3 });
    let s = scenario(cfg, [['red', 'king', 0, 0], ['blue', 'king', 20, 0]], 7);
    s = ok(endTurn(s, cfg));
    expect(s.carry?.red).toBe(3);
    s = ok(endTurn(ok(rollDice(s, sixes, cfg)), cfg)); // blue
    expect(ok(rollDice(s, sixes, cfg)).points).toBe(21); // red: 18 + 3
  });

  it('morale: an army that loses half its points routs', () => {
    const cfg = withRule({ routAt: 0.5 });
    let s = scenario(cfg, [['red', 'heavyCavalry', 3, 3], ['blue', 'lightInfantry', 3, 4], ['blue', 'king', 20, 0]]);
    s = { ...s, startValue: { red: 4, blue: 1 } };
    s = ok(attack(s, s.units[0].id, s.units[1].id, cfg));
    expect(s.winner).toBe('red');
    expect(s.winReason).toBe('routed');
  });

  it('shield wall: heavy infantry beside heavy infantry takes 1 less damage', () => {
    const cfg = withRule({ shieldWall: true });
    const s = scenario(cfg, [['red', 'heavyCavalry', 3, 3], ['blue', 'heavyInfantry', 3, 4], ['blue', 'heavyInfantry', 3, 5]]);
    expect(previewStrike(s, s.units[0].id, s.units[1].id, 'attack', cfg)!.damage).toBe(1);
    const alone = scenario(cfg, [['red', 'heavyCavalry', 3, 3], ['blue', 'heavyInfantry', 3, 4]]);
    expect(previewStrike(alone, alone.units[0].id, alone.units[1].id, 'attack', cfg)!.damage).toBe(2);
  });

  it('spears: cavalry attacking infantry that survives takes 1 damage back', () => {
    const cfg = withRule({ spears: true });
    const s = scenario(cfg, [['red', 'lightCavalry', 3, 3], ['blue', 'heavyInfantry', 3, 4]]);
    const a = ok(attack(s, s.units[0].id, s.units[1].id, cfg));
    expect(getUnit(a, s.units[0].id)).toBeUndefined(); // light cavalry has 1 defense
    expect(a.log[a.log.length - 1]).toMatchObject({ counter: 1, attackerKilled: true });
    const kill = scenario(cfg, [['red', 'heavyCavalry', 3, 3], ['blue', 'lightInfantry', 3, 4]]);
    expect(previewStrike(kill, kill.units[0].id, kill.units[1].id, 'attack', cfg)!.counter).toBe(0); // no hit back from the dead
  });

  it('long shots cost double beyond the set distance; arrows run out', () => {
    const cfg = withRule({ longShotFrom: 3, volleys: 1 });
    const s = scenario(cfg, [['red', 'archer', 3, 1], ['blue', 'heavyInfantry', 3, 6], ['blue', 'heavyInfantry', 3, 4]]);
    expect(previewStrike(s, s.units[0].id, s.units[1].id, 'shoot', cfg)!.cost).toBe(4);
    expect(previewStrike(s, s.units[0].id, s.units[2].id, 'shoot', cfg)!.cost).toBe(2);
    const a = ok(shoot(s, s.units[0].id, s.units[2].id, cfg));
    expect(shoot(a, s.units[0].id, s.units[1].id, cfg)).toEqual({ ok: false, error: 'outOfArrows' });
  });

  it('charge: cavalry that moved 3+ hexes this turn hits for +1', () => {
    const cfg = withRule({ charge: true });
    let s = scenario(cfg, [['red', 'lightCavalry', 3, 0], ['blue', 'heavyInfantry', 3, 5]]);
    expect(previewStrike(ok(moveUnit(s, s.units[0].id, { col: 3, row: 4 }, cfg)), s.units[0].id, s.units[1].id, 'attack', cfg)!.damage).toBe(2);
    s = scenario(cfg, [['red', 'lightCavalry', 3, 3], ['blue', 'heavyInfantry', 3, 5]]);
    expect(previewStrike(ok(moveUnit(s, s.units[0].id, { col: 3, row: 4 }, cfg)), s.units[0].id, s.units[1].id, 'attack', cfg)!.damage).toBe(1);
  });

  it("King's command: pieces within 2 hexes of their King hit for +1", () => {
    const cfg = withRule({ kingAura: true });
    const s = scenario(cfg, [['red', 'lightInfantry', 3, 3], ['red', 'king', 3, 1], ['blue', 'heavyInfantry', 3, 4]]);
    expect(previewStrike(s, s.units[0].id, s.units[2].id, 'attack', cfg)!.damage).toBe(2);
  });

  it('zone of control: stepping next to an enemy ends the move', () => {
    const cfg = withRule({ zoneOfControl: true });
    // A light cavalry with 1 point (3 hexes), an enemy two hexes ahead: the hexes behind the enemy
    // are only reachable by passing next to it, which zone of control forbids.
    const s = scenario(cfg, [['red', 'lightCavalry', 4, 4], ['blue', 'heavyInfantry', 4, 6]], 1);
    const zoc = reachable(s, s.units[0].id, cfg);
    const free = reachable(s, s.units[0].id, withRule({}));
    expect([...zoc.keys()].every((k) => free.has(k))).toBe(true);
    expect(zoc.has('4,5')).toBe(true); // stepping up to the enemy is fine
    expect(free.has('3,6') && !zoc.has('3,6')).toBe(true); // slipping past it is not
  });
  it('tougher pieces: each piece takes its defense times two hits, one shot at a time', () => {
    const cfg = withRule({ toughness: 2 });
    const [li] = makeUnit(newGame(cfg), 'lightInfantry', 'blue', { col: 5, row: 0 }, cfg);
    const [hi] = makeUnit(newGame(cfg), 'heavyInfantry', 'blue', { col: 5, row: 0 }, cfg);
    expect([li.hp, hi.hp]).toEqual([2, 4]);
    let s = scenario(cfg, [['red', 'king', 0, 0], ['red', 'archer', 1, 0], ['blue', 'king', 20, 0], ['blue', 'lightInfantry', 5, 0]]);
    s = { ...s, units: s.units.map((u) => (u.type === 'lightInfantry' ? { ...u, hp: 2 } : u)) };
    s = ok(shoot(s, 'red-archer-1', 'blue-lightInfantry-3', cfg));
    expect(getUnit(s, 'blue-lightInfantry-3')?.hp).toBe(1);
    s = ok(shoot(s, 'red-archer-1', 'blue-lightInfantry-3', cfg));
    expect(getUnit(s, 'blue-lightInfantry-3')).toBeUndefined();
  });
});
