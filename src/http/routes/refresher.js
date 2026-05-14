import { getChainRefresherStatus } from '../../services/chainRefresher.js';

/**
 * GET /refresher — current state of the unified rolling refresher.
 * Useful for ops dashboards: sweep cursor, queue depth, last tick, and
 * per-job-type status (l2beat last refresh, RPC sweep completion).
 */
export async function refresherRoute(fastify) {
  fastify.get('/refresher', async () => getChainRefresherStatus());
}
