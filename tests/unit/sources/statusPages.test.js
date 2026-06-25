import { describe, it, expect } from 'vitest';
import {
  getAllStatusPages,
  getStatusPageByChainId,
  getAllCoinStatusPages,
  getStatusPageBySymbol,
  attachStatusPages
} from '../../../src/sources/statusPages.js';

describe('status-pages source (data/status-pages.json)', () => {
  it('loads the curated registry', () => {
    const pages = getAllStatusPages();
    expect(Array.isArray(pages)).toBe(true);
    expect(pages.length).toBeGreaterThan(0);
    for (const p of pages) {
      expect(typeof p.id).toBe('string');
      expect(p.url).toMatch(/^https:\/\//);
      expect(Array.isArray(p.chainIds)).toBe(true);
      expect(p.chainIds.length).toBeGreaterThan(0);
    }
  });

  it('every chainId maps to exactly one page (no overlaps)', () => {
    const seen = new Map();
    for (const p of getAllStatusPages()) {
      for (const cid of p.chainIds) {
        expect(seen.has(cid)).toBe(false);
        seen.set(cid, p.id);
      }
    }
  });

  it('resolves a known mainnet and its testnet to the same page', () => {
    // Base mainnet (8453) and Base Sepolia (84532) share one status page.
    const mainnet = getStatusPageByChainId(8453);
    const testnet = getStatusPageByChainId(84532);
    expect(mainnet.statusPage).toBe('https://base-l2.statuspage.io/');
    expect(testnet.statusPage).toBe(mainnet.statusPage);
    expect(mainnet.project.id).toBe('base');
    expect(mainnet.chainId).toBe(8453);
  });

  it('accepts numeric-string chainIds', () => {
    expect(getStatusPageByChainId('10').project.id).toBe('optimism');
  });

  it('returns null for an unknown chain', () => {
    expect(getStatusPageByChainId(99999999999)).toBeNull();
  });

  it('attachStatusPages stamps the URL onto matching chains only', () => {
    const indexed = {
      byChainId: {
        8453: { chainId: 8453, name: 'Base' },
        12345: { chainId: 12345, name: 'Nowhere' }
      }
    };
    attachStatusPages(indexed);
    expect(indexed.byChainId[8453].statusPage).toBe('https://base-l2.statuspage.io/');
    expect(indexed.byChainId[12345].statusPage).toBeUndefined();
  });

  it('attachStatusPages is a no-op on malformed input', () => {
    expect(() => attachStatusPages(undefined)).not.toThrow();
    expect(() => attachStatusPages({})).not.toThrow();
  });

  describe('coin (symbol-keyed) entries', () => {
    it('loads coin entries with symbol/name/url', () => {
      const coins = getAllCoinStatusPages();
      expect(coins.length).toBeGreaterThan(0);
      for (const c of coins) {
        expect(typeof c.symbol).toBe('string');
        expect(c.url).toMatch(/^https:\/\//);
      }
    });

    it('resolves a coin by symbol, case-insensitively', () => {
      const sol = getStatusPageBySymbol('sol');
      expect(sol.statusPage).toBe('https://status.solana.com/');
      expect(sol.symbol).toBe('SOL');
      expect(getStatusPageBySymbol('SOL').statusPage).toBe(sol.statusPage);
    });

    it('returns null for an unknown symbol', () => {
      expect(getStatusPageBySymbol('NOTACOIN')).toBeNull();
      expect(getStatusPageBySymbol(123)).toBeNull();
    });

    it('coin entries do not leak into chain attachment', () => {
      // Solana has no chainId in our data; it must not match a chain lookup.
      const indexed = { byChainId: { 1: { chainId: 1, name: 'Ethereum' } } };
      attachStatusPages(indexed);
      expect(indexed.byChainId[1].statusPage).toBeUndefined();
    });
  });
});
