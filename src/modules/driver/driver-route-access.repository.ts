import type { PrismaClient } from '@prisma/client';

import type {
  DriverRouteAccessCompanyGuidance,
  DriverRouteAccessLookupInput,
  DriverRouteAccessLookupResult,
  DriverRouteAccessServiceContract
} from './driver-route-access.types.js';

type DriverRouteAccessPrismaClient = Pick<PrismaClient, 'routePlan'>;

type DriverRoutePlanRecord = {
  constraints: unknown;
  driver: {
    id: string;
    phone: string | null;
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  } | null;
  id: string;
  name: string;
  planDate: Date;
  shop: {
    shopDomain: string;
  };
};

const routePlanSelect = {
  constraints: true,
  driver: { select: { id: true, phone: true, status: true } },
  id: true,
  name: true,
  planDate: true,
  shop: { select: { shopDomain: true } }
} as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class PrismaDriverRouteAccessRepository implements DriverRouteAccessServiceContract {
  constructor(private readonly prisma: DriverRouteAccessPrismaClient) {}

  async lookupRouteAccess(input: DriverRouteAccessLookupInput): Promise<DriverRouteAccessLookupResult> {
    if (!UUID_PATTERN.test(input.routeContext)) {
      return { status: 'NOT_FOUND' };
    }

    const routePlan = await this.prisma.routePlan.findUnique({
      select: routePlanSelect,
      where: { id: input.routeContext }
    });

    if (routePlan === null) {
      return { status: 'NOT_FOUND' };
    }

    return mapRoutePlan(routePlan, input);
  }
}

function mapRoutePlan(
  routePlan: DriverRoutePlanRecord,
  input: DriverRouteAccessLookupInput
): DriverRouteAccessLookupResult {
  if (routePlan.driver === null || routePlan.driver.phone !== input.phoneE164) {
    return { status: 'NOT_FOUND' };
  }

  if (routePlan.driver.status === 'INACTIVE') {
    return { status: 'DISABLED' };
  }

  if (routePlan.driver.status === 'SUSPENDED') {
    return { status: 'BLOCKED' };
  }

  return {
    driverContext: {
      driverId: routePlan.driver.id,
      shopDomain: normalizeShopDomain(routePlan.shop.shopDomain)
    },
    status: 'INVITED',
    routeAccess: {
      nextState: 'consent_required',
      routeContext: input.routeContext,
      routePlanId: routePlan.id
    },
    companyGuidance: buildCompanyGuidance(routePlan)
  };
}

function buildCompanyGuidance(routePlan: DriverRoutePlanRecord): DriverRouteAccessCompanyGuidance {
  const constraints = objectOrNull(routePlan.constraints);
  const shopDomain = normalizeShopDomain(routePlan.shop.shopDomain);
  const companyDisplayName = readString(constraints?.companyDisplayName) ?? displayNameFromShopDomain(shopDomain);

  return {
    companyDisplayName,
    deliveryDate: routePlan.planDate.toISOString().slice(0, 10),
    driverInstructions: readStringArray(constraints?.driverInstructions),
    operatorSupportContact: readString(constraints?.operatorSupportContact),
    pickupGuidance: readString(constraints?.pickupGuidance),
    routeName: routePlan.name,
    shopDomain,
    timezone: readString(constraints?.timezone)
  };
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const text = readString(item);
    return text === null ? [] : [text];
  });
}

function normalizeShopDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//u, '').replace(/\/$/u, '');
}

function displayNameFromShopDomain(shopDomain: string): string {
  return shopDomain.replace(/\.myshopify\.com$/u, '');
}
