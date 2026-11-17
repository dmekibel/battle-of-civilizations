import { describe, expect, it } from 'vitest';
import { CODE_ABC, CODE_LEN, codeDoc, newCode, normCode } from '../src/ui/online';

describe('join codes', () => {
  it('uses no look-alike characters', () => {
    for (const c of '01OIL') expect(CODE_ABC).not.toContain(c);
  });
  it('makes codes of the right length from the alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const c = newCode(Math.random); // Node 18 has no global crypto; browsers use it by default
      expect(c).toHaveLength(CODE_LEN);
      for (const ch of c) expect(CODE_ABC).toContain(ch);
    }
    expect(newCode(() => 0)).toBe('22222');
    expect(newCode(() => 0.9999)).toBe('ZZZZZ');
  });
  it('normalises what people type', () => {
    expect(normCode('ab3k9')).toBe('AB3K9');
    expect(normCode(' ab-3k 9 ')).toBe('AB3K9');
    expect(normCode('AB3K')).toBeNull();
    expect(normCode('AB3K90')).toBeNull();
    expect(normCode('AB0K9')).toBeNull();
  });
  it('stores the lookup under an id the database rules accept', () => {
    expect(codeDoc('AB3K9')).toMatch(/^[a-z0-9]{16,40}$/);
  });
});
