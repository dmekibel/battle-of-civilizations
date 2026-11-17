import { describe, expect, it } from 'vitest';
import { CONFIG, type GameConfig, type UnitTypeId } from '../src/config';
import {
  apply,
  attack,
  buildBoard,
  canUndo,
  distance,
  endTurn,
  getUnit,
  hasLineOfSight,
  key,
  moveUnit,
  neighbors,
  newGame,
  quickStart,
  previewStrike,
  reachable,
  rollDice,
  shoot,
  startSession,
  takeHex,
  strikeTargets,
  undo,
  type GameState,
  type Player,
} from '../src/engine';

/** Same rules, but an empty field: no river, no forest. */
// Movement tests move pieces several hexes in one go, so the one-step-at-a-time rule is off here (tested in options.test.ts).
const WHOLE: GameConfig = { ...CONFIG, options: { ...CONFIG.options, stepMoves: false } };
const OPEN: GameConfig = { ...WHOLE, board: { ...CONFIG.board, riverCol: null, bridgeRows: [], forests: [] } };

type Spec = [Player, UnitTypeId, number, number];

function scenario(specs: Spec[], points = 18, cfg: GameConfig = OPEN): GameState {
  return {
    ...newGame(cfg),
    board: buildBoard(cfg),
    units: specs.map(([owner, type, col, row], i) => ({
      id: `${owner}-${type}-${i}`,
      type,
      owner,
      pos: { col, row },
      hp: cfg.units[type].hp,
      moved: false,
      attacked: false,
    })),
    phase: 'act',
    dice: [6, 6, 6],
    points,
  };
}

const ok = (r: ReturnType<typeof moveUnit>) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.state;
};

/** Rng that yields the given die faces in order. */
const dice = (...faces: number[]) => {
  let i = 0;
  return () => (faces[i++ % faces.length] - 1) / 6 + 0.01;
};

describe('hex geometry', () => {
  it('neighbours are at distance 1 and symmetric', () => {
    for (const h of [{ col: 4, row: 4 }, { col: 5, row: 4 }, { col: 0, row: 0 }]) {
      for (const n of neighbors(h)) {
        expect(distance(h, n)).toBe(1);
        expect(neighbors(n).some((m) => m.col === h.col && m.row === h.row)).toBe(true);
      }
    }
  });

  it('straight distance along a column', () => {
    expect(distance({ col: 3, row: 1 }, { col: 3, row: 6 })).toBe(5);
  });
});

describe('setup', () => {
  const s = quickStart();

  it('builds the board with a river and two bridges', () => {
    const { rows, cols, riverCol } = CONFIG.board;
    expect(s.board.length).toBe(rows);
    expect(s.board[0].length).toBe(cols);
    expect(rows * cols).toBeGreaterThanOrEqual(2 * 17 * 11);
    const col = s.board.map((row) => row[riverCol!]);
    expect(col.filter((t) => t === 'bridge').length).toBe(2);
    expect(col.filter((t) => t === 'river').length).toBe(rows - 2);
  });

  it('gives each side 1 King, 4 HI, 4 LI, 2 HC, 2 LC, 2 archers', () => {
    for (const p of ['red', 'blue'] as Player[]) {
      const count = (t: UnitTypeId) => s.units.filter((u) => u.owner === p && u.type === t).length;
      expect([count('king'), count('heavyInfantry'), count('lightInfantry'), count('heavyCavalry'), count('lightCavalry'), count('archer')]).toEqual([1, 4, 4, 2, 2, 2]);
    }
  });

  it('mirrors blue onto the other side and puts no unit on blocked terrain', () => {
    const redKing = s.units.find((u) => u.owner === 'red' && u.type === 'king')!;
    const blueKing = s.units.find((u) => u.owner === 'blue' && u.type === 'king')!;
    expect(blueKing.pos).toEqual({ col: CONFIG.board.cols - 1 - redKing.pos.col, row: redKing.pos.row });
    for (const u of s.units) expect(s.board[u.pos.row][u.pos.col]).toBe('plain');
    expect(new Set(s.units.map((u) => key(u.pos))).size).toBe(s.units.length);
  });

  it('starts with red to roll', () => {
    expect(s.current).toBe('red');
    expect(s.phase).toBe('roll');
  });
});

