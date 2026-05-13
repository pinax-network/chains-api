import { getAllEndpoints, getEndpointsById } from '../../../dataService.js';
import { parseIntParam } from '../util/parseIntParam.js';
import { sendError } from '../util/sendError.js';

const intIdParam = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      pattern: '^-?\\d+$',
      errorMessage: 'Invalid chain ID'
    }
  },
  required: ['id']
};

export async function endpointsRoutes(fastify) {
  fastify.get('/endpoints', async () => {
    const endpoints = getAllEndpoints();
    return { count: endpoints.length, endpoints };
  });

  fastify.get('/endpoints/:id', {
    schema: { params: intIdParam }
  }, async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    const result = getEndpointsById(chainId);
    if (!result) return sendError(reply, 404, 'Chain not found');
    return result;
  });
}
