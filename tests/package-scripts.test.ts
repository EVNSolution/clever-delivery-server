import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

describe('package scripts', () => {
  test('exposes a proof media cleanup command for scheduled operations', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['driver:proof-media:cleanup']).toBe('tsx src/scripts/cleanup-driver-proof-media.ts');
  });
});
