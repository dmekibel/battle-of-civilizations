// Random maps: a seeded generator that lays out woods, lakes, rivers, villages and boulder fields from smooth noise,
// the way Minecraft grows a landscape from height and moisture. Same seed and style = the same map, on every phone.
// Only one half is generated; the other is its mirror image (col -> cols - 1 - col), so neither army has the better side.
// Rivers stay straight columns: the river, bridge and ford pictures are painted for that, and they look hand-made.

import type { GameConfig } from '../config';
import { key, neighbors, type Hex } from './hex';

export type MapStyle = 'valley' | 'forest' | 'lakes' | 'plains' | 'hamlets';
export const MAP_STYLES: MapStyle[] = ['valley', 'forest', 'lakes', 'plains', 'hamlets'];
export type BoardSize = 'standard' | 'large';
type Board = GameConfig['board'];

interface StyleWeights {
  /** Chance of no river, one river down the middle, or two rivers (one in each half). */
  rivers: [none: number, one: number, two: number];
  /** Share of the open middle ground that grows woods. */
  forest: number;
  /** How fine the woods are: higher = more, smaller copses. */
  grain: number;
  /** Lanes cut through the woods from each edge to the middle. */
  lanes: number;
  /** Lakes in each half, and their size in hexes. */
  lakes: [number, number];
  lakeSize: [number, number];
  /** Villages in each half. */
  villages: [number, number];
  /** Boulder fields in each half. */
  boulders: [number, number];
  /** River crossings, and the share of them that are fords instead of bridges. */
  crossings: [number, number];
  fords: number;
}

const STYLES: Record<MapStyle, StyleWeights> = {
  // Meadow, a river, a few copses.
  valley: { rivers: [0, 0.85, 0.15], forest: 0.13, grain: 0.24, lanes: 0, lakes: [0, 1], lakeSize: [2, 4], villages: [0, 0], boulders: [1, 2], crossings: [2, 3], fords: 0.35 },
  // Lots of woods with narrow lanes through them.
  forest: { rivers: [0.5, 0.5, 0], forest: 0.5, grain: 0.42, lanes: 3, lakes: [0, 0], lakeSize: [0, 0], villages: [0, 0], boulders: [0, 1], crossings: [3, 3], fords: 0.3 },
  // Several lakes; no river, or one.
  lakes: { rivers: [0.6, 0.4, 0], forest: 0.1, grain: 0.27, lanes: 0, lakes: [2, 3], lakeSize: [4, 8], villages: [0, 0], boulders: [0, 1], crossings: [2, 3], fords: 0.3 },
  // Few obstacles, boulders.
  plains: { rivers: [0.75, 0.25, 0], forest: 0.05, grain: 0.3, lanes: 0, lakes: [0, 0], lakeSize: [0, 0], villages: [0, 0], boulders: [3, 5], crossings: [3, 4], fords: 0.6 },
  // Scattered houses, copses and a river.
  hamlets: { rivers: [0, 1, 0], forest: 0.11, grain: 0.27, lanes: 0, lakes: [0, 0], lakeSize: [0, 0], villages: [1, 2], boulders: [1, 2], crossings: [2, 3], fords: 0.3 },
};

