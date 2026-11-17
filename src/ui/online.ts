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
