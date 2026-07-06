import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLiveIncidents, _resetLiveIncidentsCacheForTests } from '../../../src/sources/liveIncidents.js';
import { proxyFetch } from '../../../fetchUtil.js';

vi.mock('../../../fetchUtil.js', () => ({
  proxyFetch: vi.fn()
}));

vi.mock('../../../config.js', async (importOriginal) => ({
  ...(await importOriginal()),
  LIVE_INCIDENTS_URL: 'https://status-news.test',
  LIVE_INCIDENTS_CACHE_TTL_MS: 60000,
  LIVE_INCIDENTS_FETCH_TIMEOUT_MS: 1000
}));

function feedEvent(overrides = {}) {
  return {
    title: 'RPC degraded',
    url: 'https://status.example/incident/1',
    publishedAt: '2026-07-05T10:00:00Z',
    statusPage: { id: 'base', name: 'Base', kind: 'chain' },
    chains: [{ chainId: 8453, name: 'Base' }],
    affectedComponents: [],
    ...overrides
  };
}

function okResponse(events) {
  return { ok: true, json: async () => ({ events }) };
}

describe('getLiveIncidents', () => {
  beforeEach(() => {
    _resetLiveIncidentsCacheForTests();
    proxyFetch.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches, normalizes and returns incidents', async () => {
    proxyFetch.mockResolvedValue(okResponse([feedEvent()]));
    const result = await getLiveIncidents();
    expect(proxyFetch).toHaveBeenCalledWith(
      'https://status-news.test/events?limit=500',
      expect.objectContaining({ headers: { accept: 'application/json' } })
    );
    expect(result.count).toBe(1);
    expect(result.incidents[0]).toMatchObject({
      title: 'RPC degraded',
      isProvider: false,
      publishedAt: '2026-07-05T10:00:00.000Z',
      statusPage: { id: 'base', kind: 'chain' },
      chains: [{ chainId: 8453, name: 'Base' }]
    });
  });

  it('serves from cache within the TTL (single upstream fetch)', async () => {
    proxyFetch.mockResolvedValue(okResponse([feedEvent()]));
    await getLiveIncidents();
    await getLiveIncidents();
    expect(proxyFetch).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL expires', async () => {
    proxyFetch.mockResolvedValue(okResponse([feedEvent()]));
    await getLiveIncidents();
    vi.advanceTimersByTime(61000);
    await getLiveIncidents();
    expect(proxyFetch).toHaveBeenCalledTimes(2);
  });

  it('dedupes events by status page + title, keeping the newest', async () => {
    proxyFetch.mockResolvedValue(okResponse([
      feedEvent({ publishedAt: '2026-07-05T10:00:00Z', url: 'https://old' }),
      feedEvent({ publishedAt: '2026-07-05T12:00:00Z', url: 'https://new' }),
      feedEvent({ title: 'Other incident' })
    ]));
    const result = await getLiveIncidents();
    expect(result.count).toBe(2);
    const rpc = result.incidents.find((it) => it.title === 'RPC degraded');
    expect(rpc.url).toBe('https://new');
  });

  it('filters by type, chainId and provider', async () => {
    proxyFetch.mockResolvedValue(okResponse([
      feedEvent(),
      feedEvent({
        title: 'Provider outage',
        statusPage: { id: 'infura', name: 'Infura', kind: 'rpc-provider' },
        chains: [{ chainId: 1, name: 'Ethereum' }]
      })
    ]));
    expect((await getLiveIncidents({ type: 'chain' })).incidents).toHaveLength(1);
    expect((await getLiveIncidents({ type: 'provider' })).incidents[0].title).toBe('Provider outage');
    expect((await getLiveIncidents({ chainId: 1 })).incidents[0].statusPage.id).toBe('infura');
    expect((await getLiveIncidents({ provider: 'INFURA' })).incidents).toHaveLength(1);
    expect((await getLiveIncidents({ provider: 'quicknode' })).incidents).toHaveLength(0);
  });

  it('caps limit and reports totalMatched', async () => {
    const events = Array.from({ length: 40 }, (_, i) => feedEvent({ title: `Incident ${i}` }));
    proxyFetch.mockResolvedValue(okResponse(events));
    const result = await getLiveIncidents({ limit: 5 });
    expect(result.count).toBe(5);
    expect(result.totalMatched).toBe(40);
    const capped = await getLiveIncidents({ limit: 9999 });
    expect(capped.count).toBe(40); // fewer than the 100 cap available
  });

  it('serves stale cache when a refresh fails', async () => {
    proxyFetch.mockResolvedValueOnce(okResponse([feedEvent()]));
    await getLiveIncidents();
    vi.advanceTimersByTime(61000);
    proxyFetch.mockRejectedValueOnce(new Error('boom'));
    const result = await getLiveIncidents();
    expect(result.count).toBe(1);
  });

  it('throws when the feed is unreachable and no cache exists', async () => {
    proxyFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getLiveIncidents()).rejects.toThrow(/Live incident feed unavailable/);
  });

  it('throws on non-2xx responses with no cache', async () => {
    proxyFetch.mockResolvedValue({ ok: false, status: 502 });
    await expect(getLiveIncidents()).rejects.toThrow(/502/);
  });
});
