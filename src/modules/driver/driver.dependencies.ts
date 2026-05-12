import type { PrismaClient } from '@prisma/client';

import { PrismaDriverAssignedRouteRepository } from './driver-assigned-route.repository.js';
import { PrismaDriverConsentRepository } from './driver-consent.repository.js';
import { PrismaDriverEventRepository } from './driver-event.repository.js';
import { PrismaDriverProofMediaRepository } from './driver-proof-media.repository.js';
import { PrismaDriverRouteAccessRepository } from './driver-route-access.repository.js';
import { createS3DriverProofMediaStorage } from './driver-proof-media-s3-storage.js';
import type { DriverProofMediaStorageBackend } from './driver-proof-media.repository.js';
import type { DriverApiDependencies } from '../../routes/driver-events.routes.js';

export const DEFAULT_DRIVER_PROOF_MEDIA_RETENTION_DAYS = 180;
export const DEFAULT_DRIVER_PROOF_MEDIA_READ_ACCESS_TTL_SECONDS = 5 * 60;
export const DEFAULT_DRIVER_PROOF_MEDIA_STORAGE_DIR = 'var/driver-proof-media';

export type DriverApiRuntimeEnv = Partial<Record<
  | 'DRIVER_PROOF_MEDIA_READ_ACCESS_TTL_SECONDS'
  | 'DRIVER_PROOF_MEDIA_RETENTION_DAYS'
  | 'DRIVER_PROOF_MEDIA_S3_ACCESS_KEY_ID'
  | 'DRIVER_PROOF_MEDIA_S3_BUCKET'
  | 'DRIVER_PROOF_MEDIA_S3_ENDPOINT'
  | 'DRIVER_PROOF_MEDIA_S3_FORCE_PATH_STYLE'
  | 'DRIVER_PROOF_MEDIA_S3_REGION'
  | 'DRIVER_PROOF_MEDIA_S3_SECRET_ACCESS_KEY'
  | 'DRIVER_PROOF_MEDIA_S3_SESSION_TOKEN'
  | 'DRIVER_PROOF_MEDIA_STORAGE_BACKEND'
  | 'DRIVER_PROOF_MEDIA_STORAGE_DIR'
  | 'JWT_SECRET',
  string
>>;

export type DriverProofMediaRetentionPolicy = {
  retentionDays: number;
};

export type DriverProofMediaReadAccessPolicy = {
  readAccessTtlSeconds: number;
};

type DriverProofMediaRepositoryStorageOptions =
  | { storage: DriverProofMediaStorageBackend; storageRoot?: never }
  | { storage?: never; storageRoot: string };

type LoadDriverApiDependenciesInput = {
  env: DriverApiRuntimeEnv;
  prisma: PrismaClient;
};

export function loadDriverApiDependencies(
  input: LoadDriverApiDependenciesInput
): DriverApiDependencies | undefined {
  const jwtSecret = readOptional(input.env.JWT_SECRET);
  if (jwtSecret === undefined) {
    return undefined;
  }

  const proofMediaStorageOptions = loadDriverProofMediaRepositoryStorageOptions(input.env);

  return {
    driverAssignedRouteService: new PrismaDriverAssignedRouteRepository(input.prisma),
    driverConsentService: new PrismaDriverConsentRepository(input.prisma),
    driverEventService: new PrismaDriverEventRepository(input.prisma),
    jwtSecret,
    proofMediaService: new PrismaDriverProofMediaRepository(input.prisma, {
      readAccessTtlSeconds: loadDriverProofMediaReadAccessPolicy(input.env).readAccessTtlSeconds,
      ...proofMediaStorageOptions
    }),
    routeAccessService: new PrismaDriverRouteAccessRepository(input.prisma)
  };
}

