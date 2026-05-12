import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

  test('deletes expired proof media bytes and marks metadata deleted', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'clever-proof-media-'));
    const storageKey = 'driver-proof/tomatono.myshopify.com/route-plan-id/stop-id/media-id.jpg';
    const storedPath = join(storageRoot, ...storageKey.split('/'));
    await mkdir(join(storageRoot, 'driver-proof/tomatono.myshopify.com/route-plan-id/stop-id'), { recursive: true });
    await writeFile(storedPath, uploadBytes);
    const deletedAt = new Date('2026-06-12T00:00:00.000Z');
    const uploadedBefore = new Date('2026-06-01T00:00:00.000Z');
    const { prisma } = createPrismaHarness({
      expiredProofMedia: [
        {
          id: 'media-id',
          storageKey,
          uploadedAt: new Date('2026-05-12T10:00:00.000Z')
        }
      ]
    });
    const repository = new PrismaDriverProofMediaRepository(prisma as never, { storageRoot });

    const result = await repository.deleteExpiredProofMedia({ deletedAt, uploadedBefore });

    expect(prisma.driverProofMedia.findMany).toHaveBeenCalledWith({
      orderBy: { uploadedAt: 'asc' },
      take: 100,
      where: {
        deletedAt: null,
        uploadedAt: { lt: uploadedBefore }
      }
    });
    expect(prisma.driverProofMedia.update).toHaveBeenCalledWith({
      data: { deletedAt },
      where: { id: 'media-id' }
    });
    await expect(readFile(storedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(result).toEqual({
      deleted: 1,
      missingFiles: 0,
      scanned: 1
    });
  });

  test('marks missing expired proof media as deleted idempotently', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'clever-proof-media-'));
    const deletedAt = new Date('2026-06-12T00:00:00.000Z');
    const { prisma } = createPrismaHarness({
      expiredProofMedia: [
        {
          id: 'missing-media-id',
          storageKey: 'driver-proof/tomatono.myshopify.com/route-plan-id/stop-id/missing-media-id.jpg',
          uploadedAt: new Date('2026-05-12T10:00:00.000Z')
        }
      ]
    });
    const repository = new PrismaDriverProofMediaRepository(prisma as never, { storageRoot });

    const result = await repository.deleteExpiredProofMedia({
      deletedAt,
      uploadedBefore: new Date('2026-06-01T00:00:00.000Z')
    });

    expect(prisma.driverProofMedia.update).toHaveBeenCalledWith({
      data: { deletedAt },
      where: { id: 'missing-media-id' }
    });
    expect(result).toEqual({
      deleted: 1,
      missingFiles: 1,
      scanned: 1
    });
  });

  test('rejects expired proof media storage keys outside the configured storage root', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'clever-proof-media-'));
    const { prisma } = createPrismaHarness({
      expiredProofMedia: [
        {
          id: 'unsafe-media-id',
          storageKey: '../outside-root.jpg',
          uploadedAt: new Date('2026-05-12T10:00:00.000Z')
        }
      ]
    });
    const repository = new PrismaDriverProofMediaRepository(prisma as never, { storageRoot });

    await expect(
      repository.deleteExpiredProofMedia({ uploadedBefore: new Date('2026-06-01T00:00:00.000Z') })
    ).rejects.toThrow('Proof media storage key escapes storage root');
    expect(prisma.driverProofMedia.update).not.toHaveBeenCalled();
  });
});

function createPrismaHarness(input: {
  expiredProofMedia?: { id: string; storageKey: string; uploadedAt: Date }[];
  routePlan?: { id: string } | null;
  routePlanStop?: { id: string } | null;
} = {}) {
  return {
    prisma: {
      driver: {
        findUnique: vi.fn(() => Promise.resolve({ id: 'driver-id', shopId: 'shop-id' }))
      },
      driverProofMedia: {
        create: vi.fn(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...data })),
        findMany: vi.fn(() => Promise.resolve(input.expiredProofMedia ?? [])),
        update: vi.fn(({ data, where }: { data: Record<string, unknown>; where: Record<string, unknown> }) =>
          Promise.resolve({ ...where, ...data })
        )
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
