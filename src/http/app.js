import { dirname, join } from 'node:path';
import { fileURLToPath as toFilePath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { initializeDataOnStartup, startRpcHealthCheck } from '../../dataService.js';
import { startL2BeatRefresh } from '../services/l2beatRefresher.js';
import {
  BODY_LIMIT,
  MAX_PARAM_LENGTH,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  CORS_ORIGIN
} from '../../config.js';
import { chainsRoutes } from './routes/chains.js';
import { relationsRoutes } from './routes/relations.js';
import { endpointsRoutes } from './routes/endpoints.js';
import { slip44Routes } from './routes/slip44.js';
import { rpcMonitorRoutes } from './routes/rpcMonitor.js';
import { scalingRoutes } from './routes/scaling.js';
import { adminRoutes } from './routes/admin.js';
import { rootRoute } from './routes/root.js';

function resolveCorsOrigin(value) {
  if (value === '*') return true;
  return value.split(',').map(s => s.trim());
}

// Field-name → user-friendly noun for error messages. Defaults to the field
// name itself when not listed.
const FIELD_NOUNS = {
  id: 'chain ID',
  coinType: 'coin type',
  tag: 'tag',
  q: 'q',
  depth: 'depth'
};

function nounFor(field) {
  return FIELD_NOUNS[field] ?? field;
}

/**
 * Translate a JSON Schema validation failure into the project's `{ error: ... }`
 * envelope, preserving the wording style of the manual sendError() messages
 * the handlers used to produce before schemas were added.
 */
function formatSchemaValidationError(errors, dataVar) {
  const first = errors[0];
  const field = (first.instancePath || '').replace(/^\//, '')
    || first.params?.missingProperty
    || '';
  const noun = nounFor(field);

  let detail;
  switch (first.keyword) {
    case 'enum':
      detail = `Invalid ${noun}. Allowed: ${first.params.allowedValues.join(', ')}`;
      break;
    case 'required':
      detail = `Query parameter "${first.params.missingProperty}" is required`;
      break;
    case 'maxLength':
      detail = noun === 'q'
        ? `Query too long. Max length: ${first.params.limit}`
        : `${noun} too long. Max length: ${first.params.limit}`;
      break;
    case 'minLength':
      detail = `Query parameter "${field}" is required`;
      break;
    case 'pattern':
    case 'type':
      // Depth values that look numeric but aren't integers fall here.
      detail = field === 'depth'
        ? 'Invalid depth. Must be between 1 and 5'
        : `Invalid ${noun}`;
      break;
    case 'minimum':
    case 'maximum':
      detail = `Invalid ${noun}. Must be between ${first.parentSchema?.minimum ?? '?'} and ${first.parentSchema?.maximum ?? '?'}`;
      break;
    case 'additionalProperties':
      detail = `Unknown ${dataVar === 'querystring' ? 'query parameter' : 'field'}: "${first.params.additionalProperty}"`;
      break;
    default:
      detail = first.message || `Invalid ${dataVar}`;
  }

  const err = new Error(detail);
  err.statusCode = 400;
  return err;
}

export async function buildApp(options = {}) {
  const {
    logger = true,
    bodyLimit = BODY_LIMIT,
    maxParamLength = MAX_PARAM_LENGTH,
    loadDataOnStartup = true
  } = options;

  const fastify = Fastify({
    logger,
    bodyLimit,
    maxParamLength,
    schemaErrorFormatter: formatSchemaValidationError,
    ajv: {
      // Default fastify behavior silently strips unknown query params;
      // disable so additionalProperties:false on schemas actually rejects them.
      customOptions: { removeAdditional: false, useDefaults: true, coerceTypes: 'array' }
    }
  });

  fastify.setErrorHandler((error, _request, reply) => {
    if (error.validation || error.statusCode === 400) {
      return reply.code(400).send({ error: error.message });
    }
    fastify.log.error(error);
    return reply.code(error.statusCode || 500).send({ error: error.message || 'Internal Server Error' });
  });

  await fastify.register(cors, {
    origin: resolveCorsOrigin(CORS_ORIGIN),
    credentials: false
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'data:']
      }
    }
  });

  // Serve public/ directory for the 3D visualization UI.
  // Resolve relative to the project root (two levels up from src/http/).
  const __dir = dirname(toFilePath(import.meta.url));
  await fastify.register(fastifyStatic, {
    root: join(__dir, '..', '..', 'public'),
    prefix: '/ui/',
    decorateReply: false
  });

  await fastify.register(rateLimit, {
    max: RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW_MS
  });

  if (loadDataOnStartup) {
    await initializeDataOnStartup({
      onBackgroundRefreshSuccess: () => {
        startRpcHealthCheck();
        startL2BeatRefresh();
      }
    });
    startRpcHealthCheck();
    startL2BeatRefresh();
  }

  await fastify.register(adminRoutes);
  await fastify.register(chainsRoutes);
  await fastify.register(relationsRoutes);
  await fastify.register(endpointsRoutes);
  await fastify.register(slip44Routes);
  await fastify.register(rpcMonitorRoutes);
  await fastify.register(scalingRoutes);
  await fastify.register(rootRoute);

  return fastify;
}
