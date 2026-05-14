import { describe, it, expect } from 'vitest';
import { parseSLIP44 } from '../../../src/sources/slip44.js';

describe('parseSLIP44 (direct import from src/sources/slip44.js)', () => {
  it('returns an empty object for empty input', () => {
    expect(parseSLIP44('')).toEqual({});
    expect(parseSLIP44(null)).toEqual({});
    expect(parseSLIP44(undefined)).toEqual({});
  });

  it('parses a minimal SLIP-0044 markdown table', () => {
    const md = [
      '| Coin type | Path component | Symbol | Coin |',
      '|-----------|----------------|--------|------|',
      '| 0         | 0x80000000     | BTC    | Bitcoin |',
      '| 60        | 0x8000003c     | ETH    | Ether   |'
    ].join('\n');

    const result = parseSLIP44(md);

    expect(result[0]).toEqual({
      coinType: 0,
      pathComponent: '0x80000000',
      symbol: 'BTC',
      coin: 'Bitcoin'
    });
    expect(result[60]).toEqual({
      coinType: 60,
      pathComponent: '0x8000003c',
      symbol: 'ETH',
      coin: 'Ether'
    });
  });

  it('skips rows that are not numeric coin types', () => {
    const md = [
      '| Coin type | Path component | Symbol | Coin |',
      '|-----------|----------------|--------|------|',
      '| n/a       | 0x80000000     | XX     | Bad  |',
      '| 1         | 0x80000001     | TBTC   | Bitcoin Testnet |'
    ].join('\n');

    const result = parseSLIP44(md);
    expect(Object.keys(result)).toEqual(['1']);
    expect(result[1].coin).toBe('Bitcoin Testnet');
  });

  it('ignores lines outside of the table section', () => {
    const md = [
      '# SLIP-0044',
      'Some intro paragraph.',
      '',
      '| Coin type | Path component | Symbol | Coin |',
      '|-----------|----------------|--------|------|',
      '| 60        | 0x8000003c     | ETH    | Ether |',
      '',
      'Trailing text.'
    ].join('\n');

    const result = parseSLIP44(md);
    expect(Object.keys(result)).toEqual(['60']);
  });
});
