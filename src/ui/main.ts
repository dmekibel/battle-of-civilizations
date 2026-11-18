import './style.css';
import { CONFIG, type GameConfig, budgetOf, sideConfig, type UnitTypeId } from '../config';
import {
  apply,
  armyCost,
  attack,
  autoDeploy,
  canUndo,
  draftArmy,
  endTurn,
  finishDeploy,
  getUnit,
  key,
  liftUnit,
  maxHp,
  stepCost,
  hexesPerPoint,
  moveUnit,
  newGame,
  other,
  placeUnit,
  quickStart,
  reachable,
  rollDice,
  reroll,
  canReroll,
  shoot,
  routeTo,
  startSession,
  takeHex,
  canMarch,
  march,
  noContact,
  strikeTargets,
  undo,
  unitAt,
  zoneHexes,
  type ArmyCounts,
  aiNextAction,
  applyAi,
  suggestArmy,
  type AttackPreview,
  type GameState,
  type Hex,
  type Unit,
  distance,
  hasLineOfSight,
  maxRangeAt,
  neighbors,
  type LogEntry,
  type Player,
  type Result,
  type Session,
} from '../engine';
import { ARROW_S, groundSize, groundUrl, NO_EFFECTS, STEP_MS, groundTransform, hasGround, groundParts, detailBox, DETAIL_URL, hexOnMap, loadGround, mapSize, pickHex, renderBoard, screenToGround, targetFrame, viewCube, hexScreen, hexesBox, type Camera, type Effects, type Overlay } from './board';
import { errorText, logText, playerName, reasonText, t, unitName, type Key, type Lang } from './i18n';
import { unitIcon } from './symbols';
import { paintSideVars, setMine, setSideMode, sideColor, sideMode } from './sides';
import { ERAS, ERA_OF, FACTIONS, FACTION_ORDER, factionOf, rosterOf, sides, type FactionId } from './factions';
import { morph, morphInto } from './morph';
import { placeWeather, weatherPanel } from './weather';
import { miniHeldOff, miniOn, miniReset, miniSetPref, miniStats, placeMini, toggleMini } from './mini';
import { ART_VERSION, SPRITES } from './sprites';
import { createCode, fetchGame, newId, normCode, pushGame, resolveCode } from './online';
import { agoText, browserStore, deleteSlot, listSlots, migrate, newSlotId, readSlot, writeSlot } from './saves';
import { initReplay, replayControls, replayState, replaying, resultButtons } from './replay';
import { isMuted, mixerHtml, musicOn, setMusic, sound, toggleMusic, toggleMute } from './sound';
import { fightSounds, marchSounds, prepareVoices, selectVoice, toggleVoices, victoryVoice, voiceMode } from './voices';
import { cachedThumb, paintThumb, thumbAspect } from './thumb';
import { READY_ARMIES, armyGallery, armyShowcase, choiceList, initShowcase, st, summaryRow, turnFigures } from './setupui';
import { enemyAction as tutorialEnemy, initTutorial, startTutorial, tutorialLabel, tutorialOn, tutorialRng } from './tutorial';
import { BIOME_IDS, BIOMES, HOME, HOME_NAMES, type BiomeId } from './biomes';
import { DADS_RULES, RECOMMENDED, applySettings, boardFor, fixedPoints, loadSettings, newSeed, saveSettings, type DiceId, type MapId, type Settings } from './settings';
import { buildScenario, campaignScreen, campaignText, checkHold, goalText, scenarioById, scenarioResult, scenarioSettings } from './scenarios';
import { KNOB_IDS, KNOB_STEPS, MAP_STYLES, PRESET_KNOBS, type KnobId, type MapKnobs, type MapStyle } from '../engine/mapgen';

const app = document.getElementById('app')!;

const LANG_KEY = 'boc-lang';
function loadLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'ru' ? 'ru' : 'en';
  } catch {
    return 'en';
  }
}

// ---------- saving ----------
// The game is saved after every change, so closing the app or locking the phone loses nothing.
// Every game has its own slot in the saved-games list (src/ui/saves.ts): a new game never erases the last.

type Mode = 'pvp' | 'ai' | 'online';
/** An online game: its id (the invite link), which side this phone plays, and the last version seen (-1 = not loaded yet). */
interface Net {
  id: string;
  me: Player;
  rev: number;
  /** The army the invited player picked for themselves. */
  blue?: FactionId | null;
}
/** In a game against the computer, it plays the Teutonic Order. */
const AI_SIDE: Player = 'blue';

interface Saved {
  board: [number, number];
  state: GameState;
  cover: boolean;
  mode: Mode;
  settings?: Settings;
  net?: Net | null;
}

// ---------- saved games ----------
/** What the saved-games list shows for a slot, kept in the small index so the list never parses whole games. */
interface SlotInfo {
  mode: Mode;
  red: FactionId;
  blue: FactionId;
  turn: number;
  phase: GameState['phase'];
  current: Player;
  winner?: Player | null;
  scenario?: string;
  /** Online: the game's id in Firestore (games/{id}) and this phone's side. */
  net?: string;
  me?: Player;
}
const store = browserStore();
function validSaved(d: unknown): d is Saved {
  const saved = d as Saved;
  const ok = saved?.state?.phase && Array.isArray(saved.state.units) && saved.state.reserve && 'advance' in saved.state;
  if (!ok) return false;
  const want = saved.settings?.size === 'large' ? [33, 19] : [25, 15];
  return saved.board?.[0] === want[0] && saved.board?.[1] === want[1];
}
function slotInfo(d: Saved): SlotInfo {
  const sides = d.settings?.sides ?? { red: 'novgorod', blue: 'teutonic' };
  return {
    mode: d.mode, red: sides.red as FactionId, blue: sides.blue as FactionId, turn: d.state.turn, phase: d.state.phase,
    current: d.state.current, winner: d.state.winner ?? null, scenario: d.settings?.scenario,
    ...(d.mode === 'online' && d.net ? { net: d.net.id, me: d.net.me } : {}),
  };
}
migrate(store, (d) => (validSaved(d) ? slotInfo(d) : null));
/** The slot the game on screen saves into (null: nothing to save yet). */
let slotId: string | null = null;
/** The saved-games list is open (over the start screen or the game). */
let savesOpen = false;
/** The slot whose Delete was tapped once: it asks before deleting. */
let confirmDelete: string | null = null;
/** Online, before setup: "Host a game" or "Join with code" ('pick'), or the code box ('join'). */
let onlineStep: null | 'pick' | 'join' = null;
/** What was last written, so redraws that change nothing don't rewrite (or re-date) the slot. */
let lastSaved: unknown[] = [];

function loadGame(): Saved | null {
  // Opened from an invite link to a game this phone already has: that one. Otherwise the newest.
  const g = new URLSearchParams(location.search).get('g');
  const list = listSlots<SlotInfo>(store);
  const first = g ? list.find((m) => m.info?.net === g) : undefined;
  for (const m of first ? [first, ...list.filter((x) => x !== first)] : list) {
    const d = readSlot<Saved>(store, m.id);
    if (validSaved(d)) {
      slotId = m.id;
      return d;
    }
  }
  return null;
}

function saveGame() {
  if (tutorialOn()) return; // the tutorial plays in memory: the player's saved games stay as they were
  // Nothing is written while a menu screen is up over the game (picking a mode may already have changed it),
  // nor for an online game that hasn't arrived yet.
  if (!slotId || choosing || setupOpen || savesOpen || onlineStep || replaying()) return;
  if (mode === 'online' && (!net || net.rev < 0)) return;
  const key = [slotId, sess.state, cover, mode, settings, net?.id, net?.rev, net?.blue];
  if (key.length === lastSaved.length && key.every((v, i) => v === lastSaved[i])) return;
  const data: Saved = { board: [CONFIG.board.cols, CONFIG.board.rows], state: sess.state, cover, mode, settings, net };
  if (writeSlot(store, slotId, data, slotInfo(data))) lastSaved = key;
  /* storage full or blocked: play on without saving */
}

const saved = loadGame();
/** The battle's settings; a saved game brings its own, a new one starts from the last used. */
// A game saved before a rule existed gets that rule's default.
let settings: Settings = saved?.settings ? { ...saved.settings, options: { ...DADS_RULES, ...saved.settings.options } } : loadSettings();
applySettings(settings);
let sess: Session = startSession(saved?.state ?? newGame());
/** The "New battle" screen, shown after picking how to play. */
let setupOpen = false;
let selected: string | null = null;
let lang: Lang = loadLang();
let message: string | null = null;
/** The selected piece's card shows as a slim chip on phones; a tap on it opens the full card (and back). */
let unitOpen = false;
let rolling = false;
let rollFaces: number[] = [];
let confirmNew = false;
/** First press of End turn with points left only warns; the second press ends the turn. */
let confirmEnd = false;
let lastPoints = 0;
let menuOpen = false;
/** Pass-the-phone screen: shown whenever the other player must look away. */
// A game reopened during secret setup always starts behind the cover, so nothing leaks.
let mode: Mode = saved?.mode === 'ai' ? 'ai' : saved?.mode === 'online' && saved.net ? 'online' : 'pvp';
let cover = saved ? saved.cover || (mode === 'pvp' && (saved.state.phase === 'draft' || saved.state.phase === 'deploy')) : false;
/** The "how do you want to play" screen: first launch and every new game. */
// screen memory: a reload keeps the player on the title screen if that is where they were (an invite link still opens its game).
const SCREEN_KEY = 'boc-screen';
let shownScreen = (() => { try { return localStorage.getItem(SCREEN_KEY); } catch { return null; } })();
let choosing = !saved || (shownScreen === 'title' && !new URLSearchParams(location.search).get('g'));
/** The campaign list, shown in place of the start screen (so the game behind stays paused). */
let campaignOpen = false;
let aiTimer: number | null = null;
const aiTurn = (s: GameState) => mode === 'ai' && s.current === AI_SIDE && s.phase !== 'over' && setupPhase(s) === false;
// ---------- online ----------
let net: Net | null = mode === 'online' ? saved!.net! : null;
/** The piece that last answered when picked (so a redraw doesn't make it speak again). */
let voicedSel: string | null = null;
/** The state both phones agree on: a different one on screen means this phone has something to send. */
let netState: GameState | null = net ? sess.state : null;
const roleKey = (id: string) => `boc-net-${id}`;
{
  // Opened from an invite link: join that game (as Blue, unless this phone started it).
  const g = new URLSearchParams(location.search).get('g');
  if (g && /^[a-z0-9]{16,40}$/.test(g) && g !== net?.id) {
    let me: Player = 'blue';
    try {
      if (localStorage.getItem(roleKey(g)) === 'red') me = 'red';
      localStorage.setItem(roleKey(g), me);
    } catch { /* private window: play as Blue */ }
    mode = 'online';
    net = { id: g, me, rev: -1 };
    netState = null;
    choosing = false;
    slotId = newSlotId(); // saved games: the link's game gets its own slot once it arrives
  }
  if (mode === 'online') cover = false;
}
/** The host's "send this link" card, shown once a new online game exists. */
let inviting = false;
/** The invited player's "pick your army" card. */
let pickingArmy = false;
/** The invited player's own choice of army always wins over whatever the game document says. */
function applyBlue() {
  if (net?.blue && FACTIONS[net.blue] && settings.sides.blue !== net.blue) {
    const red = settings.sides.red === net.blue ? settings.sides.blue : settings.sides.red;
    settings = { ...settings, sides: { red, blue: net.blue } };
    applySettings(settings);
  }
}
let lastBlueAsk = 0;
/** Online and not this phone's go (or the game hasn't arrived yet). */
const theirTurn = (s: GameState) => mode === 'online' && !!net && s.phase !== 'over' && (net.rev < 0 || s.current !== net.me);
const notMine = (s: GameState) => aiTurn(s) || theirTurn(s);
const inviteUrl = () => `${location.origin}${location.pathname}?g=${net?.id ?? ''}`;
/** The host's short join code (for Home Screen players, who can't open links). */
let joinCode: string | null = null;
/** The guest's "join with code" box: what they typed and any error. */
let joinText = '';
let joinErr: string | null = null;
let joinBusy = false;
async function joinByCode() {
  const code = normCode(joinText);
  if (!code) { joinErr = t(lang, 'codeBad'); return render(); }
  joinBusy = true; joinErr = null; render();
  let id: string | null;
  try { id = await resolveCode(code); } catch { joinBusy = false; joinErr = t(lang, 'codeNetErr'); return render(); }
  joinBusy = false;
  if (!id) { joinErr = t(lang, 'codeNone'); return render(); }
  // Saved games: a game this phone already has is simply resumed.
  const had = listSlots<SlotInfo>(store).find((m) => m.info?.net === id);
  if (had && resumeSlot(had.id)) { joinText = ''; return; }
  // From here exactly as if the invite link had been opened.
  let me: Player = 'blue';
  try {
    if (localStorage.getItem(roleKey(id)) === 'red') me = 'red';
    localStorage.setItem(roleKey(id), me);
  } catch { /* private window: play as Blue */ }
  mode = 'online';
  net = { id, me, rev: -1 };
  netState = null;
  unsent = null;
  slotId = newSlotId();
  choosing = false;
  setupOpen = false;
  onlineStep = null;
  cover = false;
  joinText = '';
  history.replaceState(null, '', `?g=${id}`);
  lastAsk = 0;
  render();
}
function leaveNet() {
  joinCode = null;
  net = null;
  netState = null;
  history.replaceState(null, '', location.pathname);
}

// ---------- saved games: resume ----------
/** Opens a saved game exactly where it was left. Online, it reconnects to the same game (games/{id}) and syncs on. */
function resumeSlot(id: string): boolean {
  const d = readSlot<Saved>(store, id);
  if (!validSaved(d)) {
    message = t(lang, 'slotGone');
    render();
    return false;
  }
  if (net) leaveNet();
  unsent = null;
  slotId = id;
  lastSaved = [];
  introSeen = null; // battle intro: a resumed game never plays it
  mode = d.mode === 'ai' ? 'ai' : d.mode === 'online' && d.net ? 'online' : 'pvp';
  settings = d.settings ? { ...d.settings, options: { ...DADS_RULES, ...d.settings.options } } : loadSettings();
  applySettings(settings);
  sess = startSession(d.state);
  net = mode === 'online' ? { ...d.net! } : null;
  netState = net ? sess.state : null;
  cover = mode !== 'online' && (d.cover || (mode === 'pvp' && (d.state.phase === 'draft' || d.state.phase === 'deploy')));
  choosing = setupOpen = campaignOpen = savesOpen = menuOpen = inviting = pickingArmy = overHidden = false;
  onlineStep = null;
  confirmDelete = null;
  selected = pending = null;
  message = null;
  draft = {};
  tray = null;
  joinCode = null;
  prevLog = sess.state.log.length;
  prevPos = new Map(sess.state.units.map((u) => [u.id, u.pos]));
  if (net) {
    try { store.set(roleKey(net.id), net.me); } catch { /* fine */ }
    history.replaceState(null, '', `?g=${net.id}`);
    cam = { ...cam, yaw: yawFor(net.me) };
    lastAsk = 0;
    lastBlueAsk = 0;
  }
  render();
  return true;
}
let sending = false;
let unsent: { rev: number; body: string } | null = null;
/** Sends this phone's latest position, retrying until it gets through; only the newest matters. */
async function flush() {
  if (sending) return;
  sending = true;
  while (unsent && net) {
    const job = unsent;
    const ok = await pushGame(net.id, job.rev, job.body);
    if (ok && unsent === job) unsent = null;
    if (!ok) await new Promise((r) => setTimeout(r, 2000));
  }
  sending = false;
}
function syncOut() {
  if (mode !== 'online' || !net || net.rev < 0 || rolling || choosing || setupOpen || sess.state === netState) return;
  netState = sess.state;
  net.rev++;
  unsent = { rev: net.rev, body: JSON.stringify({ state: sess.state, settings }) };
  void flush();
}
let lastAsk = 0;
async function syncIn() {
  if (mode !== 'online' || !net || sending || unsent || rolling || document.visibilityState !== 'visible') return;
  // Until the invited player's army is known, look for their choice (it lives in its own small document).
  if (!net.blue && net.rev >= 0 && !pickingArmy && Date.now() - lastBlueAsk > 3000) {
    lastBlueAsk = Date.now();
    const id0 = net.id;
    fetchGame(`${id0}b`).then((b) => {
      if (!net || net.id !== id0 || net.blue) return;
      if (b && b.state in FACTIONS) {
        net.blue = b.state as FactionId;
        applyBlue();
      } else if (net.me === 'blue') pickingArmy = true; // joined earlier but never chose
      else return;
      render();
    }, () => {});
  }
  // Waiting for the other player: ask often. On your own go nothing should change, so rarely.
  const every = theirTurn(sess.state) ? 2000 : 15000;
  if (Date.now() - lastAsk < every) return;
  lastAsk = Date.now();
  const id = net.id;
  let r;
  try {
    r = await fetchGame(id);
  } catch {
    return; // offline: try again next time
  }
  if (!net || net.id !== id || unsent) return;
  if (!r) {
    if (net.rev < 0) {
      leaveNet();
      mode = 'pvp';
      choosing = true;
      message = t(lang, 'gameNotFound');
      render();
    }
    return;
  }
  if (r.rev <= net.rev) return;
  const first = net.rev < 0;
  const data = JSON.parse(r.state) as { state: GameState; settings: Settings };
  settings = { ...data.settings, options: { ...DADS_RULES, ...data.settings.options } };
  applySettings(settings);
  applyBlue();
  // camera v2: the other player's moves arrive together; first glide to where they happened, then play them there.
  if (!first) {
    const ms = watchOnline(data.state);
    if (ms) {
      await new Promise((ok) => setTimeout(ok, ms));
      if (!net || net.id !== id) return;
    }
  }
  sess = startSession(data.state);
  netState = sess.state;
  if (first) introSeen = null; // battle intro: joining (or re-joining) an online game never plays it
  net.rev = r.rev;
  selected = null;
  cover = false;
  if (first) {
    // Don't replay the whole battle so far, and look at the board from this side's edge.
    prevLog = sess.state.log.length;
    cam = { ...cam, yaw: yawFor(net.me) };
    if (net.me === 'blue' && !net.blue) {
      // Joining for the first time: has this player already picked an army (on another visit)?
      const id1 = net.id;
      const b = await fetchGame(`${id1}b`).catch(() => null);
      if (net?.id !== id1) return;
      if (b && b.state in FACTIONS) {
        net.blue = b.state as FactionId;
        applyBlue();
      } else pickingArmy = true;
    }
  }
  render();
}
setInterval(() => void syncIn(), 1000);

let draft: ArmyCounts = {};
let tray: UnitTypeId | null = null;
/** What the last render showed, so the next one can animate what changed. */
let prevLog = sess.state.log.length;
let prevPos = new Map<string, Hex>(sess.state.units.map((u) => [u.id, u.pos]));

const isPortrait = () => window.innerHeight > window.innerWidth;
let portrait = isPortrait();
/** Wide landscape screens get a permanent side panel instead of the ☰ drawer. */
const isDesktop = () => window.innerWidth >= 1000 && window.innerHeight >= 560 && !isPortrait();
let desktop = isDesktop();
/** Desktop side panel shown or tucked away (board full width); remembered per device. */
const PANEL_KEY = 'boc-panel';
let panelOpen = (() => {
  try {
    return localStorage.getItem(PANEL_KEY) !== 'hidden';
  } catch {
    return true;
  }
})();
const withPanel = () => desktop && panelOpen;

/** Camera: how far the board is turned (yaw, radians) and tilted (pitch 0..1); remembered per device. */
const CAM_KEY = 'boc-cam';
const CAM_DEFAULT: Camera = { yaw: 0, pitch: 0.6, zoom: 1, x: null, y: null };
let cam: Camera = (() => {
  try {
    const c = JSON.parse(localStorage.getItem(CAM_KEY) ?? 'null');
    return typeof c?.yaw === 'number' && typeof c?.pitch === 'number'
      ? { ...CAM_DEFAULT, yaw: c.yaw, pitch: c.pitch, zoom: typeof c.zoom === 'number' ? c.zoom : 1 }
      : { ...CAM_DEFAULT };
  } catch {
    return { ...CAM_DEFAULT };
  }
})();
function saveCam() {
  try {
    localStorage.setItem(CAM_KEY, JSON.stringify(cam));
  } catch {
    /* keep the camera for this visit only */
  }
}
// Up to 1.1 (about 84°): the board can be looked at almost edge-on (David 2026-11-18).
const clampPitch = (p: number) => Math.min(1.1, Math.max(0, p));
/** smart camera: on selecting a piece, glide just enough that its targets show (menu switch, on by default). */
const SMART_KEY = 'boc-smartcam';
let smartCam = (() => { try { return localStorage.getItem(SMART_KEY) !== '0'; } catch { return true; } })();
/** smart camera: the selection it last looked at, and the glide it started (cancelled by any wheel or touch). */
let smartFor: string | null = null;
let leanGlide = -1;
// camera v2 (see the "camera v2" section): enemy warnings on/off, and whether the player took the camera during the enemy's turn.
const WARN_KEY = 'boc-warn';
let warnOn = (() => { try { return localStorage.getItem(WARN_KEY) !== '0'; } catch { return true; } })();
let userTookCam = false;
let threatCache: { s: GameState; me: Player; mine: Set<string>; foes: Set<string> } | null = null;

/** The camera turn that puts this side's army at the bottom of the screen, enemy at the top. */
function yawFor(p: Player): number {
  // Portrait already shows Novgorod at the bottom; landscape has it on the left.
  const novgorodBottom = portrait ? 0 : -Math.PI / 2;
  return p === 'red' ? novgorodBottom : novgorodBottom + Math.PI;
}

/** Two players on one device:
 *  'pass'   = they hand it over; the board turns to face whoever's turn it is.
 *  'across' = it lies flat between them. On the far player's turn the camera swings round to
 *             their side and the whole screen turns 180°, so the board stays where it lies on
 *             the phone while each player gets the 3D view from their own seat. */
type Table = 'pass' | 'across';
const TABLE_KEY = 'boc-table';
let table: Table = (() => {
  try {
    return localStorage.getItem(TABLE_KEY) === 'across' ? 'across' : 'pass';
  } catch {
    return 'pass';
  }
})();
let facedFor: Player | null = null;
const acrossTable = () => mode === 'pvp' && table === 'across';
/** Across the table, the far player (Teutonic Order, sitting opposite) sees the screen turned round. */
const upsideDown = () => acrossTable() && sideShown === 'blue';
/** Whose seat the screen currently faces across the table; it catches up with the turn by a
 *  tilt over the top (see tiltOver), so the board never spins round. */
let sideShown: Player = sess.state.current;
/** During the tilt-over, the camera tilt being shown instead of the player's own. */
let tiltShown: number | null = null;
/** The drawing area's size in pixels: the board picture is drawn to fill it exactly. */
let stageSize: [number, number] = [window.innerWidth, Math.max(300, window.innerHeight * 0.7)];
const view = () => {
  const c = tiltShown === null ? cam : { ...cam, pitch: tiltShown };
  return { labels: showLabels, portrait, tilt, cam: upsideDown() ? { ...c, yaw: c.yaw + Math.PI } : c, vw: stageSize[0], vh: stageSize[1] };
};

/** Across the table, a new turn tips the camera down flat, swaps to the other player's seat at
 *  the flat point (where both seats see the same picture), then tips back up for them. */
let tilting = false;
function tiltOver(to: Player) {
  if (tilting) return;
  tilting = true;
  const top = cam.pitch;
  const ease = (t: number) => t * t * (3 - 2 * t);
  const run = (from: number, end: number, ms: number, done: () => void) => {
    const t0 = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      tiltShown = from + (end - from) * ease(t);
      camFrame();
      if (t < 1) setTimeout(step, 16);
      else done();
    };
    step();
  };
  run(top, 0, 320, () => {
    sideShown = to;
    render();
    run(0, top, 380, () => {
      tiltShown = null;
      tilting = false;
      camDone();
    });
  });
}
/** Screen directions are reversed for the far player, whose screen is turned round. */
const flipSign = () => (upsideDown() ? -1 : 1);

