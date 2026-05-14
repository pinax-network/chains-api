import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeL2BeatResponse } from '../../../src/sources/l2beat.js';

// Mock fetchUtil and config so fetchL2Beat can be exercised without network access.
vi.mock('../../../fetchUtil.js', () => ({
  proxyFetch: vi.fn()
}));

vi.mock('../../../config.js', () => ({
  DATA_SOURCE_L2BEAT_API: 'https://l2beat.test/api/scaling-summary',
  L2BEAT_FETCH_TIMEOUT_MS: 1000
}));

describe('normalizeL2BeatResponse', () => {
  it('returns [] for empty / unexpected payload shapes', () => {
    expect(normalizeL2BeatResponse(null)).toEqual([]);
    expect(normalizeL2BeatResponse({})).toEqual([]);
    expect(normalizeL2BeatResponse({ projects: 'not-an-array' })).toEqual([]);
  });

  it('extracts projects from { projects: [...] } shape', () => {
    const result = normalizeL2BeatResponse({
      projects: [
        { slug: 'arbitrum', chainId: 42161, name: 'Arbitrum One', stage: 'Stage 1' }
      ]
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      slug: 'arbitrum',
      chainId: 42161,
      displayName: 'Arbitrum One',
      stage: 'Stage 1'
    });
  });

  it('extracts projects from { data: { projects: [...] } } shape', () => {
    const result = normalizeL2BeatResponse({
      data: { projects: [{ slug: 'optimism', chainId: 10, name: 'OP Mainnet' }] }
    });
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('optimism');
  });

  it('extracts projects from a bare array shape', () => {
    const result = normalizeL2BeatResponse([
      { slug: 'base', chainId: 8453, name: 'Base' }
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('base');
  });

  it('drops projects without slug or chainId', () => {
    const result = normalizeL2BeatResponse({
      projects: [
        { slug: 'arbitrum', chainId: 42161, name: 'Arbitrum One' },
        { slug: 'no-chain-id', name: 'Something' },
        { chainId: 999, name: 'No Slug' }
      ]
    });
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('arbitrum');
  });

  it('handles nested stage/daLayer/tvs shapes defensively', () => {
    const result = normalizeL2BeatResponse({
      projects: [
        {
          slug: 'arbitrum',
          chainId: 42161,
          name: 'Arbitrum One',
          stage: { stage: 'Stage 1' },
          daLayer: { name: 'Ethereum' },
          tvs: { total: 1234567, breakdown: { canonical: 1000000, external: 234567, native: 0 } }
        }
      ]
    });
    expect(result[0].stage).toBe('Stage 1');
    expect(result[0].daLayer).toBe('Ethereum');
    expect(result[0].tvs).toBe(1234567);
    expect(result[0].tvsBreakdown).toEqual({ canonical: 1000000, external: 234567, native: 0 });
  });

  it('falls back to chainConfig.chainId when chainId is not at top level', () => {
    const result = normalizeL2BeatResponse({
      projects: [
        { slug: 'arbitrum', chainConfig: { chainId: 42161 }, name: 'Arbitrum One' }
      ]
    });
    expect(result[0].chainId).toBe(42161);
  });
});

describe('fetchL2Beat (integration with mocked transport)', () => {
  let proxyFetch;
  let fetchL2Beat;

  beforeEach(async () => {
    vi.resetModules();
    proxyFetch = (await import('../../../fetchUtil.js')).proxyFetch;
    fetchL2Beat = (await import('../../../src/sources/l2beat.js')).fetchL2Beat;
    proxyFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns source: live when the API succeeds', async () => {
    proxyFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        projects: [{ slug: 'arbitrum', chainId: 42161, name: 'Arbitrum One', stage: 'Stage 1' }]
      })
    });

    const result = await fetchL2Beat();
    expect(result.source).toBe('live');
    expect(result.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.projects[0].slug).toBe('arbitrum');
  });

  it('falls back to static JSON when the live API returns 403', async () => {
    proxyFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    const result = await fetchL2Beat();
    expect(result.source).toBe('fallback');
    expect(result.projects.length).toBeGreaterThan(0);
    expect(result.projects.find(p => p.slug === 'arbitrum')).toBeDefined();
  });

  it('falls back to static JSON when the live API throws', async () => {
    proxyFetch.mockRejectedValueOnce(new Error('ECONNRESET'));
    const result = await fetchL2Beat();
    expect(result.source).toBe('fallback');
    expect(result.projects.length).toBeGreaterThan(0);
  });
});
