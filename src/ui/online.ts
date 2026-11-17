// Online play: the whole game is one small document in Firestore, read and written over plain HTTPS
// (no login, no library). Whoever's turn it is writes; the other phone asks for news every few seconds.
// The database's rules allow reading a game only by its exact id, so the invite link is the key.

const BASE = 'https://firestore.googleapis.com/v1/projects/battle-of-civilizations/databases/(default)/documents/games/';

export interface Remote {
  rev: number;
  state: string;
}

/** A game id nobody could guess. */
export function newId(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), (n) => abc[n % abc.length]).join('');
}

/** The game as last saved, null if there is no such game. Throws when offline. */
export async function fetchGame(id: string): Promise<Remote | null> {
  const r = await fetch(BASE + id, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  const f = (await r.json()).fields;
  return { rev: Number(f.rev.integerValue), state: f.state.stringValue };
}

/** Saves the game; false if it didn't get through. */
export async function pushGame(id: string, rev: number, state: string): Promise<boolean> {
  try {
    const body = { fields: { state: { stringValue: state }, rev: { integerValue: String(rev) }, at: { integerValue: String(Date.now()) } } };
    const r = await fetch(BASE + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}

// ---------- join by short code ----------
// Home Screen apps can't open links, so the host also gets a short code to read out or type.
// The database's rules only accept documents in `games/` with a 16+ letter lower-case id and the
// game's own fields, so the code's lookup is stored there too: games/codexxxxxxx<code> → { state: <game id> }.

/** No 0/O, 1/I/L, so a code read aloud or off a screen can't be mistyped. */
export const CODE_ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LEN = 5;
const CODE_TTL = 24 * 3600 * 1000;

export function newCode(rand: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32): string {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ABC[Math.floor(rand() * CODE_ABC.length)];
  return s;
}

/** What someone typed, cleaned up: upper case, no spaces or dashes. Null if it can't be a code. */
export function normCode(raw: string): string | null {
  const t = raw.toUpperCase().replace(/[\s\-_.]/g, '');
  if (t.length !== CODE_LEN || [...t].some((c) => !CODE_ABC.includes(c))) return null;
  return t;
}

export const codeDoc = (code: string) => `codexxxxxxx${code.toLowerCase()}`;

async function readCode(code: string): Promise<{ game: string; at: number } | null> {
  const r = await fetch(BASE + codeDoc(code), { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  const f = (await r.json()).fields;
  return { game: f.state.stringValue, at: Number(f.at?.integerValue ?? 0) };
}

/** Gives a game a fresh short code (retrying on a live collision). Null if offline. */
export async function createCode(game: string): Promise<string | null> {
  for (let i = 0; i < 6; i++) {
    const code = newCode();
    try {
      const old = await readCode(code);
      if (old && old.game !== game && Date.now() - old.at < CODE_TTL) continue;
      if (await pushGame(codeDoc(code), 1, game)) return code;
    } catch { /* try another */ }
  }
  return null;
}

/** The game id behind a code; null if there is none (or it expired). Throws when offline. */
export async function resolveCode(code: string): Promise<string | null> {
  const c = await readCode(code);
  if (!c || Date.now() - c.at > CODE_TTL || !/^[a-z0-9]{16,40}$/.test(c.game)) return null;
  return c.game;
}
