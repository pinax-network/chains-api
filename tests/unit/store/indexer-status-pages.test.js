import { describe, it, expect } from 'vitest';
import { indexData } from '../../../src/store/indexer.js';

describe('indexer — status page attachment', () => {
  it('stamps statusPage onto a chain in the registry', () => {
    const indexed = indexData(null, null, [
      { chainId: 8453, name: 'Base' }
    ], null);

    expect(indexed.byChainId[8453].statusPage).toBe('https://base-l2.statuspage.io/');
  });

  it('leaves chains without a known status page untouched', () => {
    const indexed = indexData(null, null, [
      { chainId: 424242, name: 'Obscure Chain' }
    ], null);

    expect(indexed.byChainId[424242].statusPage).toBeUndefined();
  });
});
