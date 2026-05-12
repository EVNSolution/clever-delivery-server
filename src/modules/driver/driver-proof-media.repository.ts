import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
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

export type DeleteExpiredProofMediaInput = {
  deletedAt?: Date;
  limit?: number;
  uploadedBefore: Date;
};

export type DeleteExpiredProofMediaResult = {
  deleted: number;
  missingFiles: number;
  scanned: number;
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
    const storedFileBytes = sanitizeProofMediaBytes(input.contentType, input.fileBytes);
    const sha256 = createHash('sha256').update(storedFileBytes).digest('hex');
    const storageKey = buildStorageKey({
      deliveryStopId: input.deliveryStopId,
      extension: extensionFor(input.contentType, input.filename),
      mediaId,
      routePlanId: input.routePlanId,
      shopDomain
    });
    await writeStoredFile(this.options.storageRoot, storageKey, storedFileBytes);

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
        sizeBytes: storedFileBytes.byteLength,
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
      sizeBytes: storedFileBytes.byteLength,
      source: input.source,
      storageKey,
      uploadedAt: uploadedAt.toISOString()
    };
  }

  async deleteExpiredProofMedia(input: DeleteExpiredProofMediaInput): Promise<DeleteExpiredProofMediaResult> {
    const deletedAt = input.deletedAt ?? this.now();
    const expiredMedia = await this.prisma.driverProofMedia.findMany({
      orderBy: { uploadedAt: 'asc' },
      take: input.limit ?? 100,
      where: {
        deletedAt: null,
        uploadedAt: { lt: input.uploadedBefore }
      }
    });

    let deleted = 0;
    let missingFiles = 0;

    for (const media of expiredMedia) {
      const removeResult = await removeStoredFile(this.options.storageRoot, media.storageKey);
      if (removeResult === 'missing') {
        missingFiles += 1;
      }

      await this.prisma.driverProofMedia.update({
        data: { deletedAt },
        where: { id: media.id }
      });
      deleted += 1;
    }

    return {
      deleted,
      missingFiles,
      scanned: expiredMedia.length
    };
  }
}

async function writeStoredFile(storageRoot: string, storageKey: string, fileBytes: Buffer): Promise<void> {
  const target = resolveStoredFilePath(storageRoot, storageKey);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, fileBytes, { flag: 'wx' });
}

async function removeStoredFile(storageRoot: string, storageKey: string): Promise<'missing' | 'removed'> {
  const target = resolveStoredFilePath(storageRoot, storageKey);
  try {
    await rm(target);
    return 'removed';
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      return 'missing';
    }

    throw error;
  }
}

function resolveStoredFilePath(storageRoot: string, storageKey: string): string {
  const root = resolve(storageRoot);
  const target = resolve(root, ...storageKey.split('/'));

  if (target !== root && target.startsWith(`${root}${sep}`)) {
    return target;
  }

  throw new Error('Proof media storage key escapes storage root');
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

function sanitizeProofMediaBytes(contentType: string, fileBytes: Buffer): Buffer {
  if (contentType.trim().toLowerCase() !== 'image/jpeg') {
    return fileBytes;
  }

  return stripJpegExifApp1Segments(fileBytes);
}

function stripJpegExifApp1Segments(fileBytes: Buffer): Buffer {
  if (fileBytes.length < 4 || fileBytes[0] !== 0xff || fileBytes[1] !== 0xd8) {
    return fileBytes;
  }

  const chunks: Buffer[] = [fileBytes.subarray(0, 2)];
  let offset = 2;
  let stripped = false;

  while (offset < fileBytes.length) {
    if (fileBytes[offset] !== 0xff) {
      chunks.push(fileBytes.subarray(offset));
      break;
    }

    const markerStart = offset;
    while (offset < fileBytes.length && fileBytes[offset] === 0xff) {
      offset += 1;
    }

    const marker = fileBytes[offset];
    if (marker === undefined) {
      chunks.push(fileBytes.subarray(markerStart));
      break;
    }
    offset += 1;

    if (marker === 0xda || marker === 0xd9) {
      chunks.push(fileBytes.subarray(markerStart));
      break;
    }

    if (offset + 2 > fileBytes.length) {
      return fileBytes;
    }

    const segmentLength = fileBytes.readUInt16BE(offset);
    if (segmentLength < 2) {
      return fileBytes;
    }

    const segmentEnd = offset + segmentLength;
    if (segmentEnd > fileBytes.length) {
      return fileBytes;
    }

    const payloadStart = offset + 2;
    const isExifApp1 = marker === 0xe1 && fileBytes.subarray(payloadStart, payloadStart + 6).equals(Buffer.from('Exif\0\0'));
    if (isExifApp1) {
      stripped = true;
    } else {
      chunks.push(fileBytes.subarray(markerStart, segmentEnd));
    }
    offset = segmentEnd;
  }

  return stripped ? Buffer.concat(chunks) : fileBytes;
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

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error;
}
