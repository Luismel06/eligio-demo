import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  CreditApprovalStatus,
  CustomerStatus,
  DocumentType,
  FiscalDocumentPurpose,
  FiscalIssuanceMode,
  InvoiceDocumentType,
  PaymentMethod,
  Prisma,
  Role,
  SalePaymentMode,
  SalesOrderDestination,
  SalesOrderStatus,
} from '@qorvex/database';
import type { AuthenticatedUser } from '../src/common/types/authenticated-request';
import { PosService } from '../src/modules/pos/pos.service';

const tenantId = 'tenant-rivnu';
const cashierId = 'cashier-1';
const cashSessionId = 'cash-session-1';

function cashierUser(): AuthenticatedUser {
  return {
    id: cashierId,
    email: 'caja@rivnu.local',
    name: 'Caja',
    status: 'ACTIVE',
    memberships: [
      {
        id: 'membership-1',
        tenantId,
        role: Role.CASHIER,
        status: 'ACTIVE',
        canUsePos: true,
        canOpenCashSession: true,
        canCloseCashSession: true,
        canApplyDiscount: false,
        canCancelInvoice: false,
        canVoidInvoice: false,
        canAdjustInventory: false,
        canManageProducts: false,
        canManageEmployees: false,
        canViewReports: false,
        canManageFiscalSequences: false,
        canViewCashLogs: false,
        canReprintReceipt: false,
        canTakeOrders: false,
      },
    ],
  } as AuthenticatedUser;
}

type HarnessOptions = {
  lockOrder?: boolean;
  sessionOpen?: boolean;
  order?: Record<string, unknown>;
  customer?: Record<string, unknown> | null;
};

function createHarness(options: HarnessOptions = {}) {
  const baseOrder = {
    id: 'order-1',
    tenantId,
    orderNumber: 'ORD-1',
    destination: SalesOrderDestination.CASH_SALE,
    status: SalesOrderStatus.IN_CASHIER,
    invoiceId: null,
    claimedById: cashierId,
    claimedCashSessionId: cashSessionId,
    claimExpiresAt: new Date(Date.now() + 60_000),
    paymentMode: SalePaymentMode.CASH,
    customerId: null,
    clientName: 'Cliente Ocasional',
    creditApproval: null,
    subtotal: new Prisma.Decimal(100),
    taxTotal: new Prisma.Decimal(18),
    discountTotal: new Prisma.Decimal(0),
    total: new Prisma.Decimal(118),
    items: [
      {
        productId: 'product-1',
        sku: 'SKU-1',
        barcode: null,
        description: 'Producto',
        quantity: new Prisma.Decimal(1),
        unit: 'UNIT',
        reservedQuantity: 1,
        unitPrice: new Prisma.Decimal(100),
        discountTotal: new Prisma.Decimal(0),
        taxCategory: 'ITBIS_18',
        taxRate: new Prisma.Decimal('0.18'),
        taxTotal: new Prisma.Decimal(18),
        subtotal: new Prisma.Decimal(100),
        total: new Prisma.Decimal(118),
        product: {
          id: 'product-1',
          trackInventory: false,
        },
      },
    ],
    fiscalPurpose: FiscalDocumentPurpose.CONSUMER,
    fiscalDocumentTypeSnapshot: InvoiceDocumentType.CONSUMER_02,
    fiscalCustomerSnapshot: null,
    ...options.order,
  };
  const rawValues: unknown[][] = [];
  const customerQueries: unknown[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const availabilityChecks: Array<{ tenantId: string; documentType: InvoiceDocumentType }> = [];
  let reserveCalls = 0;
  let rawCall = 0;

  const tx = {
    $queryRaw: async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      rawValues.push(values);
      rawCall += 1;
      if (rawCall === 1) {
        return options.lockOrder === false ? [] : [{ id: baseOrder.id }];
      }
      return [{ id: cashSessionId }];
    },
    salesOrder: {
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => baseOrder,
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return { ...baseOrder, ...args.data };
      },
    },
    cashSession: {
      findFirst: async () => (options.sessionOpen === false ? null : { id: cashSessionId }),
    },
    customer: {
      findFirst: async (args: unknown) => {
        customerQueries.push(args);
        return options.customer ?? null;
      },
    },
    tenant: {
      findUnique: async () => ({
        id: tenantId,
        fiscalIssuanceMode: FiscalIssuanceMode.LOCAL_NCF,
        rnc: '101850043',
        legalName: 'Ferretería RIVNU SRL',
        commercialName: 'Ferretería RIVNU',
        address: 'La Vega',
        phone: '8095550101',
        email: 'facturacion@rivnu.local',
        branding: { logoUrl: null },
      }),
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        audits.push(args.data);
        return args.data;
      },
    },
    fiscalSequence: {
      fields: { endNumber: 'endNumber' },
    },
  };

  const prisma = {
    employeeProfile: {
      findFirst: async () => ({ id: 'employee-1' }),
    },
    $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx),
  };
  const fiscalSequences = {
    assertAvailable: async (
      _tx: unknown,
      selectedTenantId: string,
      documentType: InvoiceDocumentType,
    ) => {
      availabilityChecks.push({ tenantId: selectedTenantId, documentType });
    },
    reserve: async () => {
      reserveCalls += 1;
      throw new Error('reserve must not run while confirming fiscal details');
    },
  };

  return {
    service: new PosService(prisma as never, fiscalSequences as never),
    calls: {
      rawValues,
      customerQueries,
      updates,
      audits,
      availabilityChecks,
      reserveCalls: () => reserveCalls,
    },
  };
}

