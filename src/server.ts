import { PrismaClient } from '@prisma/client';

import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { loadDriverApiDependencies } from './modules/driver/driver.dependencies.js';
import { loadAdminRoutePlanDependencies } from './modules/route-plans/route-plan.dependencies.js';
import { loadAdminOrdersDependencies } from './modules/shopify/order-sync.dependencies.js';
import { loadShopifyAuthDependencies } from './modules/shopify/auth.dependencies.js';
import { loadShopifyWebhookDependencies } from './modules/shopify/webhook.dependencies.js';
import type { AdminRoutePlanDependencies } from './routes/admin-route-plans.routes.js';
import type { AdminOrdersDependencies } from './routes/admin-orders.routes.js';
import type { DriverApiDependencies } from './routes/driver-events.routes.js';
import type { ShopifyAuthDependencies } from './routes/shopify-auth.routes.js';
import type { ShopifyWebhookDependencies } from './routes/shopify-webhook.routes.js';

const env = loadEnv();
const prisma = new PrismaClient();
const adminOrders = loadAdminOrdersDependencies({ env: process.env, prisma });
const adminRoutePlans = loadAdminRoutePlanDependencies({ env: process.env, prisma });
const driverApi = loadDriverApiDependencies({ env: process.env, prisma });
const shopifyAuth = loadShopifyAuthDependencies({ env: process.env, prisma });
const shopifyWebhook = loadShopifyWebhookDependencies({ env: process.env, prisma });
const logger = env.nodeEnv === 'test' ? false : { level: env.logLevel };
const app = await buildApp(
  createBuildAppOptions({
    adminOrders,
    adminRoutePlans,
    corsOrigin: readCorsOrigin(process.env.SHOPIFY_APP_URL),
    driverApi,
    logger,
    shopifyAuth,
    shopifyWebhook
  })
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

function createBuildAppOptions(input: {
  adminOrders: AdminOrdersDependencies | undefined;
  adminRoutePlans: AdminRoutePlanDependencies | undefined;
  corsOrigin: false | string;
  driverApi: DriverApiDependencies | undefined;
  logger: false | { level: string };
  shopifyAuth: ShopifyAuthDependencies | undefined;
  shopifyWebhook: ShopifyWebhookDependencies | undefined;
}): {
  adminOrders?: AdminOrdersDependencies;
  adminRoutePlans?: AdminRoutePlanDependencies;
  corsOrigin?: false | string;
  driverApi?: DriverApiDependencies;
  logger: false | { level: string };
  shopifyAuth?: ShopifyAuthDependencies;
  shopifyWebhook?: ShopifyWebhookDependencies;
} {
  return {
    ...(input.adminOrders === undefined ? {} : { adminOrders: input.adminOrders }),
    ...(input.adminRoutePlans === undefined ? {} : { adminRoutePlans: input.adminRoutePlans }),
    corsOrigin: input.corsOrigin,
    ...(input.driverApi === undefined ? {} : { driverApi: input.driverApi }),
    logger: input.logger,
    ...(input.shopifyAuth === undefined ? {} : { shopifyAuth: input.shopifyAuth }),
    ...(input.shopifyWebhook === undefined ? {} : { shopifyWebhook: input.shopifyWebhook })
  };
}

function readCorsOrigin(value: string | undefined): false | string {
  if (value === undefined || value.trim() === '') {
    return false;
  }

  return value.trim();
}
