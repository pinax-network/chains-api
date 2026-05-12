import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { loadData, initializeDataOnStartup, getCachedData, searchChains, getChainById, getAllChains, getAllRelations, getRelationsById, getEndpointsById, getAllEndpoints, getAllKeywords, validateChainData, traverseRelations } from './dataService.js';
import { getMonitoringResults, getMonitoringStatus, startRpcHealthCheck, getClientsByChain, summarizeChainClients } from './rpcMonitor.js';
import { getPricesForChains, getPriceForChain, prefetchAllPrices } from './priceService.js';
import {
  PORT, HOST, BODY_LIMIT, MAX_PARAM_LENGTH,
  RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS,
  RELOAD_RATE_LIMIT_MAX, SEARCH_RATE_LIMIT_MAX,
  MAX_SEARCH_QUERY_LENGTH, CORS_ORIGIN,
  DATA_SOURCE_THE_GRAPH, DATA_SOURCE_CHAINLIST,
  DATA_SOURCE_CHAINS, DATA_SOURCE_SLIP44,
  DATA_CACHE_ENABLED, DATA_CACHE_FILE
} from './config.js';

/**
 * Build and configure the Fastify application
 * @param {Object} options - Options for the Fastify instance
 * @param {boolean} options.logger - Enable logging (default: true)
 * @param {number} options.bodyLimit - Request body size limit
 * @param {number} options.maxParamLength - Max parameter length
 * @param {boolean} options.loadDataOnStartup - Load data on startup (default: true)
 * @returns {Promise<FastifyInstance>} Configured Fastify instance
 */
