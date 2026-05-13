import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_SOURCE_L2BEAT_API, L2BEAT_FETCH_TIMEOUT_MS } from '../../config.js';
import { proxyFetch } from '../../fetchUtil.js';
import { logger } from '../util/logger.js';

const __dir = dirname(fileURLToPath(import.meta.url));
const FALLBACK_PATH = join(__dir, '..', '..', 'data', 'l2beat-fallback.json');

/**
 * Fetch L2BEAT scaling-summary data, with graceful fallback to a checked-in
 * static snapshot when the live API is unreachable (403, timeout, network).
 *
 * Returns: { source: 'live'|'fallback'|'unavailable', fetchedAt, projects: [] }
 */
export async function fetchL2Beat() {
  const live = await fetchLive();
  if (live) return live;
  return loadFallback();
}

async function fetchLive() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), L2BEAT_FETCH_TIMEOUT_MS);
  try {
    const response = await proxyFetch(DATA_SOURCE_L2BEAT_API, { signal: controller.signal });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'L2BEAT live fetch failed; falling back to static snapshot');
      return null;
    }
    const json = await response.json();
    const projects = normalizeL2BeatResponse(json);
    return { source: 'live', fetchedAt: new Date().toISOString(), projects };
  } catch (err) {
    const reason = err.name === 'AbortError' ? `timeout after ${L2BEAT_FETCH_TIMEOUT_MS}ms` : err.message;
    logger.warn({ reason }, 'L2BEAT live fetch failed; falling back to static snapshot');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function loadFallback() {
  try {
    const raw = await readFile(FALLBACK_PATH, 'utf8');
    const data = JSON.parse(raw);
    const projects = Array.isArray(data?.projects) ? data.projects : [];
    return { source: 'fallback', fetchedAt: data?.fetchedAt ?? null, projects };
  } catch (err) {
    logger.warn({ err: err.message }, 'L2BEAT fallback unavailable');
    return { source: 'unavailable', fetchedAt: null, projects: [] };
  }
}

/**
 * Normalize L2BEAT's scaling-summary payload to a stable internal shape.
 * Defensive about field names because L2BEAT's site contract is undocumented.
 */
export function normalizeL2BeatResponse(json) {
  const projects = extractProjectsArray(json);

  return projects
    .map(normalizeProject)
    .filter(p => p.slug && p.chainId !== null && p.chainId !== undefined);
}

function extractProjectsArray(json) {
  if (Array.isArray(json?.projects)) return json.projects;
  if (Array.isArray(json?.data?.projects)) return json.data.projects;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json)) return json;
  return [];
}

function normalizeProject(p) {
  return {
    slug: p.slug ?? p.id ?? p.display?.slug ?? null,
    displayName: p.name ?? p.display?.name ?? p.displayName ?? null,
    chainId: extractChainId(p),
    category: p.category ?? p.type ?? null,
    stage: extractStage(p),
    stack: p.stack ?? p.providerName ?? p.display?.stack ?? null,
    daLayer: extractDaLayer(p),
    hostChainId: p.hostChain?.chainId ?? p.hostChainId ?? null,
    purposes: Array.isArray(p.purposes) ? p.purposes : [],
    tvs: extractTvs(p),
    tvsBreakdown: p.tvs?.breakdown ?? p.tvsBreakdown ?? null,
    activity: p.activity ?? null,
    links: p.links ?? p.display?.links ?? null,
    riskView: p.riskView ?? null,
    milestones: Array.isArray(p.milestones) ? p.milestones : null
  };
}

function extractChainId(p) {
  return p.chainId
    ?? p.chainConfig?.chainId
    ?? p.chains?.[0]?.chainId
    ?? p.eip155Id
    ?? null;
}

function extractStage(p) {
  if (typeof p.stage === 'string') return p.stage;
  if (typeof p.stage?.stage === 'string') return p.stage.stage;
  if (typeof p.stage?.value === 'string') return p.stage.value;
  return null;
}

function extractDaLayer(p) {
  if (typeof p.daLayer === 'string') return p.daLayer;
  if (typeof p.daLayer?.name === 'string') return p.daLayer.name;
  if (typeof p.dataAvailability?.layer === 'string') return p.dataAvailability.layer;
  return null;
}

function extractTvs(p) {
  if (typeof p.tvs === 'number') return p.tvs;
  if (typeof p.tvs?.total === 'number') return p.tvs.total;
  if (typeof p.tvs?.breakdown?.total === 'number') return p.tvs.breakdown.total;
  return null;
}
