import { getRpcMonitoringResults } from './dataService.js';
import { parseClientVersion } from './clientParser.js';

/**
 * Aggregate parsed client software across working RPC endpoints.
 *
 * When `chainId` is provided, returns a single summary object for that chain
 * (or null if no monitoring data exists for it). When omitted, returns an
 * array of summaries — one per chain with at least one working endpoint.
 *
 * Each summary:
 *   {
 *     chainId, chainName,
 *     totalNodes,              // working endpoints considered
 *     unknownNodes,            // working endpoints whose client didn't parse
 *     clients: [
 *       { name, repo, language, website, layer, known,
 *         nodeCount, versions: [{ version, nodeCount }, ...] }
 *     ]
 *   }
 *
 * @param {number} [chainId]
 * @returns {object | object[] | null}
 */
export function getClientsByChain(chainId) {
  const { results } = getRpcMonitoringResults();
  const working = results.filter(r => r.status === 'working');

  if (chainId !== undefined) {
    const chainResults = working.filter(r => r.chainId === chainId);
    if (chainResults.length === 0) return null;
    return summarizeChainClients(chainResults);
  }

  const byChain = new Map();
  for (const r of working) {
    if (!byChain.has(r.chainId)) byChain.set(r.chainId, []);
    byChain.get(r.chainId).push(r);
  }

  return Array.from(byChain.values())
    .map(summarizeChainClients)
    .filter(Boolean);
}

/**
 * Build a per-chain client summary from a list of endpoint results.
 * Parses `clientVersion` lazily via parseClientVersion. Non-working entries
 * are ignored. Assumes all entries share the same chainId. Returns null if
 * no working endpoints were supplied.
 */
export function summarizeChainClients(chainResults) {
  chainResults = chainResults.filter(r => r.status === 'working');
  if (chainResults.length === 0) return null;
  const { chainId, chainName } = chainResults[0];
  const byClient = new Map();
  let unknownNodes = 0;

  for (const r of chainResults) {
    const client = parseClientVersion(r.clientVersion);
    if (!client) {
      unknownNodes++;
      continue;
    }

    const key = client.name;
    let bucket = byClient.get(key);
    if (!bucket) {
      bucket = {
        name: client.name,
        repo: client.repo,
        language: client.language,
        website: client.website,
        layer: client.layer,
        known: client.known,
        nodeCount: 0,
        _versions: new Map()
      };
      byClient.set(key, bucket);
    }
    bucket.nodeCount++;

    const v = client.version ?? 'unknown';
    bucket._versions.set(v, (bucket._versions.get(v) ?? 0) + 1);
  }

  const clients = Array.from(byClient.values())
    .map(c => ({
      name: c.name,
      repo: c.repo,
      language: c.language,
      website: c.website,
      layer: c.layer,
      known: c.known,
      nodeCount: c.nodeCount,
      versions: Array.from(c._versions.entries())
        .map(([version, nodeCount]) => ({ version, nodeCount }))
        .sort((a, b) => b.nodeCount - a.nodeCount)
    }))
    .sort((a, b) => b.nodeCount - a.nodeCount);

  return {
    chainId,
    chainName,
    totalNodes: chainResults.length,
    unknownNodes,
    clients
  };
}
