import type { PrismaClient } from '@prisma/client';
import { describe, expect, test } from 'vitest';

import { loadDriverApiDependencies } from '../src/modules/driver/driver.dependencies.js';

describe('loadDriverApiDependencies', () => {
  test('leaves driver API disabled until JWT secret is configured', () => {
    const dependencies = loadDriverApiDependencies({ env: {}, prisma: {} as PrismaClient });

    expect(dependencies).toBeUndefined();
  });

  test('wires proof media storage from runtime env with the driver API', () => {
    const dependencies = loadDriverApiDependencies({
      env: {
        DRIVER_PROOF_MEDIA_STORAGE_DIR: '/tmp/clever-proof-media',
        JWT_SECRET: 'driver-secret'
      },
      prisma: {} as PrismaClient
    });

    expect(dependencies?.proofMediaService).toBeDefined();
  });
});
