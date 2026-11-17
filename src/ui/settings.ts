// Battle settings chosen on the "New battle" screen: army size, map, how points come each
// turn, and which optional rules are on. They are applied to the game's rules before a battle
// starts and saved with it, so a reloaded game keeps its own settings.

import { CONFIG, type GameConfig } from '../config';
import type { Player } from '../engine';
import { known, setSides, sides, type FactionId } from './factions';

import MAPS from './maps.json';
export type MapId = 'river' | 'open' | 'forest' | 'fords' | 'pass' | 'island' | 'longwood' | 'noford' | 'ridge' | 'marsh' | 'lake' | 'random';
export type DiceId = '1d6' | '3d6' | '2d6' | 'fixed';

export interface Settings {
  budget: number;
  map: MapId;
  dice: DiceId;
  options: GameConfig['options'];
  /** The faction each side leads (Novgorod side moves first). */
  sides: Record<Player, FactionId>;
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
};

export const DEFAULT_SETTINGS: Settings = { budget: 50, map: 'river', dice: '3d6', options: { ...DADS_RULES }, sides: { red: 'novgorod', blue: 'teutonic' } };

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
    if (s && typeof s.budget === 'number' && s.v !== 5 && s.options && (s.options.runLimit === 3 || s.options.runLimit === 4)) s.options.runLimit = 6;
    if (s && typeof s.budget === 'number') return { ...DEFAULT_SETTINGS, ...s, options: { ...DADS_RULES, ...s.options }, sides: { red: known(s.sides?.red, 'novgorod'), blue: known(s.sides?.blue, 'teutonic') } };
  } catch {
    /* fall through to the defaults */
  }
  return structuredClone(DEFAULT_SETTINGS);
}

/** "No luck" points each turn. */
export const fixedPoints = (_s: Settings) => 10;

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, v: 5 }));
  } catch {
    /* keep them for this visit only */
  }
}

// Each map keeps the board size; only the river, bridges and woods change.
const ORIGINAL = structuredClone(CONFIG.board);

/** Mirror a list of Novgorod-side forest hexes onto the Teutonic side. */
const mirrored = (half: [number, number][]): [number, number][] => [...half, ...half.map(([c, r]) => [CONFIG.board.cols - 1 - c, r] as [number, number])];

export function boardFor(map: MapId): GameConfig['board'] {
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
    case 'random': {
      // A fair random map: woods placed at random on one side and mirrored on the other.
      const half: [number, number][] = [];
      const clusters = 4 + Math.floor(Math.random() * 4);
      for (let i = 0; i < clusters; i++) {
        const c = 6 + Math.floor(Math.random() * (mid - 6));
        const r = Math.floor(Math.random() * rows);
        half.push([c, r]);
        if (Math.random() < 0.7) half.push([c + (Math.random() < 0.5 ? 1 : 0), Math.min(rows - 1, r + 1)]);
      }
      const river = Math.random() < 0.75;
      const bridges = river ? [...new Set([2 + Math.floor(Math.random() * 4), rows - 3 - Math.floor(Math.random() * 4), ...(Math.random() < 0.5 ? [Math.floor(rows / 2)] : [])])] : [];
      return { cols, rows, riverCol: river ? mid : null, bridgeRows: bridges, forests: mirrored(half) };
    }
  }
  return structuredClone(ORIGINAL);
}

/** Puts the settings into the game's rules. Call before starting or loading a battle. */
export function applySettings(s: Settings) {
  CONFIG.army.budget = s.budget;
  CONFIG.board = boardFor(s.map);
  CONFIG.dice =
    s.dice === 'fixed' ? { count: 0, sides: 6, fixed: fixedPoints(s) }
    : s.dice === '1d6' ? { count: 1, sides: 6, fixed: null }
    : s.dice === '2d6' ? { count: 2, sides: 6, fixed: null }
    : { count: 3, sides: 6, fixed: null };
  CONFIG.options = { ...s.options };
  setSides(s.sides ?? DEFAULT_SETTINGS.sides);
  s.sides = { ...sides };
}
