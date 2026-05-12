import type { PrismaClient } from '@prisma/client';
import { describe, expect, test } from 'vitest';

import {
  DEFAULT_DRIVER_PROOF_MEDIA_RETENTION_DAYS,
  loadDriverApiDependencies,
  loadDriverProofMediaRetentionPolicy
} from '../src/modules/driver/driver.dependencies.js';

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

  test('loads proof media retention policy from runtime env with a default', () => {
    expect(loadDriverProofMediaRetentionPolicy({})).toEqual({
      retentionDays: DEFAULT_DRIVER_PROOF_MEDIA_RETENTION_DAYS
    });
    expect(loadDriverProofMediaRetentionPolicy({ DRIVER_PROOF_MEDIA_RETENTION_DAYS: '30' })).toEqual({
      retentionDays: 30
    });
  });

  test('rejects invalid proof media retention days', () => {
    expect(() => loadDriverProofMediaRetentionPolicy({ DRIVER_PROOF_MEDIA_RETENTION_DAYS: '0' })).toThrow(
      'DRIVER_PROOF_MEDIA_RETENTION_DAYS must be a positive integer'
    );
  });
});
