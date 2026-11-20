import { describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig, type UnitTypeId } from '../src/config';
import {
  aiNextAction, apply, autoDeploy, buildBoard, canMarch, deployBand, draftArmy, endTurn, finishDeploy, inZone, march, MARCH_RANGE,
  moveUnit, newGame, noContact, playAiTurn, previewStrike, shoot, attack, startSession, suggestArmy, undo, zoneHexes, distance,
  type GameState, type Player, type Result,
} from '../src/engine';
import { buildReplay } from '../src/ui/replay';
import { boardFor, RECOMMENDED, type MapId } from '../src/ui/settings';

// Owner requests 2026-11-18: trees protect from arrows, pieces face what they strike, and a faster opening
// (March button, closer battle lines, the computer marching).

const ok = (r: Result) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/** An open board (no river, no woods) with forests where asked. */
function field(forests: [number, number][] = [], options: Partial<GameConfig['options']> = {}): GameConfig {
  return { ...CONFIG, board: { ...CONFIG.board, riverCol: null, bridgeRows: [], forests }, options: { ...CONFIG.options, ...options } };
}
function battle(cfg: GameConfig, specs: [Player, UnitTypeId, number, number][], points = 18, current: Player = 'red'): GameState {
  return {
    ...newGame(cfg),
    board: buildBoard(cfg),
    units: specs.map(([owner, type, col, row], i) => ({ id: `${owner}-${type}-${i}`, type, owner, pos: { col, row }, hp: cfg.units[type].hp, moved: false, attacked: false })),
    phase: 'act',
    current,
    points,
  };
}

describe('forest cover', () => {
  it('cover from a wood beside the target, nearer the shooter', () => {
    // The archer shoots down-right at (8,7); the wood at (8,6) touches the target on the archer's side, off the sight line.
    const cfg = field([[8, 6]], { forestCover: true, toughness: 2 });
    const s = battle(cfg, [['red', 'archer', 5, 4], ['blue', 'heavyInfantry', 8, 7], ['red', 'king', 0, 0], ['blue', 'king', 24, 0]]);
    const on = previewStrike(s, 'red-archer-0', 'blue-heavyInfantry-1', 'shoot', cfg)!;
    const off = previewStrike(s, 'red-archer-0', 'blue-heavyInfantry-1', 'shoot', { ...cfg, options: { ...cfg.options, forestCover: false } })!;
    expect(on).not.toBeNull();
    expect(on.covered).toBe(true);
    expect(off.covered).toBe(false);
    expect(on.damage).toBe(off.damage - 1);
    const after = ok(shoot(s, 'red-archer-0', 'blue-heavyInfantry-1', cfg));
    const e = after.log[after.log.length - 1];
    expect(e.kind === 'shoot' && e.covered).toBe(true);
  });

  it('trees behind the target give no cover, and melee ignores the rule', () => {
    const cfg = field([[9, 7]], { forestCover: true });
    const s = battle(cfg, [['red', 'archer', 4, 7], ['blue', 'lightInfantry', 8, 7], ['red', 'heavyInfantry', 7, 7], ['red', 'king', 0, 0], ['blue', 'king', 24, 0]]);
    expect(previewStrike(s, 'red-archer-0', 'blue-lightInfantry-1', 'shoot', cfg)!.covered).toBe(false);
    expect(previewStrike(s, 'red-heavyInfantry-2', 'blue-lightInfantry-1', 'attack', cfg)!.covered).toBe(false);
  });

  it('a one-damage shot into cover is wasted (0), and the computer does not take it', () => {
    const cfg = field([[8, 6]], { forestCover: true });
    const s = battle(cfg, [['red', 'archer', 5, 4], ['blue', 'lightInfantry', 8, 7], ['red', 'king', 0, 14], ['blue', 'king', 24, 14]], 3);
    const p = previewStrike(s, 'red-archer-0', 'blue-lightInfantry-1', 'shoot', cfg)!;
    expect(p.damage).toBe(0);
    expect(p.kills).toBe(false);
    const a = aiNextAction(s, cfg, 'normal');
    expect(a?.kind === 'shoot' && a.targetId === 'blue-lightInfantry-1').toBe(false);
    expect(aiNextAction(s, cfg, 'easy')?.kind === 'shoot').toBe(false);
  });
});