/** Extras that are off unless switched on in the menu: hex names on the board, and the corner cube that turns the camera. */
const flag = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const setFlag = (key: string, on: boolean) => { try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* private window */ } };
let showLabels = flag('boc-labels');
let showCube = flag('boc-cube');
/** 2.5D board (tilted, pieces standing) or the flat map; remembered per device. */
const VIEW_KEY = 'boc-view';
let tilt = (() => {
  try {
    return localStorage.getItem(VIEW_KEY) !== 'flat';
  } catch {
    return true;
  }
})();
/** Steps for the + / − buttons; pinching can stop anywhere between the first and last. */
const [ZOOM_MIN, ZOOM_MAX] = [0.7, 18]; // close enough to see the carving on a single piece

type Buyable = keyof ArmyCounts;
/** The side to move's faction decides what it can buy and what the pieces list shows. */
const buyOrder = () => rosterOf(sess.state.current) as Buyable[];
const TRAY_ORDER: UnitTypeId[] = ['king', 'championRider', 'champion', 'championGun', 'heavyCavalry', 'lightCavalry', 'horseArcher', 'chariot', 'wildRider', 'shieldbearer', 'heavyInfantry', 'lineInfantry', 'samurai', 'banner', 'lightInfantry', 'berserker', 'boarder', 'jaguar', 'impi', 'scout', 'deputy', 'ashigaru', 'axeThrower', 'bomber', 'atlatl', 'thrower', 'skirmisher', 'archer', 'crossbow', 'longRifle', 'ballista', 'cannon', 'rocket'];

// ---------- view helpers ----------

const PIPS: Record<number, number[]> = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
};

function die(face: number | null, spin: boolean): string {
  const on = face ? PIPS[face] ?? [] : [];
  const cells = Array.from({ length: 9 }, (_, i) => `<i class="${on.includes(i) ? 'on' : ''}"></i>`).join('');
  return `<div class="die ${spin ? 'spin' : ''} ${face ? '' : 'blank'}">${cells}</div>`;
}

/** Coloured stat chips, always in the same order: attack, defense, move, range. */
function stats(type: UnitTypeId, defenseLeft?: number): string {
  const r = CONFIG.units[type];
  const full = maxHp(type);
  const def = defenseLeft === undefined ? `${full}` : `${defenseLeft}/${full}`;
  return `<span class="stats">
    <span class="st atk" title="${t(lang, 'keyAtk')}"><i>${t(lang, 'tagAtk')}</i>${r.attack > 0 ? r.attack : '–'}</span>
    <span class="st def" title="${t(lang, 'keyDef')}"><i>${t(lang, 'tagDef')}</i>${def}</span>
    <span class="st mov" title="${t(lang, CONFIG.options.unitSpeeds ? 'keyMove' : 'keyMoveFlat')}"><i>${t(lang, 'tagMove')}</i>${CONFIG.options.unitSpeeds ? stepCost(type) : hexesPerPoint(type)}</span>
    ${r.ranged ? `<span class="st rng" title="${t(lang, 'keyRange')}"><i>${t(lang, 'tagRange')}</i>${r.ranged.minRange}–${r.ranged.maxRange}</span>` : ''}
  </span>`;
}

/** What the chip colours mean. */
function statKey(): string {
  return `<div class="key">
    <span><i class="st atk">${t(lang, 'tagAtk')}</i> ${t(lang, 'keyAtk')}</span>
    <span><i class="st def">${t(lang, 'tagDef')}</i> ${t(lang, 'keyDef')}</span>
    <span><i class="st mov">${t(lang, 'tagMove')}</i> ${t(lang, CONFIG.options.unitSpeeds ? 'keyMove' : 'keyMoveFlat')}</span>
    <span><i class="st rng">${t(lang, 'tagRange')}</i> ${t(lang, 'keyRange')}</span>
  </div>`;
}

function unitInfo(s: GameState, id: string): string {
  const u = getUnit(s, id);
  if (!u) return '';
  // Into the Breach's unit panel: the carved portrait, the name, the numbers.
  const pic = figurePic(settings.sides[u.owner], u.type, 'front-left') || unitIcon(u.type, u.owner);
  return `<span class="uport" aria-hidden="true">${pic}</span><span class="ubody"><b class="${u.owner}">${unitName(lang, u.type, u.owner)}</b>${stats(u.type, u.hp)}</span>`;
}

/** Captured pieces, as chess.com shows them: the enemy pieces each side has taken, by type, read from the
 *  battle log (so it follows undo, online games and saved games without any extra data). */
function tally(s: GameState): string {
  const took: Record<Player, UnitTypeId[]> = { red: [], blue: [] };
  for (const e of s.log) {
    if (e.kind !== 'attack' && e.kind !== 'shoot') continue;
    if (e.killed) took[e.player].push(e.target);
    if (e.attackerKilled) took[other(e.player)].push(e.unit);
  }
  if (!took.red.length && !took.blue.length) return '';
  const worth = (p: Player) => took[p].reduce((a, ty) => a + (ty === 'king' ? 0 : CONFIG.army.cost[ty] ?? 0), 0);
  const side = (p: Player) => {
    const counts = new Map<UnitTypeId, number>();
    for (const ty of took[p]) counts.set(ty, (counts.get(ty) ?? 0) + 1);
    const lead = worth(p) - worth(other(p));
    const icons = [...counts].map(([ty, n]) => `<span class="tk">${unitIcon(ty, other(p))}${n > 1 ? `<i>×${n}</i>` : ''}</span>`).join('');
    return `<span class="tside" title="${playerName(lang, p)}"><span class="fdot" style="background:${sideColor(p)}"></span>${icons || '<i class="tnone">–</i>'}${lead > 0 ? `<b>+${lead}</b>` : ''}</span>`;
  };
  return `<div class="tally" aria-label="${t(lang, 'statKills')}">${side('red')}${side('blue')}</div>`;
}

function previewText(s: GameState, targetId: string, p: AttackPreview): string {
  const target = getUnit(s, targetId)!;
  const what = p.kind === 'attack' ? t(lang, 'attack') : t(lang, 'shoot');
  const end = p.kills ? `, ${t(lang, 'kills')}` : ` (${t(lang, 'hp')} ${target.hp} → ${p.hpAfter})`;
  const back = p.counter ? ` · ${t(lang, 'spearsBack')} −${p.counter}` : '';
  const cover = p.covered ? ` · ${t(lang, p.damage > 0 ? 'inCover' : 'inCoverWasted')}` : '';
  return `${what}: ${unitName(lang, target.type, target.owner).toLowerCase()} −${p.damage} ${t(lang, 'hp')}${end} · ${t(lang, 'cost')} ${p.cost}${back}${cover}`;
}

const setupPhase = (s: GameState) => s.phase === 'draft' || s.phase === 'deploy';

function overlay(s: GameState): Overlay {
  const own = selected ? getUnit(s, selected) : undefined;
  const mine = own && own.owner === s.current && s.phase === 'act';
  const targets = new Map<string, AttackPreview>();
  if (mine) for (const x of strikeTargets(s, own.id)) if (!targets.has(x.targetId) && (!aiAim || x.targetId === aiAim)) targets.set(x.targetId, x.preview);
  const battle = s.phase === 'act' || s.phase === 'roll';
  return {
    selected,
    reach: mine && !aiAim ? reachable(s, own.id) : new Map(),
    targets,
    zone: s.phase === 'deploy' ? { owner: s.current, hexes: zoneHexes(s, s.current) } : null,
    // During setup the other side's army stays secret.
    hide: setupPhase(s) ? other(mode === 'online' && net ? net.me : s.current) : null,
    // Only your own finished pieces dim; the other side's turn shows every piece at full strength.
    spent: s.phase === 'act' && !notMine(s) ? spentUnits(s) : new Set(),
    trail: battle ? lastEnemyTurn(s) : { moves: [], kills: [] },
    rings: own && CONFIG.units[own.type].ranged && !setupPhase(s) ? shotZone(s, own) : [],
    danger: dangerOn && battle ? threatZone(s) : [],
    threat: warnOn && battle && !replaying() ? threats(s, sideMine(s)).mine : undefined,
    route: mine && pending ? routeTo(s, own.id, pending) : [],
  };
}

/** On a touch screen the first tap on a hex shows the route and its cost; a second tap moves. */
let pending: Hex | null = null;
/** The enemy the computer is about to hit, ringed on the board for a moment first. */
let aiAim: string | null = null;

/** Threat view: every hex the other side could attack or shoot next turn with an average
 *  roll (10 points), so you can see where it's safe to stand. */
let dangerOn = false;
const AVERAGE_ROLL = 10;
function threatZone(s: GameState): Hex[] {
  const them = other(s.current);
  const theirTurn: GameState = { ...s, current: them, phase: 'act', points: AVERAGE_ROLL, advance: null };
  const hit = new Map<string, Hex>();
  const add = (h: Hex) => {
    if (h.row >= 0 && h.col >= 0 && h.row < s.board.length && h.col < s.board[0].length) hit.set(key(h), h);
  };
  for (const u of s.units.filter((x) => x.owner === them)) {
    const r = CONFIG.units[u.type];
    const stands = [{ hex: u.pos, cost: 0 }, ...reachable(theirTurn, u.id).values()];
    for (const { hex, cost } of stands) {
      const left = AVERAGE_ROLL - cost;
      if (r.attack > 0 && left >= CONFIG.combat.attackCost) for (const n of neighbors(hex)) add(n);
      if (r.ranged && left >= r.ranged.cost) {
        const far = maxRangeAt(s, hex, r.ranged.maxRange);
        for (let row = hex.row - far; row <= hex.row + far; row++)
          for (let col = hex.col - far; col <= hex.col + far; col++) {
            const h = { col, row };
            const d = distance(hex, h);
            if (d >= r.ranged.minRange && d <= far && row >= 0 && col >= 0 && row < s.board.length && col < s.board[0].length && hasLineOfSight(s, hex, h)) add(h);
          }
      }
    }
  }
  return [...hit.values()];
}

/** Next piece: select your next piece that can still do something, and point the camera at it. */
function nextPiece() {
  const s = sess.state;
  if (s.phase !== 'act') return;
  const spent = spentUnits(s);
  const ready = s.units.filter((u) => u.owner === s.current && !spent.has(u.id)).sort((a, b) => a.pos.col - b.pos.col || a.pos.row - b.pos.row);
  if (!ready.length) return;
  const i = ready.findIndex((u) => u.id === selected);
  const u = ready[(i + 1) % ready.length];
  selected = u.id;
  const [x, y] = hexOnMap(u.pos, { portrait });
  cam = { ...cam, x, y };
  saveCam();
  message = null;
  render();
}

/** The side to move's pieces with no move and no hit left for the points remaining. */
/** Nothing left to do this turn: no points, or every own piece is spent (End turn then glows). */
function allSpent(s: GameState): boolean {
  if (s.phase !== 'act') return false;
  const mine = s.units.filter((u) => u.owner === s.current).length;
  return s.points <= 0 || (mine > 0 && spentUnits(s).size >= mine);
}

function spentUnits(s: GameState): Set<string> {
  const out = new Set<string>();
  for (const u of s.units) {
    if (u.owner !== s.current) continue;
    if (reachable(s, u.id).size === 0 && strikeTargets(s, u.id).length === 0) out.add(u.id);
  }
  return out;
}

/** Moves and kills from the other side's most recent turn, read from the log. */
function lastEnemyTurn(s: GameState) {
  const them = other(s.current);
  const moves: { from: Hex; to: Hex; owner: Player; old: boolean }[] = [];
  const kills: Hex[] = [];
  let i = s.log.length - 1;
  // This turn's own moves show at once, so it is clear what has just moved...
  for (; i >= 0 && s.log[i].player === s.current; i--) {
    const e = s.log[i];
    if (e.kind === 'move') moves.push({ from: e.from, to: e.to, owner: e.player, old: false });
  }
  // ...and the other side's last turn stays, fainter, until this turn ends.
  for (; i >= 0 && s.log[i].player === them; i--) {
    const e = s.log[i];
    if (e.kind === 'move') moves.push({ from: e.from, to: e.to, owner: e.player, old: true });
    if ((e.kind === 'attack' || e.kind === 'shoot') && e.killed) kills.push(e.at);
  }
  return { moves, kills };
}

/** Every hex an archer could shoot at from where it stands: in range and not behind forest. */
function shotZone(s: GameState, u: Unit): Hex[] {
  const r = CONFIG.units[u.type].ranged!;
  const out: Hex[] = [];
  for (let row = 0; row < s.board.length; row++)
    for (let col = 0; col < s.board[0].length; col++) {
      const h = { col, row };
      const d = distance(u.pos, h);
      if (d >= r.minRange && d <= maxRangeAt(s, u.pos, r.maxRange) && hasLineOfSight(s, u.pos, h)) out.push(h);
    }
  return out;
}

function legendList(owner: Player): string {
  return (['king', ...rosterOf(owner)] as UnitTypeId[]).map(
    (type) => `<li>${unitIcon(type, owner)}<div><b>${unitName(lang, type, owner)}</b>${stats(type)}</div></li>`,
  ).join('');
}

// ---------- screens ----------

/** The whole army as small pieces, grouped by type: shown at the bottom of the builder. */
function armyPreview(owner: Player): string {
  const total = 1 + buyOrder().reduce((a, t2) => a + (draft[t2] ?? 0), 0);
  const groups = (['king', ...buyOrder()] as UnitTypeId[])
    .map((type) => {
      const n = type === 'king' ? 1 : draft[type as Buyable] ?? 0;
      return n ? `<span class="group">${Array.from({ length: n }, () => unitIcon(type, owner)).join('')}</span>` : '';
    })
    .join('');
  return `<div class="army-head"><b>${t(lang, 'yourArmy')}</b><span>${total} ${t(lang, 'piecesN')}</span></div><div class="army-pieces">${groups}</div>`;
}

/** Most of this piece an army may buy (Champions: one). */
const capOf = (type: Buyable) => CONFIG.army.max?.[type] ?? Infinity;

/** Points the side now building its army may spend (on the siege map Red gets more). */
const budgetNow = () => budgetOf(sess.state.current);

/** Slider track: gold up to the value, pale up to what the budget still allows. */
function sliderFill(type: Buyable): string {
  const price = CONFIG.army.cost[type];
  const max = Math.min(capOf(type), Math.floor(budgetNow() / price));
  const n = draft[type] ?? 0;
  const reach = n + Math.floor((budgetNow() - armyCost(draft)) / price);
  return `--v:${(n / max) * 100}%;--r:${(Math.min(reach, max) / max) * 100}%`;
}

/** Live update while a slider is dragged: rebuilding the sheet would cancel the drag. */
function onSlide(input: HTMLInputElement) {
  const type = input.dataset.type as Buyable;
  const price = CONFIG.army.cost[type];
  const others = armyCost({ ...draft, [type]: 0 });
  const n = Math.min(Number(input.value), capOf(type), Math.floor((budgetNow() - others) / price));
  if (Number(input.value) !== n) input.value = String(n);
  if ((draft[type] ?? 0) === n) return;
  draft = { ...draft, [type]: n };
  const owner = sess.state.current;
  const row = app.querySelector(`[data-row="${type}"]`)!;
  row.querySelector('.count')!.textContent = String(n);
  app.querySelector('#army')!.innerHTML = armyPreview(owner);
  const left = budgetNow() - armyCost(draft);
  app.querySelector('#left')!.textContent = String(left);
  (app.querySelector('#meter') as HTMLElement).style.width = `${((budgetNow() - left) / budgetNow()) * 100}%`;
  for (const t2 of buyOrder()) {
    const r = app.querySelector(`[data-row="${t2}"]`)!;
    (r.querySelector('input') as HTMLInputElement).style.cssText = sliderFill(t2);
    (r.querySelector('[data-act="less"]') as HTMLButtonElement).disabled = !(draft[t2] ?? 0);
    (r.querySelector('[data-act="more"]') as HTMLButtonElement).disabled = CONFIG.army.cost[t2] > left || (draft[t2] ?? 0) >= capOf(t2);
  }
  sound('tick');
}

/** Armies whose carved figures are in the game (one still being carved stays off the list). */
const READY = () => FACTION_ORDER.filter((id) => SPRITES[id]?.king?.front);

/** A piece's carved figure as a picture for menus ('' if this army has none for it). */
function figurePic(fac: string, type: UnitTypeId, view = 'front-left'): string {
  const art = type === 'deputy' ? 'lightInfantry' : type;
  const set = SPRITES[fac]?.[art];
  const v = set?.[view] ? view : set?.front ? 'front' : null;
  // --hs: this figure's height on the board against a typical foot figure (330), so pictures shown side by side
  // keep the same scale (the Russian prince looked bigger than the German grand master on the title screen).
  const hs = Math.min(1.3, Math.max(0.75, (set?.[v ?? '']?.[1] ?? 330) / 330));
  return v ? `<img class="figpic" style="--hs:${hs.toFixed(3)}" src="${import.meta.env.BASE_URL}pieces/${fac}/${art}-${v}.webp?v=${ART_VERSION}" alt="" draggable="false">` : '';
}

function draftSheet(s: GameState): string {
  const spent = armyCost(draft);
  const left = budgetNow() - spent;
  const fac = settings.sides[s.current];
  const rows = buyOrder().map((type) => {
    const n = draft[type] ?? 0;
    const price = CONFIG.army.cost[type];
    const can = price <= left && n < capOf(type);
    return `<li class="ucard ${n ? 'has' : ''}" data-row="${type}">
      <span class="price" title="${t(lang, 'power')}">${price}<small>${t(lang, 'pts')}</small></span>
      <button class="ufig" data-act="more" data-type="${type}" ${can ? '' : 'disabled'} aria-label="${unitName(lang, type, s.current)} +">${figurePic(fac, type) || unitIcon(type, s.current)}</button>
      <b class="name">${unitName(lang, type, s.current)}</b>
      ${stats(type)}
      <div class="step">
        <button data-act="less" data-type="${type}" ${n ? '' : 'disabled'} aria-label="−">−</button>
        <output class="count">${n}</output>
        <button data-act="more" data-type="${type}" ${can ? '' : 'disabled'} aria-label="+">+</button>
      </div>
    </li>`;
  }).join('');
  return `<div class="sheet ${s.current}">
    <div class="sheet-body">
      <h2><span class="dot ${s.current}"></span>${playerName(lang, s.current)}: ${t(lang, 'build')}</h2>
      <div class="budget"><b id="left">${left}</b> / ${budgetNow()} ${t(lang, 'pointsLeft')}
        <div class="meter"><i id="meter" style="width:${(spent / budgetNow()) * 100}%"></i></div></div>
      <div class="sheet-scroll">
      <ul class="buy">
        <li class="ucard king has">
          <span class="price free-badge">0<small>${t(lang, 'pts')}</small></span>
          <span class="ufig">${figurePic(fac, 'king') || unitIcon('king', s.current)}</span>
          <b class="name">${unitName(lang, 'king', s.current)}</b>
          ${stats('king')}
          <div class="step"><span class="free">${t(lang, 'kingFree')}</span></div>
        </li>
        ${rows}
      </ul>
      ${statKey()}
      </div>
      <div class="sheet-foot">
        <div class="army" id="army">${armyPreview(s.current)}</div>
        ${message ? `<p class="error">${message}</p>` : ''}
        <div class="row">
          <button data-act="auto-army">${t(lang, 'autoArmy')}</button>
          <button data-act="auto-all">${t(lang, 'autoAll')}</button>
        </div>
        <button data-act="draft" class="primary wide">${t(lang, 'toDeploy')} →</button>
      </div>
    </div>
  </div>`;
}

/** The optional rules as shown on the New battle screen, with the value each switches to. */
const RULES: { key: keyof Settings['options']; on: Settings['options'][keyof Settings['options']] }[] = [
  { key: 'toughness', on: 2 },
  { key: 'unitSpeeds', on: true },
  { key: 'routAt', on: 0.5 },
  { key: 'shieldWall', on: true },
  { key: 'spears', on: true },
  { key: 'charge', on: true },
  { key: 'kingAura', on: true },
  { key: 'zoneOfControl', on: true },
  { key: 'stepMoves', on: true },
  { key: 'kingsGuard', on: true },
  { key: 'flanking', on: true },
  { key: 'longShotFrom', on: 4 },
  { key: 'volleys', on: 8 },
  { key: 'carryMax', on: 3 },
  { key: 'rerolls', on: 1 },
  { key: 'firstTurnBonus', on: 2 },
  { key: 'rainRange', on: true },
  { key: 'snowCavalry', on: true },
  { key: 'fogCap', on: true },
  { key: 'forestCover', on: true },
];

/** Which side's army the New battle screen is choosing, and whether the detailed rules are open. */
let pickSide: Player = 'red';
let rulesOpen = false;
// ---- setup summary state: which sub-page of New battle is open, its slide, the army being shown, the title-screen gallery ----
let setupPage: string | null = null;
let setupAnim = '';
let apFac: FactionId | null = null;
let galleryOpen = false;
/** A newly opened page starts at its top (render keeps the old scroll otherwise). */
const toTop = () => {
  const el = app.querySelector<HTMLElement>('.sheet-scroll');
  if (el) el.scrollTop = 0;
};
initShowcase();

/** Small white glyphs (24 x 24) for the rule rows, drawn on a coloured square. */
const RULE_ICON: Record<keyof Settings['options'], string> = {
  toughness: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  shieldWall: '<path d="M3 5h8v5q0 5-4 7q-4-2-4-7zM13 5h8v5q0 5-4 7q-4-2-4-7z"/>',
  spears: '<path d="M5 19L17 7M17 7l3-3-1 5zM8 19l-3 0 0-3" fill="none"/>',
  charge: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
  kingAura: '<path d="M5 15V8l3.5 3L12 6l3.5 5L19 8v7z"/><path d="M3 19h18" fill="none"/>',
  unitSpeeds: '<path d="M4 17h4l3-8 3 8h6" fill="none"/><circle cx="6" cy="8" r="2.2"/>',
  runLimit: '<circle cx="12" cy="13" r="8" fill="none"/><path d="M12 13l4-4M10 3h4" fill="none"/>',
  zoneOfControl: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z" fill="none"/><path d="M8 12h8" fill="none"/>',
  longShotFrom: '<circle cx="12" cy="12" r="8" fill="none"/><circle cx="12" cy="12" r="3"/>',
  volleys: '<path d="M6 21L18 3M9 21L21 3M3 21L15 3" fill="none"/>',
  carryMax: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" fill="none"/>',
  firstTurnBonus: '<path d="M12 5v14M5 12h14" fill="none"/>',
  routAt: '<path d="M6 21V3M6 4h11l-3 4 3 4H6" />',
  flanking: '<path d="M3 7l6 5-6 5M21 7l-6 5 6 5" fill="none"/><circle cx="12" cy="12" r="2.5"/>',
  stepMoves: '<path d="M5 19h4v-4h4v-4h4V7h3" fill="none"/>',
  rerolls: '<path d="M19 8a8 8 0 1 0 1 6" fill="none"/><path d="M20 3v5h-5"/>',
  kingsGuard: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" fill="none"/><path d="M8.5 13.5V10l2 1.5L12 9l1.5 2.5 2-1.5v3.5z"/>',
  rainRange: '<path d="M7 13a4 4 0 0 1-.5-8 5.5 5.5 0 0 1 10.6 1.5A3.3 3.3 0 0 1 17 13z"/><path d="M8 16l-1 4M12 16l-1 4M16 16l-1 4" fill="none"/>',
  snowCavalry: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" fill="none"/>',
  fogCap: '<path d="M3 8c3-2 6 2 9 0s6-2 9 0M3 13c3-2 6 2 9 0s6-2 9 0M3 18c3-2 6 2 9 0s6-2 9 0" fill="none"/>',
  forestCover: '<path d="M12 3l6 8h-3l4 6H5l4-6H6z"/><path d="M12 17v4" fill="none"/>',
  battleLines: '<path d="M4 5v14M20 5v14M8 12h8" fill="none"/>',
};

const RULE_GROUPS: { title: Key; color: string; keys: (keyof Settings['options'])[] }[] = [
  { title: 'groupCombat', color: '#c2453a', keys: ['toughness', 'flanking', 'shieldWall', 'spears', 'charge', 'kingAura', 'kingsGuard'] },
  { title: 'groupRanged', color: '#3f8f5a', keys: ['longShotFrom', 'volleys', 'forestCover'] },
  { title: 'groupMove', color: '#3a6fb0', keys: ['stepMoves', 'unitSpeeds', 'zoneOfControl'] },
  { title: 'groupTurn', color: '#a8811a', keys: ['routAt', 'carryMax', 'rerolls', 'firstTurnBonus'] },
  { title: 'groupWeather', color: '#5a7f9e', keys: ['rainRange', 'snowCavalry', 'fogCap'] },
];

