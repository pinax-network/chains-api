import { describe, it, expect } from 'vitest';
import { indexData } from '../../../src/store/indexer.js';

// Chain status resolution: upstream statuses must survive every merge path,
// curated EOL seeds catch the famous dead networks no source marks (Goerli,
// Ropsten, Mumbai…), and 'deprecated' propagates from a parent to its
// l2Of/testnetOf dependents — but never upward.
describe('indexer — chain status resolution', () => {
  it('keeps an explicit upstream status and defaults the rest to active', () => {
    const indexed = indexData(null, null, [
      { chainId: 1, name: 'Ethereum Mainnet' },
      { chainId: 116, name: 'DeBank Mainnet', status: 'deprecated' },
      { chainId: 7777, name: 'Fresh Chain', status: 'incubating' }
    ], null);
    expect(indexed.byChainId[1].status).toBe('active');
    expect(indexed.byChainId[116].status).toBe('deprecated');
    expect(indexed.byChainId[7777].status).toBe('incubating');
  });

  it('merges a chains.json status into an entry another source created first', () => {
    // theGraph creates the entry via caip2Id... but chains runs first, so
    // simulate the reverse: chainlist creates it, chains carries the status.
    const chainlist = [{ chainId: 42170, name: 'Arbitrum Nova', rpc: [] }];
    const chains = [{ chainId: 42170, name: 'Arbitrum Nova', status: 'deprecated' }];
    const indexed = indexData(null, chainlist, chains, null);
    expect(indexed.byChainId[42170].status).toBe('deprecated');
  });

  it('merges a chainlist status when chains.json stated none', () => {
    const chains = [{ chainId: 555, name: 'Some Chain' }];
    const chainlist = [{ chainId: 555, name: 'Some Chain', status: 'deprecated', rpc: [] }];
    const indexed = indexData(null, chainlist, chains, null);
    expect(indexed.byChainId[555].status).toBe('deprecated');
  });

  it('marks curated end-of-life networks deprecated when no source states a status', () => {
    const indexed = indexData(null, null, [
      { chainId: 5, name: 'Goerli' },
      { chainId: 3, name: 'Ropsten' },
      { chainId: 80001, name: 'Mumbai' },
      { chainId: 69, name: 'Optimism Kovan' },
      { chainId: 84531, name: 'Base Goerli Testnet' }
    ], null);
    for (const cid of [5, 3, 80001, 69, 84531]) {
      expect(indexed.byChainId[cid].status).toBe('deprecated');
      expect(indexed.byChainId[cid].statusReason).toContain('curated');
    }
  });

  it('lets an explicit upstream status override the curated EOL list', () => {
    const indexed = indexData(null, null, [
      { chainId: 424242, name: 'Goerli Revival', status: 'active' }
    ], null);
    expect(indexed.byChainId[424242].status).toBe('active');
    expect(indexed.byChainId[424242].statusReason).toBeUndefined();
  });

  it('propagates deprecated from a parent to its l2Of and testnetOf dependents, transitively', () => {
    const chains = [
      { chainId: 1000, name: 'Dead Root', status: 'deprecated' },
      { chainId: 2000, name: 'L2 on Dead Root', parent: { type: 'L2', chain: 'eip155-1000' } },
      { chainId: 3000, name: 'L3 on the L2', parent: { type: 'L2', chain: 'eip155-2000' } },
      { chainId: 4000, name: 'Testnet of the L2', parent: { type: 'testnet', chain: 'eip155-2000' } }
    ];
    const indexed = indexData(null, null, chains, null);
    expect(indexed.byChainId[2000].status).toBe('deprecated');
    expect(indexed.byChainId[2000].statusReason).toContain('l2Of chain 1000');
    expect(indexed.byChainId[3000].status).toBe('deprecated');   // via the L2, transitively
    expect(indexed.byChainId[4000].status).toBe('deprecated');
  });

  it('propagation overrides an explicit upstream "active" on the child (stale upstream data)', () => {
    // Live example: chains.json still marks Linea Goerli 'active' while its
    // Goerli parent is dead. Propagation must win or validation rule 17
    // (active child of deprecated parent) becomes unsatisfiable.
    const chains = [
      { chainId: 5, name: 'Goerli' }, // curated EOL
      { chainId: 59140, name: 'Linea Stale', status: 'active', parent: { type: 'L2', chain: 'eip155-5' } }
    ];
    const indexed = indexData(null, null, chains, null);
    expect(indexed.byChainId[59140].status).toBe('deprecated');
    expect(indexed.byChainId[59140].statusReason).toContain('inherited');
  });

  it('never propagates upward: a dead testnet does not kill its mainnet', () => {
    const chains = [
      { chainId: 10, name: 'Living Mainnet' },
      { chainId: 20, name: 'Dead Testnet', status: 'deprecated', parent: { type: 'testnet', chain: 'eip155-10' } }
    ];
    const indexed = indexData(null, null, chains, null);
    expect(indexed.byChainId[10].status).toBe('active');
  });

  it('propagation triggers off curated seeds too (dead root named after a dead testnet)', () => {
    const chains = [
      { chainId: 5, name: 'Goerli' },
      { chainId: 6000, name: 'Shiny L2', parent: { type: 'L2', chain: 'eip155-5' } }
    ];
    const indexed = indexData(null, null, chains, null);
    expect(indexed.byChainId[6000].status).toBe('deprecated');
    expect(indexed.byChainId[6000].statusReason).toContain('l2Of chain 5');
  });
});
