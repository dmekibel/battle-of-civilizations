// ---------- saved games ----------
// Every game (vs computer, two players on one phone, online, campaign) gets its own slot, so starting a new one
// never erases the last. A small index lists the slots newest first (with a summary for the list); each slot's
// game lives under its own key, so saving one game rewrites only that game. At most MAX_SLOTS are kept: the
// oldest is dropped. The single save from before slots ('boc-save-v1') becomes the first slot.

export const INDEX_KEY = 'boc-saves-v1';
export const LEGACY_KEY = 'boc-save-v1';
export const MAX_SLOTS = 10;
export const slotKey = (id: string) => `boc-slot-${id}`;

/** Key/value storage (localStorage in the game, a Map in the tests). Never throws. */
export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
}

/** One entry of the list: when it was last played and what the list shows for it. */
export interface SlotMeta<I = unknown> {
  id: string;
  at: number;
  info: I;
}

/** The browser's localStorage, with every access wrapped (private windows and full storage just don't save). */
export function browserStore(): Store {
  return {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } },
    remove: (k) => { try { localStorage.removeItem(k); } catch { /* blocked */ } },
  };
}

/** A fresh slot id. */
export function newSlotId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function readIndex(store: Store): SlotMeta[] | null {
  const raw = store.get(INDEX_KEY);
  if (raw === null) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((m) => m && typeof m.id === 'string' && typeof m.at === 'number') : [];
  } catch {
    return [];
  }
}

const sorted = <I>(list: SlotMeta<I>[]) => [...list].sort((a, b) => b.at - a.at);

/** The old single save becomes the first slot (once: only while there is no index yet). */
export function migrate<I>(store: Store, summarize: (data: unknown) => I | null, now = Date.now(), id = newSlotId()): void {
  if (readIndex(store) !== null) return;
  const old = store.get(LEGACY_KEY);
  let list: SlotMeta[] = [];
  if (old) {
    try {
      const data = JSON.parse(old);
      const info = summarize(data);
      if (info !== null && store.set(slotKey(id), old)) list = [{ id, at: now, info }];
    } catch { /* unreadable: nothing to bring over */ }
  }
  if (store.set(INDEX_KEY, JSON.stringify(list)) && list.length) store.remove(LEGACY_KEY);
}

/** All saved games, newest first. */
export function listSlots<I>(store: Store): SlotMeta<I>[] {
  return sorted((readIndex(store) ?? []) as SlotMeta<I>[]);
}

/** One slot's game, or null if it is gone or unreadable. */
export function readSlot<T>(store: Store, id: string): T | null {
  const raw = store.get(slotKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Saves a game into its slot (a new slot goes to the top; an existing one is updated in place and becomes the
 *  newest). Beyond `cap` slots the oldest are dropped. Returns false if storage refused it. */
export function writeSlot<I>(store: Store, id: string, data: unknown, info: I, now = Date.now(), cap = MAX_SLOTS): boolean {
  const list = (readIndex(store) ?? []).filter((m) => m.id !== id);
  if (!store.set(slotKey(id), JSON.stringify(data))) return false;
  const next = sorted([{ id, at: now, info }, ...list]);
  const keep = [next[0], ...next.slice(1).filter((m) => m.id !== id)].slice(0, Math.max(1, cap));
  for (const m of next) if (!keep.includes(m)) store.remove(slotKey(m.id));
  return store.set(INDEX_KEY, JSON.stringify(keep));
}

/** Removes a saved game for good. */
export function deleteSlot(store: Store, id: string): void {
  const list = readIndex(store) ?? [];
  store.remove(slotKey(id));
  store.set(INDEX_KEY, JSON.stringify(list.filter((m) => m.id !== id)));
}

/** "2 h ago" / "2 ч назад". */
export function agoText(lang: 'en' | 'ru', ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return lang === 'ru' ? 'только что' : 'just now';
  if (min < 60) return lang === 'ru' ? `${min} мин назад` : `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return lang === 'ru' ? `${h} ч назад` : `${h} h ago`;
  const d = Math.round(h / 24);
  return lang === 'ru' ? `${d} дн назад` : `${d} d ago`;
}
