import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ASSISTANT_LLM_URL: 'http://primary.test',
  ASSISTANT_ENABLED: true,
  ASSISTANT_MODEL: 'main-model',
  ASSISTANT_FALLBACK_LLM_URL: 'http://backup.test',
  ASSISTANT_FALLBACK_LLM_API_KEY: 'sk-backup',
  ASSISTANT_FALLBACK_MODEL: 'backup-model',
  ASSISTANT_TOPIC_GUARD: false
}));

vi.mock('../../../mcp-tools.js', () => ({
  getToolDefinitions: vi.fn(() => [
    {
      name: 'search_chains',
      description: 'Search chains',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
    }
  ]),
  handleToolCall: vi.fn(async () => ({ content: [{ type: 'text', text: '{}' }] }))
}));

import {
  runAssistant,
  checkLlmReachable,
  AssistantUnavailableError,
  _resetReachableCacheForTests
} from '../../../src/services/assistant.js';

const noopLog = { info: () => {}, warn: () => {} };

function llmResponse(content) {
  return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content } }] }) };
}

// Routes requests by host: primary.test uses `primary`, backup.test uses `backup`.
function hostRouter({ primary, backup }) {
  const calls = [];
  const impl = vi.fn(async (url, options) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null, headers: options.headers });
    const handler = url.startsWith('http://primary.test') ? primary : backup;
    const next = typeof handler === 'function' ? handler() : handler.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  impl.calls = calls;
  return impl;
}

describe('runAssistant with a fallback provider', () => {
  it('switches to the backup (sticky, with its own model/key) when the primary dies on the first call', async () => {
    const steps = [];
    const fetchImpl = hostRouter({
      primary: () => { throw new Error('ECONNREFUSED'); },
      backup: [
        { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'search_chains', arguments: '{"query":"base"}' } }] } }] }) },
        llmResponse('answer from backup')
      ]
    });
    const result = await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl, onStep: s => steps.push(s) });

    expect(result.reply).toBe('answer from backup');
    expect(result.viaFallback).toBe(true);
    expect(steps).toContain('switching to backup model');
    // First attempt hit the primary; everything after the switch stays on backup
    const urls = fetchImpl.calls.map(c => c.url);
    expect(urls[0]).toBe('http://primary.test/v1/chat/completions');
    expect(urls.slice(1).every(u => u.startsWith('http://backup.test'))).toBe(true);
    // Backup requests carry the fallback model and its own key
    const backupCall = fetchImpl.calls[1];
    expect(backupCall.body.model).toBe('backup-model');
    expect(backupCall.headers.authorization).toBe('Bearer sk-backup');
  });

  it('does not touch the backup while the primary works', async () => {
    const fetchImpl = hostRouter({
      primary: () => llmResponse('primary answer'),
      backup: () => { throw new Error('should not be called'); }
    });
    const result = await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl });
    expect(result.reply).toBe('primary answer');
    expect(result.viaFallback).toBeUndefined();
    expect(fetchImpl.calls.every(c => c.url.startsWith('http://primary.test'))).toBe(true);
  });

  it('throws AssistantUnavailableError only when BOTH providers fail the first call', async () => {
    const fetchImpl = hostRouter({
      primary: () => { throw new Error('ECONNREFUSED'); },
      backup: () => { throw new Error('ECONNREFUSED'); }
    });
    await expect(
      runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl })
    ).rejects.toThrow(AssistantUnavailableError);
    expect(fetchImpl.calls.map(c => new URL(c.url).host)).toEqual(['primary.test', 'backup.test']);
  });

  it('switches mid-loop when the primary dies after a tool turn', async () => {
    const primaryResponses = [
      { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'search_chains', arguments: '{"query":"base"}' } }] } }] }) }
    ];
    const fetchImpl = hostRouter({
      primary: () => { const r = primaryResponses.shift(); if (!r) throw new Error('socket hang up'); return r; },
      backup: () => llmResponse('backup finished it')
    });
    const result = await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl });
    expect(result.reply).toBe('backup finished it');
    expect(result.viaFallback).toBe(true);
    expect(result.degraded).toBe(false);
  });
});

describe('checkLlmReachable with a fallback provider', () => {
  it('reports reachable when only the backup answers', async () => {
    _resetReachableCacheForTests();
    const fetchImpl = vi.fn(async (url) => {
      if (url.startsWith('http://primary.test')) throw new Error('ECONNREFUSED');
      return { ok: true };
    });
    expect(await checkLlmReachable({ fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // primary probed first, then backup
  });

  it('reports unreachable when every provider is down', async () => {
    _resetReachableCacheForTests();
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    expect(await checkLlmReachable({ fetchImpl })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
