export const cachedData = {
  theGraph: null,
  chainlist: null,
  chains: null,
  slip44: null,
  l2beat: null,
  indexed: null,
  lastUpdated: null,
  rpcHealth: {},
  lastRpcCheck: null
};

export function applyDataToCache(data) {
  cachedData.theGraph = data.theGraph ?? null;
  cachedData.chainlist = data.chainlist ?? null;
  cachedData.chains = data.chains ?? null;
  cachedData.slip44 = data.slip44 ?? {};
  cachedData.l2beat = data.l2beat ?? null;
  cachedData.indexed = data.indexed ?? null;
  cachedData.lastUpdated = data.lastUpdated ?? null;
  cachedData.rpcHealth = data.rpcHealth ?? {};
  cachedData.lastRpcCheck = data.lastRpcCheck ?? null;
}

export function getCachedData() {
  return cachedData;
}
