import { describe, expect, test, vi } from 'vitest';

import type {
  ShopifyAdminGraphqlClient,
  ShopifyAdminGraphqlRequest
} from '../src/modules/shopify/admin-graphql.client.js';
import type {
  UpsertOrderWithDeliveryStopInput,
  UpsertOrderWithDeliveryStopResult
} from '../src/modules/shopify/order-sync.repository.js';
import { ShopifyOrderSyncService } from '../src/modules/shopify/order-sync.service.js';

describe('ShopifyOrderSyncService', () => {
  test('fetches a page of updated Shopify orders and stores mapped records', async () => {
    const graphqlRequests: ShopifyAdminGraphqlRequest[] = [];
    const graphqlClient: Pick<ShopifyAdminGraphqlClient, 'request'> = {
      request: <TData>(request: ShopifyAdminGraphqlRequest): Promise<TData> => {
        graphqlRequests.push(request);
        return Promise.resolve({
          orders: {
            nodes: [
              {
                currentTotalPriceSet: null,
                displayFinancialStatus: 'PAID',
                displayFulfillmentStatus: 'UNFULFILLED',
                email: null,
                id: 'gid://shopify/Order/123',
                legacyResourceId: '123',
                name: '#1001',
                phone: null,
                processedAt: null,
                shippingAddress: null,
                updatedAt: '2026-05-07T05:00:00Z'
              }
            ],
            pageInfo: {
              endCursor: 'cursor-2',
              hasNextPage: true
            }
          }
        } as TData);
      }
    };
    const repository: {
      upsertOrderWithDeliveryStop: ReturnType<
        typeof vi.fn<
          (input: UpsertOrderWithDeliveryStopInput) => Promise<UpsertOrderWithDeliveryStopResult>
        >
      >;
    } = {
      upsertOrderWithDeliveryStop: vi.fn((input: UpsertOrderWithDeliveryStopInput) => {
        void input;
        return Promise.resolve({ orderId: 'local-order-id', stopId: null });
      })
    };
    const service = new ShopifyOrderSyncService({ graphqlClient, repository });

    await expect(
      service.syncUpdatedOrdersPage({
        first: 25,
        shopDomain: 'example.myshopify.com',
        updatedSince: new Date('2026-05-07T00:00:00Z')
      })
    ).resolves.toEqual({
      endCursor: 'cursor-2',
      hasNextPage: true,
      ordersSynced: 1
    });

    expect(graphqlRequests[0]?.variables?.first).toBe(25);
    const firstRepositoryCall = repository.upsertOrderWithDeliveryStop.mock.calls[0];
    expect(firstRepositoryCall).toBeDefined();
    if (firstRepositoryCall === undefined) {
      throw new Error('Expected order sync repository call');
    }
    const [repositoryInput] = firstRepositoryCall;
    expect(repositoryInput.shopDomain).toBe('example.myshopify.com');
    expect(repositoryInput.synced.order.shopifyOrderGid).toBe('gid://shopify/Order/123');
  });
});
