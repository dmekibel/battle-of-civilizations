import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig, type UnitTypeId, type WeatherKind } from '../src/config';
import { autoDeploy, buildBoard, draftArmy, finishDeploy, newGame, playAiTurn, previewStrike, reachable, suggestArmy, type GameState, type Player, type Result } from '../src/engine';

const OPEN: GameConfig = { ...CONFIG, board: { ...CONFIG.board, riverCol: null, bridgeRows: [], forests: [] } };
const sky = (kind: WeatherKind, on: boolean): GameConfig => ({ ...OPEN, weather: { time: 'day', kind }, options: { ...OPEN.options, rainRange: on, snowCavalry: on, fogCap: on } });

function scenario(cfg: GameConfig, specs: [Player, UnitTypeId, number, number][], points = 18): GameState {
  return {
    ...newGame(cfg),
    board: buildBoard(cfg),
    units: specs.map(([owner, type, col, row], i) => ({ id: `${owner}-${type}-${i}`, type, owner, pos: { col, row }, hp: cfg.units[type].hp, moved: false, attacked: false })),
    phase: 'act',
    points,
  };
}
const shotAt = (cfg: GameConfig, d: number) => {
  // An archer and a target d hexes away along the same column.
  const s = scenario(cfg, [['red', 'archer', 4, 2], ['blue', 'lightInfantry', 4, 2 + d]]);
  return previewStrike(s, s.units[0].id, s.units[1].id, 'shoot', cfg);
};

describe('weather rules', () => {
  it('rain: shooters reach one hex less, only with the rule on', () => {
    expect(shotAt(sky('rain', false), 5)).not.toBeNull();
    expect(shotAt(sky('rain', true), 5)).toBeNull();
    expect(shotAt(sky('rain', true), 4)).not.toBeNull();
    expect(shotAt(sky('clear', true), 5)).not.toBeNull();
  });

  it('fog: no shot reaches past 4 hexes, only with the rule on', () => {
    expect(shotAt(sky('fog', false), 5)).not.toBeNull();
    expect(shotAt(sky('fog', true), 5)).toBeNull();
    expect(shotAt(sky('fog', true), 4)).not.toBeNull();
  });

  it('snow: riders move one hex less per point, only with the rule on; foot pieces are not slowed', () => {
    const far = (cfg: GameConfig, type: UnitTypeId) => {
      const s = scenario(cfg, [['red', type, 10, 7]], 1);
      return Math.max(...[...reachable(s, s.units[0].id, cfg).values()].map((r) => r.steps));
    };
    expect(far(sky('snow', false), 'lightCavalry')).toBe(3);
    expect(far(sky('snow', true), 'lightCavalry')).toBe(2);
    expect(far(sky('snow', true), 'heavyCavalry')).toBe(1);
    expect(far(sky('snow', true), 'lightInfantry')).toBe(1);
    expect(far(sky('rain', true), 'lightCavalry')).toBe(3);
  });
});

/** Small deterministic random numbers. */
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

describe('computer games in every weather', () => {
  const saved = { weather: CONFIG.weather, options: CONFIG.options };
  afterEach(() => {
    CONFIG.weather = saved.weather;
    CONFIG.options = saved.options;
  });
  for (const kind of ['clear', 'rain', 'snow', 'fog'] as WeatherKind[]) {
    it(`two computer players finish a game in ${kind}`, () => {
      CONFIG.weather = { time: 'night', kind };
      CONFIG.options = { ...saved.options, rainRange: true, snowCavalry: true, fogCap: true };
      const rng = seeded(11);
      let s = newGame();
      for (const _ of [0, 1]) s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, suggestArmy(rng)))))));
      let turns = 0;
      while (s.phase !== 'over' && turns < 600) {
        s = playAiTurn(s, rng);
        turns++;
      }
      expect(s.winner).not.toBeNull();
    });
  }
});
