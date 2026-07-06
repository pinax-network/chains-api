import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { getForumNews, _resetForumNewsForTests } from '../../../src/sources/forumNews.js';
import { proxyFetch } from '../../../fetchUtil.js';

vi.mock('../../../fetchUtil.js', () => ({
  proxyFetch: vi.fn()
}));

// Port 1 refuses connections instantly, so the WS never comes up and every
// test in this file exercises the REST seed/fallback path.
vi.mock('../../../config.js', async (importOriginal) => ({
  ...(await importOriginal()),
  FORUM_NEWS_URL: 'http://127.0.0.1:1',
  FORUM_NEWS_CACHE_TTL_MS: 60000,
  FORUM_NEWS_FETCH_TIMEOUT_MS: 1000
}));

function newsItem(overrides = {}) {
  return {
    id: `ethereum:${overrides.title || 'abc'}`,
    title: 'Hash-chain RANDAO',
    url: 'https://ethereum-magicians.org/t/hash-chain-randao/28942',
    summary: null,
    publishedAt: '2026-07-05T22:50:49.481Z',
    tags: ['postquantum'],
    forum: { id: 'ethereum', name: 'Ethereum Magicians', url: 'https://ethereum-magicians.org', software: 'discourse' },
    chains: [{ chainId: 1, name: 'Ethereum Mainnet' }],
    ...overrides
  };
}

function okResponse(news) {
  return { ok: true, json: async () => ({ count: news.length, news }) };
}

describe('getForumNews (REST fallback — WS unreachable)', () => {
  beforeEach(() => {
    _resetForumNewsForTests();
    proxyFetch.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(() => {
    _resetForumNewsForTests();
  });

  it('seeds from REST, normalizes and returns news newest first', async () => {
    proxyFetch.mockResolvedValue(okResponse([
      newsItem({ title: 'Older', publishedAt: '2026-07-01T00:00:00Z' }),
      newsItem({ title: 'Newer', publishedAt: '2026-07-05T00:00:00Z' })
    ]));
    const result = await getForumNews();
    expect(proxyFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1/news?limit=500',
      expect.objectContaining({ headers: { accept: 'application/json' } })
    );
    expect(result.source).toBe('rest');
    expect(result.count).toBe(2);
    expect(result.news[0].title).toBe('Newer');
    expect(result.news[0]).toMatchObject({
      forum: { id: 'ethereum', name: 'Ethereum Magicians' },
      chains: [{ chainId: 1, name: 'Ethereum Mainnet' }],
      tags: ['postquantum']
    });
  });

  it('serves from the store within the TTL and refetches after expiry', async () => {
    proxyFetch.mockResolvedValue(okResponse([newsItem()]));
    await getForumNews();
    await getForumNews();
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61000);
    await getForumNews();
    expect(proxyFetch).toHaveBeenCalledTimes(2);
  });

  it('filters by chainId and forum id (case-insensitive)', async () => {
    proxyFetch.mockResolvedValue(okResponse([
      newsItem(),
      newsItem({
        id: 'arbitrum:aip99',
        title: 'AIP-99',
        forum: { id: 'arbitrum', name: 'Arbitrum DAO', url: 'https://forum.arbitrum.foundation' },
        chains: [{ chainId: 42161, name: 'Arbitrum One' }]
      })
    ]));
    expect((await getForumNews({ chainId: 42161 })).news[0].title).toBe('AIP-99');
    expect((await getForumNews({ forum: 'ETHEREUM' })).news).toHaveLength(1);
    expect((await getForumNews({ forum: 'optimism' })).news).toHaveLength(0);
  });

  it('caps limit and truncates long summaries', async () => {
    const items = Array.from({ length: 60 }, (_, i) =>
      newsItem({ id: `x:${i}`, title: `Post ${i}`, summary: 'y'.repeat(1000) }));
    proxyFetch.mockResolvedValue(okResponse(items));
    const result = await getForumNews({ limit: 9999 });
    expect(result.count).toBe(50);
    expect(result.totalMatched).toBe(60);
    expect(result.news[0].summary.length).toBe(240);
    expect((await getForumNews()).count).toBe(15); // default limit
  });

  it('dedupes by item id across refetches', async () => {
    proxyFetch.mockResolvedValue(okResponse([newsItem({ id: 'same-id' })]));
    await getForumNews();
    vi.advanceTimersByTime(61000);
    await getForumNews();
    expect((await getForumNews()).totalMatched).toBe(1);
  });

  it('serves the existing store when a refresh fails, throws when cold', async () => {
    proxyFetch.mockResolvedValueOnce(okResponse([newsItem()]));
    await getForumNews();
    vi.advanceTimersByTime(61000);
    proxyFetch.mockRejectedValueOnce(new Error('boom'));
    expect((await getForumNews()).count).toBe(1);

    _resetForumNewsForTests();
    proxyFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getForumNews()).rejects.toThrow(/Forum news feed unavailable/);
  });

  it('windows failed refreshes too — a broken feed is retried once per TTL, not per call', async () => {
    proxyFetch.mockResolvedValueOnce(okResponse([newsItem()]));
    await getForumNews();
    vi.advanceTimersByTime(61000);
    proxyFetch.mockRejectedValue(new Error('boom'));
    await getForumNews(); // failed refresh, serves store
    await getForumNews(); // within TTL of the failed ATTEMPT → no new fetch
    expect(proxyFetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(61000);
    await getForumNews(); // next TTL window → retried
    expect(proxyFetch).toHaveBeenCalledTimes(3);
  });

  it('throws instantly from the cached error while cold within the TTL', async () => {
    proxyFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getForumNews()).rejects.toThrow(/unavailable/);
    await expect(getForumNews()).rejects.toThrow(/unavailable/);
    expect(proxyFetch).toHaveBeenCalledTimes(1); // second throw came from the negative cache
  });

  it('never lets an older revision overwrite a newer one (newest wins)', async () => {
    proxyFetch.mockResolvedValueOnce(okResponse([
      newsItem({ id: 'same', title: 'Edited revision', publishedAt: '2026-07-05T15:00:00Z' })
    ]));
    await getForumNews();
    vi.advanceTimersByTime(61000);
    // Lagging snapshot still carries the older revision of the same id
    proxyFetch.mockResolvedValueOnce(okResponse([
      newsItem({ id: 'same', title: 'Stale revision', publishedAt: '2026-07-05T14:00:00Z' })
    ]));
    const result = await getForumNews();
    expect(result.news[0].title).toBe('Edited revision');
  });

  it('treats a bumped updatedAt as newer even when publishedAt is unchanged', async () => {
    proxyFetch.mockResolvedValueOnce(okResponse([
      newsItem({ id: 'same', title: 'Original', publishedAt: '2026-07-05T10:00:00Z' })
    ]));
    await getForumNews();
    vi.advanceTimersByTime(61000);
    proxyFetch.mockResolvedValueOnce(okResponse([
      newsItem({ id: 'same', title: 'In-place edit', publishedAt: '2026-07-05T10:00:00Z', updatedAt: '2026-07-05T12:00:00Z' })
    ]));
    const result = await getForumNews();
    expect(result.news[0].title).toBe('In-place edit');
  });

  it('shares one in-flight seed between concurrent callers', async () => {
    let resolveFetch;
    proxyFetch.mockReturnValue(new Promise((r) => { resolveFetch = r; }));
    const calls = [getForumNews(), getForumNews(), getForumNews()];
    resolveFetch(okResponse([newsItem()]));
    const results = await Promise.all(calls);
    expect(proxyFetch).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.count === 1)).toBe(true);
  });
});
