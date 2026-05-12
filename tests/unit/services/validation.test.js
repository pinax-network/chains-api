import { describe, it, expect, beforeEach } from 'vitest';
import { applyDataToCache, cachedData } from '../../../src/store/cache.js';
import { validateChainData } from '../../../src/services/validation.js';

/**
 * validateChainData() short-circuits to an error when any of the 3 upstream
 * sources are absent. To exercise the L2BEAT rules in isolation we have to
 * seed all of theGraph + chainlist + chains, even if they don't matter for
 * the specific rule under test.
 */
function seedCache({ chains, l2beatProjects = null }) {
  const byChainId = {};
  for (const c of chains) byChainId[c.chainId] = c;

  applyDataToCache({
    theGraph: { networks: [] },
    chainlist: [],
    chains: [],
    slip44: {},
    l2beat: l2beatProjects
      ? { source: 'live', fetchedAt: '2026-05-05T00:00:00.000Z', projects: l2beatProjects }
      : null,
    indexed: {
      byChainId,
      byName: {},
      all: chains
    },
    lastUpdated: '2026-05-05T00:00:00.000Z'
  });
  cachedData.indexed.all = Object.values(cachedData.indexed.byChainId);
}

function findErrorsForRule(report, ruleNumber) {
  return report.allErrors.filter(e => e.rule === ruleNumber);
}

