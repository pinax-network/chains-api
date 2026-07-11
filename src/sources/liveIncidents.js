import {
  LIVE_INCIDENTS_URL,
  LIVE_INCIDENTS_CACHE_TTL_MS,
  LIVE_INCIDENTS_FETCH_TIMEOUT_MS
} from '../../config.js';
import { proxyFetch } from '../../fetchUtil.js';
import { logger } from '../util/logger.js';

/**
 * Live incident feed (chains-status-news). The dashboard consumes this feed
 * client-side over WebSocket; this module gives the server (assistant + MCP
 * tools) the same data via the feed's REST endpoint, behind a short in-memory
 * cache so tool calls never hammer the upstream.
 */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;
// The feed retains a few hundred events; 500 is "everything it has".
const FEED_FETCH_LIMIT = 500;

let cache = { fetchedAt: 0, incidents: null };

export function _resetLiveIncidentsCacheForTests() {
  cache = { fetchedAt: 0, incidents: null };
}

/**
 * Fetch live incidents, optionally filtered.
 *
 * @param {object} [options]
 * @param {'chain'|'provider'|'all'} [options.type] chain-operator vs RPC-provider incidents
 * @param {number} [options.chainId] only incidents affecting this chain
 * @param {string} [options.provider] only incidents from this provider id (e.g. "infura")
 * @param {boolean} [options.ongoing] true = only active incidents, false = only non-active
 * @param {string} [options.status] only incidents in this lifecycle state (e.g.
 *   "maintenance_scheduled" for upcoming maintenance, "investigating" for open incidents)
 * @param {number} [options.limit] max incidents returned (default 30, max 100)
 * @returns {Promise<{fetchedAt: string, count: number, incidents: object[]}>}
 * @throws when the feed is unreachable and no cached data exists
 */
export async function getLiveIncidents({ type = 'all', chainId, provider, ongoing, status, limit = DEFAULT_LIMIT } = {}) {
  const incidents = await loadIncidents();
  let filtered = incidents;
  if (type === 'chain') filtered = filtered.filter((it) => !it.isProvider);
  else if (type === 'provider') filtered = filtered.filter((it) => it.isProvider);
  if (chainId != null) filtered = filtered.filter((it) => it.chains.some((c) => c.chainId === chainId));
  if (typeof ongoing === 'boolean') filtered = filtered.filter((it) => it.ongoing === ongoing);
  if (status) filtered = filtered.filter((it) => it.status === status);
  if (provider) {
    const p = String(provider).toLowerCase();
    filtered = filtered.filter((it) => it.statusPage.id?.toLowerCase() === p);
  }
  const capped = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT));
  const sliced = filtered.slice(0, capped);
  return {
    fetchedAt: new Date(cache.fetchedAt).toISOString(),
    count: sliced.length,
    totalMatched: filtered.length,
    incidents: sliced
  };
}

async function loadIncidents() {
  if (cache.incidents && Date.now() - cache.fetchedAt < LIVE_INCIDENTS_CACHE_TTL_MS) {
    return cache.incidents;
  }
  try {
    const response = await proxyFetch(`${LIVE_INCIDENTS_URL}/events?limit=${FEED_FETCH_LIMIT}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(LIVE_INCIDENTS_FETCH_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error(`Feed responded ${response.status}`);
    const body = await response.json();
    const events = Array.isArray(body?.events) ? body.events : [];
    cache = { fetchedAt: Date.now(), incidents: normalizeEvents(events) };
    return cache.incidents;
  } catch (err) {
    if (cache.incidents) {
      logger.warn({ err: err.message }, 'Live incident feed fetch failed; serving stale cache');
      return cache.incidents;
    }
    throw new Error(`Live incident feed unavailable: ${err.message}`);
  }
}

/**
 * Normalize raw feed events into compact, token-cheap incident records and
 * dedupe them. The feed emits one event per status update; the dashboard
 * merges them by status page + title, keeping the newest — same rule here.
 */
function normalizeEvents(events) {
  const byKey = new Map();
  for (const ev of events) {
    const statusPage = ev.statusPage || {};
    const publishedMs = parseEventTime(ev);
    const key = `${statusPage.id || 'unknown'}|${(ev.title || '').toLowerCase().trim()}`;
    const existing = byKey.get(key);
    if (existing && (existing.publishedMs ?? 0) >= (publishedMs ?? 0)) continue;
    byKey.set(key, {
      title: ev.title || '(untitled)',
      url: ev.url || null,
      publishedAt: publishedMs != null ? new Date(publishedMs).toISOString() : null,
      publishedMs,
      // Structured incident state from the feed (Atlassian/webhook exact, or
      // text-derived server-side for feed-only providers). Kept so the assistant
      // and MCP tools can tell an active incident from a long-resolved one
      // without re-parsing titles.
      status: ev.status ?? null,
      ongoing: typeof ev.ongoing === 'boolean' ? ev.ongoing : null,
      impact: ev.impact ?? null,
      statusPage: { id: statusPage.id || null, name: statusPage.name || null, kind: statusPage.kind || null },
      isProvider: statusPage.kind === 'rpc-provider',
      chains: Array.isArray(ev.chains)
        ? ev.chains.filter((c) => c?.chainId != null).map((c) => ({ chainId: c.chainId, name: c.name ?? null }))
        : [],
      affectedComponents: Array.isArray(ev.affectedComponents) ? ev.affectedComponents : []
    });
  }
  return [...byKey.values()].sort((a, b) => (b.publishedMs ?? 0) - (a.publishedMs ?? 0));
}

function parseEventTime(ev) {
  const t = Date.parse(ev.publishedAt || ev.updatedAt || '');
  return Number.isNaN(t) ? null : t;
}
