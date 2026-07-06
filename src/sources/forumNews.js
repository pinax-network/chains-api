import {
  FORUM_NEWS_URL,
  FORUM_NEWS_CACHE_TTL_MS,
  FORUM_NEWS_FETCH_TIMEOUT_MS
} from '../../config.js';
import { proxyFetch } from '../../fetchUtil.js';
import { logger } from '../util/logger.js';

/**
 * Forum/governance news feed (chains-forum-news). Aggregates official chain
 * forums (Ethereum Magicians, Arbitrum DAO, …) keyed by chain ID. This module
 * gives the server (assistant + MCP tools) that feed via its REST endpoint,
 * behind a short in-memory cache so tool calls never hammer the upstream.
 */

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 15;
// The service stores up to ~2000 items; fetch a broad superset once and
// filter locally so every filter combination shares one cache entry.
const FEED_FETCH_LIMIT = 500;
const MAX_SUMMARY_CHARS = 240;

let cache = { fetchedAt: 0, items: null };

export function _resetForumNewsCacheForTests() {
  cache = { fetchedAt: 0, items: null };
}

/**
 * Fetch recent forum news, optionally filtered.
 *
 * @param {object} [options]
 * @param {number} [options.chainId] only posts tied to this chain
 * @param {string} [options.forum] only posts from this forum id (e.g. "ethereum")
 * @param {number} [options.limit] max posts returned (default 15, max 50)
 * @returns {Promise<{fetchedAt: string, count: number, totalMatched: number, news: object[]}>}
 * @throws when the feed is unreachable and no cached data exists
 */
export async function getForumNews({ chainId, forum, limit = DEFAULT_LIMIT } = {}) {
  const items = await loadNews();
  let filtered = items;
  if (chainId != null) filtered = filtered.filter((it) => it.chains.some((c) => c.chainId === chainId));
  if (forum) {
    const f = String(forum).toLowerCase();
    filtered = filtered.filter((it) => it.forum.id?.toLowerCase() === f);
  }
  const capped = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT));
  const sliced = filtered.slice(0, capped);
  return {
    fetchedAt: new Date(cache.fetchedAt).toISOString(),
    count: sliced.length,
    totalMatched: filtered.length,
    news: sliced
  };
}

async function loadNews() {
  if (cache.items && Date.now() - cache.fetchedAt < FORUM_NEWS_CACHE_TTL_MS) {
    return cache.items;
  }
  try {
    const response = await proxyFetch(`${FORUM_NEWS_URL}/news?limit=${FEED_FETCH_LIMIT}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FORUM_NEWS_FETCH_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`Feed responded ${response.status}`);
    const body = await response.json();
    const news = Array.isArray(body?.news) ? body.news : [];
    cache = { fetchedAt: Date.now(), items: normalizeNews(news) };
    return cache.items;
  } catch (err) {
    if (cache.items) {
      logger.warn({ err: err.message }, 'Forum news feed fetch failed; serving stale cache');
      return cache.items;
    }
    throw new Error(`Forum news feed unavailable: ${err.message}`);
  }
}

/**
 * Normalize feed items into compact, token-cheap records, newest first. The
 * service already dedupes by item id, so only shaping happens here.
 */
function normalizeNews(news) {
  return news
    .map((it) => ({
      title: it.title || '(untitled)',
      url: it.url || null,
      publishedAt: it.publishedAt || null,
      publishedMs: parseTime(it),
      summary: typeof it.summary === 'string' && it.summary
        ? it.summary.slice(0, MAX_SUMMARY_CHARS)
        : null,
      tags: Array.isArray(it.tags) ? it.tags : [],
      forum: { id: it.forum?.id || null, name: it.forum?.name || null, url: it.forum?.url || null },
      chains: Array.isArray(it.chains)
        ? it.chains.filter((c) => c?.chainId != null).map((c) => ({ chainId: c.chainId, name: c.name ?? null }))
        : []
    }))
    .sort((a, b) => (b.publishedMs ?? 0) - (a.publishedMs ?? 0));
}

function parseTime(it) {
  const t = Date.parse(it.publishedAt || it.updatedAt || '');
  return Number.isNaN(t) ? null : t;
}
