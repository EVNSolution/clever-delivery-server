import { describe, expect, test, vi } from 'vitest';

import { RoutePlanAdminService } from '../src/modules/route-plans/route-plan.service.js';
import type { RouteGeometryProvider, RoutePlanRepository } from '../src/modules/route-plans/route-plan.service.js';
import type { RoutePlanDetail, RoutePlanRouteGeometry } from '../src/modules/route-plans/route-plan.types.js';

const routePlanDetail = {
  routePlan: {
    createdAt: '2026-05-07T12:30:00.000Z',
    deliveryAreas: ['Scarborough'],
    deliveryDays: ['Friday'],
    depot: { latitude: 43.6532, longitude: -79.3832 },
    id: 'route-plan-id',
    missingCoordinates: 0,
    name: 'Friday route',
    planDate: '2026-05-15',
    status: 'DRAFT',
    stopsCount: 2,
    updatedAt: '2026-05-07T12:30:00.000Z'
  },
  stops: [
    routeStop({ sequence: 1, latitude: 43.7764, longitude: -79.2571 }),
    routeStop({ sequence: 2, latitude: 43.8561, longitude: -79.3370 })
  ],
  routeGeometry: null
} satisfies RoutePlanDetail;

describe('RoutePlanAdminService route geometry', () => {
  test('enriches route detail with OSRM geometry using depot and ordered stops', async () => {
    const { repository, routeGeometryProvider } = createHarness(routePlanDetail);
    const service = new RoutePlanAdminService(repository, routeGeometryProvider);

    const detail = await service.getRoutePlanDetail({
      routePlanId: 'route-plan-id',
      shopDomain: 'example.myshopify.com'
    });

    expect(routeGeometryProvider.buildRouteGeometry).toHaveBeenCalledWith({
      routePlan: routePlanDetail.routePlan,
      stops: routePlanDetail.stops,
      routeGeometry: null
    });
    expect(detail?.routeGeometry).toEqual({
      type: 'LineString',
      coordinates: [
        [-79.3832, 43.6532],
        [-79.2571, 43.7764],
        [-79.337, 43.8561]
      ]
    });
  });

  test('returns route detail without failing when route geometry generation fails', async () => {
    const { repository, routeGeometryProvider } = createHarness(routePlanDetail);
    routeGeometryProvider.buildRouteGeometry.mockRejectedValueOnce(new Error('OSRM unavailable'));
    const service = new RoutePlanAdminService(repository, routeGeometryProvider);

    const detail = await service.getRoutePlanDetail({
      routePlanId: 'route-plan-id',
      shopDomain: 'example.myshopify.com'
    });

    expect(detail?.routePlan.id).toBe('route-plan-id');
    expect(detail?.routeGeometry).toBeNull();
  });

  test('enriches updated route stops with OSRM geometry after repository save', async () => {
    const { repository, routeGeometryProvider, updateRoutePlanStops } = createHarness(routePlanDetail);
    const service = new RoutePlanAdminService(repository, routeGeometryProvider);

    const detail = await service.updateRoutePlanStops({
      routePlanId: 'route-plan-id',
      shopDomain: 'example.myshopify.com',
      payload: {
        stops: [
          { shopifyOrderGid: 'gid://shopify/Order/102', sequence: 1 },
          { shopifyOrderGid: 'gid://shopify/Order/101', sequence: 2 }
        ]
      }
    });

    expect(updateRoutePlanStops).toHaveBeenCalledWith({
      routePlanId: 'route-plan-id',
      shopDomain: 'example.myshopify.com',
      payload: {
        stops: [
          { shopifyOrderGid: 'gid://shopify/Order/102', sequence: 1 },
          { shopifyOrderGid: 'gid://shopify/Order/101', sequence: 2 }
        ]
      }
    });
    expect(routeGeometryProvider.buildRouteGeometry).toHaveBeenCalledWith(routePlanDetail);
    expect(detail?.routeGeometry).toEqual({
      type: 'LineString',
      coordinates: [
        [-79.3832, 43.6532],
        [-79.2571, 43.7764],
        [-79.337, 43.8561]
      ]
    });
  });

  test('returns updated route stops with null geometry when OSRM fails', async () => {
    const { repository, routeGeometryProvider } = createHarness(routePlanDetail);
    routeGeometryProvider.buildRouteGeometry.mockRejectedValueOnce(new Error('OSRM unavailable'));
    const service = new RoutePlanAdminService(repository, routeGeometryProvider);

    const detail = await service.updateRoutePlanStops({
      routePlanId: 'route-plan-id',
      shopDomain: 'example.myshopify.com',
      payload: { stops: [] }
    });

    expect(detail?.routePlan.id).toBe('route-plan-id');
    expect(detail?.routeGeometry).toBeNull();
  });
});

function createHarness(detail: RoutePlanDetail): {
  repository: RoutePlanRepository;
  routeGeometryProvider: {
    buildRouteGeometry: ReturnType<typeof vi.fn<RouteGeometryProvider['buildRouteGeometry']>>;
  };
  updateRoutePlanStops: ReturnType<typeof vi.fn<RoutePlanRepository['updateRoutePlanStops']>>;
} {
  const updateRoutePlanStops = vi.fn<RoutePlanRepository['updateRoutePlanStops']>().mockResolvedValue(detail);
  const repository = {
    createRoutePlanDraft: vi.fn(),
    deleteRoutePlan: vi.fn(),
    findRoutePlanDetail: vi.fn().mockResolvedValue(detail),
    listRoutePlans: vi.fn(),
    updateRoutePlanStops
  } satisfies RoutePlanRepository;

  const routeGeometryProvider = {
    buildRouteGeometry: vi.fn<RouteGeometryProvider['buildRouteGeometry']>(() => Promise.resolve({
      type: 'LineString',
      coordinates: [
        [-79.3832, 43.6532],
        [-79.2571, 43.7764],
        [-79.337, 43.8561]
      ]
    } satisfies RoutePlanRouteGeometry))
  };

  return { repository, routeGeometryProvider, updateRoutePlanStops };
}

function routeStop(input: { latitude: number; longitude: number; sequence: number }): RoutePlanDetail['stops'][number] {
  return {
    address: {
      address1: '200 Town Centre Ct',
      address2: null,
      city: 'Scarborough',
      countryCode: 'CA',
      postalCode: 'M1P 4Y7',
      province: 'ON'
    },
    attributes: [],
    coordinates: { latitude: input.latitude, longitude: input.longitude },
    deliveryArea: 'Scarborough',
    deliveryDay: 'Friday',
    deliveryStopId: `stop-${input.sequence}`,
    financialStatus: 'PAID',
    fulfillmentStatus: 'OPEN',
    orderId: `order-${input.sequence}`,
    orderName: `#10${input.sequence}`,
    paymentStatus: 'PAID',
    recipientName: 'Customer',
    sequence: input.sequence,
    shopifyOrderGid: `gid://shopify/Order/10${input.sequence}`,
    status: 'PENDING'
  };
}
