import {
  ASSISTANT_LLM_URL,
  ASSISTANT_MODEL,
  ASSISTANT_MAX_TOOL_ITERATIONS,
  ASSISTANT_TIMEOUT_MS,
  ASSISTANT_MAX_TOKENS
} from '../../config.js';
import { proxyFetch } from '../../fetchUtil.js';
import { logger } from '../util/logger.js';
import { incCounter } from '../util/metrics.js';
import { getOpenAiTools, executeTool } from './assistantTools.js';

/**
 * Assistant harness: a defensive tool-use loop over an OpenAI-compatible
 * chat-completions endpoint (Ollama, vLLM, LM Studio…). The model is
 * configurable and untrusted — malformed tool calls are fed back once, then
 * the model is forced to answer without tools; iteration count, per-request
 * deadline, and token output are all hard-capped.
 */

/** Thrown when the LLM server cannot be reached at all (route maps it to 503). */
export class AssistantUnavailableError extends Error {}

const MAX_TOOL_CALLS_PER_TURN = 5;
const MAX_MALFORMED_STRIKES = 2;
const DEGRADED_REPLY = "I wasn't able to finish looking that up. Please try again, or ask a more specific question.";

/**
 * Run one assistant turn.
 *
 * @param {object} params
 * @param {Array<{role: 'user'|'assistant', content: string}>} params.messages full history, last must be user
 * @param {{view?: string, chainId?: number}} [params.context] dashboard context
 * @param {object} [params.log] request-scoped pino logger
 * @param {Function} [params.fetchImpl] injectable for tests
 * @param {Function} [params.now] injectable clock for tests
 * @returns {Promise<{reply: string, toolCalls: Array<{name, args}>, degraded: boolean, usage: object|null}>}
 */
