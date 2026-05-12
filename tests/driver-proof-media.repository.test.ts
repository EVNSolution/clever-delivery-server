import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test, vi } from 'vitest';

import { PrismaDriverProofMediaRepository } from '../src/modules/driver/driver-proof-media.repository.js';

const uploadBytes = Buffer.from('synthetic-proof-photo');
const now = new Date('2026-05-12T10:00:00.000Z');

describe('PrismaDriverProofMediaRepository', () => {
  test('stores scoped proof media bytes and metadata for the token driver route stop', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'clever-proof-media-'));
    const { prisma } = createPrismaHarness();
    const repository = new PrismaDriverProofMediaRepository(prisma as never, {
      createMediaId: () => '11111111-1111-4111-8111-111111111111',
      now: () => now,
      storageRoot
    });

    const result = await repository.storeProofMedia({
      contentType: 'image/jpeg',
      deliveryStopId: 'stop-id',
      driverId: 'driver-id',
      fileBytes: uploadBytes,
      filename: 'proof.jpg',
      routePlanId: 'route-plan-id',
      shopDomain: 'Tomatono.myshopify.com',
      source: 'camera'
    });

    expect(prisma.shop.findUnique).toHaveBeenCalledWith({ where: { shopDomain: 'tomatono.myshopify.com' } });
    expect(prisma.driver.findUnique).toHaveBeenCalledWith({ where: { id: 'driver-id' } });
    expect(prisma.routePlan.findFirst).toHaveBeenCalledWith({
      where: {
        driverId: 'driver-id',
        id: 'route-plan-id',
        shopId: 'shop-id',
        status: { in: ['ASSIGNED', 'IN_PROGRESS', 'OPTIMIZED'] }
      }
    });
    expect(prisma.routePlanStop.findUnique).toHaveBeenCalledWith({
      where: {
        routePlanId_deliveryStopId: {
          deliveryStopId: 'stop-id',
          routePlanId: 'route-plan-id'
        }
      }
    });
    expect(prisma.driverProofMedia.create).toHaveBeenCalledWith({
      data: {
        contentType: 'image/jpeg',
        deliveryStopId: 'stop-id',
        driverId: 'driver-id',
        id: '11111111-1111-4111-8111-111111111111',
        kind: 'PHOTO',
        originalFilename: 'proof.jpg',
        routePlanId: 'route-plan-id',
        sha256: 'dad2f603ccde777ba84635fb7bea4cea8f2d1147e59fd02f74cbd720a9bd15c7',
        shopId: 'shop-id',
        sizeBytes: uploadBytes.byteLength,
        source: 'CAMERA',
        storageKey: 'driver-proof/tomatono.myshopify.com/route-plan-id/stop-id/11111111-1111-4111-8111-111111111111.jpg',
        uploadedAt: now
      }
    });
    await expect(
      readFile(join(storageRoot, 'driver-proof/tomatono.myshopify.com/route-plan-id/stop-id/11111111-1111-4111-8111-111111111111.jpg'))
    ).resolves.toEqual(uploadBytes);
    expect(result).toEqual({
      contentType: 'image/jpeg',
      kind: 'photo',
      mediaId: '11111111-1111-4111-8111-111111111111',
      sha256: 'dad2f603ccde777ba84635fb7bea4cea8f2d1147e59fd02f74cbd720a9bd15c7',
      sizeBytes: uploadBytes.byteLength,
      source: 'camera',
      storageKey: 'driver-proof/tomatono.myshopify.com/route-plan-id/stop-id/11111111-1111-4111-8111-111111111111.jpg',
      uploadedAt: '2026-05-12T10:00:00.000Z'
    });
  });

  test('rejects proof media outside the token driver route scope before writing metadata', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'clever-proof-media-'));
    const { prisma } = createPrismaHarness({ routePlan: null });
    const repository = new PrismaDriverProofMediaRepository(prisma as never, {
      createMediaId: () => '11111111-1111-4111-8111-111111111111',
      now: () => now,
      storageRoot
    });

    await expect(
      repository.storeProofMedia({
        contentType: 'image/jpeg',
        deliveryStopId: 'stop-id',
        driverId: 'driver-id',
        fileBytes: uploadBytes,
        filename: 'proof.jpg',
        routePlanId: 'route-plan-id',
        shopDomain: 'tomatono.myshopify.com',
        source: 'camera'
      })
    ).rejects.toThrow('Route plan not assigned to driver');
    expect(prisma.routePlanStop.findUnique).not.toHaveBeenCalled();
    expect(prisma.driverProofMedia.create).not.toHaveBeenCalled();
  });
});

function createPrismaHarness(input: { routePlan?: { id: string } | null; routePlanStop?: { id: string } | null } = {}) {
  return {
    prisma: {
      driver: {
        findUnique: vi.fn(() => Promise.resolve({ id: 'driver-id', shopId: 'shop-id' }))
      },
      driverProofMedia: {
        create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...data }))
      },
      routePlan: {
        findFirst: vi.fn(() => Promise.resolve(input.routePlan === undefined ? { id: 'route-plan-id' } : input.routePlan))
      },
      routePlanStop: {
        findUnique: vi.fn(() =>
          Promise.resolve(input.routePlanStop === undefined ? { id: 'route-plan-stop-id' } : input.routePlanStop)
        )
      },
      shop: {
        findUnique: vi.fn(() => Promise.resolve({ id: 'shop-id' }))
      }
    }
  };
}
