import { describe, expect, test, vi } from 'vitest';

import { PrismaRoutePlanRepository } from '../src/modules/route-plans/route-plan.repository.js';
import { RoutePlanOrderAlreadyPlannedError } from '../src/modules/route-plans/route-plan.types.js';
import type { RoutePlanOrderInput } from '../src/modules/route-plans/route-plan.types.js';

describe('PrismaRoutePlanRepository', () => {
  test('upserts selected Shopify orders and stores route stops in request sequence', async () => {
    const { prisma, routePlanStopCreateMany } = createPrismaHarness();
    const repository = new PrismaRoutePlanRepository(
      prisma as unknown as ConstructorParameters<typeof PrismaRoutePlanRepository>[0]
    );

    const result = await repository.createRoutePlanDraft({
      createdBy: 'shopify-user-id',
      depot: {
        address: 'Shopify departure location',
        latitude: 43.6532,
        longitude: -79.3832
      },
      name: 'Tomatono route draft',
      orders: [
        routePlanOrder({ gid: 'gid://shopify/Order/123', name: '#1035' }),
        routePlanOrder({ gid: 'gid://shopify/Order/124', name: '#1036' })
      ],
      planDate: '2026-05-08',
      shopDomain: 'Example.myshopify.com'
    });

    expect(result).toEqual(expect.objectContaining({ id: 'route-plan-id', stopsCount: 2 }));
    expect(prisma.shop.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shopDomain: 'example.myshopify.com' }
      })
    );
    expect(prisma.order.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          shopId_shopifyOrderGid: {
            shopId: 'shop-id',
            shopifyOrderGid: 'gid://shopify/Order/123'
          }
        }
      })
    );
    expect(prisma.deliveryStop.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          shopId_orderId: {
            orderId: 'order-1',
            shopId: 'shop-id'
          }
        }
      })
    );
    expect(routePlanStopCreateMany).toHaveBeenCalledWith({
      data: [
        { deliveryStopId: 'stop-1', routePlanId: 'route-plan-id', sequence: 1 },
        { deliveryStopId: 'stop-2', routePlanId: 'route-plan-id', sequence: 2 }
      ]
    });
  });

  test('looks up route plan detail by current shop id to preserve shop isolation', async () => {
    const { prisma } = createPrismaHarness();
    const repository = new PrismaRoutePlanRepository(
      prisma as unknown as ConstructorParameters<typeof PrismaRoutePlanRepository>[0]
    );

    await repository.findRoutePlanDetail({
      routePlanId: 'route-plan-id',
      shopDomain: 'example.myshopify.com'
    });

    expect(prisma.routePlan.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'route-plan-id',
          shopId: 'shop-id'
        }
      })
    );
  });

  test('rejects route plan drafts when a selected order already belongs to another route plan', async () => {
    const { prisma, routePlanStopCreateMany } = createPrismaHarness({
      existingRoutePlanStops: [{ deliveryStopId: 'stop-1' }]
    });
    const repository = new PrismaRoutePlanRepository(
      prisma as unknown as ConstructorParameters<typeof PrismaRoutePlanRepository>[0]
    );

    await expect(
      repository.createRoutePlanDraft({
        createdBy: 'shopify-user-id',
        depot: {
          address: 'Shopify departure location',
          latitude: 43.6532,
          longitude: -79.3832
        },
        name: 'Tomatono route draft',
        orders: [
          routePlanOrder({ gid: 'gid://shopify/Order/123', name: '#1035' }),
          routePlanOrder({ gid: 'gid://shopify/Order/124', name: '#1036' })
        ],
        planDate: '2026-05-08',
        shopDomain: 'Example.myshopify.com'
      })
    ).rejects.toBeInstanceOf(RoutePlanOrderAlreadyPlannedError);

    expect(prisma.routePlanStop.findMany).toHaveBeenCalledWith({
      select: { deliveryStopId: true },
      where: {
        deliveryStopId: { in: ['stop-1', 'stop-2'] },
        routePlan: { shopId: 'shop-id' }
      }
    });
    expect(prisma.routePlan.create).not.toHaveBeenCalled();
    expect(routePlanStopCreateMany).not.toHaveBeenCalled();
  });

  test('deletes route-plan stops first and then deletes the route plan within shop scope', async () => {
    const { prisma } = createPrismaHarness();
    const repository = new PrismaRoutePlanRepository(
      prisma as unknown as ConstructorParameters<typeof PrismaRoutePlanRepository>[0]
    );

    const result = await repository.deleteRoutePlan({
      routePlanId: 'route-plan-id',
      shopDomain: 'example.myshopify.com'
    });

    expect(result).toEqual({
      routePlanId: 'route-plan-id',
      deleted: true
    });
    expect(prisma.routePlan.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: { id: 'route-plan-id', shopId: 'shop-id' }
    });
    expect(prisma.routePlanStop.deleteMany).toHaveBeenCalledWith({
      where: { routePlanId: 'route-plan-id' }
    });
    expect(prisma.routePlan.delete).toHaveBeenCalledWith({
      where: { id: 'route-plan-id' }
    });
    expect(prisma.routePlan.delete).toHaveBeenCalledTimes(1);
  });

  test('returns deleted:false when no matching route plan is found for this shop', async () => {
    const { prisma } = createPrismaHarness({
      routePlanToDelete: null
    });
    const repository = new PrismaRoutePlanRepository(
      prisma as unknown as ConstructorParameters<typeof PrismaRoutePlanRepository>[0]
    );

    const result = await repository.deleteRoutePlan({
      routePlanId: 'route-plan-id',
      shopDomain: 'example.myshopify.com'
    });

    expect(result).toEqual({
      routePlanId: 'route-plan-id',
      deleted: false
    });
    expect(prisma.routePlan.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: { id: 'route-plan-id', shopId: 'shop-id' }
    });
    expect(prisma.routePlanStop.deleteMany).not.toHaveBeenCalled();
    expect(prisma.routePlan.delete).not.toHaveBeenCalled();
  });
});

