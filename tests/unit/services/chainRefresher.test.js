import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/sources/l2beat.js', () => ({
  fetchL2Beat: vi.fn()
}));

vi.mock('../../../rpcUtil.js', () => ({
  jsonRpcCall: vi.fn()
}));

vi.mock('../../../config.js', () => ({
  RPC_CHECK_TIMEOUT_MS: 5000,
  RPC_CHECK_CONCURRENCY: 8,
  L2BEAT_REFRESH_INTERVAL_MS: 60000,
  DATA_SOURCE_L2BEAT_API: 'https://l2beat.test/api/scaling-summary',
  L2BEAT_FETCH_TIMEOUT_MS: 1000,
  PROXY_URL: '',
  PROXY_ENABLED: false
}));

import { fetchL2Beat } from '../../../src/sources/l2beat.js';
import { jsonRpcCall } from '../../../rpcUtil.js';
import { applyDataToCache, cachedData } from '../../../src/store/cache.js';
import {
  processChainRpc,
  processL2BeatBatch,
  tickOnce,
  getChainRefresherStatus,
  _resetChainRefresherForTests
} from '../../../src/services/chainRefresher.js';

function seedChain(chainId, rpc = []) {
  const chain = {
    chainId,
    name: `Chain ${chainId}`,
    tags: [],
    relations: [],
    sources: ['chainlist'],
    rpc
  };
  return chain;
}

function seedCacheWith(chains) {
  const byChainId = {};
  for (const c of chains) byChainId[c.chainId] = c;
  applyDataToCache({
    indexed: { byChainId, byName: {}, all: chains },
    lastUpdated: '2026-05-05T00:00:00.000Z'
  });
}

