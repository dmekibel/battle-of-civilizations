import { describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig } from '../src/config';
import { autoDeploy, draftArmy, finishDeploy, newGame, playAiTurn, quickStart, suggestArmy, type GameState, type Result } from '../src/engine';
import { buildReplay, canReplay } from '../src/ui/replay';

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

/** A whole computer-against-computer battle, from army building to the end. */
function aiBattle(seed: number, cfg: GameConfig = CONFIG): GameState {
  const rng = seeded(seed);
  let s = newGame(cfg);
  for (const _ of [0, 1]) s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, suggestArmy(rng, cfg), cfg)), cfg))));
  for (let turns = 0; s.phase !== 'over' && turns < 400; turns++) s = playAiTurn(s, rng, cfg);
  return s;
}

const RICH: GameConfig = {
  ...CONFIG,
  combat: { ...CONFIG.combat, advanceAfterKill: 'may' },
  options: { ...CONFIG.options, rerolls: 2, carryMax: 3, firstTurnBonus: 2, flanking: true, spears: true, kingsGuard: true, routAt: 0.5 },
};

describe('end-of-battle replay', () => {
  for (const [name, cfg, seed] of [['standard rules', CONFIG, 7], ['standard rules, another battle', CONFIG, 1234], ['rerolls, optional advance, morale', RICH, 99]] as const) {
    it(`replays an AI-vs-AI battle to the exact same end (${name})`, () => {
      const final = aiBattle(seed, cfg);
      expect(final.phase).toBe('over');
      expect(canReplay(final)).toBe(true);
      // Through the save, as the game stores it.
      const saved = JSON.parse(JSON.stringify(final)) as GameState;
      const rp = buildReplay(saved, cfg)!;
      expect(rp.complete).toBe(true);
      const end = rp.frames[rp.frames.length - 1].state;
      expect(end).toEqual(saved);
      // One frame per action, and a turn marker at every first roll.
      expect(rp.turns.length).toBe(final.log.filter((e) => e.kind === 'roll' && !e.reroll).length);
      expect(rp.frames[0].state.units.length).toBe(final.start!.units.length);
    });
  }

  it('works from a quick start too', () => {
    const rng = seeded(3);
    let s = quickStart();
    for (let turns = 0; s.phase !== 'over' && turns < 400; turns++) s = playAiTurn(s, rng);
    const rp = buildReplay(s)!;
    expect(rp.complete).toBe(true);
    expect(rp.frames[rp.frames.length - 1].state).toEqual(s);
  });

  it('keeps the opening position small and only once', () => {
    const final = aiBattle(7);
    expect(final.start!.logAt).toBe(0);
    expect('board' in final.start!).toBe(false);
    expect('log' in final.start!).toBe(false);
    expect(JSON.stringify(final.start).length).toBeLessThan(10000);
  });

  it('an old save without an opening position has no replay', () => {
    const final = aiBattle(7);
    const { start: _drop, ...old } = final;
    expect(canReplay(old as GameState)).toBe(false);
    expect(buildReplay(old as GameState)).toBeNull();
  });

  it('a battle loaded mid-way from an old save never records a wrong opening', () => {
    const rng = seeded(5);
    let s = quickStart();
    for (let i = 0; i < 4; i++) s = playAiTurn(s, rng);
    const { start: _drop, ...old } = s;
    const next = playAiTurn(old as GameState, rng);
    expect(next.start).toBeUndefined();
  });
});