export async function runAssistant({ messages, context, log = logger, fetchImpl = proxyFetch, now = () => new Date() }) {
  const startedAt = Date.now();
  const deadline = startedAt + ASSISTANT_TIMEOUT_MS;
  const convo = [{ role: 'system', content: buildSystemPrompt(context, now()) }, ...messages];
  const tools = getOpenAiTools();
  const executedCalls = [];
  let malformedStrikes = 0;
  let usage = null;
  let reply = null;
  let degraded = false;

  for (let iteration = 0; iteration < ASSISTANT_MAX_TOOL_ITERATIONS; iteration++) {
    const firstCall = iteration === 0;
    const forceAnswer = malformedStrikes >= MAX_MALFORMED_STRIKES;
    const body = await callLlm({ convo, tools, toolChoice: forceAnswer ? 'none' : 'auto', deadline, fetchImpl, firstCall, log });
    if (!body) { degraded = true; break; }
    if (body.usage) usage = { promptTokens: body.usage.prompt_tokens ?? null, completionTokens: body.usage.completion_tokens ?? null };

    const msg = body.choices?.[0]?.message;
    if (!msg) {
      malformedStrikes++;
      if (malformedStrikes > MAX_MALFORMED_STRIKES) { degraded = true; break; }
      continue;
    }

    // When forced to answer (tool_choice 'none'), ignore any tool calls the
    // model emits anyway — some local servers don't honour tool_choice.
    const toolCalls = !forceAnswer && Array.isArray(msg.tool_calls) ? msg.tool_calls.slice(0, MAX_TOOL_CALLS_PER_TURN) : [];
    if (toolCalls.length === 0) {
      const content = (msg.content || '').trim();
      if (content) { reply = content; break; }
      // Empty final message — one retry, then give up.
      malformedStrikes++;
      if (malformedStrikes > MAX_MALFORMED_STRIKES) { degraded = true; break; }
      continue;
    }

    convo.push({ role: 'assistant', content: msg.content ?? null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      const name = call.function?.name || 'unknown';
      let result;
      try {
        const args = JSON.parse(call.function?.arguments || '{}');
        result = await executeTool(name, args);
        if (!result.isError) executedCalls.push({ name, args });
      } catch {
        result = { text: 'ERROR: tool arguments were not valid JSON. Re-check the tool schema and try again, or answer without this tool.', isError: true };
      }
      if (result.isError) malformedStrikes++;
      incCounter('chains_api_assistant_tool_calls_total', { tool: name, outcome: result.isError ? 'error' : 'ok' });
      convo.push({ role: 'tool', tool_call_id: call.id || name, content: result.text });
    }
  }

  if (reply == null && !degraded) {
    // Iterations exhausted mid-loop — force a final answer from what we have.
    const body = await callLlm({ convo, tools, toolChoice: 'none', deadline, fetchImpl, firstCall: false, log });
    reply = (body?.choices?.[0]?.message?.content || '').trim() || null;
    if (reply == null) degraded = true;
  }
  if (reply == null) reply = DEGRADED_REPLY;

  incCounter('chains_api_assistant_requests_total', { outcome: degraded ? 'degraded' : 'ok' });
  log.info(
    { durationMs: Date.now() - startedAt, tools: executedCalls.map((c) => c.name), degraded, messageCount: messages.length },
    'assistant request completed'
  );
  return { reply, toolCalls: executedCalls, degraded, usage };
}

async function callLlm({ convo, tools, toolChoice, deadline, fetchImpl, firstCall, log }) {
  const budget = deadline - Date.now();
  if (budget <= 0) {
    if (firstCall) throw new AssistantUnavailableError('Assistant deadline exhausted');
    return null;
  }
  try {
    const response = await fetchImpl(`${ASSISTANT_LLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ASSISTANT_MODEL,
        messages: convo,
        tools,
        tool_choice: toolChoice,
        max_tokens: ASSISTANT_MAX_TOKENS,
        temperature: 0.2,
        stream: false
      }),
      signal: AbortSignal.timeout(Math.max(1000, budget))
    });
    if (!response.ok) throw new Error(`LLM responded ${response.status}`);
    const body = await response.json();
    incCounter('chains_api_assistant_llm_calls_total', { outcome: 'ok' });
    return body;
  } catch (err) {
    incCounter('chains_api_assistant_llm_calls_total', { outcome: 'error' });
    if (firstCall) throw new AssistantUnavailableError(err.message);
    log.warn({ err: err.message }, 'assistant LLM call failed mid-loop');
    return null;
  }
}

export function buildSystemPrompt(context, nowDate) {
  const lines = [
    'You are the Chains API assistant, embedded in a blockchain network dashboard.',
    `Current date/time: ${nowDate.toISOString()} (UTC). Treat words like "today" or "now" relative to this.`,
    '',
    'You answer questions using ONLY the provided tools, which cover: the chains registry',
    '(~3000 EVM networks: metadata, chain IDs, tags), RPC endpoints and their live health',
    'checks, chain relations (L2-of, testnet-of, parent), L2BEAT scaling data (stage,',
    'category, DA layer, TVS), SLIP-0044 coin types, execution clients, operator status',
    'pages, and LIVE incidents from chain and RPC-provider status pages.',
    '',
    'Rules — follow strictly:',
    '1. DISAMBIGUATE NETWORKS. Many names are ambiguous ("Base" = Base mainnet 8453 or',
    '   Base Sepolia 84532). When the user names a network without a chain ID, call',
    '   search_chains first. If multiple plausible matches exist and the user did not',
    '   specify mainnet/testnet, ASK a short clarifying question listing the options with',
    '   chain IDs instead of guessing. If exactly one match is plausible, proceed and',
    '   state which network (name + chain ID) you assumed.',
    '2. LIVE vs STATIC. Decide whether the user wants live status (incidents, RPC endpoint',
    '   health — use get_live_incidents, get_rpc_monitor_by_id) or static registry data',
    '   (metadata, endpoints list, relations, scaling, SLIP-44). Words like "down",',
    '   "outage", "right now", "incident", "healthy" mean live. If genuinely unclear, ask.',
    '3. When a question is ambiguous in any other way, ask ONE short clarifying question',
    '   rather than answering the wrong thing. Do not ask when the answer is clear.',
    '4. NEVER invent chain IDs, endpoint URLs, incident titles, or numbers. Everything',
    '   factual must come from a tool result. If a tool returns nothing or errors, say so',
    '   plainly and suggest what the user could ask instead.',
    '5. Use the fewest tool calls that answer the question. Prefer *_by_id tools once you',
    '   know the chain ID.',
    '6. Answer concisely in markdown: short sentences, small bullet lists, `code` for chain',
    '   IDs and URLs. No preamble. If the user asked a yes/no question, lead with the answer.',
    '7. You have no memory beyond this conversation and cannot modify anything; all tools',
    '   are read-only.'
  ];
  if (context?.chainId != null) {
    lines.push('', `The user currently has chain ${context.chainId} open in the dashboard — prefer it when they say "this chain" or "this network".`);
  }
  if (context?.view) {
    lines.push(`They are on the "${context.view}" tab of the dashboard.`);
  }
  return lines.join('\n');
}
