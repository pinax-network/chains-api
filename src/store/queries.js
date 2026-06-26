import { cachedData } from './cache.js';

function getChainByIdRaw(chainId) {
  if (!cachedData.indexed) return null;
  return cachedData.indexed.byChainId[chainId] || null;
}

function transformChain(chain) {
  if (!chain) return null;

  const transformedChain = {
    chainId: chain.chainId,
    name: chain.name,
    shortName: chain.shortName
  };

  if (chain.theGraph) {
    transformedChain['theGraph-id'] = chain.theGraph.id;
    transformedChain.fullName = chain.theGraph.fullName;
    transformedChain.caip2Id = chain.theGraph.caip2Id;
    if (chain.theGraph.aliases) {
      transformedChain.aliases = chain.theGraph.aliases;
    }
  }

  if (chain.nativeCurrency) transformedChain.nativeCurrency = chain.nativeCurrency;
  if (chain.explorers) transformedChain.explorers = chain.explorers;
  if (chain.infoURL) transformedChain.infoURL = chain.infoURL;
  if (chain.sources) transformedChain.sources = chain.sources;
  if (chain.tags) transformedChain.tags = chain.tags;
  if (chain.status) transformedChain.status = chain.status;
  if (chain.bridges) transformedChain.bridges = chain.bridges;
  if (chain.l2Beat) transformedChain.l2Beat = chain.l2Beat;
  if (chain.forumUrl) transformedChain.forumUrl = chain.forumUrl;

  return transformedChain;
}

export function getChainById(chainId) {
  return transformChain(getChainByIdRaw(chainId));
}

// Memoize getAllChains() so /chains, /scaling, /stats, etc. can hit the same
// transformed array within one data version without re-running transformChain
// over every entry. Keyed by cachedData.lastUpdated — invalidated automatically
// on loadData(); also invalidated when the cache is hot-merged (e.g.
// indexL2BeatSource adds fields without bumping lastUpdated).
let allChainsCache = { lastUpdated: null, lastL2BeatFetchedAt: null, value: null };

function invalidateAllChainsCacheIfStale() {
  const current = {
    lastUpdated: cachedData.lastUpdated,
    lastL2BeatFetchedAt: cachedData.l2beat?.fetchedAt ?? null
  };
  if (
    allChainsCache.lastUpdated !== current.lastUpdated ||
    allChainsCache.lastL2BeatFetchedAt !== current.lastL2BeatFetchedAt
  ) {
    allChainsCache = { ...current, value: null };
  }
}

export function getAllChains() {
  if (!cachedData.indexed) return [];
  invalidateAllChainsCacheIfStale();
  if (allChainsCache.value === null) {
    allChainsCache.value = cachedData.indexed.all.map(transformChain);
  }
  return allChainsCache.value;
}

// Test-only helper.
export function _resetGetAllChainsCacheForTests() {
  allChainsCache = { lastUpdated: null, lastL2BeatFetchedAt: null, value: null };
}

export function searchChains(query) {
  if (!cachedData.indexed) return [];

  const results = [];
  const queryLower = query.toLowerCase();

  const parsedChainId = Number.parseInt(query, 10);
  if (!Number.isNaN(parsedChainId)) {
    const chain = getChainById(parsedChainId);
    if (chain) results.push(chain);
  }

  cachedData.indexed.all.forEach(chain => {
    if (chain.name?.toLowerCase().includes(queryLower)) {
      if (!results.some(r => r.chainId === chain.chainId)) {
        results.push(getChainById(chain.chainId));
      }
    }
    if (chain.shortName?.toLowerCase().includes(queryLower)) {
      if (!results.some(r => r.chainId === chain.chainId)) {
        results.push(getChainById(chain.chainId));
      }
    }
  });

  return results;
}

export function countChainsByTag(chains) {
  const totalChains = chains.length;
  let totalTestnets = 0;
  let totalL2s = 0;
  let totalBeacons = 0;
  let totalMainnets = 0;

  for (const chain of chains) {
    const tags = chain.tags || [];
    const isTestnet = tags.includes('Testnet');
    const isL2 = tags.includes('L2');
    const isBeacon = tags.includes('Beacon');

    if (isTestnet) totalTestnets += 1;
    if (isL2) totalL2s += 1;
    if (isBeacon) totalBeacons += 1;
    if (!isTestnet && !isL2 && !isBeacon) totalMainnets += 1;
  }

  return { totalChains, totalMainnets, totalTestnets, totalL2s, totalBeacons };
}

function extractEndpoints(chain) {
  if (!chain) return null;

  const endpoints = {
    chainId: chain.chainId,
    name: chain.name,
    rpc: chain.rpc || [],
    firehose: [],
    substreams: []
  };

  if (chain.theGraph?.services) {
    if (chain.theGraph.services.firehose) {
      endpoints.firehose = chain.theGraph.services.firehose;
    }
    if (chain.theGraph.services.substreams) {
      endpoints.substreams = chain.theGraph.services.substreams;
    }
  }

  return endpoints;
}

export function getEndpointsById(chainId) {
  return extractEndpoints(getChainByIdRaw(chainId));
}

export function getAllEndpoints() {
  if (!cachedData.indexed) return [];
  return cachedData.indexed.all.map(extractEndpoints);
}

function flattenRpcHealthResults() {
  return Object.entries(cachedData.rpcHealth || {}).flatMap(([chainId, results]) => {
    const numericChainId = Number.parseInt(chainId, 10);
    const chainName = cachedData.indexed?.byChainId?.[numericChainId]?.name ?? `Chain ${chainId}`;

    return (Array.isArray(results) ? results : []).map((result) => ({
      chainId: numericChainId,
      chainName,
      url: result.url,
      status: result.ok ? 'working' : 'failed',
      clientVersion: result.clientVersion ?? null,
      blockNumber: result.blockHeight ?? null,
      latencyMs: result.latencyMs ?? null,
      error: result.error ?? null
    }));
  });
}

export function getRpcMonitoringResults() {
  const results = flattenRpcHealthResults();
  const workingEndpoints = results.filter(result => result.status === 'working').length;
  const failedEndpoints = results.length - workingEndpoints;

  return {
    lastUpdated: cachedData.lastRpcCheck,
    totalEndpoints: results.length,
    testedEndpoints: results.length,
    workingEndpoints,
    failedEndpoints,
    results
  };
}