// ---------- seeded randomness and smooth noise ----------

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Value noise: random heights on a grid, smoothly blended between grid points (0..1). */
function valueNoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = hash2(seed, xi, yi);
  const b = hash2(seed, xi + 1, yi);
  const c = hash2(seed, xi, yi + 1);
  const d = hash2(seed, xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Layered noise: big shapes with smaller detail on top (0..1). */
function fbm(seed: number, x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(seed + i * 1013, x * f, y * f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** A hex's centre in hex widths, so the noise is round, not stretched along columns. */
const centreOf = (c: number, r: number): [number, number] => [c * 0.866, r + 0.5 * (c & 1)];

const styleSalt = (s: MapStyle) => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);

// ---------- the generator ----------

type Cell = 'plain' | 'forest' | 'river' | 'bridge' | 'ford' | 'lake' | 'house';

/** Deploy depth for a board size (the same as applySettings uses). */
export const deployDepth = (size: BoardSize) => (size === 'large' ? 7 : 5);

/** A fair random map: one half generated from the seed, the other half its mirror image.
 *  If a roll leaves some deploy hex cut off from the enemy side, the next seed is tried. */
export function generateMap(seed: number, style: MapStyle, size: BoardSize = 'standard'): Board {
  for (let i = 0; i < 40; i++) {
    const b = attempt((seed + i) >>> 0, style, size);
    if (b) return b;
  }
  // Practically unreachable: an open field always works.
  return attempt(seed >>> 0, 'plains', size, true)!;
}

function attempt(seed: number, style: MapStyle, size: BoardSize, bare = false): Board | null {
  const [cols, rows] = size === 'large' ? [33, 19] : [25, 15];
  const mid = (cols - 1) / 2;
  const depth = deployDepth(size);
  const W = STYLES[style];
  const rng = mulberry(seed ^ styleSalt(style));
  const between = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const ns = (seed * 7919) ^ styleSalt(style);
  // Larger boards get slightly larger features, so they read the same.
  const zoom = size === 'large' ? 0.8 : 1;
  const height = (c: number, r: number) => fbm(ns + 11, centreOf(c, r)[0] * 0.18 * zoom, centreOf(c, r)[1] * 0.18 * zoom, 3);
  const moist = (c: number, r: number) => fbm(ns + 23, centreOf(c, r)[0] * 0.22 * zoom, centreOf(c, r)[1] * 0.22 * zoom, 3);
  const leafy = (c: number, r: number) => fbm(ns + 37, centreOf(c, r)[0] * W.grain * zoom, centreOf(c, r)[1] * W.grain * zoom, 2);

  // Only the left half (and the middle column) is generated.
  const grid: Cell[][] = Array.from({ length: mid + 1 }, () => Array<Cell>(rows).fill('plain'));
  const inHalf = (h: Hex) => h.col >= 0 && h.col <= mid && h.row >= 0 && h.row < rows;
  const at = (h: Hex) => grid[h.col][h.row];
  const set = (h: Hex, t: Cell) => (grid[h.col][h.row] = t);
  /** Neighbours in the generated half; across the middle the mirror image stands in. */
  const near = (h: Hex) => neighbors(h).map((n) => (n.col > mid ? { col: cols - 1 - n.col, row: n.row } : n)).filter(inHalf);
  const ring = (h: Hex, d: number) => {
    const seen = new Set([key(h)]);
    let edge = [h];
    for (let i = 0; i < d; i++) {
      const next: Hex[] = [];
      for (const e of edge) for (const n of near(e)) if (!seen.has(key(n))) (seen.add(key(n)), next.push(n));
      edge = next;
    }
    return [...seen].map((k) => ({ col: +k.split(',')[0], row: +k.split(',')[1] }));
  };
  /** Open middle ground: outside both deploy zones. */
  const field = (h: Hex) => h.col >= depth;
  const all: Hex[] = [];
  for (let c = 0; c <= mid; c++) for (let r = 0; r < rows; r++) all.push({ col: c, row: r });

  // 1. Rivers: down the middle, or one in each half on the lowest ground.
  const roll = rng();
  const nRivers = bare ? 0 : roll < W.rivers[0] ? 0 : roll < W.rivers[0] + W.rivers[1] ? 1 : 2;
  let riverCol: number | null = null;
  if (nRivers === 1) riverCol = mid;
  if (nRivers === 2) {
    let best = Infinity;
    for (let c = depth + 2; c <= mid - 3; c++) {
      let sum = 0;
      for (let r = 0; r < rows; r++) sum += height(c, r);
      sum += rng() * 0.6;
      if (sum < best) [best, riverCol] = [sum, c];
    }
  }
  const crossings: Hex[] = [];
  const fordRows: number[] = [];
  const bridgeRows: number[] = [];
  if (riverCol !== null) {
    for (let r = 0; r < rows; r++) set({ col: riverCol, row: r }, 'river');
    // Spread the crossings out: one in each band of rows, at least 3 rows apart, never on the board's edge row.
    // The large board's longer river gets one crossing more.
    const k = between(W.crossings[0], W.crossings[1]) + (size === 'large' ? 1 : 0);
    const band = (rows - 2) / k;
    let last = -10;
    for (let i = 0; i < k; i++) {
      const lo = Math.max(1 + Math.floor(i * band), last + 3);
      const hi = Math.min(rows - 2, Math.floor((i + 1) * band));
      if (lo > hi) continue;
      // The higher ground in the band makes the crossing: shallows and good footing.
      let row = lo;
      let bestH = -Infinity;
      for (let r = lo; r <= hi; r++) {
        const h = height(riverCol, r) + rng() * 0.25;
        if (h > bestH) [bestH, row] = [h, r];
      }
      last = row;
      const ford = rng() < W.fords;
      set({ col: riverCol, row }, ford ? 'ford' : 'bridge');
      (ford ? fordRows : bridgeRows).push(row);
      crossings.push({ col: riverCol, row });
    }
    // At least two crossings, and always at least one bridge (all fords is a slog): the middle one becomes a bridge.
    if (crossings.length < 2) return null;
    if (bridgeRows.length === 0) {
      const f = fordRows.splice(Math.floor(fordRows.length / 2), 1)[0];
      bridgeRows.push(f);
      set({ col: riverCol, row: f }, 'bridge');
    }
  }
  const riverAt = (h: Hex) => at(h) === 'river' || at(h) === 'bridge' || at(h) === 'ford';
  const nearRiver = (h: Hex, d: number) => riverCol !== null && Math.abs(h.col - riverCol) <= d;
  /** Hexes kept open: the banks at each crossing, so a crossing never leads into trees or water. */
  const keepOpen = new Set<string>();
  for (const x of crossings) for (const h of ring(x, 2)) if (Math.abs(h.row - x.row) <= 1 || h.col === x.col) keepOpen.add(key(h));

  // 2. Lakes: where the ground is wet, grown out from a centre into a rounded pond.
  const lakeCount = bare ? 0 : between(W.lakes[0], W.lakes[1]);
  const lakeCentres: Hex[] = [];
  for (let i = 0; i < lakeCount; i++) {
    const options = all.filter((h) => h.col >= depth + 1 && h.row >= 2 && h.row <= rows - 3 && !nearRiver(h, 3) && at(h) === 'plain' && lakeCentres.every((o) => hexDist(o, h) >= 5));
    if (!options.length) break;
    options.sort((a, b) => moist(b.col, b.row) - moist(a.col, a.row));
    const centre = options[Math.floor(rng() * Math.min(6, options.length))];
    lakeCentres.push(centre);
    const target = between(W.lakeSize[0], W.lakeSize[1]);
    const lake = [centre];
    const inLake = new Set([key(centre)]);
    set(centre, 'lake');
    while (lake.length < target) {
      // Grow into the neighbour that touches the most lake already (round shapes), wetter ground first.
      let best: Hex | null = null;
      let bestScore = -Infinity;
      for (const h of lake)
        for (const n of near(h)) {
          if (inLake.has(key(n)) || at(n) !== 'plain' || n.col < depth + 1 || n.row < 2 || n.row > rows - 3 || nearRiver(n, 2) || keepOpen.has(key(n))) continue;
          const touching = near(n).filter((m) => inLake.has(key(m))).length;
          const score = touching * 2 + moist(n.col, n.row) + rng() * 0.4;
          if (score > bestScore) [best, bestScore] = [n, score];
        }
      if (!best) break;
      lake.push(best);
      inLake.add(key(best));
      set(best, 'lake');
    }
  }
  // Fill bays: open ground mostly ringed by water becomes water, so lakes stay round instead of horseshoes.
  for (let pass = 0; pass < 2; pass++)
    for (const h of all)
      if (at(h) === 'plain' && h.col >= depth + 1 && h.row >= 2 && h.row <= rows - 3 && !keepOpen.has(key(h)) && !nearRiver(h, 2) && near(h).filter((n) => at(n) === 'lake').length >= 3) set(h, 'lake');

  // 3. Woods: the leafiest part of the open ground, so trees gather into copses instead of salt and pepper.
  // Woods thin out right at the deploy line, so the armies don't set up against a wall of trees.
  const wooded = (h: Hex) => leafy(h.col, h.row) * 0.75 + moist(h.col, h.row) * 0.25 - (h.col === depth ? 0.12 : 0);
  const room = all.filter((h) => field(h) && at(h) === 'plain' && !keepOpen.has(key(h)));
  if (!bare && W.forest > 0) {
    // Ranked within three bands of rows, so the woods spread over the whole field instead of piling up at one end.
    // The leafiest hexes start the copses; each copse then grows into the neighbour that touches it most, so woods
    // come out as rounded clumps rather than thin lines of trees.
    for (let band = 0; band < 3; band++) {
      const inBand = room.filter((h) => Math.floor((h.row * 3) / rows) === band).sort((a, b) => wooded(b) - wooded(a));
      const want = Math.round(inBand.length * W.forest);
      // (Deep forest is dense enough already: growing would merge it into one block, so it keeps the plain ranking.)
      const seeds = Math.ceil(want * (W.forest >= 0.3 ? 1 : 0.35));
      for (const h of inBand.slice(0, seeds)) set(h, 'forest');
      for (let have = seeds; have < want; have++) {
        let best: Hex | null = null;
        let bestScore = -Infinity;
        for (const h of inBand) {
          if (at(h) !== 'plain') continue;
          const touching = near(h).filter((m) => at(m) === 'forest').length;
          if (!touching) continue;
          const score = touching * 0.35 + wooded(h);
          if (score > bestScore) [best, bestScore] = [h, score];
        }
        if (!best) break;
        set(best, 'forest');
      }
    }

    // Tidy: fill gaps inside a wood, thin out lone trees (keep some, they read as single copses).
    for (const h of room) {
      const n = near(h).filter((m) => at(m) === 'forest').length;
      if (at(h) === 'plain' && n >= 5) set(h, 'forest');
      else if (at(h) === 'forest' && n === 0 && rng() < 0.6) set(h, 'plain');
    }
  }
  // Deep forest: cut winding lanes from the deploy zone to the middle, so the woods are a maze with ways through.
  for (let i = 0; i < (bare ? 0 : W.lanes); i++) {
    const startRow = Math.round(((i + 0.5) * rows) / W.lanes + (rng() - 0.5) * 2);
    const path = lane({ col: depth - 1, row: Math.max(0, Math.min(rows - 1, startRow)) }, (h) => h.col === mid && at(h) !== 'river', near, at, (h) => wooded(h) * 3 + rng() * 0.5);
    for (const h of path) if (at(h) === 'forest') set(h, 'plain');
  }

  // 4. Villages: a few houses around a green, with gaps between them to walk through.
  const villages = bare ? 0 : between(W.villages[0], W.villages[1]);
  const houses: Hex[] = [];
  const greens: Hex[] = [];
  for (let i = 0; i < villages; i++) {
    const options = all.filter((h) => h.col >= depth + 2 && h.col <= mid - 1 && h.row >= 2 && h.row <= rows - 3 && at(h) !== 'lake' && !riverAt(h) && !nearRiver(h, 2) && !keepOpen.has(key(h)) && greens.every((g) => hexDist(g, h) >= 6));
    if (!options.length) break;
    const green = options[Math.floor(rng() * options.length)];
    greens.push(green);
    // The houses stand on the second ring around the green, never next to each other.
    const spots = ring(green, 2).filter((h) => hexDist(h, green) === 2 && field(h) && h.col < mid && h.row >= 1 && h.row <= rows - 2 && !riverAt(h) && at(h) !== 'lake' && !keepOpen.has(key(h)));
    const want = between(3, 4);
    for (const h of shuffle(spots, rng)) {
      if (houses.filter((x) => hexDist(x, green) <= 2).length >= want) break;
      if (houses.some((x) => hexDist(x, h) < 2)) continue;
      set(h, 'house');
      houses.push(h);
    }
    // The green and the lanes between the houses are open.
    for (const h of ring(green, 1)) if (at(h) === 'forest') set(h, 'plain');
  }

  // 5. Pockets of open ground nobody can walk to: a bigger one (or one holding a crossing) gets a lane cut to it
  //    through the trees, a tiny one is filled in (it would look like a mistake).
  const passable = (t: Cell) => t === 'plain' || t === 'bridge' || t === 'ford';
  for (let pass = 0; pass < 12; pass++) {
    const reach = new Set<string>();
    const todo: Hex[] = [];
    for (let r = 0; r < rows; r++) if (passable(grid[0][r])) (reach.add(key({ col: 0, row: r })), todo.push({ col: 0, row: r }));
    while (todo.length) {
      const h = todo.pop()!;
      for (const n of near(h)) if (!reach.has(key(n)) && passable(at(n))) (reach.add(key(n)), todo.push(n));
    }
    const lost = all.find((h) => passable(at(h)) && !reach.has(key(h)));
    if (!lost) break;
    const pocket = [lost];
    const inPocket = new Set([key(lost)]);
    for (let i = 0; i < pocket.length; i++) for (const n of near(pocket[i])) if (!inPocket.has(key(n)) && passable(at(n))) (inPocket.add(key(n)), pocket.push(n));
    const crossing = pocket.some((h) => at(h) !== 'plain');
    if (crossing || pocket.length >= 3) {
      const path = lane(lost, (h) => reach.has(key(h)), near, at, (h) => wooded(h) * 3);
      if (!path.length) return null;
      for (const h of path) if (at(h) === 'forest') set(h, 'plain');
    } else for (const h of pocket) set(h, near(h).some((n) => at(n) === 'lake') ? 'lake' : 'forest');
  }

  // 6. Boulder fields: scenery only, a few hexes of stones on open ground.
  const boulders: Hex[] = [];
  const fields = between(W.boulders[0], W.boulders[1]);
  for (let i = 0; i < fields; i++) {
    const options = all.filter((h) => h.col >= 3 && h.col < mid && at(h) === 'plain' && !keepOpen.has(key(h)) && boulders.every((b) => hexDist(b, h) >= 4));
    if (!options.length) break;
    const c = options[Math.floor(rng() * options.length)];
    const group = [c, ...shuffle(near(c).filter((h) => at(h) === 'plain' && h.col < mid && !keepOpen.has(key(h))), rng).slice(0, between(1, 2))];
    boulders.push(...group);
  }
  // A village has a stone or two on its green.
  for (const g of greens) if (at(g) === 'plain' && !boulders.some((b) => key(b) === key(g))) boulders.push(g);

  // 7. Mirror onto the other half and check every deploy hex can reach the enemy.
  const full: Cell[][] = Array.from({ length: cols }, (_, c) => [...grid[c <= mid ? c : cols - 1 - c]]);
  if (!fair(full, cols, rows, depth)) return null;
  const list = (t: Cell) => {
    const out: [number, number][] = [];
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) if (full[c][r] === t) out.push([c, r]);
    return out;
  };
  const stones = boulders.filter((h) => at(h) === 'plain').flatMap((h) => (h.col === mid ? [[h.col, h.row]] : [[h.col, h.row], [cols - 1 - h.col, h.row]]) as [number, number][]);
  const riverCols = riverCol === null ? [] : riverCol === mid ? [mid] : [riverCol, cols - 1 - riverCol];
  return {
    cols,
    rows,
    riverCol: null,
    bridgeRows: [],
    fordRows: [],
    rivers: riverCols.map((col) => ({ col, bridges: [...bridgeRows].sort((a, b) => a - b), fords: [...fordRows].sort((a, b) => a - b) })),
    forests: list('forest'),
    lakes: list('lake'),
    houses: list('house'),
    boulders: stones,
  };
}

function hexDist(a: Hex, b: Hex): number {
  const ac = { x: a.col, z: a.row - (a.col - (a.col & 1)) / 2 };
  const bc = { x: b.col, z: b.row - (b.col - (b.col & 1)) / 2 };
  return (Math.abs(ac.x - bc.x) + Math.abs(ac.z - bc.z) + Math.abs(-ac.x - ac.z + bc.x + bc.z)) / 2;
}

function shuffle<T>(xs: T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** The cheapest walk from `from` to a hex where `done` holds, where trees cost more and rivers can be crossed only at a crossing. */
function lane(from: Hex, done: (h: Hex) => boolean, near: (h: Hex) => Hex[], at: (h: Hex) => Cell, treeCost: (h: Hex) => number): Hex[] {
  const dist = new Map<string, number>([[key(from), 0]]);
  const prev = new Map<string, Hex>();
  const open: [number, Hex][] = [[0, from]];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [d, h] = open.shift()!;
    if (d > (dist.get(key(h)) ?? Infinity)) continue;
    if (done(h)) {
      const path: Hex[] = [];
      for (let x: Hex | undefined = h; x; x = prev.get(key(x))) path.push(x);
      return path;
    }
    for (const n of near(h)) {
      const t = at(n);
      if (t === 'river' || t === 'lake' || t === 'house') continue;
      const step = 1 + (t === 'forest' ? 2 + treeCost(n) : 0);
      if (d + step < (dist.get(key(n)) ?? Infinity)) {
        dist.set(key(n), d + step);
        prev.set(key(n), h);
        open.push([d + step, n]);
      }
    }
  }
  return [];
}

/** Every open hex of each deploy zone can walk to the enemy's deploy zone, and each zone has room for an army. */
function fair(full: Cell[][], cols: number, rows: number, depth: number): boolean {
  const passable = (t: Cell) => t === 'plain' || t === 'bridge' || t === 'ford';
  const inB = (h: Hex) => h.col >= 0 && h.col < cols && h.row >= 0 && h.row < rows;
  // Flood from one corner of Red's zone: the whole of both zones must be reached.
  if (!passable(full[0][0])) return false;
  const seen = new Set<string>([key({ col: 0, row: 0 })]);
  const todo: Hex[] = [{ col: 0, row: 0 }];
  while (todo.length) {
    const h = todo.pop()!;
    for (const n of neighbors(h)) if (inB(n) && !seen.has(key(n)) && passable(full[n.col][n.row])) (seen.add(key(n)), todo.push(n));
  }
  let room = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const zone = c < depth || c >= cols - depth;
      if (!zone) continue;
      if (!passable(full[c][r])) return false; // deploy zones stay clear
      if (!seen.has(key({ col: c, row: r }))) return false;
      room++;
    }
  return room >= 2 * depth * rows;
}
