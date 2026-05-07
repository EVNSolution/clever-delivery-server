import type { ShopifyAdminGraphqlClient } from './admin-graphql.client.js';
import type { ShopifyOrderNode, SyncedOrderWithDeliveryStopInput } from './order-sync.mapper.js';
import { mapShopifyOrderNodeToDeliveryInputs } from './order-sync.mapper.js';
import { buildOrdersUpdatedSinceQuery } from './order-sync.query.js';
import type {
  UpsertOrderWithDeliveryStopInput,
  UpsertOrderWithDeliveryStopResult
} from './order-sync.repository.js';

export type SyncUpdatedOrdersPageInput = {
  after?: string | null;
  first: number;
  shopDomain: string;
  updatedSince: Date;
};

export type SyncUpdatedOrdersPageResult = {
  endCursor: string | null;
  hasNextPage: boolean;
  ordersSynced: number;
};

type OrdersUpdatedSinceResponse = {
  orders: {
    nodes: ShopifyOrderNode[];
    pageInfo: {
      endCursor: string | null;
      hasNextPage: boolean;
    };
  };
};

type OrderSyncRepository = {
  upsertOrderWithDeliveryStop(
    input: UpsertOrderWithDeliveryStopInput
  ): Promise<UpsertOrderWithDeliveryStopResult>;
};

export class ShopifyOrderSyncService {
  constructor(
    private readonly options: {
      graphqlClient: Pick<ShopifyAdminGraphqlClient, 'request'>;
      repository: OrderSyncRepository;
    }
  ) {}

  async syncUpdatedOrdersPage(
    input: SyncUpdatedOrdersPageInput
  ): Promise<SyncUpdatedOrdersPageResult> {
    const data = await this.options.graphqlClient.request<OrdersUpdatedSinceResponse>(
      buildOrdersUpdatedSinceQuery(input)
    );

    let ordersSynced = 0;
    for (const node of data.orders.nodes) {
      const synced: SyncedOrderWithDeliveryStopInput = mapShopifyOrderNodeToDeliveryInputs(node);
      await this.options.repository.upsertOrderWithDeliveryStop({
        shopDomain: input.shopDomain,
        synced
      });
      ordersSynced += 1;
    }

    return {
      endCursor: data.orders.pageInfo.endCursor,
      hasNextPage: data.orders.pageInfo.hasNextPage,
      ordersSynced
    };
  }
}
