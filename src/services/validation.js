import { cachedData } from '../store/cache.js';

function getChainFromSource(chainId, source) {
  if (source === 'theGraph') {
    return cachedData.theGraph.networks?.find(n => {
      if (n.caip2Id) {
        const match = n.caip2Id.match(/^eip155:(\d+)$/);
        return match && Number.parseInt(match[1], 10) === chainId;
      }
      return false;
    });
  }
  if (source === 'chainlist') return cachedData.chainlist?.find(c => c.chainId === chainId);
  if (source === 'chains') return cachedData.chains?.find(c => c.chainId === chainId);
  return null;
}

function validateRule1RelationConflicts(chain, errors) {
  if (!chain.relations || chain.relations.length === 0) return;

  const graphRelations = chain.relations.filter(r => r.source === 'theGraph');

  graphRelations.forEach(graphRel => {
    if (graphRel.kind === 'testnetOf' && graphRel.chainId) {
      if (!chain.tags.includes('Testnet')) {
        errors.push({
          rule: 1,
          chainId: chain.chainId,
          chainName: chain.name,
          type: 'relation_tag_conflict',
          message: `Chain ${chain.chainId} (${chain.name}) has testnetOf relation but is not tagged as Testnet`,
          graphRelation: graphRel
        });
      }

      const chainlistChain = getChainFromSource(chain.chainId, 'chainlist');
      if (chainlistChain?.isTestnet === false) {
        errors.push({
          rule: 1,
          chainId: chain.chainId,
          chainName: chain.name,
          type: 'relation_source_conflict',
          message: `Chain ${chain.chainId} (${chain.name}) has testnetOf relation in theGraph but isTestnet=false in chainlist`,
          graphRelation: graphRel,
          chainlistData: { isTestnet: chainlistChain.isTestnet }
        });
      }
    }

    if (graphRel.kind === 'l2Of' && graphRel.chainId) {
      if (!chain.tags.includes('L2')) {
        errors.push({
          rule: 1,
          chainId: chain.chainId,
          chainName: chain.name,
          type: 'relation_tag_conflict',
          message: `Chain ${chain.chainId} (${chain.name}) has l2Of relation but is not tagged as L2`,
          graphRelation: graphRel
        });
      }
    }
  });
}

function validateRule2Slip44Mismatch(chain, errors) {
  const chainlistChain = getChainFromSource(chain.chainId, 'chainlist');
  const chainsChain = getChainFromSource(chain.chainId, 'chains');

  if (chainlistChain?.slip44 === 1 && chainlistChain.isTestnet === false) {
    errors.push({
      rule: 2,
      chainId: chain.chainId,
      chainName: chain.name,
      type: 'slip44_testnet_mismatch',
      message: `Chain ${chain.chainId} (${chain.name}) has slip44=1 (testnet indicator) but isTestnet=false in chainlist`,
      slip44: chainlistChain.slip44,
      isTestnet: chainlistChain.isTestnet
    });
  }

  if (chainsChain?.slip44 === 1 && !chain.tags.includes('Testnet')) {
    errors.push({
      rule: 2,
      chainId: chain.chainId,
      chainName: chain.name,
      type: 'slip44_testnet_mismatch',
      message: `Chain ${chain.chainId} (${chain.name}) has slip44=1 (testnet indicator) in chains.json but not tagged as Testnet`,
      slip44: chainsChain.slip44,
      tags: chain.tags
    });
  }
}

function validateRule3NameTestnetMismatch(chain, errors) {
  const fullName = chain.theGraph?.fullName || chain.name || '';
  const nameLower = fullName.toLowerCase();

  if ((nameLower.includes('testnet') || nameLower.includes('devnet')) && !chain.tags.includes('Testnet')) {
    errors.push({
      rule: 3,
      chainId: chain.chainId,
      chainName: chain.name,
      type: 'name_testnet_mismatch',
      message: `Chain ${chain.chainId} (${chain.name}) has "Testnet" or "Devnet" in full name "${fullName}" but not tagged as Testnet`,
      fullName,
      tags: chain.tags
    });
  }
}

