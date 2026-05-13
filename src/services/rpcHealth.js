/**
 * Backwards-compatible shim. Implementation lives in chainRefresher.js
 * (the unified rolling refresher). This module preserves the old API
 * surface: startRpcHealthCheck, runRpcHealthCheck, getRpcMonitoringStatus.
 *
 * New code should import from chainRefresher.js directly.
 */
import { logger } from '../util/logger.js';
import { incCounter } from '../util/metrics.js';
import { cachedData } from '../store/cache.js';
import {
  startChainRefresher,
  processChainRpc,
  getChainRefresherStatus
} from './chainRefresher.js';

export function getRpcMonitoringStatus() {
  const status = getChainRefresherStatus();
  return {
    isMonitoring: status.rpc.isMonitoring,
    lastUpdated: cachedData.lastRpcCheck
  };
}

/**
 * Drain a full RPC sweep right now (used by /reload and tests). Differs
 * from the rolling tick path: here we process every chain back-to-back
 * instead of one chain per tick, so the caller gets blocking semantics.
 */
export async function runRpcHealthCheck() {
  if (!cachedData.indexed) {
    logger.warn('RPC health check skipped: data not loaded');
    return;
  }

  const dataVersion = cachedData.lastUpdated;
  const chains = cachedData.indexed.all || [];

  // Detect "no endpoints" to preserve the old log message + early return.
  const totalEndpoints = chains.reduce((acc, c) => {
    const urls = (c.rpc || [])
      .map(r => (typeof r === 'string' ? r : r?.url))
      .filter(u => typeof u === 'string' && u.startsWith('http'));
    return acc + new Set(urls).size;
  }, 0);

  // Reset state at the start of an all-at-once sweep (legacy contract).
  cachedData.rpcHealth = {};
  cachedData.lastRpcCheck = null;

  if (totalEndpoints === 0) {
    logger.warn('RPC health check skipped: no RPC endpoints found');
    return;
  }

  for (const chain of chains) {
    await processChainRpc(chain.chainId);
  }

  if (cachedData.lastUpdated !== dataVersion) {
    logger.warn('RPC health check skipped: data changed during run');
    return;
  }

  cachedData.lastRpcCheck = new Date().toISOString();
  const checkedChainCount = Object.keys(cachedData.rpcHealth).length;
  logger.info(
    { endpointsTested: totalEndpoints, chainsChecked: checkedChainCount },
    'RPC health check completed'
  );
  incCounter('chains_api_rpc_check_total', { outcome: 'completed' });
}

export function startRpcHealthCheck() {
  startChainRefresher();
}
