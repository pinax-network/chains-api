import { describe, it, expect, vi } from 'vitest';

// Separate file from assistant.test.js because the config mock (API key set)
// must apply to the whole module graph at import time.
vi.mock('../../../config.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ASSISTANT_LLM_URL: 'http://llm.test:11434',
  ASSISTANT_LLM_API_KEY: 'sk-test-key',
  ASSISTANT_TOPIC_GUARD: false
}));

import { runAssistant } from '../../../src/services/assistant.js';

const noopLog = { info: () => {}, warn: () => {} };

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
