import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../mcp-tools.js', () => ({
  getToolDefinitions: vi.fn(() => [
    {
      name: 'search_chains',
      description: 'Search chains',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
    },
    {
      name: 'get_chain_by_id',
      description: 'Get chain by id',
      inputSchema: { type: 'object', properties: { chainId: { type: 'number' } }, required: ['chainId'] }
    }
  ]),
  handleToolCall: vi.fn(async (name) => ({
    content: [{ type: 'text', text: `{"tool":"${name}","result":"ok"}` }]
  }))
}));

import { handleToolCall } from '../../../mcp-tools.js';
import { runAssistant, buildSystemPrompt, AssistantUnavailableError } from '../../../src/services/assistant.js';
import { _resetAssistantToolsForTests } from '../../../src/services/assistantTools.js';

const noopLog = { info: () => {}, warn: () => {} };

function llmResponse(message, usage) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message }], usage })
  };
}

function toolCallMessage(name, args, id = 'call_1') {
  return { role: 'assistant', content: null, tool_calls: [{ id, function: { name, arguments: args } }] };
}

function fetchSequence(responses) {
  const calls = [];
  const impl = vi.fn(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  impl.calls = calls;
  return impl;
}

describe('runAssistant', () => {
  beforeEach(() => {
    _resetAssistantToolsForTests();
    vi.mocked(handleToolCall).mockClear();
  });

  it('runs a tool call turn then returns the final answer', async () => {
    const fetchImpl = fetchSequence([
      llmResponse(toolCallMessage('search_chains', '{"query":"base"}')),
      llmResponse({ role: 'assistant', content: 'Base mainnet is chain `8453`.' }, { prompt_tokens: 100, completion_tokens: 20 })
    ]);
    const result = await runAssistant({ messages: [{ role: 'user', content: 'what chain id is base?' }], log: noopLog, fetchImpl });

    expect(result.reply).toBe('Base mainnet is chain `8453`.');
    expect(result.degraded).toBe(false);
    expect(result.toolCalls).toEqual([{ name: 'search_chains', args: { query: 'base' } }]);
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 20 });
    expect(handleToolCall).toHaveBeenCalledWith('search_chains', { query: 'base' });
    // Second LLM call must carry the tool result back
    const second = fetchImpl.calls[1].body;
    expect(second.messages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('passes a clarifying question straight through without tools', async () => {
    const fetchImpl = fetchSequence([
      llmResponse({ role: 'assistant', content: 'Do you mean Base mainnet (8453) or Base Sepolia (84532)?' })
    ]);
    const result = await runAssistant({ messages: [{ role: 'user', content: 'is base down?' }], log: noopLog, fetchImpl });
    expect(result.reply).toMatch(/8453.*84532/);
    expect(result.toolCalls).toEqual([]);
    expect(result.degraded).toBe(false);
  });

  it('sends the system prompt first and the model name from config', async () => {
    const fetchImpl = fetchSequence([llmResponse({ role: 'assistant', content: 'hi' })]);
    await runAssistant({ messages: [{ role: 'user', content: 'hello' }], context: { view: 'incidents', chainId: 10 }, log: noopLog, fetchImpl });
    const body = fetchImpl.calls[0].body;
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('chain 10');
    expect(body.messages[0].content).toContain('"incidents" tab');
    expect(body.stream).toBe(false);
    expect(body.tools.length).toBe(2);
    expect(body.tools[0]).toMatchObject({ type: 'function', function: { name: 'search_chains' } });
    // No ASSISTANT_LLM_API_KEY configured → no Authorization header sent
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBeUndefined();
  });

  it('feeds malformed tool args back, then forces an answer after two strikes', async () => {
    const fetchImpl = fetchSequence([
      llmResponse(toolCallMessage('search_chains', 'not-json')),
      llmResponse(toolCallMessage('search_chains', '{"nope":true}')),
      llmResponse({ role: 'assistant', content: 'Best effort answer.' })
    ]);
    const result = await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl });
    expect(result.reply).toBe('Best effort answer.');
    expect(result.toolCalls).toEqual([]);
    // Third call must have been forced to answer without tools
    expect(fetchImpl.calls[2].body.tool_choice).toBe('none');
    // Error results were fed back as tool messages
    const toolMsgs = fetchImpl.calls[2].body.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.length).toBe(2);
    expect(toolMsgs[0].content).toMatch(/ERROR/);
  });

  it('ignores tool calls emitted despite tool_choice none', async () => {
    const fetchImpl = fetchSequence([
      llmResponse(toolCallMessage('search_chains', 'bad')),
      llmResponse(toolCallMessage('search_chains', 'bad')),
      llmResponse({ role: 'assistant', content: 'answer anyway', tool_calls: [{ id: 'x', function: { name: 'search_chains', arguments: '{}' } }] })
    ]);
    const result = await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl });
    expect(result.reply).toBe('answer anyway');
    expect(handleToolCall).not.toHaveBeenCalled();
  });

  it('forces a final answer when iterations are exhausted', async () => {
    const looping = () => llmResponse(toolCallMessage('get_chain_by_id', '{"chainId":1}'));
    const fetchImpl = fetchSequence([
      looping(), looping(), looping(), looping(), looping(), looping(),
      llmResponse({ role: 'assistant', content: 'Summary from gathered data.' })
    ]);
    const result = await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl });
    expect(result.reply).toBe('Summary from gathered data.');
    expect(result.degraded).toBe(false);
    expect(fetchImpl.calls.length).toBe(7);
    expect(fetchImpl.calls[6].body.tool_choice).toBe('none');
  });

  it('throws AssistantUnavailableError when the first LLM call fails', async () => {
    const fetchImpl = fetchSequence([new Error('ECONNREFUSED')]);
    await expect(
      runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl })
    ).rejects.toThrow(AssistantUnavailableError);
  });

  it('throws AssistantUnavailableError on a non-2xx first response', async () => {
    const fetchImpl = fetchSequence([{ ok: false, status: 500 }]);
    await expect(
      runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl })
    ).rejects.toThrow(/500/);
  });

  it('degrades gracefully when the LLM dies mid-loop', async () => {
    const fetchImpl = fetchSequence([
      llmResponse(toolCallMessage('search_chains', '{"query":"base"}')),
      new Error('socket hang up'),
      new Error('socket hang up')
    ]);
    const result = await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl });
    expect(result.degraded).toBe(true);
    expect(result.reply).toMatch(/wasn't able to finish/);
    expect(result.toolCalls).toEqual([{ name: 'search_chains', args: { query: 'base' } }]);
  });

  it('retries once on an empty final message, then degrades', async () => {
    const fetchImpl = fetchSequence([
      llmResponse({ role: 'assistant', content: '' }),
      llmResponse({ role: 'assistant', content: '  ' }),
      llmResponse({ role: 'assistant', content: '' }),
      llmResponse({ role: 'assistant', content: '' })
    ]);
    const result = await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl });
    expect(result.degraded).toBe(true);
    expect(result.reply).toMatch(/wasn't able to finish/);
  });

  it('coerces string-typed numeric args before executing the tool', async () => {
    const fetchImpl = fetchSequence([
      llmResponse(toolCallMessage('get_chain_by_id', '{"chainId":"8453"}')),
      llmResponse({ role: 'assistant', content: 'done' })
    ]);
    const result = await runAssistant({ messages: [{ role: 'user', content: 'q' }], log: noopLog, fetchImpl });
    expect(handleToolCall).toHaveBeenCalledWith('get_chain_by_id', { chainId: 8453 });
    expect(result.toolCalls).toEqual([{ name: 'get_chain_by_id', args: { chainId: 8453 } }]);
  });
});

describe('buildSystemPrompt', () => {
  it('includes the current UTC time and core rules', () => {
    const prompt = buildSystemPrompt(undefined, new Date('2026-07-06T12:00:00Z'));
    expect(prompt).toContain('2026-07-06T12:00:00.000Z');
    expect(prompt).toContain('DISAMBIGUATE NETWORKS');
    expect(prompt).toContain('LIVE vs STATIC');
    expect(prompt).toContain('STAY ON TOPIC');
    expect(prompt).not.toContain('undefined');
  });
});
