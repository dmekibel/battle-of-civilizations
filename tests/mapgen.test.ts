import { describe, expect, it } from 'vitest';
import { CONFIG, sideConfig, type GameConfig } from '../src/config';
import { autoDeploy, buildBoard, draftArmy, finishDeploy, newGame, playAiTurn, suggestArmy, type GameState, type Result } from '../src/engine';
import { key, neighbors, type Hex } from '../src/engine/hex';
import { deployDepth, generateMap, MAP_STYLES, type BoardSize } from '../src/engine/mapgen';
import { applySettings, boardFor, DEFAULT_SETTINGS } from '../src/ui/settings';

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const cfgFor = (board: GameConfig['board'], size: BoardSize = 'standard'): GameConfig => ({ ...CONFIG, board, deploy: { depth: deployDepth(size) } });

function setUp(cfg: GameConfig, seed: number): GameState {
  const rng = seeded(seed);
  let s = newGame(cfg);
  for (const _ of [0, 1]) {
    const side = sideConfig(s.current, cfg);
    s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, suggestArmy(rng, side), side)), cfg))));
  }
  return s;
}

/** Hexes reachable on foot from `from`. */
function flood(board: string[][], cfg: GameConfig, from: Hex): Set<string> {
  const seen = new Set([key(from)]);
  const todo = [from];
  while (todo.length) {
    const h = todo.pop()!;
    for (const n of neighbors(h)) {
      if (n.col < 0 || n.row < 0 || n.col >= cfg.board.cols || n.row >= cfg.board.rows || seen.has(key(n))) continue;
      if (!cfg.terrain[board[n.row][n.col] as keyof GameConfig['terrain']].passable) continue;
      seen.add(key(n));
      todo.push(n);
    }
  }
  return seen;
}

