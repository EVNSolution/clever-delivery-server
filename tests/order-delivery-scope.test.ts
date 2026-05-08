import { describe, expect, test } from 'vitest';

import { calculateDeliveryScope } from '../src/modules/shopify/order-delivery-scope.js';

describe('calculateDeliveryScope', () => {
  test.each([
    ['Thursday', 'THURSDAY', '2026-05-07', 'DAY', 'DELIVERY'],
    ['Friday', 'FRIDAY', '2026-05-08', 'DAY', 'DELIVERY'],
    ['Saturday', 'SATURDAY', '2026-05-09', 'DAY', 'DELIVERY']
  ] as const)('uses line item range for %s delivery scope', (deliveryDayRaw, weekday, deliveryDate, session, serviceType) => {
    const scope = calculateDeliveryScope({
      createdAt: '2026-05-05T14:00:00Z',
      deliveryArea: 'Thornhill',
      deliveryDayRaw,
      lineItems: [{ title: 'Tomatono menu 5/7-5/9' }],
      pickupDayRaw: null,
      processedAt: null
    });

    expect(scope).toEqual(
      expect.objectContaining({
        deliveryBatchEndDate: '2026-05-09',
        deliveryBatchStartDate: '2026-05-07',
        deliveryDate,
        deliveryDateSource: 'LINE_ITEM_DATE_RANGE',
        deliverySession: session,
        deliveryWeekday: weekday,
        planningGroupKey: `${deliveryDate}|${serviceType}|||Thornhill`,
        routeScopeKey: `${deliveryDate}|${serviceType}||`,
        serviceType
      })
    );
  });

  test('keeps Friday evening as a distinct route scope from Friday day delivery', () => {
    const scope = calculateDeliveryScope({
      createdAt: '2026-05-05T14:00:00Z',
      deliveryArea: 'Thornhill',
      deliveryDayRaw: 'Friday 5pm to 9pm *Check delivery map',
      lineItems: [{ title: 'Bundle 05/07-05/09' }],
      pickupDayRaw: null,
      processedAt: null
    });

    expect(scope).toEqual(
      expect.objectContaining({
        deliveryDate: '2026-05-08',
        deliverySession: 'EVENING',
        deliveryWeekday: 'FRIDAY',
        routeScopeKey: '2026-05-08|EVENING_DELIVERY|17:00|21:00',
        planningGroupKey: '2026-05-08|EVENING_DELIVERY|17:00|21:00|Thornhill',
        serviceType: 'EVENING_DELIVERY',
        timeWindowEnd: '21:00',
        timeWindowStart: '17:00'
      })
    );
  });

  test('falls back to order-date cycle when no line item date range exists', () => {
    const scope = calculateDeliveryScope({
      createdAt: '2026-05-05T14:00:00Z',
      deliveryArea: 'North York',
      deliveryDayRaw: 'Friday',
      lineItems: [],
      pickupDayRaw: null,
      processedAt: null
    });

    expect(scope).toEqual(
      expect.objectContaining({
        orderDateLocal: '2026-05-05',
        deliveryBatchStartDate: '2026-05-14',
        deliveryBatchEndDate: '2026-05-16',
        deliveryDate: '2026-05-15',
        deliveryDateSource: 'ORDER_DATE_CYCLE_RULE',
        routeScopeKey: '2026-05-15|DELIVERY||'
      })
    );
  });

  test('returns missing source when delivery date cannot be derived', () => {
    const scope = calculateDeliveryScope({
      createdAt: null,
      deliveryArea: 'Thornhill',
      deliveryDayRaw: 'Friday',
      lineItems: [],
      pickupDayRaw: null,
      processedAt: null
    });

    expect(scope).toEqual(
      expect.objectContaining({
        deliveryDate: null,
        deliveryDateSource: 'MISSING',
        routeScopeKey: null
      })
    );
  });
});
