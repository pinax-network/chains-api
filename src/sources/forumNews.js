import WebSocketClient from 'ws';
import {
  FORUM_NEWS_URL,
  FORUM_NEWS_CACHE_TTL_MS,
  FORUM_NEWS_FETCH_TIMEOUT_MS
} from '../../config.js';
import { proxyFetch } from '../../fetchUtil.js';
import { logger } from '../util/logger.js';

/**
 * Forum/governance news feed (chains-forum-news). Aggregates official chain
 * forums (Ethereum Magicians, Arbitrum DAO, …) keyed by chain ID.
 *
 * WebSocket-first: on the first tool call a persistent WS subscription
 * (`/ws?replay=N`) is opened lazily and every pushed `news.item` lands in an
 * in-memory store, so subsequent reads are always current with zero upstream
 * requests. The REST endpoint (`/news`) seeds the store before the WS is
 * connected and is the fallback whenever the WS is down (short TTL cache so
 * a broken WS never turns into request-per-tool-call polling).
 */

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 15;
// The service stores up to ~2000 items; ask for a broad superset.
const FEED_FETCH_LIMIT = 500;
const WS_REPLAY = 500;
const MAX_SUMMARY_CHARS = 240;
const MAX_STORE_ITEMS = 1000;
const WS_MAX_RECONNECT_DELAY_MS = 60000;

// id -> normalized item; shared by WS pushes and REST seeds.
const store = new Map();
let restFetchedAt = 0;
let ws = null;
let wsOpen = false;
let wsRetries = 0;
let wsReconnectTimer = null;

export function _resetForumNewsForTests() {
  store.clear();
  restFetchedAt = 0;
  stopForumNewsWs();
  wsRetries = 0;
}

/** Close the WS and cancel reconnects (tests / graceful shutdown). */
export function stopForumNewsWs() {
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (ws) {
    ws.removeAllListeners();
    // Closing a still-connecting socket makes `ws` emit an error — swallow it,
    // this socket is already detached.
    ws.on('error', () => {});
    try { ws.terminate(); } catch { /* already closed */ }
    ws = null;
  }
  wsOpen = false;
}

/**
 * Fetch recent forum news, optionally filtered.
 *
 * @param {object} [options]
 * @param {number} [options.chainId] only posts tied to this chain
 * @param {string} [options.forum] only posts from this forum id (e.g. "ethereum")
 * @param {number} [options.limit] max posts returned (default 15, max 50)
 * @returns {Promise<{fetchedAt: string, source: string, count: number, totalMatched: number, news: object[]}>}
 * @throws when neither the WS nor the REST feed has produced any data
 */
export async function getForumNews({ chainId, forum, limit = DEFAULT_LIMIT } = {}) {
  ensureWs();
  // A live WS keeps the store current on its own; only hit REST while the
  // socket is down (or before its replay has landed anything).
  if (!wsOpen || store.size === 0) await restSeed();

  let filtered = [...store.values()].sort((a, b) => (b.publishedMs ?? 0) - (a.publishedMs ?? 0));
  if (chainId != null) filtered = filtered.filter((it) => it.chains.some((c) => c.chainId === chainId));
  if (forum) {
    const f = String(forum).toLowerCase();
    filtered = filtered.filter((it) => it.forum.id?.toLowerCase() === f);
  }
  const capped = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT));
  const sliced = filtered.slice(0, capped);
  return {
    fetchedAt: new Date().toISOString(),
    source: wsOpen ? 'websocket' : 'rest',
    count: sliced.length,
    totalMatched: filtered.length,
    news: sliced
  };
}

// ── WebSocket (primary) ──────────────────────────────────────────────────────

function ensureWs() {
  if (ws || wsReconnectTimer) return;
  connectWs();
}

function connectWs() {
  const url = `${FORUM_NEWS_URL.replace(/^http/, 'ws')}/ws?replay=${WS_REPLAY}`;
  try {
    ws = new WebSocketClient(url, { handshakeTimeout: FORUM_NEWS_FETCH_TIMEOUT_MS });
  } catch (err) {
    logger.warn({ err: err.message }, 'Forum news WS creation failed');
    scheduleWsReconnect();
    return;
  }
  ws.on('open', () => {
    wsOpen = true;
    wsRetries = 0;
    logger.info({ url }, 'Forum news WS connected');
  });
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'news.item' && msg.item) upsertItem(msg.item);
    } catch { /* ignore malformed frames */ }
  });
  ws.on('error', (err) => {
    logger.warn({ err: err.message }, 'Forum news WS error');
  });
  ws.on('close', () => {
    wsOpen = false;
    ws = null;
    scheduleWsReconnect();
  });
}

function scheduleWsReconnect() {
  if (wsReconnectTimer) return;
  const delay = Math.min(1000 * 2 ** wsRetries, WS_MAX_RECONNECT_DELAY_MS);
  wsRetries++;
  // unref: a pending reconnect must never keep the process (or tests) alive.
  wsReconnectTimer = setTimeout(() => { wsReconnectTimer = null; connectWs(); }, delay);
  wsReconnectTimer.unref?.();
}

// ── REST (seed + fallback) ───────────────────────────────────────────────────

async function restSeed() {
  if (store.size > 0 && Date.now() - restFetchedAt < FORUM_NEWS_CACHE_TTL_MS) return;
  try {
    const response = await proxyFetch(`${FORUM_NEWS_URL}/news?limit=${FEED_FETCH_LIMIT}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(FORUM_NEWS_FETCH_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`Feed responded ${response.status}`);
    const body = await response.json();
    const news = Array.isArray(body?.news) ? body.news : [];
    for (const item of news) upsertItem(item);
    restFetchedAt = Date.now();
  } catch (err) {
    if (store.size > 0) {
      logger.warn({ err: err.message }, 'Forum news REST fetch failed; serving existing store');
      return;
    }
    throw new Error(`Forum news feed unavailable: ${err.message}`);
  }
}

// ── Store ────────────────────────────────────────────────────────────────────

function upsertItem(raw) {
  const id = raw.id || `${raw.forum?.id || 'unknown'}|${(raw.title || '').toLowerCase().trim()}`;
  store.set(id, normalizeItem(raw));
  if (store.size > MAX_STORE_ITEMS) evictOldest();
}

function evictOldest() {
  const sorted = [...store.entries()].sort((a, b) => (b[1].publishedMs ?? 0) - (a[1].publishedMs ?? 0));
  for (const [id] of sorted.slice(MAX_STORE_ITEMS)) store.delete(id);
}

function normalizeItem(it) {
  return {
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
  };
}

function parseTime(it) {
  const t = Date.parse(it.publishedAt || it.updatedAt || '');
  return Number.isNaN(t) ? null : t;
}
