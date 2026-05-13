import { getRpcMonitoringResults, getRpcMonitoringStatus } from '../../../dataService.js';
import { parseIntParam } from '../util/parseIntParam.js';
import { sendError } from '../util/sendError.js';

const intIdParam = {
  type: 'object',
  properties: { id: { type: 'string', pattern: '^-?\\d+$' } },
  required: ['id']
};

export async function rpcMonitorRoutes(fastify) {
  fastify.get('/rpc-monitor', async () => {
    const results = getRpcMonitoringResults();
    const status = getRpcMonitoringStatus();
    return { ...status, ...results };
  });

  fastify.get('/rpc-monitor/:id', {
    schema: { params: intIdParam }
  }, async (request, reply) => {
    const chainId = parseIntParam(request.params.id);

    const results = getRpcMonitoringResults();
    const chainResults = results.results.filter(r => r.chainId === chainId);

    if (chainResults.length === 0) {
      return sendError(reply, 404, 'No monitoring results found for this chain');
    }

    const workingCount = chainResults.filter(r => r.status === 'working').length;
    const failedCount = chainResults.filter(r => r.status === 'failed').length;

    return {
      chainId,
      chainName: chainResults[0].chainName,
      totalEndpoints: chainResults.length,
      workingEndpoints: workingCount,
      failedEndpoints: failedCount,
      lastUpdated: results.lastUpdated,
      endpoints: chainResults
    };
  });
}
