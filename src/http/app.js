import { dirname, join } from 'node:path';
import { fileURLToPath as toFilePath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { initializeDataOnStartup, startRpcHealthCheck } from '../../dataService.js';
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
import { adminRoutes } from './routes/admin.js';
import { rootRoute } from './routes/root.js';

function resolveCorsOrigin(value) {
  if (value === '*') return true;
  return value.split(',').map(s => s.trim());
}

export async function buildApp(options = {}) {
  const {
    logger = true,
    bodyLimit = BODY_LIMIT,
    maxParamLength = MAX_PARAM_LENGTH,
    loadDataOnStartup = true
  } = options;

  const fastify = Fastify({ logger, bodyLimit, maxParamLength });

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
      }
    });
    startRpcHealthCheck();
  }

  await fastify.register(adminRoutes);
  await fastify.register(chainsRoutes);
  await fastify.register(relationsRoutes);
  await fastify.register(endpointsRoutes);
  await fastify.register(slip44Routes);
  await fastify.register(rpcMonitorRoutes);
  await fastify.register(rootRoute);

  return fastify;
}
