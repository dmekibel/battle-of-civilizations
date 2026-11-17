import { describe, expect, it } from 'vitest';
import { CONFIG, sideConfig, budgetOf, type GameConfig } from '../src/config';
import { autoDeploy, buildBoard, draftArmy, finishDeploy, kingOf, newGame, playAiTurn, previewStrike, reachable, suggestArmy, type GameState, type Result } from '../src/engine';
import { neighbors, key, type Hex } from '../src/engine/hex';
import { boardFor, enlargeBoard } from '../src/ui/settings';

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const withBoard = (board: GameConfig['board'], depth = 5): GameConfig => ({ ...CONFIG, board, deploy: { depth } });

/** Hexes a walker can reach from `from` over passable ground. */
function flood(s: GameState, cfg: GameConfig, from: Hex): Set<string> {
  const seen = new Set([key(from)]);
  const todo = [from];
  while (todo.length) {
    const h = todo.pop()!;
    for (const n of neighbors(h)) {
      if (n.col < 0 || n.row < 0 || n.col >= cfg.board.cols || n.row >= cfg.board.rows || seen.has(key(n))) continue;
      if (!cfg.terrain[s.board[n.row][n.col]].passable) continue;
      seen.add(key(n));
      todo.push(n);
    }
  }
  return seen;
}

function setUp(cfg: GameConfig, seed: number): GameState {
  const rng = seeded(seed);
  let s = newGame(cfg);
  for (const _ of [0, 1]) {
    const side = sideConfig(s.current, cfg);
    s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, suggestArmy(rng, side), side)), cfg))));
  }
  return s;
}

describe('castles and villages', () => {
  it('walls, towers and houses stop movement; a gateway lets pieces through and guards them', () => {
    const cfg = withBoard(boardFor('castles'));
    const board = buildBoard(cfg);
    expect(board[7][4]).toBe('gate');
    expect(board[5][4]).toBe('wall');
    expect(board[4][0]).toBe('tower');
    expect(board[7][20]).toBe('gate');
    const v = buildBoard(withBoard(boardFor('village')));
    expect(v[7][12]).toBe('house');
    // A rider inside the castle can only get out through the gate.
    const s: GameState = { ...newGame(cfg), phase: 'act', points: 18, units: [{ id: 'r', type: 'lightInfantry', owner: 'red', pos: { col: 2, row: 7 }, hp: 1, moved: false, attacked: false }] };
    const out = flood(s, cfg, { col: 2, row: 7 });
    expect(out.has('4,7')).toBe(true);
    expect(out.has('5,7')).toBe(true);
    const inside = flood({ ...s, board: s.board.map((r, i) => r.map((t, c) => (i === 7 && c === 4 ? 'wall' : t))) }, cfg, { col: 2, row: 7 });
    expect([...inside].every((k) => Number(k.split(',')[0]) <= 3)).toBe(true);
    expect(reachable(s, 'r', cfg).has('4,6')).toBe(false);
  });

  it('a piece in a gateway takes 1 less damage', () => {
    const cfg = withBoard(boardFor('castles'));
    const mk = (pos: Hex) => ({ ...newGame(cfg), phase: 'act' as const, points: 18, units: [
      { id: 'a', type: 'heavyCavalry' as const, owner: 'red' as const, pos: { col: 6, row: 7 }, hp: 2, moved: false, attacked: false },
      { id: 'b', type: 'heavyInfantry' as const, owner: 'blue' as const, pos, hp: 2, moved: false, attacked: false },
    ] });
    // Heavy horse hits for 2: on open ground the full 2, in Blue's gateway only 1.
    const g = mk({ col: 20, row: 7 });
    g.units[0].pos = { col: 19, row: 7 };
    expect(previewStrike(g, 'a', 'b', 'attack', cfg)?.damage).toBe(1);
    const o = mk({ col: 19, row: 8 });
    o.units[0].pos = { col: 18, row: 8 };
    expect(previewStrike(o, 'a', 'b', 'attack', cfg)?.damage).toBe(2);
  });

  for (const [map, large] of [['castles', false], ['castles', true], ['siege', false], ['village', false]] as const) {
    it(`${map}${large ? ' (large)' : ''}: autoDeploy places everything legally and the King starts inside his castle`, () => {
      const b = boardFor(map);
      const cfg = withBoard(large ? enlargeBoard(b) : b, large ? 7 : 5);
      const s = setUp(cfg, 11);
      for (const u of s.units) expect(cfg.terrain[s.board[u.pos.row][u.pos.col]].passable).toBe(true);
      expect(new Set(s.units.map((u) => key(u.pos))).size).toBe(s.units.length);
      if (map !== 'village') {
        const king = kingOf(s, 'blue')!;
        // Blue's King can't walk out except through a gateway: block the gates and he's shut in.
        const shut = { ...s, board: s.board.map((r) => r.map((t) => (t === 'gate' ? 'wall' : t))) };
        const reach = flood(shut, cfg, king.pos);
        expect(reach.size).toBeLessThan(40);
      }
    });
  }

  it('siege: Red gets 30% more army points', () => {
    const cfg = withBoard(boardFor('siege'));
    expect(budgetOf('red', cfg)).toBe(Math.round(cfg.army.budget * 1.3));
    expect(budgetOf('blue', cfg)).toBe(cfg.army.budget);
    expect(draftArmy(newGame(cfg), { heavyCavalry: 16 }, sideConfig('red', cfg)).ok).toBe(true);
  });

  for (const map of ['castles', 'siege', 'village'] as const) {
    it(`two computer players finish a whole game on ${map}`, () => {
      const cfg = withBoard(boardFor(map));
      const rng = seeded(7);
      let s = setUp(cfg, 7);
      let turns = 0;
      while (s.phase !== 'over' && turns < 600) {
        s = playAiTurn(s, rng, cfg);
        turns++;
      }
      expect(s.winner).not.toBeNull();
    });
  }
});