/** Map previews still to paint after this render: picture key -> how to grow the board and how wide to paint it. */
const thumbJobs = new Map<string, { board: () => GameConfig['board']; px: number }>();
/** An empty picture to hold a preview's place (and size) while it paints. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAIBAAA=';

/** Fixed maps have a carved-wood diorama picture (made in _art/maptile_gen.py, placed by _art/maptile_place.py,
 *  which also stamps TILE_V). Until it has loaded, or if it is missing, the painted preview stands in. */
const TILE_V = 'dd1c5d06';
const TILE_MAPS = new Set<string>(['river', 'fords', 'noford', 'island', 'pass', 'longwood', 'lake', 'ridge', 'open', 'forest', 'village', ...Object.values(HOME)]);
const tileUrl = (m: string) => `${import.meta.env.BASE_URL}map/tile-${m}.webp?v=${TILE_V}`;
/** 'ok' once the picture has loaded, 'missing' if it failed, 'loading' meanwhile. */
const tileState = new Map<string, 'loading' | 'ok' | 'missing'>();
function loadTile(m: string) {
  if (tileState.has(m)) return;
  tileState.set(m, 'loading');
  const im = new Image();
  im.onload = () => {
    tileState.set(m, 'ok');
    app.querySelectorAll<HTMLImageElement>(`img[data-tile="${CSS.escape(m)}"]`).forEach((el) => (el.src = im.src));
  };
  im.onerror = () => tileState.set(m, 'missing');
  im.src = tileUrl(m);
}

/** The map as a little picture of the real board (painted once, then kept). `px` is the picture's width. */
function mapThumb(m: MapId, px = 240): string {
  const aspectStd = thumbAspect({ cols: 25, rows: 15 }).toFixed(4);
  if (TILE_MAPS.has(m)) {
    loadTile(m);
    if (tileState.get(m) === 'ok') return `<img class="mthumb" data-tile="${m}" src="${tileUrl(m)}" alt="" draggable="false" style="aspect-ratio:${aspectStd}">`;
  }
  // Random: the map this seed and land grow into (a question mark until one is chosen).
  if (m === 'random' && settings.map !== 'random') return `<svg viewBox="0 0 72 44" width="72" height="44" aria-hidden="true"><rect width="72" height="44" rx="6" fill="#6f9a4a"/><text x="36" y="30" text-anchor="middle" font-size="22" font-weight="700" fill="#f1e8d2">?</text></svg>`;
  const large = m === 'random' && settings.size === 'large';
  const key = m === 'random' ? `random|${settings.mapSeed}|${settings.mapStyle ?? 'valley'}|${settings.mapKnobs ? KNOB_IDS.map((id) => settings.mapKnobs![id]).join('') : 'preset'}|${settings.mapBiome ?? 'meadow'}|${large ? 'L' : 'S'}|${px}` : `${m}|${px}`;
  const done = cachedThumb(key);
  if (!done) {
    const gen = { seed: settings.mapSeed, style: settings.mapStyle, size: large ? ('large' as const) : ('standard' as const), knobs: settings.mapKnobs, biome: settings.mapBiome };
    thumbJobs.set(key, { board: () => (m === 'random' ? boardFor('random', gen) : boardFor(m)), px });
  }
  const aspect = thumbAspect(large ? { cols: 33, rows: 19 } : { cols: 25, rows: 15 });
  const tileAttr = TILE_MAPS.has(m) ? ` data-tile="${m}"` : '';
  return `<img class="mthumb" data-thumb="${key}"${tileAttr} src="${done ?? BLANK}" alt="" draggable="false" style="aspect-ratio:${aspect.toFixed(4)}">`;
}

/** Paints the previews the last render asked for, one at a time so the menu stays smooth, and puts each in place. */
let thumbsBusy = false;
async function fillThumbs() {
  if (thumbsBusy) return;
  thumbsBusy = true;
  try {
    while (thumbJobs.size) {
      const [key, job] = thumbJobs.entries().next().value as [string, { board: () => GameConfig['board']; px: number }];
      thumbJobs.delete(key);
      // Only what is on screen now (a re-roll may have replaced it already).
      if (!app.querySelector(`img[data-thumb="${CSS.escape(key)}"]`)) continue;
      // A fixed map whose carved-wood picture has arrived needs no painted stand-in.
      const tileOf = key.split('|')[0];
      if (tileState.get(tileOf) === 'ok') continue;
      const url = await paintThumb(key, job.board(), job.px * Math.min(2, Math.max(1, devicePixelRatio || 1)));
      if (url) app.querySelectorAll<HTMLImageElement>(`img[data-thumb="${CSS.escape(key)}"]`).forEach((im) => { if (tileState.get(tileOf) !== 'ok') im.src = url; });
      await new Promise((ok) => setTimeout(ok, 0));
    }
  } finally {
    thumbsBusy = false;
  }
}

// ---------- biomes: home maps and the land a random map grows in ----------
/** The random map's land: a row of biome chips in "Customize land". */
function biomeKnob(): string {
  const cur = settings.mapBiome ?? 'meadow';
  const chips = BIOME_IDS.map((id) => `<button role="radio" data-act="map-biome" data-value="${id}" class="${id === cur ? 'on' : ''}" aria-checked="${id === cur}" style="display:inline-flex;align-items:center;gap:5px"><i aria-hidden="true" style="width:10px;height:10px;border-radius:50%;background:${BIOMES[id].swatch};box-shadow:0 0 0 1px rgba(0,0,0,.35)"></i>${BIOMES[id].name[lang]}</button>`).join('');
  return `<div class="knob"><span>${lang === 'ru' ? 'Края' : 'Land'}</span><div class="seg" role="radiogroup" style="flex-wrap:wrap">${chips}</div></div>`;
}
/** "Home ground": a tile that plays on the first army's own home map, then every army's home map. */
function homeSection(): string {
  const mine = HOME[settings.sides.red];
  const tile = (value: string, thumbOf: string, label: string, sub = '') =>
    `<button data-act="set" data-field="map" data-value="${value}" class="mtile ${settings.map === value ? 'on' : ''}" aria-pressed="${settings.map === value}">${mapThumb(thumbOf as MapId)}<span>${label}${sub ? `<small style="display:block;opacity:.7;font-weight:400">${sub}</small>` : ''}</span></button>`;
  const all = FACTION_ORDER.filter((f) => READY().includes(f)).map((f) => tile(HOME[f], HOME[f], HOME_NAMES[HOME[f]][lang], FACTIONS[f].name[lang])).join('');
  return `<h3>${lang === 'ru' ? 'Родная земля' : 'Home ground'}</h3>
      <div class="mtiles">${tile('home', mine, lang === 'ru' ? 'Дом армии' : 'Army home', HOME_NAMES[mine][lang])}${all}</div>`;
}

/** "Customize land" is open on the random map panel. */
let landOpen = false;

/** Random map: the kind of land to grow, rough amounts of each thing (Minecraft-style), a bigger look at the map,
 *  and a button for a different one. A preset sets the amounts; moving one makes the land "Custom". */
function randomMapPanel(): string {
  const style = settings.mapStyle ?? 'valley';
  const custom = !!settings.mapKnobs;
  const knobs: MapKnobs = settings.mapKnobs ?? PRESET_KNOBS[style];
  const chips = MAP_STYLES.map((st) => {
    const on = !custom && st === style;
    return `<button role="radio" data-act="map-style" data-value="${st}" class="${on ? 'on' : ''}" aria-checked="${on}" style="font-size:12.5px;padding:8px 2px">${t(lang, `style${st[0].toUpperCase()}${st.slice(1)}` as Key)}</button>`;
  }).join('');
  const cap = (k: string) => k[0].toUpperCase() + k.slice(1);
  const rows = KNOB_IDS.map((id: KnobId) => {
    const steps = Array.from({ length: KNOB_STEPS[id] }, (_, i) => {
      const on = knobs[id] === i;
      return `<button role="radio" data-act="map-knob" data-knob="${id}" data-value="${i}" class="${on ? 'on' : ''}" aria-checked="${on}">${t(lang, `knob${cap(id)}${i}` as Key)}</button>`;
    }).join('');
    return `<div class="knob"><span>${t(lang, `knob${cap(id)}` as Key)}</span><div class="seg" role="radiogroup" aria-label="${t(lang, `knob${cap(id)}` as Key)}">${steps}</div></div>`;
  }).join('');
  return `<div class="mgen" style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
    <div class="seg" role="radiogroup" aria-label="${t(lang, 'mapStyle')}">${chips}</div>
    <button data-act="land-open" class="disclose ${landOpen ? 'open' : ''}" aria-expanded="${landOpen}" style="margin-top:0">
      <span>${t(lang, 'customizeLand')}</span><small>${custom ? t(lang, 'presetCustom') : t(lang, `style${cap(style)}` as Key)}</small><i aria-hidden="true">›</i>
    </button>
    ${landOpen ? `<div class="knobs">${rows}${biomeKnob()}</div>` : ''}
    <div style="display:flex;gap:10px;align-items:center">
      <div class="mbig">${mapThumb('random', 480)}</div>
      <button data-act="map-reroll" style="flex:none;display:flex;flex-direction:column;align-items:center;gap:4px;padding:10px 12px"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>${t(lang, 'rerollMap')}</button>
    </div>
  </div>`;
}

function setupScreen(): string {
  // ---- setup summary: "View army" showcase sits over the whole sheet ----
  if (apFac) return armyShowcase(lang, apFac, icon('back'), { side: mode === 'online' ? 'red' : pickSide });
  const isDad = RULES.every((r) => settings.options[r.key] === DADS_RULES[r.key]);
  const isRec = RULES.every((r) => settings.options[r.key] === RECOMMENDED[r.key]);
  const onCount = RULES.filter((r) => settings.options[r.key] !== DADS_RULES[r.key]).length;

  // The face-off: each side's coat of arms, name and who plays it. Tap one to pick its army.
  const side = (p: Player, who: string) => {
    const f = FACTIONS[settings.sides[p]];
    const on = pickSide === p;
    return `<button data-act="pick-side" data-side="${p}" class="vs-card ${on ? 'on' : ''}" aria-pressed="${on}" style="--fc:${f.color}">
      <span class="vs-who">${who}</span>${figurePic(settings.sides[p], 'king', 'front') || f.emblem}<b>${f.name[lang]}</b></button>`;
  };
  const tile = (id: FactionId) => {
    const f = FACTIONS[id];
    const mine = settings.sides[pickSide] === id;
    const theirs = settings.sides[other(pickSide)] === id;
    return `<div class="ftile-wrap"><button data-act="faction" data-side="${pickSide}" data-value="${id}" class="ftile ${mine ? 'on' : ''} ${theirs ? 'taken' : ''}" aria-pressed="${mine}" style="--fc:${f.color}">
      ${figurePic(id, 'king', 'front') || f.emblem}<span>${f.name[lang]}</span></button><button data-act="ap-open" data-value="${id}" class="ftile-view" title="${st(lang, 'viewArmy')}" aria-label="${st(lang, 'viewArmy')}: ${f.name[lang]}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></div>`;
  };
  // Armies grouped by the age they fought in.
  const tiles = ERAS.filter((era) => READY().some((id) => ERA_OF[id] === era)).map((era) => `<h4 class="era">${t(lang, `era${era[0].toUpperCase()}${era.slice(1)}` as Key)}</h4><div class="ftiles">${READY().filter((id) => ERA_OF[id] === era).map(tile).join('')}</div>`).join('');

  const mapTiles = (['river', 'fords', 'noford', 'island', 'pass', 'longwood', 'lake', 'ridge', 'open', 'forest', 'village', 'random'] as MapId[]) // Two castles and Castle siege are shelved until walls are truly 3D (David, 2026-11-18); Marsh road is shelved until it looks right; High ground back with raised terraces (David, 2026-11-17)
    .map((m) => {
      const label = t(lang, `map${m[0].toUpperCase()}${m.slice(1)}` as Key);
      return `<button data-act="set" data-field="map" data-value="${m}" class="mtile ${settings.map === m ? 'on' : ''}" aria-pressed="${settings.map === m}">${mapThumb(m)}<span>${label}</span></button>`;
    })
    .join('');

  const preset = (value: string, on: boolean, title: string, sub: string, icon: string) =>
    `<button data-act="preset" data-value="${value}" class="preset ${on ? 'on' : ''}" aria-pressed="${on}">
      <span class="picon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22">${icon}</svg></span>
      <b>${title}</b><small>${sub}</small></button>`;

  const groups = RULE_GROUPS.map((g) => `
      <div class="rgroup"><h4>${t(lang, g.title)}</h4><div class="rlist">${g.keys
        .map((k) => {
          const on = settings.options[k] !== DADS_RULES[k];
          return `<button data-act="opt" data-key="${k}" class="rule ${on ? 'on' : ''}" role="switch" aria-checked="${on}">
            <span class="ricon" style="--ic:${g.color}" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18">${RULE_ICON[k]}</svg></span>
            <span class="what"><b>${t(lang, `rule_${k}` as Key)}</b><small>${t(lang, `ruleHelp_${k}` as Key)}</small></span>
            <span class="switch" aria-hidden="true"><i></i></span>
          </button>`;
        })
        .join('')}</div></div>`).join('');

  // ---- setup summary: one screen of rows (iOS Settings), each opening its own page with a back arrow ----
  const cap = (x: string) => x[0].toUpperCase() + x.slice(1);
  const mapName = settings.map === 'home' ? st(lang, 'armyHome') : HOME_NAMES[settings.map]?.[lang] ?? t(lang, `map${cap(settings.map)}` as Key);
  const mapPic = `<span class="srow-pic">${mapThumb((settings.map === 'home' ? HOME[settings.sides.red] : settings.map) as MapId, 120)}</span>`;
  const time = settings.time ?? 'day';
  const kind = settings.weather ?? 'clear';
  const wxVal = `${t(lang, (time === 'random' ? 'wx_random' : `time_${time}`) as Key)}, ${t(lang, `wx_${kind}` as Key).toLowerCase()}`;
  const diffs: [string, string][] = [['easy', t(lang, 'diffEasy')], ['normal', t(lang, 'diffNormal')], ['hard', t(lang, 'diffHard')]];
  const budgets: [string, string, string?][] = [['20', `20 ${st(lang, 'points')}`, t(lang, 'skirmish')], ['30', `30 ${st(lang, 'points')}`], ['50', `50 ${st(lang, 'points')}`], ['80', `80 ${st(lang, 'points')}`, t(lang, 'epic')]];
  const sizes: [string, string][] = [['standard', t(lang, 'sizeStandard')], ['large', t(lang, 'sizeLarge')]];
  const lines: [string, string, string?][] = [['close', t(lang, 'linesClose'), t(lang, 'linesCloseSub')], ['normal', t(lang, 'linesNormal'), t(lang, 'linesNormalSub')], ['far', t(lang, 'linesFar'), t(lang, 'linesFarSub')]];
  const dice: [string, string][] = [['1d6', t(lang, 'dice1')], ['2d6', t(lang, 'dice2')], ['3d6', t(lang, 'dice3')], ['fixed', `${t(lang, 'always')} ${fixedPoints(settings)}`]];
  const valOf = (list: [string, string, string?][], v: string) => list.find((x) => x[0] === v)?.[1] ?? v;
  const rulesVal = isRec ? t(lang, 'presetRecommended') : isDad ? t(lang, 'presetDad') : `${t(lang, 'presetCustom')} · ${onCount}`;

  const pages: Record<string, [string, () => string]> = {
    army: [st(lang, 'army'), () => `${mode === 'online' ? '' : `<div class="seg sub-tabs" role="radiogroup">${(['red', 'blue'] as Player[]).map((p) => `<button role="radio" data-act="pick-side" data-side="${p}" class="${pickSide === p ? 'on' : ''}" aria-checked="${pickSide === p}">${p === 'red' ? (mode === 'pvp' ? t(lang, 'sideFirst') : t(lang, 'sideYou')) : mode === 'ai' ? t(lang, 'sideComputer') : t(lang, 'sideSecond')}</button>`).join('')}</div>`}
      ${tiles}
      <p class="blurb">${FACTIONS[settings.sides[pickSide]].blurb[lang]}</p>
      ${FACTIONS[settings.sides[pickSide]].champion ? `<p class="blurb champ">${FACTIONS[settings.sides[pickSide]].champion![lang]}</p>` : ''}`],
    map: [t(lang, 'map'), () => `<div class="mtiles" style="margin-top:12px">${mapTiles}</div>${settings.map === 'random' ? randomMapPanel() : ''}${homeSection()}`],
    rules: [t(lang, 'rules'), () => `<div class="presets" style="margin-top:14px">
        ${preset('recommended', isRec, t(lang, 'presetRecommended'), t(lang, 'presetRecSub'), '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" fill="currentColor"/>')}
        ${preset('dad', isDad, t(lang, 'presetDad'), t(lang, 'presetSimpleSub'), '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="currentColor"/>')}
      </div>
      <h3>${t(lang, 'customize')} <small style="letter-spacing:0;text-transform:none;font-weight:500">${onCount} ${t(lang, 'rulesOnCount')}</small></h3>
      <div class="rgroups" style="margin-top:0">${groups}</div>`],
    weather: [t(lang, 'weatherTitle'), () => weatherPanel(settings, lang).replace(/^\s*<h3>[^<]*<\/h3>/, '')],
    budget: [st(lang, 'armySize'), () => choiceList('budget', budgets, String(settings.budget))],
    difficulty: [t(lang, 'difficulty'), () => choiceList('difficulty', diffs, settings.difficulty ?? 'normal')],
    size: [t(lang, 'boardSize'), () => choiceList('size', sizes, settings.size ?? 'standard')],
    lines: [t(lang, 'battleLines'), () => choiceList('lines', lines, settings.options.battleLines ?? 'normal')],
    dice: [t(lang, 'pointsEachTurn'), () => choiceList('dice', dice, settings.dice)],
  };
  const page = setupPage && pages[setupPage] ? setupPage : null;
  const anim = setupAnim;
  setupAnim = '';

  const rowsHtml = `
        ${summaryRow('map', t(lang, 'map'), mapName, mapPic)}
        ${summaryRow('budget', st(lang, 'armySize'), `${settings.budget} ${st(lang, 'points')}`)}
        ${summaryRow('rules', t(lang, 'rules'), rulesVal)}
        ${summaryRow('weather', t(lang, 'weatherTitle'), wxVal)}
        ${mode === 'ai' ? summaryRow('difficulty', t(lang, 'difficulty'), valOf(diffs, settings.difficulty ?? 'normal')) : ''}
        ${summaryRow('size', t(lang, 'boardSize'), valOf(sizes, settings.size ?? 'standard'))}
        ${summaryRow('lines', t(lang, 'battleLines'), valOf(lines, settings.options.battleLines ?? 'normal'))}
        ${summaryRow('dice', t(lang, 'pointsEachTurn'), valOf(dice, settings.dice))}
`;
  const summary = `
      <div class="vs">
        ${side('red', mode === 'pvp' ? t(lang, 'sideFirst') : t(lang, 'sideYou'))}
        ${mode === 'online' ? `<span class="vs-mid">${t(lang, 'vs')}</span>` : `<button data-act="swap-sides" class="vs-swap" title="${t(lang, 'swapSides')}" aria-label="${t(lang, 'swapSides')}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/></svg></button>`}
        ${mode === 'online' ? `<div class="vs-card" style="--fc:#6b6b6b"><span class="vs-who">${t(lang, 'sideOpponent')}</span><b style="font-size:34px;line-height:48px">?</b><b>${t(lang, 'theyPick')}</b></div>` : side('blue', mode === 'ai' ? t(lang, 'sideComputer') : t(lang, 'sideSecond'))}
      </div>
      <div class="srows">${rowsHtml}</div>`;
  // Desktop: a sub-page keeps every setting in a left column (Civ VI / Total War setup screens), not a full-screen push.
  const nav = page && desktop
    ? `<nav class="setup-nav" aria-label="${t(lang, 'newBattle')}"><button data-act="setup-sub-back" class="srow nav-home"><span class="srow-l">${t(lang, 'newBattle')}</span></button>${(summaryRow('army', st(lang, 'army'), FACTIONS[settings.sides[pickSide]].name[lang]) + rowsHtml).replace(`data-page="${page}" class="srow"`, `data-page="${page}" class="srow on" aria-current="page"`)}</nav>`
    : '';

  return `<div class="sheet"><div class="sheet-body setup ${nav ? 'has-nav' : ''}">
    <h2><button data-act="${page ? 'setup-sub-back' : 'setup-back'}" class="ghost back" aria-label="${t(lang, 'back')}">${icon('back')}</button>${page ? pages[page][0] : t(lang, 'newBattle')}</h2>
    ${nav}<div class="sheet-scroll ${page ? `setup-sub sub-${page}` : 'setup-sum'} ${anim}">${page ? pages[page][1]() : summary}</div>
    <div class="sheet-foot"><button data-act="begin" class="primary wide">${t(lang, mode === 'online' ? 'hostGameBtn' : 'startBattle')}</button></div>
  </div></div>`;
}

/** The game's mark (same as the app icon): a shield split crimson and black, crown and cross. */
const LOGO = `<svg viewBox="0 0 60 70" width="96" height="112" aria-hidden="true">
  <defs><clipPath id="logo-clip"><path d="M4 4H56V30Q56 56 30 66Q4 56 4 30Z"/></clipPath></defs>
  <g clip-path="url(#logo-clip)"><rect x="0" y="0" width="30" height="70" fill="#a8201a"/><rect x="30" y="0" width="30" height="70" fill="#1b1b1d"/></g>
  <path d="M4 4H56V30Q56 56 30 66Q4 56 4 30Z" fill="none" stroke="#e1b12c" stroke-width="3"/>
  <path d="M10 33V25L13.5 28.5L17 22L20.5 28.5L24 25V33Z" fill="#e1b12c"/>
  <path d="M40 22H46V26.5H50.5V32.5H46V37H40V32.5H35.5V26.5H40Z" fill="#f4f1e8"/>
</svg>`;

function startScreen(): string {
  const pick = (l: Lang, label: string) =>
    `<button data-act="set-lang" data-lang="${l}" class="${lang === l ? 'on' : ''}" aria-pressed="${lang === l}">${label}</button>`;
  const icon = (d: string) => `<span class="cicon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22">${d}</svg></span>`;
  const people = '<circle cx="8" cy="8" r="3.2"/><circle cx="16.5" cy="8" r="3.2"/><path d="M2.5 19c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2zM11.5 19c.5-3 2.4-5.2 5-5.2 2.7 0 4.6 1.8 5.2 5.2z"/>';
  const robot = '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="3.5" r="1.6"/><circle cx="9.3" cy="13.5" r="1.5" fill="var(--panel-2)"/><circle cx="14.7" cy="13.5" r="1.5" fill="var(--panel-2)"/>';
  // Continue goes straight back into the game last on screen (Main menu saved it); the full list is one tap further.
  const slots = listSlots<SlotInfo>(store);
  const cur = slotId ? slots.find((m) => m.id === slotId && m.info && FACTIONS[m.info.red] && FACTIONS[m.info.blue]) : undefined;
  const curText = cur ? `${FACTIONS[cur.info.red].name[lang]} ${t(lang, 'vs')} ${FACTIONS[cur.info.blue].name[lang]}` : '';
  return `<div class="cover"><div class="card start">
    <div class="seg langs" role="radiogroup">${pick('en', 'English')}${pick('ru', 'Русский')}</div>
    <div class="hero">
      <div class="duel">${figurePic(settings.sides.red, 'king', 'front-right')}<div class="logo">${LOGO}</div>${figurePic(settings.sides.blue, 'king', 'front-left')}</div>
      <h2>${t(lang, 'title')}</h2>
      <p>${t(lang, 'chooseMode')}</p>
    </div>
    <div class="modes">
    ${slots.length ? `<button data-act="${cur ? 'continue' : 'saves'}" class="choice continue">${icon('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>')}<span class="ctext"><b>${t(lang, 'continueGame')}</b><span>${curText || t(lang, 'continueSub')}</span></span><i aria-hidden="true">›</i></button>` : ''}
    ${cur && slots.length > 1 ? `<button data-act="saves" class="ghost saves-link">${t(lang, 'savedGames')} · ${slots.length}</button>` : ''}
    <button data-act="mode" data-mode="pvp" class="choice">${icon(people)}<span class="ctext"><b>${t(lang, 'twoPlayers')}</b><span>${t(lang, 'twoPlayersSub')}</span></span><i aria-hidden="true">›</i></button>
    <button data-act="mode" data-mode="ai" class="choice">${icon(robot)}<span class="ctext"><b>${t(lang, 'vsComputer')}</b><span>${t(lang, 'vsComputerSub')}</span></span><i aria-hidden="true">›</i></button>
    <button data-act="mode" data-mode="online" class="choice">${icon('<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17" fill="none" stroke="currentColor" stroke-width="2"/>')}<span class="ctext"><b>${t(lang, 'playOnline')}</b><span>${t(lang, 'playOnlineSub')}</span></span><i aria-hidden="true">›</i></button>
    <button data-act="campaign" class="choice">${icon('<path d="M5 3v18M5 4h11l-2.5 4L16 12H5" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>')}<span class="ctext"><b>${campaignText(lang).campaign}</b><span>${campaignText(lang).campaignSub}</span></span><i aria-hidden="true">›</i></button>
    <button data-act="armies" class="choice">${icon('<path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z"/>')}<span class="ctext"><b>${st(lang, 'armies')}</b><span>${st(lang, 'armiesSub')}</span></span><i aria-hidden="true">›</i></button>
    </div>
  </div></div>`;
}

/** Online: the host's card with the link to send. */
function inviteScreen(): string {
  return `<div class="cover"><div class="card start">
    <div class="hero"><h2>${t(lang, 'inviteTitle')}</h2><p>${t(lang, 'inviteText')}</p></div>
    <div class="join-code" aria-live="polite"><small>${t(lang, 'joinCode')}</small><b>${joinCode ?? '…'}</b>${joinCode ? `<button data-act="copy-code" class="ghost">${t(lang, 'copyCode')}</button>` : ''}</div>
    <input class="invite-url" readonly value="${inviteUrl()}" onclick="this.select()" aria-label="${t(lang, 'inviteLink')}">
    <button data-act="copy-link" class="primary wide">${t(lang, 'copyLink')}</button>
    ${typeof navigator.share === 'function' ? `<button data-act="share" class="wide">${t(lang, 'shareLink')}</button>` : ''}
    <button data-act="invite-ok" class="ghost wide">${t(lang, 'inviteContinue')}</button>
  </div></div>`;
}

// ---------- online: host or join ----------
/** Play online, first step: two big choices before any setup. */
function onlineChoiceScreen(): string {
  const ic = (d: string) => `<span class="cicon" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22">${d}</svg></span>`;
  return `<div class="cover"><div class="card start online-pick">
    <div class="chero"><button data-act="online-back" class="ghost">‹ ${t(lang, 'back')}</button></div>
    <div class="hero"><h2>${t(lang, 'playOnline')}</h2><p>${t(lang, 'onlineChooseSub')}</p></div>
    <button data-act="online-host" class="choice big">${ic('<path d="M5 3v18M5 4h11l-2.5 4L16 12H5" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>')}<span class="ctext"><b>${t(lang, 'hostGame')}</b><span>${t(lang, 'hostGameSub')}</span></span><i aria-hidden="true">›</i></button>
    <button data-act="online-join" class="choice big">${ic('<rect x="3" y="7" width="18" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 12h.01M11 12h.01M15 12h.01" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>')}<span class="ctext"><b>${t(lang, 'joinWithCode')}</b><span>${t(lang, 'joinSub')}</span></span><i aria-hidden="true">›</i></button>
  </div></div>`;
}

