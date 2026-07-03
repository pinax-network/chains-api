import { describe, it, expect, beforeEach } from 'vitest';
import { applyDataToCache } from '../../../src/store/cache.js';
import { getAllKeywords, _resetKeywordsCacheForTests } from '../../../src/domain/keywords.js';

function seed(overrides = {}) {
  applyDataToCache({
    indexed: {
      byChainId: {},
      byName: {},
      all: [
        {
          chainId: 1,
          name: 'Ethereum Mainnet',
          shortName: 'eth',
          tags: ['Beacon'],
          nativeCurrency: { symbol: 'ETH' },
          sources: ['chains'],
          relations: [{ kind: 'parentOf', network: 'OP Mainnet', chainId: 10 }]
        }
      ]
    },
    rpcHealth: {
      1: [{ url: 'https://rpc.example', ok: true, clientVersion: 'Geth/v1.14.0/linux' }]
    },
    lastUpdated: '2026-06-01T00:00:00.000Z',
    lastRpcCheck: '2026-06-01T01:00:00.000Z',
    ...overrides
  });
}

describe('getAllKeywords memoization', () => {
  beforeEach(() => {
    _resetKeywordsCacheForTests();
    seed();
  });

  it('extracts keywords from chains and RPC health', () => {
    const { totalKeywords, keywords } = getAllKeywords();
    expect(totalKeywords).toBeGreaterThan(0);
    expect(keywords.blockchainNames).toContain('Ethereum Mainnet');
    expect(keywords.softwareClients).toContain('Geth');
    expect(keywords.tags).toContain('Beacon');
  });

  it('returns the cached value within one data version', () => {
    const first = getAllKeywords();
    const second = getAllKeywords();
    expect(second).toBe(first); // same reference — not rebuilt
  });

  it('rebuilds when the data version changes', () => {
    const first = getAllKeywords();
    seed({ lastUpdated: '2026-06-02T00:00:00.000Z' });
    const second = getAllKeywords();
    expect(second).not.toBe(first);
  });

  it('rebuilds when an RPC sweep completes (client versions may change)', () => {
    const first = getAllKeywords();
    seed({ lastRpcCheck: '2026-06-01T02:00:00.000Z' });
    const second = getAllKeywords();
    expect(second).not.toBe(first);
  });

  it('returns the empty shape when no data is loaded', () => {
    applyDataToCache({ indexed: null });
    _resetKeywordsCacheForTests();
    expect(getAllKeywords().totalKeywords).toBe(0);
  });
});
