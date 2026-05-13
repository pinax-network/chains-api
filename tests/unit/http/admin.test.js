import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../dataService.js', () => ({
  loadData: vi.fn(),
  getCachedData: vi.fn(),
  getAllChains: vi.fn(() => []),
  getAllKeywords: vi.fn(() => ({ totalKeywords: 0, keywords: {} })),
  getRpcMonitoringResults: vi.fn(() => ({
    lastUpdated: null,
    totalEndpoints: 0,
    testedEndpoints: 0,
    workingEndpoints: 0,
    failedEndpoints: 0,
    results: []
  })),
  getRpcMonitoringStatus: vi.fn(() => ({ isMonitoring: false, lastUpdated: null })),
  startRpcHealthCheck: vi.fn(),
  validateChainData: vi.fn(() => ({ totalErrors: 0, errorsByRule: {}, summary: {}, allErrors: [] })),
  countChainsByTag: vi.fn(() => ({ totalChains: 0, totalMainnets: 0, totalTestnets: 0, totalL2s: 0, totalBeacons: 0 }))
}));

vi.mock('../../../src/services/l2beatRefresher.js', () => ({
  getL2BeatRefreshStatus: vi.fn(() => ({
    isRefreshing: false,
    lastRefreshAt: null,
    lastRefreshSource: null,
    lastRefreshError: null,
    lastRefreshProjectCount: 0,
    intervalMs: 300000
  }))
}));

vi.mock('../../../config.js', () => ({
  RELOAD_RATE_LIMIT_MAX: 5,
  RATE_LIMIT_WINDOW_MS: 60000,
  DATA_CACHE_ENABLED: false,
  DATA_CACHE_FILE: '.cache/test-data.json'
}));

import Fastify from 'fastify';
import * as dataService from '../../../dataService.js';
import { getL2BeatRefreshStatus } from '../../../src/services/l2beatRefresher.js';
import { adminRoutes } from '../../../src/http/routes/admin.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(adminRoutes);
  return app;
}

describe('GET /health (deepened)', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns status=ok and per-source freshness when all core sources loaded', async () => {
    const now = new Date().toISOString();
    dataService.getCachedData.mockReturnValue({
      theGraph: { networks: [] },
      chainlist: [],
      chains: [],
      slip44: { 60: {} },
      l2beat: { source: 'live', fetchedAt: now, projects: [{ slug: 'arbitrum', chainId: 42161 }] },
      indexed: { all: [{ chainId: 1 }] },
      lastUpdated: now
    });
    dataService.getRpcMonitoringStatus.mockReturnValue({ isMonitoring: false, lastUpdated: now });
    getL2BeatRefreshStatus.mockReturnValue({
      isRefreshing: false,
      lastRefreshAt: now,
      lastRefreshSource: 'live',
      lastRefreshError: null,
      lastRefreshProjectCount: 1,
      intervalMs: 300000
    });

    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.sources.theGraph.loaded).toBe(true);
    expect(body.sources.l2beat.loaded).toBe(true);
    expect(body.sources.l2beat.source).toBe('live');
    expect(typeof body.sources.theGraph.ageSeconds).toBe('number');
    expect(body.refreshers.l2beat.lastRefreshAt).toBe(now);
  });

  it('returns status=down when a core source is missing', async () => {
    dataService.getCachedData.mockReturnValue({
      theGraph: null,
      chainlist: [],
      chains: [],
      slip44: {},
      l2beat: null,
      indexed: null,
      lastUpdated: null
    });

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json().status).toBe('down');
  });

  it('returns status=degraded when slip44 fetch failed (null) but core sources loaded', async () => {
    const now = new Date().toISOString();
    dataService.getCachedData.mockReturnValue({
      theGraph: {},
      chainlist: [],
      chains: [],
      slip44: null,        // fetch failed
      l2beat: { source: 'live', fetchedAt: now, projects: [{ chainId: 1 }] },
      indexed: { all: [] },
      lastUpdated: now
    });

    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.sources.slip44.loaded).toBe(false);
  });

  it('marks l2beat as not loaded when fallback returned no projects', async () => {
    const now = new Date().toISOString();
    dataService.getCachedData.mockReturnValue({
      theGraph: {},
      chainlist: [],
      chains: [],
      slip44: { 60: {} },
      l2beat: { source: 'unavailable', fetchedAt: null, projects: [] },
      indexed: { all: [] },
      lastUpdated: now
    });

    const res = await app.inject({ method: 'GET', url: '/health' });
    const body = res.json();
    expect(body.sources.l2beat.loaded).toBe(false);
    expect(body.sources.l2beat.source).toBe('unavailable');
  });
});

describe('GET /sources (extended with l2beat + slip44 null awareness)', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('reports slip44: not loaded when slip44 is null (fetch failed)', async () => {
    dataService.getCachedData.mockReturnValue({
      theGraph: {},
      chainlist: [],
      chains: [],
      slip44: null,
      l2beat: { projects: [] },
      indexed: { all: [] },
      lastUpdated: null
    });

    const res = await app.inject({ method: 'GET', url: '/sources' });
    expect(res.json().sources.slip44).toBe('not loaded');
  });

  it('reports l2beat: loaded when projects array is non-empty', async () => {
    dataService.getCachedData.mockReturnValue({
      theGraph: {},
      chainlist: [],
      chains: [],
      slip44: {},
      l2beat: { projects: [{ chainId: 1 }] },
      indexed: { all: [] },
      lastUpdated: null
    });

    const res = await app.inject({ method: 'GET', url: '/sources' });
    expect(res.json().sources.l2beat).toBe('loaded');
  });
});
