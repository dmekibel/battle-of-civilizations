import { describe, expect, it } from 'vitest';
import { applyAi, attack, endTurn, getUnit, moveUnit, reachable, rollDice, shoot, strikeTargets, key, type GameState } from '../src/engine';
import { allows, enemyAction, scriptedRng, stepAt, STEPS, T, tutorialConfig, tutorialState, FOOTMAN_TO, HORSEMAN_TO } from '../src/ui/tutorial';

const cfg = tutorialConfig();

const ok = (r: { ok: true; state: GameState } | { ok: false; error: string }) => {
  if (!r.ok) throw new Error(r.error);
  return r.state;
};

/** Plays the lesson the way a player following the glow would: tap exactly what each step lights up. */
function playLesson() {
  const rng = scriptedRng();
  let s = tutorialState(cfg);
  let sel: string | null = null;
  const acked = new Set<string>();
  const seen: string[] = [];
  const step = () => STEPS[stepAt(s, sel, acked)];
  for (let guard = 0; guard < 60; guard++) {
    const st = step();
    if (seen[seen.length - 1] !== st.id) seen.push(st.id);
    if (st.id === 'ready') break;
    // The game rolls on its own at the start of each turn.
    if (s.phase === 'roll') {
      s = ok(rollDice(s, rng, cfg));
      continue;
    }
    // The enemy's turn plays itself from the script.
    if (s.current === 'blue') {
      const a = enemyAction(s);
      s = a ? ok(applyAi(s, a, cfg)) : ok(endTurn(s, cfg));
      continue;
    }
    if (st.next) {
      acked.add(st.id);
      continue;
    }
    const want = st.target(s, sel);
    if (!want) throw new Error(`step ${st.id} has nothing to tap`);
    if (want.kind === 'act') {
      expect(allows(st, s, sel, { act: want.act })).toBe(true);
      expect(want.act).toBe('end');
      s = ok(endTurn(s, cfg));
      sel = null;
      continue;
    }
    if (want.kind === 'look') throw new Error(`step ${st.id} waits on a look target`);
    const hex = want.kind === 'hex' ? want.hex : getUnit(s, want.id)!.pos;
    expect(allows(st, s, sel, { hex })).toBe(true);
    const own = sel ? getUnit(s, sel) : undefined;
    if (want.kind === 'hex') {
      expect(reachable(s, own!.id, cfg).has(key(hex))).toBe(true);
      s = ok(moveUnit(s, own!.id, hex, cfg));
    } else if (getUnit(s, want.id)!.owner === 'blue') {
      const hit = strikeTargets(s, own!.id, cfg).find((x) => x.targetId === want.id)!;
      expect(hit).toBeTruthy();
      s = ok(hit.preview.kind === 'attack' ? attack(s, own!.id, want.id, cfg) : shoot(s, own!.id, want.id, cfg));
    } else sel = want.id;
  }
  return { s, seen };
}

describe('first-battle tutorial', () => {
  it('scripted dice come up as planned', () => {
    const rng = scriptedRng();
    const s = ok(rollDice(tutorialState(cfg), rng, cfg));
    expect(s.dice).toEqual([3, 4, 2]);
    expect(s.points).toBe(9);
  });

  it('the step machine walks every step in order and the scripted battle ends in victory', () => {
    const { s, seen } = playLesson();
    expect(seen).toEqual(STEPS.map((x) => x.id));
    expect(s.phase).toBe('over');
    expect(s.winner).toBe('red');
    expect(s.winReason).toBe('kingKilled');
    // The enemy's rider really did charge on its turn.
    expect(s.log.some((e) => e.player === 'blue' && e.kind === 'attack' && e.killed)).toBe(true);
  });

  it('starts on the roll and goes back to nothing once a step is done', () => {
    const s = tutorialState(cfg);
    expect(STEPS[stepAt(s, null, new Set())].id).toBe('roll');
    const rolled = ok(rollDice(s, scriptedRng(), cfg));
    expect(STEPS[stepAt(rolled, null, new Set())].id).toBe('points');
    expect(STEPS[stepAt(rolled, null, new Set(['points']))].id).toBe('select');
    expect(STEPS[stepAt(rolled, T.footman, new Set(['points']))].id).toBe('move');
  });

  it('blocks wrong taps', () => {
    const s = ok(rollDice(tutorialState(cfg), scriptedRng(), cfg));
    const acked = new Set(['points']);
    const sel = STEPS[stepAt(s, null, acked)];
    expect(sel.id).toBe('select');
    expect(allows(sel, s, null, { hex: getUnit(s, T.footman)!.pos })).toBe(true);
    expect(allows(sel, s, null, { hex: getUnit(s, T.archer)!.pos })).toBe(false);
    expect(allows(sel, s, null, { hex: FOOTMAN_TO })).toBe(false);
    expect(allows(sel, s, null, { act: 'end' })).toBe(false);
    const move = STEPS[stepAt(s, T.footman, acked)];
    expect(allows(move, s, T.footman, { hex: FOOTMAN_TO })).toBe(true);
    expect(allows(move, s, T.footman, { hex: { col: 2, row: 3 } })).toBe(false);
  });

  it('the planned hexes are legal moves', () => {
    const s = ok(rollDice(tutorialState(cfg), scriptedRng(), cfg));
    expect(reachable(s, T.footman, cfg).has(key(FOOTMAN_TO))).toBe(true);
    // The horseman's hex is held by the enemy rider until it charges on the enemy's turn.
    expect(reachable(s, T.horseman, cfg).has(key(HORSEMAN_TO))).toBe(false);
  });
});
