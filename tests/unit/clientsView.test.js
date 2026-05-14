import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../dataService.js', () => ({
  getRpcMonitoringResults: vi.fn()
}));

import { getRpcMonitoringResults } from '../../dataService.js';
import { getClientsByChain, summarizeChainClients } from '../../clientsView.js';

function makeResult(chainId, chainName, url, clientVersion, status = 'working') {
  return { chainId, chainName, url, clientVersion, status, blockNumber: 1, latencyMs: 10, error: null };
}

function withResults(results) {
  vi.mocked(getRpcMonitoringResults).mockReturnValue({
    lastUpdated: '2026-05-13T00:00:00Z',
    totalEndpoints: results.length,
    testedEndpoints: results.length,
    workingEndpoints: results.filter(r => r.status === 'working').length,
    failedEndpoints: results.filter(r => r.status !== 'working').length,
    results
  });
}

describe('clientsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getClientsByChain(chainId)', () => {
    it('aggregates clients across working endpoints for a chain', () => {
      withResults([
        makeResult(1, 'Ethereum', 'https://rpc1', 'Geth/v1.14.5/linux/go1.22'),
        makeResult(1, 'Ethereum', 'https://rpc2', 'Geth/v1.14.5/linux/go1.22'),
        makeResult(1, 'Ethereum', 'https://rpc3', 'erigon/v2.60.0/linux/go1.22')
      ]);

      const summary = getClientsByChain(1);
      expect(summary).toMatchObject({
        chainId: 1,
        chainName: 'Ethereum',
        totalNodes: 3,
        unknownNodes: 0
      });
      expect(summary.clients).toHaveLength(2);
      expect(summary.clients[0]).toMatchObject({ name: 'geth', nodeCount: 2 });
      expect(summary.clients[0].versions).toEqual([
        { version: 'v1.14.5', nodeCount: 2 }
      ]);
      expect(summary.clients[1]).toMatchObject({ name: 'erigon', nodeCount: 1 });
    });

    it('returns null when chain has no monitoring data', () => {
      withResults([
        makeResult(1, 'Ethereum', 'https://eth', 'Geth/v1.14.5')
      ]);
      expect(getClientsByChain(99999)).toBeNull();
    });

    it('ignores failed endpoints', () => {
      withResults([
        makeResult(1, 'Ethereum', 'https://ok', 'Geth/v1.14.5'),
        makeResult(1, 'Ethereum', 'https://bad', 'Geth/v1.14.5', 'failed')
      ]);
      const summary = getClientsByChain(1);
      expect(summary.totalNodes).toBe(1);
    });

    it('counts endpoints with no parseable client as unknownNodes', () => {
      withResults([
        makeResult(1, 'Ethereum', 'https://a', null),
        makeResult(1, 'Ethereum', 'https://b', 'Geth/v1.14.5')
      ]);
      const summary = getClientsByChain(1);
      expect(summary.totalNodes).toBe(2);
      expect(summary.unknownNodes).toBe(1);
      expect(summary.clients).toHaveLength(1);
      expect(summary.clients[0].name).toBe('geth');
    });
  });

  describe('getClientsByChain() across chains', () => {
    it('returns one summary per chain when chainId is omitted', () => {
      withResults([
        makeResult(1, 'Ethereum', 'https://eth', 'Geth/v1.14.5'),
        makeResult(137, 'Polygon', 'https://polygon', 'bor/v1.3.0')
      ]);
      const all = getClientsByChain();
      expect(Array.isArray(all)).toBe(true);
      expect(all).toHaveLength(2);
      const byId = Object.fromEntries(all.map(c => [c.chainId, c]));
      expect(byId[1].clients[0].name).toBe('geth');
      expect(byId[137].clients[0].name).toBe('bor');
    });

    it('returns empty array when no working endpoints exist', () => {
      withResults([]);
      expect(getClientsByChain()).toEqual([]);
    });
  });

  describe('summarizeChainClients', () => {
    it('sorts versions inside a client by nodeCount descending', () => {
      const summary = summarizeChainClients([
        makeResult(1, 'Ethereum', 'https://a', 'Geth/v1.14.5'),
        makeResult(1, 'Ethereum', 'https://b', 'Geth/v1.14.5'),
        makeResult(1, 'Ethereum', 'https://c', 'Geth/v1.14.4')
      ]);
      expect(summary.clients[0].versions).toEqual([
        { version: 'v1.14.5', nodeCount: 2 },
        { version: 'v1.14.4', nodeCount: 1 }
      ]);
    });

    it('returns null when no working endpoints are supplied', () => {
      expect(summarizeChainClients([])).toBeNull();
      expect(summarizeChainClients([
        makeResult(1, 'Ethereum', 'https://a', 'Geth', 'failed')
      ])).toBeNull();
    });
  });
});
