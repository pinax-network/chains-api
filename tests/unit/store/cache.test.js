import { describe, it, expect, beforeEach } from 'vitest';
import { cachedData, applyDataToCache, getCachedData } from '../../../src/store/cache.js';

describe('store/cache', () => {
  beforeEach(() => {
    applyDataToCache({});
  });

  it('exposes the singleton via getCachedData() and the live binding', () => {
    expect(getCachedData()).toBe(cachedData);
  });

  it('applyDataToCache replaces every tracked field', () => {
    applyDataToCache({
      theGraph: { networks: [] },
      chainlist: [{ chainId: 1 }],
      chains: [{ chainId: 1 }],
      slip44: { 60: {} },
      indexed: { byChainId: {}, byName: {}, all: [] },
      lastUpdated: '2026-01-01T00:00:00.000Z',
      rpcHealth: { 1: [] },
      lastRpcCheck: '2026-01-01T00:00:00.000Z'
    });

    expect(cachedData.theGraph).toEqual({ networks: [] });
    expect(cachedData.chainlist).toEqual([{ chainId: 1 }]);
    expect(cachedData.chains).toEqual([{ chainId: 1 }]);
    expect(cachedData.slip44).toEqual({ 60: {} });
    expect(cachedData.indexed).toEqual({ byChainId: {}, byName: {}, all: [] });
    expect(cachedData.lastUpdated).toBe('2026-01-01T00:00:00.000Z');
    expect(cachedData.rpcHealth).toEqual({ 1: [] });
    expect(cachedData.lastRpcCheck).toBe('2026-01-01T00:00:00.000Z');
  });

  it('applyDataToCache resets fields to safe defaults when omitted', () => {
    applyDataToCache({ theGraph: { networks: [] } });
    applyDataToCache({});

    expect(cachedData.theGraph).toBeNull();
    expect(cachedData.chainlist).toBeNull();
    expect(cachedData.chains).toBeNull();
    expect(cachedData.slip44).toEqual({});
    expect(cachedData.indexed).toBeNull();
    expect(cachedData.lastUpdated).toBeNull();
    expect(cachedData.rpcHealth).toEqual({});
    expect(cachedData.lastRpcCheck).toBeNull();
  });
});
