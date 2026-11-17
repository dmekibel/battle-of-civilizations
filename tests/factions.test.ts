import { describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig, type UnitTypeId } from '../src/config';
import { armyCost, buildBoard, newGame, previewStrike, suggestArmy, type GameState, type Player } from '../src/engine';

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

describe('faction pieces', () => {
  it('horse archers shoot from 2 to 4 hexes', () => {
    const s = scenario([['red', 'horseArcher', 3, 1], ['blue', 'heavyInfantry', 3, 5], ['blue', 'heavyInfantry', 3, 7]]);
    expect(previewStrike(s, s.units[0].id, s.units[1].id, 'shoot', OPEN)?.damage).toBe(1);
    expect(previewStrike(s, s.units[0].id, s.units[2].id, 'shoot', OPEN)).toBeNull();
  });

  it('ashigaru spearmen hit mounted pieces twice as hard', () => {
    const s = scenario([['red', 'ashigaru', 3, 3], ['blue', 'heavyCavalry', 3, 4], ['blue', 'heavyInfantry', 2, 3]]);
    expect(previewStrike(s, s.units[0].id, s.units[1].id, 'attack', OPEN)?.damage).toBe(2);
    expect(previewStrike(s, s.units[0].id, s.units[2].id, 'attack', OPEN)?.damage).toBe(1);
  });

  it('samurai hit for 2', () => {
    const s = scenario([['red', 'samurai', 3, 3], ['blue', 'heavyInfantry', 3, 4]]);
    expect(previewStrike(s, s.units[0].id, s.units[1].id, 'attack', OPEN)).toMatchObject({ damage: 2, kills: true });
  });

  it('Old West: gunslingers shoot 2-3 hexes, riflemen up to 6, cowboys shoot from the saddle and count as riders', () => {
    const s = scenario([['red', 'gunslinger', 3, 1], ['red', 'rifleman', 5, 1], ['red', 'cowboy', 7, 1], ['blue', 'heavyInfantry', 3, 4], ['blue', 'heavyInfantry', 5, 7], ['blue', 'ashigaru', 7, 2]]);
    expect(previewStrike(s, s.units[0].id, s.units[3].id, 'shoot', OPEN)?.damage).toBe(1);
    expect(previewStrike(s, s.units[1].id, s.units[4].id, 'shoot', OPEN)?.damage).toBe(1);
    const theirTurn = { ...s, current: 'blue' as const };
    expect(previewStrike(theirTurn, s.units[5].id, s.units[2].id, 'attack', OPEN)?.damage).toBe(2); // spearmen vs a rider
  });

  it('Old West: deputies fire their shotguns at 2 hexes only, and still fight hand to hand', () => {
    const s = scenario([['red', 'deputy', 3, 3], ['blue', 'heavyInfantry', 5, 3], ['blue', 'heavyInfantry', 6, 3], ['blue', 'ashigaru', 4, 3]]);
    expect(previewStrike(s, s.units[0].id, s.units[1].id, 'shoot', OPEN)?.damage).toBe(1);
    expect(previewStrike(s, s.units[0].id, s.units[2].id, 'shoot', OPEN)).toBeNull();
    expect(previewStrike(s, s.units[0].id, s.units[3].id, 'attack', OPEN)?.damage).toBe(1);
  });

  it('a suggested army only uses its faction’s pieces', () => {
    const mongols = suggestArmy(Math.random, CONFIG, ['lightInfantry', 'archer', 'lightCavalry', 'heavyCavalry', 'horseArcher']);
    expect(mongols.heavyInfantry ?? 0).toBe(0);
    expect(mongols.horseArcher).toBeGreaterThan(0);
    expect(armyCost(mongols)).toBeLessThanOrEqual(CONFIG.army.budget);
  });
});
