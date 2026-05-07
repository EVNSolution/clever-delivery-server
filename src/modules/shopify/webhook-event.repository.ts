import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

export type RecordShopifyWebhookEventInput = {
  apiVersion: string | null;
  eventId: string | null;
  payload: unknown;
  rawBody: string;
  shopDomain: string;
  topic: string;
  triggeredAt: Date | null;
  webhookId: string;
};

export type RecordShopifyWebhookEventResult = {
  duplicate: boolean;
  webhookId: string;
};

type ShopifyWebhookPrismaClient = Pick<PrismaClient, 'shop' | 'shopifyWebhookEvent'>;

export class PrismaShopifyWebhookEventRepository {
  constructor(private readonly prisma: ShopifyWebhookPrismaClient) {}

  async recordWebhook(
    input: RecordShopifyWebhookEventInput
  ): Promise<RecordShopifyWebhookEventResult> {
    return this.recordWebhookEvent(input);
  }

  async recordWebhookEvent(
    input: RecordShopifyWebhookEventInput
  ): Promise<RecordShopifyWebhookEventResult> {
    const shopDomain = normalizeShopDomain(input.shopDomain);
    const createShop =
      input.apiVersion === null
        ? { shopDomain }
        : {
            apiVersion: input.apiVersion,
            shopDomain
          };
    const shop = await this.prisma.shop.upsert({
      create: createShop,
      update: input.apiVersion === null ? {} : { apiVersion: input.apiVersion },
      where: { shopDomain }
    });

    try {
      await this.prisma.shopifyWebhookEvent.create({
        data: {
          apiVersion: input.apiVersion,
          eventId: input.eventId,
          payload: toPrismaJson(input.payload),
          rawBodySha256: createHash('sha256').update(input.rawBody).digest('hex'),
          shopId: shop.id,
          topic: input.topic,
          triggeredAt: input.triggeredAt,
          webhookId: input.webhookId
        }
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return { duplicate: true, webhookId: input.webhookId };
      }

      throw error;
    }

    return { duplicate: false, webhookId: input.webhookId };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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