describe('validation — L2BEAT cross-source rules', () => {
  beforeEach(() => {
    applyDataToCache({});
  });

  describe('rule 7: l2beat_missing_classification', () => {
    it('flags chains classified by L2BEAT but with no l2Of/testnetOf relation from other sources', () => {
      seedCache({
        chains: [{
          chainId: 42161,
          name: 'Arbitrum One',
          tags: ['L2'],
          relations: [],
          l2Beat: { slug: 'arbitrum', stage: 'Stage 1', category: 'Optimistic Rollup' }
        }]
      });
      const report = validateChainData();
      const errs = findErrorsForRule(report, 7);
      expect(errs).toHaveLength(1);
      expect(errs[0].l2BeatSlug).toBe('arbitrum');
    });

    it('does NOT flag chains with a corroborating l2Of relation from theGraph or chains', () => {
      seedCache({
        chains: [{
          chainId: 42161,
          name: 'Arbitrum One',
          tags: ['L2'],
          relations: [{ kind: 'l2Of', chainId: 1, source: 'theGraph' }],
          l2Beat: { slug: 'arbitrum', stage: 'Stage 1', category: 'Optimistic Rollup' }
        }]
      });
      expect(findErrorsForRule(validateChainData(), 7)).toHaveLength(0);
    });

    it('does NOT flag chains without any L2BEAT data', () => {
      seedCache({
        chains: [{ chainId: 1, name: 'Ethereum', tags: [], relations: [] }]
      });
      expect(findErrorsForRule(validateChainData(), 7)).toHaveLength(0);
    });
  });

  describe('rule 8: l2beat_hostchain_no_relation', () => {
    it('flags chains where L2BEAT hostChainId has no matching l2Of/testnetOf relation', () => {
      seedCache({
        chains: [{
          chainId: 42161,
          name: 'Arbitrum One',
          tags: ['L2'],
          relations: [{ kind: 'l2Of', chainId: 999, source: 'theGraph' }],
          l2Beat: { slug: 'arbitrum', hostChainId: 1 }
        }]
      });
      const errs = findErrorsForRule(validateChainData(), 8);
      expect(errs).toHaveLength(1);
      expect(errs[0].l2BeatHostChainId).toBe(1);
    });

    it('does NOT flag chains where a relation points to hostChainId', () => {
      seedCache({
        chains: [{
          chainId: 42161,
          name: 'Arbitrum One',
          tags: ['L2'],
          relations: [{ kind: 'l2Of', chainId: 1, source: 'theGraph' }],
          l2Beat: { slug: 'arbitrum', hostChainId: 1 }
        }]
      });
      expect(findErrorsForRule(validateChainData(), 8)).toHaveLength(0);
    });
  });

  describe('rule 9: l2beat_category_name_mismatch', () => {
    it('flags ZK category with optimistic-sounding name', () => {
      seedCache({
        chains: [{
          chainId: 999,
          name: 'Optimistic Rollup Project',
          tags: ['L2'],
          relations: [{ kind: 'l2Of', chainId: 1, source: 'theGraph' }],
          l2Beat: {
            slug: 'something',
            displayName: 'Optimistic Rollup Project',
            category: 'ZK Rollup',
            hostChainId: 1
          }
        }]
      });
      const errs = findErrorsForRule(validateChainData(), 9);
      expect(errs).toHaveLength(1);
      expect(errs[0].l2BeatCategory).toBe('ZK Rollup');
    });

    it('does NOT flag matching category/name', () => {
      seedCache({
        chains: [{
          chainId: 324,
          name: 'ZKsync Era',
          tags: ['L2'],
          relations: [{ kind: 'l2Of', chainId: 1, source: 'theGraph' }],
          l2Beat: {
            slug: 'zksync-era',
            displayName: 'ZKsync Era',
            category: 'ZK Rollup',
            hostChainId: 1
          }
        }]
      });
      expect(findErrorsForRule(validateChainData(), 9)).toHaveLength(0);
    });
  });

  describe('rule 10: l2beat_unknown_chains', () => {
    it('flags L2BEAT projects whose chainId is not in our registry', () => {
      seedCache({
        chains: [{
          chainId: 42161,
          name: 'Arbitrum One',
          tags: ['L2'],
          relations: [{ kind: 'l2Of', chainId: 1, source: 'theGraph' }],
          l2Beat: { slug: 'arbitrum', hostChainId: 1 }
        }],
        l2beatProjects: [
          { slug: 'arbitrum', chainId: 42161, displayName: 'Arbitrum One' },
          { slug: 'brand-new-l2', chainId: 999888, displayName: 'Brand New L2', stage: 'Stage 0' }
        ]
      });
      const errs = findErrorsForRule(validateChainData(), 10);
      expect(errs).toHaveLength(1);
      expect(errs[0].chainId).toBe(999888);
      expect(errs[0].l2BeatSlug).toBe('brand-new-l2');
    });

    it('emits nothing when every L2BEAT project maps to a known chainId', () => {
      seedCache({
        chains: [{
          chainId: 42161,
          name: 'Arbitrum One',
          tags: ['L2'],
          relations: [{ kind: 'l2Of', chainId: 1, source: 'theGraph' }],
          l2Beat: { slug: 'arbitrum', hostChainId: 1 }
        }],
        l2beatProjects: [{ slug: 'arbitrum', chainId: 42161, displayName: 'Arbitrum One' }]
      });
      expect(findErrorsForRule(validateChainData(), 10)).toHaveLength(0);
    });

    it('emits nothing when l2beat cache is unavailable', () => {
      seedCache({
        chains: [{ chainId: 1, name: 'Ethereum', tags: [], relations: [] }],
        l2beatProjects: null
      });
      expect(findErrorsForRule(validateChainData(), 10)).toHaveLength(0);
    });
  });

  describe('rule 11: l2beat_stage_zero_high_tvs', () => {
    it('flags Stage 0 chains with TVS > $1B', () => {
      seedCache({
        chains: [{
          chainId: 81457,
          name: 'Blast',
          tags: ['L2'],
          relations: [{ kind: 'l2Of', chainId: 1, source: 'theGraph' }],
          l2Beat: { slug: 'blast', stage: 'Stage 0', tvs: 2_500_000_000, hostChainId: 1 }
        }]
      });
      const errs = findErrorsForRule(validateChainData(), 11);
      expect(errs).toHaveLength(1);
      expect(errs[0].l2BeatTvs).toBe(2_500_000_000);
    });

    it('does NOT flag Stage 1+ chains regardless of TVS', () => {
      seedCache({
        chains: [{
          chainId: 42161,
          name: 'Arbitrum One',
          tags: ['L2'],
          relations: [{ kind: 'l2Of', chainId: 1, source: 'theGraph' }],
          l2Beat: { slug: 'arbitrum', stage: 'Stage 1', tvs: 10_000_000_000, hostChainId: 1 }
        }]
      });
      expect(findErrorsForRule(validateChainData(), 11)).toHaveLength(0);
    });

    it('does NOT flag Stage 0 chains below the threshold', () => {
      seedCache({
        chains: [{
          chainId: 999,
          name: 'Small L2',
          tags: ['L2'],
          relations: [{ kind: 'l2Of', chainId: 1, source: 'theGraph' }],
          l2Beat: { slug: 'small', stage: 'Stage 0', tvs: 100_000_000, hostChainId: 1 }
        }]
      });
      expect(findErrorsForRule(validateChainData(), 11)).toHaveLength(0);
    });
  });

  describe('summary aggregation', () => {
    it('reports counts for all 11 rules in summary + errorsByRule', () => {
      seedCache({
        chains: [{
          chainId: 42161,
          name: 'Arbitrum One',
          tags: ['L2'],
          relations: [],
          l2Beat: { slug: 'arbitrum', stage: 'Stage 1', category: 'Optimistic Rollup', hostChainId: 1 }
        }]
      });
      const report = validateChainData();
      expect(report.summary).toHaveProperty('rule7');
      expect(report.summary).toHaveProperty('rule8');
      expect(report.summary).toHaveProperty('rule9');
      expect(report.summary).toHaveProperty('rule10');
      expect(report.summary).toHaveProperty('rule11');
      expect(report.errorsByRule).toHaveProperty('rule7_l2beat_missing_classification');
      expect(report.errorsByRule).toHaveProperty('rule8_l2beat_hostchain_no_relation');
    });
  });
});