describe('dice', () => {
  it('sums 3 dice into movement points', () => {
    const r = rollDice(quickStart(), dice(6, 6, 6));
    expect(r.ok && r.state.points).toBe(18);
    const low = rollDice(quickStart(), dice(1, 1, 1));
    expect(low.ok && low.state.points).toBe(3);
    expect(low.ok && low.state.phase).toBe('act');
  });

  it('cannot roll twice in one turn', () => {
    const s = ok(rollDice(quickStart(), dice(2, 3, 4)));
    expect(rollDice(s).ok).toBe(false);
  });

  it('always lands between 3 and 18', () => {
    for (let i = 0; i < 200; i++) {
      const r = rollDice(quickStart());
      if (!r.ok) throw new Error();
      expect(r.state.points).toBeGreaterThanOrEqual(3);
      expect(r.state.points).toBeLessThanOrEqual(18);
    }
  });
});

const SPEEDS: GameConfig = { ...OPEN, options: { ...OPEN.options, unitSpeeds: true } };

describe('movement', () => {
  it('every step costs 1 point on foot; heavy horse goes 2 hexes a point, light horse 3 (default)', () => {
    const furthest = (t: UnitTypeId) => {
      const s = scenario([['red', t, 8, 5]], 4);
      return Math.max(0, ...[...reachable(s, s.units[0].id, OPEN).values()].map((r) => distance(r.hex, { col: 8, row: 5 })));
    };
    // Top speed caps a turn's run at 4 hexes on foot, 6 for heavy horse, 9 for light horse.
    expect([furthest('heavyInfantry'), furthest('heavyCavalry'), furthest('lightCavalry'), furthest('king')]).toEqual([4, 6, 9, 4]);
    const free: GameConfig = { ...OPEN, options: { ...OPEN.options, runLimit: null } };
    const far = (t: UnitTypeId) => Math.max(...[...reachable(scenario([['red', t, 8, 5]], 4, free), `red-${t}-0`, free).values()].map((r) => r.steps));
    expect([far('heavyInfantry'), far('heavyCavalry'), far('lightCavalry')]).toEqual([4, 8, 12]);
  });

  it('top speed counts every move in the turn', () => {
    const s = scenario([['red', 'lightInfantry', 8, 5]], 10);
    const id = s.units[0].id;
    const a = ok(moveUnit(s, id, { col: 8, row: 7 }, OPEN));
    expect(reachable(a, id, OPEN).has('8,9')).toBe(true);
    expect(reachable(a, id, OPEN).has('8,10')).toBe(false); // 5th hex this turn
  });

  it('a light rider pays 1 point for up to 3 hexes', () => {
    const s = scenario([['red', 'lightCavalry', 8, 5]], 5);
    const reach = reachable(s, s.units[0].id, OPEN);
    expect(reach.get('8,6')?.cost).toBe(1);
    expect(reach.get('8,8')?.cost).toBe(1);
    expect(reach.get('8,9')?.cost).toBe(2);
  });

  it('different speeds: ratio 1:2:3:6 shows in reach for the same points', () => {
    const furthest = (t: UnitTypeId) => {
      const s = scenario([['red', t, 8, 5]], 6, SPEEDS);
      return Math.max(0, ...[...reachable(s, s.units[0].id, SPEEDS).values()].map((r) => distance(r.hex, { col: 8, row: 5 })));
    };
    expect([furthest('heavyInfantry'), furthest('lightInfantry'), furthest('heavyCavalry'), furthest('lightCavalry')]).toEqual([1, 2, 3, 6]);
    expect(furthest('king')).toBe(1);
  });

  it('spends points and blocks moves the points cannot pay for', () => {
    const s = scenario([['red', 'lightInfantry', 2, 2]], 3);
    const id = s.units[0].id;
    const a = ok(moveUnit(s, id, { col: 2, row: 4 }, OPEN));
    expect(a.points).toBe(1);
    expect(moveUnit(a, id, { col: 2, row: 6 }, OPEN).ok).toBe(false);
  });

  it('lets points be split across several units', () => {
    const s = scenario([['red', 'lightCavalry', 1, 1], ['red', 'heavyInfantry', 5, 5]], 8, SPEEDS);
    const a = ok(moveUnit(s, s.units[0].id, { col: 1, row: 3 }, SPEEDS));
    const b = ok(moveUnit(a, s.units[1].id, { col: 5, row: 6 }, SPEEDS));
    expect(b.points).toBe(0);
  });

  it('cannot move onto or through enemies, can pass through friends', () => {
    const s = scenario([
      ['red', 'lightCavalry', 2, 0],
      ['red', 'heavyInfantry', 2, 1],
      ['blue', 'heavyInfantry', 2, 3],
    ], 2);
    const reach = reachable(s, s.units[0].id, OPEN);
    expect(reach.has('2,1')).toBe(false); // occupied by a friend
    expect(reach.get('2,2')?.steps).toBe(2); // straight through the friend
    expect(reach.has('2,3')).toBe(false);
  });

  it('cannot move the other side’s units or move before rolling', () => {
    const s = scenario([['blue', 'lightCavalry', 2, 2]]);
    expect(moveUnit(s, s.units[0].id, { col: 2, row: 3 }, OPEN)).toEqual({ ok: false, error: 'notYourUnit' });
    expect(moveUnit({ ...s, phase: 'roll' }, s.units[0].id, { col: 2, row: 3 }, OPEN).ok).toBe(false);
  });

  it('treats forest as impassable', () => {
    const cfg: GameConfig = { ...OPEN, board: { ...OPEN.board, forests: [[3, 2]] } };
    const s = scenario([['red', 'lightCavalry', 3, 1]], 18, cfg);
    const reach = reachable(s, s.units[0].id, cfg);
    expect(reach.has('3,2')).toBe(false);
    expect(reach.get('3,3')!.steps).toBeGreaterThan(2); // has to go around
  });

  it('crosses the river only at a bridge', () => {
    const R = CONFIG.board.riverCol!;
    const s = scenario([['red', 'lightCavalry', R - 1, 7]], 18, WHOLE);
    const reach = reachable(s, s.units[0].id, WHOLE);
    expect(reach.has(`${R},7`)).toBe(false); // river
    expect(reach.has(`${R},${CONFIG.board.bridgeRows[0]}`)).toBe(true); // bridge
    // Straight across is 2 hexes, but the detour via a bridge costs more.
    expect(reach.get(`${R + 1},7`)!.cost).toBeGreaterThan(2);
    const noBridges = { ...WHOLE, board: { ...CONFIG.board, bridgeRows: [] } };
    const s2 = scenario([['red', 'lightCavalry', R - 1, 7]], 18, noBridges);
    expect([...reachable(s2, s2.units[0].id, noBridges).values()].every((r) => r.hex.col < R)).toBe(true);
  });
});

