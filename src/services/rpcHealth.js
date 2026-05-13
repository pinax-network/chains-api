import { jsonRpcCall } from '../../rpcUtil.js';
import { RPC_CHECK_TIMEOUT_MS, RPC_CHECK_CONCURRENCY } from '../../config.js';
import { logger } from '../util/logger.js';
import { incCounter } from '../util/metrics.js';
import { cachedData } from '../store/cache.js';
import { getAllEndpoints } from '../store/queries.js';
import {
  getRpcCheckInProgress,
  setRpcCheckInProgress,
  getRpcCheckPending,
  setRpcCheckPending
} from './rpcHealthState.js';

export function getRpcMonitoringStatus() {
  return {
    isMonitoring: getRpcCheckInProgress(),
    lastUpdated: cachedData.lastRpcCheck
  };
}

function normalizeRpcUrl(rpcEntry) {
  if (!rpcEntry) return null;
  if (typeof rpcEntry === 'string') return rpcEntry;
  if (typeof rpcEntry === 'object' && rpcEntry.url) return rpcEntry.url;
  return null;
}

function parseBlockHeight(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    if (value.startsWith('0x')) {
      const parsed = Number.parseInt(value, 16);
      return Number.isNaN(parsed) ? null : parsed;
    }
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

async function checkRpcEndpoint(url) {
  const result = {
    url,
    ok: false,
    clientVersion: null,
    blockHeight: null,
    error: null
  };

  if (!url?.startsWith('http')) {
    result.error = 'Unsupported RPC URL';
    return result;
  }

  if (url.includes('${')) {
    result.error = 'RPC URL requires API key substitution';
    return result;
  }

  try {
    const [clientVersion, blockNumber] = await Promise.all([
      jsonRpcCall(url, 'web3_clientVersion', { timeoutMs: RPC_CHECK_TIMEOUT_MS }),
      jsonRpcCall(url, 'eth_blockNumber', { timeoutMs: RPC_CHECK_TIMEOUT_MS })
    ]);

    result.clientVersion = clientVersion || null;
    result.blockHeight = parseBlockHeight(blockNumber);
    result.ok = Boolean(result.clientVersion) && result.blockHeight !== null;
  } catch (error) {
    result.error = error.message;
  }

  return result;
}

export async function runRpcHealthCheck() {
  if (!cachedData.indexed) {
    logger.warn('RPC health check skipped: data not loaded');
    return;
  }

  const dataVersion = cachedData.lastUpdated;
  const endpoints = getAllEndpoints();
  const tasks = [];
  const results = {};

  endpoints.forEach(({ chainId, rpc }) => {
    const normalizedUrls = (rpc || []).map(normalizeRpcUrl).filter(Boolean);
    const validUrls = Array.from(new Set(normalizedUrls)).filter(url => url.startsWith('http'));

    if (validUrls.length === 0) return;

    validUrls.forEach(url => tasks.push({ chainId, url }));
    if (!results[chainId]) results[chainId] = [];
  });

  cachedData.rpcHealth = {};
  cachedData.lastRpcCheck = null;

  if (tasks.length === 0) {
    logger.warn('RPC health check skipped: no RPC endpoints found');
    return;
  }

  let taskIndex = 0;
  const worker = async () => {
    while (taskIndex < tasks.length) {
      const current = taskIndex++;
      const task = tasks[current];
      const status = await checkRpcEndpoint(task.url);

      if (!results[task.chainId]) results[task.chainId] = [];
      results[task.chainId].push(status);
    }
  };

  const workerCount = Math.min(RPC_CHECK_CONCURRENCY, tasks.length);
  const workers = Array.from({ length: workerCount }, worker);
  await Promise.all(workers);

  if (cachedData.lastUpdated !== dataVersion) {
    logger.warn('RPC health check skipped: data changed during run');
    return;
  }

  cachedData.rpcHealth = results;
  cachedData.lastRpcCheck = new Date().toISOString();
  logger.info(
    { endpointsTested: tasks.length, chainsChecked: Object.keys(results).length },
    'RPC health check completed'
  );
  incCounter('chains_api_rpc_check_total', { outcome: 'completed' });
}

export function startRpcHealthCheck() {
  if (getRpcCheckInProgress()) {
    setRpcCheckPending(true);
    return;
  }

  setRpcCheckInProgress(true);
  setRpcCheckPending(false);
  runRpcHealthCheck()
    .catch(error => {
      logger.error({ err: error.message || error }, 'RPC health check failed');
      incCounter('chains_api_rpc_check_total', { outcome: 'error' });
    })
    .finally(() => {
      setRpcCheckInProgress(false);
      if (getRpcCheckPending()) {
        startRpcHealthCheck();
      }
    });
}
