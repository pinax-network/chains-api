import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { WebSocketServer } from 'ws';

const h = vi.hoisted(() => ({ port: 18100 + Math.floor(Math.random() * 800) }));

vi.mock('../../../fetchUtil.js', () => ({
  // If an early REST seed races the WS handshake it must be harmless — the
  // WS replay is the data source under test.
  proxyFetch: vi.fn(async () => ({ ok: true, json: async () => ({ news: [] }) }))
}));

vi.mock('../../../config.js', async (importOriginal) => ({
  ...(await importOriginal()),
  FORUM_NEWS_URL: `http://127.0.0.1:${h.port}`,
  FORUM_NEWS_CACHE_TTL_MS: 60000,
  FORUM_NEWS_FETCH_TIMEOUT_MS: 2000
}));

import { getForumNews, _resetForumNewsForTests } from '../../../src/sources/forumNews.js';

function frame(item) {
  return JSON.stringify({ type: 'news.item', emittedAt: new Date().toISOString(), item });
}

function newsItem(id, title, publishedAt, chainId = 1) {
  return {
    id,
    title,
    url: `https://forum.test/t/${id}`,
    publishedAt,
    tags: [],
    forum: { id: 'ethereum', name: 'Ethereum Magicians', url: 'https://ethereum-magicians.org' },
    chains: [{ chainId, name: 'Ethereum Mainnet' }]
  };
}

async function until(cond, timeoutMs = 4000) {
  const start = Date.now();
  for (;;) {
    const value = await cond();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('getForumNews (WebSocket-first)', () => {
  let wss;
  const clients = new Set();

  beforeAll(async () => {
    wss = new WebSocketServer({ port: h.port });
    wss.on('connection', (socket, req) => {
      clients.add(socket);
      socket.on('close', () => clients.delete(socket));
      // Emulate the service's ?replay= behaviour with two stored items.
      expect(req.url).toContain('replay=');
      socket.send(frame(newsItem('e:1', 'Replayed one', '2026-07-05T10:00:00Z')));
      socket.send(frame(newsItem('e:2', 'Replayed two', '2026-07-05T12:00:00Z')));
    });
    await new Promise((r) => wss.on('listening', r));
  });

  afterAll(async () => {
    _resetForumNewsForTests();
    await new Promise((r) => wss.close(r));
  });

  it('serves WS-replayed items and switches source to websocket', async () => {
    const result = await until(async () => {
      const r = await getForumNews();
      return r.source === 'websocket' && r.count >= 2 ? r : null;
    });
    expect(result.news.map((n) => n.title)).toEqual(['Replayed two', 'Replayed one']);
  });

  it('receives live pushes without any REST request', async () => {
    const { proxyFetch } = await import('../../../fetchUtil.js');
    vi.mocked(proxyFetch).mockClear();
    for (const socket of clients) {
      socket.send(frame(newsItem('e:3', 'Live push', '2026-07-05T14:00:00Z')));
    }
    const result = await until(async () => {
      const r = await getForumNews();
      return r.count >= 3 ? r : null;
    });
    expect(result.news[0].title).toBe('Live push');
    expect(result.source).toBe('websocket');
    // The open WS made every read serve from memory — REST never called.
    expect(proxyFetch).not.toHaveBeenCalled();
  });

  it('updates an existing item in place when re-pushed with the same id', async () => {
    for (const socket of clients) {
      socket.send(frame(newsItem('e:3', 'Live push (edited)', '2026-07-05T15:00:00Z')));
    }
    const result = await until(async () => {
      const r = await getForumNews();
      return r.news[0]?.title === 'Live push (edited)' ? r : null;
    });
    expect(result.totalMatched).toBe(3);
  });
});
