// Battle settings chosen on the "New battle" screen: army size, map, how points come each
// turn, and which optional rules are on. They are applied to the game's rules before a battle
// starts and saved with it, so a reloaded game keeps its own settings.

import { CONFIG, type GameConfig } from '../config';

export type MapId = 'river' | 'open' | 'forest' | 'random';
export type DiceId = '3d6' | '2d6' | 'fixed';

export interface Settings {
  budget: number;
  map: MapId;
  dice: DiceId;
  options: GameConfig['options'];
}

/** Dad's rules exactly: nothing optional switched on. */
export const DADS_RULES: GameConfig['options'] = { ...CONFIG.options };

/** The set the simulation suggested: shorter battles, heavy infantry with a job, archers in check. */
export const RECOMMENDED: GameConfig['options'] = {
  ...CONFIG.options,
  firstTurnBonus: 2,
  carryMax: 3,
  routAt: 0.5,
  shieldWall: true,
  spears: true,
  longShotFrom: 3,
  charge: true,
};

export const DEFAULT_SETTINGS: Settings = { budget: 50, map: 'river', dice: '3d6', options: { ...DADS_RULES } };

const KEY = 'boc-settings';

export function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (s && typeof s.budget === 'number') return { ...DEFAULT_SETTINGS, ...s, options: { ...DADS_RULES, ...s.options } };
  } catch {
    /* fall through to the defaults */
  }
  return structuredClone(DEFAULT_SETTINGS);
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* keep them for this visit only */
  }
}

// Each map keeps the board size; only the river, bridges and woods change.
const ORIGINAL = structuredClone(CONFIG.board);

/** Mirror a list of Novgorod-side forest hexes onto the Teutonic side. */
const mirrored = (half: [number, number][]): [number, number][] => [...half, ...half.map(([c, r]) => [CONFIG.board.cols - 1 - c, r] as [number, number])];

function boardFor(map: MapId): GameConfig['board'] {
  const { cols, rows } = ORIGINAL;
  const mid = Math.floor(cols / 2);
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
}

/** Puts the settings into the game's rules. Call before starting or loading a battle. */
export function applySettings(s: Settings) {
  CONFIG.army.budget = s.budget;
  CONFIG.board = boardFor(s.map);
  CONFIG.dice = s.dice === 'fixed' ? { count: 0, sides: 6, fixed: 10 } : s.dice === '2d6' ? { count: 2, sides: 6, fixed: null } : { count: 3, sides: 6, fixed: null };
  CONFIG.options = { ...s.options };
}
