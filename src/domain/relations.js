import { cachedData } from '../store/cache.js';

const ALLOWED_KINDS = new Set(['l2Of', 'parentOf', 'testnetOf', 'mainnetOf']);

export function getAllRelations() {
  if (!cachedData.indexed) return {};

  const allRelations = {};

  cachedData.indexed.all.forEach(chain => {
    if (!chain.relations?.length) return;

    chain.relations.forEach(relation => {
      if (!ALLOWED_KINDS.has(relation.kind) || relation.chainId === undefined) return;

      let kind = relation.kind === 'parentOf' ? 'l1Of' : relation.kind;

      let parentChainId, childChainId, parentName, childName;
      if (kind === 'l1Of' || kind === 'mainnetOf') {
        parentChainId = chain.chainId;
        childChainId = relation.chainId;
        parentName = chain.name;
        const childChain = cachedData.indexed.byChainId[childChainId];
        childName = childChain ? childChain.name : relation.network;
      } else {
        childChainId = chain.chainId;
        parentChainId = relation.chainId;
        childName = chain.name;
        const parentChain = cachedData.indexed.byChainId[parentChainId];
        parentName = parentChain ? parentChain.name : relation.network;
      }

      const parentKey = String(parentChainId);
      const childKey = String(childChainId);

      if (!allRelations[parentKey]) allRelations[parentKey] = {};

      allRelations[parentKey][childKey] = {
        parentName,
        kind,
        childName,
        chainId: childChainId,
        source: relation.source
      };
    });
  });

  return allRelations;
}

export function getRelationsById(chainId) {
  if (!cachedData.indexed) return null;

  const chain = cachedData.indexed.byChainId[chainId];
  if (!chain) return null;

  return {
    chainId: chain.chainId,
    chainName: chain.name,
    relations: chain.relations || []
  };
}

function collectRelationEdges(chain, chainId, depth, visited, edges, queue, seenEdges) {
  const relations = chain.relations || [];
  for (const rel of relations) {
    if (rel.chainId === undefined) continue;

    // Deduplicate bidirectional edges (A→B and B→A with same kind).
    const a = Math.min(chainId, rel.chainId);
    const b = Math.max(chainId, rel.chainId);
    const edgeKey = `${a}-${b}-${rel.kind}`;
    if (!seenEdges.has(edgeKey)) {
      seenEdges.add(edgeKey);
      edges.push({
        from: chainId,
        to: rel.chainId,
        kind: rel.kind,
        source: rel.source
      });
    }

    if (!visited.has(rel.chainId)) {
      queue.push({ chainId: rel.chainId, depth: depth + 1 });
    }
  }
}

export function traverseRelations(startChainId, maxDepth = 2) {
  if (!cachedData.indexed) return null;

  const startChain = cachedData.indexed.byChainId[startChainId];
  if (!startChain) return null;

  const visited = new Set();
  const seenEdges = new Set();
  const queue = [{ chainId: startChainId, depth: 0 }];
  const nodes = [];
  const edges = [];

  while (queue.length > 0) {
    const { chainId, depth } = queue.shift();
    if (visited.has(chainId)) continue;
    visited.add(chainId);

    const chain = cachedData.indexed.byChainId[chainId];
    if (!chain) continue;

    nodes.push({
      chainId: chain.chainId,
      name: chain.name,
      tags: chain.tags || [],
      depth
    });

    if (depth < maxDepth) {
      collectRelationEdges(chain, chainId, depth, visited, edges, queue, seenEdges);
    }
  }

  return {
    startChainId,
    startChainName: startChain.name,
    maxDepth,
    totalNodes: nodes.length,
    totalEdges: edges.length,
    nodes,
    edges
  };
}
