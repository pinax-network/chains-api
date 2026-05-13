import {
  getCachedData,
  getRpcMonitoringStatus,
  validateChainData
} from '../../../dataService.js';
import { getL2BeatRefreshStatus } from '../../services/l2beatRefresher.js';
import { renderMetrics } from '../../util/metrics.js';

/**
 * GET /metrics — Prometheus exposition format. Scrape this endpoint to
 * monitor source freshness, refresh outcomes, RPC checks, and validation
 * error counts. Mounted as text/plain so existing scrapers parse it
 * without configuration.
 */
export async function metricsRoute(fastify) {
  fastify.get('/metrics', async (_request, reply) => {
    const cache = getCachedData();
    const rpcStatus = getRpcMonitoringStatus();
    const l2beatStatus = getL2BeatRefreshStatus();

    // Validation runs are O(N chains) — fine for occasional scrapes.
    let validationSummary = null;
    try {
      const report = validateChainData();
      if (!report.error) validationSummary = report.summary;
    } catch {
      // best-effort; surface no rows rather than crashing the scrape
    }

    const body = renderMetrics({ cache, rpcStatus, l2beatStatus, validationSummary });
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return body;
  });
}
