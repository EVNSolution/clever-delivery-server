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

  test('returns not found for non-UUID route contexts before querying Prisma', async () => {
    const { prisma } = createPrismaHarness();
    const repository = new PrismaDriverRouteAccessRepository(prisma as never);

    await expect(
      repository.lookupRouteAccess({ phoneE164: '+14165550123', routeContext: 'tomato-route' })
    ).resolves.toEqual({ status: 'NOT_FOUND' });
    expect(prisma.routePlan.findUnique).not.toHaveBeenCalled();
  });
});

function createPrismaHarness(
  overrides: { driverStatus?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'; routePlan?: ReturnType<typeof routePlanRecord> | null } = {}
): {
  prisma: {
    routePlan: {
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
        findUnique: vi.fn(() => Promise.resolve(routePlan))
      }
    }
  };
}

function routePlanRecord(overrides: { driverStatus?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' } = {}) {
  return {
    constraints: {
      companyDisplayName: 'Tomatono Toronto',
      driverInstructions: ['Bring insulated bag'],
      operatorSupportContact: '+14165550000',
      pickupGuidance: 'Meet at dispatch desk by 9:00 AM',
      timezone: 'America/Toronto'
    },
    driver: {
      id: 'driver-id',
      phone: '+14165550123',
      status: overrides.driverStatus ?? 'ACTIVE'
    },
    id: routePlanId,
    name: 'Tuesday AM Route',
    planDate: new Date('2026-05-12T00:00:00.000Z'),
    shop: {
      shopDomain: 'tomatono.myshopify.com'
    }
  };
}
