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
    rule11_l2beat_stage_zero_high_tvs: errors.filter(e => e.rule === 11)
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
      rule11: errorsByRule.rule11_l2beat_stage_zero_high_tvs.length
    },
    allErrors: errors
  };
}
