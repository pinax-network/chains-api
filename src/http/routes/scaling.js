import { getAllChains, getChainById } from '../../../dataService.js';
import { getL2BeatRefreshStatus } from '../../services/l2beatRefresher.js';
import { parseIntParam } from '../util/parseIntParam.js';
import { sendError } from '../util/sendError.js';

/**
 * /scaling — projects with L2BEAT data (any chain that L2BEAT classifies).
 * /scaling/:id — single chain's L2BEAT view.
 *
 * Returns empty / 404 when L2BEAT data hasn't loaded yet (live API gated and
 * static fallback unavailable). When the live API succeeds the per-chain
 * `l2Beat.dataFreshness` is `'live'`; when only the static snapshot is
 * available it's `'fallback'`. Chains the merge couldn't reach have no
 * `l2Beat` field at all (rather than a synthetic `'unavailable'` marker).
 */
export async function scalingRoutes(fastify) {
  fastify.get('/scaling', async () => {
    const chains = getAllChains().filter(c => c.l2Beat);
    return {
      count: chains.length,
      refresher: getL2BeatRefreshStatus(),
      chains
    };
  });

  fastify.get('/scaling/status', async () => getL2BeatRefreshStatus());

  fastify.get('/scaling/:id', async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    if (chainId === null) {
      return sendError(reply, 400, 'Invalid chain ID');
    }

    const chain = getChainById(chainId);
    if (!chain) {
      return sendError(reply, 404, 'Chain not found');
    }
    if (!chain.l2Beat) {
      return sendError(reply, 404, 'No L2BEAT data for this chain');
    }

    return chain;
  });
}
