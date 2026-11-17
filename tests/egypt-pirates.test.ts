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

describe('Egypt and Pirates', () => {
  it('a chariot is a fast rider with 2 hp that shoots 2-4 hexes', () => {
    const c = CONFIG.units.chariot;
    expect(c).toMatchObject({ mounted: true, speed: 3, moveCost: 1, hp: 2, attack: 1, heavy: false });
    const s = scenario([['red', 'chariot', 3, 2], ['blue', 'heavyInfantry', 3, 6]]);
    const a = ok(shoot(s, s.units[0].id, s.units[1].id, OPEN));
    expect(a.points).toBe(17);
    expect(getUnit(a, s.units[1].id)!.hp).toBe(1);
    const far = scenario([['red', 'chariot', 3, 2], ['blue', 'heavyInfantry', 3, 7]]);
    expect(shoot(far, far.units[0].id, far.units[1].id, OPEN)).toEqual({ ok: false, error: 'outOfRange' });
  });

  it('a boarder hits for 2 in melee and has 1 hp', () => {
    expect(CONFIG.units.boarder).toMatchObject({ attack: 2, hp: 1, ranged: null, heavy: false });
    const s = scenario([['red', 'boarder', 3, 3], ['blue', 'heavyInfantry', 3, 4]]);
    const a = ok(attack(s, s.units[0].id, s.units[1].id, OPEN));
    expect(getUnit(a, s.units[1].id)).toBeUndefined();
  });

  it('a bomber throws 2-3 hexes for 2 damage and cannot melee', () => {
    const s = scenario([['red', 'bomber', 3, 3], ['blue', 'heavyInfantry', 3, 6]]);
    expect(getUnit(ok(shoot(s, s.units[0].id, s.units[1].id, OPEN)), s.units[1].id)).toBeUndefined();
    const far = scenario([['red', 'bomber', 3, 3], ['blue', 'heavyInfantry', 3, 7]]);
    expect(shoot(far, far.units[0].id, far.units[1].id, OPEN)).toEqual({ ok: false, error: 'outOfRange' });
    const near = scenario([['red', 'bomber', 3, 3], ['blue', 'lightInfantry', 3, 4]]);
    expect(attack(near, near.units[0].id, near.units[1].id, OPEN).ok).toBe(false);
  });

  it('both armies are listed in their era, priced, and have all 8 views of every piece', () => {
    expect(ERA_OF.egypt).toBe('ancient');
    expect(ERA_OF.pirates).toBe('gunpowder');
    for (const id of ['egypt', 'pirates'] as const) {
      expect(FACTION_ORDER).toContain(id);
      const f = FACTIONS[id];
      for (const t of f.roster) expect(CONFIG.army.cost[t]).toBeGreaterThan(0);
      for (const t of ['king', ...f.roster]) expect(Object.keys(SPRITES[id][t] ?? {}).length).toBe(8);
      const army = suggestArmy(() => 0.5, CONFIG, f.roster);
      expect(armyCost(army)).toBeLessThanOrEqual(CONFIG.army.budget);
      expect(Object.keys(army).every((t) => f.roster.includes(t as never))).toBe(true);
    }
  });
});
