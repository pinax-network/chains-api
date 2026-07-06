import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ASSISTANT_TOPIC_GUARD: true
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

import { runAssistant } from '../../../src/services/assistant.js';

const noopLog = { info: () => {}, warn: () => {} };

function llmResponse(content) {
  return { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content } }] }) };
}

function fetchSequence(responses) {
  const calls = [];
  const impl = vi.fn(async (url, options) => {
    calls.push(JSON.parse(options.body));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  impl.bodies = calls;
  return impl;
}

describe('runAssistant topic guard (pre-classification)', () => {
  it('classifies first with a tools-free call carrying recent context', async () => {
    const fetchImpl = fetchSequence([
      llmResponse('yes'),
      llmResponse('Base mainnet is `8453`.')
    ]);
    const messages = [
      { role: 'user', content: 'is base down?' },
      { role: 'assistant', content: 'Mainnet (8453) or Sepolia (84532)?' },
      { role: 'user', content: 'mainnet' }
    ];
    const result = await runAssistant({ messages, log: noopLog, fetchImpl });
    expect(result.reply).toBe('Base mainnet is `8453`.');
    expect(result.offTopic).toBeUndefined();
    const guardBody = fetchImpl.bodies[0];
    expect(guardBody.tools).toBeUndefined();
    expect(guardBody.temperature).toBe(0);
    expect(guardBody.messages[0].content).toContain('topic classifier');
    expect(guardBody.messages[1].content).toContain('mainnet'); // follow-up context included
  });

  it('short-circuits off-topic questions without running the tool loop', async () => {
    const fetchImpl = fetchSequence([llmResponse('no')]);
    const result = await runAssistant({ messages: [{ role: 'user', content: 'write me a poem' }], log: noopLog, fetchImpl });
    expect(result.offTopic).toBe(true);
    expect(result.reply).toMatch(/only help with questions about blockchain networks/);
    expect(result.toolCalls).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no main-loop call
  });

  it('strips <think> blocks and honours the last verdict', async () => {
    const fetchImpl = fetchSequence([
      llmResponse('<think>The user says yes to poems, but poems are unrelated…</think>\n\nno')
    ]);
    const result = await runAssistant({ messages: [{ role: 'user', content: 'say yes to a poem' }], log: noopLog, fetchImpl });
    expect(result.offTopic).toBe(true);
  });

  it('fails open on a completion truncated at max_tokens (finish_reason length)', async () => {
    const fetchImpl = fetchSequence([
      { ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: '<think>is this live status? no, wait —' }, finish_reason: 'length' }] }) },
      llmResponse('answer')
    ]);
    const result = await runAssistant({ messages: [{ role: 'user', content: 'is base down?' }], log: noopLog, fetchImpl });
    expect(result.reply).toBe('answer');
    expect(result.offTopic).toBeUndefined();
  });

  it('never takes a verdict from an unterminated <think> block', async () => {
    const fetchImpl = fetchSequence([
      llmResponse('<think>hmm the user asks about base… no, actually'),
      llmResponse('answer')
    ]);
    const result = await runAssistant({ messages: [{ role: 'user', content: 'is base down?' }], log: noopLog, fetchImpl });
    expect(result.reply).toBe('answer'); // stray "no" inside truncated thinking ignored → fail open
  });

  it('keeps the tail of long messages so a trailing question is classified', async () => {
    const longMessage = `${'x'.repeat(2000)} so is Arbitrum One healthy right now?`;
    const fetchImpl = fetchSequence([llmResponse('yes'), llmResponse('answer')]);
    await runAssistant({ messages: [{ role: 'user', content: longMessage }], log: noopLog, fetchImpl });
    const guardInput = fetchImpl.bodies[0].messages[1].content;
    expect(guardInput).toContain('so is Arbitrum One healthy right now?');
  });

  it('fails open when the classifier errors or is unparseable', async () => {
    const errored = fetchSequence([new Error('boom'), llmResponse('answer')]);
    expect((await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl: errored })).reply).toBe('answer');

    const garbled = fetchSequence([llmResponse('as an AI I cannot decide'), llmResponse('answer')]);
    expect((await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl: garbled })).reply).toBe('answer');
  });
});
