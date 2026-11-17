import { describe, expect, it } from 'vitest';
import { buildBoard, playAiTurn, type GameState } from '../src/engine';
import { FACTIONS } from '../src/ui/factions';
import { SCENARIOS, buildScenario, checkHold, scenarioConfig, scenarioSettings, type Scenario } from '../src/ui/scenarios';

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

/** Computer against computer until someone wins (or a hard cap of turns). */
export function playOut(sc: Scenario, seed: number): GameState {
  const cfg = scenarioConfig(sc);
  const rng = seeded(seed);
  let s = buildScenario(sc, cfg);
  for (let i = 0; i < 400 && s.phase !== 'over'; i++) {
    s = checkHold(s, sc) ?? s;
    if (s.phase === 'over') break;
    s = playAiTurn(s, rng, cfg);
  }
  return s;
}

describe('campaign scenarios', () => {
  it('there are 8, with unique ids and both languages', () => {
    expect(SCENARIOS).toHaveLength(8);
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(8);
    for (const sc of SCENARIOS) for (const l of ['en', 'ru'] as const) {
      expect(sc.title[l].length).toBeGreaterThan(2);
      expect(sc.story[l].length).toBeGreaterThan(60);
    }
  });

  for (const sc of SCENARIOS) {
    it(`${sc.id}: a legal board with every piece placed legally`, () => {
      const cfg = scenarioConfig(sc);
      const board = buildBoard(cfg);
      expect(board).toHaveLength(cfg.board.rows);
      expect(board[0]).toHaveLength(cfg.board.cols);
      expect(sc.sides.red).not.toBe(sc.sides.blue);
      expect(scenarioSettings(sc).scenario).toBe(sc.id);
      const seen = new Set<string>();
      for (const side of ['red', 'blue'] as const) {
        const list = sc.units[side];
        expect(list.filter(([t]) => t === 'king')).toHaveLength(1);
        const roster = FACTIONS[sc.sides[side]].roster as string[];
        for (const [type, col, row] of list) {
          const where = `${side} ${type} at ${col},${row}`;
          expect(type === 'king' || roster.includes(type), `${where}: not in the ${sc.sides[side]} roster`).toBe(true);
          expect(col >= 0 && row >= 0 && col < cfg.board.cols && row < cfg.board.rows, `${where}: off the board`).toBe(true);
          const terrain = board[row][col];
          expect(cfg.terrain[terrain].passable, `${where}: stands on ${terrain}`).toBe(true);
          if (cfg.units[type].mounted) expect(cfg.terrain[terrain].noMounted, `${where}: rider in a swamp`).toBeFalsy();
          expect(seen.has(`${col},${row}`), `${where}: hex taken twice`).toBe(false);
          seen.add(`${col},${row}`);
        }
        for (const t of ['champion', 'championRider', 'championGun'] as const) expect(list.filter(([x]) => x === t).length).toBeLessThanOrEqual(1);
      }
      const s = buildScenario(sc, cfg);
      expect(s.phase).toBe('roll');
      expect(s.current).toBe('red');
      expect(s.units).toHaveLength(sc.units.red.length + sc.units.blue.length);
    });

    it(`${sc.id}: a computer-vs-computer battle finishes`, () => {
      for (const seed of [1, 7]) {
        const s = playOut(sc, seed);
        expect(s.phase).toBe('over');
        expect(s.winner).not.toBeNull();
      }
    });
  }

  it('a turn limit ends the battle for the holding side', () => {
    const sc = SCENARIOS.find((s) => s.hold)!;
    const s = { ...buildScenario(sc, scenarioConfig(sc)), turn: sc.hold!.turns + 1 };
    const done = checkHold(s, sc)!;
    expect(done.phase).toBe('over');
    expect(done.winner).toBe(sc.hold!.side);
    expect(done.winReason).toBe('held');
    expect(checkHold({ ...s, turn: sc.hold!.turns }, sc)).toBeNull();
  });
});
