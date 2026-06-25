import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../util/logger.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dir, '..', '..', 'data', 'status-pages.json');

/**
 * Curated registry of operator status/incident pages, keyed by project.
 * Each entry's `url` applies to every chainId it lists (a single page
 * typically covers a project's mainnet plus its testnets, e.g. Base mainnet
 * and Base Sepolia both point at base-l2.statuspage.io).
 *
 * There is no upstream feed for this data, so the registry is maintained
 * by hand in data/status-pages.json — see CONTRIBUTING notes in that file's
 * PR. Loaded once at module init; the file ships with the image.
 */
function loadRegistry() {
  try {
    const parsed = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
    const pages = Array.isArray(parsed?.statusPages) ? parsed.statusPages : [];
    return pages.filter(p => p && typeof p.url === 'string' && Array.isArray(p.chainIds));
  } catch (err) {
    logger.warn({ err: err.message }, 'Status-page registry unavailable');
    return [];
  }
}

const STATUS_PAGES = loadRegistry();

// chainId -> { id, name, url } for O(1) lookups during indexing and queries.
const BY_CHAIN_ID = new Map();
for (const page of STATUS_PAGES) {
  for (const chainId of page.chainIds) {
    const id = Number(chainId);
    if (Number.isSafeInteger(id) && !BY_CHAIN_ID.has(id)) {
      BY_CHAIN_ID.set(id, { id: page.id, name: page.name, url: page.url });
    }
  }
}

/** All registry entries (project id, name, url, chainIds). */
export function getAllStatusPages() {
  return STATUS_PAGES;
}

/**
 * The status-page record covering a chain, or null. Shape:
 * { chainId, statusPage, project: { id, name } }
 */
export function getStatusPageByChainId(chainId) {
  const page = BY_CHAIN_ID.get(Number(chainId));
  if (!page) return null;
  return {
    chainId: Number(chainId),
    statusPage: page.url,
    project: { id: page.id, name: page.name }
  };
}

/**
 * Indexer pass: stamp each known chain with a `statusPage` URL. Static data,
 * so this is idempotent and safe to re-run on every index rebuild.
 */
export function attachStatusPages(indexed) {
  if (!indexed?.byChainId) return;
  for (const [chainId, page] of BY_CHAIN_ID) {
    const chain = indexed.byChainId[chainId];
    if (chain) chain.statusPage = page.url;
  }
}
