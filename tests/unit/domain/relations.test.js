import { describe, it, expect, beforeEach } from 'vitest';
import { applyDataToCache } from '../../../src/store/cache.js';
import {
  getAllRelations,
  getRelationsById,
  traverseRelations
} from '../../../src/domain/relations.js';

function setupIndexed() {
  const ethereum = {
    chainId: 1,
    name: 'Ethereum',
    tags: [],
    relations: [
      { kind: 'parentOf', chainId: 10, network: 'optimism', source: 'chains' }
    ]
  };
  const optimism = {
    chainId: 10,
    name: 'Optimism',
    tags: ['L2'],
    relations: []
  };
  const sepolia = {
    chainId: 11155111,
    name: 'Sepolia',
    tags: ['Testnet'],
    relations: [
      { kind: 'testnetOf', chainId: 1, network: 'mainnet', source: 'theGraph' }
    ]
  };

  applyDataToCache({
    indexed: {
      byChainId: { 1: ethereum, 10: optimism, 11155111: sepolia },
      byName: {},
      all: [ethereum, optimism, sepolia]
    }
  });
}

describe('domain/relations', () => {
  beforeEach(() => {
    applyDataToCache({});
  });

  describe('getAllRelations', () => {
    it('returns {} when no data is loaded', () => {
      expect(getAllRelations()).toEqual({});
    });

    it('renames parentOf to l1Of in the output', () => {
      setupIndexed();
      const all = getAllRelations();
      expect(all['1']['10'].kind).toBe('l1Of');
      expect(all['1']['10'].parentName).toBe('Ethereum');
      expect(all['1']['10'].childName).toBe('Optimism');
    });

    it('groups relations by parent chainId', () => {
      setupIndexed();
      const all = getAllRelations();
      expect(Object.keys(all)).toEqual(expect.arrayContaining(['1']));
      expect(all['1']['10']).toBeDefined();
      expect(all['1']['11155111']).toBeDefined();
    });
  });

  describe('getRelationsById', () => {
    it('returns null when no data is loaded', () => {
      expect(getRelationsById(1)).toBeNull();
    });

    it('returns null for unknown chains', () => {
      setupIndexed();
      expect(getRelationsById(999)).toBeNull();
    });

    it('returns the chain name and raw relations array', () => {
      setupIndexed();
      const result = getRelationsById(11155111);
      expect(result.chainId).toBe(11155111);
      expect(result.chainName).toBe('Sepolia');
      expect(result.relations).toHaveLength(1);
      expect(result.relations[0].kind).toBe('testnetOf');
    });
  });

  describe('traverseRelations', () => {
    it('returns null when no data or chain is missing', () => {
      expect(traverseRelations(1)).toBeNull();
      setupIndexed();
      expect(traverseRelations(999)).toBeNull();
    });

    it('returns BFS nodes and edges with depth annotations', () => {
      setupIndexed();
      const result = traverseRelations(1, 2);
      expect(result.startChainId).toBe(1);
      expect(result.startChainName).toBe('Ethereum');
      expect(result.totalNodes).toBeGreaterThanOrEqual(2);
      expect(result.totalEdges).toBeGreaterThanOrEqual(1);
      const depths = result.nodes.map(n => n.depth);
      expect(depths).toContain(0);
      expect(depths).toContain(1);
    });

    it('deduplicates undirected edges (same {min,max,kind} key)', () => {
      const ethereum = {
        chainId: 1,
        name: 'Ethereum',
        tags: [],
        relations: [{ kind: 'parentOf', chainId: 10, network: 'optimism', source: 'chains' }]
      };
      const optimism = {
        chainId: 10,
        name: 'Optimism',
        tags: ['L2'],
        relations: [{ kind: 'parentOf', chainId: 1, network: 'eip155-1', source: 'chains' }]
      };
      applyDataToCache({
        indexed: {
          byChainId: { 1: ethereum, 10: optimism },
          byName: {},
          all: [ethereum, optimism]
        }
      });

      const result = traverseRelations(1, 3);
      const parentOfEdges = result.edges.filter(e => e.kind === 'parentOf');
      expect(parentOfEdges).toHaveLength(1);
    });
  });
});
