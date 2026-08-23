import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DgiiRegistryDatasetStatus,
  DgiiRegistrySource,
  DgiiTaxpayerStatus,
  DocumentType,
  Prisma,
} from '@qorvex/database';
import { createHash, randomUUID, type Hash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { PrismaService } from '../../prisma/prisma.service';

const logicalRecordStart = /^(?:\d{9}|\d{11})\|/;
const defaultBatchSize = 2_500;
const defaultMaxInvalidRecords = 25;
const minimumOfficialRecordCount = 500_000;
const maximumInvalidRatio = 0.01;
const maximumLogicalRecordLength = 16_384;
const defaultSupersededDatasetRetention = 1;
const maximumSupersededDatasetRetention = 12;
const defaultAbandonedImportAgeHours = 24;
const maximumAbandonedImportAgeHours = 168;

export type ImportDgiiRegistryOptions = {
  source: DgiiRegistrySource;
  sourceUpdatedAt: Date;
  filename?: string;
  version?: string;
  batchSize?: number;
  maxInvalidRecords?: number;
  minimumRecordCount?: number;
};

export type ImportDgiiRegistryResult = {
  datasetId: string;
  version: string;
  source: DgiiRegistrySource;
  checksumSha256: string;
  recordCount: number;
  invalidRecordCount: number;
  sourceUpdatedAt: Date;
  activatedAt: Date | null;
  reusedExistingDataset: boolean;
};

type MinimalTaxpayerRecord = {
  datasetId: string;
  documentType: DocumentType;
  documentNumber: string;
  fiscalName: string;
  registryStatus: string;
  status: DgiiTaxpayerStatus;
};

class RegistryImportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

@Injectable()
export class DgiiRegistryImporterService {
  private readonly logger = new Logger(DgiiRegistryImporterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Imports an already obtained official TXT stream. This method intentionally
   * has no URL/download capability: obtaining DGII data remains an explicit,
   * auditable operator action.
   *
   * The official file is ISO-8859-1, CRLF, pipe-delimited and occasionally has
   * embedded physical newlines. A logical row begins only at 9/11 digits + '|'.
   */
  async importTextStream(
    input: Readable,
    options: ImportDgiiRegistryOptions,
  ): Promise<ImportDgiiRegistryResult> {
    this.validateOptions(options);
    const supersededDatasetRetention = this.getSupersededDatasetRetention();
    await this.pruneAbandonedImports(this.getAbandonedImportAgeHours());
    const batchSize = this.clamp(options.batchSize ?? defaultBatchSize, 100, 5_000);
    const maxInvalidRecords = this.clamp(
      options.maxInvalidRecords ?? defaultMaxInvalidRecords,
      0,
      1_000,
    );
    const pendingVersion = `pending:${randomUUID()}`;
    const dataset = await this.prisma.dgiiRegistryDataset.create({
      data: {
        version: pendingVersion,
        source: options.source,
        status: DgiiRegistryDatasetStatus.IMPORTING,
        filename: this.cleanFilename(options.filename),
        sourceUpdatedAt: options.sourceUpdatedAt,
      },
      select: { id: true },
    });

    const sha256 = createHash('sha256');
    let logicalRecord: string | null = null;
    let recordCount = 0;
    let invalidRecordCount = 0;
    let batch: MinimalTaxpayerRecord[] = [];

    const flushBatch = async () => {
      if (batch.length === 0) {
        return;
      }
      const created = await this.prisma.dgiiTaxpayerRecord.createMany({ data: batch });
      recordCount += created.count;
      batch = [];
    };

    const acceptLogicalRecord = async (raw: string) => {
      const parsed = this.parseLogicalRecord(dataset.id, raw);
      if (!parsed) {
        invalidRecordCount += 1;
        if (invalidRecordCount > maxInvalidRecords) {
          throw new RegistryImportError('TOO_MANY_INVALID_RECORDS');
        }
        return;
      }

      batch.push(parsed);
      if (batch.length >= batchSize) {
        await flushBatch();
      }
    };

    try {
      for await (const physicalLine of this.readPhysicalLines(input, sha256)) {
        if (logicalRecordStart.test(physicalLine)) {
          if (logicalRecord !== null) {
            await acceptLogicalRecord(logicalRecord);
          }
          logicalRecord = physicalLine;
        } else if (logicalRecord !== null) {
          if (logicalRecord.length + physicalLine.length + 1 > maximumLogicalRecordLength) {
            throw new RegistryImportError('LOGICAL_RECORD_TOO_LARGE');
          }
          logicalRecord += ` ${physicalLine}`;
        } else if (physicalLine.trim()) {
          invalidRecordCount += 1;
        }
      }

      if (logicalRecord !== null) {
        await acceptLogicalRecord(logicalRecord);
      }
      await flushBatch();

      const minimumRecordCount =
        options.source === DgiiRegistrySource.DGII_OFFICIAL
          ? Math.max(options.minimumRecordCount ?? minimumOfficialRecordCount, minimumOfficialRecordCount)
          : Math.max(options.minimumRecordCount ?? 1, 1);
      if (recordCount < minimumRecordCount) {
        throw new RegistryImportError('TRUNCATED_DATASET');
      }
      if (invalidRecordCount > maxInvalidRecords) {
        throw new RegistryImportError('TOO_MANY_INVALID_RECORDS');
      }
      if (invalidRecordCount / (recordCount + invalidRecordCount) > maximumInvalidRatio) {
        throw new RegistryImportError('INVALID_RECORD_RATIO');
      }

      const checksumSha256 = sha256.digest('hex');
      const existing = await this.prisma.dgiiRegistryDataset.findFirst({
        where: {
          checksumSha256,
          id: { not: dataset.id },
        },
        select: {
          id: true,
          version: true,
          source: true,
          checksumSha256: true,
          recordCount: true,
          invalidRecordCount: true,
          sourceUpdatedAt: true,
          activatedAt: true,
          status: true,
        },
      });

      if (existing?.checksumSha256 && existing.status !== DgiiRegistryDatasetStatus.FAILED) {
        if (existing.status === DgiiRegistryDatasetStatus.IMPORTING) {
          throw new RegistryImportError('DUPLICATE_IMPORT_IN_PROGRESS');
        }

        if (existing.source !== options.source) {
          throw new RegistryImportError('CHECKSUM_SOURCE_CONFLICT');
        }

        const activatedAt = new Date();
        const sourceUpdatedAt = this.safeDuplicateSourceUpdatedAt(
          existing.source,
          existing.sourceUpdatedAt,
          options.sourceUpdatedAt,
        );
        const reactivated = await this.reactivateExistingDataset({
          existingDatasetId: existing.id,
          stagingDatasetId: dataset.id,
          activatedAt,
          sourceUpdatedAt,
        });
        await this.pruneSupersededDatasets(supersededDatasetRetention);

        return {
          datasetId: reactivated.id,
          version: reactivated.version,
          source: reactivated.source,
          checksumSha256: reactivated.checksumSha256,
          recordCount: reactivated.recordCount,
          invalidRecordCount: reactivated.invalidRecordCount,
          sourceUpdatedAt: reactivated.sourceUpdatedAt,
          activatedAt: reactivated.activatedAt,
          reusedExistingDataset: true,
        };
      }

      if (existing?.status === DgiiRegistryDatasetStatus.FAILED) {
        await this.prisma.dgiiRegistryDataset.delete({ where: { id: existing.id } });
      }

      const version =
        options.version?.trim() ||
        `${options.source}:${options.sourceUpdatedAt.toISOString()}:${checksumSha256.slice(0, 16)}`;
      const importedAt = new Date();

      const versionConflict = await this.prisma.dgiiRegistryDataset.findUnique({
        where: { version: version.slice(0, 240) },
        select: { id: true, status: true },
      });
      if (versionConflict && versionConflict.id !== dataset.id) {
        if (versionConflict.status === DgiiRegistryDatasetStatus.FAILED) {
          await this.prisma.dgiiRegistryDataset.delete({ where: { id: versionConflict.id } });
        } else {
          throw new RegistryImportError('VERSION_CONFLICT');
        }
      }

      await this.prisma.dgiiRegistryDataset.update({
        where: { id: dataset.id },
        data: {
          version: version.slice(0, 240),
          checksumSha256,
          status: DgiiRegistryDatasetStatus.READY,
          recordCount,
          invalidRecordCount,
          importedAt,
        },
      });

      const activatedAt = new Date();
      await this.prisma.$transaction(
        async (tx) => {
          await this.acquireActivationLock(tx);
          await this.assertCanReplaceActiveDataset(tx, dataset.id);
          await tx.dgiiRegistryDataset.updateMany({
            where: {
              status: DgiiRegistryDatasetStatus.ACTIVE,
              id: { not: dataset.id },
            },
            data: {
              status: DgiiRegistryDatasetStatus.SUPERSEDED,
              deactivatedAt: activatedAt,
            },
          });
          await tx.dgiiRegistryDataset.update({
            where: { id: dataset.id },
            data: {
              status: DgiiRegistryDatasetStatus.ACTIVE,
              activatedAt,
              deactivatedAt: null,
            },
          });
        },
        // A previous import may be pruning a large superseded dataset while it
        // owns the same advisory lock. Waiting preserves ordering and prevents
        // a successfully loaded import from failing only because cleanup ran.
        { maxWait: 20_000, timeout: 360_000 },
      );
      await this.pruneSupersededDatasets(supersededDatasetRetention);

      return {
        datasetId: dataset.id,
        version,
        source: options.source,
        checksumSha256,
        recordCount,
        invalidRecordCount,
        sourceUpdatedAt: options.sourceUpdatedAt,
        activatedAt,
        reusedExistingDataset: false,
      };
    } catch (error) {
      const failureCode =
        error instanceof RegistryImportError
          ? error.code
          : error instanceof ConflictException
            ? 'VERSION_CONFLICT'
            : 'IMPORT_FAILED';

      await this.prisma.$transaction([
        this.prisma.dgiiTaxpayerRecord.deleteMany({ where: { datasetId: dataset.id } }),
        this.prisma.dgiiRegistryDataset.update({
          where: { id: dataset.id },
          data: {
            status: DgiiRegistryDatasetStatus.FAILED,
            failureCode,
            recordCount: 0,
            invalidRecordCount,
            importedAt: new Date(),
          },
        }),
      ]);
      throw error;
    }
  }

  private parseLogicalRecord(datasetId: string, raw: string): MinimalTaxpayerRecord | null {
    const columns = raw.split('|');
    if (columns.length !== 11) {
      return null;
    }

    const documentNumber = columns[0].trim();
    const fiscalName = this.cleanField(columns[1], 200);
    const registryStatus = this.cleanField(columns[9], 60);
    if (!/^(?:\d{9}|\d{11})$/.test(documentNumber) || !fiscalName || !registryStatus) {
      return null;
    }

    return {
      datasetId,
      documentType: documentNumber.length === 9 ? DocumentType.RNC : DocumentType.CEDULA,
      documentNumber,
      fiscalName,
      registryStatus,
      status: this.mapStatus(registryStatus),
    };
  }

  private mapStatus(value: string) {
    const normalized = value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();

    if (normalized === 'ACTIVO') return DgiiTaxpayerStatus.ACTIVE;
    if (normalized === 'SUSPENDIDO') return DgiiTaxpayerStatus.SUSPENDED;
    if (normalized === 'DADO DE BAJA') return DgiiTaxpayerStatus.DEREGISTERED;
    if (normalized === 'CESE TEMPORAL') return DgiiTaxpayerStatus.TEMPORARY_CESSATION;
    if (normalized === 'ANULADO') return DgiiTaxpayerStatus.ANNULLED;
    if (normalized === 'RECHAZADO') return DgiiTaxpayerStatus.REJECTED;
    return DgiiTaxpayerStatus.UNKNOWN;
  }

  private async *readPhysicalLines(input: Readable, hash: Hash): AsyncGenerator<string> {
    const decoder = new StringDecoder('latin1');
    let pending = '';

    for await (const chunk of input) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(bytes);
      pending += decoder.write(bytes);

      let newlineIndex = pending.indexOf('\n');
      while (newlineIndex >= 0) {
        let line = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line.length > maximumLogicalRecordLength) {
          throw new RegistryImportError('LOGICAL_RECORD_TOO_LARGE');
        }
        yield line;
        newlineIndex = pending.indexOf('\n');
      }

      if (pending.length > maximumLogicalRecordLength) {
        throw new RegistryImportError('LOGICAL_RECORD_TOO_LARGE');
      }
    }

    pending += decoder.end();
    if (pending) {
      if (pending.length > maximumLogicalRecordLength) {
        throw new RegistryImportError('LOGICAL_RECORD_TOO_LARGE');
      }
      yield pending.endsWith('\r') ? pending.slice(0, -1) : pending;
    }
  }

  private async reactivateExistingDataset(input: {
    existingDatasetId: string;
    stagingDatasetId: string;
    activatedAt: Date;
    sourceUpdatedAt: Date;
  }) {
    // The newly parsed copy can contain hundreds of thousands of rows. Remove
    // those unused rows before taking the short activation lock so reactivation
    // does not hold the global lock while PostgreSQL cascades a large delete.
    await this.prisma.dgiiTaxpayerRecord.deleteMany({
      where: { datasetId: input.stagingDatasetId },
    });

    return this.prisma.$transaction(
      async (tx) => {
        await this.acquireActivationLock(tx);

        const existing = await tx.dgiiRegistryDataset.findUnique({
          where: { id: input.existingDatasetId },
          select: { id: true, source: true, status: true },
        });
        if (
          !existing ||
          existing.status === DgiiRegistryDatasetStatus.IMPORTING ||
          existing.status === DgiiRegistryDatasetStatus.FAILED
        ) {
          throw new RegistryImportError('DUPLICATE_DATASET_NOT_REACTIVATABLE');
        }
        await this.assertCanReplaceActiveDataset(tx, existing.id, input.sourceUpdatedAt);

        await tx.dgiiRegistryDataset.updateMany({
          where: {
            status: DgiiRegistryDatasetStatus.ACTIVE,
            id: { not: existing.id },
          },
          data: {
            status: DgiiRegistryDatasetStatus.SUPERSEDED,
            deactivatedAt: input.activatedAt,
          },
        });
        const reactivated = await tx.dgiiRegistryDataset.update({
          where: { id: existing.id },
          data: {
            status: DgiiRegistryDatasetStatus.ACTIVE,
            sourceUpdatedAt: input.sourceUpdatedAt,
            activatedAt: input.activatedAt,
            deactivatedAt: null,
            failureCode: null,
          },
          select: {
            id: true,
            version: true,
            source: true,
            checksumSha256: true,
            recordCount: true,
            invalidRecordCount: true,
            sourceUpdatedAt: true,
            activatedAt: true,
          },
        });
        await tx.dgiiRegistryDataset.delete({ where: { id: input.stagingDatasetId } });

        if (!reactivated.checksumSha256) {
          throw new RegistryImportError('DUPLICATE_DATASET_MISSING_CHECKSUM');
        }
        return { ...reactivated, checksumSha256: reactivated.checksumSha256 };
      },
      { maxWait: 20_000, timeout: 360_000 },
    );
  }

  private async acquireActivationLock(tx: Prisma.TransactionClient) {
    await tx.$queryRaw`
      SELECT 1::int AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtext('corestack:dgii-registry-activation'))) AS acquired
    `;
  }

  private async assertCanReplaceActiveDataset(
    tx: Prisma.TransactionClient,
    targetDatasetId: string,
    proposedSourceUpdatedAt?: Date,
  ) {
    const [target, active] = await Promise.all([
      tx.dgiiRegistryDataset.findUnique({
        where: { id: targetDatasetId },
        select: { id: true, source: true, sourceUpdatedAt: true },
      }),
      tx.dgiiRegistryDataset.findFirst({
        where: {
          status: DgiiRegistryDatasetStatus.ACTIVE,
          id: { not: targetDatasetId },
        },
        select: { id: true, source: true, sourceUpdatedAt: true },
      }),
    ]);

    if (!target) {
      throw new RegistryImportError('DATASET_NOT_FOUND_DURING_ACTIVATION');
    }
    if (
      active?.source === DgiiRegistrySource.DGII_OFFICIAL &&
      target.source === DgiiRegistrySource.DGII_OFFICIAL &&
      (proposedSourceUpdatedAt ?? target.sourceUpdatedAt).getTime() <
        active.sourceUpdatedAt.getTime()
    ) {
      throw new RegistryImportError('OLDER_DATASET_CANNOT_REPLACE_ACTIVE');
    }
  }

  private safeDuplicateSourceUpdatedAt(
    source: DgiiRegistrySource,
    existing: Date,
    incoming: Date,
  ) {
    // A fixture is explicitly synthetic and may be refreshed on every preview
    // run. The same official checksum, however, proves the content did not
    // change, so a newer operator-supplied date must never make stale data fresh.
    if (source === DgiiRegistrySource.TEST_FIXTURE) {
      return incoming;
    }
    return incoming.getTime() < existing.getTime() ? incoming : existing;
  }

  private async pruneSupersededDatasets(retain: number) {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await this.acquireActivationLock(tx);
          const removable = await tx.dgiiRegistryDataset.findMany({
            where: { status: DgiiRegistryDatasetStatus.SUPERSEDED },
            orderBy: [{ deactivatedAt: 'desc' }, { activatedAt: 'desc' }, { id: 'desc' }],
            skip: retain,
            select: { id: true },
          });
          if (removable.length > 0) {
            await tx.dgiiRegistryDataset.deleteMany({
              where: { id: { in: removable.map(({ id }) => id) } },
            });
          }
        },
        { maxWait: 20_000, timeout: 300_000 },
      );
    } catch (error) {
      // Retention is maintenance after a successful atomic activation. It must
      // not mark the newly active, usable dataset as FAILED if cleanup is
      // temporarily blocked; the next import will retry pruning.
      this.logger.warn(
        `Could not prune superseded DGII datasets: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private getSupersededDatasetRetention() {
    const raw = this.config.get<string>('DGII_REGISTRY_RETAIN_SUPERSEDED_DATASETS')?.trim();
    const configured = Number(raw || defaultSupersededDatasetRetention);
    if (
      !Number.isInteger(configured) ||
      configured < 0 ||
      configured > maximumSupersededDatasetRetention
    ) {
      throw new RegistryImportError('INVALID_SUPERSEDED_RETENTION_CONFIGURATION');
    }
    return configured;
  }

  private async pruneAbandonedImports(maxAgeHours: number) {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    try {
      const deleted = await this.prisma.dgiiRegistryDataset.deleteMany({
        where: {
          status: DgiiRegistryDatasetStatus.IMPORTING,
          startedAt: { lt: cutoff },
        },
      });
      if (deleted.count > 0) {
        this.logger.warn(`Removed ${deleted.count} abandoned DGII registry import(s).`);
      }
    } catch (error) {
      // A stale attempt is invisible to lookups. Cleanup remains best effort so
      // a temporary lock on old rows cannot block importing a fresh registry.
      this.logger.warn(
        `Could not remove abandoned DGII imports: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private getAbandonedImportAgeHours() {
    const raw = this.config.get<string>('DGII_REGISTRY_IMPORT_STALE_HOURS')?.trim();
    const configured = Number(raw || defaultAbandonedImportAgeHours);
    if (
      !Number.isInteger(configured) ||
      configured < 1 ||
      configured > maximumAbandonedImportAgeHours
    ) {
      throw new RegistryImportError('INVALID_ABANDONED_IMPORT_CONFIGURATION');
    }
    return configured;
  }

  private validateOptions(options: ImportDgiiRegistryOptions) {
    if (!(options.sourceUpdatedAt instanceof Date) || Number.isNaN(options.sourceUpdatedAt.getTime())) {
      throw new RegistryImportError('INVALID_SOURCE_UPDATED_AT');
    }
    if (options.sourceUpdatedAt.getTime() > Date.now() + 60 * 60 * 1000) {
      throw new RegistryImportError('SOURCE_DATE_IN_FUTURE');
    }
    if (
      options.source !== DgiiRegistrySource.DGII_OFFICIAL &&
      options.source !== DgiiRegistrySource.TEST_FIXTURE
    ) {
      throw new RegistryImportError('INVALID_SOURCE');
    }
    if (
      options.source === DgiiRegistrySource.TEST_FIXTURE &&
      process.env.NODE_ENV === 'production'
    ) {
      throw new RegistryImportError('TEST_FIXTURE_DISABLED_IN_PRODUCTION');
    }
    if (
      options.minimumRecordCount !== undefined &&
      (!Number.isInteger(options.minimumRecordCount) || options.minimumRecordCount < 1)
    ) {
      throw new RegistryImportError('INVALID_MINIMUM_RECORD_COUNT');
    }
  }

  private cleanField(value: string, maxLength: number) {
    return value
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  private cleanFilename(value?: string) {
    if (!value) return null;
    return value.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200) || null;
  }

  private clamp(value: number, min: number, max: number) {
    if (!Number.isInteger(value)) {
      throw new RegistryImportError('INVALID_NUMERIC_OPTION');
    }
    return Math.min(Math.max(value, min), max);
  }
}
