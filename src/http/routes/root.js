import pkg from '../../../package.json' with { type: 'json' };
import {
  DATA_SOURCE_THE_GRAPH,
  DATA_SOURCE_CHAINLIST,
  DATA_SOURCE_CHAINS,
  DATA_SOURCE_SLIP44,
  DATA_SOURCE_L2BEAT_API
} from '../../../config.js';

const ENDPOINTS = {
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
  '/stats': 'Get aggregate stats (chain counts, RPC health percentage)',
  '/relations/:id/graph?depth=N': 'BFS graph traversal of chain relations (default depth: 2)',
  '/scaling': 'Get all chains with L2BEAT scaling data (stage, category, DA layer, TVS)',
  '/scaling/:id': 'Get L2BEAT scaling data for a specific chain by ID',
  '/scaling/status': 'Get L2BEAT refresher status (last refresh, source, errors)'
};

export async function rootRoute(fastify) {
  fastify.get('/', async () => ({
    name: 'Chains API',
    version: pkg.version,
    description: 'API query service for blockchain chain data from multiple sources',
    endpoints: ENDPOINTS,
    dataSources: [
      DATA_SOURCE_THE_GRAPH,
      DATA_SOURCE_CHAINLIST,
      DATA_SOURCE_CHAINS,
      DATA_SOURCE_SLIP44,
      DATA_SOURCE_L2BEAT_API
    ]
  }));
}
