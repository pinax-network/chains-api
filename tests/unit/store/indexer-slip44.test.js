import { describe, it, expect } from 'vitest';
import { indexData } from '../../../src/store/indexer.js';

describe('indexer — slip44 field retention (regression)', () => {
  it('keeps slip44 on chain entry created from chains.json', () => {
    const indexed = indexData(null, null, [
      { chainId: 1, name: 'Ethereum', slip44: 60 }
    ], { 60: { coinType: 60, symbol: 'ETH', coin: 'Ethereum' } });

    expect(indexed.byChainId[1].slip44).toBe(60);
    expect(indexed.byChainId[1].slip44Info).toEqual({
      coinType: 60,
      symbol: 'ETH',
      coin: 'Ethereum'
    });
  });

  it('keeps slip44 on chain entry created from chainlist', () => {
    const indexed = indexData(
      null,
      [{ chainId: 999, name: 'Test', slip44: 42 }],
      null,
      { 42: { coinType: 42, symbol: 'XYZ', coin: 'Test' } }
    );

    expect(indexed.byChainId[999].slip44).toBe(42);
    expect(indexed.byChainId[999].slip44Info).toMatchObject({ symbol: 'XYZ' });
  });

  it('keeps chains.slip44 even when the chain also appears in chainlist', () => {
    const indexed = indexData(
      null,
      [{ chainId: 1, name: 'Ethereum' }],
      [{ chainId: 1, name: 'Ethereum', slip44: 60 }],
      { 60: { coinType: 60, symbol: 'ETH', coin: 'Ethereum' } }
    );

    expect(indexed.byChainId[1].slip44).toBe(60);
    expect(indexed.byChainId[1].slip44Info).toBeDefined();
  });
});
