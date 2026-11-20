// Unit voices (Age of Empires style): every piece in every army answers in its own voice and language when picked,
// moved, fighting, hit or killed; Kings and Champions also have a victory line, Champions an entrance line.
// Recordings are public/voice/<army>/<type>-<moment>-<n>.mp3 (made by _art/voices.py), listed in public/voice/manifest.json.
// Only the two armies in the battle are fetched. A small limiter keeps it from turning into a crowd:
// one voice line at a time, a more urgent line cuts a calmer one off, the rest are skipped, and picks have a cooldown.
// Also here: the material-aware sounds of a fight and the ground under a moving piece (the cues live in sound.ts).

import { CONFIG, type TerrainId, type UnitTypeId } from '../config';
import { audio, isMuted, outlet, sound, type Cue } from './sound';

export type Moment = 'select' | 'move' | 'attack' | 'hit' | 'death' | 'victory' | 'entrance';
type Manifest = Record<string, Partial<Record<string, Partial<Record<Moment, number>>>>>;

/** How urgent each moment is: a line can cut off one that is less urgent. */
const PRIORITY: Record<Moment, number> = { select: 1, move: 1, attack: 2, hit: 3, death: 4, entrance: 4, victory: 5 };
/** Seconds before another pick or move line may play. */
const COOLDOWN: Partial<Record<Moment, number>> = { select: 0.6, move: 0.5 };
const VOL = 0.9;
/** Grunts and war cries sit under the fight's clash (they were too loud, David 2026-11-20); death cries a little less so. */
const MOMENT_VOL: Partial<Record<Moment, number>> = { hit: 0.4, attack: 0.5, death: 0.7 };

// ---------- settings ----------
const VOICE_KEY = 'boc-voices';
let voicesOn = (() => {
  try {
    return localStorage.getItem(VOICE_KEY) !== 'off';
  } catch {
    return true;
  }
})();
/** "native" = each army speaks its own language; "off" = no voices (effects still play). */
export const voiceMode = (): 'native' | 'off' => (voicesOn ? 'native' : 'off');
export function toggleVoices() {
  voicesOn = !voicesOn;
  try {
    localStorage.setItem(VOICE_KEY, voicesOn ? 'native' : 'off');
  } catch {
    /* keep it for this visit only */
  }
  if (!voicesOn) stopLine();
}

// ---------- loading ----------
let manifest: Manifest | null = null;
let manifestLoading = false;
const clips = new Map<string, AudioBuffer>();
const armiesLoading = new Set<string>();
const base = () => `${import.meta.env.BASE_URL}voice/`;

