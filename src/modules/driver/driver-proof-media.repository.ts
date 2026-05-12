import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PrismaClient } from '@prisma/client';

import { DriverProofMediaScopeError } from './driver-proof-media.types.js';
import type {
  DriverProofMediaSource,
  StoreDriverProofMediaInput,
  StoreDriverProofMediaResult
} from './driver-proof-media.types.js';

type DriverProofMediaPrismaClient = Pick<
  PrismaClient,
  'driver' | 'driverProofMedia' | 'routePlan' | 'routePlanStop' | 'shop'
>;

type PrismaProofMediaSource = 'CAMERA' | 'LIBRARY';

type DriverProofMediaRepositoryOptions = {
  createMediaId?: () => string;
  now?: () => Date;
  storageRoot: string;
};

export class PrismaDriverProofMediaRepository {
  private readonly createMediaId: () => string;
  private readonly now: () => Date;

  constructor(
    private readonly prisma: DriverProofMediaPrismaClient,
    private readonly options: DriverProofMediaRepositoryOptions
  ) {
    this.createMediaId = options.createMediaId ?? randomUUID;
    this.now = options.now ?? (() => new Date());
  }

  async storeProofMedia(input: StoreDriverProofMediaInput): Promise<StoreDriverProofMediaResult> {
    const shopDomain = normalizeShopDomain(input.shopDomain);
    const shop = await this.prisma.shop.findUnique({ where: { shopDomain } });
    if (shop === null) {
      throw new DriverProofMediaScopeError(`Shop not installed: ${shopDomain}`);
    }

    const driver = await this.prisma.driver.findUnique({ where: { id: input.driverId } });
    if (driver === null || driver.shopId !== shop.id) {
      throw new DriverProofMediaScopeError(`Driver not found for shop: ${input.driverId}`);
    }

    const routePlan = await this.prisma.routePlan.findFirst({
      where: {
        driverId: input.driverId,
        id: input.routePlanId,
        shopId: shop.id,
        status: { in: ['ASSIGNED', 'IN_PROGRESS', 'OPTIMIZED'] }
      }
    });
    if (routePlan === null) {
      throw new DriverProofMediaScopeError(`Route plan not assigned to driver: ${input.routePlanId}`);
    }

    const routePlanStop = await this.prisma.routePlanStop.findUnique({
      where: {
        routePlanId_deliveryStopId: {
          deliveryStopId: input.deliveryStopId,
          routePlanId: input.routePlanId
        }
      }
    });
    if (routePlanStop === null) {
      throw new DriverProofMediaScopeError(`Delivery stop not found in route plan: ${input.deliveryStopId}`);
    }

    const mediaId = this.createMediaId();
    const uploadedAt = this.now();
    const sha256 = createHash('sha256').update(input.fileBytes).digest('hex');
    const storageKey = buildStorageKey({
      deliveryStopId: input.deliveryStopId,
      extension: extensionFor(input.contentType, input.filename),
      mediaId,
      routePlanId: input.routePlanId,
      shopDomain
    });
    await writeStoredFile(this.options.storageRoot, storageKey, input.fileBytes);

    await this.prisma.driverProofMedia.create({
      data: {
        contentType: input.contentType,
        deliveryStopId: input.deliveryStopId,
        driverId: input.driverId,
        id: mediaId,
        kind: 'PHOTO',
        originalFilename: input.filename,
        routePlanId: input.routePlanId,
        sha256,
        shopId: shop.id,
        sizeBytes: input.fileBytes.byteLength,
        source: toPrismaSource(input.source),
        storageKey,
        uploadedAt
      }
    });

    return {
      contentType: input.contentType,
      kind: 'photo',
      mediaId,
      sha256,
      sizeBytes: input.fileBytes.byteLength,
      source: input.source,
      storageKey,
      uploadedAt: uploadedAt.toISOString()
    };
  }
}

async function writeStoredFile(storageRoot: string, storageKey: string, fileBytes: Buffer): Promise<void> {
  const target = join(storageRoot, ...storageKey.split('/'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, fileBytes, { flag: 'wx' });
}

function buildStorageKey(input: {
  deliveryStopId: string;
  extension: string;
  mediaId: string;
  routePlanId: string;
  shopDomain: string;
}): string {
  return [
    'driver-proof',
    input.shopDomain,
    safePathSegment(input.routePlanId),
    safePathSegment(input.deliveryStopId),
    `${safePathSegment(input.mediaId)}${input.extension}`
  ].join('/');
}

function extensionFor(contentType: string, filename: string): string {
  const normalized = contentType.trim().toLowerCase();
  if (normalized === 'image/jpeg') {
    return '.jpg';
  }
  if (normalized === 'image/png') {
    return '.png';
  }
  if (normalized === 'image/heic' || normalized === 'image/heif') {
    return '.heic';
  }

  const match = /\.([a-z0-9]{1,8})$/iu.exec(filename.trim());
  return match?.[1] === undefined ? '.bin' : `.${match[1].toLowerCase()}`;
}

function toPrismaSource(source: DriverProofMediaSource): PrismaProofMediaSource {
  return source === 'camera' ? 'CAMERA' : 'LIBRARY';
}

function safePathSegment(value: string): string {
  if (!/^[a-zA-Z0-9._-]+$/u.test(value)) {
    throw new Error('Storage path segment contains unsupported characters');
  }

  return value;
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