describe('random map generator', () => {
  it('the same seed and style always grow the same map; another seed grows another', () => {
    for (const style of MAP_STYLES) {
      expect(generateMap(1234, style)).toEqual(generateMap(1234, style));
      expect(generateMap(77, style, 'large')).toEqual(generateMap(77, style, 'large'));
      expect(generateMap(1234, style)).not.toEqual(generateMap(1235, style));
    }
  });

  it('is fair: every map is its own mirror image left to right', () => {
    for (const style of MAP_STYLES)
      for (let seed = 1; seed <= 20; seed++)
        for (const size of ['standard', 'large'] as const) {
          const b = generateMap(seed, style, size);
          const board = buildBoard(cfgFor(b, size));
          for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) expect(board[r][c]).toBe(board[r][b.cols - 1 - c]);
          const stones = new Set((b.boulders ?? []).map(([c, r]) => `${c},${r}`));
          for (const [c, r] of b.boulders ?? []) expect(stones.has(`${b.cols - 1 - c},${r}`)).toBe(true);
        }
  });

  for (const style of MAP_STYLES)
    for (const size of ['standard', 'large'] as const)
      it(`${style} (${size}): 50 seeds, clear deploy zones that all reach the enemy, only terrain that draws well`, () => {
        for (let seed = 1; seed <= 50; seed++) {
          const b = generateMap(seed * 7919, style, size);
          const cfg = cfgFor(b, size);
          const board = buildBoard(cfg);
          const depth = deployDepth(size);
          expect(b.hills ?? []).toHaveLength(0);
          expect(b.swamps ?? []).toHaveLength(0);
          expect(b.overlay).toBeUndefined();
          // Deploy zones are open ground, and every hex of Red's zone can walk to every hex of Blue's.
          const reach = flood(board, cfg, { col: 0, row: 0 });
          for (let r = 0; r < b.rows; r++)
            for (let c = 0; c < b.cols; c++) {
              if (c >= depth && c < b.cols - depth) continue;
              expect(board[r][c]).toBe('plain');
              expect(reach.has(`${c},${r}`)).toBe(true);
            }
          // No open ground is cut off from the armies.
          for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) if (cfg.terrain[board[r][c]].passable) expect(reach.has(`${c},${r}`)).toBe(true);
          // Rivers run straight down a column (the drawn river), with at least two crossings, spread out, one a bridge.
          for (const rv of b.rivers ?? []) {
            const rows = [...rv.bridges, ...rv.fords].sort((x, y) => x - y);
            expect(rows.length).toBeGreaterThanOrEqual(2);
            expect(rv.bridges.length).toBeGreaterThanOrEqual(1);
            for (let i = 1; i < rows.length; i++) expect(rows[i] - rows[i - 1]).toBeGreaterThanOrEqual(3);
            for (let r = 0; r < b.rows; r++) expect(['river', 'bridge', 'ford']).toContain(board[r][rv.col]);
          }
          // Lakes keep off the board's edge rows and the deploy zones.
          for (const [c, r] of b.lakes ?? []) {
            expect(r).toBeGreaterThan(0);
            expect(r).toBeLessThan(b.rows - 1);
            expect(c).toBeGreaterThanOrEqual(depth);
          }
        }
      });

  it('each style looks like itself', () => {
    const avg = (style: (typeof MAP_STYLES)[number], f: (b: GameConfig['board']) => number) => {
      let sum = 0;
      for (let seed = 1; seed <= 30; seed++) sum += f(generateMap(seed, style));
      return sum / 30;
    };
    expect(avg('forest', (b) => b.forests.length)).toBeGreaterThan(avg('valley', (b) => b.forests.length) * 2.5);
    expect(avg('plains', (b) => b.forests.length)).toBeLessThan(avg('valley', (b) => b.forests.length));
    expect(avg('lakes', (b) => b.lakes!.length)).toBeGreaterThan(12);
    expect(avg('hamlets', (b) => b.houses!.length)).toBeGreaterThan(4);
    expect(avg('valley', (b) => b.rivers!.length)).toBeGreaterThanOrEqual(1);
    expect(avg('plains', (b) => (b.boulders ?? []).length)).toBeGreaterThan(avg('forest', (b) => (b.boulders ?? []).length));
  });

  for (const style of MAP_STYLES)
    for (const size of ['standard', 'large'] as const)
      it(`${style} (${size}): auto-setup places every piece legally`, () => {
        for (const seed of [3, 11, 29]) {
          const cfg = cfgFor(generateMap(seed, style, size), size);
          const s = setUp(cfg, seed);
          expect(s.units.filter((u) => u.type === 'king')).toHaveLength(2);
          for (const u of s.units) {
            expect(cfg.terrain[s.board[u.pos.row][u.pos.col]].passable).toBe(true);
            const zone = u.owner === 'red' ? u.pos.col < cfg.deploy.depth : u.pos.col >= cfg.board.cols - cfg.deploy.depth;
            expect(zone).toBe(true);
          }
          expect(new Set(s.units.map((u) => key(u.pos))).size).toBe(s.units.length);
        }
      });

  for (const style of MAP_STYLES)
    it(`two computer players finish a whole game on ${style}`, () => {
      const cfg = cfgFor(generateMap(5, style));
      const rng = seeded(7);
      let s = setUp(cfg, 7);
      let turns = 0;
      while (s.phase !== 'over' && turns < 600) {
        s = playAiTurn(s, rng, cfg);
        turns++;
      }
      expect(s.winner).not.toBeNull();
    });

  it('settings rebuild the same random map (saved and online games), at either board size', () => {
    // applySettings also recolours the page for the chosen armies: give it a stand-in page.
    const g = globalThis as unknown as { document?: unknown };
    g.document ??= { documentElement: { style: { setProperty() {} } } };
    const saved = structuredClone(CONFIG.board);
    const st = { ...structuredClone(DEFAULT_SETTINGS), map: 'random' as const, mapSeed: 4242, mapStyle: 'hamlets' as const };
    applySettings(st);
    const first = structuredClone(CONFIG.board);
    applySettings(structuredClone(st));
    expect(CONFIG.board).toEqual(first);
    expect(first).toEqual(boardFor('random', { seed: 4242, style: 'hamlets' }));
    applySettings({ ...st, size: 'large' });
    expect([CONFIG.board.cols, CONFIG.board.rows]).toEqual([33, 19]);
    expect(CONFIG.board).toEqual(generateMap(4242, 'hamlets', 'large'));
    // A random map chosen without a seed gets one, kept in the settings.
    const fresh = { ...structuredClone(DEFAULT_SETTINGS), map: 'random' as const };
    applySettings(fresh);
    expect(typeof fresh.mapSeed).toBe('number');
    expect(fresh.mapStyle).toBe('valley');
    CONFIG.board = saved;
    applySettings(DEFAULT_SETTINGS);
  });
});
