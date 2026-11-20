// Battle settings chosen on the "New battle" screen: army size, map, how points come each
// turn, and which optional rules are on. They are applied to the game's rules before a battle
// starts and saved with it, so a reloaded game keeps its own settings.

import { CONFIG, type GameConfig, type TimeOfDay, type WeatherKind } from '../config';
import type { Difficulty, Player } from '../engine';
import { known, setSides, sides, type FactionId } from './factions';
import { cleanKnobs, generateMap, MAP_STYLES, type MapKnobs, type MapStyle } from '../engine/mapgen';

import MAPS from './maps.json';
import { BIOME_IDS, HOME, type BiomeId } from './biomes';
export type MapId = 'river' | 'open' | 'forest' | 'fords' | 'pass' | 'island' | 'longwood' | 'noford' | 'ridge' | 'marsh' | 'lake' | 'castles' | 'village' | 'siege' | 'waterloo' | 'isandlwana' | 'random' | 'home' | `home-${FactionId}`;
export type DiceId = '1d6' | '3d6' | '2d6' | 'fixed';

export interface Settings {
  budget: number;
  map: MapId;
  /** Standard 25 x 15 hexes, or a larger 33 x 19 board for big battles. */
  size?: 'standard' | 'large';
  dice: DiceId;
  options: GameConfig['options'];
  /** Random map: the seed and style it is grown from, so a resumed or online game rebuilds the very same map. */
  mapSeed?: number;
  mapStyle?: MapStyle;
  /** "Customize land": set only when the player moved a knob off the preset (older saves have none: the style alone). */
  mapKnobs?: MapKnobs;
  /** biomes: the land a random map grows in (none = the meadow). */
  mapBiome?: BiomeId;
  /** The faction each side leads (Novgorod side moves first). */
  sides: Record<Player, FactionId>;
  /** How well the computer plays (games against the computer only; online games ignore it). Older saves have none: Normal. */
  difficulty?: Difficulty;
  /** Light and weather as chosen (none = day and clear; 'random' is rolled when the battle starts). */
  time?: TimeOfDay | 'random';
  weather?: WeatherKind | 'random';
  /** The light and weather this battle actually has (a random choice rolled once, saved and sent with the battle). */
  sky?: { time: TimeOfDay; kind: WeatherKind };
  /** A campaign battle (src/ui/scenarios.ts): its id, so its result can be recorded. */
  scenario?: string;
}

/** Dad's rules exactly: nothing optional switched on. */
export const DADS_RULES: GameConfig['options'] = { ...CONFIG.options };

/** The set the simulation suggested: shorter battles, heavy infantry with a job, archers in check. */
export const RECOMMENDED: GameConfig['options'] = {
  ...CONFIG.options,
  firstTurnBonus: 2,
  carryMax: 3,
  rerolls: 1,
  kingsGuard: true,
  flanking: true,
  routAt: 0.5,
  shieldWall: true,
  spears: true,
  longShotFrom: 4,
  charge: true,
  toughness: 2,
  rainRange: true,
  snowCavalry: true,
  fogCap: true,
  forestCover: true,
  battleLines: 'close',
};

export const TIMES: readonly TimeOfDay[] = ['day', 'dusk', 'night'];
export const WEATHERS: readonly WeatherKind[] = ['clear', 'rain', 'snow', 'fog'];

export const DEFAULT_SETTINGS: Settings = { budget: 50, map: 'river', dice: '3d6', options: { ...RECOMMENDED }, sides: { red: 'novgorod', blue: 'teutonic' }, difficulty: 'normal' };

