import { describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig, type UnitTypeId } from '../src/config';
import { aiNextAction, applyAi, autoDeploy, buildBoard, draftArmy, endTurn, finishDeploy, newGame, rollDice, suggestArmy, type Difficulty, type GameState, type Player, type Result } from '../src/engine';

// Computer difficulty: Easy / Normal / Hard. The win-rate tests play whole seeded battles computer
// against computer, each level on both sides equally, with the Recommended rules the game starts on.

const OPEN: GameConfig = { ...CONFIG, board: { ...CONFIG.board, riverCol: null, bridgeRows: [], forests: [] } };
const RECOMMENDED: GameConfig = {
  ...CONFIG,
  options: { ...CONFIG.options, firstTurnBonus: 2, carryMax: 3, rerolls: 1, kingsGuard: true, flanking: true, routAt: 0.5, shieldWall: true, spears: true, longShotFrom: 4, charge: true, toughness: 2 },
};

function scenario(specs: [Player, UnitTypeId, number, number][], points = 18, cfg = OPEN): GameState {
  return {
    ...newGame(cfg),
    board: buildBoard(cfg),
    units: specs.map(([owner, type, col, row], i) => ({ id: `${owner}-${type}-${i}`, type, owner, pos: { col, row }, hp: cfg.units[type].hp, moved: false, attacked: false })),
    phase: 'act',
    points,
  };
}

const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

/** One whole battle; returns the winner's level (null if it ran past the turn limit) and Hard's decision times. */
function battle(seed: number, red: Difficulty, blue: Difficulty, cfg: GameConfig, times: number[] = []) {
  const rng = seeded(seed);
  const level = { red, blue };
  let s = newGame(cfg);
  for (const _ of [0, 1]) s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, suggestArmy(rng, cfg), cfg)), cfg))));
  for (let turn = 0; turn < 300 && s.phase !== 'over'; turn++) {
    s = ok(rollDice(s, rng, cfg));
    for (let i = 0; i < 100 && s.phase === 'act'; i++) {
      const t0 = performance.now();
      const a = aiNextAction(s, cfg, level[s.current]);
      if (level[s.current] === 'hard') times.push(performance.now() - t0);
      if (!a) break;
      const r = applyAi(s, a, cfg, rng);
      if (!r.ok) break;
      s = r.state;
    }
    if (s.phase === 'act') s = ok(endTurn(s, cfg));
  }
  return s.winner ? level[s.winner] : null;
}

/** `games` battles of a against b, a playing Red in half of them (same armies both ways round). */
function match(a: Difficulty, b: Difficulty, games: number, cfg: GameConfig, times?: number[]) {
  let wins = 0;
  let unfinished = 0;
  for (let g = 0; g < games; g++) {
    const aRed = g % 2 === 0;
    const w = battle(5000 + Math.floor(g / 2), aRed ? a : b, aRed ? b : a, cfg, times);
    if (w === null) unfinished++;
    else if (w === a) wins++;
  }
  console.log(`${a} vs ${b}: ${a} won ${wins}/${games} (${Math.round((100 * wins) / games)}%), unfinished ${unfinished}`);
  return { wins, unfinished };
}

describe('computer difficulty', () => {
  for (const level of ['easy', 'hard'] as Difficulty[]) {
    it(`${level}: kills the King when it can`, () => {
      const s = scenario([['red', 'heavyCavalry', 3, 3], ['blue', 'king', 3, 4], ['blue', 'lightInfantry', 3, 2]]);
      expect(aiNextAction(s, OPEN, level)).toEqual({ kind: 'attack', unitId: 'red-heavyCavalry-0', targetId: 'blue-king-1' });
    });

    it(`${level}: ends its turn when it has nothing worth doing`, () => {
      const s = scenario([['red', 'king', 0, 0], ['blue', 'king', 20, 10]], 3);
      expect(aiNextAction(s, OPEN, level)).toBeNull();
    });

    it(`${level}: always gives the same answer for the same position`, () => {
      const s = scenario([['red', 'lightCavalry', 3, 5], ['red', 'archer', 2, 7], ['red', 'king', 0, 7], ['blue', 'heavyInfantry', 9, 5], ['blue', 'king', 14, 7]], 9);
      expect(aiNextAction(s, OPEN, level)).toEqual(aiNextAction(s, OPEN, level));
    });
  }

  it('normal is the original computer (default level)', () => {
    const s = scenario([['red', 'lightInfantry', 3, 3], ['blue', 'heavyInfantry', 3, 4], ['blue', 'archer', 2, 3]]);
    expect(aiNextAction(s, OPEN)).toEqual(aiNextAction(s, OPEN, 'normal'));
  });

  it('hard finishes the wounded piece instead of scratching a fresh one', () => {
    const s = scenario([['red', 'lightCavalry', 5, 5], ['blue', 'heavyInfantry', 5, 4], ['blue', 'heavyInfantry', 5, 6], ['blue', 'king', 20, 7]], 3);
    s.units[2] = { ...s.units[2], hp: 1 };
    expect(aiNextAction(s, OPEN, 'hard')).toMatchObject({ kind: 'attack', targetId: 'blue-heavyInfantry-2' });
  });

  it('hard steps next to an unguarded enemy King to capture him', () => {
    const s = scenario([['red', 'heavyInfantry', 5, 5], ['red', 'king', 0, 7], ['blue', 'king', 7, 5], ['blue', 'archer', 20, 1]], 2);
    const a = aiNextAction(s, OPEN, 'hard');
    expect(a?.kind).toBe('move');
    const after = ok(applyAi(s, a!, OPEN));
    expect(ok(endTurn(after, OPEN)).winReason).toBe('kingCaptured');
  });

  it('hard beats normal and normal beats easy in most battles; every battle finishes', () => {
    const times: number[] = [];
    const hn = match('hard', 'normal', 40, RECOMMENDED, times);
    const ne = match('normal', 'easy', 40, RECOMMENDED);
    expect(hn.unfinished + ne.unfinished).toBe(0);
    expect(hn.wins).toBeGreaterThanOrEqual(24); // 60%+
    expect(ne.wins).toBeGreaterThanOrEqual(24);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`hard decision time: avg ${avg.toFixed(1)} ms, max ${Math.max(...times).toFixed(0)} ms over ${times.length} decisions`);
  }, 600_000);

  it('hard decides quickly (well under 400 ms a move, leaving room for a slower phone)', () => {
    const times: number[] = [];
    battle(77, 'hard', 'hard', RECOMMENDED, times);
    battle(78, 'hard', 'easy', CONFIG, times);
    const sorted = [...times].sort((a, b) => a - b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    console.log(`hard decision time: median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)} ms, p99 ${p99.toFixed(0)} ms, max ${sorted[sorted.length - 1].toFixed(0)} ms`);
    expect(p99).toBeLessThan(100);
    expect(sorted[sorted.length - 1]).toBeLessThan(400);
  }, 120_000);
});
