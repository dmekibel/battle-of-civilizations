import { describe, expect, it } from 'vitest';
import { deleteSlot, INDEX_KEY, LEGACY_KEY, listSlots, migrate, readSlot, slotKey, writeSlot, type Store } from '../src/ui/saves';

function memStore(): Store & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, get: (k) => map.get(k) ?? null, set: (k, v) => (map.set(k, v), true), remove: (k) => void map.delete(k) };
}
const sum = (d: unknown) => ((d as { turn?: number })?.turn ?? null);

describe('saved games', () => {
  it('creates a slot and reads it back', () => {
    const s = memStore();
    expect(writeSlot(s, 'a', { turn: 1 }, 1, 100)).toBe(true);
    expect(listSlots(s).map((m) => m.id)).toEqual(['a']);
    expect(readSlot(s, 'a')).toEqual({ turn: 1 });
  });

  it('a new game gets its own slot, newest first, and never erases the last', () => {
    const s = memStore();
    writeSlot(s, 'a', { turn: 3 }, 3, 100);
    writeSlot(s, 'b', { turn: 1 }, 1, 200);
    expect(listSlots(s).map((m) => m.id)).toEqual(['b', 'a']);
    expect(readSlot(s, 'a')).toEqual({ turn: 3 });
  });

  it('updates a slot in place and moves it to the top', () => {
    const s = memStore();
    writeSlot(s, 'a', { turn: 1 }, 1, 100);
    writeSlot(s, 'b', { turn: 1 }, 1, 200);
    writeSlot(s, 'a', { turn: 5 }, 5, 300);
    const list = listSlots<number>(s);
    expect(list.map((m) => m.id)).toEqual(['a', 'b']);
    expect(list[0].info).toBe(5);
    expect(readSlot(s, 'a')).toEqual({ turn: 5 });
  });

  it('keeps at most the cap, dropping the oldest and its data', () => {
    const s = memStore();
    for (let i = 0; i < 12; i++) writeSlot(s, `g${i}`, { turn: i }, i, 100 + i);
    const list = listSlots(s);
    expect(list).toHaveLength(10);
    expect(list[0].id).toBe('g11');
    expect(list.map((m) => m.id)).not.toContain('g0');
    expect(list.map((m) => m.id)).not.toContain('g1');
    expect(s.map.has(slotKey('g0'))).toBe(false);
    expect(s.map.has(slotKey('g2'))).toBe(true);
  });

  it('deletes a slot and its data', () => {
    const s = memStore();
    writeSlot(s, 'a', { turn: 1 }, 1, 100);
    writeSlot(s, 'b', { turn: 1 }, 1, 200);
    deleteSlot(s, 'a');
    expect(listSlots(s).map((m) => m.id)).toEqual(['b']);
    expect(readSlot(s, 'a')).toBeNull();
  });

  it('migrates the old single save into the first slot, once', () => {
    const s = memStore();
    s.set(LEGACY_KEY, JSON.stringify({ turn: 7 }));
    migrate(s, sum, 500, 'old');
    const list = listSlots<number>(s);
    expect(list).toEqual([{ id: 'old', at: 500, info: 7 }]);
    expect(readSlot(s, 'old')).toEqual({ turn: 7 });
    expect(s.get(LEGACY_KEY)).toBeNull();
    // Already migrated: a later legacy save is left alone.
    s.set(LEGACY_KEY, JSON.stringify({ turn: 9 }));
    migrate(s, sum, 600, 'again');
    expect(listSlots(s).map((m) => m.id)).toEqual(['old']);
  });

  it('migration with nothing (or junk) to bring over makes an empty list', () => {
    const s = memStore();
    migrate(s, sum);
    expect(s.get(INDEX_KEY)).toBe('[]');
    const j = memStore();
    j.set(LEGACY_KEY, '{not json');
    migrate(j, sum);
    expect(listSlots(j)).toEqual([]);
  });

  it('survives a broken index and storage that refuses writes', () => {
    const s = memStore();
    s.set(INDEX_KEY, 'garbage');
    expect(listSlots(s)).toEqual([]);
    const full: Store = { get: () => null, set: () => false, remove: () => {} };
    expect(writeSlot(full, 'a', {}, 1)).toBe(false);
    expect(listSlots(full)).toEqual([]);
  });
});