const KEY = 'boc-settings';

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    // Version 3 (2026-11-17): back to three dice by default, now that pieces have a top speed.
    if (s && typeof s.budget === 'number' && s.v !== 3 && s.v !== 4 && s.v !== 5) s.dice = '3d6';
    // Version 4 (2026-11-17): looser limits: foot pieces walk 4 hexes, long shots start past 4, quivers hold 8.
    if (s && typeof s.budget === 'number' && s.v !== 4 && s.v !== 5 && s.options) {
      if (s.options.runLimit === 3) s.options.runLimit = 4;
      if (s.options.longShotFrom === 3) s.options.longShotFrom = 4;
      if (s.options.volleys === 6) s.options.volleys = 8;
    }
    // Version 5 (2026-11-17): foot pieces walk 6 hexes a turn.
    if (s && typeof s.budget === 'number' && s.v !== 5 && s.v !== 6 && s.options && (s.options.runLimit === 3 || s.options.runLimit === 4)) s.options.runLimit = 6;
    // Version 6 (2026-11-18): Recommended rules are the default; anyone still on untouched Dad's rules moves to them.
    if (s && typeof s.budget === 'number' && s.v !== 6 && s.options && (Object.keys(DADS_RULES) as (keyof typeof DADS_RULES)[]).every((k) => s.options[k] === undefined || s.options[k] === DADS_RULES[k])) s.options = { ...RECOMMENDED };
    // Weather rules (2026-11-17): someone on the Recommended rules gets them too; everyone else keeps them off.
    if (s && typeof s.budget === 'number' && s.options && s.options.rainRange === undefined) {
      const rec = (Object.keys(RECOMMENDED) as (keyof typeof RECOMMENDED)[]).every((k) => k === 'rainRange' || k === 'snowCavalry' || k === 'fogCap' || s.options[k] === undefined || s.options[k] === RECOMMENDED[k]);
      if (rec) s.options = { ...s.options, rainRange: true, snowCavalry: true, fogCap: true };
    }
    // Forest cover and close battle lines (2026-11-18): someone on the Recommended rules gets them too.
    if (s && typeof s.budget === 'number' && s.options && s.options.forestCover === undefined) {
      const rec = (Object.keys(RECOMMENDED) as (keyof typeof RECOMMENDED)[]).every((k) => k === 'forestCover' || k === 'battleLines' || s.options[k] === undefined || s.options[k] === RECOMMENDED[k]);
      if (rec) s.options = { ...s.options, forestCover: true, battleLines: 'close' };
    }
    // One step at a time is gone from the game (2026-11-20): every saved setting walks freely.
    if (s && typeof s.budget === 'number' && s.options) s.options.stepMoves = false;
    if (s && typeof s.budget === 'number') return { ...DEFAULT_SETTINGS, ...s, options: { ...DADS_RULES, ...s.options }, sides: { red: known(s.sides?.red, 'novgorod'), blue: known(s.sides?.blue, 'teutonic') }, difficulty: s.difficulty === 'easy' || s.difficulty === 'hard' ? s.difficulty : 'normal' };
  } catch {
    /* fall through to the defaults */
  }
  return structuredClone(DEFAULT_SETTINGS);
}

/** "No luck" points each turn. */
export const fixedPoints = (_s: Settings) => 10;

export function saveSettings(s: Settings) {
  // Saved before a new battle: its light and weather are rolled afresh from the choice.
  delete s.sky;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, sky: undefined, v: 6 }));
  } catch {
    /* keep them for this visit only */
  }
}

// Each map keeps the board size; only the river, bridges and woods change.
const ORIGINAL = structuredClone(CONFIG.board);

/** Mirror a list of Novgorod-side forest hexes onto the Teutonic side. */
const mirrored = (half: [number, number][]): [number, number][] => [...half, ...half.map(([c, r]) => [CONFIG.board.cols - 1 - c, r] as [number, number])];

/** A new random seed for a generated map. */
export const newSeed = () => Math.floor(Math.random() * 2147483647) + 1;
const styleOf = (s?: string): MapStyle => (MAP_STYLES.includes(s as MapStyle) ? (s as MapStyle) : 'valley');

