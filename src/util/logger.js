import { pino } from 'pino';

/**
 * Shared pino logger for modules outside the Fastify request lifecycle
 * (sources, services, store). Fastify has its own request-scoped logger;
 * use this one in background jobs and module-level code so log output stays
 * structured and consistent (JSON in production, pretty in TTY dev).
 *
 * Level is controlled via LOG_LEVEL env var (default: 'info').
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { component: 'chains-api' }
});
