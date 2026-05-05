import { getAllRelations, getRelationsById, traverseRelations } from '../../../dataService.js';
import { parseIntParam } from '../util/parseIntParam.js';
import { sendError } from '../util/sendError.js';

const MIN_DEPTH = 1;
const MAX_DEPTH = 5;
const DEFAULT_DEPTH = 2;

export async function relationsRoutes(fastify) {
  fastify.get('/relations', async () => getAllRelations());

  fastify.get('/relations/:id', async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    if (chainId === null) {
      return sendError(reply, 400, 'Invalid chain ID');
    }

    const result = getRelationsById(chainId);
    if (!result) {
      return sendError(reply, 404, 'Chain not found');
    }

    return result;
  });

  fastify.get('/relations/:id/graph', async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    if (chainId === null) {
      return sendError(reply, 400, 'Invalid chain ID');
    }

    const depth = request.query.depth === undefined ? DEFAULT_DEPTH : parseIntParam(request.query.depth);
    if (depth === null || depth < MIN_DEPTH || depth > MAX_DEPTH) {
      return sendError(reply, 400, `Invalid depth. Must be between ${MIN_DEPTH} and ${MAX_DEPTH}`);
    }

    const result = traverseRelations(chainId, depth);
    if (!result) {
      return sendError(reply, 404, 'Chain not found');
    }

    return result;
  });
}
