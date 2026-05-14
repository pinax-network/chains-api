import { getClientsByChain } from '../../../clientsView.js';
import { getRpcMonitoringResults } from '../../store/queries.js';
import { parseIntParam } from '../util/parseIntParam.js';
import { sendError } from '../util/sendError.js';

export async function clientsRoutes(fastify) {
  fastify.get('/clients', async () => {
    const results = getRpcMonitoringResults();
    const chains = getClientsByChain();
    return {
      lastUpdated: results.lastUpdated,
      count: chains.length,
      chains
    };
  });

  fastify.get('/clients/:id', {
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
    const summary = getClientsByChain(chainId);
    if (!summary) {
      return sendError(reply, 404, 'No monitoring data available yet for this chain');
    }
    return summary;
  });
}
