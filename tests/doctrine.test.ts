// Auto armies follow each army's doctrine (src/ui/factions.ts DOCTRINE), on the same budget, and stay a mix.
import { describe, expect, it } from 'vitest';
import { CONFIG, type UnitTypeId } from '../src/config';
import { armyCost, autoDeploy, draftArmy, finishDeploy, newGame, playAiTurn, suggestArmy, type ArmyCounts, type GameState, type Result } from '../src/engine';
import { FACTIONS, FACTION_ORDER, type FactionId } from '../src/ui/factions';

const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
const pts = (a: ArmyCounts, f: (t: UnitTypeId) => boolean) =>
  Object.entries(a).reduce((s, [t, n]) => s + (f(t as UnitTypeId) ? CONFIG.army.cost[t as keyof ArmyCounts] * (n ?? 0) : 0), 0);
const rider = (t: UnitTypeId) => !!CONFIG.units[t].mounted;

describe('auto armies follow doctrine', () => {
  it('every army: legal, within budget, at least 3 kinds, a shooter and a spearman where the roster has them', () => {
    for (const id of FACTION_ORDER) {
      const roster = FACTIONS[id].roster;
      for (let seed = 1; seed <= 20; seed++) {
        const a = suggestArmy(seeded(seed), CONFIG, roster);
        expect(armyCost(a), id).toBeLessThanOrEqual(CONFIG.army.budget);
        expect(armyCost(a), id).toBeGreaterThanOrEqual(CONFIG.army.budget - 2);
        expect(draftArmy(newGame(), a).ok, id).toBe(true);
        expect(Object.values(a).filter((n) => n! > 0).length, id).toBeGreaterThanOrEqual(3);
        if (roster.some((t) => CONFIG.units[t].ranged)) expect(pts(a, (t) => !!CONFIG.units[t].ranged), `${id} shooters`).toBeGreaterThan(0);
        if (roster.some((t) => CONFIG.units[t].antiCavalry)) expect(pts(a, (t) => !!CONFIG.units[t].antiCavalry), `${id} spears`).toBeGreaterThan(0);
      }
    }
  });

  it('matches each doctrine\'s shape (averaged over 30 armies)', () => {
    const share = (id: FactionId, f: (t: UnitTypeId) => boolean) => {
      let s = 0;
      for (let seed = 1; seed <= 30; seed++) s += pts(suggestArmy(seeded(seed), CONFIG, FACTIONS[id].roster), f) / CONFIG.army.budget;
      return s / 30;
    };
    expect(share('mongols', rider)).toBeGreaterThan(0.75);
    expect(share('comanche', rider)).toBeGreaterThan(0.65);
    expect(share('vikings', rider)).toBe(0);
    expect(share('romans', (t) => t === 'heavyInfantry')).toBeGreaterThan(0.3);
    expect(share('british', (t) => t === 'lineInfantry')).toBeGreaterThan(0.35);
    expect(share('zulus', (t) => t === 'impi')).toBeGreaterThan(0.25);
    expect(share('japanese', (t) => t === 'ashigaru' || t === 'samurai')).toBeGreaterThan(0.45);
    expect(share('teutonic', (t) => t === 'heavyCavalry')).toBeGreaterThan(0.25);
    expect(share('pirates', (t) => t === 'boarder')).toBeGreaterThan(0.25);
    expect(share('egypt', (t) => t === 'chariot' || t === 'archer')).toBeGreaterThan(0.4);
  });
});

describe('doctrine armies stay fair', () => {
  const PAIRS: [FactionId, FactionId][] = [['mongols', 'teutonic'], ['romans', 'vikings'], ['british', 'french'], ['zulus', 'british'], ['japanese', 'aztecs'], ['comanche', 'frontier']];
  it('computer-vs-computer battles all finish; win rates are reported', () => {
    const lines: string[] = [];
    for (const [a, b] of PAIRS) {
      let wa = 0;
      const N = 12;
      for (let g = 0; g < N; g++) {
        const rng = seeded(1000 + g * 7 + a.length);
        // Each army plays red half the time, so moving first doesn't decide it.
        const [red, blue] = g % 2 ? [b, a] : [a, b];
        let s: GameState = newGame();
        for (const side of [red, blue]) s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, suggestArmy(rng, CONFIG, FACTIONS[side].roster)))))));
        for (let i = 0; i < 400 && s.phase !== 'over'; i++) s = playAiTurn(s, rng, CONFIG, 'normal');
        expect(s.phase).toBe('over');
        if ((s.winner === 'red' ? red : blue) === a) wa++;
      }
      lines.push(`${a} vs ${b}: ${a} won ${wa}/${N}`);
    }
    console.log(lines.join('\n'));
  }, 120000);
});
