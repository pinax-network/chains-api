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

function validateChain(chain, errors) {
  validateRule1RelationConflicts(chain, errors);
  validateRule2Slip44Mismatch(chain, errors);
  validateRule3NameTestnetMismatch(chain, errors);
  validateRule4SepoliaHoodie(chain, errors);
  const statuses = validateRule5StatusConflicts(chain, errors);
  validateRule6GoerliDeprecated(chain, statuses, errors);
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

  const errorsByRule = {
    rule1_relation_conflicts: errors.filter(e => e.rule === 1),
    rule2_slip44_testnet_mismatch: errors.filter(e => e.rule === 2),
    rule3_name_testnet_mismatch: errors.filter(e => e.rule === 3),
    rule4_sepolia_hoodie_issues: errors.filter(e => e.rule === 4),
    rule5_status_conflicts: errors.filter(e => e.rule === 5),
    rule6_goerli_not_deprecated: errors.filter(e => e.rule === 6)
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
      rule6: errorsByRule.rule6_goerli_not_deprecated.length
    },
    allErrors: errors
  };
}