describe('melee', () => {
  it('costs 1 point and deals the attack value', () => {
    const s = scenario([['red', 'lightInfantry', 3, 3], ['blue', 'heavyInfantry', 3, 4]], 5);
    const a = ok(attack(s, s.units[0].id, s.units[1].id, OPEN));
    expect(a.points).toBe(4);
    expect(getUnit(a, s.units[1].id)!.hp).toBe(1);
    const b = ok(attack(a, s.units[0].id, s.units[1].id, OPEN));
    expect(getUnit(b, s.units[1].id)).toBeUndefined(); // heavy armour took 2 hits
  });

  it('heavy cavalry kills heavy infantry in one hit', () => {
    const s = scenario([['red', 'heavyCavalry', 3, 3], ['blue', 'heavyInfantry', 3, 4]]);
    const a = ok(attack(s, s.units[0].id, s.units[1].id, OPEN));
    expect(getUnit(a, s.units[1].id)).toBeUndefined();
  });

  it('light units die from one hit', () => {
    for (const t of ['lightInfantry', 'lightCavalry', 'archer'] as UnitTypeId[]) {
      const s = scenario([['red', 'heavyInfantry', 3, 3], ['blue', t, 3, 4]]);
      expect(getUnit(ok(attack(s, s.units[0].id, s.units[1].id, OPEN)), s.units[1].id)).toBeUndefined();
    }
  });

  it('needs adjacency and points; archers cannot melee by default', () => {
    const far = scenario([['red', 'heavyInfantry', 3, 3], ['blue', 'heavyInfantry', 3, 5]]);
    expect(attack(far, far.units[0].id, far.units[1].id, OPEN)).toEqual({ ok: false, error: 'notAdjacent' });
    const broke = scenario([['red', 'heavyInfantry', 3, 3], ['blue', 'heavyInfantry', 3, 4]], 0);
    expect(attack(broke, broke.units[0].id, broke.units[1].id, OPEN)).toEqual({ ok: false, error: 'notEnoughPoints' });
    const arch = scenario([['red', 'archer', 3, 3], ['blue', 'heavyInfantry', 3, 4]]);
    expect(attack(arch, arch.units[0].id, arch.units[1].id, OPEN)).toEqual({ ok: false, error: 'cannotMelee' });
    const friend = scenario([['red', 'heavyInfantry', 3, 3], ['red', 'heavyInfantry', 3, 4]]);
    expect(attack(friend, friend.units[0].id, friend.units[1].id, OPEN)).toEqual({ ok: false, error: 'notEnemy' });
  });

  it('previews the outcome without changing state', () => {
    const s = scenario([['red', 'lightInfantry', 3, 3], ['blue', 'heavyInfantry', 3, 4]]);
    expect(previewStrike(s, s.units[0].id, s.units[1].id, 'attack', OPEN)).toEqual({ kind: 'attack', damage: 1, hpAfter: 1, kills: false, cost: 1, counter: 0 });
    expect(strikeTargets(s, s.units[0].id, OPEN).map((t) => t.targetId)).toEqual([s.units[1].id]);
  });
});

