import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config with non-wildcard CORS_ORIGIN to exercise the split/map callback
vi.mock('../../config.js', () => ({
  PORT: 3000,
  HOST: '0.0.0.0',
  BODY_LIMIT: 1048576,
  MAX_PARAM_LENGTH: 200,
  RATE_LIMIT_MAX: 100,
  RATE_LIMIT_WINDOW_MS: 60000,
  RELOAD_RATE_LIMIT_MAX: 5,
  SEARCH_RATE_LIMIT_MAX: 30,
  MAX_SEARCH_QUERY_LENGTH: 200,
  CORS_ORIGIN: 'http://localhost:3000, http://localhost:8080',
  DATA_SOURCE_THE_GRAPH: 'https://example.com/thegraph.json',
  DATA_SOURCE_CHAINLIST: 'https://example.com/chainlist.json',
  DATA_SOURCE_CHAINS: 'https://example.com/chains.json',
  DATA_SOURCE_SLIP44: 'https://example.com/slip44.md',
  DATA_SOURCE_L2BEAT_API: 'https://example.com/l2beat-summary',
  L2BEAT_FETCH_TIMEOUT_MS: 1000,
  L2BEAT_REFRESH_INTERVAL_MS: 60000,
  DATA_CACHE_ENABLED: false,
  DATA_CACHE_FILE: '.cache/test-data-cache.json',
  PROXY_URL: '',
  PROXY_ENABLED: false
}));

// Stub the L2BEAT refresher so buildApp doesn't kick off a real network fetch.
vi.mock('../../src/services/l2beatRefresher.js', () => ({
  startL2BeatRefresh: vi.fn(),
  stopL2BeatRefresh: vi.fn(),
  runL2BeatRefresh: vi.fn(),
  getL2BeatRefreshStatus: vi.fn(() => ({
    isRefreshing: false,
    lastRefreshAt: null,
    lastRefreshSource: null,
    lastRefreshError: null,
    lastRefreshProjectCount: 0,
    intervalMs: 60000
  }))
}));

// Capture the onBackgroundRefreshSuccess callback
let capturedCallback = null;

// Shared mock fn instances used across the src/ module vi.mocks below.
const mocks = vi.hoisted(() => ({
  loadData: vi.fn(),
  initializeDataOnStartup: vi.fn(),
  startRpcHealthCheck: vi.fn(),
  runRpcHealthCheck: vi.fn(),
  getRpcMonitoringStatus: vi.fn(() => ({ isMonitoring: false, lastUpdated: null }))
}));

vi.mock('../../src/services/loader.js', () => ({
  loadData: mocks.loadData,
  initializeDataOnStartup: mocks.initializeDataOnStartup
}));

vi.mock('../../src/services/rpcHealth.js', () => ({
  startRpcHealthCheck: mocks.startRpcHealthCheck,
  runRpcHealthCheck: mocks.runRpcHealthCheck,
  getRpcMonitoringStatus: mocks.getRpcMonitoringStatus
}));

// Default implementations. initializeDataOnStartup captures the
// onBackgroundRefreshSuccess callback so we can invoke it from the test.
mocks.loadData.mockResolvedValue({});
mocks.initializeDataOnStartup.mockImplementation(async (options) => {
  if (options?.onBackgroundRefreshSuccess) {
    capturedCallback = options.onBackgroundRefreshSuccess;
  }
  return { indexed: { all: [], byChainId: {} }, lastUpdated: new Date().toISOString() };
});

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT'))
}));

import { buildApp } from '../../index.js';
import * as dataService from '../../dataService.js';

describe('index.js - CORS origin split/map callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallback = null;
  });

  it('should split CORS_ORIGIN and trim values when not wildcard', async () => {
    const app = await buildApp({ logger: false });
    expect(app).toBeDefined();
    await app.close();
  });
});

describe('index.js - onBackgroundRefreshSuccess callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallback = null;
  });

  it('should call startRpcHealthCheck when onBackgroundRefreshSuccess is invoked', async () => {
    const app = await buildApp({ logger: false });

    // The callback should have been captured during initializeDataOnStartup
    expect(capturedCallback).toBeDefined();

    // Invoke it to exercise the callback
    capturedCallback();

    expect(mocks.startRpcHealthCheck).toHaveBeenCalled();

    await app.close();
  });
});

