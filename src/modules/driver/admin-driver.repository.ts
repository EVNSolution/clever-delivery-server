import type { PrismaClient } from '@prisma/client';

import type {
  AdminDriverRow,
  CreatePendingDriverRecordInput,
  ListAdminDriversInput
} from './admin-driver.types.js';

type AdminDriverPrismaClient = Pick<PrismaClient, 'driver' | 'shop'>;

type DriverRecord = {
  _count?: { driverEvents?: number };
  authSubject: string | null;
  createdAt: Date;
  displayName: string;
  id: string;
  lastSeenAt: Date | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  updatedAt: Date;
};

const driverInclude = { _count: { select: { driverEvents: true } } } as const;

export class PrismaAdminDriverRepository {
  constructor(private readonly prisma: AdminDriverPrismaClient) {}

  async createPendingDriver(input: CreatePendingDriverRecordInput): Promise<AdminDriverRow> {
    const shopDomain = normalizeShopDomain(input.shopDomain);
    const shop = await this.prisma.shop.upsert({
      create: { shopDomain },
      update: {},
      where: { shopDomain }
    });
    const displayName = normalizeDisplayName(input.displayName) ?? input.phone;

    const existing = await this.prisma.driver.findFirst({
      include: driverInclude,
      where: { phone: input.phone, shopId: shop.id }
    });

    if (existing !== null) {
      const driver = await this.prisma.driver.update({
        data: { displayName, phone: input.phone },
        include: driverInclude,
        where: { id: existing.id }
      });
      return toAdminDriverRow(driver);
    }

    const driver = await this.prisma.driver.create({
      data: {
        authSubject: null,
        displayName,
        phone: input.phone,
        shopId: shop.id,
        status: 'ACTIVE'
      },
      include: driverInclude
    });

    return toAdminDriverRow(driver);
  }

  async listDrivers(input: ListAdminDriversInput): Promise<AdminDriverRow[]> {
    const shopDomain = normalizeShopDomain(input.shopDomain);
    const shop = await this.prisma.shop.findUnique({
      select: { id: true },
      where: { shopDomain }
    });
    if (shop === null) {
      return [];
    }

    const drivers = await this.prisma.driver.findMany({
      include: driverInclude,
      orderBy: [{ createdAt: 'desc' }, { displayName: 'asc' }],
      where: { shopId: shop.id }
    });

    return drivers.map((driver) => toAdminDriverRow(driver as DriverRecord));
  }
}

function toAdminDriverRow(driver: DriverRecord): AdminDriverRow {
  const isInvitePending = driver.authSubject === null;
  return {
    authStatus: isInvitePending ? 'INVITE_PENDING' : 'APP_LINKED',
    authSubject: isInvitePending ? null : 'present',
    createdAt: driver.createdAt.toISOString(),
    displayName: driver.displayName,
    id: driver.id,
    lastSeenAt: driver.lastSeenAt?.toISOString() ?? null,
    phone: driver.phone,
    recentEventsCount: driver._count?.driverEvents ?? 0,
    status: isInvitePending ? 'PENDING' : driver.status,
    updatedAt: driver.updatedAt.toISOString()
  };
}

function normalizeDisplayName(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
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
