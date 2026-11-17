// Map previews for the menu: the real board shrunk. The same painted meadow, the river, bridge and ford pictures,
// painted lakes, carved trees, houses and boulders, raised hills with their step and shadow as in the flat view, and
// the table's wood showing round the edge as a thin frame. Each preview is painted once onto a small canvas and
// kept as a picture (by map, seed, knobs and size), so opening the menu again costs nothing.

import type { GameConfig } from '../config';
import { neighbors } from '../engine';
import { GROUND_M, groundUrlFor, lakePart, PART, raisedHills, SC_URL, SCENERY, TREE_KINDS, TREE_URL } from './board';

type Board = GameConfig['board'];
type Pt = [number, number];
const S = 34;
const R3 = Math.sqrt(3);
/** Wood showing round the field, in map units (the field itself reaches 16 past the outer hexes). */
const FRAME = 26;

const geo = (b: Pick<Board, 'cols' | 'rows'>) => {
  const W = S * 1.5 * (b.cols - 1) + 2 * S;
  const H = R3 * S * (b.rows + 0.5);
  return { W, H, x0: GROUND_M - FRAME, y0: GROUND_M - FRAME, w: W + 2 * FRAME, h: H + 2 * FRAME };
};
/** A hex's centre in the ground picture's units. */
const centre = (c: number, r: number): Pt => [S * 1.5 * c + S + GROUND_M, R3 * S * (r + 0.5 * (c & 1)) + (R3 / 2) * S + GROUND_M];
const hexSeed = (c: number, r: number) => (c * 73 + r * 151 + ((c * r) % 7) * 31) % 97;

/** Width over height of a preview of this board (to size the placeholder while it paints). */
export function thumbAspect(b: Pick<Board, 'cols' | 'rows'>): number {
  const g = geo(b);
  return g.w / g.h;
}

// ---------- pictures ----------
const pics = new Map<string, Promise<HTMLImageElement | null>>();
function load(url: string): Promise<HTMLImageElement | null> {
  let p = pics.get(url);
  if (!p) {
    p = new Promise((ok) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => ok(im);
      im.onerror = () => ok(null);
      im.src = url;
    });
    pics.set(url, p);
  }
  return p;
}
/** The big ground painting, scaled down once per board size (drawing a 2864 px picture 14 times would stutter). */
const smallGround = new Map<boolean, Promise<HTMLCanvasElement | null>>();
function ground(large: boolean): Promise<HTMLCanvasElement | null> {
  let p = smallGround.get(large);
  if (!p) {
    p = load(groundUrlFor(large)).then((im) => {
      if (!im) return null;
      const cv = document.createElement('canvas');
      cv.width = Math.round(im.naturalWidth / 3);
      cv.height = Math.round(im.naturalHeight / 3);
      const ctx = cv.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(im, 0, 0, cv.width, cv.height);
      return cv;
    });
    smallGround.set(large, p);
  }
  return p;
}

// ---------- painting ----------
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

/** A finished preview picture for this key, if it has been painted. */
export const cachedThumb = (key: string) => cache.get(key);

/** Paints the preview (once per key) and resolves to a picture URL. `px` is the picture's width in pixels. */
export function paintThumb(key: string, b: Board, px: number): Promise<string | null> {
  const done = cache.get(key);
  if (done) return Promise.resolve(done);
  let p = pending.get(key);
  if (!p) {
    p = paint(b, px).then((url) => {
      if (url) cache.set(key, url);
      pending.delete(key);
      return url;
    });
    pending.set(key, p);
  }
  return p;
}

