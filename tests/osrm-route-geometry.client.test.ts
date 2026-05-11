import { describe, expect, test, vi } from 'vitest';

import { OsrmRouteGeometryProvider } from '../src/modules/route-plans/osrm-route-geometry.client.js';
import type { RoutePlanDetail } from '../src/modules/route-plans/route-plan.types.js';

const detail = {
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

describe('OsrmRouteGeometryProvider', () => {
  test('requests a full GeoJSON route through depot and ordered stops', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        code: 'Ok',
        routes: [
          {
            geometry: {
              type: 'LineString',
              coordinates: [
                [-79.3832, 43.6532],
                [-79.2571, 43.7764],
                [-79.337, 43.8561]
              ]
            }
          }
        ]
      })
    );
    const provider = new OsrmRouteGeometryProvider({ baseUrl: 'https://osrm.example', fetch });

    const geometry = await provider.buildRouteGeometry({
      routePlan: detail.routePlan,
      routeGeometry: null,
      stops: detail.stops
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://osrm.example/route/v1/driving/-79.3832,43.6532;-79.2571,43.7764;-79.337,43.8561?overview=full&geometries=geojson&steps=false',
      { method: 'GET' }
    );
    expect(geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [-79.3832, 43.6532],
        [-79.2571, 43.7764],
        [-79.337, 43.8561]
      ]
    });
  });

  test('returns null instead of calling OSRM when there are fewer than two routable points', async () => {
    const fetch = vi.fn();
    const provider = new OsrmRouteGeometryProvider({ baseUrl: 'https://osrm.example', fetch });

    const geometry = await provider.buildRouteGeometry({
      routePlan: { ...detail.routePlan, depot: { latitude: null, longitude: null } },
      routeGeometry: null,
      stops: [routeStop({ sequence: 1, latitude: 43.7764, longitude: -79.2571 })]
    });

    expect(geometry).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

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
