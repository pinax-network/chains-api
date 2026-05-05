import { getCachedData } from '../../../dataService.js';
import { parseIntParam } from '../util/parseIntParam.js';
import { sendError } from '../util/sendError.js';

export async function slip44Routes(fastify) {
  fastify.get('/slip44', async (_request, reply) => {
    const cachedData = getCachedData();

    if (!cachedData.slip44) {
      return sendError(reply, 503, 'SLIP-0044 data not loaded');
    }

    return {
      count: Object.keys(cachedData.slip44).length,
      coinTypes: cachedData.slip44
    };
  });

  fastify.get('/slip44/:coinType', async (request, reply) => {
    const coinType = parseIntParam(request.params.coinType);
    if (coinType === null) {
      return sendError(reply, 400, 'Invalid coin type');
    }

    const cachedData = getCachedData();
    if (!cachedData.slip44?.[coinType]) {
      return sendError(reply, 404, 'Coin type not found');
    }

    return cachedData.slip44[coinType];
  });
}
