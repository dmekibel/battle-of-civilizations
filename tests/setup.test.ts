import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import {
  armyCost,
  autoDeploy,
  draftArmy,
  finishDeploy,
  inZone,
  liftUnit,
  newGame,
  placeUnit,
  rollDice,
  type GameState,
  type Result,
} from '../src/engine';

const ok = (r: Result): GameState => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.state;
};

describe('army building', () => {
  it('prices pieces by power: LI 1, HI 2, archers 3, LC 3, HC 4', () => {
    expect(armyCost({ lightInfantry: 1, heavyInfantry: 1, archer: 1, lightCavalry: 1, heavyCavalry: 1 })).toBe(13);
  });

  it('starts with Red building an army', () => {
    const s = newGame();
    expect(s.phase).toBe('draft');
    expect(s.current).toBe('red');
    expect(s.units).toEqual([]);
  });

  it('accepts an army within 50 points and adds the King for free', () => {
    const s = ok(draftArmy(newGame(), { heavyCavalry: 10, lightInfantry: 10 }));
    expect(s.phase).toBe('deploy');
    expect(s.reserve.red.filter((t) => t === 'king').length).toBe(1);
    expect(s.reserve.red.length).toBe(21);
  });

  it('rejects armies over budget or with bad counts', () => {
    expect(draftArmy(newGame(), { heavyCavalry: 13 })).toEqual({ ok: false, error: 'overBudget' });
    expect(draftArmy(newGame(), { lightInfantry: -1 })).toEqual({ ok: false, error: 'badArmy' });
    expect(draftArmy(newGame(), { lightInfantry: 1.5 })).toEqual({ ok: false, error: 'badArmy' });
    expect(draftArmy(newGame(), { king: 1 } as never)).toEqual({ ok: false, error: 'badArmy' });
  });

  it('fits even the largest army (50 light infantry) in the zone', () => {
    const s = ok(draftArmy(newGame(), { lightInfantry: 50 }));
    expect(ok(autoDeploy(s)).reserve.red).toEqual([]);
  });
});

describe('deployment', () => {
  const drafted = ok(draftArmy(newGame(), { lightInfantry: 2, archer: 1 }));

  it('places pieces only in your own zone, on open ground, one per hex', () => {
    expect(placeUnit(drafted, 'king', { col: 8, row: 5 })).toEqual({ ok: false, error: 'outsideZone' });
    expect(placeUnit(drafted, 'king', { col: 4, row: 1 })).toEqual({ ok: false, error: 'blocked' }); // forest
    const a = ok(placeUnit(drafted, 'king', { col: 0, row: 5 }));
    expect(placeUnit(a, 'archer', { col: 0, row: 5 })).toEqual({ ok: false, error: 'occupied' });
    expect(placeUnit(a, 'heavyCavalry', { col: 1, row: 5 })).toEqual({ ok: false, error: 'notInReserve' });
    expect(a.reserve.red).not.toContain('king');
  });

  it('lets you pick a piece back up', () => {
    const a = ok(placeUnit(drafted, 'archer', { col: 1, row: 1 }));
    const b = ok(liftUnit(a, a.units[0].id));
    expect(b.units).toEqual([]);
    expect(b.reserve.red).toContain('archer');
  });

  it('cannot finish until every piece is placed', () => {
    expect(finishDeploy(drafted)).toEqual({ ok: false, error: 'reserveNotEmpty' });
  });

  it('auto-deploy puts the King at the back and everything inside the zone', () => {
    const a = ok(autoDeploy(drafted, () => 0.5));
    expect(a.units.length).toBe(4);
    expect(a.units.every((u) => inZone('red', u.pos))).toBe(true);
    expect(a.units.find((u) => u.type === 'king')!.pos.col).toBe(0);
  });

  it('runs Red build, Red deploy, Blue build, Blue deploy, then Red rolls', () => {
    let s = ok(finishDeploy(ok(autoDeploy(drafted))));
    expect([s.current, s.phase]).toEqual(['blue', 'draft']);
    s = ok(draftArmy(s, { heavyInfantry: 3 }));
    s = ok(autoDeploy(s));
    expect(s.units.filter((u) => u.owner === 'blue').every((u) => inZone('blue', u.pos))).toBe(true);
    s = ok(finishDeploy(s));
    expect([s.current, s.phase]).toEqual(['red', 'roll']);
    expect(rollDice(s).ok).toBe(true);
  });

  it('zones sit at opposite edges', () => {
    expect(inZone('red', { col: CONFIG.deploy.depth - 1, row: 0 })).toBe(true);
    expect(inZone('red', { col: CONFIG.deploy.depth, row: 0 })).toBe(false);
    expect(inZone('blue', { col: CONFIG.board.cols - 1, row: 0 })).toBe(true);
    expect(inZone('blue', { col: CONFIG.board.cols - 1 - CONFIG.deploy.depth, row: 0 })).toBe(false);
  });
});
