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

// Regression: chain 10 is officially named "OP Mainnet", so "optimism" only
// matched dead testnets (Optimism Kovan/Goerli) and "optimism mainnet"
// returned NOTHING — the assistant told users Optimism doesn't exist. The
// community names of renamed chains come from the TheGraph networks registry
// (graph id, shortName, aliases), which the indexer already attaches to each
// chain as `theGraph`.
describe('searchChains — renamed-chain aliases + exact-name ranking', () => {
  const chains = [
    { chainId: 10, name: 'OP Mainnet', shortName: 'oeth' },
    { chainId: 54, name: 'Openpiece Mainnet', shortName: 'op-piece' },
    { chainId: 69, name: 'Optimism Kovan', shortName: 'okov', slip44: 1 },
    { chainId: 56, name: 'BNB Smart Chain Mainnet', shortName: 'bnb' },
    { chainId: 100, name: 'Gnosis', shortName: 'gno' },
    { chainId: 137, name: 'Polygon Mainnet', shortName: 'pol' }
  ];

  // Real shapes from the TheGraph networks registry.
  const theGraph = {
    networks: [
      { id: 'optimism', fullName: 'OP Mainnet', shortName: 'Optimism', caip2Id: 'eip155:10', aliases: ['evm-10', 'op-mainnet', 'optimism-mainnet'] },
      { id: 'bsc', fullName: 'BNB Smart Chain Mainnet', shortName: 'BNB', caip2Id: 'eip155:56', aliases: ['bnb', 'bsc-mainnet'] },
      { id: 'gnosis', fullName: 'Gnosis Mainnet', shortName: 'Gnosis', caip2Id: 'eip155:100', aliases: ['xdai', 'gnosis-mainnet'] },
      { id: 'matic', fullName: 'Polygon Mainnet', shortName: 'Polygon', caip2Id: 'eip155:137', aliases: ['polygon', 'matic-mainnet'] }
    ]
  };

  const setup = () => {
    cachedData.indexed = indexData(theGraph, null, chains, null);
    _resetGetAllChainsCacheForTests();
  };

  afterEach(() => {
    cachedData.indexed = null;
    _resetGetAllChainsCacheForTests();
  });

  it('"optimism mainnet" resolves to OP Mainnet (10), not zero results', () => {
    setup();
    const ids = searchChains('optimism mainnet').map(c => c.chainId);
    expect(ids[0]).toBe(10);
    expect(ids).not.toContain(69); // testnet excluded by the qualifier
  });

  it('plain "optimism" ranks OP Mainnet first, old testnets after', () => {
    setup();
    const ids = searchChains('optimism').map(c => c.chainId);
    expect(ids[0]).toBe(10);
    expect(ids).toContain(69);
  });

  it('"optimism testnet" returns the testnets, not the aliased mainnet', () => {
    setup();
    const ids = searchChains('optimism testnet').map(c => c.chainId);
    expect(ids).toContain(69);
    expect(ids).not.toContain(10);
  });

  it('an exact full name outranks substring lookalikes ("OP Mainnet" vs "Openpiece Mainnet")', () => {
    setup();
    expect(searchChains('OP Mainnet')[0].chainId).toBe(10);
  });

  it('resolves other well-known renames from graph aliases: bsc, xdai, matic, polygon', () => {
    setup();
    expect(searchChains('bsc').map(c => c.chainId)).toContain(56);
    expect(searchChains('xdai').map(c => c.chainId)).toContain(100);
    expect(searchChains('matic').map(c => c.chainId)).toContain(137);
    expect(searchChains('polygon')[0].chainId).toBe(137);
  });

  it('matches hyphenated registry aliases against spaced queries', () => {
    setup();
    // "optimism-mainnet" is a registry alias; users type "optimism mainnet"
    expect(searchChains('op mainnet')[0].chainId).toBe(10);
  });

  it('ranks deprecated chains below living ones', () => {
    cachedData.indexed = indexData(null, null, [
      { chainId: 69, name: 'Optimism Kovan' },              // curated EOL → deprecated
      { chainId: 11155420, name: 'OP Sepolia Testnet' }
    ], null);
    _resetGetAllChainsCacheForTests();
    const results = searchChains('op');
    const ids = results.map(c => c.chainId);
    expect(ids.indexOf(11155420)).toBeLessThan(ids.indexOf(69));
    expect(results.find(c => c.chainId === 69).status).toBe('deprecated');
  });
});
