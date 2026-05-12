import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config.js', () => ({
  PRICE_CACHE_TTL_MS: 3600000,
  PRICE_NEGATIVE_CACHE_TTL_MS: 300000,
  PRICE_FETCH_TIMEOUT_MS: 3000,
  PROXY_URL: '',
  PROXY_ENABLED: false,
}));

vi.mock('../../fetchUtil.js', () => ({
  proxyFetch: vi.fn(),
}));

import * as fetchUtil from '../../fetchUtil.js';
import {
  getPriceForChain,
  getPricesForChains,
  getCoinGeckoId,
  clearPriceCache,
} from '../../priceService.js';

describe('priceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPriceCache();
  });

  describe('getCoinGeckoId', () => {
    it('should return ethereum for chainId 1', () => {
      expect(getCoinGeckoId(1)).toBe('ethereum');
    });

    it('should return null for unknown chain', () => {
      expect(getCoinGeckoId(99999)).toBeNull();
    });

    it('should return ethereum for Base (8453)', () => {
      expect(getCoinGeckoId(8453)).toBe('ethereum');
    });

    it('should return matic-network for Polygon (137)', () => {
      expect(getCoinGeckoId(137)).toBe('matic-network');
    });
  });

  describe('getPriceForChain', () => {
    it('should return null for unknown chain without fetching', async () => {
      const result = await getPriceForChain(99999);
      expect(result).toBeNull();
      expect(fetchUtil.proxyFetch).not.toHaveBeenCalled();
    });

    it('should fetch and return price for known chain', async () => {
      vi.mocked(fetchUtil.proxyFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ ethereum: { usd: 2000.5 } }),
      });
      const result = await getPriceForChain(1);
      expect(result).toMatchObject({ usd: 2000.5 });
      expect(result.updatedAt).toBeDefined();
      expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should return null gracefully on CoinGecko HTTP error', async () => {
      vi.mocked(fetchUtil.proxyFetch).mockResolvedValue({
        ok: false,
        status: 429,
      });
      const result = await getPriceForChain(1);
      expect(result).toBeNull();
    });

    it('should return null gracefully on network error', async () => {
      vi.mocked(fetchUtil.proxyFetch).mockRejectedValue(
        new Error('ECONNREFUSED')
      );
      const result = await getPriceForChain(1);
      expect(result).toBeNull();
    });

    it('should use TTL cache on second call', async () => {
      vi.mocked(fetchUtil.proxyFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ ethereum: { usd: 2000.5 } }),
      });
      const first = await getPriceForChain(1);
      const second = await getPriceForChain(1);
      expect(first).toEqual(second);
      expect(fetchUtil.proxyFetch).toHaveBeenCalledTimes(1);
    });

    it('should reuse sibling cache for L2 chains sharing ETH coinId', async () => {
      vi.mocked(fetchUtil.proxyFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ ethereum: { usd: 2000.5 } }),
      });
      // Fetch Ethereum (chainId 1)
      const eth = await getPriceForChain(1);
      // Fetch Optimism (chainId 10) — same coinId 'ethereum'
      const opt = await getPriceForChain(10);
      // Should NOT have made a second network call
      expect(fetchUtil.proxyFetch).toHaveBeenCalledTimes(1);
      expect(eth.usd).toBe(opt.usd);
      expect(eth.updatedAt).toBe(opt.updatedAt);
    });
  });

  describe('getPricesForChains', () => {
    it('should batch all unique coinIds into one request', async () => {
      vi.mocked(fetchUtil.proxyFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ethereum: { usd: 2000.5 },
          'matic-network': { usd: 0.8 },
        }),
      });
      const result = await getPricesForChains([1, 137, 10]); // 10 shares ETH with 1
      expect(fetchUtil.proxyFetch).toHaveBeenCalledTimes(1);
      // Verify the URL contains both ids (not three)
      const url = vi.mocked(fetchUtil.proxyFetch).mock.calls[0][0];
      expect(url).toContain('ethereum');
      expect(url).toContain('matic-network');
      expect(result.get(1)).toMatchObject({ usd: 2000.5 });
      expect(result.get(137)).toMatchObject({ usd: 0.8 });
      expect(result.get(10)).toMatchObject({ usd: 2000.5 }); // sibling reuse
    });

    it('should return null for unknown chain IDs', async () => {
      vi.mocked(fetchUtil.proxyFetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      const result = await getPricesForChains([99999]);
      expect(result.get(99999)).toBeNull();
      expect(fetchUtil.proxyFetch).not.toHaveBeenCalled(); // no coinId, no fetch
    });

    it('should return null for all chains on CoinGecko failure', async () => {
      vi.mocked(fetchUtil.proxyFetch).mockRejectedValue(new Error('timeout'));
      const result = await getPricesForChains([1, 137]);
      expect(result.get(1)).toBeNull();
      expect(result.get(137)).toBeNull();
    });

    it('should handle mixed known and unknown chains', async () => {
      vi.mocked(fetchUtil.proxyFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ ethereum: { usd: 2000.5 } }),
      });
      const result = await getPricesForChains([1, 99999, 137]);
      expect(result.get(1)).toMatchObject({ usd: 2000.5 });
      expect(result.get(99999)).toBeNull();
      expect(result.get(137)).toBeNull(); // no price for this one
    });

    it('should deduplicate batch requests for sibling chains', async () => {
      vi.mocked(fetchUtil.proxyFetch).mockResolvedValue({
        ok: true,
        json: async () => ({ ethereum: { usd: 2000.5 } }),
      });
      // Request multiple L2s that all use ETH
      const result = await getPricesForChains([1, 10, 42161, 8453]);
      // Should only call CoinGecko once for "ethereum"
      expect(fetchUtil.proxyFetch).toHaveBeenCalledTimes(1);
      const url = vi.mocked(fetchUtil.proxyFetch).mock.calls[0][0];
      // URL should contain ids parameter with only "ethereum" once
      expect(url).toContain('ids=ethereum');
      // All chains should have the same price
      expect(result.get(1)?.usd).toBe(2000.5);
      expect(result.get(10)?.usd).toBe(2000.5);
      expect(result.get(42161)?.usd).toBe(2000.5);
      expect(result.get(8453)?.usd).toBe(2000.5);
    });

    it('should handle partial CoinGecko response gracefully', async () => {
      vi.mocked(fetchUtil.proxyFetch).mockResolvedValue({
        ok: true,
        json: async () => ({
          ethereum: { usd: 2000.5 },
          // matic-network is missing
        }),
      });
      const result = await getPricesForChains([1, 137]);
      expect(result.get(1)).toMatchObject({ usd: 2000.5 });
      expect(result.get(137)).toBeNull();
    });
  });
});
