import type { PrismaClient } from '@prisma/client';

import { PrismaDriverConsentRepository } from './driver-consent.repository.js';
import { PrismaDriverEventRepository } from './driver-event.repository.js';
import { PrismaDriverRouteAccessRepository } from './driver-route-access.repository.js';
import type { DriverApiDependencies } from '../../routes/driver-events.routes.js';

export type DriverApiRuntimeEnv = Partial<Record<'JWT_SECRET', string>>;

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
    driverConsentService: new PrismaDriverConsentRepository(input.prisma),
    driverEventService: new PrismaDriverEventRepository(input.prisma),
    jwtSecret,
    routeAccessService: new PrismaDriverRouteAccessRepository(input.prisma)
  };
}

function readOptional(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  return value.trim();
}