describe('facing', () => {
  const cfg = field();
  it('a striking piece faces its target until it moves again; walking faces forward', () => {
    let s = battle(cfg, [['red', 'archer', 10, 7], ['red', 'heavyInfantry', 12, 7], ['blue', 'lightInfantry', 7, 7], ['blue', 'lightInfantry', 13, 7], ['red', 'king', 0, 0], ['blue', 'king', 24, 0]], 30);
    // Shoot backwards (west) at (7,7).
    s = ok(shoot(s, 'red-archer-0', 'blue-lightInfantry-2', cfg));
    expect(s.units.find((u) => u.id === 'red-archer-0')!.face).toEqual([{ col: 10, row: 7 }, { col: 7, row: 7 }]);
    // Melee east.
    s = ok(attack(s, 'red-heavyInfantry-1', 'blue-lightInfantry-3', cfg));
    const hi = s.units.find((u) => u.id === 'red-heavyInfantry-1')!;
    // The kill moved it into the hex; it still faces the way it struck.
    expect(hi.face).toEqual([{ col: 12, row: 7 }, { col: 13, row: 7 }]);
    // Kept through the end of the turn.
    s = ok(endTurn(s, cfg));
    expect(s.units.find((u) => u.id === 'red-archer-0')!.face).toEqual([{ col: 10, row: 7 }, { col: 7, row: 7 }]);
    // Moving turns it forward again (no stored facing: its side's usual way).
    s = { ...s, current: 'red', phase: 'act', points: 10 };
    s = ok(moveUnit(s, 'red-archer-0', { col: 10, row: 8 }, cfg));
    expect(s.units.find((u) => u.id === 'red-archer-0')!.face).toBeUndefined();
  });

  it('faces survive a save and the replay shows them', () => {
    const rng = seeded(31);
    let s = newGame(CONFIG);
    for (const _ of [0, 1]) s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, suggestArmy(rng, CONFIG), CONFIG)), CONFIG))));
    for (let i = 0; i < 400 && s.phase !== 'over'; i++) s = playAiTurn(s, rng, CONFIG);
    expect(s.phase).toBe('over');
    expect(s.units.some((u) => u.face)).toBe(true);
    const saved = JSON.parse(JSON.stringify(s)) as GameState;
    const rp = buildReplay(saved, CONFIG)!;
    expect(rp.complete).toBe(true);
    expect(rp.frames[rp.frames.length - 1].state.units).toEqual(saved.units);
  });
});

describe('march', () => {
  const cfg = field();
  const army: [Player, UnitTypeId, number, number][] = [
    ['red', 'king', 0, 7], ['red', 'heavyInfantry', 3, 6], ['red', 'heavyInfantry', 3, 7], ['red', 'heavyInfantry', 3, 8], ['red', 'archer', 2, 7], ['red', 'lightCavalry', 3, 2],
    ['blue', 'king', 24, 7], ['blue', 'heavyInfantry', 21, 7],
  ];

  it('steps the army forward along its rows, spending points, and never within reach of the enemy', () => {
    const s = battle(cfg, army, 12);
    expect(canMarch(s, cfg)).toBe(true);
    const m = ok(march(s, cfg));
    expect(m.points).toBeLessThan(12);
    for (const u of m.units.filter((x) => x.owner === 'red')) {
      const before = s.units.find((x) => x.id === u.id)!;
      expect(u.pos.col).toBeGreaterThanOrEqual(before.pos.col);
      expect(u.pos.row).toBe(before.pos.row); // open ground: each stays in its lane
      for (const e of m.units.filter((x) => x.owner === 'blue')) expect(distance(u.pos, e.pos)).toBeGreaterThan(MARCH_RANGE);
    }
    // Order kept: the archer is still behind the middle heavy infantryman, the King still at the back.
    const at = (id: string) => m.units.find((u) => u.id === id)!.pos.col;
    expect(at('red-archer-4')).toBeLessThan(at('red-heavyInfantry-2'));
    expect(at('red-king-0')).toBeLessThan(at('red-archer-4'));
    // Every move is in the log, so replays and online play see it.
    expect(m.log.filter((e) => e.kind === 'move').length).toBeGreaterThan(5);
  });

  it('is one undo step', () => {
    const s = battle(cfg, army, 12);
    const { sess } = apply(startSession(s), (x) => march(x, cfg));
    expect(sess.state).not.toBe(s);
    expect(undo(sess).state).toBe(s);
  });

  it('is not offered once an enemy is within reach', () => {
    const s = battle(cfg, [...army.slice(0, 6), ['blue', 'king', 24, 7], ['blue', 'heavyInfantry', 9, 7]], 12);
    expect(canMarch(s, cfg)).toBe(false);
    expect(march(s, cfg).ok).toBe(false);
    expect(noContact(s)).toBe(false);
  });

  it('the computer marches while the armies are far apart (close battle lines only)', () => {
    const close: GameConfig = { ...cfg, options: { ...cfg.options, battleLines: 'close' } };
    const s = battle(close, army, 12);
    expect(aiNextAction(s, close, 'normal')).toEqual({ kind: 'march' });
    expect(aiNextAction(s, close, 'hard')).toEqual({ kind: 'march' });
    // On normal lines it keeps its own greedy advance.
    expect(aiNextAction(battle(cfg, army, 12), cfg, 'normal')?.kind).toBe('move');
  });
});

