import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  loadData,
  getCachedData,
  getAllChains,
  getAllKeywords,
  getRpcMonitoringResults,
  startRpcHealthCheck,
  validateChainData,
  countChainsByTag
} from '../../../dataService.js';
import {
  RELOAD_RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  DATA_CACHE_ENABLED,
  DATA_CACHE_FILE
} from '../../../config.js';
import { sendError } from '../util/sendError.js';

export async function adminRoutes(fastify) {
  fastify.get('/health', async () => {
    const cachedData = getCachedData();
    return {
      status: 'ok',
      dataLoaded: cachedData.indexed !== null,
      lastUpdated: cachedData.lastUpdated,
      totalChains: cachedData.indexed ? cachedData.indexed.all.length : 0
    };
  });

  fastify.get('/sources', async () => {
    const cachedData = getCachedData();
    return {
      lastUpdated: cachedData.lastUpdated,
      sources: {
        theGraph: cachedData.theGraph ? 'loaded' : 'not loaded',
        chainlist: cachedData.chainlist ? 'loaded' : 'not loaded',
        chains: cachedData.chains ? 'loaded' : 'not loaded',
        slip44: cachedData.slip44 ? 'loaded' : 'not loaded'
      }
    };
  });

  fastify.get('/export', {
    config: {
      rateLimit: {
        max: RELOAD_RATE_LIMIT_MAX,
        timeWindow: RATE_LIMIT_WINDOW_MS
      }
    }
  }, async (_request, reply) => {
    if (!DATA_CACHE_ENABLED) {
      return sendError(reply, 503, 'Data cache export is disabled');
    }

    const filePath = resolve(DATA_CACHE_FILE);

    try {
      const raw = await readFile(filePath, 'utf8');
      const exportData = JSON.parse(raw);

      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${basename(filePath)}"`);
      return exportData;
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return sendError(reply, 404, 'Export file not found');
      }

      if (error instanceof SyntaxError) {
        return sendError(reply, 500, 'Export file is not valid JSON');
      }

      fastify.log.error(error, 'Failed to export cache file');
      return sendError(reply, 500, 'Failed to export cache file');
    }
  });

  fastify.post('/reload', {
    config: {
      rateLimit: {
        max: RELOAD_RATE_LIMIT_MAX,
        timeWindow: RATE_LIMIT_WINDOW_MS
      }
    }
  }, async (_request, reply) => {
    try {
      await loadData();
      startRpcHealthCheck();
      const cachedData = getCachedData();
      return {
        status: 'success',
        lastUpdated: cachedData.lastUpdated,
        totalChains: cachedData.indexed ? cachedData.indexed.all.length : 0
      };
    } catch (error) {
      fastify.log.error(error, 'Failed to reload data');
      return sendError(reply, 500, 'Failed to reload data');
    }
  });

  fastify.get('/validate', async (_request, reply) => {
    const validationResults = validateChainData();
    if (validationResults.error) {
      return sendError(reply, 503, validationResults.error);
    }
    return validationResults;
  });

  fastify.get('/keywords', async () => {
    const keywordResults = getAllKeywords();
    const cachedData = getCachedData();
    return { lastUpdated: cachedData.lastUpdated, ...keywordResults };
  });

  fastify.get('/stats', async () => {
    const chains = getAllChains();
    const monitorResults = getRpcMonitoringResults();

    const { totalChains, totalMainnets, totalTestnets, totalL2s, totalBeacons } = countChainsByTag(chains);

    const rpcWorking = monitorResults.workingEndpoints;
    const rpcFailed = monitorResults.failedEndpoints || 0;
    const rpcTested = monitorResults.testedEndpoints;
    const rpcHealthPercent = rpcTested > 0
      ? Math.round((rpcWorking / rpcTested) * 10000) / 100
      : null;

    return {
      totalChains,
      totalMainnets,
      totalTestnets,
      totalL2s,
      totalBeacons,
      rpc: {
        totalEndpoints: monitorResults.totalEndpoints,
        tested: rpcTested,
        working: rpcWorking,
        failed: rpcFailed,
        healthPercent: rpcHealthPercent
      },
      lastUpdated: monitorResults.lastUpdated
    };
  });
}
