import type { PrismaClient } from '@prisma/client';

import { ShopifySessionTokenVerifier } from '../shopify/session-token-verifier.js';
import { PrismaRoutePlanRepository } from './route-plan.repository.js';
import { RoutePlanAdminService } from './route-plan.service.js';
import type { AdminRoutePlanDependencies } from '../../routes/admin-route-plans.routes.js';

export type AdminRoutePlanRuntimeEnv = Partial<
  Record<'SHOPIFY_API_KEY' | 'SHOPIFY_API_SECRET', string>
>;

export function loadAdminRoutePlanDependencies(input: {
  env: AdminRoutePlanRuntimeEnv;
  prisma: PrismaClient;
}): AdminRoutePlanDependencies | undefined {
  const apiKey = readOptional(input.env.SHOPIFY_API_KEY);
  const apiSecret = readOptional(input.env.SHOPIFY_API_SECRET);

  if (apiKey === undefined || apiSecret === undefined) {
    return undefined;
  }

  const repository = new PrismaRoutePlanRepository(input.prisma);
  return {
    routePlanService: new RoutePlanAdminService(repository),
    sessionTokenVerifier: new ShopifySessionTokenVerifier({
      clientId: apiKey,
      clientSecret: apiSecret
    })
  };
}

function readOptional(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  return value.trim();
}
