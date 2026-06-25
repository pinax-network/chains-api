/**
 * Background self-healer for boot-only data sources.
 *
 * TheGraph, Chainlist, Chain ID Network and SLIP-0044 are fetched once at
 * startup. Before this, a single transient network failure at boot left a
 * registry empty until someone ran POST /reload or restarted the pod — there
 * was no retry and no periodic re-fetch.
 *
 * This timer checks every SOURCE_REFRESH_INTERVAL_MS whether any of those
 * registries failed to load and, if so, re-fetches all sources (preserving the
 * in-progress RPC-health sweep). When everything is loaded it does nothing, so
 * the healthy path is never disrupted. Fetch-level retry (transport/fetch.js)
 * handles most blips; this is the backstop for the rest.
 */
import { SOURCE_REFRESH_INTERVAL_MS } from '../../config.js';
import { getFailedSources, refreshAllSources } from './loader.js';
import { logger } from '../util/logger.js';
import { incCounter } from '../util/metrics.js';

let timer = null;

/** Run one self-heal check. Exported for tests and manual invocation. */
export async function runSourceHealCheck() {
  const failed = getFailedSources();
  if (failed.length === 0) return { healed: false, failed };

  logger.warn({ failed }, 'Source self-heal: re-fetching after failed source(s)');
  incCounter('chains_api_source_selfheal_total', { outcome: 'attempt' });
  try {
    await refreshAllSources();
    const stillFailed = getFailedSources();
    const healed = stillFailed.length < failed.length;
    incCounter('chains_api_source_selfheal_total', { outcome: healed ? 'recovered' : 'still_failed' });
    logger.info({ failedBefore: failed, failedAfter: stillFailed }, 'Source self-heal completed');
    return { healed, failed: stillFailed };
  } catch (err) {
    incCounter('chains_api_source_selfheal_total', { outcome: 'error' });
    logger.error({ err: err.message || err }, 'Source self-heal failed');
    return { healed: false, failed };
  }
}

export function startSourceRefresher() {
  if (timer) return;
  if (!SOURCE_REFRESH_INTERVAL_MS || SOURCE_REFRESH_INTERVAL_MS <= 0) {
    logger.info('Source self-healer disabled (SOURCE_REFRESH_INTERVAL_MS=0)');
    return;
  }
  timer = setInterval(() => {
    runSourceHealCheck().catch(err =>
      logger.error({ err: err.message || err }, 'Source self-heal tick failed')
    );
  }, SOURCE_REFRESH_INTERVAL_MS);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer.unref === 'function') timer.unref();
  logger.info({ intervalMs: SOURCE_REFRESH_INTERVAL_MS }, 'Source self-healer started');
}

export function stopSourceRefresher() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
