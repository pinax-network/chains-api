import { describe, it, expect } from 'vitest';
import { indexData } from '../../../src/store/indexer.js';

describe('indexer — L2BEAT integration', () => {
  function buildBaseChainsList() {
    return [
      { chainId: 42161, name: 'Arbitrum One' },
      { chainId: 10, name: 'OP Mainnet' },
      { chainId: 1, name: 'Ethereum' }
    ];
  }

  function buildL2Beat(projects) {
    return { source: 'live', fetchedAt: '2026-05-05T12:00:00.000Z', projects };
  }

  it('merges L2BEAT fields onto matching chains by chainId', () => {
    const indexed = indexData(null, null, buildBaseChainsList(), null, buildL2Beat([
      {
        slug: 'arbitrum',
        chainId: 42161,
        displayName: 'Arbitrum One',
        stage: 'Stage 1',
        category: 'Optimistic Rollup',
        stack: 'Arbitrum Orbit',
        daLayer: 'Ethereum',
        hostChainId: 1
      }
    ]));

    expect(indexed.byChainId[42161].l2Beat).toMatchObject({
      slug: 'arbitrum',
      stage: 'Stage 1',
      category: 'Optimistic Rollup',
      stack: 'Arbitrum Orbit',
      daLayer: 'Ethereum',
      hostChainId: 1,
      dataFreshness: 'live',
      fetchedAt: '2026-05-05T12:00:00.000Z'
    });
  });

  it('adds L2 tag when L2BEAT classifies a chain', () => {
    const indexed = indexData(null, null, buildBaseChainsList(), null, buildL2Beat([
      { slug: 'arbitrum', chainId: 42161, displayName: 'Arbitrum One', category: 'Optimistic Rollup' }
    ]));
    expect(indexed.byChainId[42161].tags).toContain('L2');
  });

  it('adds ZK tag for ZK Rollup category', () => {
    const indexed = indexData(null, null,
      [{ chainId: 324, name: 'ZKsync Era' }],
      null,
      buildL2Beat([{ slug: 'zksync-era', chainId: 324, displayName: 'ZKsync Era', category: 'ZK Rollup' }])
    );
    expect(indexed.byChainId[324].tags).toContain('L2');
    expect(indexed.byChainId[324].tags).toContain('ZK');
  });

  it('adds Validium tag for Validium category', () => {
    const indexed = indexData(null, null,
      [{ chainId: 196, name: 'X Layer' }],
      null,
      buildL2Beat([{ slug: 'xlayer', chainId: 196, displayName: 'X Layer', category: 'Validium' }])
    );
    expect(indexed.byChainId[196].tags).toContain('Validium');
  });

  it('adds l2beat to chain.sources', () => {
    const indexed = indexData(null, null, buildBaseChainsList(), null, buildL2Beat([
      { slug: 'arbitrum', chainId: 42161, displayName: 'Arbitrum One' }
    ]));
    expect(indexed.byChainId[42161].sources).toContain('l2beat');
  });

  it('skips L2BEAT projects whose chainId is not in the chain list', () => {
    const indexed = indexData(null, null, buildBaseChainsList(), null, buildL2Beat([
      { slug: 'arbitrum', chainId: 42161, displayName: 'Arbitrum One' },
      { slug: 'unknown-chain', chainId: 999999, displayName: 'Unknown' }
    ]));
    expect(indexed.byChainId[42161].l2Beat).toBeDefined();
    expect(indexed.byChainId[999999]).toBeUndefined();
  });

  it('is a no-op when l2beat data is null/empty', () => {
    const indexed = indexData(null, null, buildBaseChainsList(), null, null);
    expect(indexed.byChainId[42161].l2Beat).toBeUndefined();

    const indexed2 = indexData(null, null, buildBaseChainsList(), null, { source: 'unavailable', projects: [] });
    expect(indexed2.byChainId[42161].l2Beat).toBeUndefined();
  });

  it('preserves dataFreshness="fallback" when sourced from static JSON', () => {
    const indexed = indexData(null, null, buildBaseChainsList(), null, {
      source: 'fallback',
      fetchedAt: null,
      projects: [{ slug: 'arbitrum', chainId: 42161, displayName: 'Arbitrum One', stage: 'Stage 1' }]
    });
    expect(indexed.byChainId[42161].l2Beat.dataFreshness).toBe('fallback');
    expect(indexed.byChainId[42161].l2Beat.fetchedAt).toBeNull();
  });
});
