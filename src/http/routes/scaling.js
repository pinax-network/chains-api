import { getAllChains, getChainById } from '../../store/queries.js';
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
 *
 * Known gap: Starknet (CAIP-2 numeric ID 0x534e5f4d41494e = 23448594291968334)
 * exceeds Number.MAX_SAFE_INTEGER and is omitted from data/l2beat-fallback.json.
 * The live API can still surface Starknet — and the indexer will accept it as
 * a key — but precision-sensitive lookups via `parseIntParam(:id)` will not
 * round-trip its chainId. Switching the codebase to BigInt chainIds is the
 * proper fix; until then, /scaling/:id is best-effort for that chain.
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

  fastify.get('/scaling/:id', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            pattern: '^-?\\d+$',
            errorMessage: 'Invalid chain ID'
          }
        },
        required: ['id']
      }
    }
  }, async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    const chain = getChainById(chainId);
    if (!chain) return sendError(reply, 404, 'Chain not found');
    if (!chain.l2Beat) return sendError(reply, 404, 'No L2BEAT data for this chain');
    return chain;
  });
}
