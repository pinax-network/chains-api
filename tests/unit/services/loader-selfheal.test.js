import { describe, it, expect, afterEach } from 'vitest';
import { cachedData } from '../../../src/store/cache.js';
import { getFailedSources } from '../../../src/services/loader.js';

// getFailedSources drives the self-healer: it lists registries whose FETCH
// failed (null). A SLIP-0044 that fetched but parsed to {} is a data-format
// issue a re-fetch can't fix, so it must NOT be reported as failed.
describe('getFailedSources', () => {
  const snapshot = { ...cachedData };
  afterEach(() => Object.assign(cachedData, snapshot));

  it('returns empty when all core sources + slip44 loaded', () => {
    Object.assign(cachedData, {
      theGraph: { networks: [] }, chainlist: [], chains: [], slip44: { 60: {} }
    });
    expect(getFailedSources()).toEqual([]);
  });

  it('lists sources whose fetch failed (null)', () => {
    Object.assign(cachedData, {
      theGraph: { networks: [] }, chainlist: null, chains: [], slip44: { 60: {} }
    });
    expect(getFailedSources()).toEqual(['chainlist']);
  });

  it('treats null slip44 (fetch failed) as failed, but empty {} as not failed', () => {
    Object.assign(cachedData, { theGraph: {}, chainlist: [], chains: [], slip44: null });
    expect(getFailedSources()).toContain('slip44');

    cachedData.slip44 = {}; // fetched, parsed nothing — re-fetch won't help
    expect(getFailedSources()).not.toContain('slip44');
  });
});