/** Play online → Join with code: just the code box. */
function joinScreen(): string {
  return `<div class="cover"><div class="card start join-card">
    <div class="chero"><button data-act="join-back" class="ghost">‹ ${t(lang, 'back')}</button></div>
    <div class="hero"><h2>${t(lang, 'joinWithCode')}</h2><p>${t(lang, 'joinSub')}</p></div>
    <div class="join-box"><div class="join-row"><input class="join-input" maxlength="7" value="${joinText}" placeholder="ABCDE" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" inputmode="text" aria-label="${t(lang, 'joinWithCode')}"></div>
    <button data-act="join-code" class="primary wide" ${joinBusy ? 'disabled' : ''}>${joinBusy ? t(lang, 'connecting') : t(lang, 'join')}</button>
    ${joinErr ? `<p class="join-err">${joinErr}</p>` : ''}</div>
  </div></div>`;
}

// ---------- saved games: the list ----------
/** Online games in the list: whose turn it is right now, asked of the server when the list opens. */
const liveTurn = new Map<string, Player | 'over'>();
function refreshLiveTurns() {
  for (const m of listSlots<SlotInfo>(store)) {
    const id = m.info?.net;
    if (!id) continue;
    fetchGame(id).then((r) => {
      if (!r) return;
      const st = (JSON.parse(r.state) as { state: GameState }).state;
      liveTurn.set(id, st.phase === 'over' ? 'over' : st.current);
      if (savesOpen) render();
    }, () => {});
  }
}

function savesScreen(): string {
  const now = Date.now();
  const rows = listSlots<SlotInfo>(store).filter((m) => m.info && FACTIONS[m.info.red] && FACTIONS[m.info.blue]).map((m) => {
    const i = m.info;
    const r = FACTIONS[i.red], b = FACTIONS[i.blue];
    const sc = i.scenario ? scenarioById(i.scenario) : undefined;
    const modeText = sc ? `${campaignText(lang).campaign}: ${sc.title[lang]}` : t(lang, i.mode === 'ai' ? 'modeAi' : i.mode === 'online' ? 'modeOnline' : 'modePvp');
    const live = i.net ? liveTurn.get(i.net) : undefined;
    const over = i.phase === 'over' || live === 'over';
    const stage = over ? t(lang, 'slotOver') : i.phase === 'draft' || i.phase === 'deploy' ? t(lang, 'slotSetup') : `${t(lang, 'slotTurn')} ${i.turn}`;
    const cur = live && live !== 'over' ? live : i.current;
    const whose = i.mode === 'online' && i.me && !over ? `<span class="slot-turn ${cur === i.me ? 'mine' : ''}">${t(lang, cur === i.me ? 'slotYours' : 'slotTheirs')}</span>` : '';
    const isNow = m.id === slotId && !choosing;
    const asking = confirmDelete === m.id;
    return `<li class="slot ${isNow ? 'now' : ''}">
      <div class="slot-crests"><span style="--fc:${r.color}">${r.emblem}</span><span style="--fc:${b.color}">${b.emblem}</span></div>
      <div class="slot-text"><b>${r.name[lang]} <span class="hero-vs">${t(lang, 'vs')}</span> ${b.name[lang]}</b>
        <small>${modeText} · ${stage} · ${isNow ? t(lang, 'slotNow') : agoText(lang, now - m.at)}</small>${whose}</div>
      ${asking
        ? `<div class="slot-ask"><p>${t(lang, 'deleteAsk')}</p><div class="slot-btns"><button data-act="slot-delete-yes" data-value="${m.id}" class="danger">${t(lang, 'deleteGame')}</button><button data-act="slot-delete-no" class="ghost">${t(lang, 'keepGame')}</button></div></div>`
        : `<div class="slot-btns"><button data-act="slot-resume" data-value="${m.id}" class="primary">${t(lang, 'resume')}</button><button data-act="slot-delete" data-value="${m.id}" class="ghost">${t(lang, 'deleteGame')}</button></div>`}
    </li>`;
  }).join('');
  return `<div class="cover saves"><div class="card start saves-card">
    <div class="chero"><button data-act="saves-back" class="ghost">‹ ${t(lang, 'back')}</button><h2>${t(lang, 'savedGames')}</h2><p>${t(lang, 'savesSub')}</p></div>
    ${rows ? `<ol class="slots">${rows}</ol>` : `<p class="slots-empty">${t(lang, 'noSaves')}</p>`}
  </div></div>`;
}

/** Online: the invited player picks their own army (any but the host's). */
function armyPickScreen(): string {
  const tiles = READY().map((id) => {
    const f = FACTIONS[id];
    const taken = settings.sides.red === id;
    return `<button data-act="net-army" data-value="${id}" class="ftile ${taken ? 'taken' : ''}" ${taken ? 'disabled' : ''} style="--fc:${f.color}">${figurePic(id, 'king', 'front') || f.emblem}<span>${f.name[lang]}</span></button>`;
  }).join('');
  return `<div class="cover"><div class="card start">
    <div class="hero"><h2>${t(lang, 'pickArmyTitle')}</h2><p>${t(lang, 'pickArmyText')} <b>${FACTIONS[settings.sides.red].name[lang]}</b>.</p></div>
    <div class="ftiles">${tiles}</div>
  </div></div>`;
}

/** The end of a battle: the winner's banner, how it was won, and the battle in numbers. */
function victory(s: GameState, w: Player): string {
  const sides: Player[] = [w, other(w)];
  const stat = { kills: { red: 0, blue: 0 }, damage: { red: 0, blue: 0 } };
  const killsBy = new Map<UnitTypeId, number>();
  for (const e of s.log) {
    if (e.kind !== 'attack' && e.kind !== 'shoot') continue;
    stat.damage[e.player] += e.damage;
    if (e.killed) {
      stat.kills[e.player] += 1;
      if (e.player === w) killsBy.set(e.unit, (killsBy.get(e.unit) ?? 0) + 1);
    }
  }
  const best = [...killsBy].sort((a, b) => b[1] - a[1])[0];
  const left = (p: Player) => s.units.filter((u) => u.owner === p).length;
  const row = (label: string, f: (p: Player) => number) =>
    `<div class="vrow"><b>${f(sides[0])}</b><span>${label}</span><b>${f(sides[1])}</b></div>`;
  return `<div class="cover victory ${w}"><div class="card ${w}">
    <div class="vbanner"><div class="vrays" aria-hidden="true"></div><div class="vemblem">${factionOf(w).emblem}</div></div>
    <p class="small">${t(lang, 'victory')}</p>
    <h2 class="${w}">${playerName(lang, w)}</h2>
    <p>${reasonText(lang, s.winReason!)}<br>${t(lang, 'onTurn')} ${s.turn}.</p>
    <div class="vstats">
      <div class="vrow vhead"><span class="vcrest">${factionOf(sides[0]).emblem}</span><span></span><span class="vcrest">${factionOf(sides[1]).emblem}</span></div>
      ${row(t(lang, 'statKills'), (p) => stat.kills[p])}
      ${row(t(lang, 'statDamage'), (p) => stat.damage[p])}
      ${row(t(lang, 'statLeft'), left)}
    </div>
    ${best ? `<p class="vbest">${t(lang, 'bestFighter')}: <b>${unitName(lang, best[0], w)}</b> · ${best[1]} ${t(lang, best[1] === 1 ? 'killOne' : 'killMany')}</p>` : ''}
    ${resultButtons(s)}
    ${mode === 'ai' && scenarioById(settings.scenario) ? scenarioResult(lang, scenarioById(settings.scenario)!, s) : ''}
    <button data-act="restart" class="${mode === 'ai' && scenarioById(settings.scenario) ? '' : 'primary '}wide">${t(lang, 'newGame')}</button>
    <button data-act="see-board" class="ghost wide">${t(lang, 'seeBoard')}</button>
  </div></div>`;
}

/** The winner's screen can be put away to look at the final board. */
let overHidden = false;

function passScreen(s: GameState): string {
  if (s.phase === 'roll') {
    return `<div class="cover"><div class="card">
      <div class="emblem">${factionOf('red').emblem}<span class="hero-vs">${t(lang, 'vs')}</span>${factionOf('blue').emblem}</div>
      <h2>${t(lang, 'battle')}</h2>
      <p>${t(lang, 'battleText')} <b class="${s.current}">${playerName(lang, s.current)}</b>.</p>
      <button data-act="ack" class="primary wide">${t(lang, 'startBattle')}</button>
    </div></div>`;
  }
  return `<div class="cover ${s.current}"><div class="card">
    <div class="emblem">${factionOf(s.current).emblem}</div>
    <p class="small">${t(lang, 'handTo')}</p>
    <h2 class="${s.current}">${playerName(lang, s.current)}</h2>
    <p>${playerName(lang, other(s.current))} — ${t(lang, 'noPeek')}</p>
    <button data-act="ack" class="primary wide">${t(lang, 'imReady')}</button>
  </div></div>`;
}

/** Settings, the pieces list and the log: in the ☰ drawer on phones, always visible on desktop. */
function menuBody(s: GameState): string {
  const log = s.log
    .filter((e) => e.kind !== 'endTurn')
    .slice()
    .reverse()
    .map((e) => `<li><span class="dot ${e.player}"></span><span class="tn">${e.turn}</span>${logText(lang, e)}</li>`)
    .join('');
  // iOS-style settings rows: a coloured icon, a name, and the current value or a switch.
  const row = (act: string, color: string, glyph: string, title: string, value = '', sw?: boolean, cls = '') =>
    `<button data-act="${act}" class="mrow ${cls}"${sw === undefined ? '' : ` role="switch" aria-checked="${sw}"`}>
      <span class="ricon" style="--ic:${color}" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18">${glyph}</svg></span>
      <span class="mtitle">${title}</span>
      ${sw === undefined ? `<span class="mval">${value}</span><i aria-hidden="true">›</i>` : `<span class="switch ${sw ? 'is-on' : ''}" aria-hidden="true"><i></i></span>`}
    </button>`;
  const G = {
    globe: '<circle cx="12" cy="12" r="8.5" fill="none"/><path d="M3.5 12h17M12 3.5c3 3 3 14 0 17M12 3.5c-3 3-3 14 0 17" fill="none"/>',
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="none"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" fill="none"/>',
    target: '<circle cx="12" cy="12" r="7" fill="none"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" fill="none"/>',
    seats: '<circle cx="12" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><rect x="7" y="10" width="10" height="4" rx="1" fill="none"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9c1.5 1.5 1.5 4.5 0 6M18.5 6.5c3 3 3 8 0 11" fill="none"/>',
    bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
    note: '<path d="M9 18V5l10-2v13" fill="none"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    plus: '<path d="M12 5v14M5 12h14" fill="none"/>',
  };
  return `<div class="mgroup">
      ${row('lang', '#3a6fb0', G.globe, t(lang, 'rowLanguage'), lang === 'en' ? 'English' : 'Русский')}
      ${row('view', '#7a5bb0', G.cube, t(lang, 'rowView'), tilt ? t(lang, 'view25') : t(lang, 'viewFlatShort'))}
      ${row('labels', '#5b7a4a', '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" fill="none"/><path d="M9 10l3-1.5v7" fill="none"/>', t(lang, 'rowLabels'), '', showLabels)}
      ${row('cube', '#7a5bb0', G.cube, t(lang, 'rowCube'), '', showCube)}
      ${row('smartcam', '#5b6b7a', G.target, t(lang, 'rowSmartCam'), '', smartCam)}
      ${row('sidecols', '#b08a2a', '<circle cx="8" cy="12" r="4.5" fill="none"/><circle cx="16" cy="12" r="4.5" fill="none" stroke-dasharray="2.5 2"/>', t(lang, 'rowSideColors'), sideMode === 'mine' ? t(lang, 'sideMine') : t(lang, 'sideArmy'))}
      ${row('warn', '#b0443a', '<path d="M12 4l9 16H3z" fill="none"/><path d="M12 10v4M12 17v.5" fill="none"/>', t(lang, 'rowWarnings'), '', warnOn)}
      ${miniHeldOff() ? row('mini', '#3a8f8a', G.target, t(lang, 'rowMini'), t(lang, 'miniHeld')) : row('mini', '#3a8f8a', '<circle cx="12" cy="12" r="3" fill="none"/><path d="M3 7h18M3 17h18" fill="none" stroke-dasharray="2 2"/>', t(lang, 'rowMini'), '', miniOn())}
      ${row('intro', '#a8811a', '<rect x="3" y="6" width="18" height="12" rx="2" fill="none"/><path d="M10 9.5l5 2.5-5 2.5z"/>', t(lang, 'rowIntro'), '', introOn)}
      ${row('cam-reset', '#5b6b7a', G.target, t(lang, 'camResetMenu'))}
      ${mode === 'pvp' ? row('table', '#a8811a', G.seats, t(lang, 'rowSeating'), table === 'pass' ? t(lang, 'seatPass') : t(lang, 'seatAcross')) : ''}
      ${mode === 'online' && net ? row('share', '#3a6fb0', G.globe, t(lang, 'inviteLink')) : ''}
      ${row('mute', '#3f8f5a', G.sound, t(lang, 'rowSound'), '', !isMuted())}
      ${row('music', '#8a5fb0', G.note, t(lang, 'rowMusic'), '', musicOn())}
      ${row('voices', '#b0703a', '<path d="M5 5h14v10H10l-4 4v-4H5z" fill="none"/>', t(lang, 'rowVoices'), voiceMode() === 'native' ? t(lang, 'voicesNative') : t(lang, 'voicesOff'))}
      ${mixerHtml({ fx: t(lang, 'mixFx'), voice: t(lang, 'mixVoices'), music: t(lang, 'mixMusic') })}
    </div>
    <div class="mgroup">
      ${row('saves', '#a8811a', '<path d="M5 4h11l3 3v13H5z" fill="none"/><path d="M8 4v5h7V4M8 20v-6h8v6" fill="none"/>', t(lang, 'savedGames'), String(listSlots(store).length))}
      ${row('quick', '#c2453a', G.bolt, t(lang, 'quick'))}
      ${row('tutorial', '#3a8f8a', '<circle cx="12" cy="12" r="8.5" fill="none"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.7M12 16.5v.5" fill="none"/>', tutorialLabel(lang))}
      ${row('home', '#c2453a', '<path d="M4 11l8-7 8 7M6.5 9.5V20h11V9.5" fill="none"/><path d="M10 20v-5h4v5" fill="none"/>', lang === 'ru' ? 'Главное меню' : 'Main menu')}
    </div>
    <section><h3>${t(lang, 'pieces')}</h3><ul class="legend">${legendList(s.current)}</ul>${statKey()}<p class="note">${t(lang, 'legendNote')}</p></section>
    <section><h3>${t(lang, 'log')}</h3><ol class="log">${log || `<li class="empty">${t(lang, 'emptyLog')}</li>`}</ol></section>
    ${desktop ? `<p class="keys">${t(lang, 'keys')}</p>` : ''}`;
}

function menu(s: GameState): string {
  return `<div class="drawer-bg" data-act="menu"></div>
  <aside class="drawer">
    <div class="drawer-head"><b>${t(lang, 'title')}</b><button data-act="menu" class="close" aria-label="${t(lang, 'close')}" title="${t(lang, 'close')}">${icon('close')}</button></div>
    ${menuBody(s)}
  </aside>`;
}