/** The board for a map. A random map needs its seed and style (and is grown at the board size, not enlarged). */
export function boardFor(map: MapId, gen?: { seed?: number; style?: MapStyle; size?: 'standard' | 'large'; knobs?: MapKnobs; biome?: BiomeId; home?: FactionId }): GameConfig['board'] {
  if (map === 'random') {
    const g = generateMap(gen?.seed ?? 1, styleOf(gen?.style), gen?.size ?? 'standard', cleanKnobs(gen?.knobs));
    return gen?.biome && gen.biome !== 'meadow' && BIOME_IDS.includes(gen.biome) ? { ...g, biome: gen.biome } : g;
  }
  // "Home ground": the home map of the army leading the first side.
  if (map === 'home') return boardFor(HOME[gen?.home ?? sides.red] as MapId);
  const { cols, rows } = ORIGINAL;
  const mid = Math.floor(cols / 2);
  const made = (MAPS as unknown as Record<string, Partial<GameConfig['board']>>)[map];
  // Maps drawn up in maps.json (shared with the script that paints their hills, swamps and lakes).
  if (made) return { cols, rows, riverCol: null, bridgeRows: [], forests: [], ...structuredClone(made), ...(made.hills || made.swamps || made.lakes ? { overlay: map } : {}) } as GameConfig['board'];
  switch (map) {
    case 'river':
      return structuredClone(ORIGINAL);
    case 'open':
      // An open field: no river, a few copses.
      return { cols, rows, riverCol: null, bridgeRows: [], forests: mirrored([[9, 3], [9, 4], [8, 11], [10, 7]]) };
    case 'forest':
      // Heavy woods with paths through them, and the river with three bridges.
      return {
        cols, rows, riverCol: mid, bridgeRows: [2, 7, 12],
        forests: mirrored([
          [6, 0], [6, 1], [7, 1], [7, 2], [6, 4], [7, 4], [7, 5], [8, 5], [6, 9], [7, 9], [7, 10], [8, 9],
          [6, 13], [7, 12], [7, 13], [10, 2], [10, 3], [10, 10], [10, 11], [9, 7], [10, 6],
        ]),
      };
    case 'fords':
      // One bridge in the middle and a ford near each edge: the fords are slow to wade, so the bridge is the prize.
      return { cols, rows, riverCol: mid, bridgeRows: [7], fordRows: [1, 13], forests: mirrored([[8, 4], [8, 5], [9, 9], [9, 10], [6, 7]]) };
    case 'pass': {
      // A wall of forest across the middle with three gaps: a wide one at each end and a narrow one in the centre.
      const gaps = new Set([1, 2, 7, 12, 13]);
      const wall: [number, number][] = [];
      for (let r = 0; r < rows; r++) if (!gaps.has(r)) wall.push([mid - 1, r], [mid, r]);
      return { cols, rows, riverCol: null, bridgeRows: [], forests: [...mirrored(wall.filter(([c]) => c !== mid)), ...wall.filter(([c]) => c === mid), ...mirrored([[6, 4], [6, 10]])] };
    }
  }
  return structuredClone(ORIGINAL);
}

/** The large board (33 x 19): every hex takes the terrain of the nearest standard-board hex, rivers move to their
 *  matching column and bridges and fords to their matching row. _art/map_build.py paints it with the same rule. */
