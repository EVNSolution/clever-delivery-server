import { PrismaClient } from '@prisma/client';

import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { loadShopifyAuthDependencies } from './modules/shopify/auth.dependencies.js';
import { loadShopifyWebhookDependencies } from './modules/shopify/webhook.dependencies.js';
import type { ShopifyAuthDependencies } from './routes/shopify-auth.routes.js';
import type { ShopifyWebhookDependencies } from './routes/shopify-webhook.routes.js';

const env = loadEnv();
const prisma = new PrismaClient();
const shopifyAuth = loadShopifyAuthDependencies({ env: process.env, prisma });
const shopifyWebhook = loadShopifyWebhookDependencies({ env: process.env, prisma });
const logger = env.nodeEnv === 'test' ? false : { level: env.logLevel };
const app = await buildApp(createBuildAppOptions({ logger, shopifyAuth, shopifyWebhook }));

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

function createBuildAppOptions(input: {
  logger: false | { level: string };
  shopifyAuth: ShopifyAuthDependencies | undefined;
  shopifyWebhook: ShopifyWebhookDependencies | undefined;
}): {
  logger: false | { level: string };
  shopifyAuth?: ShopifyAuthDependencies;
  shopifyWebhook?: ShopifyWebhookDependencies;
} {
  return {
    logger: input.logger,
    ...(input.shopifyAuth === undefined ? {} : { shopifyAuth: input.shopifyAuth }),
    ...(input.shopifyWebhook === undefined ? {} : { shopifyWebhook: input.shopifyWebhook })
  };
}
