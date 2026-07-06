import { randomUUID } from 'node:crypto';
import {
  ASSISTANT_ENABLED,
  ASSISTANT_MODEL,
  ASSISTANT_RATE_LIMIT_MAX,
  ASSISTANT_MAX_MESSAGES,
  ASSISTANT_MAX_MESSAGE_LENGTH,
  ASSISTANT_SYNC_WAIT_MS,
  ASSISTANT_JOB_TTL_MS,
  ASSISTANT_MAX_CONCURRENT_JOBS,
  ASSISTANT_TIMEOUT_MS,
  RATE_LIMIT_WINDOW_MS
} from '../../../config.js';
import { runAssistant, checkLlmReachable, AssistantUnavailableError } from '../../services/assistant.js';
import { sendError } from '../util/sendError.js';

// Async job handling. A reverse proxy in front of the API (ingress /
// Cloudflare) times out long requests, and a local LLM tool loop can easily
// outlive that. POST waits at most ASSISTANT_SYNC_WAIT_MS for the run; if
// it's still going, the client gets 202 + a job id to poll — every request
// then stays well under any proxy timeout.
const jobs = new Map();

function runningJobCount() {
  let n = 0;
  for (const job of jobs.values()) if (job.status === 'running') n++;
  return n;
}

function startAssistantJob({ messages, context, log }) {
  const job = { id: randomUUID(), status: 'running', result: null, error: null };
  jobs.set(job.id, job);
  const jobId = job.id;
  job.promise = runAssistant({ messages, context, log })
    .then((result) => { job.status = 'done'; job.result = result; })
    .catch((err) => {
      job.status = 'error';
      if (err instanceof AssistantUnavailableError) {
        job.error = 'Assistant LLM unreachable';
        log.warn({ err: err.message }, 'assistant LLM unreachable');
      } else {
        job.error = 'Assistant failed';
        // Full error object → pino's err serializer keeps the stack trace.
        log.error({ err }, 'assistant job failed');
      }
    })
    .finally(() => {
      // Finished jobs linger for the poll TTL, then vanish. Capture only the
      // id — closing over `job` would pin every response body for the TTL.
      setTimeout(() => jobs.delete(jobId), ASSISTANT_JOB_TTL_MS).unref?.();
    });
  return job;
}

function waitForJob(job, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    job.promise.finally(() => { clearTimeout(timer); resolve(); });
  });
}

export function _resetAssistantJobsForTests() {
  jobs.clear();
}

const chatBodySchema = {
  type: 'object',
  properties: {
    messages: {
      type: 'array',
      minItems: 1,
      maxItems: ASSISTANT_MAX_MESSAGES,
      items: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            enum: ['user', 'assistant'],
            errorMessage: { enum: 'Message role must be "user" or "assistant"' }
          },
          content: {
            type: 'string',
            minLength: 1,
            maxLength: ASSISTANT_MAX_MESSAGE_LENGTH,
            errorMessage: {
              minLength: 'Message content must not be empty',
              maxLength: `Message content too long. Max length: ${ASSISTANT_MAX_MESSAGE_LENGTH}`
            }
          }
        },
        required: ['role', 'content'],
        additionalProperties: false
      },
      errorMessage: {
        minItems: 'At least one message is required',
        maxItems: `Too many messages. Max: ${ASSISTANT_MAX_MESSAGES}`
      }
    },
    context: {
      type: 'object',
      properties: {
        view: { type: 'string', maxLength: 40 },
        chainId: { type: 'number' }
      },
      additionalProperties: false
    }
  },
  required: ['messages'],
  additionalProperties: false,
  errorMessage: {
    required: { messages: 'Field "messages" is required' }
  }
};

