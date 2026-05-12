import { describe, expect, test, vi } from 'vitest';

import { PrismaDriverRouteAccessRepository } from '../src/modules/driver/driver-route-access.repository.js';

const routePlanId = '11111111-1111-4111-8111-111111111111';

describe('PrismaDriverRouteAccessRepository', () => {
  test('matches an active assigned driver and maps non-sensitive company guidance', async () => {
    const { prisma } = createPrismaHarness();
    const repository = new PrismaDriverRouteAccessRepository(prisma as never);

    const result = await repository.lookupRouteAccess({
      phoneE164: '+14165550123',
      routeContext: routePlanId
    });

    expect(prisma.routePlan.findUnique).toHaveBeenCalledWith({
      select: {
        constraints: true,
        driver: { select: { id: true, phone: true, status: true } },
        id: true,
        name: true,
        planDate: true,
        shop: { select: { shopDomain: true } }
      },
      where: { id: routePlanId }
    });
    expect(result).toEqual({
      driverContext: {
        driverId: 'driver-id',
        shopDomain: 'tomatono.myshopify.com'
      },
      status: 'INVITED',
      routeAccess: {
        nextState: 'consent_required',
        routeContext: routePlanId,
        routePlanId
      },
      companyGuidance: {
        companyDisplayName: 'Tomatono Toronto',
        deliveryDate: '2026-05-12',
        driverInstructions: ['Bring insulated bag'],
        operatorSupportContact: '+14165550000',
        pickupGuidance: 'Meet at dispatch desk by 9:00 AM',
        routeName: 'Tuesday AM Route',
        shopDomain: 'tomatono.myshopify.com',
        timezone: 'America/Toronto'
      }
    });
    expect(JSON.stringify(result)).not.toContain('routeStops');
    expect(JSON.stringify(result)).not.toContain('address1');
  });

  test('does not reveal route guidance when the phone does not match the assigned driver', async () => {
    const { prisma } = createPrismaHarness();
    const repository = new PrismaDriverRouteAccessRepository(prisma as never);

    await expect(
      repository.lookupRouteAccess({ phoneE164: '+14165559999', routeContext: routePlanId })
    ).resolves.toEqual({ status: 'NOT_FOUND' });
  });

  test('maps inactive and suspended assigned drivers to safe denial statuses', async () => {
    const inactive = new PrismaDriverRouteAccessRepository(
      createPrismaHarness({ driverStatus: 'INACTIVE' }).prisma as never
    );
    const suspended = new PrismaDriverRouteAccessRepository(
      createPrismaHarness({ driverStatus: 'SUSPENDED' }).prisma as never
    );

    await expect(
      inactive.lookupRouteAccess({ phoneE164: '+14165550123', routeContext: routePlanId })
    ).resolves.toEqual({ status: 'DISABLED' });
    await expect(
      suspended.lookupRouteAccess({ phoneE164: '+14165550123', routeContext: routePlanId })
    ).resolves.toEqual({ status: 'BLOCKED' });
  });

  test('returns multiple matches for shared route scope without route or token evidence', async () => {
    const { prisma } = createPrismaHarness({
      sharedRoutePlans: [
        routePlanRecord({
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Tuesday AM Route'
        }),
        routePlanRecord({
          id: '33333333-3333-4333-8333-333333333333',
          name: 'North PM Route',
          shopDomain: 'north-market.myshopify.com'
        })
      ]
    });
    const repository = new PrismaDriverRouteAccessRepository(prisma as never);

    const result = await repository.lookupRouteAccess({
      phoneE164: '+14165550123',
      routeContext: 'toronto-shared-route-code'
    });

    expect(prisma.routePlan.findMany).toHaveBeenCalledWith({
      orderBy: [{ planDate: 'asc' }, { name: 'asc' }],
      select: {
        constraints: true,
        driver: { select: { id: true, phone: true, status: true } },
        id: true,
        name: true,
        planDate: true,
        shop: { select: { shopDomain: true } }
      },
      take: 3,
      where: {
        constraints: { path: ['routeScope', 'routeScopeKey'], equals: 'toronto-shared-route-code' },
        driver: { is: { phone: '+14165550123', status: 'ACTIVE' } }
      }
    });
    expect(result).toEqual({
      status: 'MULTIPLE_MATCHES',
      matches: [
        {
          companyDisplayName: 'Tomatono Toronto',
          deliveryDate: '2026-05-12',
          operatorSupportContact: '+14165550000',
          pickupGuidance: 'Meet at dispatch desk by 9:00 AM',
          routeName: 'Tuesday AM Route',
          shopDomain: 'tomatono.myshopify.com',
          timezone: 'America/Toronto'
        },
        {
          companyDisplayName: 'North Market',
          deliveryDate: '2026-05-12',
          operatorSupportContact: '+14165550000',
          pickupGuidance: 'Meet at dispatch desk by 9:00 AM',
          routeName: 'North PM Route',
          shopDomain: 'north-market.myshopify.com',
          timezone: 'America/Toronto'
        }
      ],
      resolutionHint: 'Use the route-specific invite link/code from dispatch.'
    });
    expect(JSON.stringify(result)).not.toContain('driverContext');
    expect(JSON.stringify(result)).not.toContain('routePlanId');
    expect(JSON.stringify(result)).not.toContain('routeAccess');
    expect(JSON.stringify(result)).not.toContain('address1');
  });

  test('maps one shared route scope match to invited route access', async () => {
    const { prisma } = createPrismaHarness({
      sharedRoutePlans: [routePlanRecord({ id: '22222222-2222-4222-8222-222222222222' })]
    });
    const repository = new PrismaDriverRouteAccessRepository(prisma as never);

    const result = await repository.lookupRouteAccess({
      phoneE164: '+14165550123',
      routeContext: 'toronto-shared-route-code'
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'INVITED',
      routeAccess: {
        nextState: 'consent_required',
        routeContext: '22222222-2222-4222-8222-222222222222',
        routePlanId: '22222222-2222-4222-8222-222222222222'
      }
    }));
  });

  test('returns not found for non-UUID route contexts with no active shared match', async () => {
    const { prisma } = createPrismaHarness();
    const repository = new PrismaDriverRouteAccessRepository(prisma as never);

    await expect(
      repository.lookupRouteAccess({ phoneE164: '+14165550123', routeContext: 'tomato-route' })
    ).resolves.toEqual({ status: 'NOT_FOUND' });
    expect(prisma.routePlan.findUnique).not.toHaveBeenCalled();
    expect(prisma.routePlan.findMany).toHaveBeenCalledOnce();
  });
});

