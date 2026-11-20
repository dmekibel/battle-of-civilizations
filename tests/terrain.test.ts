import { describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig, type UnitTypeId } from '../src/config';
import { buildBoard, newGame, previewStrike, reachable, type GameState, type Player } from '../src/engine';

const land = (extra: Partial<GameConfig['board']>): GameConfig => ({ ...CONFIG, board: { ...CONFIG.board, riverCol: null, bridgeRows: [], forests: [], ...extra } });

function scenario(cfg: GameConfig, specs: [Player, UnitTypeId, number, number][], points = 18): GameState {
  return {
    ...newGame(cfg),
    board: buildBoard(cfg),
    units: specs.map(([owner, type, col, row], i) => ({ id: `${owner}-${type}-${i}`, type, owner, pos: { col, row }, hp: cfg.units[type].hp, moved: false, attacked: false })),
    phase: 'act',
    points,
  };
}

describe('terrain', () => {
  it('from a hill an archer reaches one hex further and sees over forest', () => {
    const flat = land({ forests: [[3, 4]] });
    const hill = land({ forests: [[3, 4]], hills: [[3, 1]] });
    const units: [Player, UnitTypeId, number, number][] = [['red', 'archer', 3, 1], ['blue', 'heavyInfantry', 3, 7], ['blue', 'heavyInfantry', 3, 6]];
    const a = scenario(flat, units);
    expect(previewStrike(a, a.units[0].id, a.units[1].id, 'shoot', flat)).toBeNull(); // 6 hexes: too far
    expect(previewStrike(a, a.units[0].id, a.units[2].id, 'shoot', flat)).toBeNull(); // behind the trees
    const b = scenario(hill, units);
    expect(previewStrike(b, b.units[0].id, b.units[1].id, 'shoot', hill)?.damage).toBe(1);
    expect(previewStrike(b, b.units[0].id, b.units[2].id, 'shoot', hill)?.damage).toBe(1);
  });

  it('swamp stops riders and costs foot double; a lake stops everyone', () => {
    const cfg = land({ swamps: [[4, 3]], lakes: [[2, 3]] });
    const s = scenario(cfg, [['red', 'lightCavalry', 3, 3], ['red', 'lightInfantry', 3, 4]]);
    const horse = reachable(s, s.units[0].id, cfg);
    expect(horse.has('4,3')).toBe(false);
    expect(horse.has('2,3')).toBe(false);
    const foot = scenario(cfg, [['red', 'lightInfantry', 3, 3]]);
    const cfgFree: GameConfig = { ...cfg, options: { ...cfg.options, stepMoves: false } };
    expect(reachable(foot, foot.units[0].id, cfgFree).get('4,3')?.steps).toBe(2);
    expect(reachable(foot, foot.units[0].id, cfgFree).has('2,3')).toBe(false);
  });

  it('a second river and fords are laid out from the map', () => {
    const cfg = land({ rivers: [{ col: 10, bridges: [3], fords: [5] }, { col: 14, bridges: [], fords: [] }] });
    const col = (c: number) => buildBoard(cfg).map((row) => row[c]);
    expect(col(10)[3]).toBe('bridge');
    expect(col(10)[5]).toBe('ford');
    expect(col(14).every((t) => t === 'river')).toBe(true);
  });
});
