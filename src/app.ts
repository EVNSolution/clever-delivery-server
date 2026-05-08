import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';

import {
  registerAdminRoutePlanRoutes,
  type AdminRoutePlanDependencies
} from './routes/admin-route-plans.routes.js';
import { registerAdminOrdersRoutes, type AdminOrdersDependencies } from './routes/admin-orders.routes.js';
import { registerDriverEventRoutes, type DriverApiDependencies } from './routes/driver-events.routes.js';
import { registerJsonBodyParser } from './routes/json-body-parser.js';
import { registerHealthRoutes } from './routes/health.routes.js';
import { registerShopifyAuthRoutes, type ShopifyAuthDependencies } from './routes/shopify-auth.routes.js';
import {
  registerShopifyWebhookRoutes,
  type ShopifyWebhookDependencies
} from './routes/shopify-webhook.routes.js';

type BuildAppOptions = {
  adminOrders?: AdminOrdersDependencies;
  adminRoutePlans?: AdminRoutePlanDependencies;
  corsOrigin?: false | string;
  driverApi?: DriverApiDependencies;
  logger?: FastifyServerOptions['logger'];
  shopifyAuth?: ShopifyAuthDependencies;
  shopifyWebhook?: ShopifyWebhookDependencies;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  registerJsonBodyParser(app);
  await app.register(helmet);
  await app.register(cors, { origin: options.corsOrigin ?? false });
  registerHealthRoutes(app);

  if (options.adminOrders !== undefined) {
    registerAdminOrdersRoutes(app, options.adminOrders);
  }

  if (options.adminRoutePlans !== undefined) {
    registerAdminRoutePlanRoutes(app, options.adminRoutePlans);
  }

  if (options.driverApi !== undefined) {
    registerDriverEventRoutes(app, options.driverApi);
  }

  if (options.shopifyAuth !== undefined) {
    registerShopifyAuthRoutes(app, options.shopifyAuth);
  }

  if (options.shopifyWebhook !== undefined) {
    registerShopifyWebhookRoutes(app, options.shopifyWebhook);
  }

  return app;
}
