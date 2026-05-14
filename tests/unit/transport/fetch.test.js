import { describe, it, expect } from 'vitest';
import { fetchData } from '../../../src/transport/fetch.js';

// We don't mock fetchUtil for this test because fetchData should return null
// without any network call when given an unsupported format. Use a URL that
// won't actually resolve to keep the test offline-safe.

describe('fetchData — unsupported format (regression)', () => {
  it('returns null when format is neither "json" nor "text"', async () => {
    // The fetch will fail (sandbox blocks network), but the catch block
    // returns null anyway. We want to verify the contract holds for the
    // success path too — so call with a format that bypasses both branches.
    // Easiest deterministic check: stub global fetch to return a response
    // and confirm the unknown-format branch returns null.
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => 'x'
    });
    try {
      const result = await fetchData('https://example.test/x', 'xml');
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('returns json for format="json"', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
      text: async () => 'fallback'
    });
    try {
      const result = await fetchData('https://example.test/x', 'json');
      expect(result).toEqual({ hello: 'world' });
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