describe('battle lines', () => {
  const MAPS: MapId[] = ['river', 'fords', 'noford', 'island', 'pass', 'longwood', 'lake', 'ridge', 'open', 'forest', 'village', 'castles', 'siege', 'marsh', 'waterloo', 'isandlwana'];
  const cfgFor = (map: MapId, battleLines: 'close' | 'normal' | 'far', large = false): GameConfig => ({ ...CONFIG, board: boardFor(map), options: { ...RECOMMENDED, battleLines }, deploy: { depth: large ? 7 : 5 } });

  it('normal is the classic zone; close moves it towards the middle; far keeps only the back rows', () => {
    const c = cfgFor('open', 'close');
    expect(deployBand('red', cfgFor('open', 'normal'))).toEqual({ near: 0, depth: 5 });
    expect(deployBand('red', c).near).toBeGreaterThan(0);
    expect(inZone('red', { col: 0, row: 7 }, c)).toBe(false);
    expect(inZone('blue', { col: 24, row: 7 }, c)).toBe(false);
    expect(deployBand('red', cfgFor('open', 'far'))).toEqual({ near: 0, depth: 3 });
  });

  for (const map of MAPS)
    it(`${map}: close lines leave legal room for both armies, apart, and the computer sets up`, () => {
      const cfg = cfgFor(map, 'close');
      const s0 = newGame(cfg);
      const red = zoneHexes(s0, 'red', cfg);
      const blue = zoneHexes(s0, 'blue', cfg);
      expect(red.length).toBeGreaterThanOrEqual(40);
      expect(blue.length).toBeGreaterThanOrEqual(40);
      // The zones never touch: at least 7 columns between them.
      const maxRed = Math.max(...red.map((h) => h.col));
      const minBlue = Math.min(...blue.map((h) => h.col));
      expect(minBlue - maxRed).toBeGreaterThanOrEqual(7);
      // Never pushed onto a river or into a castle.
      for (const h of [...red, ...blue]) expect(['river', 'wall', 'tower']).not.toContain(s0.board[h.row][h.col]);
      const rng = seeded(7);
      let s = s0;
      for (const _ of [0, 1]) s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, suggestArmy(rng, { ...cfg, army: { ...cfg.army, budget: 80 } }), { ...cfg, army: { ...cfg.army, budget: 80 } })), cfg))));
      expect(s.phase).toBe('roll');
      for (const u of s.units) expect(inZone(u.owner, u.pos, cfg)).toBe(true);
    });

  it('a castle side keeps its zone in the castle (siege)', () => {
    const cfg = cfgFor('siege', 'close');
    expect(deployBand('blue', cfg).near).toBe(0);
  });

  it('far lines still fit a big army; the large board moves its zones too', () => {
    const cfg = cfgFor('river', 'far');
    expect(zoneHexes(newGame(cfg), 'red', cfg).length).toBeGreaterThanOrEqual(40);
    const big: GameConfig = { ...CONFIG, board: { ...CONFIG.board, cols: 33, rows: 19, riverCol: null, bridgeRows: [], forests: [] }, options: { ...RECOMMENDED }, deploy: { depth: 7 } };
    expect(deployBand('red', big).near).toBeGreaterThan(0);
  });

  it('computer battles on close lines finish, with contact sooner than on normal lines', () => {
    const contact = (lines: 'close' | 'normal') => {
      let sum = 0;
      for (const map of ['river', 'open', 'forest'] as MapId[]) {
        // Walking one point at a time, so the distance between the lines shows (moving freely, both meet on turn 1).
        const cfg = { ...cfgFor(map, lines), options: { ...cfgFor(map, lines).options, stepMoves: true } };
        for (let g = 0; g < 3; g++) {
          const rng = seeded(500 + g);
          let s = newGame(cfg);
          for (const _ of [0, 1]) s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, suggestArmy(rng, cfg), cfg)), cfg))));
          for (let i = 0; i < 400 && s.phase !== 'over'; i++) s = playAiTurn(s, rng, cfg);
          expect(s.phase).toBe('over');
          sum += s.log.find((e) => e.kind === 'attack' || e.kind === 'shoot')!.turn;
        }
      }
      return sum / 9;
    };
    expect(contact('close')).toBeLessThan(contact('normal'));
  }, 120000);
});