function createPrismaHarness(input: {
  existingRoutePlanStops?: Array<{ deliveryStopId: string }>;
  routePlanToDelete?: { id: string } | null;
} = {}): {
  prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    deliveryStop: {
      upsert: ReturnType<typeof vi.fn>;
    };
    order: {
      upsert: ReturnType<typeof vi.fn>;
    };
    routePlan: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
    routePlanStop: {
      createMany: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
    shop: {
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
  };
  routePlanStopCreateMany: ReturnType<typeof vi.fn>;
} {
  const routePlanStopCreateMany = vi.fn(() => Promise.resolve({ count: 2 }));
  const prisma = {
    $transaction: vi.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(prisma)),
    deliveryStop: {
      upsert: vi
        .fn()
        .mockResolvedValueOnce({ id: 'stop-1' })
        .mockResolvedValueOnce({ id: 'stop-2' })
    },
    order: {
      upsert: vi
        .fn()
        .mockResolvedValueOnce({ id: 'order-1' })
        .mockResolvedValueOnce({ id: 'order-2' })
    },
    routePlan: {
      create: vi.fn(() =>
        Promise.resolve({
          createdAt: new Date('2026-05-07T12:30:00.000Z'),
          depotLatitude: '43.6532',
          depotLongitude: '-79.3832',
          id: 'route-plan-id',
          metrics: {
            deliveryAreas: ['Mississauga'],
            deliveryDays: ['Thursday'],
            missingCoordinates: 0,
            stopsCount: 2
          },
          name: 'Tomatono route draft',
          planDate: new Date('2026-05-08T00:00:00.000Z'),
          status: 'DRAFT',
          updatedAt: new Date('2026-05-07T12:30:00.000Z')
        })
      ),
      findFirst: vi.fn(() =>
        input.routePlanToDelete !== undefined
          ? input.routePlanToDelete === null
            ? Promise.resolve(null)
            : Promise.resolve(input.routePlanToDelete)
          : Promise.resolve({
              createdAt: new Date('2026-05-07T12:30:00.000Z'),
              depotLatitude: '43.6532',
              depotLongitude: '-79.3832',
              id: 'route-plan-id',
              metrics: {
                deliveryAreas: ['Mississauga'],
                deliveryDays: ['Thursday'],
                missingCoordinates: 0,
                stopsCount: 0
              },
              name: 'Tomatono route draft',
              planDate: new Date('2026-05-08T00:00:00.000Z'),
              routeStops: [],
              status: 'DRAFT',
              updatedAt: new Date('2026-05-07T12:30:00.000Z')
            })
      ),
      findMany: vi.fn(() => Promise.resolve([])),
      delete: vi.fn(() =>
        Promise.resolve({
          createdAt: new Date('2026-05-07T12:30:00.000Z'),
          depotLatitude: '43.6532',
          depotLongitude: '-79.3832',
          id: 'route-plan-id',
          metrics: {
            deliveryAreas: ['Mississauga'],
            deliveryDays: ['Thursday'],
            missingCoordinates: 0,
            stopsCount: 2
          },
          name: 'Tomatono route draft',
          planDate: new Date('2026-05-08T00:00:00.000Z'),
          status: 'DRAFT',
          updatedAt: new Date('2026-05-07T12:30:00.000Z')
        })
      )
    },
    routePlanStop: {
      createMany: routePlanStopCreateMany,
      findMany: vi.fn(() => Promise.resolve(input.existingRoutePlanStops ?? [])),
      deleteMany: vi.fn(() => Promise.resolve({ count: 2 }))
    },
    shop: {
      findUnique: vi.fn(() => Promise.resolve({ id: 'shop-id' })),
      upsert: vi.fn(() => Promise.resolve({ id: 'shop-id', shopDomain: 'example.myshopify.com' }))
    }
  };

  return { prisma, routePlanStopCreateMany };
}

function routePlanOrder(input: { gid: string; name: string }): RoutePlanOrderInput {
  return {
    attributes: [{ key: 'Delivery Area', value: 'Mississauga' }],
    currencyCode: 'CAD',
    deliveryArea: 'Mississauga',
    deliveryDay: 'Thursday',
    email: 'customer@example.com',
    financialStatus: 'PENDING',
    fulfillmentStatus: 'UNFULFILLED',
    latitude: 43.589,
    longitude: -79.644,
    name: input.name,
    phone: '+14165550000',
    processedAt: new Date('2026-05-07T12:00:00.000Z'),
    rawPayload: {},
    recipientName: 'Noah Yoon',
    shippingAddress: {
      address1: '300 City Centre Dr',
      address2: '#08',
      city: 'Mississauga',
      countryCode: 'CA',
      postalCode: 'L5B 3C1',
      province: 'ON'
    },
    shopifyOrderGid: input.gid,
    totalPriceAmount: '95.00'
  };
}