describe('chainRefresher', () => {
  beforeEach(() => {
    _resetChainRefresherForTests();
    applyDataToCache({});
    fetchL2Beat.mockReset();
    jsonRpcCall.mockReset();
  });

  afterEach(() => {
    _resetChainRefresherForTests();
  });

  describe('processChainRpc', () => {
    it('is a no-op when chain is not in the index', async () => {
      seedCacheWith([seedChain(1)]);
      await processChainRpc(999);
      expect(cachedData.rpcHealth?.[999]).toBeUndefined();
    });

    it('writes per-endpoint results and stamps chain.lastTested', async () => {
      seedCacheWith([seedChain(1, ['https://rpc-a.example', 'https://rpc-b.example'])]);
      jsonRpcCall
        .mockResolvedValueOnce('Geth/v1.0')  // rpc-a clientVersion
        .mockResolvedValueOnce('0x10')       // rpc-a blockNumber
        .mockResolvedValueOnce('Erigon/v1.0') // rpc-b clientVersion
        .mockResolvedValueOnce('0x12');      // rpc-b blockNumber

      await processChainRpc(1);

      expect(cachedData.rpcHealth[1]).toHaveLength(2);
      expect(cachedData.rpcHealth[1][0].ok).toBe(true);
      expect(cachedData.indexed.byChainId[1].lastTested).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('respects the data-version race guard', async () => {
      seedCacheWith([seedChain(1, ['https://rpc-a.example'])]);

      // Have jsonRpcCall mutate cachedData.lastUpdated mid-flight, simulating
      // a concurrent loadData() during the RPC sweep.
      jsonRpcCall.mockImplementation(async () => {
        cachedData.lastUpdated = '2026-05-05T01:00:00.000Z';
        return 'whatever';
      });

      await processChainRpc(1);

      // The race guard should have skipped writing rpcHealth.
      expect(cachedData.rpcHealth?.[1]).toBeUndefined();
    });

    it('skips chains with no http endpoints', async () => {
      seedCacheWith([seedChain(1, ['wss://only-websocket.example'])]);
      await processChainRpc(1);
      expect(cachedData.rpcHealth?.[1]).toBeUndefined();
      expect(jsonRpcCall).not.toHaveBeenCalled();
    });
  });

  describe('processL2BeatBatch', () => {
    it('skips when no data is loaded', async () => {
      const result = await processL2BeatBatch();
      expect(result).toEqual({ skipped: 'no-data' });
    });

    it('writes cachedData.l2beat and updates status on success', async () => {
      seedCacheWith([seedChain(42161)]);
      fetchL2Beat.mockResolvedValueOnce({
        source: 'live',
        fetchedAt: '2026-05-05T12:00:00.000Z',
        projects: [{ slug: 'arbitrum', chainId: 42161, displayName: 'Arbitrum One' }]
      });

      const result = await processL2BeatBatch();

      expect(result.source).toBe('live');
      expect(result.projectCount).toBe(1);
      expect(cachedData.l2beat?.source).toBe('live');
      expect(getChainRefresherStatus().l2beat.lastRefreshSource).toBe('live');
    });
  });

  describe('tickOnce / queue scheduling', () => {
    it('first tick processes l2beat_batch (head of fresh queue)', async () => {
      seedCacheWith([seedChain(1, ['https://rpc-a.example'])]);
      fetchL2Beat.mockResolvedValueOnce({
        source: 'live', fetchedAt: '2026-05-05T00:00:00.000Z',
        projects: [{ slug: 'eth', chainId: 1, displayName: 'Ethereum' }]
      });

      await tickOnce();

      const status = getChainRefresherStatus();
      expect(status.lastTickJobType).toBe('l2beat_batch');
      expect(status.sweep.jobIndex).toBe(1);
      expect(fetchL2Beat).toHaveBeenCalledTimes(1);
    });

    it('subsequent ticks process chain_rpc jobs in order', async () => {
      seedCacheWith([
        seedChain(1, ['https://rpc-a.example']),
        seedChain(2, ['https://rpc-b.example'])
      ]);
      fetchL2Beat.mockResolvedValueOnce({
        source: 'live', fetchedAt: '2026-05-05T00:00:00.000Z', projects: []
      });
      jsonRpcCall
        .mockResolvedValueOnce('Geth/v1')
        .mockResolvedValueOnce('0x10')
        .mockResolvedValueOnce('Erigon/v1')
        .mockResolvedValueOnce('0x12');

      await tickOnce(); // l2beat_batch
      await tickOnce(); // chain_rpc 1
      await tickOnce(); // chain_rpc 2

      expect(cachedData.rpcHealth[1]).toHaveLength(1);
      expect(cachedData.rpcHealth[2]).toHaveLength(1);

      const status = getChainRefresherStatus();
      expect(status.queueDepth).toBe(0);
      expect(status.sweep.totalJobs).toBe(3); // 1 l2beat + 2 chains
    });

    it('rebuilds the queue once it drains, incrementing sweep number', async () => {
      seedCacheWith([seedChain(1, [])]);  // no RPCs to keep test deterministic
      fetchL2Beat.mockResolvedValue({
        source: 'live', fetchedAt: '2026-05-05T00:00:00.000Z', projects: []
      });

      await tickOnce(); // l2beat_batch (sweep #1)
      await tickOnce(); // chain_rpc 1 (no-op, but increments cursor)
      // queue empty -> next tick rebuilds
      await tickOnce(); // l2beat_batch again (sweep #2)

      expect(getChainRefresherStatus().sweep.sweepNumber).toBe(2);
    });

    it('overlap guard: a tick in flight is skipped, not queued behind itself', async () => {
      seedCacheWith([seedChain(1, [])]);
      let release;
      fetchL2Beat.mockImplementation(() => new Promise(r => { release = r; }));

      const first = tickOnce();    // sets tickInFlight = true
      await tickOnce();            // immediately returns (no-op while in flight)
      release({ source: 'live', fetchedAt: 'x', projects: [] });
      await first;

      // Only one fetchL2Beat call: the second tick saw tickInFlight and bailed.
      expect(fetchL2Beat).toHaveBeenCalledTimes(1);
    });
  });

  describe('getChainRefresherStatus', () => {
    it('exposes tick + sweep + per-job-type state', async () => {
      seedCacheWith([seedChain(1, [])]);
      fetchL2Beat.mockResolvedValue({
        source: 'fallback', fetchedAt: null, projects: []
      });

      await tickOnce();
      const status = getChainRefresherStatus();

      expect(status.tickIntervalMs).toBeGreaterThan(0);
      expect(status.lastTickAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(status.l2beat.lastRefreshSource).toBe('fallback');
      expect(status.rpc).toHaveProperty('isMonitoring');
      expect(status.sweep).toHaveProperty('sweepNumber');
    });
  });
});
