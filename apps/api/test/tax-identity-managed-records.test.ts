import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DgiiRegistrySource, DocumentType, TaxIdentityContextType } from '@qorvex/database';
import type { AuthenticatedUser } from '../src/common/types/authenticated-request';
import { TaxIdentitiesService } from '../src/modules/tax-identities/tax-identities.service';

const sourceUpdatedAt = new Date();

function createRegistryHarness() {
  let approvalRepositoryCalls = 0;
  let overrideRepositoryCalls = 0;
  const registryDb = {
    dgiiRegistryDataset: {
      findFirst: async () => ({
        source: DgiiRegistrySource.DGII_OFFICIAL,
        sourceUpdatedAt,
        records: [],
      }),
    },
    taxIdentityOverride: new Proxy(
      {},
      {
        get() {
          overrideRepositoryCalls += 1;
          throw new Error('A managed manual entry must not access fiscal overrides.');
        },
      },
    ),
  };
  const prisma = {
    ...registryDb,
    taxIdentityApprovalRequest: new Proxy(
      {},
      {
        get() {
          approvalRepositoryCalls += 1;
          throw new Error('A managed manual entry must not create an approval request.');
        },
      },
    ),
  };
  const config = new ConfigService({
    TAX_IDENTITY_HMAC_SECRET: 'managed-record-test-tax-identity-key-32-bytes-minimum',
    DGII_REGISTRY_MAX_AGE_HOURS: '216',
  });

  return {
    service: new TaxIdentitiesService(prisma as never, config),
    registryDb,
    repositoryCalls: () => ({ approvalRepositoryCalls, overrideRepositoryCalls }),
  };
}

test('a confirmed NOT_FOUND managed identity becomes explicit MANUAL_ENTRY evidence only', async () => {
  const harness = createRegistryHarness();

  const evidence = await harness.service.resolveManagedRecordIdentity(
    {
      documentType: DocumentType.RNC,
      documentNumber: '1-01-85004-3',
      manualFiscalName: '  Empresa registrada manualmente  ',
      manualEntryConfirmed: true,
    },
    { db: harness.registryDb as never },
  );

  assert.equal(evidence.outcome, 'UNVERIFIED_MANUAL');
  assert.equal(evidence.source, 'MANUAL_ENTRY');
  assert.equal(evidence.documentNumber, '101850043');
  assert.equal(evidence.fiscalName, 'Empresa registrada manualmente');
  assert.equal('overrideId' in evidence, false);
  assert.deepEqual(harness.repositoryCalls(), {
    approvalRepositoryCalls: 0,
    overrideRepositoryCalls: 0,
  });
});

test('a NOT_FOUND managed identity requires an explicit manual confirmation', async () => {
  const harness = createRegistryHarness();

  await assert.rejects(
    () =>
      harness.service.resolveManagedRecordIdentity(
        {
          documentType: DocumentType.RNC,
          documentNumber: '101850043',
          manualFiscalName: 'Empresa sin confirmar',
          manualEntryConfirmed: false,
        },
        { db: harness.registryDb as never },
      ),
    UnprocessableEntityException,
  );

  assert.deepEqual(harness.repositoryCalls(), {
    approvalRepositoryCalls: 0,
    overrideRepositoryCalls: 0,
  });
});

test('MANUAL_ENTRY evidence cannot satisfy the POS B01 identity requirement', async () => {
  const harness = createRegistryHarness();
  const evidence = await harness.service.resolveManagedRecordIdentity(
    {
      documentType: DocumentType.RNC,
      documentNumber: '101850043',
      manualFiscalName: 'Empresa no verificada por DGII',
      manualEntryConfirmed: true,
    },
    { db: harness.registryDb as never },
  );

  await assert.rejects(
    () =>
      harness.service.requireUsableIdentity(
        {
          tenantId: 'tenant-rivnu',
          documentType: DocumentType.RNC,
          documentNumber: '101850043',
          contextType: TaxIdentityContextType.POS_ORDER,
          contextId: 'order-1',
        },
        {
          db: harness.registryDb as never,
          fallbackVerification: evidence,
        },
      ),
    UnprocessableEntityException,
  );

  assert.deepEqual(harness.repositoryCalls(), {
    approvalRepositoryCalls: 0,
    overrideRepositoryCalls: 0,
  });
});

test('approval service rejects non-POS contexts before touching persistence', async () => {
  let persistenceReads = 0;
  const prisma = new Proxy(
    {},
    {
      get() {
        persistenceReads += 1;
        throw new Error('Non-POS approval rejection must happen before persistence access.');
      },
    },
  );
  const service = new TaxIdentitiesService(
    prisma as never,
    new ConfigService({
      TAX_IDENTITY_HMAC_SECRET: 'non-pos-rejection-test-key-32-bytes-minimum',
    }),
  );
  const nonPosContexts = [
    TaxIdentityContextType.CUSTOMER,
    TaxIdentityContextType.SUPPLIER,
    TaxIdentityContextType.CUSTOMER_CREATE,
    TaxIdentityContextType.SUPPLIER_CREATE,
  ];

  for (const contextType of nonPosContexts) {
    await assert.rejects(
      () =>
        service.createApprovalRequest('tenant-rivnu', {} as AuthenticatedUser, {
          contextType,
          contextId: 'managed-record-1',
          documentType: DocumentType.RNC,
          documentNumber: '101850043',
          fiscalName: 'Identidad administrada',
        }),
      ForbiddenException,
    );
  }

  assert.equal(persistenceReads, 0);
});
