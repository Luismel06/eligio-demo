import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  DgiiRegistryDatasetStatus,
  DgiiRegistrySource,
} from '@qorvex/database';
import { Readable } from 'node:stream';
import { AppModule } from '../app.module';
import { DgiiRegistryImporterService } from '../modules/tax-identities/tax-identities.module';
import { PrismaService } from '../prisma/prisma.service';

const fixtureRows = [
  ['101010632', 'EMPRESA DEMO RIVNU SRL', '', '', '', '', '', '', '21/08/2026', 'ACTIVO', 'NORMAL'],
  [
    '40220429126',
    'CONTRIBUYENTE DEMO RIVNU',
    '',
    '',
    '',
    '',
    '',
    '',
    '21/08/2026',
    'ACTIVO',
    'NORMAL',
  ],
  [
    '02600787341',
    'CONTRIBUYENTE DEMO SUSPENDIDO',
    '',
    '',
    '',
    '',
    '',
    '',
    '21/08/2026',
    'SUSPENDIDO',
    'NORMAL',
  ],
];

async function run() {
  if (process.env.NODE_ENV === 'production' || process.env.DGII_ALLOW_TEST_FIXTURE !== 'true') {
    throw new Error(
      'Preview fixture refused. Set DGII_ALLOW_TEST_FIXTURE=true in a non-production environment.',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const importer = app.get(DgiiRegistryImporterService);
    const prisma = app.get(PrismaService);
    const now = new Date();
    const body = `${fixtureRows.map((columns) => columns.join('|')).join('\r\n')}\r\n`;
    const imported = await importer.importTextStream(Readable.from([Buffer.from(body, 'latin1')]), {
      source: DgiiRegistrySource.TEST_FIXTURE,
      sourceUpdatedAt: now,
      filename: 'DGII_RNC_PREVIEW_FIXTURE.TXT',
      version: 'preview-fixture-v1',
      minimumRecordCount: 1,
    });

    // An idempotent rerun refreshes the preview timestamp and reactivates the
    // fixture if a different test dataset had temporarily replaced it.
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT 1::int AS "locked"
        FROM (SELECT pg_advisory_xact_lock(hashtext('corestack:dgii-registry-activation'))) AS acquired
      `;
      await tx.dgiiRegistryDataset.updateMany({
        where: {
          status: DgiiRegistryDatasetStatus.ACTIVE,
          id: { not: imported.datasetId },
        },
        data: { status: DgiiRegistryDatasetStatus.SUPERSEDED, deactivatedAt: now },
      });
      await tx.dgiiRegistryDataset.update({
        where: { id: imported.datasetId },
        data: {
          status: DgiiRegistryDatasetStatus.ACTIVE,
          sourceUpdatedAt: now,
          activatedAt: now,
          deactivatedAt: null,
        },
      });
    });

    process.stdout.write(
      `${JSON.stringify({ ...imported, sourceUpdatedAt: now, activatedAt: now }, null, 2)}\n`,
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown preview fixture error.';
    process.stderr.write(`DGII preview fixture failed: ${message}\n`);
    process.exitCode = 1;
  });
}
