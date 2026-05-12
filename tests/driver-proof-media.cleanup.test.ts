import { describe, expect, test, vi } from 'vitest';

import {
  calculateProofMediaCleanupCutoff,
  runDriverProofMediaRetentionCleanup
} from '../src/modules/driver/driver-proof-media.cleanup.js';

describe('driver proof media retention cleanup runner', () => {
  test('calculates the upload cutoff from the configured retention days', () => {
    expect(
      calculateProofMediaCleanupCutoff({
        now: new Date('2026-05-13T00:00:00.000Z'),
        retentionDays: 180
      }).toISOString()
    ).toBe('2025-11-14T00:00:00.000Z');
  });

  test('calls the repository cleanup with cutoff, deletedAt, and batch limit', async () => {
    const deleteExpiredProofMedia = vi.fn(() =>
      Promise.resolve({
        deleted: 2,
        missingFiles: 1,
        scanned: 3
      })
    );
    const now = new Date('2026-05-13T00:00:00.000Z');

    const result = await runDriverProofMediaRetentionCleanup({
      limit: 50,
      now: () => now,
      proofMediaRepository: { deleteExpiredProofMedia },
      retentionPolicy: { retentionDays: 180 }
    });

    expect(deleteExpiredProofMedia).toHaveBeenCalledWith({
      deletedAt: now,
      limit: 50,
      uploadedBefore: new Date('2025-11-14T00:00:00.000Z')
    });
    expect(result).toEqual({
      deleted: 2,
      deletedAt: now,
      missingFiles: 1,
      scanned: 3,
      uploadedBefore: new Date('2025-11-14T00:00:00.000Z')
    });
  });
});