test('POS fiscal update scopes the order lock to the selected tenant', async () => {
  const harness = createHarness({ lockOrder: false });

  await assert.rejects(
    harness.service.updateOrderFiscalDetails(tenantId, cashierUser(), 'foreign-order', {
      fiscalPurpose: FiscalDocumentPurpose.CONSUMER,
      customerId: null,
    }),
    NotFoundException,
  );

  assert.deepEqual(harness.calls.rawValues[0], ['foreign-order', tenantId]);
  assert.equal(harness.calls.updates.length, 0);
});

test('POS fiscal update requires the cashier that owns the live claim', async () => {
  const harness = createHarness({
    order: { claimedById: 'cashier-2' },
  });

  await assert.rejects(
    harness.service.updateOrderFiscalDetails(tenantId, cashierUser(), 'order-1', {
      fiscalPurpose: FiscalDocumentPurpose.CONSUMER,
      customerId: null,
    }),
    ForbiddenException,
  );

  assert.equal(harness.calls.updates.length, 0);
  assert.equal(harness.calls.availabilityChecks.length, 0);
});

test('POS fiscal update rejects an expired claim or a closed cashier session', async () => {
  const expired = createHarness({
    order: { claimExpiresAt: new Date(Date.now() - 1_000) },
  });
  await assert.rejects(
    expired.service.updateOrderFiscalDetails(tenantId, cashierUser(), 'order-1', {
      fiscalPurpose: FiscalDocumentPurpose.CONSUMER,
      customerId: null,
    }),
    BadRequestException,
  );

  const closedSession = createHarness({ sessionOpen: false });
  await assert.rejects(
    closedSession.service.updateOrderFiscalDetails(tenantId, cashierUser(), 'order-1', {
      fiscalPurpose: FiscalDocumentPurpose.CONSUMER,
      customerId: null,
    }),
    BadRequestException,
  );

  assert.equal(expired.calls.updates.length, 0);
  assert.equal(closedSession.calls.updates.length, 0);
});