function validateRule4SepoliaHoodie(chain, errors) {
  const fullName = chain.theGraph?.fullName || chain.name || '';
  const nameLower = fullName.toLowerCase();

  if (nameLower.includes('sepolia') || nameLower.includes('hoodie')) {
    const hasL2Tag = chain.tags.includes('L2');
    const hasRelations = chain.relations && chain.relations.length > 0;

    if (!hasL2Tag && !hasRelations) {
      errors.push({
        rule: 4,
        chainId: chain.chainId,
        chainName: chain.name,
        type: 'sepolia_hoodie_no_l2_or_relations',
        message: `Chain ${chain.chainId} (${chain.name}) contains "sepolia" or "hoodie" but not tagged as L2 and has no relations`,
        fullName,
        tags: chain.tags,
        relations: chain.relations
      });
    }
  }
}

function validateRule5StatusConflicts(chain, errors) {
  const chainlistChain = getChainFromSource(chain.chainId, 'chainlist');
  const chainsChain = getChainFromSource(chain.chainId, 'chains');

  const statuses = [];
  if (chainlistChain?.status) statuses.push({ source: 'chainlist', status: chainlistChain.status });
  if (chainsChain?.status) statuses.push({ source: 'chains', status: chainsChain.status });

  const deprecatedInSources = statuses.filter(s => s.status === 'deprecated');
  const activeInSources = statuses.filter(s => s.status === 'active');

  if (deprecatedInSources.length > 0 && activeInSources.length > 0) {
    errors.push({
      rule: 5,
      chainId: chain.chainId,
      chainName: chain.name,
      type: 'status_conflict',
      message: `Chain ${chain.chainId} (${chain.name}) has conflicting status across sources`,
      statuses
    });
  }

  return statuses;
}

function validateRule6GoerliDeprecated(chain, statuses, errors) {
  const fullName = chain.theGraph?.fullName || chain.name || '';
  const nameLower = fullName.toLowerCase();

  if (!nameLower.includes('goerli')) return;

  const chainlistChain = getChainFromSource(chain.chainId, 'chainlist');
  const chainsChain = getChainFromSource(chain.chainId, 'chains');

  const isDeprecated = chain.status === 'deprecated' ||
    chainlistChain?.status === 'deprecated' ||
    chainsChain?.status === 'deprecated';

  if (!isDeprecated) {
    errors.push({
      rule: 6,
      chainId: chain.chainId,
      chainName: chain.name,
      type: 'goerli_not_deprecated',
      message: `Chain ${chain.chainId} (${chain.name}) contains "Goerli" but is not marked as deprecated`,
      fullName,
      status: chain.status,
      statusInSources: statuses
    });
  }
}

function validateRule7L2BeatMissingClassification(chain, errors) {
  if (!chain.l2Beat) return;

  // L2BEAT classifies the chain as a scaling solution. If no other source has
  // also marked it (via an l2Of/testnetOf relation from theGraph or chains),
  // then L2BEAT is alone — the upstream chain registries may be stale.
  const otherSourceConfirms = (chain.relations || []).some(r =>
    (r.kind === 'l2Of' || r.kind === 'testnetOf') &&
    (r.source === 'theGraph' || r.source === 'chains')
  );

  if (!otherSourceConfirms) {
    errors.push({
      rule: 7,
      chainId: chain.chainId,
      chainName: chain.name,
      type: 'l2beat_missing_classification',
      message: `Chain ${chain.chainId} (${chain.name}) is classified by L2BEAT (stage: ${chain.l2Beat.stage || 'n/a'}, category: ${chain.l2Beat.category || 'n/a'}) but no l2Of/testnetOf relation from theGraph or chains confirms it`,
      l2BeatStage: chain.l2Beat.stage,
      l2BeatCategory: chain.l2Beat.category,
      l2BeatSlug: chain.l2Beat.slug
    });
  }
}

function validateRule8L2BeatHostChainNoRelation(chain, errors) {
  if (!chain.l2Beat?.hostChainId) return;

  const hostId = chain.l2Beat.hostChainId;
  const matchingRelation = (chain.relations || []).find(r =>
    (r.kind === 'l2Of' || r.kind === 'testnetOf') && r.chainId === hostId
  );

  if (!matchingRelation) {
    errors.push({
      rule: 8,
      chainId: chain.chainId,
      chainName: chain.name,
      type: 'l2beat_hostchain_no_relation',
      message: `Chain ${chain.chainId} (${chain.name}) has L2BEAT hostChainId=${hostId} but no l2Of/testnetOf relation pointing to it`,
      l2BeatHostChainId: hostId,
      existingRelationTargets: (chain.relations || [])
        .filter(r => r.kind === 'l2Of' || r.kind === 'testnetOf')
        .map(r => ({ kind: r.kind, chainId: r.chainId }))
    });
  }
}