async function paint(b: Board, px: number): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const large = b.cols > 25;
  const g = geo(b);
  const k = px / g.w; // pixels per map unit
  const cv = document.createElement('canvas');
  cv.width = Math.round(g.w * k);
  cv.height = Math.round(g.h * k);
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  const gr = await ground(large);
  if (!gr) return null;
  const gscale = gr.width / (g.W + 2 * GROUND_M); // small ground pixels per unit
  // Everything below is drawn in the ground picture's units.
  ctx.setTransform(k, 0, 0, k, -g.x0 * k, -g.y0 * k);
  const drawGround = () => ctx.drawImage(gr, g.x0 * gscale, g.y0 * gscale, g.w * gscale, g.h * gscale, g.x0, g.y0, g.w, g.h);
  drawGround();

  const kinds = new Map<string, string>();
  const put = (list: [number, number][] | undefined, t: string) => (list ?? []).forEach(([c, r]) => kinds.set(`${c},${r}`, t));
  put(b.forests, 'forest'); put(b.hills, 'hill'); put(b.lakes, 'lake'); put(b.houses, 'house'); put(b.walls, 'wall'); put(b.towers, 'tower');
  put(b.gates?.map((q) => [q.col, q.row] as [number, number]), 'gate');
  const at = (c: number, r: number) => kinds.get(`${c},${r}`);
  const raised = raisedHills(b);

  // Hills, swamps and lakes of a drawn map are one painted layer; a random map's lakes are painted on the fly.
  const layers: { src: string; x: number; y: number; w: number; h: number }[] = [];
  if (b.overlay && !raised && (b.hills?.length || b.swamps?.length)) layers.push({ src: PART(`over-${b.overlay}${large ? '-large' : ''}`), x: 0, y: 0, w: g.W + 2 * GROUND_M, h: g.H + 2 * GROUND_M });
  else if (b.lakes?.length) {
    const lp = lakePart(b.lakes);
    if (lp) layers.push(lp);
  }
  const rivers = [...(b.riverCol === null ? [] : [{ col: b.riverCol, bridges: b.bridgeRows, fords: b.fordRows ?? [] }]), ...(b.rivers ?? [])];
  const gh = g.H + 2 * GROUND_M;
  for (const rv of rivers) layers.push({ src: PART(`river${large ? '-large' : ''}`), x: S * 1.5 * rv.col + S + GROUND_M - 47, y: 0, w: 94, h: gh });
  for (const rv of rivers) {
    for (const r of rv.fords) {
      const [x, y] = centre(rv.col, r);
      layers.push({ src: PART('ford'), x: x - 47, y: y - 28, w: 94, h: 56 });
    }
    for (const r of rv.bridges) {
      const [x, y] = centre(rv.col, r);
      layers.push({ src: PART('bridge'), x: x - 54, y: y - 23.25, w: 108, h: 46.5 });
    }
  }
  const layerPics = await Promise.all(layers.map((l) => load(l.src)));
  layers.forEach((l, i) => layerPics[i] && ctx.drawImage(layerPics[i]!, l.x, l.y, l.w, l.h));

  const hexPath = (c: number, r: number, rad: number, dx = 0, dy = 0) => {
    const [x, y] = centre(c, r);
    ctx.moveTo(x + dx + rad, y + dy);
    for (let i = 1; i < 6; i++) ctx.lineTo(x + dx + rad * Math.cos((Math.PI / 3) * i), y + dy + rad * Math.sin((Math.PI / 3) * i));
    ctx.closePath();
  };

  // Faint hex lines, as on the board.
  ctx.beginPath();
  const wet = new Set([...(b.lakes ?? []).map(([c, r]) => `${c},${r}`), ...rivers.flatMap((rv) => Array.from({ length: b.rows }, (_, r) => `${rv.col},${r}`))]);
  for (let c = 0; c < b.cols; c++) for (let r = 0; r < b.rows; r++) if (!wet.has(`${c},${r}`)) hexPath(c, r, S);
  ctx.strokeStyle = 'rgba(29,51,18,.12)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Raised hills, as the flat view draws them: the shadow they throw (away from the sun in the far-left corner),
  // the top (the meadow itself, a touch brighter) and a light edge on the sunny side, a dark one in the shade.
  const hills = raised ? (b.hills ?? []) : [];
  if (hills.length) {
    const sl = Math.hypot(0.75 * g.W, 0.85 * g.H);
    const [sx, sy] = [(-0.75 * g.W) / sl, (-0.85 * g.H) / sl];
    const isHill = (c: number, r: number) => at(c, r) === 'hill';
    const level = (c: number, r: number) => {
      const ring = neighbors({ col: c, row: r }).filter((n) => n.col >= 0 && n.row >= 0 && n.col < b.cols && n.row < b.rows);
      return ring.length === 6 && ring.every((n) => isHill(n.col, n.row)) ? 26 : 15;
    };
    ctx.beginPath();
    for (const [c, r] of hills) hexPath(c, r, S + 3.5);
    ctx.fillStyle = 'rgba(27,36,16,.2)';
    ctx.fill();
    ctx.beginPath();
    for (const [c, r] of hills) {
      const z = level(c, r) * 1.7; // a little longer than on the board, so the step still reads this small
      hexPath(c, r, S * 1.02, -sx * z, -sy * z);
    }
    ctx.fillStyle = 'rgba(27,36,16,.42)';
    ctx.fill();
    // The tops: the ground again (covering the shadow), lifted a shade lighter.
    ctx.save();
    ctx.beginPath();
    for (const [c, r] of hills) hexPath(c, r, S + 0.6);
    ctx.clip();
    drawGround();
    ctx.fillStyle = 'rgba(255,244,204,.13)';
    ctx.fillRect(g.x0, g.y0, g.w, g.h);
    ctx.restore();
    ctx.lineCap = 'round';
    for (const [c, r] of hills) {
      const [x, y] = centre(c, r);
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * (i + 0.5);
        const [nx, ny] = [Math.cos(a), Math.sin(a)];
        const n = neighbors({ col: c, row: r }).find((m) => {
          const [mx, my] = centre(m.col, m.row);
          return Math.abs(mx - (x + nx * R3 * S)) < 2 && Math.abs(my - (y + ny * R3 * S)) < 2;
        });
        if (n && isHill(n.col, n.row)) continue;
        const lit = nx * sx + ny * sy;
        const ca = (Math.PI / 3) * i;
        const cb = (Math.PI / 3) * (i + 1);
        ctx.beginPath();
        ctx.moveTo(x + S * Math.cos(ca), y + S * Math.sin(ca));
        ctx.lineTo(x + S * Math.cos(cb), y + S * Math.sin(cb));
        ctx.strokeStyle = lit > 0 ? `rgba(244,239,196,${(0.45 + 0.45 * Math.abs(lit)).toFixed(2)})` : `rgba(36,48,26,${(0.45 + 0.45 * Math.abs(lit)).toFixed(2)})`;
        ctx.lineWidth = 6;
        ctx.stroke();
      }
    }
  }

  // Castle walls, towers and gateways seen from above, as the flat view draws them.
  const poly = (c: number, r: number, rad: number, fill: string, stroke?: string) => {
    ctx.beginPath();
    hexPath(c, r, rad);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  };
  for (const [c, r] of b.walls ?? []) poly(c, r, S * 0.86, '#8d8a84', '#5b5852');
  for (const q of b.gates ?? []) (poly(q.col, q.row, S * 0.86, '#a39a8a', '#5b5852'), poly(q.col, q.row, S * 0.5, '#7a5432'));
  for (const [c, r] of b.towers ?? []) {
    const [x, y] = centre(c, r);
    ctx.beginPath();
    ctx.arc(x, y, S * 0.95, 0, Math.PI * 2);
    ctx.fillStyle = '#97938c';
    ctx.fill();
    ctx.strokeStyle = '#5b5852';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, S * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = '#7d7a73';
    ctx.fill();
  }

  // Standing things, back to front: the carved trees (as the flat view shows them), houses and boulders, small.
  const items: { y: number; url: string; nat: Pt; x: number; w: number; h: number; shadow?: number }[] = [];
  const spots = [[-13, -2, 0.95], [12, -5, 0.9], [0, -13, 1]] as const;
  for (const [c, r] of b.forests ?? []) {
    const [x, y] = centre(c, r);
    spots.forEach(([dx, dy, sz], i) => {
      const [kind, nat] = TREE_KINDS[(c * 7 + r * 11 + i * 5) % TREE_KINDS.length];
      const f = 0.21 * sz; // larger than on the board, or a wood is a few specks
      items.push({ y: y + dy, url: TREE_URL(kind, 'front'), nat, x: x + dx, w: nat[0] * f, h: nat[1] * f, shadow: 15 * sz });
    });
  }
  for (const [c, r] of b.houses ?? []) {
    const [x, y] = centre(c, r);
    const name = hexSeed(c, r) % 2 ? 'house2' : 'house';
    const nat = SCENERY[name] as unknown as Pt;
    const f = 0.26;
    items.push({ y: y + 14, url: SC_URL(name, 'front'), nat, x, w: nat[0] * f, h: nat[1] * f, shadow: 26 });
  }
  for (const [c, r] of b.boulders ?? []) {
    const [x, y] = centre(c, r);
    const nat = SCENERY.boulder as unknown as Pt;
    ([[-12, -8, 0.8], [13, 4, 0.6], [-4, 14, 0.5]] as const).forEach(([dx, dy, sc]) => items.push({ y: y + dy, url: SC_URL('boulder', 'front'), nat, x: x + dx, w: nat[0] * 0.32 * sc, h: nat[1] * 0.32 * sc }));
  }
  items.sort((a, b2) => a.y - b2.y);
  const itemPics = await Promise.all(items.map((it) => load(it.url)));
  // Shadows first, so no tree's shadow falls across a nearer tree.
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  for (const it of items)
    if (it.shadow) {
      ctx.beginPath();
      ctx.ellipse(it.x + it.shadow * 0.4, it.y + 1, it.shadow, it.shadow * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  items.forEach((it, i) => itemPics[i] && ctx.drawImage(itemPics[i]!, it.x - it.w / 2, it.y - it.h + 2, it.w, it.h));

  // The board's light: warm from the far-left corner, cool shade opposite.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const sun = ctx.createRadialGradient(-0.1 * cv.width, -0.2 * cv.height, 0, -0.1 * cv.width, -0.2 * cv.height, Math.hypot(cv.width, cv.height) * 1.25);
  sun.addColorStop(0, 'rgba(232,169,72,.13)');
  sun.addColorStop(0.45, 'rgba(232,169,72,.03)');
  sun.addColorStop(0.75, 'rgba(30,44,74,.08)');
  sun.addColorStop(1, 'rgba(20,32,58,.22)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, cv.width, cv.height);
  // The frame's edge: a dark line and a light bevel, like the table's lip.
  ctx.strokeStyle = 'rgba(20,10,4,.75)';
  ctx.lineWidth = Math.max(1, cv.width / 220);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, cv.width - ctx.lineWidth, cv.height - ctx.lineWidth);
  ctx.strokeStyle = 'rgba(214,160,100,.35)';
  ctx.strokeRect(ctx.lineWidth * 1.5, ctx.lineWidth * 1.5, cv.width - ctx.lineWidth * 3, cv.height - ctx.lineWidth * 3);

  const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/webp', 0.86));
  return blob ? URL.createObjectURL(blob) : cv.toDataURL('image/png');
}
