import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getForumNews, _resetForumNewsCacheForTests } from '../../../src/sources/forumNews.js';
import { proxyFetch } from '../../../fetchUtil.js';

vi.mock('../../../fetchUtil.js', () => ({
  proxyFetch: vi.fn()
}));

vi.mock('../../../config.js', async (importOriginal) => ({
  ...(await importOriginal()),
  FORUM_NEWS_URL: 'https://forum-news.test',
  FORUM_NEWS_CACHE_TTL_MS: 60000,
  FORUM_NEWS_FETCH_TIMEOUT_MS: 1000
}));

function newsItem(overrides = {}) {
  return {
    id: 'ethereum:abc',
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

describe('getForumNews', () => {
  beforeEach(() => {
    _resetForumNewsCacheForTests();
    proxyFetch.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-06T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches, normalizes and returns news newest first', async () => {
    proxyFetch.mockResolvedValue(okResponse([
      newsItem({ title: 'Older', publishedAt: '2026-07-01T00:00:00Z' }),
      newsItem({ title: 'Newer', publishedAt: '2026-07-05T00:00:00Z' })
    ]));
    const result = await getForumNews();
    expect(proxyFetch).toHaveBeenCalledWith(
      'https://forum-news.test/news?limit=500',
      expect.objectContaining({ headers: { accept: 'application/json' } })
    );
    expect(result.count).toBe(2);
    expect(result.news[0].title).toBe('Newer');
    expect(result.news[0]).toMatchObject({
      forum: { id: 'ethereum', name: 'Ethereum Magicians' },
      chains: [{ chainId: 1, name: 'Ethereum Mainnet' }],
      tags: ['postquantum']
    });
  });

  it('serves from cache within the TTL and refetches after expiry', async () => {
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

  it('serves stale cache when a refresh fails, throws when cold', async () => {
    proxyFetch.mockResolvedValueOnce(okResponse([newsItem()]));
    await getForumNews();
    vi.advanceTimersByTime(61000);
    proxyFetch.mockRejectedValueOnce(new Error('boom'));
    expect((await getForumNews()).count).toBe(1);

    _resetForumNewsCacheForTests();
    proxyFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getForumNews()).rejects.toThrow(/Forum news feed unavailable/);
  });
});
