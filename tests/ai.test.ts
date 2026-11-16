import { describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig, type UnitTypeId } from '../src/config';
import { aiNextAction, autoDeploy, buildBoard, draftArmy, finishDeploy, newGame, playAiTurn, quickStart, suggestArmy, type GameState, type Player, type Result } from '../src/engine';

const OPEN: GameConfig = { ...CONFIG, board: { ...CONFIG.board, riverCol: null, bridgeRows: [], forests: [] } };

function scenario(specs: [Player, UnitTypeId, number, number][], points = 18): GameState {
  return {
    ...newGame(OPEN),
    board: buildBoard(OPEN),
    units: specs.map(([owner, type, col, row], i) => ({ id: `${owner}-${type}-${i}`, type, owner, pos: { col, row }, hp: OPEN.units[type].hp, moved: false, attacked: false })),
    phase: 'act',
    points,
  };
}

/** Small deterministic random numbers. */
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

describe('computer opponent', () => {
  it('kills the King when it can', () => {
    const s = scenario([['red', 'heavyCavalry', 3, 3], ['blue', 'king', 3, 4], ['blue', 'lightInfantry', 3, 2]]);
    expect(aiNextAction(s, OPEN)).toEqual({ kind: 'attack', unitId: 'red-heavyCavalry-0', targetId: 'blue-king-1' });
  });

  it('prefers a kill to a scratch', () => {
    const s = scenario([['red', 'lightInfantry', 3, 3], ['blue', 'heavyInfantry', 3, 4], ['blue', 'archer', 2, 3]]);
    expect(aiNextAction(s, OPEN)).toMatchObject({ kind: 'attack', targetId: 'blue-archer-2' });
  });

  it('marches towards the enemy when nothing is in reach', () => {
    const s = scenario([['red', 'lightCavalry', 1, 5], ['blue', 'king', 20, 5]], 4);
    const a = aiNextAction(s, OPEN);
    expect(a?.kind).toBe('move');
  });

  it('ends its turn when it has nothing worth doing', () => {
    const s = scenario([['red', 'king', 0, 0], ['blue', 'king', 20, 10]], 3);
    expect(aiNextAction(s, OPEN)).toBeNull();
  });

  it('two computer players finish a whole game', () => {
    const rng = seeded(7);
    let s = newGame();
    for (const _ of [0, 1]) s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, suggestArmy(rng)))))));
    let turns = 0;
    while (s.phase !== 'over' && turns < 400) {
      s = playAiTurn(s, rng);
      turns++;
    }
    expect(s.winner).not.toBeNull();
  });

  it('plays a turn from the quick-battle start without errors', () => {
    const s = playAiTurn(quickStart(), seeded(3));
    expect(s.current).toBe('blue');
    expect(s.log.some((e) => e.kind === 'move')).toBe(true);
  });
});
