// Computer-vs-computer simulation: plays many games with plain maths (no AI service) and
// writes statistics per rule variant to sim/results.json. Run: npm run sim (GAMES=200 npm run sim).
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { CONFIG, type GameConfig, type UnitTypeId } from '../src/config';
import { aiNextAction, applyAi, autoDeploy, draftArmy, endTurn, finishDeploy, newGame, rollDice, suggestArmy, type GameState, type Result } from '../src/engine';

const ok = (r: Result) => { if (!r.ok) throw new Error(r.error); return r.state; };
const TYPES: UnitTypeId[] = ['king', 'heavyInfantry', 'lightInfantry', 'archer', 'lightCavalry', 'heavyCavalry'];

function rngFrom(seed: number) { let x = seed; return () => ((x = (x * 16807) % 2147483647) - 1) / 2147483646; }

function play(cfg: GameConfig, seed: number) {
  const rng = rngFrom(seed);
  let s: GameState = newGame(cfg);
  const armies: Record<string, Record<string, number>> = {};
  for (const side of ['red', 'blue']) {
    const a = suggestArmy(rng, cfg);
    armies[side] = a as Record<string, number>;
    s = ok(finishDeploy(ok(autoDeploy(ok(draftArmy(s, a, cfg)), cfg))));
  }
  const st = { rolled: { red: 0, blue: 0 } as Record<string, number>, wasted: { red: 0, blue: 0 } as Record<string, number>, firstContact: -1, halfTurns: 0, actions: 0 };
  while (s.phase !== 'over' && st.halfTurns < 300) {
    const who = s.current;
    s = ok(rollDice(s, rng, cfg));
    st.rolled[who] += s.points;
    for (let i = 0; i < 120 && s.phase === 'act'; i++) {
      const a = aiNextAction(s, cfg);
      if (!a) break;
      const r = applyAi(s, a, cfg, rng);
      if (!r.ok) break;
      s = r.state;
      st.actions++;
      const last = s.log[s.log.length - 1];
      if ((last.kind === 'attack' || last.kind === 'shoot') && st.firstContact < 0) st.firstContact = st.halfTurns;
    }
    if (s.phase === 'act') { st.wasted[who] += s.points; s = ok(endTurn(s, cfg)); }
    st.halfTurns++;
  }
  const kills: Record<string, number> = {}, deaths: Record<string, number> = {}, dmgBy: Record<string, number> = {};
  let shots = 0, shotKills = 0, melee = 0, advanced = 0;
  for (const e of s.log) {
    if (e.kind === 'attack' || e.kind === 'shoot') {
      dmgBy[e.unit] = (dmgBy[e.unit] ?? 0) + e.damage;
      if (e.kind === 'shoot') { shots++; if (e.killed) shotKills++; } else melee++;
      if (e.killed) { kills[e.unit] = (kills[e.unit] ?? 0) + 1; deaths[e.target] = (deaths[e.target] ?? 0) + 1; }
      if (e.advanced) advanced++;
    }
  }
  const survivors: Record<string, Record<string, number>> = { red: {}, blue: {} };
  for (const u of s.units) survivors[u.owner][u.type] = (survivors[u.owner][u.type] ?? 0) + 1;
  return { winner: s.winner, reason: s.winReason, armies, survivors, kills, deaths, dmgBy, shots, shotKills, melee, advanced, ...st };
}