function loadManifest() {
  if (manifest || manifestLoading) return;
  manifestLoading = true;
  fetch(`${base()}manifest.json?v=1`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((m: Manifest) => {
      manifest = m;
      for (const a of wanted) loadArmy(a);
    })
    .catch(() => (manifestLoading = false));
}

function loadArmy(army: string) {
  const c = audio();
  if (!c || !manifest || armiesLoading.has(army) || !manifest[army]) return;
  armiesLoading.add(army);
  for (const [type, moments] of Object.entries(manifest[army])) {
    for (const [moment, n] of Object.entries(moments ?? {})) {
      for (let i = 1; i <= (n ?? 0); i++) {
        const name = `${army}/${type}-${moment}-${i}`;
        fetch(`${base()}${name}.mp3?v=1`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
          .then((b) => new Promise<AudioBuffer>((ok, no) => c.decodeAudioData(b, ok, no)))
          .then((buf) => clips.set(name, buf))
          .catch(() => {
            /* that line just stays silent */
          });
      }
    }
  }
}

let wanted: string[] = [];
/** The armies in this battle: their voices load (the others are never fetched). Safe to call on every draw. */
export function prepareVoices(armies: string[]) {
  wanted = [...new Set(armies)];
  if (!voicesOn || isMuted() || !audio()) return;
  if (!manifest) return loadManifest();
  for (const a of wanted) loadArmy(a);
}

/** What kind of voice a piece has; a piece with no recordings of its own borrows one of the same kind from its army. */
const KIND: Partial<Record<UnitTypeId, string>> = {
  king: 'king', champion: 'champ', championRider: 'champ', championGun: 'champ',
  heavyInfantry: 'heavy', samurai: 'heavy', lineInfantry: 'heavy', impi: 'heavy', jaguar: 'heavy', berserker: 'heavy',
  lightInfantry: 'foot', ashigaru: 'foot', deputy: 'foot', boarder: 'foot',
  lightCavalry: 'rider', heavyCavalry: 'rider', cowboy: 'rider', chariot: 'rider',
  archer: 'ranged', horseArcher: 'ranged', gunslinger: 'ranged', rifleman: 'ranged', skirmisher: 'ranged',
  axeThrower: 'ranged', atlatl: 'ranged', thrower: 'ranged', bomber: 'ranged', cannon: 'crew', ballista: 'crew',
  banner: 'foot', scout: 'foot', shieldbearer: 'heavy', wildRider: 'rider', crossbow: 'ranged', longRifle: 'ranged', rocket: 'crew',
};

function takesFor(army: string, type: UnitTypeId, moment: Moment): AudioBuffer[] {
  const m = manifest?.[army];
  if (!m) return [];
  let t: string = type;
  if (!m[t]?.[moment]) {
    const kind = KIND[type];
    t = Object.keys(m).find((x) => KIND[x as UnitTypeId] === kind && m[x]?.[moment]) ?? '';
    if (!t) return [];
  }
  const n = m[t]?.[moment] ?? 0;
  return Array.from({ length: n }, (_, i) => clips.get(`${army}/${t}-${moment}-${i + 1}`)).filter((b): b is AudioBuffer => !!b);
}

// ---------- the limiter ----------
interface Playing { src: AudioBufferSourceNode; gain: GainNode; prio: number; ends: number }
let now: Playing | null = null;
const lastAt = new Map<Moment, number>();
const lastTake = new Map<string, AudioBuffer>();
/** For checking the limiter from the console: lines played, skipped and cut off. */
export const voiceStats = { played: 0, skipped: 0, cut: 0 };

function stopLine() {
  if (!now) return;
  const c = audio();
  if (c) {
    now.gain.gain.setTargetAtTime(0, c.currentTime, 0.02);
    now.src.stop(c.currentTime + 0.1);
  }
  now = null;
}

const SPOKEN = new Set<Moment>(['select', 'move', 'victory', 'entrance']);

function playLine(army: string, type: UnitTypeId, moment: Moment, near: boolean): boolean {
  if (!voicesOn || isMuted()) return false;
  // Words are off for now (David, 2026-11-18): only wordless war cries, grunts and death cries play.
  if (SPOKEN.has(moment)) return false;
  const c = audio();
  if (!c) return false;
  const takes = takesFor(army, type, moment);
  if (!takes.length) {
    if (!manifest) loadManifest();
    else loadArmy(army);
    return false;
  }
  const t = c.currentTime;
  const prio = PRIORITY[moment];
  const busy = now && now.ends > t;
  if (busy) {
    // A more urgent line cuts the current one off (deaths and victories cut off each other too); anything else waits its turn and is dropped.
    if (prio > now!.prio || (prio >= 4 && prio >= now!.prio)) {
      stopLine();
      voiceStats.cut++;
    } else return (voiceStats.skipped++, false);
  }
  const cool = COOLDOWN[moment];
  if (cool && t - (lastAt.get(moment) ?? -9) < cool) return (voiceStats.skipped++, false);
  lastAt.set(moment, t);
  // Never the same take twice in a row for one piece and moment.
  const key = `${army}/${type}/${moment}`;
  const pool = takes.length > 1 ? takes.filter((b) => b !== lastTake.get(key)) : takes;
  const buf = pool[Math.floor(Math.random() * pool.length)];
  lastTake.set(key, buf);
  const src = c.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.98 + Math.random() * 0.04;
  const gain = c.createGain();
  gain.gain.value = MOMENT_VOL[moment] ?? VOL;
  src.connect(gain).connect(outlet(c, 'voice', near));
  src.start(t);
  const mine: Playing = { src, gain, prio, ends: t + buf.duration };
  now = mine;
  src.onended = () => {
    if (now === mine) now = null;
  };
  voiceStats.played++;
  return true;
}

/** A piece speaks `delay` seconds from now. The limiter decides at that moment whether it plays. */
export function voice(army: string, type: UnitTypeId, moment: Moment, opts: { delay?: number; near?: boolean } = {}) {
  const go = () => playLine(army, type, moment, opts.near ?? true);
  if (opts.delay && opts.delay > 0) setTimeout(go, opts.delay * 1000);
  else go();
}

// ---------- game moments ----------
const greeted = new Set<string>();
/** A piece was picked: its acknowledgement, a Champion's entrance line the first time, and now and then a horse's snort. */
export function selectVoice(army: string, type: UnitTypeId, unitId: string) {
  const champ = KIND[type] === 'champ';
  if (champ && !greeted.has(`${army}/${unitId}`)) {
    greeted.add(`${army}/${unitId}`);
    if (playLine(army, type, 'entrance', true)) return;
  }
  playLine(army, type, 'select', true);
  // No snort for the chariot: it read as a strange noise from a cart (David 2026-11-20).
  if (CONFIG.units[type]?.mounted && type !== 'chariot' && Math.random() < 0.35) sound('snort', 0.08);
}

/** Footsteps or hoofbeats for each hex walked (a splash at a ford, a hollow thud on a bridge), and the piece's "Moving!". */
export function marchSounds(army: string, type: UnitTypeId, ground: TerrainId[], stepMs: number, near: boolean, speak: boolean) {
  const hoof = !!CONFIG.units[type]?.mounted;
  ground.forEach((g, i) => {
    const cue: Cue = g === 'ford' || g === 'river' || g === 'swamp' ? 'splash' : g === 'bridge' ? 'bridge' : hoof ? 'hoof' : 'step';
    sound(cue, (i * stepMs) / 1000, near);
  });
  // The other side's pieces talk less, so the computer's turn isn't a running commentary.
  if (speak && (near || Math.random() < 0.4)) voice(army, type, 'move', { near });
}

type Weapon = 'sword' | 'axe' | 'spear' | 'club';
/** What a piece fights with up close, for the sound of the blow. */
function weaponOf(army: string, type: UnitTypeId): Weapon {
  if (army === 'vikings' && type !== 'archer') return 'axe';
  if (type === 'jaguar' || (army === 'aztecs' && type === 'heavyInfantry') || (army === 'comanche' && type === 'lightInfantry')) return 'club';
  if (['lightInfantry', 'ashigaru', 'impi', 'lightCavalry', 'championRider', 'chariot', 'thrower', 'atlatl', 'shieldbearer', 'wildRider'].includes(type)) return 'spear';
  return 'sword';
}

export interface Blow {
  kind: 'attack' | 'shoot';
  unit: UnitTypeId;
  target: UnitTypeId;
  damage: number;
  killed: boolean;
  attackerKilled?: boolean;
}

/** A fight: the attacker's war cry, the weapon (and what it lands on) when the board shows the hit, then the
 *  defender's grunt, or death cry, and the figure toppling. `lands` = seconds until the blow lands on the board. */
export function fightSounds(b: Blow, attArmy: string, defArmy: string, nearAtt: boolean, nearDef: boolean, lands: number, gun: Cue | null) {
  const defRules = CONFIG.units[b.target];
  // War cry: always for a melee blow; archers and gunners are terser and only grunt now and then.
  if (b.kind === 'attack' || Math.random() < 0.45) voice(attArmy, b.unit, 'attack', { near: nearAtt });
  if (gun) sound(gun, 0, nearAtt);
  else if (b.kind === 'shoot') {
    sound('bow', 0, nearAtt);
    // Into a shield (heavy pieces carry one) or into a body.
    sound(defRules?.heavy && !b.killed ? 'thunk' : 'flesh', lands, nearDef);
  } else {
    const w = weaponOf(attArmy, b.unit);
    const cue: Cue = w === 'axe' ? 'axe' : w === 'club' ? 'club' : w === 'spear' && defRules?.mounted ? 'spear' : defRules?.heavy ? 'shield' : 'clash';
    sound(cue, lands - 0.04, nearDef);
  }
  if (b.killed) {
    voice(defArmy, b.target, 'death', { delay: lands + 0.1, near: nearDef });
    sound('death', lands + 0.15, nearDef);
  }
  // No grunt when a piece is hurt: they sounded awkward (David 2026-11-20); the blow's own sound carries it.
  // Spears struck back and killed the rider.
  if (b.attackerKilled) {
    voice(attArmy, b.unit, 'death', { delay: lands + 0.7, near: nearAtt });
    sound('death', lands + 0.75, nearAtt);
  }
}

/** The winning side's King (or, if he fell, its Champion) has the last word. */
export function victoryVoice(army: string, survivors: UnitTypeId[], near: boolean) {
  const who = survivors.includes('king') ? 'king' : survivors.find((t) => KIND[t] === 'champ');
  if (who) voice(army, who, 'victory', { delay: 0.9, near });
}
