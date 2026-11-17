import { describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig, type UnitTypeId } from '../src/config';
import { armyCost, attack, autoDeploy, buildBoard, draftArmy, finishDeploy, getUnit, maxHp, newGame, playAiTurn, shoot, suggestArmy, type GameState, type Player, type Result } from '../src/engine';
import { FACTIONS, type FactionId } from '../src/ui/factions';
import { SPRITES } from '../src/ui/sprites';

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

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

const CHAMPION_OF: Partial<Record<FactionId, UnitTypeId>> = {
  vikings: 'champion', teutonic: 'champion', novgorod: 'champion', japanese: 'champion',
  mongols: 'championRider', comanche: 'championRider', frontier: 'championGun',
};

describe('Champions', () => {
  it('have their stats and prices', () => {
    expect(CONFIG.units.champion).toMatchObject({ moveCost: 3, attack: 2, hp: 3, ranged: null, heavy: true });
    expect(CONFIG.units.championRider).toMatchObject({ moveCost: 1, speed: 3, attack: 2, hp: 3, ranged: null, heavy: true, mounted: true });
    expect(CONFIG.units.championGun).toMatchObject({ moveCost: 3, attack: 1, hp: 3, ranged: { cost: 1, minRange: 2, maxRange: 4, damage: 2 }, heavy: false });
    expect(CONFIG.army.cost).toMatchObject({ champion: 6, championRider: 7, championGun: 7 });
    expect(maxHp('champion')).toBe(3);
  });

  it('each of the seven armies has exactly one, with a name and all 8 views', () => {
    for (const [id, type] of Object.entries(CHAMPION_OF) as [FactionId, UnitTypeId][]) {
      const f = FACTIONS[id];
      expect(f.roster).toContain(type);
      expect(f.roster.filter((t) => t.startsWith('champion')).length).toBe(1);
      expect(f.names?.[type]?.en).toBeTruthy();
      expect(f.names?.[type]?.ru).toBeTruthy();
      expect(f.champion?.en).toBeTruthy();
      expect(Object.keys(SPRITES[id][type] ?? {}).length).toBe(8);
    }
  });

  it('an army may buy only one', () => {
    const s = newGame();
    expect(draftArmy(s, { champion: 2 })).toEqual({ ok: false, error: 'badArmy' });
    expect(draftArmy(s, { champion: 1 }).ok).toBe(true);
    for (const id of Object.keys(CHAMPION_OF) as FactionId[]) {
      for (let seed = 1; seed < 6; seed++) {
        const army = suggestArmy(seeded(seed), CONFIG, FACTIONS[id].roster);
        expect(armyCost(army)).toBeLessThanOrEqual(CONFIG.army.budget);
        for (const t of ['champion', 'championRider', 'championGun'] as const) expect(army[t] ?? 0).toBeLessThanOrEqual(1);
      }
    }
  });

  it('takes three hits of 1 and survives two', () => {
    let s = scenario([['red', 'heavyInfantry', 3, 3], ['blue', 'champion', 3, 4]]);
    s = ok(attack(s, s.units[0].id, s.units[1].id, OPEN));
    expect(getUnit(s, 'blue-champion-1')!.hp).toBe(2);
    s = ok(attack(s, s.units[0].id, 'blue-champion-1', OPEN));
    expect(getUnit(s, 'blue-champion-1')!.hp).toBe(1);
    s = ok(attack(s, s.units[0].id, 'blue-champion-1', OPEN));
    expect(getUnit(s, 'blue-champion-1')).toBeUndefined();
  });

  it('the bounty hunter shoots 2-4 hexes for 2', () => {
    const s = scenario([['red', 'championGun', 3, 2], ['blue', 'heavyInfantry', 3, 6]]);
    expect(getUnit(ok(shoot(s, s.units[0].id, s.units[1].id, OPEN)), s.units[1].id)).toBeUndefined();
    const far = scenario([['red', 'championGun', 3, 2], ['blue', 'heavyInfantry', 3, 7]]);
    expect(shoot(far, far.units[0].id, far.units[1].id, OPEN)).toEqual({ ok: false, error: 'outOfRange' });
  });

  it('two computer players with champions finish a whole game', () => {
    for (const [red, blue] of [['vikings', 'mongols'], ['frontier', 'comanche'], ['teutonic', 'japanese']] as [FactionId, FactionId][]) {
      const rng = seeded(11);
      let s = newGame();
      for (const id of [red, blue]) {
        const army = { ...suggestArmy(rng, { ...CONFIG, army: { ...CONFIG.army, budget: CONFIG.army.budget - CONFIG.army.cost[CHAMPION_OF[id] as 'champion'] } }, FACTIONS[id].roster.filter((t) => !t.startsWith('champion'))), [CHAMPION_OF[id]!]: 1 };
        s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, army))))));
      }
      expect(s.units.filter((u) => u.type.startsWith('champion')).length).toBe(2);
      let turns = 0;
      while (s.phase !== 'over' && turns < 400) {
        s = playAiTurn(s, rng);
        turns++;
      }
      expect(s.winner).not.toBeNull();
    }
  });
});
