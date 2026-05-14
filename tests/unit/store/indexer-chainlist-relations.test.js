import { describe, it, expect } from 'vitest';
import { indexData } from '../../../src/store/indexer.js';

describe('indexer — chainlist parent relations', () => {
  it('extracts L2 relations from chainlist parent field', () => {
    const chains = [
      { chainId: 1, name: 'Ethereum Mainnet' }
    ];

    const chainlist = [
      {
        chainId: 42161,
        name: 'Arbitrum One',
        parent: {
          type: 'L2',
          chain: 'eip155-1',
          bridges: [{ url: 'https://bridge.arbitrum.io' }]
        }
      }
    ];

    const result = indexData(null, chainlist, chains, null);

    expect(result.byChainId[42161].tags).toContain('L2');
    expect(result.byChainId[42161].relations).toContainEqual(
      expect.objectContaining({
        kind: 'l2Of',
        chainId: 1,
        source: 'chainlist'
      })
    );
    expect(result.byChainId[42161].bridges).toBeDefined();
    expect(result.byChainId[42161].bridges).toHaveLength(1);
  });

  it('extracts testnet relations from chainlist parent field', () => {
    const chains = [
      { chainId: 1, name: 'Ethereum Mainnet' }
    ];

    const chainlist = [
      {
        chainId: 5,
        name: 'Goerli',
        parent: {
          type: 'testnet',
          chain: 'eip155-1'
        }
      }
    ];

    const result = indexData(null, chainlist, chains, null);

    expect(result.byChainId[5].relations).toContainEqual(
      expect.objectContaining({
        kind: 'testnetOf',
        chainId: 1,
        source: 'chainlist'
      })
    );
  });

  it('does not duplicate relations when both chains.json and chainlist have same parent', () => {
    const chains = [
      { chainId: 1, name: 'Ethereum Mainnet' },
      {
        chainId: 10,
        name: 'Optimism',
        parent: {
          type: 'L2',
          chain: 'eip155-1'
        }
      }
    ];

    const chainlist = [
      {
        chainId: 10,
        name: 'Optimism',
        parent: {
          type: 'L2',
          chain: 'eip155-1'
        }
      }
    ];

    const result = indexData(null, chainlist, chains, null);

    const l2Relations = result.byChainId[10].relations.filter(
      r => r.kind === 'l2Of' && r.chainId === 1
    );
    expect(l2Relations).toHaveLength(1);
  });

  it('creates reverse parentOf relations for chainlist-sourced L2 relations', () => {
    const chains = [
      { chainId: 1, name: 'Ethereum Mainnet' }
    ];

    const chainlist = [
      {
        chainId: 42161,
        name: 'Arbitrum One',
        parent: {
          type: 'L2',
          chain: 'eip155-1'
        }
      }
    ];

    const result = indexData(null, chainlist, chains, null);

    expect(result.byChainId[1].relations).toContainEqual(
      expect.objectContaining({
        kind: 'parentOf',
        chainId: 42161,
        source: 'chainlist'
      })
    );
  });

  it('creates reverse mainnetOf relations for chainlist-sourced testnet relations', () => {
    const chains = [
      { chainId: 1, name: 'Ethereum Mainnet' }
    ];

    const chainlist = [
      {
        chainId: 5,
        name: 'Goerli',
        parent: {
          type: 'testnet',
          chain: 'eip155-1'
        }
      }
    ];

    const result = indexData(null, chainlist, chains, null);

    expect(result.byChainId[1].relations).toContainEqual(
      expect.objectContaining({
        kind: 'mainnetOf',
        chainId: 5,
        source: 'chainlist'
      })
    );
  });
});
