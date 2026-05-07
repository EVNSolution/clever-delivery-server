import { PrismaClient } from '@prisma/client';

import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { loadShopifyAuthDependencies } from './modules/shopify/auth.dependencies.js';

const env = loadEnv();
const prisma = new PrismaClient();
const shopifyAuth = loadShopifyAuthDependencies({ env: process.env, prisma });
const logger = env.nodeEnv === 'test' ? false : { level: env.logLevel };
const app = await buildApp(
  shopifyAuth === undefined
    ? { logger }
    : {
        logger,
        shopifyAuth
      }
);

try {
  await app.listen({ host: '0.0.0.0', port: env.port });
  app.log.info({ port: env.port }, 'clever-delivery-server listening');
} catch (error) {
  app.log.error(error, 'failed to start clever-delivery-server');
  process.exitCode = 1;
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().finally(() => {
      void prisma.$disconnect().finally(() => {
        process.kill(process.pid, signal);
      });
    });
  });
}
