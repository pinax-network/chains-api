/**
 * Backwards-compatible shim. Implementation lives in chainRefresher.js
 * (the unified rolling refresher). This module preserves the old API:
 * runL2BeatRefresh, startL2BeatRefresh, stopL2BeatRefresh,
 * getL2BeatRefreshStatus.
 *
 * New code should import from chainRefresher.js directly.
 */
import { L2BEAT_REFRESH_INTERVAL_MS } from '../../config.js';
import {
  startChainRefresher,
  stopChainRefresher,
  processL2BeatBatch,
  getChainRefresherStatus
} from './chainRefresher.js';

export async function runL2BeatRefresh() {
  return processL2BeatBatch();
}

export function startL2BeatRefresh() {
  startChainRefresher();
}

export function stopL2BeatRefresh() {
  stopChainRefresher();
}

export function getL2BeatRefreshStatus() {
  const status = getChainRefresherStatus();
  return {
    isRefreshing: status.isTickInFlight && status.lastTickJobType === 'l2beat_batch',
    lastRefreshAt: status.l2beat.lastRefreshAt,
    lastRefreshSource: status.l2beat.lastRefreshSource,
    lastRefreshError: status.l2beat.lastRefreshError,
    lastRefreshProjectCount: status.l2beat.lastRefreshProjectCount,
    intervalMs: L2BEAT_REFRESH_INTERVAL_MS
  };
}
