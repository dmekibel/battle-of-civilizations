// Biomes: each map can name the land it lies in (board.biome, default the meadow). A biome brings its own painted
// ground (standard and large, made by _art/map_build.py with BIOME=<id>), its close-up ground tile, its river banks,
// its lake colours, its carved trees and small props, and the carved buildings its houses and boulders show.
// Only the pictures change: a saloon is still a 'house', a cactus still a 'forest' tree, so the rules stay the same.
// Every army also has a hand-drawn home map in its own biome (maps.json, "home-<army>").

import type { GameConfig } from '../config';
import type { FactionId } from './factions';
import type { Lang } from './i18n';
import ART from './biome-art.json';

type Pt = [number, number];
type Board = GameConfig['board'];
export type BiomeId = 'meadow' | 'desert' | 'prairie' | 'steppe' | 'snow' | 'baltic' | 'mediterranean' | 'japanese' | 'jungle' | 'savanna' | 'farmland' | 'beach';
export const BIOME_IDS: BiomeId[] = ['meadow', 'desert', 'prairie', 'steppe', 'snow', 'baltic', 'mediterranean', 'japanese', 'jungle', 'savanna', 'farmland', 'beach'];

export interface Biome {
  name: Record<Lang, string>;
  /** Tree kinds for forest hexes (a map may name its own with board.trees). */
  trees: string[];
  /** The props set (prop-<set>-<n>.webp), 'meadow' for the original grass tufts, or null for none. */
  props: string | null;
  /** Which props of the set a hex gets, by its seed (indices into the set). */
  mix?: number[];
  /** Carved buildings a house hex shows when the map doesn't name one (board.art). */
  houses: string[];
  /** What a boulder hex shows: the three-boulder cluster, or one carved piece. */
  boulder: string;
  /** Lake water and shore colours (painted on the fly). */
  lake: { water: [number, number, number]; sand: [number, number, number] };
  /** Swatch for the biome picker. */
  swatch: string;
}

export const BIOMES: Record<BiomeId, Biome> = {
  meadow: { name: { en: 'Meadow', ru: 'Луг' }, trees: ['pine', 'spruce', 'oak'], props: 'meadow', houses: ['house', 'house2'], boulder: 'boulder', lake: { water: [62, 130, 160], sand: [140, 128, 82] }, swatch: '#7fa35a' },
  desert: { name: { en: 'Desert', ru: 'Пустыня' }, trees: ['palm', 'cactus'], props: 'arid', mix: [5, 3, 7, 6, 4, 2, 0], houses: ['saloon', 'dome'], boulder: 'redrock', lake: { water: [58, 136, 160], sand: [214, 184, 128] }, swatch: '#e2bf7f' },
  prairie: { name: { en: 'Prairie', ru: 'Прерия' }, trees: ['oak', 'pine'], props: 'arid', mix: [0, 1, 2, 0, 7, 5, 1, 6], houses: ['tipi'], boulder: 'redrock', lake: { water: [62, 130, 160], sand: [190, 150, 98] }, swatch: '#c8a160' },
  steppe: { name: { en: 'Steppe', ru: 'Степь' }, trees: ['birch2', 'oak'], props: 'arid', mix: [1, 0, 1, 2, 6, 1, 0], houses: ['yurt'], boulder: 'boulder', lake: { water: [70, 130, 160], sand: [176, 164, 128] }, swatch: '#b9b597' },
  snow: { name: { en: 'Snow', ru: 'Снега' }, trees: ['pine', 'spruce'], props: null, houses: ['izba'], boulder: 'boulder', lake: { water: [120, 168, 196], sand: [214, 222, 232] }, swatch: '#e6edf4' },
  baltic: { name: { en: 'Northern forest', ru: 'Северный лес' }, trees: ['spruce', 'pine', 'oak'], props: 'meadow', houses: ['house', 'house2'], boulder: 'boulder', lake: { water: [52, 110, 140], sand: [120, 112, 80] }, swatch: '#3f6a3c' },
  mediterranean: { name: { en: 'Mediterranean', ru: 'Средиземноморье' }, trees: ['cypress', 'olive'], props: 'mediterranean', houses: ['house2', 'dome'], boulder: 'boulder', lake: { water: [50, 136, 170], sand: [206, 186, 140] }, swatch: '#a9a36c' },
  japanese: { name: { en: 'Japan', ru: 'Япония' }, trees: ['cherry', 'jpine'], props: 'japanese', houses: ['pagoda', 'house2'], boulder: 'boulder', lake: { water: [62, 136, 160], sand: [150, 140, 100] }, swatch: '#86b84f' },
  jungle: { name: { en: 'Jungle', ru: 'Джунгли' }, trees: ['jungle', 'palm'], props: 'jungle', houses: ['house2'], boulder: 'boulder', lake: { water: [50, 120, 110], sand: [120, 104, 70] }, swatch: '#2f6a46' },
  savanna: { name: { en: 'Savanna', ru: 'Саванна' }, trees: ['acacia'], props: 'savanna', houses: ['kraal'], boulder: 'boulder', lake: { water: [70, 128, 140], sand: [190, 150, 96] }, swatch: '#d4a34c' },
  farmland: { name: { en: 'Farmland', ru: 'Поля' }, trees: ['oak'], props: 'farmland', houses: ['house', 'house2', 'windmill'], boulder: 'boulder', lake: { water: [62, 130, 160], sand: [140, 128, 82] }, swatch: '#8eaa5c' },
  beach: { name: { en: 'Island', ru: 'Остров' }, trees: ['palm'], props: 'beach', houses: ['house2'], boulder: 'boulder', lake: { water: [40, 160, 180], sand: [232, 212, 160] }, swatch: '#9fd06a' },
};

