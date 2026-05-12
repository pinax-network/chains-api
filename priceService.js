import { proxyFetch } from './fetchUtil.js';
import {
  PRICE_CACHE_TTL_MS,
  PRICE_NEGATIVE_CACHE_TTL_MS,
  PRICE_FETCH_TIMEOUT_MS,
} from './config.js';

const CHAIN_ID_TO_COINGECKO_ID = {
  1: 'ethereum',
  10: 'ethereum',
  25: 'crypto-com-chain',
  56: 'binancecoin',
  66: 'oec-token',
  100: 'xdai',
  137: 'matic-network',
  250: 'fantom',
  288: 'ethereum',
  324: 'ethereum',
  1088: 'metis-token',
  1284: 'moonbeam',
  1285: 'moonriver',
  2222: 'kava',
  5000: 'mantle',
  7700: 'canto',
  8217: 'kaia',
  8453: 'ethereum',
  9001: 'evmos',
  42161: 'ethereum',
  42170: 'ethereum',
  42220: 'celo',
  43114: 'avalanche-2',
  59144: 'ethereum',
  81457: 'ethereum',
  534352: 'ethereum',
  1313161554: 'ethereum',
  1666600000: 'harmony',
};

const COINGECKO_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';

// Cache keyed by coinId so sibling chains share a single entry naturally.
// Value: { usd: number, updatedAt: string } for hits,
//        { usd: null, updatedAt: string }  for negative entries (short TTL).
const priceCache = new Map();

// Coalesce concurrent fetches: one in-flight promise per coinId.
const inflight = new Map();

export function getCoinGeckoId(chainId) {
  return CHAIN_ID_TO_COINGECKO_ID[chainId] ?? null;
}

function isFresh(entry) {
  if (!entry) return false;
  const age = Date.now() - new Date(entry.updatedAt).getTime();
  const ttl = entry.usd === null ? PRICE_NEGATIVE_CACHE_TTL_MS : PRICE_CACHE_TTL_MS;
  return age <= ttl;
}

function getCachedByCoinId(coinId) {
  const entry = priceCache.get(coinId);
  return isFresh(entry) ? entry : null;
}

function toPublic(entry) {
  if (!entry || entry.usd === null) return null;
  return { usd: entry.usd, updatedAt: entry.updatedAt };
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRICE_FETCH_TIMEOUT_MS);
  try {
    return await proxyFetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCoinIds(coinIds) {
  if (coinIds.length === 0) return new Map();

  // Coalesce: for each coinId, reuse an in-flight promise if one exists.
  // Otherwise schedule the missing IDs in a single batched request.
  const result = new Map();
  const toFetch = [];
  const waiters = [];

  for (const id of coinIds) {
    const pending = inflight.get(id);
    if (pending) {
      waiters.push(pending.then(map => [id, map.get(id)]));
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length > 0) {
    const batchPromise = (async () => {
      const map = new Map();
      const url = `${COINGECKO_PRICE_URL}?ids=${toFetch.join(',')}&vs_currencies=usd`;
      try {
        const response = await fetchWithTimeout(url);
        if (response.ok) {
          const data = await response.json();
          for (const [id, prices] of Object.entries(data)) {
            if (typeof prices?.usd === 'number') map.set(id, prices.usd);
          }
        } else {
          console.warn(`CoinGecko price fetch failed: HTTP ${response.status}`);
        }
      } catch (err) {
        console.warn(`CoinGecko price fetch error: ${err.message}`);
      }
      return map;
    })();

    for (const id of toFetch) {
      inflight.set(id, batchPromise);
    }
    try {
      const map = await batchPromise;
      for (const id of toFetch) {
        if (map.has(id)) result.set(id, map.get(id));
      }
    } finally {
      for (const id of toFetch) inflight.delete(id);
    }
  }

  for (const [id, usd] of await Promise.all(waiters.map(p => p))) {
    if (usd !== undefined) result.set(id, usd);
  }

  return result;
}

function recordResults(coinIds, fetched) {
  const updatedAt = new Date().toISOString();
  for (const id of coinIds) {
    if (fetched.has(id)) {
      priceCache.set(id, { usd: fetched.get(id), updatedAt });
    } else {
      // Negative cache: short TTL so we don't hammer CoinGecko on every request
      // when an ID is missing or temporarily unavailable.
      priceCache.set(id, { usd: null, updatedAt });
    }
  }
}

export async function getPriceForChain(chainId) {
  const coinId = getCoinGeckoId(chainId);
  if (!coinId) return null;

  const cached = getCachedByCoinId(coinId);
  if (cached) return toPublic(cached);

  const fetched = await fetchCoinIds([coinId]);
  recordResults([coinId], fetched);
  return toPublic(priceCache.get(coinId));
}

export async function getPricesForChains(chainIds) {
  const result = new Map();
  const wantedCoinIds = new Set();
  const chainToCoin = new Map();

  for (const chainId of chainIds) {
    const coinId = getCoinGeckoId(chainId);
    if (!coinId) {
      result.set(chainId, null);
      continue;
    }
    chainToCoin.set(chainId, coinId);
    const cached = getCachedByCoinId(coinId);
    if (cached) {
      result.set(chainId, toPublic(cached));
    } else {
      wantedCoinIds.add(coinId);
    }
  }

  if (wantedCoinIds.size > 0) {
    const coinIds = [...wantedCoinIds];
    const fetched = await fetchCoinIds(coinIds);
    recordResults(coinIds, fetched);
  }

  for (const [chainId, coinId] of chainToCoin) {
    if (result.has(chainId)) continue;
    result.set(chainId, toPublic(priceCache.get(coinId)));
  }

  return result;
}

/**
 * Warm the cache for all chainIds with a known CoinGecko mapping.
 * Intended to be called once after data load so the first /chains request
 * doesn't pay a CoinGecko round-trip on the hot path. Failures are silent —
 * a cold cache falls back to per-request fetching with the same timeout.
 */
export async function prefetchAllPrices() {
  const coinIds = [...new Set(Object.values(CHAIN_ID_TO_COINGECKO_ID))];
  const fetched = await fetchCoinIds(coinIds);
  recordResults(coinIds, fetched);
}

export function clearPriceCache() {
  priceCache.clear();
  inflight.clear();
}
