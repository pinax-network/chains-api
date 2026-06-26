import { dirname, join } from 'node:path';
import { fileURLToPath as toFilePath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import ajvErrors from 'ajv-errors';
import { initializeDataOnStartup } from '../services/loader.js';
import { startRpcHealthCheck } from '../services/rpcHealth.js';
import { startL2BeatRefresh } from '../services/l2beatRefresher.js';
import { startSourceRefresher } from '../services/sourceRefresher.js';
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
import { clientsRoutes } from './routes/clients.js';
import { scalingRoutes } from './routes/scaling.js';
import { statusPagesRoutes } from './routes/statusPages.js';
import { adminRoutes } from './routes/admin.js';
import { metricsRoute } from './routes/metrics.js';
import { refresherRoute } from './routes/refresher.js';
import { rootRoute } from './routes/root.js';
import { prefetchAllPrices } from '../../priceService.js';
import { logger } from '../util/logger.js';

function resolveCorsOrigin(value) {
  if (value === '*') return true;
  return value.split(',').map(s => s.trim());
}

/**
 * Map a JSON Schema validation failure into the project's `{ error: ... }`
 * envelope.
 *
 * Preferred path: schemas declare per-keyword messages via `errorMessage`
 * (ajv-errors). When that's present, ajv emits a synthetic error with
 * `keyword: 'errorMessage'` and the schema-author's message in `.message`.
 * For schemas that haven't been migrated yet, fall through to a generic
 * "Invalid {dataVar}" string. Routes can override on a per-route basis.
 */
function formatSchemaValidationError(errors, dataVar) {
  // Prefer the route-author's `errorMessage` when present.
  const authored = errors.find(e => e.keyword === 'errorMessage' && typeof e.message === 'string');
  if (authored) {
    const err = new Error(authored.message);
    err.statusCode = 400;
    return err;
  }
  // additionalProperties needs the offending name interpolated; route
  // authors can't put `${...}` in their schema string, so handle here.
  const extra = errors.find(e => e.keyword === 'additionalProperties');
  if (extra) {
    const where = dataVar === 'querystring' ? 'query parameter' : 'field';
    const err = new Error(`Unknown ${where}: "${extra.params.additionalProperty}"`);
    err.statusCode = 400;
    return err;
  }
  const first = errors[0];
  const err = new Error(first.message || `Invalid ${dataVar}`);
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
      customOptions: {
        removeAdditional: false,
        useDefaults: true,
        coerceTypes: 'array',
        allErrors: true   // required for ajv-errors to inspect all violations
      },
      plugins: [ajvErrors]
    }
  });

  fastify.setErrorHandler((error, _request, reply) => {
    // 4xx: validation errors are safe to surface to clients.
    if (error.validation || error.statusCode === 400) {
      return reply.code(400).send({ error: error.message });
    }
    // 5xx: log full detail server-side, return generic message to client.
    // Prevents leaking internal stack/file paths and database queries.
    const statusCode = error.statusCode || 500;
    fastify.log.error(error);
    if (statusCode >= 500) {
      return reply.code(statusCode).send({ error: 'Internal Server Error' });
    }
    return reply.code(statusCode).send({ error: error.message || 'Error' });
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
    startSourceRefresher();
    // Warm the price cache in the background so the first /chains request
    // doesn't pay a CoinGecko round-trip. Failures are silent — a cold
    // cache falls back to per-request fetching with the same timeout.
    prefetchAllPrices().catch(err => {
      logger.warn({ err: err.message }, 'Initial price prefetch failed');
    });
  }

  await fastify.register(adminRoutes);
  await fastify.register(chainsRoutes);
  await fastify.register(relationsRoutes);
  await fastify.register(endpointsRoutes);
  await fastify.register(slip44Routes);
  await fastify.register(rpcMonitorRoutes);
  await fastify.register(clientsRoutes);
  await fastify.register(scalingRoutes);
  await fastify.register(statusPagesRoutes);
  await fastify.register(metricsRoute);
  await fastify.register(refresherRoute);
  await fastify.register(rootRoute);

  return fastify;
}
