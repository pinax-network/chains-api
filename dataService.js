// Backwards-compatible facade. Implementation lives under src/.
// New code should import from the per-domain modules directly.

export { fetchData } from './src/transport/fetch.js';
export { parseSLIP44 } from './src/sources/slip44.js';
export { indexData } from './src/store/indexer.js';
export { getCachedData } from './src/store/cache.js';
export {
  searchChains,
  getChainById,
  getAllChains,
  countChainsByTag,
  getEndpointsById,
  getAllEndpoints,
  getRpcMonitoringResults
} from './src/store/queries.js';
export {
  runRpcHealthCheck,
  startRpcHealthCheck,
  getRpcMonitoringStatus
} from './src/services/rpcHealth.js';
export { getAllKeywords } from './src/domain/keywords.js';
export {
  getAllRelations,
  getRelationsById,
  traverseRelations
} from './src/domain/relations.js';
export { validateChainData } from './src/services/validation.js';
export { loadData, initializeDataOnStartup } from './src/services/loader.js';