function createPrismaHarness(
  overrides: {
    driverStatus?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
    routePlan?: ReturnType<typeof routePlanRecord> | null;
    sharedRoutePlans?: ReturnType<typeof routePlanRecord>[];
  } = {}
): {
  prisma: {
    routePlan: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
} {
  const routePlan = overrides.routePlan === undefined
    ? routePlanRecord(overrides.driverStatus === undefined ? {} : { driverStatus: overrides.driverStatus })
    : overrides.routePlan;
  return {
    prisma: {
      routePlan: {
        findMany: vi.fn(() => Promise.resolve(overrides.sharedRoutePlans ?? [])),
        findUnique: vi.fn(() => Promise.resolve(routePlan))
      }
    }
  };
}

function routePlanRecord(
  overrides: {
    driverStatus?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
    id?: string;
    name?: string;
    shopDomain?: string;
  } = {}
) {
  const shopDomain = overrides.shopDomain ?? 'tomatono.myshopify.com';
  return {
    constraints: {
      companyDisplayName: shopDomain === 'north-market.myshopify.com' ? 'North Market' : 'Tomatono Toronto',
      driverInstructions: ['Bring insulated bag'],
      operatorSupportContact: '+14165550000',
      pickupGuidance: 'Meet at dispatch desk by 9:00 AM',
      routeScope: {
        routeScopeKey: 'toronto-shared-route-code'
      },
      timezone: 'America/Toronto'
    },
    driver: {
      id: 'driver-id',
      phone: '+14165550123',
      status: overrides.driverStatus ?? 'ACTIVE'
    },
    id: overrides.id ?? routePlanId,
    name: overrides.name ?? 'Tuesday AM Route',
    planDate: new Date('2026-05-12T00:00:00.000Z'),
    shop: {
      shopDomain
    }
  };
}
