import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  DocumentType,
  FiscalDocumentPurpose,
  FiscalIssuanceMode,
  InvoiceDocumentType,
} from '@qorvex/database';
import {
  buildFiscalCustomerSnapshot,
  buildInlineFiscalCustomerSnapshot,
  fiscalDocumentTypeMatchesPurpose,
  mapFiscalDocumentType,
  readFiscalCustomerSnapshot,
  resolveFiscalDocumentType,
} from '../src/modules/fiscal-documents/fiscal-document';

test('maps purpose and issuer mode to the four supported invoice document types', () => {
  assert.equal(
    mapFiscalDocumentType(FiscalDocumentPurpose.CONSUMER, FiscalIssuanceMode.LOCAL_NCF),
    InvoiceDocumentType.CONSUMER_02,
  );
  assert.equal(
    mapFiscalDocumentType(FiscalDocumentPurpose.FISCAL_CREDIT, FiscalIssuanceMode.LOCAL_NCF),
    InvoiceDocumentType.FISCAL_CREDIT_01,
  );
  assert.equal(
    mapFiscalDocumentType(FiscalDocumentPurpose.CONSUMER, FiscalIssuanceMode.ELECTRONIC_ECF),
    InvoiceDocumentType.CONSUMER_ELECTRONIC_32,
  );
  assert.equal(
    mapFiscalDocumentType(FiscalDocumentPurpose.FISCAL_CREDIT, FiscalIssuanceMode.ELECTRONIC_ECF),
    InvoiceDocumentType.FISCAL_CREDIT_ELECTRONIC_31,
  );
});

test('fails closed when electronic invoicing is selected but not production-ready', () => {
  assert.throws(
    () =>
      resolveFiscalDocumentType(FiscalDocumentPurpose.CONSUMER, FiscalIssuanceMode.ELECTRONIC_ECF),
    BadRequestException,
  );
  assert.equal(
    resolveFiscalDocumentType(FiscalDocumentPurpose.CONSUMER, FiscalIssuanceMode.LOCAL_NCF),
    InvoiceDocumentType.CONSUMER_02,
  );
});

test('matches each concrete fiscal document only to its persisted purpose', () => {
  assert.equal(
    fiscalDocumentTypeMatchesPurpose(
      FiscalDocumentPurpose.CONSUMER,
      InvoiceDocumentType.CONSUMER_02,
    ),
    true,
  );
  assert.equal(
    fiscalDocumentTypeMatchesPurpose(
      FiscalDocumentPurpose.FISCAL_CREDIT,
      InvoiceDocumentType.FISCAL_CREDIT_ELECTRONIC_31,
    ),
    true,
  );
  assert.equal(
    fiscalDocumentTypeMatchesPurpose(
      FiscalDocumentPurpose.CONSUMER,
      InvoiceDocumentType.FISCAL_CREDIT_01,
    ),
    false,
  );
  assert.equal(
    fiscalDocumentTypeMatchesPurpose(
      FiscalDocumentPurpose.FISCAL_CREDIT,
      InvoiceDocumentType.CONSUMER_ELECTRONIC_32,
    ),
    false,
  );
});

test('normalizes a valid Dominican fiscal customer and rejects invalid or generic identities', () => {
  const snapshot = buildFiscalCustomerSnapshot(
    {
      id: 'customer-1',
      name: 'Cliente Fiscal',
      documentType: DocumentType.RNC,
      documentNumber: '1-01-85004-3',
    },
    false,
  );

  assert.deepEqual(snapshot, {
    id: 'customer-1',
    name: 'Cliente Fiscal',
    documentType: DocumentType.RNC,
    documentNumber: '101850043',
  });
  assert.deepEqual(readFiscalCustomerSnapshot(snapshot), snapshot);
  assert.equal(
    buildFiscalCustomerSnapshot(
      {
        id: 'customer-2',
        name: 'Consumidor',
        documentType: DocumentType.CONSUMER_FINAL,
        documentNumber: null,
      },
      true,
    ),
    null,
  );
  assert.equal(
    buildFiscalCustomerSnapshot(
      {
        id: 'customer-3',
        name: 'RNC incorrecto',
        documentType: DocumentType.RNC,
        documentNumber: '123456789',
      },
      false,
    ),
    null,
  );
});

test('accepts passport only for identified consumer flows, never for fiscal credit', () => {
  const foreignCustomer = {
    id: 'customer-foreign',
    name: 'Cliente Extranjero',
    documentType: DocumentType.PASSPORT,
    documentNumber: 'PA1234567',
  };

  assert.equal(buildFiscalCustomerSnapshot(foreignCustomer, false), null);
  assert.deepEqual(buildFiscalCustomerSnapshot(foreignCustomer, true), foreignCustomer);
});

test('builds and reads a one-time fiscal identity without a Customer id', () => {
  const snapshot = buildInlineFiscalCustomerSnapshot(
    '  Cliente de la orden  ',
    DocumentType.RNC,
    '1-01-85004-3',
  );

  assert.deepEqual(snapshot, {
    id: null,
    name: 'Cliente de la orden',
    documentType: DocumentType.RNC,
    documentNumber: '101850043',
  });
  assert.deepEqual(readFiscalCustomerSnapshot(snapshot), snapshot);
  assert.deepEqual(
    readFiscalCustomerSnapshot({
      name: 'Snapshot histórico sin id',
      documentType: DocumentType.RNC,
      documentNumber: '101850043',
    }),
    {
      id: null,
      name: 'Snapshot histórico sin id',
      documentType: DocumentType.RNC,
      documentNumber: '101850043',
    },
  );
});
