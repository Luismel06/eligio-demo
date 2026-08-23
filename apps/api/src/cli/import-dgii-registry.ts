import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DgiiRegistrySource } from '@qorvex/database';
import { createReadStream } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AppModule } from '../app.module';
import { DgiiRegistryImporterService } from '../modules/tax-identities/tax-identities.module';

async function run() {
  const { values } = parseArgs({
    options: {
      file: { type: 'string' },
      'source-updated-at': { type: 'string' },
      version: { type: 'string' },
      'max-invalid-records': { type: 'string' },
    },
    strict: true,
  });

  if (!values.file || !values['source-updated-at']) {
    throw new Error(
      'Usage: import-dgii-registry --file /secure/DGII_RNC.TXT --source-updated-at 2026-08-15T06:57:03Z [--version VERSION]',
    );
  }

  const sourceUpdatedAt = new Date(values['source-updated-at']);
  if (Number.isNaN(sourceUpdatedAt.getTime())) {
    throw new Error('--source-updated-at must be a valid ISO-8601 date.');
  }

  const maxInvalidRecords = values['max-invalid-records']
    ? Number(values['max-invalid-records'])
    : undefined;
  const file = resolve(values.file);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

  try {
    const importer = app.get(DgiiRegistryImporterService);
    const result = await importer.importTextStream(createReadStream(file), {
      source: DgiiRegistrySource.DGII_OFFICIAL,
      sourceUpdatedAt,
      filename: basename(file),
      version: values.version,
      maxInvalidRecords,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown registry import error.';
    process.stderr.write(`DGII registry import failed: ${message}\n`);
    process.exitCode = 1;
  });
}