test('POS fiscal update cannot replace the customer approved for a credit sale', async () => {
  const harness = createHarness({
    order: {
      paymentMode: SalePaymentMode.CREDIT,
      customerId: 'approved-customer',
      creditApproval: {
        status: CreditApprovalStatus.APPROVED,
        customerId: 'approved-customer',
      },
    },
  });

  await assert.rejects(
    harness.service.updateOrderFiscalDetails(tenantId, cashierUser(), 'order-1', {
      fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
      customerId: 'different-customer',
    }),
    BadRequestException,
  );

  assert.equal(harness.calls.customerQueries.length, 0);
  assert.equal(harness.calls.updates.length, 0);
});

test('POS fiscal update looks up the persisted order customer inside the active tenant', async () => {
  const harness = createHarness({
    customer: null,
    order: { customerId: 'customer-from-another-tenant' },
  });

  await assert.rejects(
    harness.service.updateOrderFiscalDetails(tenantId, cashierUser(), 'order-1', {
      fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
    }),
    NotFoundException,
  );

  assert.deepEqual(harness.calls.customerQueries[0], {
    where: {
      id: 'customer-from-another-tenant',
      tenantId,
    },
  });
  assert.equal(harness.calls.updates.length, 0);
});

test('POS fiscal update does not derive B01 identity from a registered Customer', async () => {
  const customer = {
    id: 'fiscal-customer',
    tenantId,
    name: 'Cliente Fiscal',
    documentType: DocumentType.RNC,
    documentNumber: '101850043',
    status: CustomerStatus.ACTIVE,
  };
  const harness = createHarness({ customer, order: { customerId: customer.id } });

  await assert.rejects(
    harness.service.updateOrderFiscalDetails(tenantId, cashierUser(), 'order-1', {
      fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
      customerId: customer.id,
    }),
    (error: unknown) => {
      assert.equal(error instanceof BadRequestException, true);
      assert.match((error as BadRequestException).message, /digitar un RNC o cédula válida/i);
      return true;
    },
  );

  assert.equal(harness.calls.customerQueries.length, 1);
  assert.equal(harness.calls.updates.length, 0);
  assert.equal(harness.calls.availabilityChecks.length, 0);
  assert.equal(harness.calls.reserveCalls(), 0);
});

test('POS fiscal update captures one-time B01 identity from the order without creating a Customer', async () => {
  const harness = createHarness();

  const updated = await harness.service.updateOrderFiscalDetails(
    tenantId,
    cashierUser(),
    'order-1',
    {
      fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
      customerId: null,
      documentType: DocumentType.RNC,
      documentNumber: '1-01-85004-3',
    },
  );

  assert.equal(updated.customerId, null);
  assert.equal(updated.fiscalDocumentTypeSnapshot, InvoiceDocumentType.FISCAL_CREDIT_01);
  assert.equal(harness.calls.customerQueries.length, 0);
  assert.equal(harness.calls.reserveCalls(), 0);
  assert.deepEqual(harness.calls.updates[0].fiscalCustomerSnapshot, {
    id: null,
    name: 'Cliente Ocasional',
    documentType: DocumentType.RNC,
    documentNumber: '101850043',
  });
  assert.deepEqual(harness.calls.availabilityChecks, [
    { tenantId, documentType: InvoiceDocumentType.FISCAL_CREDIT_01 },
  ]);
  assert.equal(harness.calls.audits[0].metadata.fiscalIdentitySource, 'ORDER_INLINE');
  assert.equal(harness.calls.audits[0].metadata.customerNameSource, 'SALES_ORDER_CLIENT_NAME');
  assert.equal(harness.calls.audits[0].metadata.customerDocumentLast4, '0043');
  assert.equal(JSON.stringify(harness.calls.audits[0]).includes('101850043'), false);
});

