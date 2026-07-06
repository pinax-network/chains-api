import { describe, it, expect, vi, beforeEach } from 'vitest';

// Separate file from assistant.test.js because the config mock (API key set)
// must apply to the whole module graph at import time.
vi.mock('../../../config.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ASSISTANT_LLM_URL: 'http://llm.test:11434',
  // Derived flag must be overridden too — the original computes it from the
  // real (empty) env, not from the mocked URL above.
  ASSISTANT_ENABLED: true,
  ASSISTANT_LLM_API_KEY: 'sk-test-key',
  ASSISTANT_TOPIC_GUARD: false
}));

import { runAssistant, checkLlmReachable, _resetReachableCacheForTests } from '../../../src/services/assistant.js';

const noopLog = { info: () => {}, warn: () => {} };

beforeEach(() => _resetReachableCacheForTests());

describe('runAssistant with ASSISTANT_LLM_API_KEY', () => {
  it('sends the key as a bearer Authorization header', async () => {
    let seenHeaders = null;
    const fetchImpl = vi.fn(async (url, options) => {
      seenHeaders = options.headers;
      return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: 'hi' } }] }) };
    });
    const result = await runAssistant({ messages: [{ role: 'user', content: 'hello' }], log: noopLog, fetchImpl });
    expect(result.reply).toBe('hi');
    expect(fetchImpl).toHaveBeenCalledWith('http://llm.test:11434/v1/chat/completions', expect.any(Object));
    expect(seenHeaders.authorization).toBe('Bearer sk-test-key');
  });

  it('never includes the key in the response payload', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { role: 'assistant', content: 'hi' } }] })
    }));
    const result = await runAssistant({ messages: [{ role: 'user', content: 'hello' }], log: noopLog, fetchImpl });
    expect(JSON.stringify(result)).not.toContain('sk-test-key');
  });
});

describe('checkLlmReachable', () => {
  it('probes /v1/models with auth headers and caches the verdict', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    expect(await checkLlmReachable({ fetchImpl })).toBe(true);
    expect(await checkLlmReachable({ fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // second call served from cache
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://llm.test:11434/v1/models',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer sk-test-key' }) })
    );
  });

  it('reports unreachable only on network errors — any HTTP response means the server is up', async () => {
    expect(await checkLlmReachable({ fetchImpl: vi.fn(async () => { throw new Error('ECONNREFUSED'); }) })).toBe(false);
    _resetReachableCacheForTests();
    // Some OpenAI-compatible servers don't implement GET /v1/models — a 404
    // from a live server must not read as down.
    expect(await checkLlmReachable({ fetchImpl: vi.fn(async () => ({ ok: false, status: 404 })) })).toBe(true);
  });

  it('is updated by real chat traffic without extra probes', async () => {
    const chatOk = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { role: 'assistant', content: 'hi' } }] })
    }));
    await runAssistant({ messages: [{ role: 'user', content: 'hello' }], log: noopLog, fetchImpl: chatOk });
    const probe = vi.fn();
    expect(await checkLlmReachable({ fetchImpl: probe })).toBe(true);
    expect(probe).not.toHaveBeenCalled(); // served from the traffic-fed cache

    _resetReachableCacheForTests();
    const chatDown = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    await runAssistant({ messages: [{ role: 'user', content: 'hello' }], log: noopLog, fetchImpl: chatDown }).catch(() => {});
    expect(await checkLlmReachable({ fetchImpl: probe })).toBe(false);
    expect(probe).not.toHaveBeenCalled();
  });
});
