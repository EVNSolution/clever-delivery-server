import type { PrismaClient } from '@prisma/client';

import { PrismaDriverAssignedRouteRepository } from './driver-assigned-route.repository.js';
import { PrismaDriverConsentRepository } from './driver-consent.repository.js';
import { PrismaDriverEventRepository } from './driver-event.repository.js';
import { PrismaDriverProofMediaRepository } from './driver-proof-media.repository.js';
import { PrismaDriverRouteAccessRepository } from './driver-route-access.repository.js';
import type { DriverApiDependencies } from '../../routes/driver-events.routes.js';

export const DEFAULT_DRIVER_PROOF_MEDIA_RETENTION_DAYS = 180;
export const DEFAULT_DRIVER_PROOF_MEDIA_READ_ACCESS_TTL_SECONDS = 5 * 60;
export const DEFAULT_DRIVER_PROOF_MEDIA_STORAGE_DIR = 'var/driver-proof-media';

export type DriverApiRuntimeEnv = Partial<Record<
  | 'DRIVER_PROOF_MEDIA_READ_ACCESS_TTL_SECONDS'
  | 'DRIVER_PROOF_MEDIA_RETENTION_DAYS'
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

  return {
    driverAssignedRouteService: new PrismaDriverAssignedRouteRepository(input.prisma),
    driverConsentService: new PrismaDriverConsentRepository(input.prisma),
    driverEventService: new PrismaDriverEventRepository(input.prisma),
    jwtSecret,
    proofMediaService: new PrismaDriverProofMediaRepository(input.prisma, {
      readAccessTtlSeconds: loadDriverProofMediaReadAccessPolicy(input.env).readAccessTtlSeconds,
      storageRoot: loadDriverProofMediaStorageRoot(input.env)
    }),
    routeAccessService: new PrismaDriverRouteAccessRepository(input.prisma)
  };
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

function readOptional(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  return value.trim();
}