test('POS fiscal update preserves a recurrent cash customer while using independent inline identity', async () => {
  const customer = {
    id: 'recurrent-customer',
    tenantId,
    name: 'Nombre guardado distinto',
    documentType: DocumentType.CONSUMER_FINAL,
    documentNumber: null,
    status: CustomerStatus.ACTIVE,
  };
  const harness = createHarness({ customer, order: { customerId: customer.id } });

  const updated = await harness.service.updateOrderFiscalDetails(
    tenantId,
    cashierUser(),
    'order-1',
    {
      fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
      documentType: DocumentType.RNC,
      documentNumber: '101850043',
    },
  );

  assert.equal(updated.customerId, customer.id);
  assert.equal(Object.hasOwn(harness.calls.updates[0], 'customerId'), false);
  assert.deepEqual(harness.calls.updates[0].fiscalCustomerSnapshot, {
    id: null,
    name: 'Cliente Ocasional',
    documentType: DocumentType.RNC,
    documentNumber: '101850043',
  });
});

test('POS permits anonymous B02 immediately below the RD$250,000 pre-ITBIS threshold', async () => {
  const harness = createHarness({
    order: { subtotal: new Prisma.Decimal('249999.99') },
  });

  const updated = await harness.service.updateOrderFiscalDetails(
    tenantId,
    cashierUser(),
    'order-1',
    { fiscalPurpose: FiscalDocumentPurpose.CONSUMER, customerId: null },
  );

  assert.equal(updated.fiscalPurpose, FiscalDocumentPurpose.CONSUMER);
  assert.equal(updated.fiscalDocumentTypeSnapshot, InvoiceDocumentType.CONSUMER_02);
  assert.equal(harness.calls.updates[0].fiscalCustomerSnapshot, Prisma.JsonNull);
  assert.deepEqual(harness.calls.availabilityChecks, [
    { tenantId, documentType: InvoiceDocumentType.CONSUMER_02 },
  ]);
  assert.equal(harness.calls.reserveCalls(), 0);
});

test('POS requires inline identity for B02 at the RD$250,000 pre-ITBIS threshold', async () => {
  const harness = createHarness({
    order: { subtotal: new Prisma.Decimal('250000.00') },
  });

  await assert.rejects(
    harness.service.updateOrderFiscalDetails(tenantId, cashierUser(), 'order-1', {
      fiscalPurpose: FiscalDocumentPurpose.CONSUMER,
      customerId: null,
    }),
    (error: unknown) => {
      assert.equal(error instanceof BadRequestException, true);
      assert.match((error as BadRequestException).message, /RD\$250,000.*digitar/i);
      return true;
    },
  );

  assert.equal(harness.calls.updates.length, 0);
  assert.equal(harness.calls.availabilityChecks.length, 0);
  assert.equal(harness.calls.reserveCalls(), 0);
});

test('POS fiscal update requires the order name for a one-time B01 identity', async () => {
  const harness = createHarness({ order: { clientName: null } });

  await assert.rejects(
    harness.service.updateOrderFiscalDetails(tenantId, cashierUser(), 'order-1', {
      fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
      customerId: null,
      documentType: DocumentType.RNC,
      documentNumber: '101850043',
    }),
    (error: unknown) => {
      assert.equal(error instanceof BadRequestException, true);
      assert.match((error as BadRequestException).message, /orden debe tener el nombre/i);
      return true;
    },
  );

  assert.equal(harness.calls.updates.length, 0);
  assert.equal(harness.calls.availabilityChecks.length, 0);
});