describe('archers', () => {
  it('shoot at range 2-6 for 1 damage and 2 points', () => {
    for (const row of [5, 6, 9]) {
      const s = scenario([['red', 'archer', 3, 3], ['blue', 'heavyInfantry', 3, row]]);
      const a = ok(shoot(s, s.units[0].id, s.units[1].id, OPEN));
      expect(a.points).toBe(16);
      expect(getUnit(a, s.units[1].id)!.hp).toBe(1);
    }
  });

  it('cannot shoot adjacent or beyond 6 hexes', () => {
    for (const row of [4, 10]) {
      const s = scenario([['red', 'archer', 3, 3], ['blue', 'heavyInfantry', 3, row]]);
      expect(shoot(s, s.units[0].id, s.units[1].id, OPEN)).toEqual({ ok: false, error: 'outOfRange' });
    }
  });

  it('cannot shoot through forest, can shoot over the river', () => {
    const cfg: GameConfig = { ...OPEN, board: { ...OPEN.board, forests: [[3, 4]] } };
    const s = scenario([['red', 'archer', 3, 3], ['blue', 'heavyInfantry', 3, 5]], 18, cfg);
    expect(hasLineOfSight(s, { col: 3, row: 3 }, { col: 3, row: 5 }, cfg)).toBe(false);
    expect(shoot(s, s.units[0].id, s.units[1].id, cfg)).toEqual({ ok: false, error: 'noLineOfSight' });
    const R = CONFIG.board.riverCol!;
    const r = scenario([['red', 'archer', R - 1, 7], ['blue', 'lightInfantry', R + 1, 7]], 18, CONFIG);
    expect(shoot(r, r.units[0].id, r.units[1].id, CONFIG).ok).toBe(true);
  });

  it('only archers can shoot', () => {
    const s = scenario([['red', 'heavyCavalry', 3, 3], ['blue', 'heavyInfantry', 3, 5]]);
    expect(shoot(s, s.units[0].id, s.units[1].id, OPEN)).toEqual({ ok: false, error: 'cannotShoot' });
  });
});

describe('winning', () => {
  it('killing the King ends the game', () => {
    const s = scenario([['red', 'heavyCavalry', 3, 3], ['blue', 'king', 3, 4]]);
    const a = ok(attack(s, s.units[0].id, s.units[1].id, OPEN));
    expect(a.phase).toBe('over');
    expect(a.winner).toBe('red');
    expect(a.winReason).toBe('kingKilled');
    expect(moveUnit(a, s.units[0].id, { col: 3, row: 2 }, OPEN).ok).toBe(false);
  });

  it('ending the turn next to an undefended King captures it', () => {
    const s = scenario([['red', 'lightInfantry', 3, 3], ['blue', 'king', 3, 4]]);
    const a = ok(endTurn(s, OPEN));
    expect(a.winner).toBe('red');
    expect(a.winReason).toBe('kingCaptured');
  });

  it('a defender next to the King prevents capture', () => {
    const s = scenario([['red', 'lightInfantry', 3, 3], ['blue', 'king', 3, 4], ['blue', 'heavyInfantry', 3, 5]]);
    const a = ok(endTurn(s, OPEN));
    expect(a.winner).toBeNull();
    expect(a.current).toBe('blue');
  });

  it('capture can be switched off in config', () => {
    const cfg: GameConfig = { ...OPEN, win: { ...OPEN.win, captureKing: false } };
    const s = scenario([['red', 'lightInfantry', 3, 3], ['blue', 'king', 3, 4]], 18, cfg);
    expect(ok(endTurn(s, cfg)).winner).toBeNull();
  });
});

