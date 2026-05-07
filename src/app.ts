import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';

import { registerHealthRoutes } from './routes/health.routes.js';

type BuildAppOptions = {
  logger?: FastifyServerOptions['logger'];
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(helmet);
  await app.register(cors, { origin: false });
  registerHealthRoutes(app);

  return app;
}