export async function assistantRoutes(fastify) {
  fastify.get('/assistant', {
    schema: {
      description: 'Assistant availability probe. Reports whether the chat assistant is configured, which model backs it, whether the LLM server is currently reachable (checked live, cached ~30s; null when disabled), and the per-request time budget actually in effect — useful to verify a config rollout landed.',
      response: {
        200: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            model: { type: ['string', 'null'] },
            reachable: { type: ['boolean', 'null'] },
            timeoutMs: { type: ['number', 'null'] }
          }
        }
      }
    }
  }, async () => ({
    enabled: ASSISTANT_ENABLED,
    model: ASSISTANT_ENABLED ? ASSISTANT_MODEL : null,
    reachable: ASSISTANT_ENABLED ? await checkLlmReachable() : null,
    timeoutMs: ASSISTANT_ENABLED ? ASSISTANT_TIMEOUT_MS : null
  }));

  const resultSchema = {
    reply: { type: 'string' },
    toolCalls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          args: { type: 'object', additionalProperties: true }
        }
      }
    },
    degraded: { type: 'boolean' },
    offTopic: { type: 'boolean' },
    usage: {
      type: ['object', 'null'],
      properties: {
        promptTokens: { type: ['number', 'null'] },
        completionTokens: { type: ['number', 'null'] }
      }
    }
  };

  fastify.post('/assistant/chat', {
    config: {
      rateLimit: { max: ASSISTANT_RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW_MS }
    },
    schema: {
      description:
        'Chat with the assistant about chains, endpoints, scaling, relations, live incidents, and forum news. Stateless: send the full conversation each turn; the assistant may reply with a clarifying question (e.g. mainnet vs testnet) — answer it in a follow-up message. Fast answers return 200 directly; slow LLM runs return 202 with a job id to poll at GET /assistant/chat/:jobId (keeps every request under reverse-proxy timeouts).',
      body: chatBodySchema,
      response: {
        200: { type: 'object', properties: resultSchema },
        202: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            status: { type: 'string' },
            pollAfterMs: { type: 'number' },
            budgetMs: { type: 'number' }
          }
        }
      }
    }
  }, async (request, reply) => {
    if (!ASSISTANT_ENABLED) return sendError(reply, 503, 'Assistant not configured');
    const { messages, context } = request.body;
    if (messages[messages.length - 1].role !== 'user') {
      return sendError(reply, 400, 'Last message must be from the user');
    }
    if (runningJobCount() >= ASSISTANT_MAX_CONCURRENT_JOBS) {
      return sendError(reply, 503, 'Assistant busy — try again shortly');
    }
    const job = startAssistantJob({ messages, context, log: request.log });
    await waitForJob(job, ASSISTANT_SYNC_WAIT_MS);
    if (job.status === 'done') {
      jobs.delete(job.id);
      return job.result;
    }
    if (job.status === 'error') {
      jobs.delete(job.id);
      return sendError(reply, 503, job.error);
    }
    // budgetMs lets the client size its polling window to the server's
    // actual per-request budget instead of guessing a fixed deadline.
    return reply.code(202).send({ jobId: job.id, status: 'running', pollAfterMs: 2000, budgetMs: ASSISTANT_TIMEOUT_MS });
  });

  fastify.get('/assistant/chat/:jobId', {
    schema: {
      description: 'Poll an async assistant job started by POST /assistant/chat (202 response). Returns status running/done/error; done responses carry the full chat result. Finished jobs expire after ~10 minutes.',
      params: {
        type: 'object',
        properties: {
          jobId: {
            type: 'string',
            minLength: 1,
            maxLength: 64,
            pattern: '^[A-Za-z0-9-]+$',
            errorMessage: { pattern: 'Invalid job id' }
          }
        },
        required: ['jobId'],
        additionalProperties: false
      },
      response: {
        200: {
          type: 'object',
          properties: {
            jobId: { type: 'string' },
            status: { type: 'string' },
            pollAfterMs: { type: 'number' },
            error: { type: 'string' },
            ...resultSchema
          }
        }
      }
    }
  }, async (request, reply) => {
    const job = jobs.get(request.params.jobId);
    if (!job) return sendError(reply, 404, 'Job not found or expired');
    if (job.status === 'running') return { jobId: job.id, status: 'running', pollAfterMs: 2000 };
    if (job.status === 'error') return { jobId: job.id, status: 'error', error: job.error };
    return { jobId: job.id, status: 'done', ...job.result };
  });
}