const LARGE: [number, number] = [33, 19];
export function enlargeBoard(b: GameConfig['board']): GameConfig['board'] {
  const [C, R] = LARGE;
  const back = (c: number, r: number) => `${Math.floor((c * (b.cols - 1)) / (C - 1) + 0.5)},${Math.floor((r * (b.rows - 1)) / (R - 1) + 0.5)}`;
  const area = (cells?: [number, number][]) => {
    if (!cells) return undefined;
    const want = new Set(cells.map(([c, r]) => `${c},${r}`));
    const out: [number, number][] = [];
    for (let c = 0; c < C; c++) for (let r = 0; r < R; r++) if (want.has(back(c, r))) out.push([c, r]);
    return out;
  };
  const col = (c: number) => Math.round((c * (C - 1)) / (b.cols - 1));
  const row = (r: number) => Math.round((r * (R - 1)) / (b.rows - 1));
  const rivers = [...(b.riverCol === null ? [] : [{ col: b.riverCol, bridges: b.bridgeRows, fords: b.fordRows ?? [] }]), ...(b.rivers ?? [])].map((rv) => ({ col: col(rv.col), bridges: rv.bridges.map(row), fords: rv.fords.map(row) }));
  // Forest keeps its clumps: each standard forest hex becomes the large hexes nearest it (rivers win over trees).
  const riverCols = new Set(rivers.map((rv) => rv.col));
  const forests = (area(b.forests) ?? []).filter(([c]) => !riverCols.has(c));
  // Castles and villages: each standard hex becomes the large hexes nearest it, so walls stay unbroken lines.
  // A gateway keeps its facing.
  const gates = b.gates ? b.gates.flatMap((g) => (area([[g.col, g.row]]) ?? []).map(([col, row]) => ({ col, row, facing: g.facing }))) : undefined;
  return { ...b, cols: C, rows: R, riverCol: null, bridgeRows: [], fordRows: [], rivers, forests, hills: area(b.hills), swamps: area(b.swamps), lakes: area(b.lakes), walls: area(b.walls), towers: area(b.towers), gates, houses: area(b.houses), boulders: b.boulders?.map(([c, r]) => [col(c), row(r)] as [number, number]), ...(b.art ? { art: bigArt(b, back, col, row) } : {}) };
}
/** biomes: each large hex keeps the carved building of the standard hex it grew from (boulders move to their matching hex). */
function bigArt(b: GameConfig['board'], back: (c: number, r: number) => string, col: (c: number) => number, row: (r: number) => number): Record<string, string> {
  const art = b.art ?? {};
  const out: Record<string, string> = {};
  for (let c = 0; c < LARGE[0]; c++) for (let r = 0; r < LARGE[1]; r++) if (art[back(c, r)]) out[`${c},${r}`] = art[back(c, r)];
  for (const k of Object.keys(art)) {
    const [c, r] = k.split(',').map(Number);
    out[`${col(c)},${row(r)}`] = art[k];
  }
  return out;
}

/** Puts the settings into the game's rules. Call before starting or loading a battle. */
export function applySettings(s: Settings) {
  CONFIG.army.budget = s.budget;
  if (s.map === 'random') {
    // A random map always has its own seed and style, saved with the battle.
    s.mapSeed ??= newSeed();
    s.mapStyle = styleOf(s.mapStyle);
    s.mapKnobs = cleanKnobs(s.mapKnobs);
    if (!s.mapKnobs) delete s.mapKnobs;
    CONFIG.board = boardFor('random', { seed: s.mapSeed, style: s.mapStyle, size: s.size === 'large' ? 'large' : 'standard', knobs: s.mapKnobs, biome: s.mapBiome });
  } else {
    const b = boardFor(s.map, { home: s.sides?.red });
    CONFIG.board = s.size === 'large' ? enlargeBoard(b) : b;
  }
  // A bigger board leaves more room to set up.
  CONFIG.deploy.depth = s.size === 'large' ? 7 : 5;
  CONFIG.dice =
    s.dice === 'fixed' ? { count: 0, sides: 6, fixed: fixedPoints(s) }
    : s.dice === '1d6' ? { count: 1, sides: 6, fixed: null }
    : s.dice === '2d6' ? { count: 2, sides: 6, fixed: null }
    : { count: 3, sides: 6, fixed: null };
  CONFIG.options = { ...s.options };
  // Light and weather: a random choice is rolled once per battle and kept in `sky`, so a resumed or online game matches.
  const pick = <T,>(all: readonly T[]) => all[Math.floor(Math.random() * all.length)];
  if (!s.sky) s.sky = { time: s.time === 'random' ? pick(TIMES) : (s.time ?? 'day'), kind: s.weather === 'random' ? pick(WEATHERS) : (s.weather ?? 'clear') };
  CONFIG.weather = { ...s.sky };
  setSides(s.sides ?? DEFAULT_SETTINGS.sides);
  s.sides = { ...sides };
}
