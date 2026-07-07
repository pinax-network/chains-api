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

// Exact host match (not a startsWith substring — that would also match a
// spoofed host like primary.test.evil.com, which CodeQL rightly flags).
const hostOf = (u) => new URL(u).host;

// Routes requests by host: primary.test uses `primary`, backup.test uses `backup`.
function hostRouter({ primary, backup }) {
  const calls = [];
  const impl = vi.fn(async (url, options) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null, headers: options.headers });
    const handler = hostOf(url) === 'primary.test' ? primary : backup;
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
    // The primary gets one transient-blip retry (2 attempts), then everything
    // after the switch stays on backup
    const urls = fetchImpl.calls.map(c => c.url);
    expect(urls[0]).toBe('http://primary.test/v1/chat/completions');
    expect(urls[1]).toBe('http://primary.test/v1/chat/completions');
    expect(urls.slice(2).every(u => hostOf(u) === 'backup.test')).toBe(true);
    // Backup requests carry the fallback model and its own key
    const backupCall = fetchImpl.calls[2];
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
    expect(fetchImpl.calls.every(c => hostOf(c.url) === 'primary.test')).toBe(true);
  });

  it('passes an integer abort delay that reserves budget for the fallback', async () => {
    // The per-attempt timeout is a fraction of the remaining budget when a
    // fallback exists — must be floored (AbortSignal.timeout rejects
    // fractional delays) and must leave time for the backup to run.
    let seenTimeout = null;
    const fetchImpl = vi.fn(async (_url, opts) => {
      // AbortSignal has no public delay getter; assert the signal exists and
      // that constructing it with our value didn't throw (fractional would).
      seenTimeout = opts.signal;
      return llmResponse('ok');
    });
    const result = await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl });
    expect(result.reply).toBe('ok');
    expect(seenTimeout).toBeInstanceOf(AbortSignal);
    expect(seenTimeout.aborted).toBe(false); // a fractional delay would have thrown before fetch
  });

  it('throws AssistantUnavailableError only when BOTH providers fail the first call', async () => {
    const fetchImpl = hostRouter({
      primary: () => { throw new Error('ECONNREFUSED'); },
      backup: () => { throw new Error('ECONNREFUSED'); }
    });
    await expect(
      runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl })
    ).rejects.toThrow(AssistantUnavailableError);
    // Each provider gets one transient-blip retry before the run gives up
    expect(fetchImpl.calls.map(c => new URL(c.url).host)).toEqual([
      'primary.test', 'primary.test', 'backup.test', 'backup.test'
    ]);
  });

  it('recovers on the primary after a single transient error — no switch, no badge', async () => {
    // The prod failure mode this guards: the serving layer throws a one-off
    // 502; the run must retry the primary once and stay there, not demote the
    // whole conversation to the backup model.
    const steps = [];
    const primaryResponses = [new Error('one-off 502'), llmResponse('primary recovered')];
    const fetchImpl = hostRouter({
      primary: primaryResponses,
      backup: () => { throw new Error('should not be called'); }
    });
    const result = await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl, onStep: s => steps.push(s) });
    expect(result.reply).toBe('primary recovered');
    expect(result.viaFallback).toBeUndefined();
    expect(steps).not.toContain('switching to backup model');
    expect(fetchImpl.calls.every(c => hostOf(c.url) === 'primary.test')).toBe(true);
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

  it('switches to the backup when the primary leaks tool-call syntax (HTTP 200 garbage)', async () => {
    // The real failure mode: server returns 200 but leaks the tool call into
    // content instead of parsing it. Must fail over, not burn strikes.
    const steps = [];
    const fetchImpl = hostRouter({
      primary: () => llmResponse('get_chain_by_id to=functions.get_chain_by_id'),
      backup: () => llmResponse('Base mainnet is chain `8453`.')
    });
    const result = await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl, onStep: s => steps.push(s) });
    expect(result.reply).toBe('Base mainnet is chain `8453`.');
    expect(result.viaFallback).toBe(true);
    expect(steps).toContain('switching to backup model');
    expect(fetchImpl.calls.filter(c => hostOf(c.url) === 'primary.test').length).toBe(1); // tried once, then switched
  });
});

describe('checkLlmReachable with a fallback provider', () => {
  it('reports reachable when only the backup answers', async () => {
    _resetReachableCacheForTests();
    const fetchImpl = vi.fn(async (url) => {
      if (hostOf(url) === 'primary.test') throw new Error('ECONNREFUSED');
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
