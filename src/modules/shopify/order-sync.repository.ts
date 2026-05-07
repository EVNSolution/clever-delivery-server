import type { Prisma, PrismaClient } from '@prisma/client';

import type { SyncedOrderWithDeliveryStopInput } from './order-sync.mapper.js';

export type UpsertOrderWithDeliveryStopInput = {
  shopDomain: string;
  synced: SyncedOrderWithDeliveryStopInput;
};

export type UpsertOrderWithDeliveryStopResult = {
  orderId: string;
  stopId: string | null;
};

type OrderSyncPrismaClient = Pick<PrismaClient, 'deliveryStop' | 'order' | 'shop'>;

export class PrismaOrderSyncRepository {
  constructor(private readonly prisma: OrderSyncPrismaClient) {}

  async upsertOrderWithDeliveryStop(
    input: UpsertOrderWithDeliveryStopInput
  ): Promise<UpsertOrderWithDeliveryStopResult> {
    const shopDomain = normalizeShopDomain(input.shopDomain);
    const shop = await this.prisma.shop.findUnique({ where: { shopDomain } });
    if (shop === null) {
      throw new Error(`Shop not installed: ${shopDomain}`);
    }

    const order = await this.prisma.order.upsert({
      create: {
        ...toOrderWrite(input.synced.order),
        shopId: shop.id
      },
      update: toOrderWrite(input.synced.order),
      where: {
        shopId_shopifyOrderGid: {
          shopId: shop.id,
          shopifyOrderGid: input.synced.order.shopifyOrderGid
        }
      }
    });

    if (input.synced.deliveryStop === null) {
      return { orderId: order.id, stopId: null };
    }

    const stop = await this.prisma.deliveryStop.upsert({
      create: {
        ...input.synced.deliveryStop,
        orderId: order.id,
        shopId: shop.id
      },
      update: input.synced.deliveryStop,
      where: {
        shopId_orderId: {
          orderId: order.id,
          shopId: shop.id
        }
      }
    });

    return { orderId: order.id, stopId: stop.id };
  }
}

function toOrderWrite(input: SyncedOrderWithDeliveryStopInput['order']): {
  currencyCode: string | null;
  email: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  name: string;
  phone: string | null;
  processedAt: Date | null;
  rawPayload: Prisma.InputJsonValue;
  shopifyOrderGid: string;
  shopifyOrderLegacyId: bigint | null;
  totalPriceAmount: string | null;
  updatedAtShopify: Date;
} {
  return {
    currencyCode: input.currencyCode,
    email: input.email,
    financialStatus: input.financialStatus,
    fulfillmentStatus: input.fulfillmentStatus,
    name: input.name,
    phone: input.phone,
    processedAt: input.processedAt,
    rawPayload: JSON.parse(JSON.stringify(input.rawPayload)) as Prisma.InputJsonValue,
    shopifyOrderGid: input.shopifyOrderGid,
    shopifyOrderLegacyId: input.shopifyOrderLegacyId,
    totalPriceAmount: input.totalPriceAmount,
    updatedAtShopify: input.updatedAtShopify
  };
}

function normalizeShopDomain(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const withoutProtocol = trimmed.replace(/^https?:\/\//u, '').replace(/\/$/u, '');

  if (!withoutProtocol.endsWith('.myshopify.com')) {
    throw new Error('Shop domain must end with .myshopify.com');
  }

  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/u.test(withoutProtocol)) {
    throw new Error('Shop domain is not a valid myshopify.com domain');
  }

  return withoutProtocol;
}
