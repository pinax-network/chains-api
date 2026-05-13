import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  loadData,
  getCachedData,
  getAllChains,
  getAllKeywords,
  getRpcMonitoringResults,
  getRpcMonitoringStatus,
  startRpcHealthCheck,
  validateChainData,
  countChainsByTag
} from '../../../dataService.js';
import { getL2BeatRefreshStatus } from '../../services/l2beatRefresher.js';
import {
  RELOAD_RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  DATA_CACHE_ENABLED,
  DATA_CACHE_FILE
} from '../../../config.js';
import { sendError } from '../util/sendError.js';

function ageSeconds(isoTimestamp) {
  if (!isoTimestamp) return null;
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 1000);
}

function sourceFreshness(cache) {
  const dataAge = ageSeconds(cache.lastUpdated);
  const hasL2Beat = cache.l2beat != null
    && Array.isArray(cache.l2beat.projects)
    && cache.l2beat.projects.length > 0;
  return {
    theGraph: { loaded: cache.theGraph != null, ageSeconds: cache.theGraph != null ? dataAge : null },
    chainlist: { loaded: cache.chainlist != null, ageSeconds: cache.chainlist != null ? dataAge : null },
    chains: { loaded: cache.chains != null, ageSeconds: cache.chains != null ? dataAge : null },
    // slip44 distinguishes failure (null) from empty parse ({}), see loader.js.
    slip44: { loaded: cache.slip44 != null, ageSeconds: cache.slip44 != null ? dataAge : null },
    l2beat: {
      loaded: hasL2Beat,
      ageSeconds: ageSeconds(cache.l2beat?.fetchedAt),
      source: cache.l2beat?.source ?? null
    }
  };
}

function deriveOverallStatus(sources, refreshers) {
  const coreSources = ['theGraph', 'chainlist', 'chains'];
  const coreLoaded = coreSources.every(s => sources[s].loaded);
  if (!coreLoaded) return 'down';

  const supplementaryDegraded = !sources.slip44.loaded || !sources.l2beat.loaded;
  const rpcStale = refreshers.rpc.lastRunAt &&
    ageSeconds(refreshers.rpc.lastRunAt) > 30 * 60; // > 30 min
  const l2beatStale = refreshers.l2beat.lastRefreshAt &&
    refreshers.l2beat.intervalMs &&
    ageSeconds(refreshers.l2beat.lastRefreshAt) > (refreshers.l2beat.intervalMs / 1000) * 2;

  if (supplementaryDegraded || rpcStale || l2beatStale) return 'degraded';
  return 'ok';
}

export async function adminRoutes(fastify) {
  fastify.get('/health', async () => {
    const cachedData = getCachedData();
    const sources = sourceFreshness(cachedData);
    const rpcStatus = getRpcMonitoringStatus();
    const l2beatStatus = getL2BeatRefreshStatus();
    const refreshers = {
      rpc: {
        isRunning: rpcStatus.isMonitoring,
        lastRunAt: rpcStatus.lastUpdated
      },
      l2beat: l2beatStatus
    };

    return {
      status: deriveOverallStatus(sources, refreshers),
      dataLoaded: cachedData.indexed !== null,
      lastUpdated: cachedData.lastUpdated,
      totalChains: cachedData.indexed ? cachedData.indexed.all.length : 0,
      sources,
      refreshers
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
        slip44: cachedData.slip44 != null ? 'loaded' : 'not loaded',
        l2beat: cachedData.l2beat?.projects?.length > 0 ? 'loaded' : 'not loaded'
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
