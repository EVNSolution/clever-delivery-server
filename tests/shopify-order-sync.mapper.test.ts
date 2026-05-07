import { describe, expect, test } from 'vitest';

import { mapShopifyOrderNodeToDeliveryInputs } from '../src/modules/shopify/order-sync.mapper.js';
import { buildOrdersUpdatedSinceQuery } from '../src/modules/shopify/order-sync.query.js';

describe('buildOrdersUpdatedSinceQuery', () => {
  test('builds an updated_at paginated orders query payload', () => {
    const payload = buildOrdersUpdatedSinceQuery({
      after: 'cursor-1',
      first: 50,
      updatedSince: new Date('2026-05-07T00:00:00.000Z')
    });

    expect(payload.variables).toEqual({
      after: 'cursor-1',
      first: 50,
      query: "updated_at:>='2026-05-07T00:00:00.000Z'"
    });
    expect(payload.query).toContain('orders(first: $first, after: $after, query: $query');
    expect(payload.query).toContain('shippingAddress');
  });
});

describe('mapShopifyOrderNodeToDeliveryInputs', () => {
  test('maps a Shopify order node with shipping address into local order and stop inputs', () => {
    const mapped = mapShopifyOrderNodeToDeliveryInputs({
      currentTotalPriceSet: {
        shopMoney: {
          amount: '123.45',
          currencyCode: 'USD'
        }
      },
      displayFinancialStatus: 'PAID',
      displayFulfillmentStatus: 'UNFULFILLED',
      email: 'customer@example.com',
      id: 'gid://shopify/Order/123',
      legacyResourceId: '123',
      name: '#1001',
      phone: '+15551234567',
      processedAt: '2026-05-07T04:00:00Z',
      shippingAddress: {
        address1: '1 Main St',
        address2: 'Unit 2',
        city: 'New York',
        countryCodeV2: 'US',
        latitude: 40.7128,
        longitude: -74.006,
        name: 'Ada Lovelace',
        phone: '+15557654321',
        province: 'NY',
        zip: '10001'
      },
      updatedAt: '2026-05-07T05:00:00Z'
    });

    expect(mapped.order.rawPayload.id).toBe('gid://shopify/Order/123');
    expect(mapped).toEqual({
      deliveryStop: {
        address1: '1 Main St',
        address2: 'Unit 2',
        city: 'New York',
        countryCode: 'US',
        instructions: null,
        latitude: '40.7128',
        longitude: '-74.006',
        phone: '+15557654321',
        postalCode: '10001',
        province: 'NY',
        recipientName: 'Ada Lovelace'
      },
      order: {
        currencyCode: 'USD',
        email: 'customer@example.com',
        financialStatus: 'PAID',
        fulfillmentStatus: 'UNFULFILLED',
        name: '#1001',
        phone: '+15551234567',
        processedAt: new Date('2026-05-07T04:00:00.000Z'),
        rawPayload: mapped.order.rawPayload,
        shopifyOrderGid: 'gid://shopify/Order/123',
        shopifyOrderLegacyId: BigInt(123),
        totalPriceAmount: '123.45',
        updatedAtShopify: new Date('2026-05-07T05:00:00.000Z')
      }
    });
  });

  test('returns no delivery stop when an order has no shipping address', () => {
    const mapped = mapShopifyOrderNodeToDeliveryInputs({
      currentTotalPriceSet: null,
      displayFinancialStatus: null,
      displayFulfillmentStatus: 'FULFILLED',
      email: null,
      id: 'gid://shopify/Order/456',
      legacyResourceId: '456',
      name: '#1002',
      phone: null,
      processedAt: null,
      shippingAddress: null,
      updatedAt: '2026-05-07T05:00:00Z'
    });

    expect(mapped.deliveryStop).toBeNull();
  });
});
