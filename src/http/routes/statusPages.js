import {
  getAllStatusPages,
  getStatusPageByChainId,
  getAllCoinStatusPages,
  getStatusPageBySymbol
} from '../../sources/statusPages.js';
import { parseIntParam } from '../util/parseIntParam.js';
import { sendError } from '../util/sendError.js';

export async function statusPagesRoutes(fastify) {
  fastify.get('/status-pages', async () => {
    const statusPages = getAllStatusPages();
    const coins = getAllCoinStatusPages();
    return { count: statusPages.length, statusPages, coinCount: coins.length, coins };
  });

  // Coin/symbol lookup for networks not keyed by chainId (non-EVM L1s,
  // protocols). Two path segments, so it never collides with /:id below.
  fastify.get('/status-pages/symbol/:symbol', {
    schema: {
      params: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            pattern: '^[A-Za-z0-9_]{1,20}$',
            errorMessage: 'Invalid coin symbol'
          }
        },
        required: ['symbol']
      }
    }
  }, async (request, reply) => {
    const result = getStatusPageBySymbol(request.params.symbol);
    if (!result) {
      return sendError(reply, 404, 'No status page known for this coin');
    }
    return result;
  });

  fastify.get('/status-pages/:id', {
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
    const result = getStatusPageByChainId(chainId);
    if (!result) {
      return sendError(reply, 404, 'No status page known for this chain');
    }
    return result;
  });
}
