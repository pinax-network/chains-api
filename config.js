// Environment configuration with validation
// All configurable constants are centralized here

function parseIntEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    console.error(`Invalid value for ${name}: "${raw}" (expected integer). Using default: ${defaultValue}`);
    process.exit(1);
  }
  return parsed;
}

function parseStringEnv(name, defaultValue) {
  return process.env[name] || defaultValue;
}

function parseBooleanEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;

  const normalized = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;

  console.error(`Invalid value for ${name}: "${raw}" (expected boolean). Using default: ${defaultValue}`);
  process.exit(1);
}

// Server
export const PORT = parseIntEnv('PORT', 3000);
export const HOST = parseStringEnv('HOST', '0.0.0.0');
export const MCP_PORT = parseIntEnv('MCP_PORT', 3001);
export const MCP_HOST = parseStringEnv('MCP_HOST', '0.0.0.0');

// Request limits
export const BODY_LIMIT = parseIntEnv('BODY_LIMIT', 1048576); // 1 MB
export const MAX_PARAM_LENGTH = parseIntEnv('MAX_PARAM_LENGTH', 200);

// Rate limiting
export const RATE_LIMIT_MAX = parseIntEnv('RATE_LIMIT_MAX', 100);
export const RATE_LIMIT_WINDOW_MS = parseIntEnv('RATE_LIMIT_WINDOW_MS', 60000); // 1 minute
export const RELOAD_RATE_LIMIT_MAX = parseIntEnv('RELOAD_RATE_LIMIT_MAX', 5);
export const SEARCH_RATE_LIMIT_MAX = parseIntEnv('SEARCH_RATE_LIMIT_MAX', 30);

// RPC health check
export const RPC_CHECK_TIMEOUT_MS = parseIntEnv('RPC_CHECK_TIMEOUT_MS', 8000);
/**
 * @deprecated Unused since the unified rolling refresher (services/chainRefresher.js).
 * The new loop processes one chain per tick; each chain's RPC endpoints are
 * checked in parallel inside that chain's job. There is no global concurrency
 * cap. Kept for backwards-compatible env parsing; safe to remove in v2.
 */
export const RPC_CHECK_CONCURRENCY = parseIntEnv('RPC_CHECK_CONCURRENCY', 8);
export const MAX_ENDPOINTS_PER_CHAIN = parseIntEnv('MAX_ENDPOINTS_PER_CHAIN', 5);

// Search
export const MAX_SEARCH_QUERY_LENGTH = parseIntEnv('MAX_SEARCH_QUERY_LENGTH', 200);

// Data source URLs
export const DATA_SOURCE_THE_GRAPH = parseStringEnv(
  'DATA_SOURCE_THE_GRAPH',
  'https://raw.githubusercontent.com/Johnaverse/networks-registry/refs/heads/main/public/TheGraphNetworksRegistry.json'
);
export const DATA_SOURCE_CHAINLIST = parseStringEnv(
  'DATA_SOURCE_CHAINLIST',
  'https://chainlist.org/rpcs.json'
);
export const DATA_SOURCE_CHAINS = parseStringEnv(
  'DATA_SOURCE_CHAINS',
  'https://chainid.network/chains.json'
);
export const DATA_SOURCE_SLIP44 = parseStringEnv(
  'DATA_SOURCE_SLIP44',
  'https://raw.githubusercontent.com/satoshilabs/slips/master/slip-0044.md'
);
export const DATA_SOURCE_L2BEAT_API = parseStringEnv(
  'DATA_SOURCE_L2BEAT_API',
  'https://l2beat.com/api/scaling-summary'
);
export const L2BEAT_FETCH_TIMEOUT_MS = parseIntEnv('L2BEAT_FETCH_TIMEOUT_MS', 10000);
/**
 * @deprecated Cadence is now driven by the unified rolling refresher
 * (CHAIN_REFRESHER_TICK_MS × queue length). Kept so /scaling/status can keep
 * exposing the value as a hint to consumers, but no longer used for
 * scheduling. Safe to remove in v2 once consumers migrate to /refresher.
 */
export const L2BEAT_REFRESH_INTERVAL_MS = parseIntEnv('L2BEAT_REFRESH_INTERVAL_MS', 300000);

// Disk cache
export const DATA_CACHE_ENABLED = parseBooleanEnv('DATA_CACHE_ENABLED', true);
export const DATA_CACHE_FILE = parseStringEnv('DATA_CACHE_FILE', '.cache/chains-api-data.json');

// CORS
export const CORS_ORIGIN = parseStringEnv('CORS_ORIGIN', '*');

// Proxy (optional)
export const PROXY_URL = parseStringEnv('PROXY_URL', '');
export const PROXY_ENABLED = PROXY_URL !== '';

// Price cache
export const PRICE_CACHE_TTL_MS = parseIntEnv('PRICE_CACHE_TTL_MS', 3600000);
export const PRICE_NEGATIVE_CACHE_TTL_MS = parseIntEnv('PRICE_NEGATIVE_CACHE_TTL_MS', 300000);
export const PRICE_FETCH_TIMEOUT_MS = parseIntEnv('PRICE_FETCH_TIMEOUT_MS', 3000);