export const biomeId = (b: Pick<Board, 'biome'> | undefined): BiomeId => (b?.biome && b.biome in BIOMES ? (b.biome as BiomeId) : 'meadow');
export const biomeOf = (b: Pick<Board, 'biome'> | undefined): Biome => BIOMES[biomeId(b)];

const BASE = () => `${import.meta.env.BASE_URL}map/`;
/** The painted ground's file for a biome (the snow biome is the meadow under snow, made by _art/snow_build.py). */
export const groundFile = (id: BiomeId, large: boolean) => (id === 'meadow' ? `ground${large ? '-large' : ''}` : id === 'snow' ? `ground${large ? '-large' : ''}-snow` : `ground-${id}${large ? '-large' : ''}`);
export const groundUrlOf = (id: BiomeId, large: boolean) => `${BASE()}${groundFile(id, large)}.webp?v=${id === 'meadow' ? 11 : 1}`;
export const detailUrlOf = (id: BiomeId) => `${BASE()}grass-detail${id === 'meadow' ? '' : `-${id}`}.webp?v=1`;
/** River banks are painted into the river picture, so each biome has its own (snow keeps the meadow's). */
export const riverFile = (id: BiomeId, large: boolean) => `river${id === 'meadow' || id === 'snow' ? '' : `-${id}`}${large ? '-large' : ''}`;

// ---------- trees ----------
/** Picture size in pixels of each tree kind (trunk foot at bottom centre); the meadow's three plus the biome trees. */
const OWN_TREES: Record<string, Pt> = { pine: [150, 301], spruce: [126, 285], oak: [198, 251] };
export const TREE_SIZE: Record<string, Pt> = { ...OWN_TREES, ...Object.fromEntries(Object.entries(ART.trees as unknown as Record<string, Pt>).filter(([k]) => k !== 'birch')) };
/** The tree kinds a map's forests use: its own list, else its biome's (kinds without a picture yet are skipped). */
export function treeKinds(b: Pick<Board, 'biome' | 'trees'>): [string, Pt][] {
  const want = (b.trees?.length ? b.trees : biomeOf(b).trees).filter((k) => TREE_SIZE[k]);
  return (want.length ? want : ['pine', 'spruce', 'oak']).map((k) => [k, TREE_SIZE[k]]);
}
/** Some kinds stand smaller than the meadow's trees, so three to a hex read as a grove. */
export const TREE_SCALE: Record<string, number> = { cactus: 0.72, acacia: 0.9, cherry: 0.92, jpine: 0.92 };
export const treeUrlOf = (id: BiomeId, kind: string, dir: string) =>
  `${BASE()}tree-${kind}-${dir}${id === 'snow' && OWN_TREES[kind] ? '-snow' : ''}.webp?v=${OWN_TREES[kind] ? 4 : 1}`;

// ---------- props ----------
/** A biome's small props: [picture size, how tall it stands in map units]. */
export function propsOf(b: Pick<Board, 'biome'>): { url: (i: number) => string; list: [Pt, number][]; mix: number[] } | null {
  const bm = biomeOf(b);
  if (!bm.props || bm.props === 'meadow') return null;
  const sizes = (ART.props as unknown as Record<string, Pt[]>)[bm.props];
  if (!sizes) return null;
  // About as tall as the meadow's tufts for their picture height; big pieces (a hay bale, a termite mound) a little more.
  const list = sizes.map((s) => [s, Math.max(5, Math.min(19, s[1] * 0.068))] as [Pt, number]);
  const mix = (bm.mix ?? sizes.map((_, i) => i)).filter((i) => i < sizes.length);
  return { url: (i) => `${BASE()}prop-${bm.props}-${i + 1}.webp?v=1`, list, mix };
}

