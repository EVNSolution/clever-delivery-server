import { describe, expect, test, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import type { RoutePlanDetailStop } from '../src/modules/route-plans/route-plan.types.js';
import type { AdminRoutePlanDependencies } from '../src/routes/admin-route-plans.routes.js';

const routePlanSummary = {
  createdAt: '2026-05-07T12:30:00.000Z',
  deliveryAreas: ['Mississauga'],
  deliveryDays: ['Thursday'],
  depot: {
    latitude: 43.6532,
    longitude: -79.3832
  },
  id: 'route-plan-id',
  missingCoordinates: 0,
  name: 'Tomatono route draft',
  planDate: '2026-05-08',
  status: 'DRAFT',
  stopsCount: 1,
  updatedAt: '2026-05-07T12:30:00.000Z'
};

describe('Admin route plan routes', () => {
  test('rejects route plan creation without a Shopify session token', async () => {
    const { createRoutePlan, dependencies } = createDependencyHarness();
    const app = await buildApp({ adminRoutePlans: dependencies });

    try {
      const response = await app.inject({
        method: 'POST',
        payload: routePlanPayload(),
        url: '/admin/route-plans'
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Missing bearer session token' }
      });
      expect(createRoutePlan).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test('rejects invalid route plan payloads before persisting', async () => {
    const { createRoutePlan, dependencies } = createDependencyHarness();
    const app = await buildApp({ adminRoutePlans: dependencies });

    try {
      const response = await app.inject({
        headers: { authorization: 'Bearer session-token' },
        method: 'POST',
        payload: { name: '', orders: [] },
        url: '/admin/route-plans'
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        data: null,
        error: { code: 'BAD_REQUEST', message: 'Invalid route plan payload' }
      });
      expect(createRoutePlan).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  test('creates a draft route plan for the token shop', async () => {
    const { createRoutePlan, dependencies } = createDependencyHarness();
    const app = await buildApp({ adminRoutePlans: dependencies });

    try {
      const response = await app.inject({
        headers: { authorization: 'Bearer session-token' },
        method: 'POST',
        payload: routePlanPayload(),
        url: '/admin/route-plans'
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        data: {
          routePlan: routePlanSummary
        },
        error: null
      });
      expect(createRoutePlan).toHaveBeenCalledWith({
        createdBy: 'shopify-user-id',
        payload: {
          ...routePlanPayload(),
          orders: [
            expect.objectContaining({
              processedAt: new Date('2026-05-07T12:00:00.000Z'),
              shopifyOrderGid: 'gid://shopify/Order/123'
            })
          ]
        },
        shopDomain: 'example.myshopify.com'
      });
    } finally {
      await app.close();
    }
  });

  test('lists route plans for the token shop', async () => {
    const { dependencies, listRoutePlans } = createDependencyHarness();
    const app = await buildApp({ adminRoutePlans: dependencies });

    try {
      const response = await app.inject({
        headers: { authorization: 'Bearer session-token' },
        method: 'GET',
        url: '/admin/route-plans'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: {
          routePlans: [routePlanSummary]
        },
        error: null
      });
      expect(listRoutePlans).toHaveBeenCalledWith({ shopDomain: 'example.myshopify.com' });
    } finally {
      await app.close();
    }
  });

  test('returns route plan detail stops in sequence order', async () => {
    const { dependencies, getRoutePlanDetail } = createDependencyHarness();
    const app = await buildApp({ adminRoutePlans: dependencies });

    try {
      const response = await app.inject({
        headers: { authorization: 'Bearer session-token' },
        method: 'GET',
        url: '/admin/route-plans/route-plan-id'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        data: {
          routePlan: routePlanSummary,
          stops: [
            expect.objectContaining({ orderName: '#1035', sequence: 1 }),
            expect.objectContaining({ orderName: '#1036', sequence: 2 })
          ]
        },
        error: null
      });
      expect(getRoutePlanDetail).toHaveBeenCalledWith({
        routePlanId: 'route-plan-id',
        shopDomain: 'example.myshopify.com'
      });
    } finally {
      await app.close();
    }
  });

  test('does not expose another shop route plan detail', async () => {
    const { dependencies, getRoutePlanDetail } = createDependencyHarness();
    getRoutePlanDetail.mockResolvedValueOnce(null);
    const app = await buildApp({ adminRoutePlans: dependencies });

    try {
      const response = await app.inject({
        headers: { authorization: 'Bearer session-token' },
        method: 'GET',
        url: '/admin/route-plans/other-shop-route-plan-id'
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        data: null,
        error: { code: 'NOT_FOUND', message: 'Route plan not found' }
      });
    } finally {
      await app.close();
    }
  });
});

function createDependencyHarness(): {
  createRoutePlan: ReturnType<
    typeof vi.fn<AdminRoutePlanDependencies['routePlanService']['createRoutePlan']>
  >;
  dependencies: AdminRoutePlanDependencies;
  getRoutePlanDetail: ReturnType<
    typeof vi.fn<AdminRoutePlanDependencies['routePlanService']['getRoutePlanDetail']>
  >;
  listRoutePlans: ReturnType<
    typeof vi.fn<AdminRoutePlanDependencies['routePlanService']['listRoutePlans']>
  >;
} {
  const verify = vi.fn(() => ({
    shopDomain: 'example.myshopify.com',
    subject: 'shopify-user-id'
  }));
  const createRoutePlan = vi.fn<AdminRoutePlanDependencies['routePlanService']['createRoutePlan']>(
    () => Promise.resolve(routePlanSummary)
  );
  const listRoutePlans = vi.fn<AdminRoutePlanDependencies['routePlanService']['listRoutePlans']>(
    () => Promise.resolve([routePlanSummary])
  );
  const getRoutePlanDetail = vi.fn<
    AdminRoutePlanDependencies['routePlanService']['getRoutePlanDetail']
  >(() =>
    Promise.resolve({
      routePlan: routePlanSummary,
      stops: [
        routePlanStop({ orderName: '#1035', sequence: 1 }),
        routePlanStop({ orderName: '#1036', sequence: 2 })
      ]
    })
  );

  return {
    createRoutePlan,
    dependencies: {
      routePlanService: {
        createRoutePlan,
        getRoutePlanDetail,
        listRoutePlans
      },
      sessionTokenVerifier: {
        verify
      }
    },
    getRoutePlanDetail,
    listRoutePlans
  };
}

function routePlanPayload(): Record<string, unknown> {
  return {
    depot: {
      address: 'Shopify departure location',
      latitude: 43.6532,
      longitude: -79.3832
    },
    name: 'Tomatono route draft',
    orders: [
      {
        attributes: [{ key: 'Delivery Area', value: 'Mississauga' }],
        currencyCode: 'CAD',
        deliveryArea: 'Mississauga',
        deliveryDay: 'Thursday',
        email: 'customer@example.com',
        financialStatus: 'PENDING',
        fulfillmentStatus: 'UNFULFILLED',
        latitude: 43.589,
        longitude: -79.644,
        name: '#1035',
        phone: '+14165550000',
        processedAt: '2026-05-07T12:00:00.000Z',
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
        shopifyOrderGid: 'gid://shopify/Order/123',
        totalPriceAmount: '95.00'
      }
    ],
    planDate: '2026-05-08'
  };
}

function routePlanStop(input: { orderName: string; sequence: number }): RoutePlanDetailStop {
  return {
    address: {
      address1: '300 City Centre Dr',
      address2: '#08',
      city: 'Mississauga',
      countryCode: 'CA',
      postalCode: 'L5B 3C1',
      province: 'ON'
    },
    attributes: [{ key: 'Delivery Area', value: 'Mississauga' }],
    coordinates: {
      latitude: 43.589,
      longitude: -79.644
    },
    deliveryArea: 'Mississauga',
    deliveryDay: 'Thursday',
    deliveryStopId: `stop-${input.sequence}`,
    financialStatus: 'PENDING',
    fulfillmentStatus: 'UNFULFILLED',
    orderId: `order-${input.sequence}`,
    orderName: input.orderName,
    paymentStatus: 'PENDING',
    recipientName: 'Noah Yoon',
    sequence: input.sequence,
    shopifyOrderGid: `gid://shopify/Order/${input.sequence}`,
    status: 'PENDING'
  };
}
