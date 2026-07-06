import {
  ASSISTANT_ENABLED,
  ASSISTANT_MODEL,
  ASSISTANT_RATE_LIMIT_MAX,
  ASSISTANT_MAX_MESSAGES,
  ASSISTANT_MAX_MESSAGE_LENGTH,
  RATE_LIMIT_WINDOW_MS
} from '../../../config.js';
import { runAssistant, AssistantUnavailableError } from '../../services/assistant.js';
import { sendError } from '../util/sendError.js';

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
      description: 'Assistant availability probe. Reports whether the chat assistant is configured and which model backs it.',
      response: {
        200: {
          type: 'object',
          properties: {
            enabled: { type: 'boolean' },
            model: { type: ['string', 'null'] }
          }
        }
      }
    }
  }, async () => ({ enabled: ASSISTANT_ENABLED, model: ASSISTANT_ENABLED ? ASSISTANT_MODEL : null }));

  fastify.post('/assistant/chat', {
    config: {
      rateLimit: { max: ASSISTANT_RATE_LIMIT_MAX, timeWindow: RATE_LIMIT_WINDOW_MS }
    },
    schema: {
      description:
        'Chat with the assistant about chains, endpoints, scaling, relations, and live incidents. Stateless: send the full conversation each turn; the assistant may reply with a clarifying question (e.g. mainnet vs testnet) — answer it in a follow-up message.',
      body: chatBodySchema,
      response: {
        200: {
          type: 'object',
          properties: {
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
            usage: {
              type: ['object', 'null'],
              properties: {
                promptTokens: { type: ['number', 'null'] },
                completionTokens: { type: ['number', 'null'] }
              }
            }
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
    try {
      return await runAssistant({ messages, context, log: request.log });
    } catch (err) {
      if (err instanceof AssistantUnavailableError) {
        request.log.warn({ err: err.message }, 'assistant LLM unreachable');
        return sendError(reply, 503, 'Assistant LLM unreachable');
      }
      throw err;
    }
  });
}
