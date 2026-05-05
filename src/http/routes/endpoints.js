import { getAllEndpoints, getEndpointsById } from '../../../dataService.js';
import { parseIntParam } from '../util/parseIntParam.js';
import { sendError } from '../util/sendError.js';

export async function endpointsRoutes(fastify) {
  fastify.get('/endpoints', async () => {
    const endpoints = getAllEndpoints();
    return { count: endpoints.length, endpoints };
  });

  fastify.get('/endpoints/:id', async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    if (chainId === null) {
      return sendError(reply, 400, 'Invalid chain ID');
    }

    const result = getEndpointsById(chainId);
    if (!result) {
      return sendError(reply, 404, 'Chain not found');
    }

    return result;
  });
}