function run(name: string, cfg: GameConfig, n: number) {
  const games = Array.from({ length: n }, (_, i) => play(cfg, 1000 + i * 7919));
  const done = games.filter((g) => g.winner);
  const sum = (f: (g: (typeof games)[0]) => number) => games.reduce((a, g) => a + f(g), 0);
  const typeTotals = (pick: (g: (typeof games)[0]) => Record<string, number>) => Object.fromEntries(TYPES.map((t) => [t, games.reduce((a, g) => a + (pick(g)[t] ?? 0), 0)]));
  const bought = Object.fromEntries(TYPES.map((t) => [t, games.reduce((a, g) => a + (t === 'king' ? 2 : (g.armies.red[t] ?? 0) + (g.armies.blue[t] ?? 0)), 0)]));
  // Which purchases go with winning: average count of each type in winning vs losing armies.
  const winLose = Object.fromEntries(TYPES.filter((t) => t !== 'king').map((t) => {
    let w = 0, l = 0;
    for (const g of done) { const loser = g.winner === 'red' ? 'blue' : 'red'; w += g.armies[g.winner!][t] ?? 0; l += g.armies[loser][t] ?? 0; }
    return [t, [+(w / done.length).toFixed(2), +(l / done.length).toFixed(2)]];
  }));
  const diceEdge = done.filter((g) => { const loser = g.winner === 'red' ? 'blue' : 'red'; return g.rolled[g.winner!] > g.rolled[loser]; }).length;
  const lengths = done.map((g) => g.halfTurns).sort((a, b) => a - b);
  return {
    name, games: n, finished: done.length, stalled: n - done.length,
    redWins: done.filter((g) => g.winner === 'red').length,
    kingKilled: done.filter((g) => g.reason === 'kingKilled').length,
    kingCaptured: done.filter((g) => g.reason === 'kingCaptured').length,
    rounds: { median: lengths[Math.floor(lengths.length / 2)] / 2, p10: lengths[Math.floor(lengths.length * 0.1)] / 2, p90: lengths[Math.floor(lengths.length * 0.9)] / 2 },
    firstContactRound: +(sum((g) => Math.max(0, g.firstContact)) / n / 2).toFixed(1),
    pointsWastedPct: +((100 * sum((g) => g.wasted.red + g.wasted.blue)) / sum((g) => g.rolled.red + g.rolled.blue)).toFixed(1),
    luckierDiceWon: `${diceEdge}/${done.length}`,
    bought, kills: typeTotals((g) => g.kills), deaths: typeTotals((g) => g.deaths), damageDealt: typeTotals((g) => g.dmgBy),
    killsPerPieceBought: Object.fromEntries(TYPES.map((t) => [t, +((games.reduce((a, g) => a + (g.kills[t] ?? 0), 0)) / (bought[t] || 1)).toFixed(2)])),
    survivalPct: Object.fromEntries(TYPES.map((t) => [t, +((100 * games.reduce((a, g) => a + (g.survivors.red[t] ?? 0) + (g.survivors.blue[t] ?? 0), 0)) / (bought[t] || 1)).toFixed(0)])),
    winnerVsLoserArmy: winLose,
    shots: sum((g) => g.shots), shotKills: sum((g) => g.shotKills), meleeHits: sum((g) => g.melee), stepsIntoHex: sum((g) => g.advanced),
  };
}

it('simulate', () => {
  const N = Number(process.env.GAMES ?? 80);
  const base = CONFIG;
  // The "Recommended" optional rules from the New battle screen.
  const recommended: GameConfig = { ...base, options: { ...base.options, firstTurnBonus: 2, carryMax: 3, routAt: 0.5, shieldWall: true, spears: true, longShotFrom: 3, charge: true } };
  const only = process.env.VARIANT;
  const all: [string, GameConfig][] = [
    ['baseline (as the game is now)', base],
    ['archers range 2-3 (old)', { ...base, units: { ...base.units, archer: { ...base.units.archer, ranged: { ...base.units.archer.ranged!, maxRange: 3 } } } }],
    ['budget 30', { ...base, army: { ...base.army, budget: 30 } }],
    ['no capture win (only killing the King)', { ...base, win: { ...base.win, captureKing: false } }],
    ['dice 2d6 (2-12) instead of 3d6', { ...base, dice: { count: 2, sides: 6 } }],
    ['recommended rules', recommended],
    ['top speed 2, 3 dice', { ...base, options: { ...base.options, runLimit: 2 } }],
    ['top speed 3, 3 dice', { ...base, options: { ...base.options, runLimit: 3 } }],
    ['top speed 4, 3 dice', { ...base, options: { ...base.options, runLimit: 4 } }],
    ['top speed 3, recommended', { ...recommended, options: { ...recommended.options, runLimit: 3 } }],
    ['one die (1-6)', { ...base, dice: { count: 1, sides: 6 } }],
    ['one die, recommended', { ...recommended, dice: { count: 1, sides: 6 } }],
    ['fixed 4 points, recommended', { ...recommended, dice: { count: 0, sides: 6, fixed: 4 } }],
    ['old speeds (infantry 3-6, cavalry 1-2)', { ...base, options: { ...base.options, unitSpeeds: true } }],
    ['fair: save points', { ...base, options: { ...base.options, carryMax: 3 } }],
    ['fair: reroll', { ...base, options: { ...base.options, rerolls: 1 } }],
    ["fair: king's guard", { ...base, options: { ...base.options, kingsGuard: true } }],
    ['fair: all three', { ...base, options: { ...base.options, carryMax: 3, rerolls: 1, kingsGuard: true } }],
    ['recommended rules, no dice (always 10)', { ...recommended, dice: { count: 0, sides: 6, fixed: 10 } }],
  ];
  // VARIANT=recommended npm run sim runs only the setups whose name contains that word.
  const variants = only ? all.filter(([n]) => n.includes(only)) : all;
  const out = variants.map(([n, c]) => run(n, c, N));
  writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(out, null, 2));
}, 3600000);
