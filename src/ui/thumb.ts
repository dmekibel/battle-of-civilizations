import type { GameConfig } from '../config';

/** A little board for the map menu: every hex drawn as a real hex, coloured by its ground, on a wooden frame. */
export function boardThumb(b: GameConfig['board']): string {
  const R = 10, H = Math.sqrt(3) * R, PAD = 7;
  const w = (1.5 * b.cols + 0.5) * R + PAD * 2, h = H * (b.rows + 0.5) + PAD * 2;
  const kind = new Map<string, string>();
  const put = (list: [number, number][] | undefined, k: string) => (list ?? []).forEach(([c, r]) => kind.set(`${c},${r}`, k));
  put(b.forests, 'forest'); put(b.hills, 'hill'); put(b.swamps, 'swamp'); put(b.lakes, 'lake'); put(b.boulders, 'rock');
  put(b.houses, 'house'); put(b.walls, 'wall'); put(b.towers, 'tower'); put(b.gates?.map((g) => [g.col, g.row] as [number, number]), 'gate');
  const rivers = [...(b.riverCol === null ? [] : [{ col: b.riverCol, bridges: b.bridgeRows, fords: b.fordRows ?? [] }]), ...(b.rivers ?? [])];
  for (const rv of rivers) for (let r = 0; r < b.rows; r++) kind.set(`${rv.col},${r}`, rv.bridges.includes(r) ? 'bridge' : rv.fords.includes(r) ? 'ford' : 'water');
  const FILL: Record<string, string> = { forest: '#2f5522', hill: '#c2c27a', swamp: '#5f6d3e', lake: '#4d87b8', water: '#4d87b8', ford: '#a9c3c9', bridge: '#9a6a3a', rock: '#a29d92', house: '#b5552f', wall: '#d2cdc2', tower: '#ebe7dd', gate: '#8a6a44' };
  let cells = '', marks = '';
  for (let c = 0; c < b.cols; c++) for (let r = 0; r < b.rows; r++) {
    const cx = PAD + R + c * 1.5 * R, cy = PAD + H / 2 + r * H + ((c & 1) * H) / 2;
    const k = kind.get(`${c},${r}`);
    const pts = [0, 1, 2, 3, 4, 5].map((i) => `${(cx + R * Math.cos((Math.PI / 3) * i)).toFixed(1)},${(cy + R * Math.sin((Math.PI / 3) * i)).toFixed(1)}`).join(' ');
    const meadow = '#8db05a';
    const f = k ? FILL[k] : meadow;
    cells += `<polygon points="${pts}" fill="${f}" stroke="${f}"/>`;
    if (k === 'hill') marks += `<path d="M${cx - 6},${cy + 3}Q${cx},${cy - 6} ${cx + 6},${cy + 3}" fill="none" stroke="#7d8a45" stroke-width="1.6"/>`;
  }
  return `<svg viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" width="72" height="${((72 * h) / w).toFixed(0)}" aria-hidden="true"><rect width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="#5a3a22"/><g stroke-width="1" stroke-linejoin="round">${cells}</g>${marks}</svg>`;
}
