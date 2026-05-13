import { getAllRelations, getRelationsById, traverseRelations } from '../../../dataService.js';
import { parseIntParam } from '../util/parseIntParam.js';
import { sendError } from '../util/sendError.js';

const MIN_DEPTH = 1;
const MAX_DEPTH = 5;
const DEFAULT_DEPTH = 2;

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

export async function relationsRoutes(fastify) {
  fastify.get('/relations', async () => getAllRelations());

  fastify.get('/relations/:id', {
    schema: { params: intIdParam }
  }, async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    const result = getRelationsById(chainId);
    if (!result) return sendError(reply, 404, 'Chain not found');
    return result;
  });

  fastify.get('/relations/:id/graph', {
    schema: {
      params: intIdParam,
      querystring: {
        type: 'object',
        properties: {
          depth: {
            type: 'integer',
            minimum: MIN_DEPTH,
            maximum: MAX_DEPTH,
            default: DEFAULT_DEPTH,
            errorMessage: `Invalid depth. Must be between ${MIN_DEPTH} and ${MAX_DEPTH}`
          }
        },
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    const depth = request.query.depth ?? DEFAULT_DEPTH;
    const result = traverseRelations(chainId, depth);
    if (!result) return sendError(reply, 404, 'Chain not found');
    return result;
  });
}