function validateRule9L2BeatCategoryNameMismatch(chain, errors) {
  if (!chain.l2Beat?.category) return;

  const fullName = (chain.l2Beat.displayName || chain.theGraph?.fullName || chain.name || '').toLowerCase();
  const category = chain.l2Beat.category.toLowerCase();

  const nameLooksZk = fullName.includes('zk') || fullName.includes('zero-knowledge');
  const nameLooksOptimistic = fullName.includes('optimistic') || fullName.includes('optimism');

  let mismatchReason = null;
  if (category.includes('zk') && nameLooksOptimistic && !nameLooksZk) {
    mismatchReason = `L2BEAT category "${chain.l2Beat.category}" but name suggests optimistic`;
  } else if (category.includes('optimistic') && nameLooksZk && !nameLooksOptimistic) {
    mismatchReason = `L2BEAT category "${chain.l2Beat.category}" but name suggests ZK`;
  }

  if (mismatchReason) {
    errors.push({
      rule: 9,
      chainId: chain.chainId,
      chainName: chain.name,
      type: 'l2beat_category_name_mismatch',
      message: `Chain ${chain.chainId} (${chain.name}): ${mismatchReason}`,
      l2BeatCategory: chain.l2Beat.category,
      fullName: chain.l2Beat.displayName || chain.theGraph?.fullName || chain.name
    });
  }
}

const L2BEAT_HIGH_TVS_THRESHOLD_USD = 1_000_000_000;

function validateRule11L2BeatStageZeroHighTvs(chain, errors) {
  if (!chain.l2Beat) return;
  if (chain.l2Beat.stage !== 'Stage 0') return;
  if (typeof chain.l2Beat.tvs !== 'number') return;
  if (chain.l2Beat.tvs < L2BEAT_HIGH_TVS_THRESHOLD_USD) return;

  errors.push({
    rule: 11,
    chainId: chain.chainId,
    chainName: chain.name,
    type: 'l2beat_stage_zero_high_tvs',
    message: `Chain ${chain.chainId} (${chain.name}) has Stage 0 classification but TVS of $${(chain.l2Beat.tvs / 1e9).toFixed(2)}B — risk signal worth surfacing`,
    l2BeatStage: chain.l2Beat.stage,
    l2BeatTvs: chain.l2Beat.tvs
  });
}

/**
 * Rule 10 is global: iterates over L2BEAT's raw project list rather than
 * per-chain, so it can flag projects whose chainId isn't in our registry.
 */
function validateRule10L2BeatUnknownChains(errors) {
  const projects = cachedData.l2beat?.projects;
  if (!Array.isArray(projects) || projects.length === 0) return;

  for (const project of projects) {
    if (project.chainId === null || project.chainId === undefined) continue;
    if (cachedData.indexed.byChainId[project.chainId]) continue;

    errors.push({
      rule: 10,
      chainId: project.chainId,
      chainName: project.displayName,
      type: 'l2beat_unknown_chain',
      message: `L2BEAT lists chainId ${project.chainId} (${project.displayName || project.slug}) but it's not in our chain registry`,
      l2BeatSlug: project.slug,
      l2BeatStage: project.stage,
      l2BeatCategory: project.category
    });
  }
}

const RPC_BLOCK_HEIGHT_DRIFT_THRESHOLD = 100;

function validateRule12RpcBlockHeightDrift(chain, errors) {
  const results = cachedData.rpcHealth?.[chain.chainId];
  if (!Array.isArray(results) || results.length < 2) return;

  const heights = results
    .filter(r => r.ok && typeof r.blockHeight === 'number')
    .map(r => ({ url: r.url, blockHeight: r.blockHeight }));

  if (heights.length < 2) return;

  let min = heights[0];
  let max = heights[0];
  for (const h of heights) {
    if (h.blockHeight < min.blockHeight) min = h;
    if (h.blockHeight > max.blockHeight) max = h;
  }

  const drift = max.blockHeight - min.blockHeight;
  if (drift > RPC_BLOCK_HEIGHT_DRIFT_THRESHOLD) {
    errors.push({
      rule: 12,
      chainId: chain.chainId,
      chainName: chain.name,
      type: 'rpc_block_height_drift',
      message: `Chain ${chain.chainId} (${chain.name}) has working RPC endpoints reporting block heights ${drift} blocks apart — likely a stuck or forked endpoint`,
      drift,
      threshold: RPC_BLOCK_HEIGHT_DRIFT_THRESHOLD,
      laggingEndpoint: min,
      leadingEndpoint: max
    });
  }
}

