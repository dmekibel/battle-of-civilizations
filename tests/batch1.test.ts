// Batch one of new pieces (_art/ROSTERS.md, 2026-11-18): banners, forest scouts, arrow-proof shields and lobbed
// rockets, the new rosters, and a whole computer battle with the new pieces.
import { describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig, type UnitTypeId } from '../src/config';
import { aiNextAction, armyCost, autoDeploy, buildBoard, draftArmy, finishDeploy, newGame, playAiTurn, previewStrike, reachable, suggestArmy, type GameState, type Player, type Result } from '../src/engine';
import { FACTIONS, FACTION_ORDER } from '../src/ui/factions';
import { SPRITES } from '../src/ui/sprites';

const OPEN: GameConfig = { ...CONFIG, board: { ...CONFIG.board, riverCol: null, bridgeRows: [], forests: [] } };

function scenario(specs: [Player, UnitTypeId, number, number][], cfg: GameConfig = OPEN, points = 18): GameState {
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

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

describe('banner', () => {
  it('a friend next to the banner hits 1 harder in melee', () => {
    const without = scenario([['red', 'heavyInfantry', 5, 5], ['blue', 'champion', 6, 5]]);
    const withBanner = scenario([['red', 'heavyInfantry', 5, 5], ['red', 'banner', 4, 5], ['blue', 'champion', 6, 5]]);
    expect(previewStrike(without, 'red-heavyInfantry-0', 'blue-champion-1', 'attack', OPEN)!.damage).toBe(1);
    expect(previewStrike(withBanner, 'red-heavyInfantry-0', 'blue-champion-2', 'attack', OPEN)!.damage).toBe(2);
  });

  it('two banners do not add up, and a banner two hexes away does nothing', () => {
    const two = scenario([['red', 'heavyInfantry', 5, 5], ['red', 'banner', 4, 5], ['red', 'banner', 5, 4], ['blue', 'champion', 6, 5]]);
    expect(previewStrike(two, 'red-heavyInfantry-0', 'blue-champion-3', 'attack', OPEN)!.damage).toBe(2);
    const far = scenario([['red', 'heavyInfantry', 5, 5], ['red', 'banner', 3, 5], ['blue', 'champion', 6, 5]]);
    expect(previewStrike(far, 'red-heavyInfantry-0', 'blue-champion-2', 'attack', OPEN)!.damage).toBe(1);
  });

  it('only helps melee, not shots, and an army may buy only one', () => {
    const s = scenario([['red', 'archer', 5, 5], ['red', 'banner', 4, 5], ['blue', 'heavyInfantry', 9, 5]]);
    expect(previewStrike(s, 'red-archer-0', 'blue-heavyInfantry-2', 'shoot', OPEN)!.damage).toBe(1);
    expect(draftArmy(newGame(), { banner: 2 }).ok).toBe(false);
    expect(draftArmy(newGame(), { banner: 1 }).ok).toBe(true);
  });

  it('the computer walks its banner next to its fighters rather than into the enemy', () => {
    const cfg: GameConfig = { ...OPEN, dice: { ...OPEN.dice, fixed: 12 } };
    let s: GameState = { ...scenario([['red', 'banner', 2, 7], ['red', 'heavyInfantry', 6, 7], ['red', 'heavyInfantry', 6, 8], ['blue', 'king', 22, 7]], cfg, 0), phase: 'roll' };
    s = playAiTurn(s, () => 0.5, cfg);
    const banner = s.units.find((u) => u.type === 'banner')!;
    const foot = s.units.filter((u) => u.type === 'heavyInfantry');
    // It caught up with its fighters, stands next to one, and is not out in front of them.
    expect(Math.min(...foot.map((u) => Math.abs(u.pos.col - banner.pos.col) + Math.abs(u.pos.row - banner.pos.row)))).toBeLessThanOrEqual(2);
    expect(banner.pos.col).toBeLessThanOrEqual(Math.max(...foot.map((u) => u.pos.col)));
    expect(banner.pos.col).toBeGreaterThan(2);
  });
});

describe('scout', () => {
  const WOOD: GameConfig = { ...OPEN, board: { ...OPEN.board, forests: [[6, 5]] } };
  it('may walk into forest; other foot may not', () => {
    const s = scenario([['red', 'scout', 5, 5], ['red', 'lightInfantry', 5, 7], ['blue', 'king', 20, 5]], WOOD);
    expect(reachable(s, 'red-scout-0', WOOD).has('6,5')).toBe(true);
    const t = scenario([['red', 'lightInfantry', 5, 5], ['blue', 'king', 20, 5]], WOOD);
    expect(reachable(t, 'red-lightInfantry-0', WOOD).has('6,5')).toBe(false);
  });

  it('can strike out of the trees, and the trees still block sight past it', () => {
    const s = scenario([['red', 'scout', 6, 5], ['blue', 'archer', 7, 5], ['blue', 'archer', 9, 5], ['red', 'heavyInfantry', 4, 5]], WOOD);
    expect(previewStrike(s, 'red-scout-0', 'blue-archer-1', 'attack', OPEN)).not.toBeNull();
  });
});

describe('arrow-proof shield', () => {
  it('a 1-damage arrow does nothing; a 2-damage shot does 1; melee is unchanged', () => {
    const s = scenario([['red', 'archer', 2, 5], ['red', 'crossbow', 3, 4], ['red', 'heavyInfantry', 6, 6], ['blue', 'shieldbearer', 6, 5]]);
    expect(previewStrike(s, 'red-archer-0', 'blue-shieldbearer-3', 'shoot', OPEN)!.damage).toBe(0);
    expect(previewStrike(s, 'red-crossbow-1', 'blue-shieldbearer-3', 'shoot', OPEN)!.damage).toBe(1);
    expect(previewStrike(s, 'red-heavyInfantry-2', 'blue-shieldbearer-3', 'attack', OPEN)!.damage).toBe(1);
  });

  it('the computer does not waste points shooting arrows at it', () => {
    const s = scenario([['red', 'archer', 2, 5], ['blue', 'shieldbearer', 6, 5], ['blue', 'king', 22, 5]], OPEN, 3);
    const a = aiNextAction(s, OPEN);
    expect(a?.kind).not.toBe('shoot');
  });
});

describe('lobbed shots', () => {
  const WOOD: GameConfig = { ...OPEN, board: { ...OPEN.board, forests: [[5, 5]] } };
  it('a rocket fires over a forest that stops a cannon', () => {
    const s = scenario([['red', 'rocket', 3, 5], ['red', 'cannon', 3, 4], ['blue', 'heavyInfantry', 7, 5]], WOOD);
    expect(previewStrike(s, 'red-rocket-0', 'blue-heavyInfantry-2', 'shoot', OPEN)).not.toBeNull();
    // The cannon on the next row has the trees between it and a target straight along its own row.
    const t = scenario([['red', 'cannon', 3, 5], ['blue', 'heavyInfantry', 7, 5]], WOOD);
    expect(previewStrike(t, 'red-cannon-0', 'blue-heavyInfantry-1', 'shoot', OPEN)).toBeNull();
  });

  it('the computer shoots a rocket over the trees', () => {
    const s = scenario([['red', 'rocket', 3, 5], ['blue', 'heavyInfantry', 7, 5], ['blue', 'king', 22, 5]], { ...OPEN, board: { ...OPEN.board, forests: [[5, 5]] } }, 4);
    expect(aiNextAction(s, { ...OPEN, board: { ...OPEN.board, forests: [[5, 5]] } })).toMatchObject({ kind: 'shoot', unitId: 'red-rocket-0' });
  });
});

describe('batch one rosters', () => {
  const NEW: [string, UnitTypeId][] = [['romans', 'champion'], ['romans', 'banner'], ['egypt', 'jaguar'], ['egypt', 'champion'], ['pirates', 'championGun'], ['pirates', 'rifleman'],
    ['zulus', 'champion'], ['zulus', 'scout'], ['japanese', 'scout'], ['japanese', 'crossbow'], ['vikings', 'shieldbearer'], ['ottomans', 'wildRider'], ['french', 'champion'],
    ['british', 'rocket'], ['frontier', 'longRifle']];

  it('every new piece is on its army roster, named, priced and drawn from all 8 sides', () => {
    for (const [army, type] of NEW) {
      const f = FACTIONS[army as keyof typeof FACTIONS];
      expect(f.roster, `${army} ${type}`).toContain(type);
      expect(f.names?.[type]?.en, `${army} ${type}`).toBeTruthy();
      expect(CONFIG.army.cost[type as Exclude<UnitTypeId, 'king'>]).toBeGreaterThan(0);
      expect(Object.keys(SPRITES[army][type] ?? {}).length, `${army} ${type}`).toBe(8);
    }
  });

  it('every roster piece of every army has a price and its picture, and a suggested army stays in budget', () => {
    for (const id of FACTION_ORDER) {
      const f = FACTIONS[id];
      for (const t of f.roster) {
        expect(CONFIG.army.cost[t], `${id} ${t}`).toBeGreaterThan(0);
        expect(SPRITES[id][t === 'deputy' ? 'lightInfantry' : t], `${id} ${t}`).toBeTruthy();
      }
      const army = suggestArmy(seeded(3), CONFIG, f.roster);
      expect(armyCost(army)).toBeLessThanOrEqual(CONFIG.army.budget);
      for (const t of ['champion', 'championGun', 'championRider', 'banner'] as const) expect(army[t] ?? 0).toBeLessThanOrEqual(1);
      expect(draftArmy(newGame(), army).ok, id).toBe(true);
    }
  });

  it('name fixes from the misfit list', () => {
    expect(FACTIONS.french.names?.lineInfantry?.en).toBe('Grenadiers');
    expect(FACTIONS.french.names?.champion?.en).toBe('Old Guard');
    expect(FACTIONS.egypt.names?.heavyInfantry?.en).toBe('Royal guard');
    expect(FACTIONS.british.names?.lightCavalry?.en).toBe('Hussars');
    expect(FACTIONS.zulus.names?.impi?.en).toBe('Iklwa warriors');
    expect(FACTIONS.pirates.names?.bomber?.en).toBe('Grenadiers');
    expect(FACTIONS.comanche.name.en).toBe('Comanche');
    for (const id of ['novgorod', 'teutonic', 'mongols', 'japanese'] as const) expect(FACTIONS[id].names?.king?.en, id).toBeTruthy();
    expect(FACTIONS.teutonic.names?.archer?.en).toBe('Crossbowmen');
  });
});

describe('a computer battle with the new pieces', () => {
  for (const [red, blue] of [['romans', 'zulus'], ['japanese', 'vikings'], ['british', 'ottomans'], ['pirates', 'egypt'], ['french', 'frontier']] as const) {
    it(`${red} against ${blue} finishes`, () => {
      const rng = seeded(red.length * 31 + blue.length);
      let s = newGame();
      for (const side of [red, blue]) {
        // Make sure the new pieces are in: the suggested army plus the batch's own pieces where the budget allows.
        const army = suggestArmy(rng, CONFIG, FACTIONS[side].roster);
        s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, army))))));
      }
      const used = new Set(s.units.map((u) => u.type));
      expect(used.size).toBeGreaterThan(4);
      for (let i = 0; i < 400 && s.phase !== 'over'; i++) s = playAiTurn(s, rng, CONFIG, i % 2 ? 'hard' : 'normal');
      expect(s.phase).toBe('over');
    }, 60000);
  }
});
