// Side colours: the ring under each piece (and a few side-coloured bits of the page) says "yours" or "the enemy",
// whatever the two armies' own paint is. Two armies can share a colour (Vikings and Mongols are both blue), so by
// default the rings use a per-battle pair picked to stand apart from each other AND from both armies' paint:
// yours bright (gold, or ivory when an army is gold itself) and solid, the enemy's darker and dashed, so the two also
// differ in brightness and pattern for colour-blind players. The army's own colour stays in its emblems and counters.
// Setting "Side colours": Mine vs enemy (default) or Army colours (the old look).

import type { Player } from '../engine';
import { FACTIONS, sides } from './factions';

export type SideMode = 'mine' | 'army';
const KEY = 'boc-sidecols';

export let sideMode: SideMode = (() => {
  try {
    return localStorage.getItem(KEY) === 'army' ? 'army' : 'mine';
  } catch {
    return 'mine';
  }
})();

export function setSideMode(m: SideMode) {
  sideMode = m;
  try {
    localStorage.setItem(KEY, m);
  } catch { /* private window: this visit only */ }
}

/** Whose pieces count as "yours" right now (null = nobody's: army colours). Set by the game on every draw. */
let mine: Player | null = null;
export function setMine(p: Player | null) {
  mine = p;
}
export const mineSide = () => mine;

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** "Redmean" colour distance: cheap and close enough to how far apart two colours look. */
export function colorGap(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  const rm = (r1 + r2) / 2;
  const [dr, dg, db] = [r1 - r2, g1 - g2, b1 - b2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/** Yours: light and warm. The enemy: strong and darker. Tried in order; the first far enough from both armies wins. */
const MINE = ['#f6c845', '#f4ecd8'];
const FOE = ['#e2362c', '#d2369c', '#9455ea'];
const FAR = 150;

function pick(list: string[], avoid: string[]): string {
  let best = list[0];
  let bestGap = -1;
  for (const c of list) {
    const gap = Math.min(...avoid.map((a) => colorGap(c, a)));
    if (gap >= FAR) return c;
    if (gap > bestGap) [best, bestGap] = [c, gap];
  }
  return best;
}

let pairFor = '';
let pair: { mine: string; foe: string } = { mine: MINE[0], foe: FOE[0] };
/** The two ring colours for this battle's armies. */
export function sidePair(): { mine: string; foe: string } {
  const key = `${sides.red}/${sides.blue}`;
  if (key !== pairFor) {
    pairFor = key;
    const paint = [FACTIONS[sides.red].color, FACTIONS[sides.blue].color];
    const m = pick(MINE, paint);
    pair = { mine: m, foe: pick(FOE, [...paint, m]) };
  }
  return pair;
}

/** Side colours are in use (the setting is on and somebody's pieces are "yours"). */
export const sideColorsOn = () => sideMode === 'mine' && mine !== null;

/** The ring colour for a side's pieces: yours or the enemy's, or the army's own colour when side colours are off. */
export function sideColor(p: Player): string {
  if (!sideColorsOn()) return FACTIONS[sides[p]].color;
  return p === mine ? sidePair().mine : sidePair().foe;
}

/** The enemy's ring is dashed (pattern, not only colour, tells the sides apart). */
export const sideDashed = (p: Player) => sideColorsOn() && p !== mine;

/** Page colours for the side-coloured bits of the interface (--side-red / --side-blue / --side-mine / --side-foe). */
export function paintSideVars() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--side-red', sideColor('red'));
  root.setProperty('--side-blue', sideColor('blue'));
  const { mine: m, foe } = sideColorsOn() ? sidePair() : { mine: FACTIONS[sides.red].color, foe: FACTIONS[sides.blue].color };
  root.setProperty('--side-mine', m);
  root.setProperty('--side-foe', foe);
}
