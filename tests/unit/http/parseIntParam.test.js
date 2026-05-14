import { describe, it, expect } from 'vitest';
import { parseIntParam } from '../../../src/http/util/parseIntParam.js';

describe('parseIntParam', () => {
  it('returns the value unchanged for integer numbers', () => {
    expect(parseIntParam(0)).toBe(0);
    expect(parseIntParam(42)).toBe(42);
    expect(parseIntParam(-5)).toBe(-5);
  });

  it('returns null for non-integer numbers', () => {
    expect(parseIntParam(1.5)).toBeNull();
    expect(parseIntParam(Number.NaN)).toBeNull();
    expect(parseIntParam(Infinity)).toBeNull();
  });

  it('parses well-formed integer strings', () => {
    expect(parseIntParam('1')).toBe(1);
    expect(parseIntParam('  42  ')).toBe(42);
    expect(parseIntParam('-7')).toBe(-7);
  });

  it('rejects strings that contain anything other than digits', () => {
    expect(parseIntParam('1.5')).toBeNull();
    expect(parseIntParam('1e3')).toBeNull();
    expect(parseIntParam('0x10')).toBeNull();
    expect(parseIntParam('42abc')).toBeNull();
    expect(parseIntParam('')).toBeNull();
    expect(parseIntParam('   ')).toBeNull();
  });

  it('returns null for non-string non-number inputs', () => {
    expect(parseIntParam(null)).toBeNull();
    expect(parseIntParam(undefined)).toBeNull();
    expect(parseIntParam([])).toBeNull();
    expect(parseIntParam({})).toBeNull();
    expect(parseIntParam(true)).toBeNull();
  });
});
