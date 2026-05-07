import { describe, expect, test, vi } from 'vitest';

import { PrismaRoutePlanRepository } from '../src/modules/route-plans/route-plan.repository.js';
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
});

function createPrismaHarness(): {
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
    };
    routePlanStop: {
      createMany: ReturnType<typeof vi.fn>;
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
        Promise.resolve({
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
      findMany: vi.fn(() => Promise.resolve([]))
    },
    routePlanStop: {
      createMany: routePlanStopCreateMany
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