function normalizeChainName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\bmainnet\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function validateRule13NameDisagreement(chain, errors) {
  if (!chain.theGraph?.fullName) return;
  if (!Array.isArray(chain.sources) || !chain.sources.includes('chains')) return;

  const chainsName = chain.name;
  const theGraphName = chain.theGraph.fullName;

  const a = normalizeChainName(chainsName);
  const b = normalizeChainName(theGraphName);

  if (!a || !b || a === b) return;
  if (a.includes(b) || b.includes(a)) return;

  errors.push({
    rule: 13,
    chainId: chain.chainId,
    chainName: chain.name,
    type: 'name_disagreement',
    message: `Chain ${chain.chainId}: chains.json name "${chainsName}" disagrees with theGraph fullName "${theGraphName}"`,
    chainsName,
    theGraphName
  });
}

function validateRule14NativeCurrencyMismatch(chain, errors) {
  const chainsSymbol = chain.nativeCurrency?.symbol;
  const theGraphSymbol = chain.theGraph?.nativeToken;

  if (!chainsSymbol || !theGraphSymbol) return;
  if (chainsSymbol.toUpperCase() === theGraphSymbol.toUpperCase()) return;

  errors.push({
    rule: 14,
    chainId: chain.chainId,
    chainName: chain.name,
    type: 'native_currency_mismatch',
    message: `Chain ${chain.chainId} (${chain.name}): native currency symbol mismatch — chains.json="${chainsSymbol}", theGraph="${theGraphSymbol}"`,
    chainsSymbol,
    theGraphSymbol
  });
}

function validateRule15Slip44NativeSymbolMismatch(chain, errors) {
  const slip44Symbol = chain.slip44Info?.symbol;
  const nativeSymbol = chain.nativeCurrency?.symbol;

  if (!slip44Symbol || !nativeSymbol) return;
  if (slip44Symbol.toUpperCase() === nativeSymbol.toUpperCase()) return;

  errors.push({
    rule: 15,
    chainId: chain.chainId,
    chainName: chain.name,
    type: 'slip44_native_symbol_mismatch',
    message: `Chain ${chain.chainId} (${chain.name}): SLIP-44 symbol "${slip44Symbol}" disagrees with native currency symbol "${nativeSymbol}"`,
    slip44Symbol,
    nativeSymbol,
    slip44CoinType: chain.slip44Info?.coinType
  });
}

function extractRpcUrls(rpcArray) {
  if (!Array.isArray(rpcArray)) return new Set();
  return new Set(
    rpcArray
      .map(r => (typeof r === 'string' ? r : r?.url))
      .filter(url => typeof url === 'string' && url.length > 0)
  );
}

function rawSourceRpcUrls(chainId, source) {
  const raw = source === 'chains' ? cachedData.chains : cachedData.chainlist;
  if (!Array.isArray(raw)) return new Set();
  const entry = raw.find(c => c?.chainId === chainId);
  return extractRpcUrls(entry?.rpc);
}

function isUrlHealthy(chainId, url) {
  const results = cachedData.rpcHealth?.[chainId];
  if (!Array.isArray(results)) return false;
  return results.some(r => r.url === url && r.ok);
}

function validateRule16RpcUrlInOneSourceOnly(chain, errors) {
  if (!Array.isArray(chain.sources)) return;
  if (!chain.sources.includes('chainlist') || !chain.sources.includes('chains')) return;

  const chainlistUrls = rawSourceRpcUrls(chain.chainId, 'chainlist');
  const chainsUrls = rawSourceRpcUrls(chain.chainId, 'chains');
  if (chainlistUrls.size === 0 || chainsUrls.size === 0) return;

  const onlyInChainlistHealthy = [];
  for (const url of chainlistUrls) {
    if (!chainsUrls.has(url) && isUrlHealthy(chain.chainId, url)) {
      onlyInChainlistHealthy.push(url);
    }
  }
  const onlyInChainsHealthy = [];
  for (const url of chainsUrls) {
    if (!chainlistUrls.has(url) && isUrlHealthy(chain.chainId, url)) {
      onlyInChainsHealthy.push(url);
    }
  }

  if (onlyInChainlistHealthy.length === 0 && onlyInChainsHealthy.length === 0) return;

  errors.push({
    rule: 16,
    chainId: chain.chainId,
    chainName: chain.name,
    type: 'rpc_url_in_one_source_only',
    message: `Chain ${chain.chainId} (${chain.name}) has healthy RPC URLs present in one source only — the other source may need updating`,
    onlyInChainlistHealthy,
    onlyInChainsHealthy
  });
}