test('POS fiscal update keeps the approved credit debtor while using inline B01 identity', async () => {
  const approvedCustomer = {
    id: 'approved-customer',
    tenantId,
    name: 'Deudor guardado',
    documentType: DocumentType.CONSUMER_FINAL,
    documentNumber: null,
    status: CustomerStatus.ACTIVE,
  };
  const harness = createHarness({
    customer: approvedCustomer,
    order: {
      paymentMode: SalePaymentMode.CREDIT,
      customerId: approvedCustomer.id,
      creditApproval: {
        status: CreditApprovalStatus.APPROVED,
        customerId: approvedCustomer.id,
      },
    },
  });

  const updated = await harness.service.updateOrderFiscalDetails(
    tenantId,
    cashierUser(),
    'order-1',
    {
      fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
      customerId: approvedCustomer.id,
      documentType: DocumentType.RNC,
      documentNumber: '101850043',
    },
  );

  assert.equal(updated.customerId, approvedCustomer.id);
  assert.equal(Object.hasOwn(harness.calls.updates[0], 'customerId'), false);
  assert.deepEqual(harness.calls.updates[0].fiscalCustomerSnapshot, {
    id: null,
    name: 'Cliente Ocasional',
    documentType: DocumentType.RNC,
    documentNumber: '101850043',
  });
  assert.equal(harness.calls.audits[0].metadata.fiscalIdentitySource, 'ORDER_INLINE');
  assert.equal(harness.calls.audits[0].metadata.customerNameSource, 'SALES_ORDER_CLIENT_NAME');
  assert.equal(harness.calls.reserveCalls(), 0);
});

test('POS fiscal update rejects an invalid B01 identity before checking or consuming a sequence', async () => {
  const harness = createHarness({
    customer: {
      id: 'invalid-customer',
      tenantId,
      name: 'Cliente inválido',
      documentType: DocumentType.RNC,
      documentNumber: '123456789',
      status: CustomerStatus.ACTIVE,
    },
    order: { customerId: 'invalid-customer' },
  });

  await assert.rejects(
    harness.service.updateOrderFiscalDetails(tenantId, cashierUser(), 'order-1', {
      fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
      customerId: 'invalid-customer',
      documentType: DocumentType.RNC,
      documentNumber: '123456789',
    }),
    BadRequestException,
  );

  assert.equal(harness.calls.availabilityChecks.length, 0);
  assert.equal(harness.calls.reserveCalls(), 0);
  assert.equal(harness.calls.updates.length, 0);
});

test('POS checkout handles an explicit null legacy customer without a TypeError', async () => {
  const harness = createHarness({
    order: {
      customerId: 'persisted-customer',
    },
  });

  await assert.rejects(
    harness.service.completeSale(tenantId, cashierUser(), {
      orderId: 'order-1',
      paymentMethod: PaymentMethod.CASH,
      customerId: null,
    } as never),
    (error: unknown) => {
      assert.equal(error instanceof TypeError, false);
      assert.equal(error instanceof BadRequestException, true);
      assert.match(
        (error as BadRequestException).message,
        /fixed by the sales order and cannot be changed/i,
      );
      return true;
    },
  );

  assert.equal(harness.calls.reserveCalls(), 0);
});

test('POS checkout accepts an inline B01 snapshot and reaches atomic sequence reservation', async () => {
  const harness = createHarness({
    order: {
      fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
      fiscalDocumentTypeSnapshot: InvoiceDocumentType.FISCAL_CREDIT_01,
      fiscalCustomerSnapshot: {
        id: null,
        name: 'Cliente Ocasional',
        documentType: DocumentType.RNC,
        documentNumber: '101850043',
      },
    },
  });

  await assert.rejects(
    harness.service.completeSale(tenantId, cashierUser(), {
      orderId: 'order-1',
      paymentMethod: PaymentMethod.CASH,
    } as never),
    /reserve must not run while confirming fiscal details/,
  );

  assert.equal(harness.calls.reserveCalls(), 1);
});

test('POS checkout rejects pending B01 identity before consuming a sequence', async () => {
  const harness = createHarness({
    order: {
      fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
      fiscalDocumentTypeSnapshot: InvoiceDocumentType.FISCAL_CREDIT_01,
      fiscalCustomerSnapshot: null,
    },
  });

  await assert.rejects(
    harness.service.completeSale(tenantId, cashierUser(), {
      orderId: 'order-1',
      paymentMethod: PaymentMethod.CASH,
    } as never),
    (error: unknown) => {
      assert.equal(error instanceof BadRequestException, true);
      assert.match((error as BadRequestException).message, /B01 requiere/i);
      return true;
    },
  );

  assert.equal(harness.calls.reserveCalls(), 0);
});
