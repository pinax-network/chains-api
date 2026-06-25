import { describe, it, expect, afterEach } from 'vitest';
import { fetchData } from '../../../src/transport/fetch.js';

// fetchData retries transient failures with exponential backoff before giving
// up (default SOURCE_FETCH_MAX_RETRIES=3). proxyFetch uses globalThis.fetch
// under the hood, so we stub that.
describe('fetchData — retry with backoff', () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it('retries a transient failure then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls < 2) throw new Error('transient');
      return { ok: true, status: 200, json: async () => ({ ok: true }), text: async () => 'x' };
    };
    const result = await fetchData('https://example.test/data.json', 'json');
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('returns null after exhausting all retries', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('down'); };
    const result = await fetchData('https://example.test/data.json', 'json');
    expect(result).toBeNull();
    expect(calls).toBe(3); // SOURCE_FETCH_MAX_RETRIES default
  });

  it('does not retry an unsupported format (fails fast, no network)', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return { ok: true, status: 200, json: async () => ({}) }; };
    const result = await fetchData('https://example.test/x', 'xml');
    expect(result).toBeNull();
    expect(calls).toBe(0);
  });
});
