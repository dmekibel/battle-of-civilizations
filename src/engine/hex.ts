// Flat-top hexes in "odd-q" offset layout: columns are straight vertical lines and
// odd columns sit half a hex lower. Distance and lines use cube coordinates.

export interface Hex {
  col: number;
  row: number;
}

interface Cube {
  x: number;
  y: number;
  z: number;
}

const parity = (n: number) => ((n % 2) + 2) % 2;

export function toCube({ col, row }: Hex): Cube {
  const x = col;
  const z = row - (col - parity(col)) / 2;
  return { x, y: -x - z, z };
}

export function fromCube({ x, z }: Cube): Hex {
  return { col: x, row: z + (x - parity(x)) / 2 };
}

export const key = (h: Hex) => `${h.col},${h.row}`;

export const sameHex = (a: Hex, b: Hex) => a.col === b.col && a.row === b.row;

export function distance(a: Hex, b: Hex): number {
  const p = toCube(a);
  const q = toCube(b);
  return (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + Math.abs(p.z - q.z)) / 2;
}

const DIRS: [number, number][] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

/** All six neighbours, including ones off the board. */
export function neighbors(h: Hex): Hex[] {
  const c = toCube(h);
  return DIRS.map(([dx, dz]) => fromCube({ x: c.x + dx, y: 0, z: c.z + dz }));
}

function roundCube(x: number, y: number, z: number): Cube {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

/** Hexes strictly between a and b on the straight line joining their centres. */
export function between(a: Hex, b: Hex): Hex[] {
  const n = distance(a, b);
  const p = toCube(a);
  const q = toCube(b);
  // A tiny nudge keeps the line from running exactly along hex edges.
  const e = 1e-6;
  const out: Hex[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    out.push(
      fromCube(
        roundCube(
          p.x + e + (q.x - p.x) * t,
          p.y + e + (q.y - p.y) * t,
          p.z - 2 * e + (q.z - p.z) * t,
        ),
      ),
    );
  }
  return out;
}
