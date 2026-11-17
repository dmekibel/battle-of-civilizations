import { describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig, type UnitTypeId } from '../src/config';
import { buildBoard, getUnit, newGame, shoot, type GameState, type Player, type Result } from '../src/engine';

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

describe('Napoleonic pieces', () => {
  it('line infantry has 2 hp and shoots at range 2-3 only', () => {
    expect(CONFIG.units.lineInfantry.hp).toBe(2);
    for (const row of [5, 6]) {
      const s = scenario([['red', 'lineInfantry', 3, 3], ['blue', 'heavyInfantry', 3, row]]);
      const a = ok(shoot(s, s.units[0].id, s.units[1].id, OPEN));
      expect(a.points).toBe(17);
      expect(getUnit(a, s.units[1].id)!.hp).toBe(1);
    }
    for (const row of [4, 7]) {
      const s = scenario([['red', 'lineInfantry', 3, 3], ['blue', 'heavyInfantry', 3, row]]);
      expect(shoot(s, s.units[0].id, s.units[1].id, OPEN)).toEqual({ ok: false, error: 'outOfRange' });
    }
  });

  it('skirmishers reach 5 hexes but not 6', () => {
    const s = scenario([['red', 'skirmisher', 3, 2], ['blue', 'heavyInfantry', 3, 7]]);
    expect(getUnit(ok(shoot(s, s.units[0].id, s.units[1].id, OPEN)), s.units[1].id)!.hp).toBe(1);
    const far = scenario([['red', 'skirmisher', 3, 2], ['blue', 'heavyInfantry', 3, 8]]);
    expect(shoot(far, far.units[0].id, far.units[1].id, OPEN)).toEqual({ ok: false, error: 'outOfRange' });
  });

  it('a cannon reaches 8 hexes and hits for 2', () => {
    const s = scenario([['red', 'cannon', 3, 1], ['blue', 'heavyInfantry', 3, 9]]);
    const a = ok(shoot(s, s.units[0].id, s.units[1].id, OPEN));
    expect(a.points).toBe(16);
    expect(getUnit(a, s.units[1].id)).toBeUndefined();
    const far = scenario([['red', 'cannon', 3, 1], ['blue', 'heavyInfantry', 3, 10]]);
    expect(shoot(far, far.units[0].id, far.units[1].id, OPEN)).toEqual({ ok: false, error: 'outOfRange' });
  });
});
