import { describe, expect, test, vi } from 'vitest';

import { PrismaAdminDriverRepository } from '../src/modules/driver/admin-driver.repository.js';

describe('PrismaAdminDriverRepository', () => {
  test('upserts the shop and creates a pending invite driver', async () => {
    const { prisma } = createPrismaHarness({ existingDriver: null });
    const repository = new PrismaAdminDriverRepository(prisma as never);

    const driver = await repository.createPendingDriver({
      displayName: null,
      phone: '+821089216198',
      shopDomain: 'Example.myshopify.com'
    });

    expect(prisma.shop.upsert).toHaveBeenCalledWith({
      create: { shopDomain: 'example.myshopify.com' },
      update: {},
      where: { shopDomain: 'example.myshopify.com' }
    });
    expect(prisma.driver.create).toHaveBeenCalledWith({
      data: {
        authSubject: null,
        displayName: '+821089216198',
        phone: '+821089216198',
        shopId: 'shop-id',
        status: 'ACTIVE'
      },
      include: { _count: { select: { driverEvents: true } } }
    });
    expect(driver).toEqual(
      expect.objectContaining({
        authStatus: 'INVITE_PENDING',
        authSubject: null,
        displayName: '+821089216198',
        phone: '+821089216198',
        recentEventsCount: 0,
        status: 'PENDING'
      })
    );
  });

  test('updates an existing shop driver with the same phone without creating a duplicate', async () => {
    const existingDriver = driverRecord({ displayName: '+821089216198', id: 'existing-driver-id' });
    const updatedDriver = driverRecord({ displayName: 'Minji Kim', id: 'existing-driver-id' });
    const { prisma } = createPrismaHarness({ existingDriver, updatedDriver });
    const repository = new PrismaAdminDriverRepository(prisma as never);

    const driver = await repository.createPendingDriver({
      displayName: 'Minji Kim',
      phone: '+821089216198',
      shopDomain: 'example.myshopify.com'
    });

    expect(prisma.driver.create).not.toHaveBeenCalled();
    expect(prisma.driver.update).toHaveBeenCalledWith({
      data: { displayName: 'Minji Kim', phone: '+821089216198' },
      include: { _count: { select: { driverEvents: true } } },
      where: { id: 'existing-driver-id' }
    });
    expect(driver.id).toBe('existing-driver-id');
    expect(driver.displayName).toBe('Minji Kim');
    expect(driver.authStatus).toBe('INVITE_PENDING');
  });

  test('lists only drivers for the requested shop and masks linked auth subjects', async () => {
    const { prisma } = createPrismaHarness({
      listDrivers: [
        driverRecord({
          authSubject: 'driver-auth-subject',
          displayName: 'Minji Kim',
          id: 'linked-driver-id',
          lastSeenAt: new Date('2026-05-11T01:59:00.000Z'),
          phone: '+14165550108',
          recentEventsCount: 4
        }),
        driverRecord({ id: 'pending-driver-id' })
      ]
    });
    const repository = new PrismaAdminDriverRepository(prisma as never);

    const drivers = await repository.listDrivers({ shopDomain: 'example.myshopify.com' });

    expect(prisma.driver.findMany).toHaveBeenCalledWith({
      include: { _count: { select: { driverEvents: true } } },
      orderBy: [{ createdAt: 'desc' }, { displayName: 'asc' }],
      where: { shopId: 'shop-id' }
    });
    expect(drivers).toEqual([
      expect.objectContaining({
        authStatus: 'APP_LINKED',
        authSubject: 'present',
        id: 'linked-driver-id',
        recentEventsCount: 4,
        status: 'ACTIVE'
      }),
      expect.objectContaining({
        authStatus: 'INVITE_PENDING',
        authSubject: null,
        id: 'pending-driver-id',
        recentEventsCount: 0,
        status: 'PENDING'
      })
    ]);
  });

  test('returns an empty list when the requested shop is not installed', async () => {
    const { prisma } = createPrismaHarness({ shop: null });
    const repository = new PrismaAdminDriverRepository(prisma as never);

    const drivers = await repository.listDrivers({ shopDomain: 'missing.myshopify.com' });

    expect(drivers).toEqual([]);
    expect(prisma.driver.findMany).not.toHaveBeenCalled();
  });
});

function createPrismaHarness(input: {
  existingDriver?: ReturnType<typeof driverRecord> | null;
  listDrivers?: ReturnType<typeof driverRecord>[];
  shop?: { id: string } | null;
  updatedDriver?: ReturnType<typeof driverRecord>;
} = {}): {
  prisma: {
    driver: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    shop: {
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
  };
} {
  const shop = input.shop === undefined ? { id: 'shop-id' } : input.shop;
  const createdDriver = driverRecord();
  return {
    prisma: {
      driver: {
        create: vi.fn(() => Promise.resolve(createdDriver)),
        findFirst: vi.fn(() => Promise.resolve(input.existingDriver ?? null)),
        findMany: vi.fn(() => Promise.resolve(input.listDrivers ?? [])),
        update: vi.fn(() => Promise.resolve(input.updatedDriver ?? input.existingDriver ?? createdDriver))
      },
      shop: {
        findUnique: vi.fn(() => Promise.resolve(shop)),
        upsert: vi.fn(() => Promise.resolve(shop ?? { id: 'shop-id' }))
      }
    }
  };
}

function driverRecord(overrides: Partial<{
  authSubject: string | null;
  createdAt: Date;
  displayName: string;
  id: string;
  lastSeenAt: Date | null;
  phone: string | null;
  recentEventsCount: number;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  updatedAt: Date;
}> = {}): {
  _count: { driverEvents: number };
  authSubject: string | null;
  createdAt: Date;
  displayName: string;
  id: string;
  lastSeenAt: Date | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  updatedAt: Date;
} {
  return {
    _count: { driverEvents: overrides.recentEventsCount ?? 0 },
    authSubject: overrides.authSubject ?? null,
    createdAt: overrides.createdAt ?? new Date('2026-05-11T02:00:00.000Z'),
    displayName: overrides.displayName ?? '+821089216198',
    id: overrides.id ?? 'driver-id',
    lastSeenAt: overrides.lastSeenAt ?? null,
    phone: overrides.phone ?? '+821089216198',
    status: overrides.status ?? 'ACTIVE',
    updatedAt: overrides.updatedAt ?? new Date('2026-05-11T02:00:00.000Z')
  };
}