export async function buildApp(options = {}) {
  const {
    logger = true,
    bodyLimit = BODY_LIMIT,
    maxParamLength = MAX_PARAM_LENGTH,
    loadDataOnStartup = true
  } = options;

  const fastify = Fastify({
    logger,
    bodyLimit,
    maxParamLength
  });

  // Security: CORS
  await fastify.register(cors, {
    origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(s => s.trim()),
    credentials: false
  });

  // Security: Helmet (security headers)
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"]
      }
    }
  });

  // Security: Rate limiting
  await fastify.register(rateLimit, {
    max: RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW_MS
  });

  // Load data on startup
  if (loadDataOnStartup) {
    await initializeDataOnStartup({
      onBackgroundRefreshSuccess: () => {
        startRpcHealthCheck();
      }
    });
    startRpcHealthCheck();
    // Warm the price cache in the background so the first /chains request
    // doesn't pay a CoinGecko round-trip. Failures are silent.
    prefetchAllPrices().catch(err => {
      console.warn(`Initial price prefetch failed: ${err.message}`);
    });
  }

  /**
   * Health check endpoint
   */
  fastify.get('/health', async (request, reply) => {
    const cachedData = getCachedData();
    return {
      status: 'ok',
      dataLoaded: cachedData.indexed !== null,
      lastUpdated: cachedData.lastUpdated,
      totalChains: cachedData.indexed ? cachedData.indexed.all.length : 0
    };
  });

  /**
   * Get all chains
   */
  fastify.get('/chains', async (request, reply) => {
    const { tag } = request.query;
    let chains = getAllChains();

    // Filter by tag if provided (validate against known tags)
    if (tag) {
      const validTags = ['Testnet', 'L2', 'Beacon'];
      if (!validTags.includes(tag)) {
        return sendError(reply, 400, `Invalid tag. Allowed: ${validTags.join(', ')}`);
      }
      chains = chains.filter(chain => chain.tags?.includes(tag));
    }

    const chainIds = chains.map(c => c.chainId);
    const priceMap = await getPricesForChains(chainIds);
    const enrichedChains = chains.map(chain => ({
      ...chain,
      price: priceMap.get(chain.chainId) ?? null
    }));

    return {
      count: enrichedChains.length,
      chains: enrichedChains
    };
  });

  /**
   * Get chain by ID
   */
  fastify.get('/chains/:id', async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    if (chainId === null) {
      return sendError(reply, 400, 'Invalid chain ID');
    }

    const chain = getChainById(chainId);
    if (!chain) {
      return sendError(reply, 404, 'Chain not found');
    }

    const price = await getPriceForChain(chainId);
    return { ...chain, price };
  });

  /**
   * Search chains (tighter rate limit)
   */
  fastify.get('/search', {
    config: {
      rateLimit: {
        max: SEARCH_RATE_LIMIT_MAX,
        timeWindow: RATE_LIMIT_WINDOW_MS
      }
    }
  }, async (request, reply) => {
    const { q } = request.query;

    if (!q) {
      return sendError(reply, 400, 'Query parameter "q" is required');
    }

    if (q.length > MAX_SEARCH_QUERY_LENGTH) {
      return sendError(reply, 400, `Query too long. Max length: ${MAX_SEARCH_QUERY_LENGTH}`);
    }

    const results = searchChains(q);

    return {
      query: q,
      count: results.length,
      results
    };
  });

  /**
   * Get all chain relations
   */
  fastify.get('/relations', async (request, reply) => {
    const relations = getAllRelations();

    return relations;
  });

  /**
   * Get relations for a specific chain by ID
   */
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

  /**
   * BFS graph traversal of chain relations
   */
  fastify.get('/relations/:id/graph', async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    if (chainId === null) {
      return sendError(reply, 400, 'Invalid chain ID');
    }

    const depth = request.query.depth !== undefined ? parseIntParam(request.query.depth) : 2;
    if (depth === null || depth < 1 || depth > 5) {
      return sendError(reply, 400, 'Invalid depth. Must be between 1 and 5');
    }

    const result = traverseRelations(chainId, depth);
    if (!result) {
      return sendError(reply, 404, 'Chain not found');
    }

    return result;
  });

  /**
   * Get all endpoints
   */
  fastify.get('/endpoints', async (request, reply) => {
    const endpoints = getAllEndpoints();

    return {
      count: endpoints.length,
      endpoints
    };
  });

  /**
   * Get endpoints for a specific chain by ID
   */
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

  /**
   * Get raw data sources
   */
  fastify.get('/sources', async (request, reply) => {
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

  /**
   * Export cached snapshot file
   */
  fastify.get('/export', async (_request, reply) => {
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

  /**
   * Get SLIP-0044 coin types as JSON
   */
  fastify.get('/slip44', async (request, reply) => {
    const cachedData = getCachedData();

    if (!cachedData.slip44) {
      return sendError(reply, 503, 'SLIP-0044 data not loaded');
    }

    return {
      count: Object.keys(cachedData.slip44).length,
      coinTypes: cachedData.slip44
    };
  });

  /**
   * Get specific SLIP-0044 coin type by ID
   */
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

  /**
   * Reload data from sources (tighter rate limit)
   */
  fastify.post('/reload', {
    config: {
      rateLimit: {
        max: RELOAD_RATE_LIMIT_MAX,
        timeWindow: RATE_LIMIT_WINDOW_MS
      }
    }
  }, async (request, reply) => {
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

  /**
   * Validate chain data for potential human errors
   */
  fastify.get('/validate', async (_request, reply) => {
    const validationResults = validateChainData();

    if (validationResults.error) {
      return sendError(reply, 503, validationResults.error);
    }

    return validationResults;
  });

  /**
   * Get extracted keywords from indexed chain and RPC monitor data
   */
  fastify.get('/keywords', async () => {
    const keywordResults = getAllKeywords();
    const cachedData = getCachedData();

    return {
      lastUpdated: cachedData.lastUpdated,
      ...keywordResults
    };
  });

  /**
   * Get RPC monitoring results
   */
  fastify.get('/rpc-monitor', async (request, reply) => {
    const results = getMonitoringResults();
    const status = getMonitoringStatus();

    return {
      ...status,
      ...results
    };
  });

  /**
   * Get RPC monitoring results for a specific chain
   */
  fastify.get('/rpc-monitor/:id', async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    if (chainId === null) {
      return sendError(reply, 400, 'Invalid chain ID');
    }

    const results = getMonitoringResults();
    const chainResults = results.results.filter(r => r.chainId === chainId);

    if (chainResults.length === 0) {
      return sendError(reply, 404, 'No monitoring results found for this chain');
    }

    let workingCount = 0;
    let failedCount = 0;
    for (const r of chainResults) {
      if (r.status === 'working') workingCount++;
      else if (r.status === 'failed') failedCount++;
    }

    return {
      chainId,
      chainName: chainResults[0].chainName,
      totalEndpoints: chainResults.length,
      workingEndpoints: workingCount,
      failedEndpoints: failedCount,
      lastUpdated: results.lastUpdated,
      endpoints: chainResults,
      clients: summarizeChainClients(chainResults)?.clients ?? []
    };
  });

  /**
   * Get aggregated client software across all chains
   */
  fastify.get('/clients', async () => {
    const results = getMonitoringResults();
    const chains = getClientsByChain();
    return {
      lastUpdated: results.lastUpdated,
      count: chains.length,
      chains
    };
  });

  /**
   * Get client software for a specific chain
   */
  fastify.get('/clients/:id', async (request, reply) => {
    const chainId = parseIntParam(request.params.id);
    if (chainId === null) {
      return sendError(reply, 400, 'Invalid chain ID');
    }

    const summary = getClientsByChain(chainId);
    if (!summary) {
      return sendError(reply, 404, 'No client data found for this chain');
    }

    return summary;
  });

  /**
   * Get aggregate stats
   */
  fastify.get('/stats', async (request, reply) => {
    const chains = getAllChains();
    const monitorResults = getMonitoringResults();

    const totalChains = chains.length;
    const totalMainnets = chains.filter(c => !c.tags?.includes('Testnet')).length;
    const totalTestnets = chains.filter(c => c.tags?.includes('Testnet')).length;
    const totalL2s = chains.filter(c => c.tags?.includes('L2')).length;
    const totalBeacons = chains.filter(c => c.tags?.includes('Beacon')).length;

    const rpcWorking = monitorResults.workingEndpoints;
    const rpcFailed = monitorResults.failedEndpoints || 0;
    const rpcTested = monitorResults.testedEndpoints;
    const rpcHealthPercent = rpcTested > 0 ? Math.round((rpcWorking / rpcTested) * 10000) / 100 : null;

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

  /**
   * Root endpoint with API information
   */
  fastify.get('/', async (request, reply) => {
    return {
      name: 'Chains API',
      version: '1.0.0',
      description: 'API query service for blockchain chain data from multiple sources',
      endpoints: {
        '/health': 'Health check and data status',
        '/chains': 'Get all chains (optional ?tag=Testnet|L2|Beacon)',
        '/chains/:id': 'Get chain by ID',
        '/search?q={query}': 'Search chains by name or ID',
        '/relations': 'Get all chain relations data',
        '/relations/:id': 'Get relations for a specific chain by ID',
        '/endpoints': 'Get all chain endpoints (RPC, firehose, substreams)',
        '/endpoints/:id': 'Get endpoints for a specific chain by ID',
        '/sources': 'Get data sources status',
        '/export': 'Export cached snapshot file',
        '/slip44': 'Get all SLIP-0044 coin types as JSON',
        '/slip44/:coinType': 'Get specific SLIP-0044 coin type by ID',
        '/reload': 'Reload data from sources (POST)',
        '/validate': 'Validate chain data for potential human errors',
        '/keywords': 'Get extracted keywords (blockchain names, network names, client names, etc.)',
        '/rpc-monitor': 'Get RPC endpoint monitoring results',
        '/rpc-monitor/:id': 'Get RPC monitoring results for a specific chain by ID',
        '/clients': 'Get aggregated client software (name, version, GitHub repo) across all chains',
        '/clients/:id': 'Get client software running on a specific chain by ID',
        '/stats': 'Get aggregate stats (chain counts, RPC health percentage)',
        '/relations/:id/graph?depth=N': 'BFS graph traversal of chain relations (default depth: 2)'
      },
      dataSources: [
        DATA_SOURCE_THE_GRAPH,
        DATA_SOURCE_CHAINLIST,
        DATA_SOURCE_CHAINS,
        DATA_SOURCE_SLIP44
      ]
    };
  });

  return fastify;
}

// Helper functions for reducing duplication

/**
 * Parse and validate an integer parameter
 * @param {string} param - Parameter value to parse
 * @param {string} paramName - Name of the parameter for error message
 * @returns {number|null} Parsed integer or null if invalid
 */
function parseIntParam(param, paramName = 'ID') {
  const parsed = Number.parseInt(param, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Send a standardized error response
 * @param {FastifyReply} reply - Fastify reply object
 * @param {number} code - HTTP status code
 * @param {string} message - Error message
 */
function sendError(reply, code, message) {
  return reply.code(code).send({ error: message });
}

// Only run the server if this file is executed directly (CLI mode)
// This allows the file to be imported for testing without starting the server
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

// Check if this file is being run directly
const isMainModule = process.argv[1] === __filename || process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const start = async () => {
    try {
      const app = await buildApp();
      await app.listen({ port: PORT, host: HOST });
      app.log.info(`Server is running at http://${HOST}:${PORT}`);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  };

  start();
}
