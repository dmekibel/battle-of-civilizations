import { describe, expect, it } from 'vitest';
import { CONFIG, sideConfig, type GameConfig } from '../src/config';
import { autoDeploy, buildBoard, draftArmy, finishDeploy, newGame, playAiTurn, suggestArmy, type GameState, type Result } from '../src/engine';
import { key } from '../src/engine/hex';
import { BIOMES, BIOME_IDS, HOME, HOME_NAMES, biomeId, treeKinds } from '../src/ui/biomes';
import { FACTIONS, FACTION_ORDER, type FactionId } from '../src/ui/factions';
import { boardFor, enlargeBoard, type MapId } from '../src/ui/settings';
import ART from '../src/ui/biome-art.json';

function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}
const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const withBoard = (board: GameConfig['board'], depth = 5): GameConfig => ({ ...CONFIG, board, deploy: { depth } });

function setUp(cfg: GameConfig, seed: number, armies: Record<'red' | 'blue', FactionId>): GameState {
  const rng = seeded(seed);
  let s = newGame(cfg);
  for (const _ of [0, 1]) {
    const side = sideConfig(s.current, cfg);
    s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, suggestArmy(rng, side, FACTIONS[armies[s.current]].roster), side)), cfg))));
  }
  return s;
}

describe('biomes and home maps', () => {
  it('every army has a home map with a name in both languages and a known biome', () => {
    for (const f of FACTION_ORDER) {
      const id = HOME[f];
      expect(HOME_NAMES[id].en.length).toBeGreaterThan(2);
      expect(HOME_NAMES[id].ru.length).toBeGreaterThan(2);
      const b = boardFor(id as MapId);
      expect(BIOME_IDS).toContain(biomeId(b));
      expect(treeKinds(b).length).toBeGreaterThan(0);
    }
    // Every carved building a map or biome names has a picture.
    const known = new Set([...Object.keys(ART.scenery), 'house', 'house2', 'boulder', 'wall', 'tower', 'gate']);
    for (const bm of Object.values(BIOMES)) for (const n of [...bm.houses, bm.boulder]) expect(known.has(n)).toBe(true);
    for (const f of FACTION_ORDER) for (const n of Object.values(boardFor(HOME[f] as MapId).art ?? {})) expect(known.has(n)).toBe(true);
  });

  it('"Home ground" picks the first army\'s home map', () => {
    expect(boardFor('home', { home: 'egypt' }).biome).toBe('desert');
    expect(boardFor('home', { home: 'egypt' }).rivers?.[0].col).toBe(12);
    expect(boardFor('home', { home: 'novgorod' }).biome).toBe('snow');
  });

  it('a random map can grow in any biome', () => {
    expect(boardFor('random', { seed: 5, biome: 'jungle' }).biome).toBe('jungle');
    expect(boardFor('random', { seed: 5 }).biome).toBeUndefined();
  });

  for (const f of FACTION_ORDER) {
    const id = HOME[f] as MapId;
    it(`${id}: fair (mirrored), builds standard and large, pieces set up legally`, () => {
      const b = boardFor(id);
      const board = buildBoard(withBoard(b));
      // Mirrored left to right: Blue's half is Red's half turned over.
      for (let r = 0; r < b.rows; r++) for (let c = 0; c < b.cols; c++) expect(board[r][b.cols - 1 - c]).toBe(board[r][c]);
      const foe: FactionId = f === 'teutonic' ? 'novgorod' : 'teutonic';
      for (const large of [false, true]) {
        const cfg = withBoard(large ? enlargeBoard(b) : b, large ? 7 : 5);
        if (large) for (const k of Object.keys(b.art ?? {})) expect(Object.values(cfg.board.art ?? {})).toContain(b.art![k]);
        const s = setUp(cfg, 3, { red: f, blue: foe });
        expect(s.units.length).toBeGreaterThan(4);
        for (const u of s.units) expect(cfg.terrain[s.board[u.pos.row][u.pos.col]].passable).toBe(true);
        expect(new Set(s.units.map((u) => key(u.pos))).size).toBe(s.units.length);
      }
    });

    it(`${id}: two computer players finish a whole game`, () => {
      const foe: FactionId = f === 'teutonic' ? 'novgorod' : 'teutonic';
      const cfg = withBoard(boardFor(id));
      const rng = seeded(9);
      let s = setUp(cfg, 9, { red: f, blue: foe });
      let turns = 0;
      while (s.phase !== 'over' && turns < 600) {
        s = playAiTurn(s, rng, cfg);
        turns++;
      }
      expect(s.winner).not.toBeNull();
    });
  }
});
