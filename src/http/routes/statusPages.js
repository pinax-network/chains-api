import { getAllStatusPages, getStatusPageByChainId } from '../../sources/statusPages.js';
import { parseIntParam } from '../util/parseIntParam.js';
import { sendError } from '../util/sendError.js';

export async function statusPagesRoutes(fastify) {
  fastify.get('/status-pages', async () => {
    const statusPages = getAllStatusPages();
    return { count: statusPages.length, statusPages };
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
