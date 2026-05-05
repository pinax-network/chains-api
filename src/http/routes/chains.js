import { searchChains, getChainById, getAllChains } from '../../../dataService.js';
import { MAX_SEARCH_QUERY_LENGTH, RATE_LIMIT_WINDOW_MS, SEARCH_RATE_LIMIT_MAX } from '../../../config.js';
import { parseIntParam } from '../util/parseIntParam.js';
import { sendError } from '../util/sendError.js';

const VALID_TAGS = ['Testnet', 'L2', 'Beacon'];

export async function chainsRoutes(fastify) {
  fastify.get('/chains', async (request, reply) => {
    const { tag } = request.query;
    let chains = getAllChains();

    if (tag) {
      if (!VALID_TAGS.includes(tag)) {
        return sendError(reply, 400, `Invalid tag. Allowed: ${VALID_TAGS.join(', ')}`);
      }
      chains = chains.filter(chain => chain.tags?.includes(tag));
    }

    return { count: chains.length, chains };
  });

  fastify.get('/chains/:id', async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    if (chainId === null) {
      return sendError(reply, 400, 'Invalid chain ID');
    }

    const chain = getChainById(chainId);
    if (!chain) {
      return sendError(reply, 404, 'Chain not found');
    }

    return chain;
  });

  fastify.get('/search', {
    config: {
      rateLimit: {
        max: SEARCH_RATE_LIMIT_MAX,
        timeWindow: RATE_LIMIT_WINDOW_MS
      }
    }
  }, async (request, reply) => {
    const { q } = request.query;

    if (!q) {
      return sendError(reply, 400, 'Query parameter "q" is required');
    }

    if (q.length > MAX_SEARCH_QUERY_LENGTH) {
      return sendError(reply, 400, `Query too long. Max length: ${MAX_SEARCH_QUERY_LENGTH}`);
    }

    const results = searchChains(q);

    return { query: q, count: results.length, results };
  });
}
