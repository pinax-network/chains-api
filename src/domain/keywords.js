import { cachedData } from '../store/cache.js';

function addKeywordValue(set, value) {
  if (typeof value !== 'string') return;
  const normalized = value.trim();
  if (normalized.length > 0) set.add(normalized);
}

function addTokenKeywords(set, value) {
  if (typeof value !== 'string') return;
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(token => token.length >= 2);
  tokens.forEach(token => set.add(token));
}

const keywordSortCollator = new Intl.Collator('en', {
  numeric: true,
  sensitivity: 'base'
});

function sortKeywordSet(set) {
  return Array.from(set).sort((a, b) => keywordSortCollator.compare(a, b));
}

function extractClientName(clientVersion) {
  if (typeof clientVersion !== 'string') return null;
  const trimmed = clientVersion.trim();
  if (!trimmed) return null;
  const slashIndex = trimmed.indexOf('/');
  const candidate = slashIndex === -1 ? trimmed : trimmed.slice(0, slashIndex);
  return candidate || null;
}

const EMPTY_KEYWORDS = {
  totalKeywords: 0,
  keywords: {
    blockchainNames: [],
    networkNames: [],
    softwareClients: [],
    currencySymbols: [],
    tags: [],
    relationKinds: [],
    sources: [],
    statuses: [],
    generic: []
  }
};

// Memoized per data version: the keyword index only changes when sources
// reload (lastUpdated) or an RPC sweep adds client versions (lastRpcCheck).
// Without this, every /keywords request re-tokenized ~3k chains + RPC results.
let keywordsCache = { lastUpdated: null, lastRpcCheck: null, value: null };

export function getAllKeywords() {
  if (!cachedData.indexed) return structuredClone(EMPTY_KEYWORDS);

  if (
    keywordsCache.value !== null &&
    keywordsCache.lastUpdated === cachedData.lastUpdated &&
    keywordsCache.lastRpcCheck === cachedData.lastRpcCheck
  ) {
    return keywordsCache.value;
  }

  const value = buildKeywords();
  keywordsCache = {
    lastUpdated: cachedData.lastUpdated,
    lastRpcCheck: cachedData.lastRpcCheck,
    value
  };
  return value;
}

// Test-only helper.
export function _resetKeywordsCacheForTests() {
  keywordsCache = { lastUpdated: null, lastRpcCheck: null, value: null };
}

function buildKeywords() {
  const blockchainNames = new Set();
  const networkNames = new Set();
  const softwareClients = new Set();
  const currencySymbols = new Set();
  const tags = new Set();
  const relationKinds = new Set();
  const sources = new Set();
  const statuses = new Set();
  const generic = new Set();

  cachedData.indexed.all.forEach(chain => {
    addKeywordValue(blockchainNames, chain.name);
    addKeywordValue(networkNames, chain.network);
    addKeywordValue(networkNames, chain.shortName);
    addKeywordValue(networkNames, chain.theGraph?.id);
    addKeywordValue(networkNames, chain.theGraph?.caip2Id);
    addKeywordValue(currencySymbols, chain.nativeCurrency?.symbol);
    addKeywordValue(statuses, chain.status);

    addTokenKeywords(generic, chain.name);
    addTokenKeywords(generic, chain.network);
    addTokenKeywords(generic, chain.shortName);
    addTokenKeywords(generic, chain.theGraph?.fullName);

    if (Array.isArray(chain.sources)) {
      chain.sources.forEach(source => addKeywordValue(sources, source));
    }

    if (Array.isArray(chain.tags)) {
      chain.tags.forEach(tag => {
        addKeywordValue(tags, tag);
        addTokenKeywords(generic, tag);
      });
    }

    if (Array.isArray(chain.relations)) {
      chain.relations.forEach(relation => {
        addKeywordValue(relationKinds, relation.kind);
        addKeywordValue(networkNames, relation.network);
        addTokenKeywords(generic, relation.network);
      });
    }
  });

  Object.values(cachedData.rpcHealth || {}).forEach(results => {
    if (!Array.isArray(results)) return;

    results.forEach(result => {
      const clientName = extractClientName(result?.clientVersion);
      if (clientName) {
        addKeywordValue(softwareClients, clientName);
        addTokenKeywords(generic, clientName);
      }
      addTokenKeywords(generic, result?.clientVersion);
    });
  });

  const keywords = {
    blockchainNames: sortKeywordSet(blockchainNames),
    networkNames: sortKeywordSet(networkNames),
    softwareClients: sortKeywordSet(softwareClients),
    currencySymbols: sortKeywordSet(currencySymbols),
    tags: sortKeywordSet(tags),
    relationKinds: sortKeywordSet(relationKinds),
    sources: sortKeywordSet(sources),
    statuses: sortKeywordSet(statuses),
    generic: sortKeywordSet(generic)
  };

  const totalKeywords = Object.values(keywords).reduce(
    (acc, keywordList) => acc + keywordList.length,
    0
  );

  return { totalKeywords, keywords };
}