describe('turns and undo', () => {
  it('end turn hands over to the other player with fresh points', () => {
    const s = ok(rollDice(quickStart(), dice(4, 4, 4)));
    const a = ok(endTurn(s));
    expect(a.current).toBe('blue');
    expect(a.phase).toBe('roll');
    expect(a.points).toBe(0);
    expect(a.turn).toBe(1);
    const b = ok(endTurn(ok(rollDice(a, dice(1, 2, 3)))));
    expect(b.current).toBe('red');
    expect(b.turn).toBe(2);
  });

  it('undo reverts moves within the turn but never the dice roll', () => {
    let sess = startSession(quickStart());
    sess = apply(sess, (s) => rollDice(s, dice(6, 6, 6)), true).sess;
    expect(canUndo(sess)).toBe(false);
    const cav = sess.state.units.find((u) => u.owner === 'red' && u.type === 'lightCavalry')!;
    const target = [...reachable(sess.state, cav.id).values()][0].hex;
    sess = apply(sess, (s) => moveUnit(s, cav.id, target)).sess;
    expect(sess.state.points).toBeLessThan(18);
    sess = undo(sess);
    expect(sess.state.points).toBe(18);
    expect(getUnit(sess.state, cav.id)!.pos).toEqual(cav.pos);
    expect(canUndo(sess)).toBe(false);
  });

  it('a failed action leaves the session untouched', () => {
    const sess = startSession(quickStart());
    const { sess: after, result } = apply(sess, (s) => endTurn(s));
    expect(result.ok).toBe(false);
    expect(after).toBe(sess);
  });
});

describe('stepping into the hex after a kill', () => {
  const withMode = (mode: GameConfig['combat']['advanceAfterKill']): GameConfig => ({ ...OPEN, combat: { ...OPEN.combat, advanceAfterKill: mode } });

  it('by default the killer must move into the dead piece’s hex, for free', () => {
    const s = scenario([['red', 'heavyCavalry', 3, 3], ['blue', 'lightInfantry', 3, 4]], 5);
    const a = ok(attack(s, s.units[0].id, s.units[1].id, OPEN));
    expect(getUnit(a, s.units[0].id)!.pos).toEqual({ col: 3, row: 4 });
    expect(a.points).toBe(4); // only the attack cost
  });

  it('a hit that does not kill leaves both pieces where they are', () => {
    const s = scenario([['red', 'lightInfantry', 3, 3], ['blue', 'heavyInfantry', 3, 4]]);
    const a = ok(attack(s, s.units[0].id, s.units[1].id, OPEN));
    expect(getUnit(a, s.units[0].id)!.pos).toEqual({ col: 3, row: 3 });
  });

  it('archers never move after a kill', () => {
    const s = scenario([['red', 'archer', 3, 3], ['blue', 'lightInfantry', 3, 5]]);
    const a = ok(shoot(s, s.units[0].id, s.units[1].id, OPEN));
    expect(getUnit(a, s.units[0].id)!.pos).toEqual({ col: 3, row: 3 });
  });

  it("'never' keeps the killer in place", () => {
    const cfg = withMode('never');
    const s = scenario([['red', 'heavyCavalry', 3, 3], ['blue', 'lightInfantry', 3, 4]], 18, cfg);
    expect(getUnit(ok(attack(s, s.units[0].id, s.units[1].id, cfg)), s.units[0].id)!.pos).toEqual({ col: 3, row: 3 });
  });

  it("'may' offers the hex until the player does something else", () => {
    const cfg = withMode('may');
    const s = scenario([['red', 'heavyCavalry', 3, 3], ['blue', 'lightInfantry', 3, 4], ['red', 'lightCavalry', 6, 6]], 18, cfg);
    const a = ok(attack(s, s.units[0].id, s.units[1].id, cfg));
    expect(a.advance).toEqual({ unitId: s.units[0].id, to: { col: 3, row: 4 } });
    const taken = ok(takeHex(a));
    expect(getUnit(taken, s.units[0].id)!.pos).toEqual({ col: 3, row: 4 });
    expect(taken.points).toBe(a.points);
    const skipped = ok(moveUnit(a, s.units[2].id, { col: 6, row: 7 }, cfg));
    expect(skipped.advance).toBeNull();
    expect(takeHex(skipped)).toEqual({ ok: false, error: 'nothingToTake' });
  });
});
