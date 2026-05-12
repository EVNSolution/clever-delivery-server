import { PrismaClient } from '@prisma/client';

import { runDriverProofMediaRetentionCleanup } from '../modules/driver/driver-proof-media.cleanup.js';
import { PrismaDriverProofMediaRepository } from '../modules/driver/driver-proof-media.repository.js';
import {
  loadDriverProofMediaRetentionPolicy,
  loadDriverProofMediaStorageRoot
} from '../modules/driver/driver.dependencies.js';

const prisma = new PrismaClient();

try {
  const retentionPolicy = loadDriverProofMediaRetentionPolicy(process.env);
  const repository = new PrismaDriverProofMediaRepository(prisma, {
    storageRoot: loadDriverProofMediaStorageRoot(process.env)
  });
  const result = await runDriverProofMediaRetentionCleanup({
    proofMediaRepository: repository,
    retentionPolicy
  });

  console.log(JSON.stringify({
    deleted: result.deleted,
    deletedAt: result.deletedAt.toISOString(),
    missingFiles: result.missingFiles,
    scanned: result.scanned,
    uploadedBefore: result.uploadedBefore.toISOString()
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