// ---------- carved buildings ----------
export const BIOME_SCENERY: Record<string, Pt> = ART.scenery as unknown as Record<string, Pt>;
/** Which carved piece stands on a building or boulder hex: the map's own choice (board.art "col,row"), else the biome's. */
export function artAt(b: Pick<Board, 'biome' | 'art'>, c: number, r: number, kind: 'house' | 'boulder', seed: number): string {
  const own = b.art?.[`${c},${r}`];
  if (own) return own;
  const bm = biomeOf(b);
  if (kind === 'boulder') return bm.boulder;
  return bm.houses[seed % bm.houses.length];
}
/** How big each carved building stands against the village house (1 = same carving scale as the trees). */
export const BUILD_SCALE: Record<string, number> = { watertower: 0.9, church: 0.95, pagoda: 0.95, windmill: 0.95, aztec: 1, obelisk: 0.85, torii: 0.85, wagon: 0.8, runestone: 0.8, redrock: 0.9, tipi: 0.85, yurt: 0.9, kraal: 0.85 };

/** Every picture a board in this biome draws beyond the meadow's, to fetch ahead. */
export function biomePics(b: Board, large: boolean): string[] {
  const id = biomeId(b);
  if (id === 'meadow') return [];
  const DIRS = ['front', 'front-left', 'left', 'back-left', 'back', 'back-right', 'right', 'front-right'];
  const p = propsOf(b);
  const sc = new Set<string>([...Object.values(b.art ?? {}), ...biomeOf(b).houses, biomeOf(b).boulder].filter((n) => BIOME_SCENERY[n]));
  return [
    groundUrlOf(id, large),
    ...treeKinds(b).flatMap(([k]) => DIRS.map((d) => treeUrlOf(id, k, d))),
    ...(p ? p.list.map((_, i) => p.url(i)) : []),
    ...[...sc].flatMap((n) => DIRS.map((d) => `${BASE()}sc-${n}-${d}.webp?v=1`)),
  ];
}

// ---------- home maps ----------
/** Each army's home map (maps.json). */
export const HOME: Record<FactionId, string> = {
  frontier: 'home-frontier', egypt: 'home-egypt', comanche: 'home-comanche', mongols: 'home-mongols', novgorod: 'home-novgorod', vikings: 'home-vikings',
  teutonic: 'home-teutonic', romans: 'home-romans', ottomans: 'home-ottomans', japanese: 'home-japanese', aztecs: 'home-aztecs', zulus: 'home-zulus',
  british: 'home-british', french: 'home-french', pirates: 'home-pirates',
};
export const HOME_NAMES: Record<string, Record<Lang, string>> = {
  'home-frontier': { en: 'Dust Creek', ru: 'Пыльный Ручей' },
  'home-egypt': { en: 'Nile Bend', ru: 'Излучина Нила' },
  'home-comanche': { en: 'Red Canyon', ru: 'Красный каньон' },
  'home-mongols': { en: 'Endless Steppe', ru: 'Бескрайняя степь' },
  'home-novgorod': { en: 'Lake Peipus', ru: 'Чудское озеро' },
  'home-vikings': { en: 'Fjord Hall', ru: 'Усадьба у фьорда' },
  'home-teutonic': { en: 'Marienburg Woods', ru: 'Мариенбургский лес' },
  'home-romans': { en: 'Seven Hills', ru: 'Семь холмов' },
  'home-ottomans': { en: 'Golden Horn Camp', ru: 'Лагерь у Золотого Рога' },
  'home-japanese': { en: 'Sakura Valley', ru: 'Долина сакуры' },
  'home-aztecs': { en: 'Jungle Temple', ru: 'Храм в джунглях' },
  'home-zulus': { en: 'Kraal Hills', ru: 'Крааль на холмах' },
  'home-british': { en: 'Shire Fields', ru: 'Английские поля' },
  'home-french': { en: 'Norman Mill', ru: 'Нормандская мельница' },
  'home-pirates': { en: 'Shipwreck Cove', ru: 'Бухта кораблекрушения' },
};
export const HOME_IDS = Object.values(HOME);
export const isHome = (m: string) => m in HOME_NAMES;
