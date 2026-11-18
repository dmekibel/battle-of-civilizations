import { describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig, type UnitTypeId } from '../src/config';
import { attack, buildBoard, getUnit, newGame, shoot, suggestArmy, armyCost, type GameState, type Player, type Result } from '../src/engine';
import { ERA_OF, FACTIONS, FACTION_ORDER } from '../src/ui/factions';
import { SPRITES } from '../src/ui/sprites';

/** An empty field: no river, no forest, no hills. */
const OPEN: GameConfig = { ...CONFIG, board: { ...CONFIG.board, riverCol: null, bridgeRows: [], forests: [], rivers: [], hills: [], swamps: [], lakes: [] } };

function scenario(specs: [Player, UnitTypeId, number, number][], points = 18): GameState {
  return {
    ...newGame(OPEN),
    board: buildBoard(OPEN),
    units: specs.map(([owner, type, col, row], i) => ({ id: `${owner}-${type}-${i}`, type, owner, pos: { col, row }, hp: OPEN.units[type].hp, moved: false, attacked: false })),
    phase: 'act',
    points,
  };
}

const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

describe('Ottomans, Aztecs and Zulus', () => {
  it('a jaguar warrior hits for 2 and takes two blows', () => {
    expect(CONFIG.units.jaguar).toMatchObject({ moveCost: 3, attack: 2, hp: 2, ranged: null, heavy: true });
    expect(CONFIG.army.cost.jaguar).toBe(4);
    const s = scenario([['red', 'jaguar', 3, 3], ['blue', 'heavyInfantry', 3, 4]]);
    expect(getUnit(ok(attack(s, s.units[0].id, s.units[1].id, OPEN)), s.units[1].id)).toBeUndefined();
  });

  it('an atlatl thrower reaches 2-4 hexes for 1 damage', () => {
    expect(CONFIG.units.atlatl).toMatchObject({ moveCost: 3, attack: 1, hp: 1, heavy: false, ranged: { cost: 1, minRange: 2, maxRange: 4, damage: 1 } });
    expect(CONFIG.army.cost.atlatl).toBe(3);
    const s = scenario([['red', 'atlatl', 3, 2], ['blue', 'heavyInfantry', 3, 6]]);
    expect(getUnit(ok(shoot(s, s.units[0].id, s.units[1].id, OPEN)), s.units[1].id)!.hp).toBe(1);
    const far = scenario([['red', 'atlatl', 3, 2], ['blue', 'heavyInfantry', 3, 7]]);
    expect(shoot(far, far.units[0].id, far.units[1].id, OPEN)).toEqual({ ok: false, error: 'outOfRange' });
  });

  it('an impi hits for 2, has 1 hp and is a spearman against riders', () => {
    expect(CONFIG.units.impi).toMatchObject({ moveCost: 3, attack: 2, hp: 1, ranged: null, heavy: false, antiCavalry: true });
    expect(CONFIG.army.cost.impi).toBe(2);
    const s = scenario([['red', 'impi', 3, 3], ['blue', 'heavyInfantry', 3, 4]]);
    expect(getUnit(ok(attack(s, s.units[0].id, s.units[1].id, OPEN)), s.units[1].id)).toBeUndefined();
  });

  it('a spear thrower runs 2 hexes a point and reaches 2-4 hexes', () => {
    expect(CONFIG.units.thrower).toMatchObject({ moveCost: 3, speed: 2, attack: 1, hp: 1, heavy: false, ranged: { cost: 1, minRange: 2, maxRange: 4, damage: 1 } });
    expect(CONFIG.army.cost.thrower).toBe(2);
    const s = scenario([['red', 'thrower', 3, 3], ['blue', 'lightInfantry', 3, 7]]);
    expect(getUnit(ok(shoot(s, s.units[0].id, s.units[1].id, OPEN)), s.units[1].id)).toBeUndefined();
    const far = scenario([['red', 'thrower', 3, 3], ['blue', 'lightInfantry', 3, 8]]);
    expect(shoot(far, far.units[0].id, far.units[1].id, OPEN)).toEqual({ ok: false, error: 'outOfRange' });
  });

  it('all three armies are listed in their era, priced, and have all 8 views of every piece', () => {
    expect(ERA_OF.ottomans).toBe('gunpowder');
    expect(ERA_OF.aztecs).toBe('medieval');
    expect(ERA_OF.zulus).toBe('gunpowder');
    for (const id of ['ottomans', 'aztecs', 'zulus'] as const) {
      expect(FACTION_ORDER).toContain(id);
      const f = FACTIONS[id];
      for (const t of f.roster) expect(CONFIG.army.cost[t]).toBeGreaterThan(0);
      for (const t of ['king', ...f.roster]) expect(Object.keys(SPRITES[id]?.[t] ?? {}).length).toBe(8);
      const army = suggestArmy(() => 0.5, CONFIG, f.roster);
      expect(armyCost(army)).toBeLessThanOrEqual(CONFIG.army.budget);
      expect(Object.keys(army).every((t) => f.roster.includes(t as never))).toBe(true);
    }
    // No horses for the Aztecs and Zulus, no guns for the Zulus.
    for (const id of ['aztecs', 'zulus'] as const) expect(FACTIONS[id].roster.some((t) => CONFIG.units[t].mounted)).toBe(false);
    expect(FACTIONS.zulus.roster.some((t) => ['skirmisher', 'cannon', 'lineInfantry', 'rifleman'].includes(t))).toBe(false);
  });
});