function validateChain(chain, errors) {
  validateRule1RelationConflicts(chain, errors);
  validateRule2Slip44Mismatch(chain, errors);
  validateRule3NameTestnetMismatch(chain, errors);
  validateRule4SepoliaHoodie(chain, errors);
  const statuses = validateRule5StatusConflicts(chain, errors);
  validateRule6GoerliDeprecated(chain, statuses, errors);
  validateRule7L2BeatMissingClassification(chain, errors);
  validateRule8L2BeatHostChainNoRelation(chain, errors);
  validateRule9L2BeatCategoryNameMismatch(chain, errors);
  validateRule11L2BeatStageZeroHighTvs(chain, errors);
  validateRule12RpcBlockHeightDrift(chain, errors);
  validateRule13NameDisagreement(chain, errors);
  validateRule14NativeCurrencyMismatch(chain, errors);
  validateRule15Slip44NativeSymbolMismatch(chain, errors);
  validateRule16RpcUrlInOneSourceOnly(chain, errors);
}

export function validateChainData() {
  if (!cachedData.indexed || !cachedData.theGraph || !cachedData.chainlist || !cachedData.chains) {
    return {
      error: 'Data not loaded. Please reload data sources first.',
      errors: []
    };
  }

  const errors = [];

  Object.values(cachedData.indexed.byChainId).forEach(chain => {
    validateChain(chain, errors);
  });

  // Rule 10 is global (iterates L2BEAT projects, not chains).
  validateRule10L2BeatUnknownChains(errors);

  const errorsByRule = {
    rule1_relation_conflicts: errors.filter(e => e.rule === 1),
    rule2_slip44_testnet_mismatch: errors.filter(e => e.rule === 2),
    rule3_name_testnet_mismatch: errors.filter(e => e.rule === 3),
    rule4_sepolia_hoodie_issues: errors.filter(e => e.rule === 4),
    rule5_status_conflicts: errors.filter(e => e.rule === 5),
    rule6_goerli_not_deprecated: errors.filter(e => e.rule === 6),
    rule7_l2beat_missing_classification: errors.filter(e => e.rule === 7),
    rule8_l2beat_hostchain_no_relation: errors.filter(e => e.rule === 8),
    rule9_l2beat_category_name_mismatch: errors.filter(e => e.rule === 9),
    rule10_l2beat_unknown_chains: errors.filter(e => e.rule === 10),
    rule11_l2beat_stage_zero_high_tvs: errors.filter(e => e.rule === 11),
    rule12_rpc_block_height_drift: errors.filter(e => e.rule === 12),
    rule13_name_disagreement: errors.filter(e => e.rule === 13),
    rule14_native_currency_mismatch: errors.filter(e => e.rule === 14),
    rule15_slip44_native_symbol_mismatch: errors.filter(e => e.rule === 15),
    rule16_rpc_url_in_one_source_only: errors.filter(e => e.rule === 16)
  };

  return {
    totalErrors: errors.length,
    errorsByRule,
    summary: {
      rule1: errorsByRule.rule1_relation_conflicts.length,
      rule2: errorsByRule.rule2_slip44_testnet_mismatch.length,
      rule3: errorsByRule.rule3_name_testnet_mismatch.length,
      rule4: errorsByRule.rule4_sepolia_hoodie_issues.length,
      rule5: errorsByRule.rule5_status_conflicts.length,
      rule6: errorsByRule.rule6_goerli_not_deprecated.length,
      rule7: errorsByRule.rule7_l2beat_missing_classification.length,
      rule8: errorsByRule.rule8_l2beat_hostchain_no_relation.length,
      rule9: errorsByRule.rule9_l2beat_category_name_mismatch.length,
      rule10: errorsByRule.rule10_l2beat_unknown_chains.length,
      rule11: errorsByRule.rule11_l2beat_stage_zero_high_tvs.length,
      rule12: errorsByRule.rule12_rpc_block_height_drift.length,
      rule13: errorsByRule.rule13_name_disagreement.length,
      rule14: errorsByRule.rule14_native_currency_mismatch.length,
      rule15: errorsByRule.rule15_slip44_native_symbol_mismatch.length,
      rule16: errorsByRule.rule16_rpc_url_in_one_source_only.length
    },
    allErrors: errors
  };
}