function loadDriverProofMediaRepositoryStorageOptions(env: DriverApiRuntimeEnv): DriverProofMediaRepositoryStorageOptions {
  const backend = readOptional(env.DRIVER_PROOF_MEDIA_STORAGE_BACKEND)?.toLowerCase() ?? 'local';
  if (backend === 'local') {
    return { storageRoot: loadDriverProofMediaStorageRoot(env) };
  }
  if (backend === 's3') {
    return {
      storage: createS3DriverProofMediaStorage({
        bucket: readRequiredForS3(env.DRIVER_PROOF_MEDIA_S3_BUCKET, 'DRIVER_PROOF_MEDIA_S3_BUCKET'),
        accessKeyId: readRequiredForS3(env.DRIVER_PROOF_MEDIA_S3_ACCESS_KEY_ID, 'DRIVER_PROOF_MEDIA_S3_ACCESS_KEY_ID'),
        endpoint: readOptional(env.DRIVER_PROOF_MEDIA_S3_ENDPOINT),
        forcePathStyle: readOptionalBoolean(env.DRIVER_PROOF_MEDIA_S3_FORCE_PATH_STYLE, 'DRIVER_PROOF_MEDIA_S3_FORCE_PATH_STYLE'),
        region: readRequiredForS3(env.DRIVER_PROOF_MEDIA_S3_REGION, 'DRIVER_PROOF_MEDIA_S3_REGION'),
        secretAccessKey: readRequiredForS3(env.DRIVER_PROOF_MEDIA_S3_SECRET_ACCESS_KEY, 'DRIVER_PROOF_MEDIA_S3_SECRET_ACCESS_KEY'),
        sessionToken: readOptional(env.DRIVER_PROOF_MEDIA_S3_SESSION_TOKEN)
      })
    };
  }

  throw new Error('DRIVER_PROOF_MEDIA_STORAGE_BACKEND must be local or s3');
}

export function loadDriverProofMediaStorageRoot(env: DriverApiRuntimeEnv): string {
  return readOptional(env.DRIVER_PROOF_MEDIA_STORAGE_DIR) ?? DEFAULT_DRIVER_PROOF_MEDIA_STORAGE_DIR;
}

export function loadDriverProofMediaReadAccessPolicy(
  env: DriverApiRuntimeEnv
): DriverProofMediaReadAccessPolicy {
  const rawTtlSeconds = readOptional(env.DRIVER_PROOF_MEDIA_READ_ACCESS_TTL_SECONDS);
  if (rawTtlSeconds === undefined) {
    return { readAccessTtlSeconds: DEFAULT_DRIVER_PROOF_MEDIA_READ_ACCESS_TTL_SECONDS };
  }

  const readAccessTtlSeconds = Number(rawTtlSeconds);
  if (!Number.isInteger(readAccessTtlSeconds) || readAccessTtlSeconds <= 0) {
    throw new Error('DRIVER_PROOF_MEDIA_READ_ACCESS_TTL_SECONDS must be a positive integer');
  }

  return { readAccessTtlSeconds };
}

export function loadDriverProofMediaRetentionPolicy(env: DriverApiRuntimeEnv): DriverProofMediaRetentionPolicy {
  const rawRetentionDays = readOptional(env.DRIVER_PROOF_MEDIA_RETENTION_DAYS);
  if (rawRetentionDays === undefined) {
    return { retentionDays: DEFAULT_DRIVER_PROOF_MEDIA_RETENTION_DAYS };
  }

  const retentionDays = Number(rawRetentionDays);
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    throw new Error('DRIVER_PROOF_MEDIA_RETENTION_DAYS must be a positive integer');
  }

  return { retentionDays };
}

function readRequiredForS3(value: string | undefined, name: string): string {
  const normalized = readOptional(value);
  if (normalized === undefined) {
    throw new Error(`${name} is required when DRIVER_PROOF_MEDIA_STORAGE_BACKEND=s3`);
  }

  return normalized;
}

function readOptionalBoolean(value: string | undefined, name: string): boolean | undefined {
  const normalized = readOptional(value);
  if (normalized === undefined) {
    return undefined;
  }
  const lowered = normalized.toLowerCase();
  if (lowered === 'true' || normalized === '1') {
    return true;
  }
  if (lowered === 'false' || normalized === '0') {
    return false;
  }

  throw new Error(`${name} must be true or false`);
}

function readOptional(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  return value.trim();
}
