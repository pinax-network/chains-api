import { describe, it, expect, afterEach } from 'vitest';
import { indexData } from '../../../src/store/indexer.js';
import { cachedData } from '../../../src/store/cache.js';
import { searchChains, _resetGetAllChainsCacheForTests } from '../../../src/store/queries.js';

// Regression: searchChains matched the WHOLE query as one substring, so
// "Base mainnet" returned only "ZKBase Mainnet" (whose name contains the
// phrase) and never the chain actually named "Base" — the assistant then
// answered questions about Base with ZKBase data. mainnet/testnet must act
// as variant filters, not name text.
describe('searchChains — mainnet/testnet qualifier handling', () => {
  const chains = [
    { chainId: 8453, name: 'Base', shortName: 'base' },
    { chainId: 1456, name: 'ZKBase Mainnet', shortName: 'zkbase', slip44: 1 },
    { chainId: 84532, name: 'Base Sepolia Testnet', shortName: 'basesep', slip44: 1 },
    { chainId: 1287, name: 'Moonbase Alpha', shortName: 'mbase', slip44: 1 },
    { chainId: 32323, name: 'BasedAI', shortName: 'basedai' },
    { chainId: 1, name: 'Ethereum Mainnet', shortName: 'eth' }
  ];

  const setup = () => {
    cachedData.indexed = indexData(null, null, chains, null);
    _resetGetAllChainsCacheForTests();
  };

  afterEach(() => {
    cachedData.indexed = null;
    _resetGetAllChainsCacheForTests();
  });

  it('"Base mainnet" returns the chain named "Base" first', () => {
    setup();
    const ids = searchChains('Base mainnet').map(c => c.chainId);
    expect(ids[0]).toBe(8453);
    // The phrase match ("ZKBase Mainnet") is still included, just not alone
    expect(ids).toContain(1456);
  });

  it('"Base mainnet" excludes testnets that merely contain "base"', () => {
    setup();
    const ids = searchChains('Base mainnet').map(c => c.chainId);
    expect(ids).not.toContain(84532); // Base Sepolia Testnet
    expect(ids).not.toContain(1287); // Moonbase Alpha
  });

  it('"base testnet" returns testnets, not the mainnet chain', () => {
    setup();
    const ids = searchChains('base testnet').map(c => c.chainId);
    expect(ids).toContain(84532);
    expect(ids).not.toContain(8453);
  });

  it('plain "base" keeps the original broad substring behavior', () => {
    setup();
    const ids = searchChains('base').map(c => c.chainId);
    expect(ids).toEqual(expect.arrayContaining([8453, 1456, 84532, 1287, 32323]));
  });

  it('a bare qualifier ("mainnet") still searches names as before', () => {
    setup();
    const ids = searchChains('mainnet').map(c => c.chainId);
    expect(ids).toEqual(expect.arrayContaining([1456, 1]));
    expect(ids).not.toContain(8453);
  });

  it('numeric chain-id lookup still ranks first', () => {
    setup();
    expect(searchChains('8453')[0].chainId).toBe(8453);
  });
});
