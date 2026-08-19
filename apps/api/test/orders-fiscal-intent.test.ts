import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  CustomerStatus,
  DocumentType,
  FiscalDocumentPurpose,
  FiscalIssuanceMode,
  InvoiceDocumentType,
  Prisma,
  SalePaymentMode,
} from '@qorvex/database';
import { OrdersService } from '../src/modules/orders/orders.service';

type FiscalCustomer = {
  id: string;
  name: string;
  documentType: DocumentType;
  documentNumber: string | null;
  status: CustomerStatus;
};

type OrderFiscalInternals = {
  resolveOrderFiscalDetails(
    purpose: FiscalDocumentPurpose,
    tenant: { fiscalIssuanceMode: FiscalIssuanceMode },
    customer: FiscalCustomer | null,
    subtotal: Prisma.Decimal,
    paymentMode: SalePaymentMode,
  ): {
    documentType: InvoiceDocumentType;
    customerSnapshot: unknown;
  };
  assertPersistedFiscalDetails(order: {
    customerId: string | null;
    fiscalPurpose: FiscalDocumentPurpose;
    fiscalDocumentTypeSnapshot: InvoiceDocumentType;
    fiscalCustomerSnapshot: Prisma.JsonValue | null;
    subtotal: Prisma.Decimal;
  }): void;
};

function fiscalInternals() {
  return new OrdersService({} as never) as unknown as OrderFiscalInternals;
}

test('cash order may persist B01 intent with identity pending for Caja', () => {
  const result = fiscalInternals().resolveOrderFiscalDetails(
    FiscalDocumentPurpose.FISCAL_CREDIT,
    { fiscalIssuanceMode: FiscalIssuanceMode.LOCAL_NCF },
    null,
    new Prisma.Decimal(100),
    SalePaymentMode.CASH,
  );

  assert.equal(result.documentType, InvoiceDocumentType.FISCAL_CREDIT_01);
  assert.equal(result.customerSnapshot, null);
  assert.doesNotThrow(() =>
    fiscalInternals().assertPersistedFiscalDetails({
      customerId: null,
      fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
      fiscalDocumentTypeSnapshot: InvoiceDocumentType.FISCAL_CREDIT_01,
      fiscalCustomerSnapshot: null,
      subtotal: new Prisma.Decimal(100),
    }),
  );
});

test('credit order cannot persist B01 without valid identity on its approved Customer', () => {
  assert.throws(
    () =>
      fiscalInternals().resolveOrderFiscalDetails(
        FiscalDocumentPurpose.FISCAL_CREDIT,
        { fiscalIssuanceMode: FiscalIssuanceMode.LOCAL_NCF },
        null,
        new Prisma.Decimal(100),
        SalePaymentMode.CREDIT,
      ),
    BadRequestException,
  );
});

test('persisted fiscal validation accepts an independent inline identity for a recurrent cash customer', () => {
  assert.doesNotThrow(() =>
    fiscalInternals().assertPersistedFiscalDetails({
      customerId: 'recurrent-customer',
      fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
      fiscalDocumentTypeSnapshot: InvoiceDocumentType.FISCAL_CREDIT_01,
      fiscalCustomerSnapshot: {
        id: null,
        name: 'Cliente de la orden',
        documentType: DocumentType.RNC,
        documentNumber: '101850043',
      },
      subtotal: new Prisma.Decimal(100),
    }),
  );
});

test('persisted fiscal validation rejects a snapshot linked to a different Customer', () => {
  assert.throws(
    () =>
      fiscalInternals().assertPersistedFiscalDetails({
        customerId: 'customer-a',
        fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
        fiscalDocumentTypeSnapshot: InvoiceDocumentType.FISCAL_CREDIT_01,
        fiscalCustomerSnapshot: {
          id: 'customer-b',
          name: 'Cliente Fiscal',
          documentType: DocumentType.RNC,
          documentNumber: '101850043',
        },
        subtotal: new Prisma.Decimal(100),
      }),
    BadRequestException,
  );
});
