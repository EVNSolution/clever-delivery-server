import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

const schemaPath = new URL('../prisma/schema.prisma', import.meta.url);

async function readSchema(): Promise<string> {
  return readFile(schemaPath, 'utf8');
}

describe('Prisma schema', () => {
  test('defines shop-level encrypted Shopify Admin API token storage', async () => {
    const schema = await readSchema();

    expect(schema).toContain('model Shop');
    expect(schema).toContain('shopDomain');
    expect(schema).toContain('shopifyShopGid');
    expect(schema).toContain('adminAccessTokenCiphertext');
    expect(schema).toContain('adminAccessTokenExpiresAt');
    expect(schema).toContain('adminRefreshTokenCiphertext');
    expect(schema).toContain('adminRefreshTokenExpiresAt');
    expect(schema).toContain('tokenScopes');
    expect(schema).toContain('installedAt');
    expect(schema).toContain('uninstalledAt');
    expect(schema).toMatch(/@@unique\(\[shopDomain\]\)/);
  });

  test('defines core delivery operation models and idempotency constraints', async () => {
    const schema = await readSchema();

    for (const modelName of [
      'ShopifyWebhookEvent',
      'Order',
      'DeliveryStop',
      'RoutePlan',
      'RoutePlanStop',
      'Driver',
      'DriverSession',
      'DriverConsentRecord',
      'Vehicle',
      'DriverEvent'
    ]) {
      expect(schema).toContain(`model ${modelName}`);
    }

    expect(schema).toMatch(/@@unique\(\[shopId, webhookId\]/);
    expect(schema).toMatch(/@@unique\(\[shopId, shopifyOrderGid\]/);
    expect(schema).toMatch(/@@unique\(\[routePlanId, sequence\]/);
    expect(schema).toMatch(/@@unique\(\[routePlanId, deliveryStopId\]/);
    expect(schema).toContain('enum DriverConsentType');
    expect(schema).toMatch(/@@unique\(\[driverId, consentType, consentVersion\]/);
    expect(schema).toMatch(/@@unique\(\[driverId, clientEventId\]/);
  });

  test('uses PostgreSQL datasource and Prisma client generator', async () => {
    const schema = await readSchema();

    expect(schema).toContain('provider = "postgresql"');
    expect(schema).toContain('env("DATABASE_URL")');
    expect(schema).toContain('provider = "prisma-client-js"');
  });
});