/** One icon family for the game's buttons: 24-point grid, 2.2 stroke, round ends. */
const ICON = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a5 5 0 0 1 0 10h-3"/>',
  march: '<path d="M4 6l5 6-5 6M11 6l5 6-5 6M18 6l2 6-2 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  flip: '<path d="M7 4v16M7 4L3.5 7.5M7 4l3.5 3.5M17 20V4M17 20l-3.5-3.5M17 20l3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  reroll: '<path d="M19 8a8 8 0 1 0 1 6"/><path d="M20 3v5h-5"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const icon = (name: keyof typeof ICON) =>
  `<svg class="ic" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

function bar(s: GameState): string {
  if (aiTurn(s)) return `<div class="row"><p class="thinking">${playerName(lang, s.current)} ${t(lang, 'thinking')}</p></div>`;
  if (theirTurn(s))
    return `<div class="row"><p class="thinking">${net!.rev < 0 ? t(lang, 'connecting') : `${t(lang, 'waitingFor')} ${playerName(lang, s.current)}…`}</p><button data-act="share">${t(lang, 'inviteLink')}</button></div>`;
  if (s.phase === 'deploy') {
    const left = s.reserve[s.current];
    if (!tray || !left.includes(tray)) tray = TRAY_ORDER.find((x) => left.includes(x)) ?? null;
    const chips = TRAY_ORDER.filter((x) => left.includes(x))
      .map((x) => `<button data-act="tray" data-type="${x}" class="chip ${x === tray ? 'on' : ''}">${unitIcon(x, s.current)}<span>×${left.filter((y) => y === x).length}</span></button>`)
      .join('');
    return `<div class="tray">${chips}</div>
      <div class="row">
        <button data-act="auto" ${left.length ? '' : 'disabled'}>${t(lang, 'autoPlace')}</button>
        <button data-act="done" class="primary" ${left.length ? 'disabled' : ''}>${t(lang, 'done')} →</button>
      </div>`;
  }
  if (s.phase === 'over' && overHidden) return `<div class="row"><button data-act="show-result">${t(lang, 'result')}</button><button data-act="restart" class="primary">${t(lang, 'newGame')}</button></div>`;
  if (s.phase === 'roll') return `<div class="row"><button data-act="roll" class="primary" ${rolling ? 'disabled' : ''}>${t(lang, 'roll')}</button></div>`;
  if (s.phase === 'act') {
    const take = s.advance
      ? `<div class="row"><button data-act="take" class="primary">${t(lang, 'takeHex')}</button></div>`
      : '';
    return `${take}<div class="row">
      ${canReroll(s) ? `<button data-act="reroll" class="withicon" ${rolling ? 'disabled' : ''}>${icon('reroll')}<span>${t(lang, 'reroll')}</span></button>` : ''}
      ${!s.advance && !notMine(s) && canMarch(s) ? `<button data-act="march" class="withicon" title="${t(lang, 'marchHelp')}">${icon('march')}<span>${t(lang, 'march')}</span></button>` : ''}
      <button data-act="undo" class="withicon" ${canUndo(sess) ? '' : 'disabled'}>${icon('undo')}<span>${t(lang, 'undo')}</span></button>
      <button data-act="end" class="${s.advance ? '' : 'primary'} ${confirmEnd ? 'warn' : ''} ${!s.advance && !confirmEnd && allSpent(s) ? 'ready' : ''}">${confirmEnd ? t(lang, 'endAnyway') : t(lang, 'endTurn')}</button>
    </div>`;
  }
  return '';
}

// ===== battle intro =====
// When a battle starts (the first turn after both armies are set up, or a quick battle), a short camera move: low and
// close over one army with its name and crest, a sweep across the field to the other army, then down to the normal
// play camera. A resumed save, a joined online game, the tutorial and replays never play it. Any tap, click or key skips.
const INTRO_KEY = 'boc-intro';
let introOn = (() => { try { return localStorage.getItem(INTRO_KEY) !== '0'; } catch { return true; } })();
/** What the last drawing showed: 'setup' (armies being chosen or placed), 'battle', or null (not known: just loaded or resumed). */
let introSeen: 'setup' | 'battle' | null = null;
/** The battle has just started: the intro plays as soon as nothing else is over the board. */
let introWaiting = false;
let introPlaying = false;
let introEnd: (() => void) | null = null;

/** Called on every drawing: notices the moment the fighting starts. */
function introCheck(s: GameState) {
  const now = setupPhase(s) ? 'setup' : 'battle';
  if (introSeen === 'setup' && now === 'battle' && s.turn === 1 && s.phase !== 'over' && introOn && !tutorialOn() && !replaying()) introWaiting = true;
  introSeen = now;
  if (now !== 'battle' || tutorialOn() || replaying() || s.phase === 'over') introWaiting = false;
  if (introWaiting && !introPlaying && !choosing && !setupOpen && !savesOpen && !cover && !menuOpen && !inviting && !pickingArmy && !campaignOpen && !onlineStep) {
    introWaiting = false;
    setTimeout(playIntro, 30);
  }
}

/** The two armies' middles on the map, the one the camera ends on last. */
function introArmies(s: GameState): { first: Player; last: Player; at: Record<Player, [number, number]> } | null {
  const last: Player = mode === 'ai' ? (AI_SIDE === 'red' ? 'blue' : 'red') : mode === 'online' && net ? net.me : s.current;
  const first = other(last);
  const mid = (p: Player): [number, number] | null => {
    const pts = s.units.filter((u) => u.owner === p).map((u) => hexOnMap(u.pos, { portrait }));
    return pts.length ? [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length] : null;
  };
  const a = mid(first);
  const b = mid(last);
  return a && b ? { first, last, at: { [first]: a, [last]: b } as Record<Player, [number, number]> } : null;
}

function introCard(s: GameState, p: Player): HTMLElement {
  const d = document.createElement('div');
  d.className = 'intro-card';
  const f = factionOf(p);
  d.innerHTML = `<span class="ic-crest">${f.emblem}</span><span class="ic-text"><b>${playerName(lang, p)}</b><span class="ic-rule"></span><small>${t(lang, p === s.current ? 'introFirst' : 'introSecond')}</small></span>`;
  return d;
}

function playIntro() {
  const s = sess.state;
  const wrap = app.querySelector<HTMLElement>('.stage-wrap');
  if (introPlaying || !wrap || choosing || cover || setupPhase(s) || replaying() || tutorialOn()) return;
  const armies = introArmies(s);
  if (!armies) return;
  introPlaying = true;
  const home: Camera = { ...cam };
  const [fw, fh] = mapSize(portrait);
  const end = { x: home.x ?? fw / 2, y: home.y ?? fh / 2, zoom: home.zoom, pitch: home.pitch };
  const [A, B] = [armies.at[armies.first], armies.at[armies.last]];
  const toward = (p: [number, number], q: [number, number], k: number): [number, number] => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  // Close in: about a third of the board across, or nearer on a phone held upright.
  const close = Math.min(ZOOM_MAX, portrait ? 2.7 : 2.4);
  const low = tilt ? clampPitch(Math.max(home.pitch, 1.02)) : home.pitch;
  // Keyframes: [ms, x, y, zoom, pitch].
  const keys: [number, number, number, number, number][] = [
    [0, ...A, close * 1.08, low],
    [1500, ...toward(A, B, 0.07), close * 1.18, low - 0.03],
    [2700, ...toward(A, B, 0.55), close * 0.62, low - 0.1],
    [3700, ...toward(B, A, 0.06), close * 1.1, low - 0.04],
    [4500, ...B, close * 1.16, low - 0.05],
    [5600, end.x, end.y, end.zoom, end.pitch],
  ];
  const total = keys[keys.length - 1][0];
  // A smooth path through the keyframes (Catmull-Rom; zoom in "times bigger" so it never rushes at one end).
  const at = (ms: number) => {
    let i = 0;
    while (i < keys.length - 2 && ms > keys[i + 1][0]) i++;
    const [k0, k1, k2, k3] = [keys[Math.max(0, i - 1)], keys[i], keys[i + 1], keys[Math.min(keys.length - 1, i + 2)]];
    const u0 = Math.min(1, Math.max(0, (ms - k1[0]) / (k2[0] - k1[0])));
    const u = i === keys.length - 2 ? u0 * u0 * (3 - 2 * u0) : u0; // the last stretch settles gently
    const cr = (p0: number, p1: number, p2: number, p3: number) => 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
    const lz = (k: typeof k0) => Math.log(k[3]);
    return {
      x: cr(k0[1], k1[1], k2[1], k3[1]),
      y: cr(k0[2], k1[2], k2[2], k3[2]),
      zoom: Math.exp(cr(lz(k0), lz(k1), lz(k2), lz(k3))),
      pitch: cr(k0[4], k1[4], k2[4], k3[4]),
    };
  };
  const box = document.createElement('div');
  box.className = 'intro';
  box.dataset.keep = '1';
  const cards = [introCard(s, armies.first), introCard(s, armies.last)];
  const hint = document.createElement('span');
  hint.className = 'intro-skip';
  hint.textContent = t(lang, 'introSkip');
  box.append(...cards, hint);
  wrap.append(box);
  const t0 = performance.now();
  let raf = 0;
  const finish = () => {
    if (!introPlaying) return;
    introPlaying = false;
    introEnd = null;
    cancelAnimationFrame(raf);
    for (const [ev, fn] of listeners) window.removeEventListener(ev, fn, true);
    box.classList.add('out');
    cards.forEach((c) => c.classList.remove('show'));
    setTimeout(() => box.remove(), 500);
    cam = { ...home };
    camDone();
  };
  introEnd = finish;
  // Any tap, click, key or wheel skips at once, and does nothing else.
  const skip = (e: Event) => {
    e.stopPropagation();
    if (e.type === 'keydown') e.preventDefault();
    if (e.type === 'pointerdown' || e.type === 'touchstart' || e.type === 'mousedown') swallowNextClick();
    finish();
  };
  const listeners: [string, (e: Event) => void][] = ['pointerdown', 'mousedown', 'touchstart', 'keydown', 'wheel'].map((ev) => [ev, skip]);
  for (const [ev, fn] of listeners) window.addEventListener(ev, fn, true);
  const step = () => {
    if (!introPlaying) return;
    const ms = performance.now() - t0;
    cards[0].classList.toggle('show', ms > 250 && ms < 1900);
    cards[1].classList.toggle('show', ms > 3300 && ms < 4900);
    box.classList.toggle('out', ms > 4800);
    const c = at(Math.min(ms, total));
    cam = { ...cam, x: c.x, y: c.y, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.zoom)), pitch: clampPitch(c.pitch) };
    camFrame();
    if (ms >= total) return finish();
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}
// ===== end battle intro =====

// ---------- render ----------

/** The painted ground: one picture kept between renders (so it never reloads), laid under the board. */
let groundEl: HTMLImageElement | null = null;
function placeGround() {
  if (!hasGround()) return;
  const wrap = app.querySelector<HTMLElement>('.stage-wrap');
  if (!wrap) return;
  if (!groundEl) {
    groundEl = new Image();
    groundEl.src = groundUrl();
    groundEl.className = 'ground';
    groundEl.alt = '';
    groundEl.draggable = false;
  }
  // The board size can change between battles; the ground picture follows it.
  const [gw, gh] = groundSize();
  if (!groundEl.src.endsWith(groundUrl().replace(/^\//, ''))) groundEl.src = groundUrl();
  if (groundEl.width !== gw) groundEl.width = gw;
  if (groundEl.height !== gh) groundEl.height = gh;
  let clip = wrap.querySelector<HTMLElement>('.ground-clip');
  if (!clip) {
    clip = document.createElement('div');
    clip.className = 'ground-clip';
    clip.dataset.keep = '1';
    wrap.prepend(clip);
  }
  if (groundEl.parentElement !== clip) clip.prepend(groundEl);
  const T = groundTransform(view());
  groundEl.style.transform = T;
  // Close-up grass: a fine repeating picture over the field that fades in as the camera comes near.
  let detail = clip.querySelector<HTMLElement>('.gdetail');
  if (!detail) {
    detail = document.createElement('div');
    detail.className = 'gdetail';
    detail.style.backgroundImage = `url(${DETAIL_URL})`;
    groundEl.after(detail);
  }
  const db = detailBox();
  detail.style.width = `${db[2]}px`;
  detail.style.height = `${db[3]}px`;
  detail.style.transform = `${T} translate(${db[0]}px, ${db[1]}px)`;
  detail.style.opacity = String(Math.max(0, Math.min(0.8, (cam.zoom - 2) / 3.5)).toFixed(2));
  // The river, bridges and fords of this map, laid over the ground with the same projection.
  const parts = groundParts(CONFIG.board);
  const sig = parts.map((p) => p.key).join('|');
  if (clip.dataset.sig !== sig) {
    clip.dataset.sig = sig;
    clip.querySelectorAll('.gpart').forEach((n) => n.remove());
    for (const p of parts) {
      const im = new Image();
      im.src = p.src;
      im.className = 'gpart';
      im.alt = '';
      im.draggable = false;
      im.style.width = `${p.w}px`;
      im.style.height = `${p.h}px`;
      clip.append(im);
    }
  }
  clip.querySelectorAll<HTMLElement>('.gpart').forEach((im, i) => (im.style.transform = `${T} translate(${parts[i].x}px, ${parts[i].y}px)`));
  // Weather and light: tints, puddles, rain, snow and fog around the board.
  placeWeather(wrap, clip, T, view());
  // miniature look: depth of field and the model-photo grade (src/ui/mini.ts).
  const v = view();
  const focus = miniFocus();
  placeMini(wrap, v, focus, miniDepth(v, focus));
}
/** miniature look: how far the ground at a screen height lies from the ground in focus, as a share of the camera's
 *  distance (the camera stands 2.4 board radii away; only the part along the view direction is depth). */
function miniDepth(v: ReturnType<typeof view>, focus: number | null): (y: number) => number {
  const [fw, fh] = mapSize(v.portrait);
  const dist = Math.hypot(fw, fh) * 1.2;
  const sinA = v.tilt ? Math.sin((76 * v.cam.pitch * Math.PI) / 180) : 0;
  const g = (y: number) => screenToGround(v, v.vw / 2, y * v.vh);
  const [fx, fy] = g(focus ?? 0.5);
  return (y) => {
    const [x, yy] = g(y);
    const d = (Math.hypot(x - fx, yy - fy) * sinA) / dist;
    return Number.isFinite(d) ? d : Infinity;
  };
}
/** miniature look: the screen height (0..1) kept in focus: the selected piece, else the middle of the screen. */
function miniFocus(): number | null {
  if (!miniOn() || !stageSize[1]) return null;
  const st = replayState() ?? sess.state;
  const u = selected ? getUnit(st, selected) : undefined;
  if (!u) return null;
  const y = hexScreen(st, view(), u.pos)[1] / stageSize[1];
  return Number.isFinite(y) && y > 0 && y < 1 ? y : null;
}

/** Re-rendering replaces the board, so keep where the player had scrolled the zoomed map to. */
function render() {
  const list = app.querySelector<HTMLElement>('.sheet-scroll')?.scrollTop ?? 0;
  draw();
  placeGround();
  // The board is drawn to the stage's exact size; if the layout changed it, draw once more.
  const stage = app.querySelector<HTMLElement>('.stage');
  if (stage && stage.clientWidth > 0 && (stage.clientWidth !== stageSize[0] || stage.clientHeight !== stageSize[1])) {
    stageSize = [stage.clientWidth, stage.clientHeight];
    morphInto(stage, renderBoard(replayState() ?? sess.state, overlay(replayState() ?? sess.state), view(), NO_EFFECTS));
    placeGround();
  }
  const sheet = app.querySelector<HTMLElement>('.sheet-scroll');
  if (sheet) sheet.scrollTop = list;
  smartCameraCheck();
}

/** Zoom by a factor about a screen point (pixels inside the stage), keeping the ground under it still. */
function zoomAt(factor: number, X: number, Y: number) {
  const before = screenToGround(view(), X, Y);
  cam = { ...cam, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, cam.zoom * factor)) };
  const after = screenToGround(view(), X, Y);
  moveTarget(before[0] - after[0], before[1] - after[1]);
}

/** Slide what the camera looks at across the map, keeping it over the board. */
function moveTarget(dx: number, dy: number) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return; // a screen with no size yet gives no sensible answer
  const [fw, fh] = mapSize(portrait);
  cam = {
    ...cam,
    x: Math.min(fw, Math.max(0, (cam.x ?? fw / 2) + dx)),
    y: Math.min(fh, Math.max(0, (cam.y ?? fh / 2) + dy)),
  };
}

/** Moves the picture by a screen distance, the way a finger drags the ground in a maps app. */
function panBy(dX: number, dY: number) {
  const [cx, cy] = [stageSize[0] / 2, stageSize[1] / 2];
  const a = screenToGround(view(), cx, cy);
  const b = screenToGround(view(), cx - dX, cy - dY);
  moveTarget(b[0] - a[0], b[1] - a[1]);
}

/** Zoom buttons: zoom on the selected piece if there is one, else on the middle of the screen. */
function setZoom(factor: number) {
  const u = selected ? getUnit(sess.state, selected) : undefined;
  if (u) {
    const [x, y] = hexOnMap(u.pos, { portrait });
    cam = { ...cam, x, y };
  }
  zoomAt(factor, stageSize[0] / 2, stageSize[1] / 2);
  saveCam();
  render();
}

/** Pieces that fire guns, and which gunshot they make. */
const GUN_SOUND: Partial<Record<UnitTypeId, 'pistol' | 'rifle' | 'musket' | 'cannon' | 'boom'>> = { gunslinger: 'pistol', championGun: 'pistol', cowboy: 'pistol', rifleman: 'rifle', deputy: 'rifle', lineInfantry: 'musket', skirmisher: 'musket', cannon: 'cannon', bomber: 'boom', crossbow: 'musket', longRifle: 'rifle', rocket: 'boom' };

/** Your own side's sounds play close and full, the other side's from across the field (both sides are yours when two share a phone). */
const nearSide = (p: Player) => (mode === 'ai' ? p !== AI_SIDE : mode === 'online' && net ? p === net.me : true);

/** When the animations now on the board are over (ms clock); the computer waits for it before redrawing. */
let fxUntil = 0;

/** Effects and sounds for log entries added since the last render. */
function effects(s: GameState): Effects {
  const fresh: LogEntry[] = s.log.length > prevLog ? s.log.slice(prevLog) : [];
  const fx: Effects = { from: fresh.length ? prevPos : new Map(), hits: [], walks: new Map() };
  // Who stands where as the new moves play out (a March is many moves at once, several by the same piece).
  const hk = (h: Hex) => `${h.col},${h.row}`;
  const standing = new Map<string, string>([...prevPos].map(([id, h]) => [hk(h), id]));
  const moves = fresh.filter((e) => e.kind === 'move').length;
  let voiced = 0;
  for (const e of fresh) {
    if (e.kind === 'move' && e.path?.length) {
      // The piece that stood where the move began walks the route hex by hex (joined onto any walk it already made).
      const id = standing.get(hk(e.from)) ?? s.units.find((x) => x.pos.col === e.to.col && x.pos.row === e.to.row)?.id;
      if (id) {
        const before = fx.walks.get(id);
        fx.walks.set(id, before ? [...before, ...e.path] : [e.from, ...e.path]);
        standing.delete(hk(e.from));
        standing.set(hk(e.to), id);
      }
    }
    if (e.kind === 'attack' || e.kind === 'shoot') {
      fx.hits.push({ at: e.at, damage: e.damage, killed: e.killed, type: e.target, owner: other(e.player), shotFrom: e.kind === 'shoot' ? e.from : null, by: e.unit, from: e.from, advanced: !!e.advanced });
      // Timed to the board's animation: the blow lands at the same moment the hit flashes.
      const gun = e.kind === 'shoot' && GUN_SOUND[e.unit];
      const lands = gun ? 0.22 : e.kind === 'shoot' ? ARROW_S : 0.14;
      fightSounds(e, sides[e.player], sides[other(e.player)], nearSide(e.player), nearSide(other(e.player)), lands, gun || null);
      fxUntil = Math.max(fxUntil, Date.now() + lands * 1000 + 900);
    } else if (e.kind === 'move') {
      // A footstep (or hoofbeat, splash, thud on a bridge) for every hex walked, in time with the piece; and its "Moving!".
      const ground = (e.path?.length ? e.path : [e.to]).map((h) => s.board[h.row]?.[h.col] ?? 'plain');
      // A March is many moves at once: a couple of them make the sound, not a din of every piece.
      if (moves > 3 && ++voiced > 2) continue;
      marchSounds(sides[e.player], e.unit, ground, STEP_MS, nearSide(e.player), !!e.path?.length);
    } else if (e.kind === 'win') {
      setTimeout(() => sound(mode === 'ai' && e.player === AI_SIDE ? 'lose' : 'win'), 400);
      victoryVoice(sides[e.player], s.units.filter((u) => u.owner === e.player).map((u) => u.type), nearSide(e.player));
    }
  }
  if (fresh.length) lastWalkMs = Math.max(0, ...[...fx.walks.values()].map((w) => (w.length - 1) * STEP_MS));
  prevLog = s.log.length;
  prevPos = new Map(s.units.map((u) => [u.id, u.pos]));
  // A piece you just picked answers you.
  if (selected !== voicedSel) {
    voicedSel = selected;
    const u = selected ? getUnit(s, selected) : undefined;
    if (u && s.phase === 'act' && u.owner === s.current && !notMine(s) && !replaying()) selectVoice(sides[u.owner], u.type, u.id);
  }
  return fx;
}

/** Music for this moment: the theme of the army to move, and war drums while a King is in danger. */
function score(s: GameState) {
  if (apFac && (galleryOpen || setupOpen)) return setMusic([apFac], apFac, false); // setup summary: the showcased army's theme
  if (setupPhase(s) || s.phase === 'over') return setMusic([], null, false);
  const danger = s.units.some((k) => k.type === 'king' && s.units.some((e) => e.owner !== k.owner && distance(e.pos, k.pos) <= 2));
  setMusic([sides.red, sides.blue], sides[s.current], danger);
  prepareVoices([sides.red, sides.blue]);
}

let drawnPortrait = portrait;
function draw() {
  // A campaign battle whose turn limit has run out ends here.
  const held = checkHold(sess.state, scenarioById(settings.scenario));
  if (held) sess = { ...sess, state: held };
  // While a replay is open its state is drawn instead of the live game (which stays untouched).
  const s = replayState() ?? sess.state;
  thumbJobs.clear();
  if (isPortrait() !== drawnPortrait) {
    // The flat map turns with the screen, so aim back at the middle of the board.
    drawnPortrait = isPortrait();
    cam = { ...cam, x: null, y: null };
  }
  // Across the table: tip the camera over to the player whose turn it now is.
  if (acrossTable() && sideShown !== s.current && !tilting && !replaying()) {
    if (setupPhase(s) || !tilt) sideShown = s.current;
    else setTimeout(() => tiltOver(s.current), 0);
  }
  if (!acrossTable()) sideShown = s.current;
  // Two players passing the phone: swing the board round when the turn changes hands.
  if (mode === 'pvp' && table === 'pass' && !setupPhase(s) && facedFor !== s.current && !replaying()) {
    facedFor = s.current;
    cam = { ...cam, yaw: yawFor(s.current) };
    saveCam();
  }
  // side colours: whose pieces are "yours" in this game, for the rings and the side-coloured bits of the page.
  setMine(sideMine(s));
  paintSideVars();
  const fx = effects(s);
  score(s);
  portrait = isPortrait();
  desktop = isDesktop();
  const faces = rolling ? rollFaces : s.dice;
  const bump = s.points !== lastPoints ? 'bump' : '';
  lastPoints = s.points;
  const battle = !setupPhase(s);

  let info = message ?? '';
  let unitCard = false;
  if (!info) {
    if (s.phase === 'deploy') info = t(lang, 'deployHint');
    else if (s.advance) info = `${t(lang, 'takeHex')}, ${t(lang, 'orKeep')}`;
    else if (s.phase === 'roll') info = `${playerName(lang, s.current)}: ${t(lang, 'rollFirst')}`;
    else if (selected) (info = unitInfo(s, selected)), (unitCard = !!info);
    else if (s.phase === 'act') info = `${t(lang, 'pickUnit')}. ${t(lang, 'help')}`;
  }
  // A campaign battle with a turn limit shows how far along it is.
  const scen = scenarioById(settings.scenario);
  const goal = scen?.hold ? campaignText(lang).turnOf(s.turn, scen.hold.turns) : scen && s.turn === 1 ? goalText(lang, scen) : '';
  if (!message && !unitCard && goal && battle && s.phase !== 'over') info = `${goal} · ${info}`;

  const right = battle
    ? `<div class="points ${bump}"><b>${s.points}</b><span>${t(lang, 'points')}</span></div>`
    : s.phase === 'deploy'
      ? `<div class="points"><b>${s.reserve[s.current].length}</b><span>${t(lang, 'left')}</span></div>`
      : '';

  if (s.phase !== 'over') overHidden = false;
  // The result stays put while a new battle is being set up on top of the finished one.
  const over = s.phase === 'over' && s.winner && !overHidden && !choosing && !setupOpen && !savesOpen && !replaying() ? victory(s, s.winner) : '';

  const html = `
    <div class="screen ${portrait ? 'portrait' : 'landscape'} ${withPanel() ? 'desktop' : desktop ? 'full' : portrait ? '' : 'phone'} ${message ? 'has-msg' : ''} ${s.current} ${upsideDown() ? 'flipped' : ''}">
      <header class="hud" style="--fc:${factionOf(s.current).color}">
        <div class="who"><span class="crest">${factionOf(s.current).emblem}</span><span>${playerName(lang, s.current)}<small>${battle ? `${t(lang, 'turn')} ${s.turn}` : t(lang, 'setup')}</small></span></div>
        <div class="dice">${battle ? [0, 1, 2].slice(0, CONFIG.dice.count).map((i) => die(faces?.[i] ?? null, rolling)).join('') : ''}</div>
        ${right}
        ${desktop ? `<button data-act="fullscreen" class="ghost icon" title="${t(lang, 'fullscreen')}" aria-label="${t(lang, 'fullscreen')}">${icon('expand')}</button>
          <button data-act="panel" class="ghost icon" title="${panelOpen ? t(lang, 'hidePanel') : t(lang, 'showPanel')}" aria-label="${panelOpen ? t(lang, 'hidePanel') : t(lang, 'showPanel')}">${icon('panel')}</button>` : ''}
        ${withPanel() ? '' : `<button data-act="menu" class="ghost icon" aria-label="${t(lang, 'menu')}">${icon('menu')}</button>`}
        ${battle ? tally(s) : ''}
      </header>
      <div class="stage-wrap">
        <div class="stage">${renderBoard(s, overlay(s), view(), fx)}</div>
        <div class="edge-chips">${edgeChips(s)}</div>
        ${showCube ? `<div class="viewcube" title="${t(lang, 'cubeHelp')}" aria-label="${t(lang, 'cubeHelp')}">${viewCube(view())}</div>` : ''}
        <div class="cam" aria-label="${t(lang, 'camera')}">
          <button data-act="cam-flip" title="${t(lang, 'camFlip')}" aria-label="${t(lang, 'camFlip')}">${icon('flip')}</button>
        </div>
        <div class="zoom">
          <button data-act="zoom-in" aria-label="Zoom in" ${cam.zoom >= ZOOM_MAX - 0.01 ? 'disabled' : ''}>${icon('plus')}</button>
          <button data-act="zoom-out" aria-label="Zoom out" ${cam.zoom <= ZOOM_MIN + 0.01 ? 'disabled' : ''}>${icon('minus')}</button>
        </div>
      </div>
      <p class="info ${unitCard ? `unit ${unitOpen ? 'open' : ''}` : ''}" id="info"${unitCard ? ` data-act="unit-more" role="button" aria-expanded="${unitOpen}"` : ''}>${info}</p>
      <footer class="bar">${bar(s)}</footer>
      ${withPanel() ? `<aside class="side">${menuBody(s)}</aside>` : ''}
    </div>
    ${s.phase === 'draft' && !cover && !choosing && !setupOpen && !theirTurn(s) && !inviting && !pickingArmy ? draftSheet(s) : ''}
    ${inviting && net && !choosing && !setupOpen ? inviteScreen() : ''}
    ${pickingArmy && net && !choosing && !setupOpen ? armyPickScreen() : ''}
    ${cover && s.phase !== 'over' && !choosing && !setupOpen && !replaying() ? passScreen(s) : ''}
    ${choosing && !onlineStep && !savesOpen ? (galleryOpen ? (apFac ? armyShowcase(lang, apFac, icon('back')) : armyGallery(lang, icon('back'), (id) => figurePic(id, 'king', 'front'))) : campaignOpen ? campaignScreen(lang) : startScreen()) : ''}
    ${onlineStep === 'pick' ? onlineChoiceScreen() : onlineStep === 'join' ? joinScreen() : ''}
    ${setupOpen ? setupScreen() : ''}
    ${savesOpen ? savesScreen() : ''}
    ${over}
    ${replayControls()}
    ${menuOpen && !withPanel() ? menu(s) : ''}`;
  morphInto(app, html, fx.from.size > 0 || fx.hits.length > 0 || fx.walks.size > 0);
  if (thumbJobs.size) void fillThumbs();
  app.classList.toggle('upside', upsideDown());
  document.documentElement.lang = lang;
  document.title = t(lang, 'title');
  // screen memory: which screen a reload should come back to.
  const where = choosing || setupOpen ? 'title' : 'game';
  if (where !== shownScreen) {
    shownScreen = where;
    try { localStorage.setItem(SCREEN_KEY, where); } catch { /* private window */ }
  }
  saveGame();
  introCheck(s);
  syncOut();
  scheduleAi();
  scheduleRoll();
}

/** A new turn rolls its own dice after a short beat, so the handover is visible first. */
let rollTimer: number | null = null;
function scheduleRoll() {
  const s = sess.state;
  if (rollTimer !== null || rolling || cover || choosing || introPlaying || introWaiting || s.phase !== 'roll' || notMine(s)) return;
  rollTimer = window.setTimeout(() => {
    rollTimer = null;
    const st = sess.state;
    if (!rolling && !cover && !choosing && !introPlaying && st.phase === 'roll' && !notMine(st)) roll(selected);
  }, 600);
}

// ---------- computer opponent ----------

/** The computer builds and places its army at once (the player never sees it happen). */
/** Quick battle: both sides get a balanced army of their own pieces, already in formation, and the dice are next. */
function quickBattle(): GameState {
  let s = newGame();
  for (let i = 0; i < 2; i++) {
    for (const step of [(x: GameState) => draftArmy(x, suggestArmy(Math.random, sideConfig(x.current), rosterOf(x.current) as Buyable[]), sideConfig(x.current)), (x: GameState) => autoDeploy(x), (x: GameState) => finishDeploy(x)]) {
      const r = step(s);
      if (!r.ok) return quickStart(); // never expected; the plain line-up still plays
      s = r.state;
    }
  }
  return s;
}

function aiSetup() {
  const steps: ((s: GameState) => Result)[] = [(s) => draftArmy(s, suggestArmy(Math.random, sideConfig(s.current), rosterOf(s.current) as Buyable[]), sideConfig(s.current)), (s) => autoDeploy(s), (s) => finishDeploy(s)];
  for (const step of steps) {
    const { sess: next, result } = apply(sess, step, true);
    if (!result.ok) return;
    sess = next;
  }
}

/** On the computer's turn, take one step every so often so the player can follow it. */
function scheduleAi() {
  const s = sess.state;
  if (camHome && !notMine(s) && !rolling) comeHome();
  if (aiTimer !== null || rolling || cover || choosing || introPlaying || introWaiting || !aiTurn(s)) return;
  // Each computer attack gets its own beat: the target is marked first, then the hit lands,
  // so a volley never looks like one click doing several attacks at once.
  const next = s.phase === 'act' ? (tutorialOn() ? tutorialEnemy(s) : aiNextAction(s, undefined, settings.difficulty ?? 'normal')) : null;
  const strike = next && (next.kind === 'attack' || next.kind === 'shoot');
  // Let the last blow finish playing before the board is drawn again, or its arrow would be wiped mid-flight.
  let wait = Math.max(0, fxUntil - Date.now());
  // camera v2: with the smart camera on, the camera frames each piece about to act together with its target or
  // destination (only when they don't already show), after the last walk or blow has finished playing. With it off,
  // the computer's turn is watched from further back, so the whole board shows. Nothing moves until the camera has settled.
  let glided = 0;
  // faster opening: while the armies are still closing in, the computer's turn goes by quickly.
  const calm = noContact(s);
  if (smartCam) {
    const pre = Math.max(wait, walkTime(s));
    glided = watchAction(s, next, pre);
    if (glided) wait = pre + glided;
  } else wait += watchWholeBoard(calm ? 500 : 1100);
  const mark = () => {
    if (!next || !strike || !aiTurn(sess.state)) return;
    aiAim = next.targetId;
    selected = next.unitId;
    message = `${playerName(lang, s.current)}: ${unitName(lang, getUnit(s, next.unitId)!.type, s.current)} → ${unitName(lang, getUnit(s, next.targetId)!.type, other(s.current)).toLowerCase()}`;
    render();
  };
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    aiAim = null;
    const st = sess.state;
    if (rolling || cover || choosing || introPlaying || !aiTurn(st)) return;
    if (st.phase === 'roll') return roll();
    const a = tutorialOn() ? tutorialEnemy(st) : aiNextAction(st, undefined, settings.difficulty ?? 'normal');
    if (a) {
      run((x) => applyAi(x, a));
      if (a.kind === 'attack' || a.kind === 'shoot') selected = null;
    } else run((x) => endTurn(x), true);
  }, wait + (calm ? (s.phase === 'roll' ? 450 : Math.max(500, 300 + walkTime(s))) : s.phase === 'roll' ? 1000 : strike ? 1700 : glided ? 650 : Math.max(1100, 650 + walkTime(s))));
  // The target is marked once the timer is set, so that render doesn't schedule a second move.
  if (strike) wait ? setTimeout(mark, wait) : mark();
}

/** The player's own view while the camera is pulled back to watch the computer's turn; it glides home afterwards. */
let camHome: Camera | null = null;
let glideId = 0;
/** Glides the camera smoothly to a spot and zoom. A touch or drag from the player takes over at once. */
function glideTo(to: { x: number; y: number; zoom: number; pitch?: number }, ms: number) {
  const [fw, fh] = mapSize(portrait);
  const from = { x: cam.x ?? fw / 2, y: cam.y ?? fh / 2, zoom: cam.zoom, pitch: cam.pitch };
  const id = ++glideId;
  const t0 = performance.now();
  const step = () => {
    if (id !== glideId) return;
    if (drag || touch) return camDone();
    const t = Math.min(1, (performance.now() - t0) / ms);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // slow start, slow stop
    // Zoom glides evenly in "how many times bigger", so it doesn't rush at one end.
    cam = { ...cam, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, zoom: from.zoom * Math.pow(to.zoom / from.zoom, e) };
    if (to.pitch !== undefined) cam = { ...cam, pitch: from.pitch + (to.pitch - from.pitch) * e };
    if (t < 1) {
      camFrame();
      requestAnimationFrame(step);
    } else camDone();
  };
  requestAnimationFrame(step);
}
/** When the computer's turn starts, pull back to show the whole board; returns how long that takes (ms). */
function watchWholeBoard(ms = 1100): number {
  if (camHome) return 0;
  const [fw, fh] = mapSize(portrait);
  camHome = { ...cam };
  const [x, y] = [cam.x ?? fw / 2, cam.y ?? fh / 2];
  if (cam.zoom <= 1.05 && Math.hypot(x - fw / 2, y - fh / 2) < 30) return 0;
  glideTo({ x: fw / 2, y: fh / 2, zoom: Math.min(cam.zoom, 1) }, ms);
  return ms + 150;
}
/** Back to where the player was looking, once the computer's last blow has finished playing. */
function comeHome() {
  const home = camHome;
  if (!home) return;
  camHome = null;
  // camera v2: the player moved the camera themselves while the enemy was on; leave it where they put it.
  if (userTookCam) return void (userTookCam = false);
  const [fw, fh] = mapSize(portrait);
  const to = { x: home.x ?? fw / 2, y: home.y ?? fh / 2, zoom: home.zoom };
  if (Math.abs(to.zoom - cam.zoom) < 0.02 && Math.hypot(to.x - (cam.x ?? fw / 2), to.y - (cam.y ?? fh / 2)) < 10) return;
  const id = ++glideId;
  setTimeout(() => {
    if (id === glideId && !drag && !touch) glideTo(to, 900);
  }, Math.max(0, fxUntil - Date.now()) + 500);
}

/** How long the last move's walk takes to play, in ms (the computer waits for it). */
function walkTime(s: GameState): number {
  const e = s.log[s.log.length - 1];
  // A March moves many pieces at once: wait for the longest walk the last drawing started.
  return Math.max(lastWalkMs, e?.kind === 'move' && e.path ? e.path.length * STEP_MS : 0);
}
/** The longest walk (ms) the last batch of moves started playing (set by effects()). */
let lastWalkMs = 0;

// ---------- actions ----------

function run(act: (s: GameState) => Result, checkpoint = false): boolean {
  const { sess: next, result } = apply(sess, act, checkpoint);
  sess = next;
  message = result.ok ? null : errorText(lang, result.error);
  if (result.ok) autoEndIfDone();
  render();
  return result.ok;
}

/** When the player can't do anything more (no points, or none their pieces can use), the
 *  turn ends by itself after a moment, so the last move is seen and can still be undone. */
function autoEndIfDone() {
  const s = sess.state;
  if (s.phase !== 'act' || s.advance || notMine(s)) return;
  const mine = s.units.filter((u) => u.owner === s.current).length;
  if (s.points > 0 && spentUnits(s).size < mine) return;
  const at = s;
  message = t(lang, 'outOfPoints');
  setTimeout(() => {
    // Only if nothing happened meanwhile (an undo, for example, cancels it).
    if (sess.state !== at) return;
    selected = null;
    run((st) => endTurn(st), true);
  }, 1400);
}

function restart(state: GameState) {
  if (!(mode === 'online' && net)) slotId = newSlotId(); // saved games: never overwrite the last game
  sess = startSession(state);
  introSeen = 'setup'; // battle intro: a new battle plays it when the fighting starts (at once for a quick battle)
  selected = null;
  message = null;
  draft = {};
  tray = null;
  confirmNew = false;
  menuOpen = false;
  choosing = false;
  cover = mode === 'pvp' && state.phase === 'draft';
  if (mode === 'online') {
    if (!net) {
      // A new online game: this phone is Red and holds the invite link.
      net = { id: newId(), me: 'red', rev: 0 };
      try {
        localStorage.setItem(roleKey(net.id), 'red');
      } catch { /* the link still works for this visit */ }
      history.replaceState(null, '', `?g=${net.id}`);
      inviting = true;
      joinCode = null;
      const id0 = net.id;
      void createCode(id0).then((c) => { if (net?.id === id0) { joinCode = c; render(); } });
    }
    netState = null; // a new battle on the same link: send it
    if (net.rev < 0) net.rev = 0;
  }
  render();
}

/** Rolls the dice. `keep` is a piece the player tapped before rolling: it stays selected. */
function roll(keep: string | null = null) {
  if (rolling || sess.state.phase !== 'roll') return;
  rolling = true;
  sound('dice');
  selected = keep;
  message = null;
  const spin = () => (rollFaces = Array.from({ length: CONFIG.dice.count }, () => 1 + Math.floor(Math.random() * CONFIG.dice.sides)));
  spin();
  render();
  const timer = setInterval(() => {
    spin();
    const dice = app.querySelector('.dice');
    if (dice) dice.innerHTML = rollFaces.map((f) => die(f, true)).join('');
  }, 80);
  setTimeout(() => {
    clearInterval(timer);
    rolling = false;
    rolledAt = Date.now();
    run((s) => rollDice(s, tutorialRng()), true);
  }, 700);
}

let rolledAt = 0;

/** Throws the dice again (optional rule): the same spin as a roll, and it can't be undone. */
function rerollDice() {
  // A double tap on Roll dice must not spend the reroll: ignore it for a moment after the roll lands.
  if (rolling || !canReroll(sess.state) || Date.now() - rolledAt < 600) return;
  rolling = true;
  sound('dice');
  selected = null;
  message = null;
  const spin = () => (rollFaces = Array.from({ length: CONFIG.dice.count }, () => 1 + Math.floor(Math.random() * CONFIG.dice.sides)));
  spin();
  render();
  const timer = setInterval(() => {
    spin();
    const dice = app.querySelector('.dice');
    if (dice) dice.innerHTML = rollFaces.map((f) => die(f, true)).join('');
  }, 80);
  setTimeout(() => {
    clearInterval(timer);
    rolling = false;
    run((s) => reroll(s), true);
  }, 700);
}

function onDeployHex(s: GameState, hex: { col: number; row: number }) {
  const u = unitAt(s, hex);
  if (u && u.owner === s.current) {
    tray = u.type;
    run((st) => liftUnit(st, u.id));
  } else if (tray) {
    const type = tray;
    run((st) => placeUnit(st, type, hex));
  }
}

function onHex(col: number, row: number) {
  const s = sess.state;
  if (rolling || s.phase === 'over' || cover || choosing || setupOpen || notMine(s)) return;
  const hex = { col, row };
  if (s.phase === 'deploy') return onDeployHex(s, hex);
  if (s.phase === 'draft') return;
  const u = unitAt(s, hex);
  // Tapping one of your pieces before rolling rolls the dice for you and keeps it selected.
  if (s.phase === 'roll' && u && u.owner === s.current) return roll(u.id);
  const own = selected ? getUnit(s, selected) : undefined;

  if (own && own.owner === s.current && s.phase === 'act') {
    if (u && u.owner !== own.owner) {
      const hit = strikeTargets(s, own.id).find((x) => x.targetId === u.id);
      if (hit) return void run((st) => (hit.preview.kind === 'attack' ? attack(st, own.id, u.id) : shoot(st, own.id, u.id)));
      // Explain why not, then show the enemy's stats.
      const why = CONFIG.units[own.type].ranged ? shoot(s, own.id, u.id) : attack(s, own.id, u.id);
      message = !why.ok ? `${errorText(lang, why.error)} ${unitInfo(s, u.id)}` : null;
      return render();
    }
    if (!u) {
      const reach = reachable(s, own.id).get(key(hex));
      if (reach) {
        pending = null;
        return void run((st) => moveUnit(st, own.id, hex));
      }
      selected = null;
      message = null;
      return render();
    }
  }
  selected = u ? (u.id === selected ? null : u.id) : null;
  pending = null;
  message = null;
  render();
}

app.addEventListener('click', (e) => {
  const el = e.target as Element;
  const hex = el.closest('[data-col]');
  if (hex) confirmEnd = false;
  if (!hex) pending = null;
  if (hex) return onHex(Number(hex.getAttribute('data-col')), Number(hex.getAttribute('data-row')));
  const btn = el.closest('[data-act]');
  const act = btn?.getAttribute('data-act');
  if (!act) return;
  const type = btn!.getAttribute('data-type') as UnitTypeId | null;
  if (act !== 'new') confirmNew = false;
  if (act !== 'end') confirmEnd = false;
  // Online, while the other player is on: look around freely, but nothing that plays the game.
  if (theirTurn(sess.state) && !choosing && !setupOpen && ['ack', 'auto', 'auto-all', 'auto-army', 'done', 'draft', 'end', 'less', 'more', 'next', 'reroll', 'roll', 'take', 'tray', 'undo', 'quick', 'march'].includes(act)) return;
  switch (act) {
    case 'copy-link':
      void navigator.clipboard?.writeText(inviteUrl()).then(() => { message = t(lang, 'linkCopied'); render(); }, () => {});
      app.querySelector<HTMLInputElement>('.invite-url')?.select();
      return;
    case 'copy-code':
      if (joinCode) void navigator.clipboard?.writeText(joinCode).then(() => { message = t(lang, 'codeCopied'); render(); }, () => {});
      return;
    case 'join-code':
      joinText = app.querySelector<HTMLInputElement>('.join-input')?.value ?? joinText;
      return void joinByCode();
    case 'invite-ok':
      inviting = false;
      return render();
    case 'net-army': {
      const f = btn!.getAttribute('data-value') as FactionId;
      if (!net || !FACTIONS[f] || settings.sides.red === f) return;
      net.blue = f;
      pickingArmy = false;
      applyBlue();
      void pushGame(`${net.id}b`, 1, f);
      return render();
    }
    case 'share': {
      const url = inviteUrl();
      if (navigator.share) void navigator.share({ title: t(lang, 'title'), url }).catch(() => {});
      else void navigator.clipboard?.writeText(url).then(() => { message = t(lang, 'linkCopied'); render(); }, () => {});
      return;
    }
    case 'ack':
      if (sess.state.phase === 'roll') sound('horn');
      cover = false;
      message = null;
      return render();
    case 'more':
    case 'less': {
      const b = type as Buyable;
      const n = Math.min(capOf(b), Math.max(0, (draft[b] ?? 0) + (act === 'more' ? 1 : -1)));
      const next = { ...draft, [b]: n };
      if (armyCost(next) <= budgetNow()) draft = next;
      message = null;
      return render();
    }
    case 'draft':
      if (run((s) => draftArmy(s, draft, sideConfig(s.current)))) draft = {};
      return;
    case 'tray':
      tray = type;
      return render();
    case 'auto':
      return void run((s) => autoDeploy(s));
    case 'done':
      if (run((s) => finishDeploy(s), true)) {
        if (mode === 'ai' && sess.state.current === AI_SIDE) aiSetup();
        cover = mode !== 'online';
        tray = null;
        render();
      }
      return;
    case 'auto-army':
      draft = suggestArmy(Math.random, sideConfig(sess.state.current), buyOrder());
      message = null;
      return render();
    case 'auto-all': {
      // Build a balanced army, place it in formation and hand over, all in one tap.
      draft = suggestArmy(Math.random, sideConfig(sess.state.current), buyOrder());
      if (!run((s) => draftArmy(s, draft, sideConfig(s.current)))) return;
      draft = {};
      run((s) => autoDeploy(s));
      if (run((s) => finishDeploy(s), true)) {
        if (mode === 'ai' && sess.state.current === AI_SIDE) aiSetup();
        cover = mode !== 'online';
        tray = null;
        render();
      }
      return;
    }
    case 'setup-back':
      // Picked the wrong mode: back to "how do you want to play?" (online: back to Host or Join).
      setupOpen = false;
      choosing = true;
      setupPage = apFac = null;
      if (mode === 'online') onlineStep = 'pick';
      return render();
    case 'mode':
      mode = (btn!.getAttribute('data-mode') ?? 'pvp') as Mode;
      if (net) leaveNet(); // picking a way to play always starts afresh; an online game gets a new link
      pickSide = 'red';
      setupPage = apFac = null;
      settings = loadSettings();
      // Online asks first: host a new game, or join a friend's with a code.
      if (mode === 'online') {
        onlineStep = 'pick';
        return render();
      }
      choosing = false;
      setupOpen = true;
      return render();
    // ---------- online: host or join ----------
    case 'online-back':
      onlineStep = null;
      return render();
    case 'online-host':
      onlineStep = null;
      choosing = false;
      setupOpen = true;
      return render();
    case 'online-join':
      onlineStep = 'join';
      joinErr = null;
      render();
      app.querySelector<HTMLInputElement>('.join-input')?.focus();
      return;
    case 'join-back':
      onlineStep = 'pick';
      joinErr = null;
      return render();
    // ---------- saved games ----------
    case 'saves':
      savesOpen = true;
      menuOpen = false;
      confirmDelete = null;
      refreshLiveTurns();
      return render();
    case 'saves-back':
      savesOpen = false;
      confirmDelete = null;
      return render();
    case 'slot-resume':
      return void resumeSlot(btn!.getAttribute('data-value') ?? '');
    case 'slot-delete':
      confirmDelete = btn!.getAttribute('data-value');
      return render();
    case 'slot-delete-no':
      confirmDelete = null;
      return render();
    case 'slot-delete-yes': {
      const id = btn!.getAttribute('data-value') ?? '';
      deleteSlot(store, id);
      confirmDelete = null;
      if (id === slotId) {
        // The game on screen was deleted: it stops saving, and the player goes back to "how do you want to play?".
        slotId = null;
        if (!choosing) {
          if (net) leaveNet();
          choosing = true;
        }
      }
      return render();
    }
    case 'set': {
      // One choice on the New battle screen: army points, map or points per turn.
      const field = btn!.getAttribute('data-field');
      const value = btn!.getAttribute('data-value')!;
      const wasRandom = settings.map === 'random';
      if (field === 'budget') settings = { ...settings, budget: Number(value) };
      if (field === 'map') settings = { ...settings, map: value as MapId };
      // Choosing Random grows a map straight away (tapping it again rolls a new one).
      if (field === 'map' && value === 'random') settings = { ...settings, mapSeed: settings.mapSeed && !wasRandom ? settings.mapSeed : newSeed(), mapStyle: settings.mapStyle ?? 'valley' };
      if (field === 'size') settings = { ...settings, size: value === 'large' ? 'large' : 'standard' };
      if (field === 'lines') settings = { ...settings, options: { ...settings.options, battleLines: value === 'close' || value === 'far' ? value : 'normal' } };
      if (field === 'dice') settings = { ...settings, dice: value as DiceId };
      // Weather and light: a new choice is rolled afresh when the battle starts.
      if (field === 'time') settings = { ...settings, time: value as Settings['time'], sky: undefined };
      if (field === 'weather') settings = { ...settings, weather: value as Settings['weather'], sky: undefined };
      if (field === 'difficulty') settings = { ...settings, difficulty: value === 'easy' || value === 'hard' ? value : 'normal' };
      // setup summary: a one-tap choice page closes itself (chess.com's time-control sheet).
      if (setupPage && setupPage === (field === 'budget' ? 'budget' : field) && ['budget', 'difficulty', 'size', 'dice'].includes(setupPage)) (setupPage = null), (setupAnim = 'sub-back');
      return render();
    }
    case 'faction': {
      // Both sides can't lead the same army: picking the other side's faction swaps them.
      const side = btn!.getAttribute('data-side') as Player;
      const f = btn!.getAttribute('data-value') as FactionId;
      const otherSide = other(side);
      const sidesNext = { ...settings.sides, [side]: f };
      if (settings.sides[otherSide] === f) sidesNext[otherSide] = settings.sides[side];
      settings = { ...settings, sides: sidesNext };
      // Yours is chosen: move straight on to the other side's army.
      if (side === 'red' && mode !== 'online') pickSide = 'blue';
      apFac = null; // "Choose this army" on the showcase lands back on the army page
      return render();
    }
    case 'map-style': {
      // A preset sets every knob back to its own amounts.
      const { mapKnobs: _, ...rest } = settings;
      settings = { ...rest, mapStyle: btn!.getAttribute('data-value') as MapStyle, mapSeed: settings.mapSeed ?? newSeed() };
      return render();
    }
    case 'land-open':
      landOpen = !landOpen;
      return render();
    case 'map-knob': {
      // Moving a knob starts from what is shown (the preset's amounts) and makes the land Custom.
      const id = btn!.getAttribute('data-knob') as KnobId;
      const base = settings.mapKnobs ?? PRESET_KNOBS[settings.mapStyle ?? 'valley'];
      settings = { ...settings, mapKnobs: { ...base, [id]: Number(btn!.getAttribute('data-value')) } as MapKnobs, mapSeed: settings.mapSeed ?? newSeed() };
      return render();
    }
    case 'map-biome': {
      const id = btn!.getAttribute('data-value') as BiomeId;
      settings = { ...settings, mapBiome: id === 'meadow' ? undefined : id, mapSeed: settings.mapSeed ?? newSeed() };
      return render();
    }
    case 'map-reroll':
      settings = { ...settings, mapSeed: newSeed() };
      return render();
    case 'swap-sides':
      settings = { ...settings, sides: { red: settings.sides.blue, blue: settings.sides.red } };
      return render();
    case 'pick-side':
      pickSide = mode === 'online' ? 'red' : (btn!.getAttribute('data-side') as Player);
      // setup summary: tapping a side on the face-off opens the Army page.
      if (setupPage !== 'army') return (setupPage = 'army'), (setupAnim = 'sub-in'), render(), toTop();
      return render();
    // ---- setup summary: sub-pages, the army showcase and the title-screen gallery ----
    case 'setup-page':
      setupPage = btn!.getAttribute('data-page');
      setupAnim = 'sub-in';
      render();
      return toTop();
    case 'setup-sub-back':
      setupPage = null;
      setupAnim = 'sub-back';
      return render();
    case 'ap-open':
      apFac = btn!.getAttribute('data-value') as FactionId;
      render();
      return toTop();
    case 'ap-back':
      apFac = null;
      return render();
    case 'ap-prev':
    case 'ap-next': {
      const list = READY_ARMIES();
      const i = Math.max(0, list.indexOf(apFac ?? list[0]));
      apFac = list[(i + (act === 'ap-next' ? 1 : -1) + list.length) % list.length];
      render();
      return toTop();
    }
    case 'ap-turn':
      return turnFigures(Number(btn!.getAttribute('data-dir')) || 1);
    case 'armies':
      galleryOpen = true;
      render();
      return toTop();
    case 'gallery-back':
      galleryOpen = false;
      apFac = null;
      return render();
    case 'rules-open':
      rulesOpen = !rulesOpen;
      return render();
    case 'preset':
      settings = { ...settings, options: { ...(btn!.getAttribute('data-value') === 'recommended' ? RECOMMENDED : DADS_RULES) } };
      return render();
    case 'opt': {
      const k = btn!.getAttribute('data-key') as keyof Settings['options'];
      const rule = RULES.find((r) => r.key === k)!;
      const on = settings.options[k] !== DADS_RULES[k];
      settings = { ...settings, options: { ...settings.options, [k]: on ? DADS_RULES[k] : rule.on } };
      return render();
    }
    case 'begin':
      setupOpen = false;
      setupPage = apFac = null;
      saveSettings(settings);
      applySettings(settings);
      return restart(newGame());
    case 'take':
      return void run((s) => takeHex(s));
    case 'march':
      selected = null;
      return void run((s) => march(s));
    case 'roll':
      return notMine(sess.state) ? undefined : roll();
    case 'reroll':
      return notMine(sess.state) ? undefined : rerollDice();
    case 'unit-more':
      unitOpen = !unitOpen;
      return render();
    case 'undo':
      sess = undo(sess);
      message = null;
      if (selected && !getUnit(sess.state, selected)) selected = null;
      return render();
    case 'end': {
      // Ending with points left that could still be used asks once before ending.
      const s = sess.state;
      const canStillAct = s.units.some((u) => u.owner === s.current) && spentUnits(s).size < s.units.filter((u) => u.owner === s.current).length;
      if (!confirmEnd && !tutorialOn() && s.points > 0 && canStillAct) {
        confirmEnd = true;
        message = `${t(lang, 'pointsLeftWarn').replace('{n}', String(s.points))}`;
        sound('tick');
        return render();
      }
      confirmEnd = false;
      selected = null;
      return void run((st) => endTurn(st), true);
    }
    case 'next':
      return nextPiece();
    case 'danger':
      dangerOn = !dangerOn;
      message = dangerOn ? t(lang, 'threatHelp') : null;
      return render();
    case 'cam-flip':
      // Turn the board half way round; press again to turn it back.
      cam = { ...cam, yaw: cam.yaw + Math.PI };
      saveCam();
      return render();
    case 'table':
      table = table === 'pass' ? 'across' : 'pass';
      // Across the table starts from Novgorod's side; the far player's turn adds the half turn.
      if (table === 'across') cam = { ...cam, yaw: yawFor('red') };
      try {
        localStorage.setItem(TABLE_KEY, table);
      } catch {
        /* keep the choice for this visit only */
      }
      facedFor = null;
      return render();
    case 'cam-reset':
      cam = { ...CAM_DEFAULT };
      saveCam();
      return render();
    case 'zoom-in':
    case 'zoom-out': {
      return setZoom(act === 'zoom-in' ? 1.4 : 1 / 1.4);
    }
    case 'menu':
      menuOpen = !menuOpen;
      return render();
    case 'set-lang':
    case 'lang':
      lang = act === 'set-lang' ? (btn!.getAttribute('data-lang') === 'ru' ? 'ru' : 'en') : lang === 'ru' ? 'en' : 'ru';
      try {
        localStorage.setItem(LANG_KEY, lang);
      } catch {
        /* storage unavailable: keep the choice for this visit only */
      }
      message = null;
      return render();
    case 'panel':
      panelOpen = !panelOpen;
      try {
        localStorage.setItem(PANEL_KEY, panelOpen ? 'open' : 'hidden');
      } catch {
        /* keep the choice for this visit only */
      }
      return render();
    case 'fullscreen':
      // Real full screen where the browser allows it (not on iPhone Safari).
      if (document.fullscreenElement) void document.exitFullscreen?.();
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      return;
    case 'view':
      tilt = !tilt;
      try {
        localStorage.setItem(VIEW_KEY, tilt ? 'tilt' : 'flat');
      } catch {
        /* keep the choice for this visit only */
      }
      return render();
    case 'labels':
      showLabels = !showLabels;
      setFlag('boc-labels', showLabels);
      return render();
    case 'cube':
      showCube = !showCube;
      setFlag('boc-cube', showCube);
      return render();
    case 'sidecols':
      setSideMode(sideMode === 'mine' ? 'army' : 'mine');
      return render();
    case 'warn':
      warnOn = !warnOn;
      setFlag(WARN_KEY, warnOn);
      return render();
    case 'edge-chip': {
      const u = getUnit(sess.state, btn!.getAttribute('data-unit') ?? '');
      if (u) lookAtHex(u.pos);
      return;
    }
    case 'mini':
      toggleMini();
      return render();
    case 'intro':
      introOn = !introOn;
      setFlag(INTRO_KEY, introOn);
      return render();
    case 'smartcam':
      smartCam = !smartCam;
      setFlag(SMART_KEY, smartCam);
      return render();
    case 'music':
      toggleMusic();
      return render();
    case 'voices':
      toggleVoices();
      return render();
    case 'mute':
      toggleMute();
      sound('tick');
      return render();
    case 'quick':
      if (settings.scenario) delete settings.scenario; // a quick battle is never a campaign battle
      return restart(quickBattle());
    case 'campaign':
      choosing = true;
      campaignOpen = true;
      overHidden = false;
      return render();
    case 'campaign-back':
      campaignOpen = false;
      return render();
    case 'scenario': {
      // Starting a campaign battle: it replaces the current game, against the computer.
      const sc = scenarioById(btn!.getAttribute('data-value') ?? '');
      if (!sc) return;
      if (net) leaveNet();
      mode = 'ai';
      campaignOpen = false;
      setupOpen = false;
      overHidden = false;
      settings = scenarioSettings(sc);
      applySettings(settings);
      return restart(buildScenario(sc));
    }
    case 'tutorial':
      menuOpen = false;
      return startTutorial();
    case 'new':
      if (!confirmNew && sess.state.log.length + sess.state.units.length > 0) {
        confirmNew = true;
        return render();
      }
      confirmNew = false;
      menuOpen = false;
      choosing = true;
      return render();
    case 'home':
      // Menu → Main menu: the game is saved as it stands, then the title screen (Continue brings it straight back).
      saveGame();
      menuOpen = false;
      choosing = true;
      return render();
    case 'continue':
      // Title → Continue: straight back into the game on screen (or the newest save); the list if it is gone.
      if (slotId && resumeSlot(slotId)) return;
      savesOpen = true;
      refreshLiveTurns();
      return render();
    case 'restart':
      choosing = true;
      overHidden = false;
      return render();
    case 'show-result':
      overHidden = false;
      return render();
    case 'see-board':
      overHidden = true;
      return render();
  }
});

app.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.type === 'range' && el.dataset.type) onSlide(el);
  if (el.classList.contains('join-input')) {
    el.value = el.value.toUpperCase();
    joinText = el.value;
  }
});
app.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).classList?.contains('join-input') && e.key === 'Enter') {
    e.preventDefault();
    app.querySelector<HTMLButtonElement>('[data-act="join-code"]:not(:disabled)')?.click();
  }
});

// Desktop: hovering a target shows the attack preview in the info line.
app.addEventListener('mouseover', (e) => {
  const hex = (e.target as Element).closest('[data-col]');
  const info = document.getElementById('info');
  if (!hex || !info || !selected) return;
  const s = sess.state;
  const u = unitAt(s, { col: Number(hex.getAttribute('data-col')), row: Number(hex.getAttribute('data-row')) });
  const p = u && overlay(s).targets.get(u.id);
  if (u && p) info.innerHTML = previewText(s, u.id, p);
});

// ---------- ground picking ----------
// A tap on the board means the hex under the finger by the camera's own projection (raised hill tops included),
// never the element hit: a tall figure or tree in front can't swallow it. Runs first (window, capture): when the
// picked hex differs from the element tapped, the tap is sent on to that hex's own shape instead, so everything
// after it (the tutorial's gate, the game's click handler) sees the right hex.
let lastTouchAt = 0;
app.addEventListener('touchstart', () => (lastTouchAt = Date.now()), { passive: true });
const picked = new WeakSet<Event>();
window.addEventListener(
  'click',
  (e) => {
    if (picked.has(e)) return;
    const el = e.target as Element;
    const stage = el.closest?.('.stage');
    if (!stage || !sess) return;
    const [x, y] = stagePoint(e.clientX, e.clientY);
    const touchTap = (e as PointerEvent).pointerType === 'touch' || Date.now() - lastTouchAt < 800;
    const h = pickHex(sess.state, overlay(sess.state), view(), x, y, touchTap ? 22 : 0);
    const was = el.closest('[data-col]');
    if (h && was && Number(was.getAttribute('data-col')) === h.col && Number(was.getAttribute('data-row')) === h.row) return;
    if (!h && !was) return;
    // The hex's own shape on the board the finger touched (during a camera move that is the invisible anchor).
    const board = stage.querySelector('svg.board.anchor') ?? stage.querySelector('svg.board:not(.live)') ?? stage.querySelector('svg.board');
    const dest = h ? board?.querySelector(`.hex[data-col="${h.col}"][data-row="${h.row}"]`) : stage;
    if (!dest) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const again = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: e.button });
    picked.add(again);
    dest.dispatchEvent(again);
  },
  true,
);

// ---------- smart camera ----------
// On selecting a piece whose moves or targets are off screen or hidden behind things, the camera glides by the
// smallest change that shows them: a pan, then zooming out, then up to 20° more top-down (yaw is kept). It never
// moves during a drag or pinch, any touch or wheel cancels it, and it does not come back afterwards.

/** Margins kept clear on screen: the zoom buttons sit bottom right, the camera button bottom left. */
const LEAN_M = { l: 22, r: 54, t: 22, b: 34 };
/** Tilt steps tried, as camera pitch (1 = 76°): 0, 5°, 10°, 15°, 20° towards top-down. */
const LEAN_TILTS = [0, 5, 10, 15, 20].map((d) => d / 76);

function smartCameraCheck() {
  const sel = selected;
  if (sel === smartFor) return;
  smartFor = sel;
  if (!sel || !smartCam) return;
  // After the tap's own render has settled.
  setTimeout(() => {
    if (selected === sel) leanIn();
  }, 30);
}

/** Runs `fn` with the camera set to `c`, then puts the real camera back. */
function withCam<T>(c: Camera, fn: () => T): T {
  const keep = cam;
  cam = c;
  try {
    return fn();
  } finally {
    cam = keep;
  }
}

function leanFits(b: number[]): boolean {
  const a = clearArea();
  return b[0] >= a[0] - 1 && b[2] <= a[2] + 1 && b[1] >= a[1] - 1 && b[3] <= a[3] + 1;
}

/** The smallest zoom-out and pan that bring the targets inside the clear part of the screen, starting from camera `c`. */
function leanFit(s: GameState, o: Overlay, c: Camera): Camera | null {
  return fitCam(c, (cc) => withCam(cc, () => targetFrame(s, o, view(), false).box), clearArea(), false);
}

/** Where the camera should go for the selected piece, or null if everything already shows. */
function leanPlan(s: GameState, o: Overlay): Camera | null {
  const okCover = (f: { total: number; covered: number }) => f.covered <= Math.floor(f.total * 0.2);
  const now = targetFrame(s, o, view(), true);
  if (!now.box) return null;
  const onScreen = leanFits(now.box);
  if (onScreen && okCover(now)) return null;
  let best: { c: Camera; covered: number } | null = null;
  for (const dp of LEAN_TILTS) {
    if (dp > 0 && (!tilt || cam.pitch - dp < -1e-6)) break;
    const c = leanFit(s, o, { ...cam, pitch: clampPitch(cam.pitch - dp) });
    if (!c) continue;
    const f = withCam(c, () => targetFrame(s, o, view(), true));
    if (!f.box || !leanFits(f.box)) {
      if (!best && !onScreen) best = { c, covered: f.covered };
      continue;
    }
    if (okCover(f)) return c;
    if (!best || f.covered < best.covered) best = { c, covered: f.covered };
  }
  // Nothing clears the view entirely: move only if it is clearly better than now.
  if (!best) return null;
  if (onScreen && best.covered >= now.covered) return null;
  return best.c;
}

function leanIn() {
  const s = sess.state;
  if (!smartCam || drag || touch || tilting || camOverlay || cubeDrag || replaying() || aiTurn(s) || notMine(s) || s.phase !== 'act') return;
  const o = overlay(s);
  if (!o.reach.size && !o.targets.size) return;
  const to = leanPlan(s, o);
  if (!to) return;
  const [fw, fh] = mapSize(portrait);
  glideTo({ x: to.x ?? fw / 2, y: to.y ?? fh / 2, zoom: to.zoom, pitch: to.pitch }, 480);
  leanGlide = glideId;
}
// A wheel or trackpad move takes over from a smart glide at once (touch and drag already stop any glide).
app.addEventListener('wheel', () => {
  if (leanGlide === glideId) ++glideId;
}, { passive: true, capture: true });

// ---------- camera v2 ----------
// See _art/CAMERA-V2.md. (1) Watching the enemy: during the computer's (or the online opponent's) turn the camera
// frames each acting piece together with its target or destination, only when they don't already show, then glides
// back to the player's own view when the turn comes back. A drag, pinch or wheel from the player during the enemy's
// turn hands the camera to them for the rest of that turn. (2) Enemy warnings: a soft red pulse under each of your
// pieces an enemy could reach and hit next turn (average roll), and small arrow chips at the screen edges pointing at
// off-screen enemies that just acted or have one of your pieces in reach; tap a chip to look there. (3) The clear part
// of the screen: what floats over the board (the phone strip, the action bar, a message) is kept clear by every frame.

/** Whose pieces are "yours": against the computer the player's, online this phone's side, two on one phone the side to move. */
function sideMine(s: GameState): Player {
  return mode === 'ai' ? other(AI_SIDE) : mode === 'online' && net ? net.me : s.current;
}

/** Your pieces an enemy could reach and hit on its next turn with an average roll, and the enemies that could. */
function threats(s: GameState, me: Player): { mine: Set<string>; foes: Set<string> } {
  if (threatCache && threatCache.s === s && threatCache.me === me) return threatCache;
  const them = other(me);
  const theirGo: GameState = { ...s, current: them, phase: 'act', points: AVERAGE_ROLL, advance: null };
  const ours = s.units.filter((u) => u.owner === me);
  const mine = new Set<string>();
  const foes = new Set<string>();
  for (const e of s.units) {
    if (e.owner !== them) continue;
    const r = CONFIG.units[e.type];
    const stands = [{ hex: e.pos, cost: 0 }, ...reachable(theirGo, e.id).values()];
    for (const { hex, cost } of stands) {
      const left = AVERAGE_ROLL - cost;
      const melee = r.attack > 0 && left >= CONFIG.combat.attackCost;
      const shots = !!r.ranged && left >= r.ranged.cost;
      if (!melee && !shots) continue;
      const far = shots ? maxRangeAt(s, hex, r.ranged!.maxRange) : 0;
      for (const m of ours) {
        if (mine.has(m.id) && foes.has(e.id)) continue;
        const d = distance(hex, m.pos);
        if ((melee && d === 1) || (shots && d >= r.ranged!.minRange && d <= far && hasLineOfSight(s, hex, m.pos))) {
          mine.add(m.id);
          foes.add(e.id);
        }
      }
    }
  }
  threatCache = { s, me, mine, foes };
  return threatCache;
}

/** The enemy pieces that acted on the enemy's most recent turn (read from the log). */
function recentActors(s: GameState, them: Player): string[] {
  const out = new Set<string>();
  let i = s.log.length - 1;
  while (i >= 0 && s.log[i].player !== them) i--;
  for (; i >= 0 && s.log[i].player === them; i--) {
    const e = s.log[i];
    const at = e.kind === 'move' ? e.to : e.kind === 'attack' || e.kind === 'shoot' ? (e.advanced ? e.at : e.from) : null;
    const u = at && s.units.find((x) => x.owner === them && x.pos.col === at.col && x.pos.row === at.row);
    if (u) out.add(u.id);
  }
  return [...out];
}

/** The part of the board's picture nothing floats over (stage pixels: left, top, right, bottom). */
let areaMemo: { at: number; key: string; a: number[] } | null = null;
function clearArea(): number[] {
  const [vw, vh] = stageSize;
  // The unit card that floats under the phone strip comes and goes with the selection, so it is part of the key.
  const key = `${vw}x${vh}|${message ? 1 : 0}|${selected ?? ''}`;
  const now = performance.now();
  if (areaMemo && areaMemo.key === key && now - areaMemo.at < 400) return areaMemo.a;
  let [l, t, r, b] = [LEAN_M.l, LEAN_M.t, vw - LEAN_M.r, vh - LEAN_M.b];
  const st = app.querySelector('.stage')?.getBoundingClientRect();
  if (st && st.height > 0 && !upsideDown()) {
    // On a phone held sideways the player strip floats over the top of the board and the action bar over the bottom.
    for (const sel of ['.hud', '.bar', '.info']) {
      const rc = app.querySelector(sel)?.getBoundingClientRect();
      if (!rc || rc.width < 1 || rc.height < 1) continue;
      if (rc.right <= st.left || rc.left >= st.right || rc.bottom <= st.top || rc.top >= st.bottom) continue;
      const [y0, y1] = [rc.top - st.top, rc.bottom - st.top];
      if (y0 + y1 < st.height) t = Math.max(t, y1 + 8);
      else b = Math.min(b, y0 - 8);
    }
    if (b - t < vh * 0.4) [t, b] = [LEAN_M.t, vh - LEAN_M.b];
  }
  const a = [l, t, r, b];
  areaMemo = { at: now, key, a };
  return a;
}

/** From camera `c`, the pan (and zoom-out, only if needed) that brings `boxAt`'s box inside `area`: by the
 *  smallest shift, or with the box centred (`centre`). Null if there is nothing to frame. */
function fitCam(c: Camera, boxAt: (c: Camera) => number[] | null, area: number[], centre: boolean): Camera | null {
  const [aw, ah] = [area[2] - area[0], area[3] - area[1]];
  let cur = c;
  for (let i = 0; i < 14; i++) {
    const b = boxAt(cur);
    if (!b) return null;
    const [bw, bh] = [b[2] - b[0], b[3] - b[1]];
    const big = bw > aw || bh > ah;
    if (big) {
      const z = Math.max(ZOOM_MIN, cur.zoom * Math.min(aw / bw, ah / bh) * 0.96);
      if (z < cur.zoom - 1e-3) {
        // Zoom about the box's own middle, so what is framed stays put while the rest pulls back.
        cur = withCam(cur, () => (zoomAt(z / cam.zoom, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2), cam));
        continue;
      }
    }
    let dX: number, dY: number;
    if (centre || big) {
      dX = (area[0] + area[2]) / 2 - (b[0] + b[2]) / 2;
      dY = (area[1] + area[3]) / 2 - (b[1] + b[3]) / 2;
    } else {
      dX = b[0] < area[0] ? area[0] - b[0] : b[2] > area[2] ? area[2] - b[2] : 0;
      dY = b[1] < area[1] ? area[1] - b[1] : b[3] > area[3] ? area[3] - b[3] : 0;
      // A little beyond the edge so perspective doesn't leave the last hex just outside.
      [dX, dY] = [dX * 1.06, dY * 1.06];
    }
    if (Math.abs(dX) < 1 && Math.abs(dY) < 1) return cur;
    const before = cur;
    cur = withCam(cur, () => (panBy(dX, dY), cam));
    if (Math.abs((cur.x ?? 0) - (before.x ?? 0)) < 0.05 && Math.abs((cur.y ?? 0) - (before.y ?? 0)) < 0.05) return cur; // at the board's edge
  }
  return cur;
}

/** Where the camera should go to watch something happen on these hexes, or null if they already show well. */
function watchPlan(s: GameState, hexes: Hex[]): Camera | null {
  const a = clearArea();
  // Watched action sits a little further in from the edges than a lean-in does.
  const pad = Math.min(30, (a[2] - a[0]) * 0.06);
  const area = [a[0] + pad, a[1] + pad, a[2] - pad, a[3] - pad];
  const boxAt = (c: Camera) => withCam(c, () => hexesBox(s, view(), hexes));
  const now = boxAt(cam);
  if (!now) return null;
  if (now[0] >= a[0] && now[2] <= a[2] && now[1] >= a[1] && now[3] <= a[3]) return null;
  const [fw, fh] = mapSize(portrait);
  const pts = hexes.map((h) => hexOnMap(h, { portrait }));
  const mid = { x: pts.reduce((n, p) => n + p[0], 0) / pts.length, y: pts.reduce((n, p) => n + p[1], 0) / pts.length };
  const c0 = { ...cam, x: Math.min(fw, Math.max(0, mid.x)), y: Math.min(fh, Math.max(0, mid.y)) };
  return fitCam(c0, boxAt, area, true);
}

/** A calm glide time for moving from the camera now to `to` (ms). */
function watchMs(to: Camera): number {
  const [fw, fh] = mapSize(portrait);
  const dist = Math.hypot((to.x ?? fw / 2) - (cam.x ?? fw / 2), (to.y ?? fh / 2) - (cam.y ?? fh / 2)) * cam.zoom;
  return Math.round(Math.min(950, 520 + (dist / Math.max(fw, fh)) * 700 + Math.abs(Math.log(to.zoom / cam.zoom)) * 250));
}
/** Glides to `to` at a calm pace for the distance; returns the glide's length (ms). */
function watchGlide(to: Camera, ms = watchMs(to)): number {
  const [fw, fh] = mapSize(portrait);
  glideTo({ x: to.x ?? fw / 2, y: to.y ?? fh / 2, zoom: to.zoom }, ms);
  return ms;
}

/** The computer's next step: frame its piece and target (or destination) after `pre` ms. Returns the extra wait (ms). */
function watchAction(s: GameState, a: ReturnType<typeof aiNextAction>, pre: number): number {
  if (!camHome) {
    camHome = { ...cam };
    userTookCam = false;
  }
  if (!a || userTookCam || replaying() || (a.kind !== 'move' && a.kind !== 'attack' && a.kind !== 'shoot')) return 0;
  const u = getUnit(s, a.unitId);
  const to = a.kind === 'move' ? a.to : getUnit(s, a.targetId)?.pos;
  if (!u || !to) return 0;
  const hexes = a.kind === 'move' ? [u.pos, ...routeTo(s, u.id, a.to)] : [u.pos, to];
  const plan = watchPlan(s, hexes);
  if (!plan) return 0;
  // Worked out now; started once the last walk or blow has finished, unless the player has taken the camera meanwhile.
  const ms = watchMs(plan);
  setTimeout(() => {
    if (!drag && !touch && !userTookCam && aiTurn(sess.state)) watchGlide(plan, ms);
  }, pre);
  return ms + 200;
}

/** Online: the other player's newest moves, about to be shown. Glides to where they happen; returns the wait (ms). */
function watchOnline(next: GameState): number {
  const s = sess.state;
  if (!smartCam || mode !== 'online' || !net || drag || touch || replaying() || next.log.length <= s.log.length) return 0;
  const me = net.me;
  const hexes: Hex[] = [];
  for (const e of next.log.slice(s.log.length)) {
    if (e.player === me) continue;
    if (e.kind === 'move') hexes.push(e.from, e.to);
    else if (e.kind === 'attack' || e.kind === 'shoot') hexes.push(e.from, e.at);
  }
  if (!hexes.length) return 0;
  if (!camHome) {
    camHome = { ...cam };
    userTookCam = false;
  }
  if (userTookCam) return 0;
  const plan = watchPlan(s, hexes);
  return plan ? watchGlide(plan) + 120 : 0;
}

/** Tapping an edge chip: glide over to that hex, keeping the zoom. */
function lookAtHex(h: Hex) {
  const [x, y] = hexOnMap(h, { portrait });
  if (camHome) userTookCam = true;
  glideTo({ x, y, zoom: cam.zoom }, 520);
}

/** Small arrow chips at the screen edges pointing at enemies off screen that just acted or have one of yours in reach. */
function edgeChips(s: GameState): string {
  if (!warnOn || s.phase === 'over' || setupPhase(s) || replaying() || choosing || !stageSize[0]) return '';
  const me = sideMine(s);
  const them = other(me);
  const want = new Map<string, boolean>(); // id -> it just acted
  for (const id of threats(s, me).foes) want.set(id, false);
  for (const id of recentActors(s, them)) want.set(id, true);
  if (!want.size) return '';
  const v = view();
  const a = clearArea();
  const [cx, cy] = [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2];
  const R = 19;
  const chips: { x: number; y: number; ang: number; ids: string[]; acted: boolean }[] = [];
  for (const [id, acted] of want) {
    const u = getUnit(s, id);
    if (!u) continue;
    const [X, Y] = hexScreen(s, v, u.pos);
    if (!Number.isFinite(X) || !Number.isFinite(Y)) continue;
    // On screen at all (even under the bar) needs no chip: the piece itself shows.
    if (X >= 8 && X <= stageSize[0] - 8 && Y >= 8 && Y <= stageSize[1] - 8) continue;
    const [dx, dy] = [X - cx, Y - cy];
    const k = Math.min(((a[2] - a[0]) / 2 - R) / Math.max(1e-6, Math.abs(dx)), ((a[3] - a[1]) / 2 - R) / Math.max(1e-6, Math.abs(dy)));
    const [x, y] = [cx + dx * k, cy + dy * k];
    const near = chips.find((c) => Math.hypot(c.x - x, c.y - y) < 2 * R);
    if (near) {
      near.ids.push(id);
      near.acted ||= acted;
      continue;
    }
    chips.push({ x, y, ang: (Math.atan2(dy, dx) * 180) / Math.PI, ids: [id], acted });
  }
  return chips
    .map((c) => `<button class="edge-chip${c.acted ? ' acted' : ''}" data-act="edge-chip" data-unit="${c.ids[0]}" style="left:${c.x.toFixed(0)}px;top:${c.y.toFixed(0)}px" title="${t(lang, 'edgeEnemy')}" aria-label="${t(lang, 'edgeEnemy')}"><svg viewBox="-12 -12 24 24" width="22" height="22" aria-hidden="true"><path transform="rotate(${c.ang.toFixed(0)})" d="M-6 -7L8 0L-6 7L-2.5 0Z"/></svg>${c.ids.length > 1 ? `<i>${c.ids.length}</i>` : ''}</button>`)
    .join('');
}

// The player moving the camera during the enemy's turn (a drag, a pinch, the wheel) takes it over for that turn.
{
  let down: [number, number] | null = null;
  const took = () => {
    if (camHome && notMine(sess.state)) userTookCam = true;
  };
  app.addEventListener('pointerdown', (e) => { down = (e.target as Element).closest?.('.stage') ? [e.clientX, e.clientY] : null; }, { capture: true, passive: true });
  app.addEventListener('pointermove', (e) => { if (down && e.buttons && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) took(); }, { capture: true, passive: true });
  app.addEventListener('pointerup', () => { down = null; }, { capture: true, passive: true });
  app.addEventListener('touchmove', (e) => { if ((e.target as Element).closest?.('.stage')) took(); }, { capture: true, passive: true });
  app.addEventListener('wheel', (e) => { if ((e.target as Element).closest?.('.stage')) took(); }, { capture: true, passive: true });
}

// ---------- camera moves without a full re-render ----------
// While the camera moves only the board is redrawn, once per frame, with the highlights
// frozen as they were when the move began.

let camOverlay: Overlay | null = null;
let camQueued = false;
function camFrame() {
  if (!camOverlay) camOverlay = overlay(replayState() ?? sess.state);
  if (camQueued) return;
  camQueued = true;
  requestAnimationFrame(() => {
    camQueued = false;
    const st = app.querySelector<HTMLElement>('.stage');
    if (!st || !camOverlay) return;
    // On iPhone the rest of a touch goes to the exact element the finger first landed on; if
    // that element left the page the gesture would stop. So the board drawn when the move
    // began stays in place, invisible, and each frame only swaps the live copy drawn over it.
    let anchor = st.querySelector<SVGElement>('svg.board.anchor');
    if (!anchor) {
      anchor = st.querySelector<SVGElement>('svg.board');
      anchor?.classList.add('anchor');
    }
    const tmp = document.createElement('div');
    tmp.innerHTML = renderBoard(replayState() ?? sess.state, camOverlay, view(), NO_EFFECTS);
    const live = tmp.firstElementChild as SVGElement;
    live.classList.add('live');
    const old = st.querySelector('svg.board.live');
    if (old) morph(old, live);
    else st.append(live);
    placeGround();
    const cube = app.querySelector('.viewcube');
    if (cube) cube.innerHTML = viewCube(view());
    const chips = app.querySelector('.edge-chips');
    if (chips) chips.innerHTML = edgeChips(replayState() ?? sess.state);
  });
}
function camDone() {
  camOverlay = null;
  saveCam();
  render();
}

/** A pointer position inside the stage, in the same pixels the board is drawn in. */
function stagePoint(clientX: number, clientY: number): [number, number] {
  const box = app.querySelector<HTMLElement>('.stage')!.getBoundingClientRect();
  // On a screen turned round for the far player, its own left/top are the page's right/bottom.
  return upsideDown() ? [box.right - clientX, box.bottom - clientY] : [clientX - box.left, clientY - box.top];
}

/** After a drag, the click that ends it must not move or select a piece. */
function swallowNextClick() {
  const stop = (ev: Event) => ev.stopPropagation();
  window.addEventListener('click', stop, { capture: true, once: true });
  // If the drag ended off the piece no click comes at all: don't eat the next real one.
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 60);
}

// ---------- touch: like a maps app ----------
// One finger drags the ground. Two fingers: pinch zooms about the fingers, twist orbits,
// sliding both up or down tilts. Each two-finger move only starts once it is clearly meant.

let touch:
  | { kind: 'one'; x: number; y: number; ground: [number, number]; moved: boolean }
  | { kind: 'two'; dist: number; angle: number; midY: number; zoom: number; yaw: number; pitch: number; live: Set<string> }
  | null = null;

const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
const twist = (t: TouchList) => Math.atan2(t[1].clientY - t[0].clientY, t[1].clientX - t[0].clientX);
const middle = (t: TouchList): [number, number] => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];

app.addEventListener(
  'touchstart',
  (e) => {
    if (!(e.target as Element).closest('.stage')) return;
    if (e.touches.length === 1) {
      const [x, y] = stagePoint(e.touches[0].clientX, e.touches[0].clientY);
      touch = { kind: 'one', x, y, ground: screenToGround(view(), x, y), moved: false };
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const [, midY] = middle(e.touches);
      touch = { kind: 'two', dist: spread(e.touches), angle: twist(e.touches), midY, zoom: cam.zoom, yaw: cam.yaw, pitch: cam.pitch, live: new Set() };
    }
  },
  { passive: false },
);

app.addEventListener(
  'touchmove',
  (e) => {
    if (!touch) return;
    if (touch.kind === 'one' && e.touches.length === 1) {
      const [x, y] = stagePoint(e.touches[0].clientX, e.touches[0].clientY);
      if (!touch.moved && Math.hypot(x - touch.x, y - touch.y) < 8) return;
      touch.moved = true;
      e.preventDefault();
      // Keep the same spot of ground under the finger.
      const now = screenToGround(view(), x, y);
      moveTarget(touch.ground[0] - now[0], touch.ground[1] - now[1]);
      return camFrame();
    }
    if (touch.kind === 'two' && e.touches.length === 2) {
      e.preventDefault();
      const ratio = spread(e.touches) / touch.dist;
      let turn = twist(e.touches) - touch.angle;
      if (turn > Math.PI) turn -= 2 * Math.PI;
      if (turn < -Math.PI) turn += 2 * Math.PI;
      const [mx, my] = middle(e.touches);
      const slide = (my - touch.midY) * flipSign();
      // Decide once what the two fingers are doing: sliding together up or down tilts;
      // spreading zooms; twisting turns (zoom and turn can mix, tilt stays on its own).
      if (!touch.live.size) {
        if (Math.abs(slide) > 12 && Math.abs(ratio - 1) < 0.1 && Math.abs(turn) < 0.12) touch.live.add('tilt');
        else {
          if (Math.abs(ratio - 1) > 0.05) touch.live.add('zoom');
          if (Math.abs(turn) > 0.1) touch.live.add('turn');
        }
      } else if (!touch.live.has('tilt')) {
        if (Math.abs(ratio - 1) > 0.05) touch.live.add('zoom');
        if (Math.abs(turn) > 0.1) touch.live.add('turn');
      }
      if (touch.live.has('zoom')) {
        const [px, py] = stagePoint(mx, my);
        zoomAt((touch.zoom * ratio) / cam.zoom, px, py);
      }
      if (touch.live.has('turn')) cam = { ...cam, yaw: touch.yaw + turn };
      if (touch.live.has('tilt') && tilt) cam = { ...cam, pitch: clampPitch(touch.pitch - slide * 0.005) };
      return camFrame();
    }
  },
  { passive: false },
);

app.addEventListener('touchend', (e) => {
  if (!touch) return;
  const moved = touch.kind === 'two' || touch.moved;
  if (e.touches.length === 0) {
    touch = null;
    if (moved) {
      e.preventDefault(); // no click after a drag
      camDone();
    }
  }
});

// Safari's own pinch gestures would zoom the page: stop them everywhere. On a Mac trackpad
// (no touch screen) Safari's two-finger rotate orbits the camera.
const touchScreen = 'ontouchstart' in window;
let gestureYaw = 0;
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(
    type,
    (e) => {
      e.preventDefault();
      if (touchScreen) return;
      const rotation = (e as Event & { rotation?: number }).rotation ?? 0;
      if (type === 'gesturestart') gestureYaw = cam.yaw;
      else if (type === 'gesturechange') {
        cam = { ...cam, yaw: gestureYaw + (rotation * Math.PI) / 180 };
        camFrame();
      } else camDone();
    },
    { passive: false },
  );
}

// ---------- trackpad and mouse wheel ----------
// Two-finger swipe slides the camera over the board; pinch (ctrl + wheel) zooms about the
// pointer; Option + swipe up / down zooms (Option + click-drag orbits, as in Maya). A mouse wheel's
// big, whole-line steps zoom instead, as in most 3D programs.
app.addEventListener(
  'wheel',
  (e) => {
    if (!(e.target as Element).closest('.stage')) return;
    e.preventDefault();
    const [px, py] = stagePoint(e.clientX, e.clientY);
    const unit = e.deltaMode === 1 ? 16 : 1;
    const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (e.ctrlKey) zoomAt(Math.exp(-e.deltaY / 100), px, py);
    else if (e.altKey) zoomAt(Math.exp((-e.deltaY * unit) / 300), px, py); // Option + swipe up/down zooms, as in Maya
    else if (mouseWheel) zoomAt(Math.exp((-e.deltaY * unit) / 500), px, py);
    else panBy(-e.deltaX * flipSign(), -e.deltaY * flipSign());
    camFrame();
    clearTimeout(wheelEnd);
    wheelEnd = window.setTimeout(camDone, 200);
  },
  { passive: false },
);
let wheelEnd = 0;

// ---------- mouse ----------
// Drag slides the camera over the ground; right-drag (or Shift / Option + drag) orbits and tilts.
let drag: { x: number; y: number; ground: [number, number]; moved: boolean; orbit: boolean; yaw: number; pitch: number } | null = null;
app.addEventListener('mousedown', (e) => {
  if (!(e.target as Element).closest('.stage') || (e.button !== 0 && e.button !== 2)) return;
  const [x, y] = stagePoint(e.clientX, e.clientY);
  const orbit = e.button === 2 || e.shiftKey || e.altKey;
  drag = { x, y, ground: screenToGround(view(), x, y), moved: false, orbit, yaw: cam.yaw, pitch: cam.pitch };
});
app.addEventListener('contextmenu', (e) => {
  if ((e.target as Element).closest('.stage')) e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!drag || !app.querySelector('.stage')) return;
  const [x, y] = stagePoint(e.clientX, e.clientY);
  if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 6) return;
  drag.moved = true;
  app.querySelector('.stage')?.classList.add('dragging');
  if (drag.orbit) {
    cam = { ...cam, yaw: drag.yaw - (x - drag.x) * 0.008, pitch: tilt ? clampPitch(drag.pitch - (y - drag.y) * 0.004) : cam.pitch };
  } else {
    const now = screenToGround(view(), x, y);
    moveTarget(drag.ground[0] - now[0], drag.ground[1] - now[1]);
  }
  camFrame();
});
window.addEventListener('mouseup', () => {
  if (drag?.moved) {
    app.querySelector('.stage')?.classList.remove('dragging');
    swallowNextClick();
    camDone();
  }
  drag = null;
});

// ---------- desktop: keyboard and drag-to-pan ----------

document.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const click = (act: string) => app.querySelector<HTMLButtonElement>(`[data-act="${act}"]:not(:disabled)`)?.click();
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === 'z') {
    e.preventDefault();
    return click('undo');
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Space rolls when the dice are waiting, otherwise it ends the turn like Enter.
  if (k === 'r' || (k === ' ' && sess.state.phase === 'roll' && !app.querySelector('.cover [data-act="ack"]'))) {
    e.preventDefault();
    return click('roll');
  }
  if (k === ' ') e.preventDefault();
  if (k === 'enter' || k === 'e' || k === ' ') return click(app.querySelector('.cover [data-act="ack"]') ? 'ack' : sess.state.phase === 'deploy' ? 'done' : 'end');
  if (k === 'u') return click('undo');
  if (k === 'n' || k === 'tab') {
    e.preventDefault();
    return nextPiece();
  }
  if (k === 'h') return click('danger');
  if (k === 'p') return click('panel');
  // Camera keys: Q / W turn, Z / X tilt, C reset.
  const nudge = (yaw: number, pitch: number) => {
    cam = { ...cam, yaw: cam.yaw + yaw, pitch: tilt ? clampPitch(cam.pitch + pitch) : cam.pitch };
    saveCam();
    render();
  };
  if (k === 'q') return nudge(-Math.PI / 12, 0);
  if (k === 'w') return nudge(Math.PI / 12, 0);
  if (k === 'z') return nudge(0, -0.1);
  if (k === 'x') return nudge(0, 0.1);
  if (k === 'c') {
    cam = { ...CAM_DEFAULT };
    saveCam();
    return render();
  }
  if (k === 'v') return click('cam-flip');
  if (k === 'f') return click('fullscreen');
  if (k === 't') return click('take');
  if (k === 'a') return click(sess.state.phase === 'deploy' ? 'auto' : '');
  if (k.startsWith('arrow')) {
    e.preventDefault();
    const step = 80;
    panBy(k === 'arrowleft' ? step : k === 'arrowright' ? -step : 0, k === 'arrowup' ? step : k === 'arrowdown' ? -step : 0);
    saveCam();
    return render();
  }
  if (k === '+' || k === '=') return click('zoom-in');
  if (k === '-' || k === '_') return click('zoom-out');
  if (k === 'escape') {
    // setup summary: Escape steps back one page (showcase, then sub-page, then the gallery).
    if (apFac && (setupOpen || galleryOpen)) return click('ap-back');
    if (setupOpen && setupPage) return click('setup-sub-back');
    if (choosing && galleryOpen) return click('gallery-back');
    if (menuOpen) menuOpen = false;
    selected = null;
    message = null;
    return render();
  }
});

// ---------- view cube ----------
// Dragging the little cube in the corner orbits and tilts the camera, like Option + drag.
let cubeDrag: { x: number; y: number; yaw: number; pitch: number; id: number } | null = null;
app.addEventListener('pointerdown', (e) => {
  const cube = (e.target as Element).closest<HTMLElement>('.viewcube');
  if (!cube) return;
  e.preventDefault();
  try {
    cube.setPointerCapture(e.pointerId);
  } catch {
    /* keep going without capture */
  }
  cubeDrag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch, id: e.pointerId };
});
app.addEventListener('pointermove', (e) => {
  if (!cubeDrag || e.pointerId !== cubeDrag.id) return;
  cam = {
    ...cam,
    yaw: cubeDrag.yaw - (e.clientX - cubeDrag.x) * flipSign() * 0.012,
    pitch: tilt ? clampPitch(cubeDrag.pitch - (e.clientY - cubeDrag.y) * flipSign() * 0.006) : cam.pitch,
  };
  camFrame();
});
const endCube = (e: PointerEvent) => {
  if (!cubeDrag || e.pointerId !== cubeDrag.id) return;
  cubeDrag = null;
  camDone();
};
app.addEventListener('pointerup', endCube);
app.addEventListener('pointercancel', endCube);

window.addEventListener('resize', () => {
  if (isDesktop() !== desktop && !rolling) return render();
  if (isPortrait() !== portrait && !rolling) render();
});

// Offline play and "Add to Home Screen" as an app (only for the published game).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => undefined);
}

// ---------- end-of-battle replay (src/ui/replay.ts) ----------
// The replay borrows this board, its effects and camera; the live game and its save are never changed.
let camBeforeReplay: Camera | null = null;
let replayGlideAt = 0;
initReplay({
  live: () => sess.state,
  lang: () => lang,
  render,
  settle: (st) => {
    prevLog = st.log.length;
    prevPos = new Map(st.units.map((u) => [u.id, u.pos]));
  },
  follow: (hexes, ms) => {
    const pts = hexes.map((h) => hexOnMap(h, { portrait }));
    const x = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const y = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const [fw, fh] = mapSize(portrait);
    // Calm (David 2026-11-18: it jumped side to side): keep the zoom, never move more than once in 1.6 s, and
    // only when the action is near the edge of what is on screen or off it, then glide slowly and only part way.
    const zoom = cam.zoom;
    const [cx, cy] = [cam.x ?? fw / 2, cam.y ?? fh / 2];
    const [hw, hh] = [fw / (2 * zoom), fh / (2 * zoom)];
    if (Math.abs(x - cx) < hw * 0.7 && Math.abs(y - cy) < hh * 0.7) return;
    const now = performance.now();
    if (now - replayGlideAt < 1600) return;
    replayGlideAt = now;
    glideTo({ x: cx + (x - cx) * 0.75, y: cy + (y - cy) * 0.75, zoom }, Math.max(1100, ms * 2));
  },
  begin: () => {
    camBeforeReplay = { ...cam };
    selected = null;
    menuOpen = false;
  },
  end: () => {
    ++glideId; // stop any glide still running
    if (camBeforeReplay) cam = camBeforeReplay;
    camBeforeReplay = null;
    saveCam();
    overHidden = false;
  },
});

// ---------- first-battle tutorial (src/ui/tutorial.ts) ----------
// A separate in-memory session against a scripted enemy; everything below is put back afterwards.
initTutorial({
  app,
  fresh: !saved && !new URLSearchParams(location.search).has('g') && !new URLSearchParams(location.search).has('map'),
  lang: () => lang,
  state: () => sess.state,
  selected: () => selected,
  hadGame: () => !choosing && sess.state.log.length + sess.state.units.length > 0,
  enter: (state) => {
    const snap = { sess, settings, mode, cover, choosing, setupOpen, overHidden, cam: { ...cam } };
    mode = 'ai';
    cover = choosing = setupOpen = menuOpen = overHidden = confirmEnd = confirmNew = dangerOn = false;
    selected = pending = null;
    message = null;
    cam = { ...CAM_DEFAULT };
    sess = startSession(state);
    prevLog = state.log.length;
    prevPos = new Map(state.units.map((u) => [u.id, u.pos]));
    render();
    return () => {
      ({ sess, settings, mode, cover, choosing, setupOpen, overHidden } = snap);
      cam = snap.cam;
      selected = pending = null;
      message = null;
      camHome = null;
      applySettings(settings);
      prevLog = sess.state.log.length;
      prevPos = new Map(sess.state.units.map((u) => [u.id, u.pos]));
      saveCam();
      render();
    };
  },
  quickBattle: () => {
    // Straight into a real battle against the computer.
    if (net) leaveNet();
    mode = 'ai';
    restart(quickBattle());
  },
});

render();
loadGround(() => render());

// Dev only: lets the test browser read and set the session (stripped from the built game).
if (import.meta.env.DEV) {
  (window as unknown as { boc: object }).boc = {
    get sess() { return sess; },
    set sess(v: typeof sess) { sess = v; render(); },
    get selected() { return selected; },
    get message() { return message; },
    set mode(m: typeof mode) { mode = m; },
    get cam() { return cam; },
    set cam(c: Camera) { cam = c; render(); },
    scheduleAi,
    // miniature look / battle intro (dev measurements): mini.on(false) switches the look for a measurement only.
    mini: { stats: miniStats, reset: miniReset, on: (v: boolean) => { miniSetPref(v); render(); } },
    intro() { introSeen = 'setup'; introCheck(sess.state); },
    get introPlaying() { return introPlaying; },
    skipIntro() { introEnd?.(); },
    /** Orbits and pans the camera for `ms` the way a finger would (camera frames only) and returns the frame times. */
    orbit(ms = 3000): Promise<{ frames: number; median: number; p90: number; mean: number }> {
      const start = { ...cam };
      const t0 = performance.now();
      const dts: number[] = [];
      let prev = t0;
      return new Promise((done) => {
        const step = () => {
          const now = performance.now();
          if (now > t0 + 1) dts.push(now - prev);
          prev = now;
          const k = (now - t0) / ms;
          cam = { ...start, yaw: start.yaw + Math.sin(k * Math.PI * 2) * 0.6, x: (start.x ?? mapSize(portrait)[0] / 2) + Math.sin(k * Math.PI * 4) * 60 };
          camFrame();
          if (now - t0 < ms) requestAnimationFrame(step);
          else {
            cam = start;
            camDone();
            const sorted = [...dts].sort((a, b) => a - b);
            done({ frames: dts.length, median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.floor(sorted.length * 0.9)], mean: dts.reduce((a, b) => a + b, 0) / dts.length });
          }
        };
        requestAnimationFrame(step);
      });
    },
    /** Starts a quick battle on any map, shelved ones too (e.g. boc.loadMap('ridge') for the raised high ground). */
    loadMap(map: MapId, size?: 'standard' | 'large') {
      settings = { ...settings, map, ...(size ? { size } : {}) };
      applySettings(settings);
      selected = null;
      choosing = false;
      cover = false;
      introSeen = null; // battle intro: dev screenshots start without it (boc.intro() plays it)
      sess = startSession(quickStart());
      render();
    },
  };
  // Dev screenshots: ?map=ridge&cam=yaw,pitch,zoom[,x,y]&put=unitId:col:row,... (a fresh browser profile keeps the real save untouched).
  const q = new URLSearchParams(location.search);
  const qMap = q.get('map') as MapId | null;
  if (qMap) {
    // Random maps: &seed=123&style=valley&knobs=woods,water,rivers,hills,villages,rocks (step numbers).
    if (qMap === 'random') {
      const kn = q.get('knobs')?.split(',').map(Number);
      settings = { ...settings, mapSeed: Number(q.get('seed') ?? 1), mapStyle: (q.get('style') as MapStyle) ?? 'valley', mapBiome: (q.get('biome') as BiomeId) ?? undefined, mapKnobs: kn ? (Object.fromEntries(KNOB_IDS.map((id, i) => [id, kn[i] ?? 0])) as unknown as MapKnobs) : undefined };
    }
    // &sides=frontier,teutonic: the two armies (biomes: home-map screenshots).
    const qSides = q.get('sides')?.split(',') as FactionId[] | undefined;
    if (qSides?.length === 2) settings = { ...settings, sides: { red: qSides[0], blue: qSides[1] } };
    const dev = (window as unknown as { boc: { loadMap: (m: MapId, size?: 'standard' | 'large') => void } }).boc;
    dev.loadMap(qMap, q.get('size') === 'large' ? 'large' : 'standard');
    const moves = (q.get('put') ?? '').split(',').filter(Boolean).map((t) => t.split(':'));
    if (moves.length) {
      const st = sess.state;
      sess = startSession({ ...st, units: st.units.map((u) => { const m = moves.find((mv) => mv[0] === u.id); return m ? { ...u, pos: { col: +m[1], row: +m[2] } } : u; }) });
    }
    const c = q.get('cam')?.split(',').map(Number);
    if (c) cam = { yaw: c[0], pitch: c[1], zoom: c[2], x: c.length > 3 ? c[3] : null, y: c.length > 4 ? c[4] : null };
    if (q.get('flat') === '1') tilt = false;
    render();
  }
}

/** When the game comes back on screen (or every few minutes), check whether a newer version has been put online:
 *  the page's script has a new name after every update, so a different name means reload to get it. A game in
 *  progress is saved, so the reload loses nothing. */
async function checkForUpdate() {
  if (import.meta.env.DEV) return;
  try {
    const html = await (await fetch('./', { cache: 'no-store' })).text();
    const live = html.match(/assets\/index-[\w-]+\.js/)?.[0];
    const mine = [...document.scripts].map((x) => x.src).find((src) => /assets\/index-[\w-]+\.js/.test(src));
    if (live && mine && !mine.includes(live)) location.reload();
  } catch {
    /* offline: keep playing this version */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void checkForUpdate();
});
setInterval(() => void checkForUpdate(), 5 * 60 * 1000);

