import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import {
  CreditTermOption,
  CustomerCreditStatus,
  CustomerStatus,
  FiscalDocumentPurpose,
  InitialPaymentOption,
  InvoiceDocumentType,
  Prisma,
  ProductStatus,
  ProductUnit,
  Role,
  SalePaymentMode,
  SalesOrderDestination,
  SalesOrderPriceLevel,
  SalesOrderStatus,
  TaxCategory,
} from '@qorvex/database';
import type { AuthenticatedUser } from '../src/common/types/authenticated-request';
import { OrdersService } from '../src/modules/orders/orders.service';

const tenantId = 'tenant-rivnu';

function adminUser(): AuthenticatedUser {
  return {
    id: 'admin-1',
    memberships: [{ tenantId, role: Role.ADMIN }],
  } as AuthenticatedUser;
}

function cashierUser(): AuthenticatedUser {
  return {
    id: 'cashier-1',
    memberships: [{ tenantId, role: Role.CASHIER, canUsePos: true }],
  } as AuthenticatedUser;
}

test('order taking ignores requested B01 and persists a provisional B02 without checking NCF', async () => {
  const capturedCreates: Array<Record<string, unknown>> = [];
  let tenantFiscalQueries = 0;
  let sequenceQueries = 0;
  const product = {
    id: 'product-1',
    tenantId,
    name: 'Producto de prueba',
    sku: 'SKU-1',
    barcode: null,
    salePrice: new Prisma.Decimal(100),
    price: new Prisma.Decimal(100),
    taxRate: new Prisma.Decimal('0.18'),
    trackInventory: false,
    stock: 0,
    reservedStock: 0,
    unit: ProductUnit.UNIT,
    taxCategory: TaxCategory.ITBIS_18,
    status: ProductStatus.ACTIVE,
  };

  const tx = {
    customer: { findFirst: async () => null },
    product: { findMany: async () => [product] },
    tenant: {
      findUnique: async () => {
        tenantFiscalQueries += 1;
        throw new Error('order taking must not query fiscal issuance settings');
      },
    },
    fiscalSequence: {
      findFirst: async () => {
        sequenceQueries += 1;
        throw new Error('order taking must not check or reserve an NCF');
      },
    },
    salesOrder: {
      create: async (args: { data: Record<string, unknown> }) => {
        capturedCreates.push(args.data);
        return {
          id: 'order-1',
          orderNumber: args.data.orderNumber,
          customerId: null,
          destination: args.data.destination,
          fiscalPurpose: args.data.fiscalPurpose,
          fiscalDocumentTypeSnapshot: args.data.fiscalDocumentTypeSnapshot,
          status: args.data.status,
          clientName: args.data.clientName,
        };
      },
    },
    employeeActivityLog: { createMany: async () => ({ count: 2 }) },
  };
  const prisma = {
    $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx),
  };
  const service = new OrdersService(prisma as never);

  const created = await service.create(tenantId, adminUser(), {
    destination: SalesOrderDestination.CASH_SALE,
    clientName: 'Nombre tomado en órdenes',
    paymentMode: SalePaymentMode.CASH,
    // A stale or malicious client may still send this during a rolling deploy;
    // the server must ignore it because only Caja owns the fiscal decision.
    fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
    items: [{ productId: product.id, quantity: 1 }],
  });

  assert.equal(created.status, SalesOrderStatus.SENT_TO_CASHIER);
  assert.equal(capturedCreates[0].clientName, 'Nombre tomado en órdenes');
  assert.equal(capturedCreates[0].fiscalPurpose, FiscalDocumentPurpose.CONSUMER);
  assert.equal(capturedCreates[0].fiscalDocumentTypeSnapshot, InvoiceDocumentType.CONSUMER_02);
  assert.equal(capturedCreates[0].fiscalCustomerSnapshot, Prisma.JsonNull);
  assert.equal(tenantFiscalQueries, 0);
  assert.equal(sequenceQueries, 0);
});

test('credit order keeps its approved debtor flow but starts as provisional B02', async () => {
  const capturedCreates: Array<Record<string, unknown>> = [];
  const customer = {
    id: 'debtor-1',
    tenantId,
    name: 'Cliente de crédito',
    status: CustomerStatus.ACTIVE,
    creditEnabled: true,
    creditStatus: CustomerCreditStatus.ACTIVE,
    creditTermDays: 30,
    creditLimit: new Prisma.Decimal(50_000),
  };
  const product = {
    id: 'product-1',
    tenantId,
    name: 'Producto de prueba',
    sku: 'SKU-1',
    barcode: null,
    salePrice: new Prisma.Decimal(100),
    price: new Prisma.Decimal(100),
    taxRate: new Prisma.Decimal('0.18'),
    trackInventory: false,
    stock: 0,
    reservedStock: 0,
    unit: ProductUnit.UNIT,
    taxCategory: TaxCategory.ITBIS_18,
    status: ProductStatus.ACTIVE,
  };
  const tx = {
    customer: { findFirst: async () => customer },
    product: { findMany: async () => [product] },
    invoice: {
      aggregate: async () => ({ _sum: { balance: new Prisma.Decimal(0) } }),
    },
    tenant: {
      findUnique: async () => {
        throw new Error('order taking must not query fiscal issuance settings');
      },
    },
    fiscalSequence: {
      findFirst: async () => {
        throw new Error('order taking must not check or reserve an NCF');
      },
    },
    salesOrder: {
      create: async (args: { data: Record<string, unknown> }) => {
        capturedCreates.push(args.data);
        return {
          id: 'credit-order-1',
          orderNumber: args.data.orderNumber,
          customerId: args.data.customerId,
          destination: args.data.destination,
          fiscalPurpose: args.data.fiscalPurpose,
          fiscalDocumentTypeSnapshot: args.data.fiscalDocumentTypeSnapshot,
          status: args.data.status,
          clientName: args.data.clientName,
        };
      },
    },
    employeeActivityLog: { createMany: async () => ({ count: 1 }) },
  };
  const prisma = {
    $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx),
  };
  const service = new OrdersService(prisma as never);

  const created = await service.create(tenantId, adminUser(), {
    destination: SalesOrderDestination.CASH_SALE,
    clientName: 'Nombre escrito en toma de órdenes',
    customerId: customer.id,
    paymentMode: SalePaymentMode.CREDIT,
    initialPaymentOption: InitialPaymentOption.PERCENT_30,
    creditTermOption: CreditTermOption.DAYS_30,
    fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
    items: [{ productId: product.id, quantity: 1 }],
  });

  assert.equal(created.status, SalesOrderStatus.CREATED);
  assert.equal(capturedCreates[0].customerId, customer.id);
  assert.equal(capturedCreates[0].fiscalPurpose, FiscalDocumentPurpose.CONSUMER);
  assert.equal(capturedCreates[0].fiscalDocumentTypeSnapshot, InvoiceDocumentType.CONSUMER_02);
  assert.equal(capturedCreates[0].fiscalCustomerSnapshot, Prisma.JsonNull);
  const nestedApproval = capturedCreates[0].creditApproval as {
    create: { customerId: string };
  };
  assert.equal(nestedApproval.create.customerId, customer.id);
});

test('editing a legacy B01 quotation resets it to provisional B02 without sequence preflight', async () => {
  const updates: Array<Record<string, unknown>> = [];
  let sequenceQueries = 0;
  const product = {
    id: 'product-1',
    tenantId,
    name: 'Producto de prueba',
    sku: 'SKU-1',
    barcode: null,
    salePrice: new Prisma.Decimal(100),
    price: new Prisma.Decimal(100),
    taxRate: new Prisma.Decimal('0.18'),
    trackInventory: false,
    stock: 0,
    reservedStock: 0,
    unit: ProductUnit.UNIT,
    taxCategory: TaxCategory.ITBIS_18,
    status: ProductStatus.ACTIVE,
  };
  const legacyQuote = {
    id: 'quote-1',
    tenantId,
    orderNumber: 'COT-1',
    status: SalesOrderStatus.QUOTATION,
    destination: SalesOrderDestination.QUOTATION,
    paymentMode: SalePaymentMode.CASH,
    customerId: null,
    clientName: 'Nombre anterior',
    priceLevel: SalesOrderPriceLevel.REGULAR,
    initialPaymentOption: null,
    initialPaymentRate: new Prisma.Decimal(0),
    creditTermOption: null,
    dueDate: null,
    fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
    fiscalDocumentTypeSnapshot: InvoiceDocumentType.FISCAL_CREDIT_01,
    fiscalCustomerSnapshot: {
      id: null,
      name: 'Nombre anterior',
      documentType: 'RNC',
      documentNumber: '101850043',
    },
    items: [],
  };
  const tx = {
    $queryRaw: async () => [{ id: legacyQuote.id }],
    salesOrder: {
      findFirst: async () => legacyQuote,
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return { ...legacyQuote, ...args.data };
      },
    },
    salesOrderItem: { deleteMany: async () => ({ count: 0 }) },
    customer: { findFirst: async () => null },
    product: { findMany: async () => [product] },
    fiscalSequence: {
      findFirst: async () => {
        sequenceQueries += 1;
        throw new Error('quotation editing must not query NCF sequences');
      },
    },
    employeeActivityLog: { create: async () => ({ id: 'log-1' }) },
  };
  const prisma = {
    $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx),
  };
  const service = new OrdersService(prisma as never);

  await service.update(tenantId, adminUser(), legacyQuote.id, {
    destination: SalesOrderDestination.QUOTATION,
    clientName: 'Nombre actualizado',
    paymentMode: SalePaymentMode.CASH,
    fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
    items: [{ productId: product.id, quantity: 1 }],
  });

  assert.equal(updates[0].clientName, 'Nombre actualizado');
  assert.equal(updates[0].fiscalPurpose, FiscalDocumentPurpose.CONSUMER);
  assert.equal(updates[0].fiscalDocumentTypeSnapshot, InvoiceDocumentType.CONSUMER_02);
  assert.equal(updates[0].fiscalCustomerSnapshot, Prisma.JsonNull);
  assert.equal(sequenceQueries, 0);
});

test('accepting a legacy B01 quotation resets it to provisional B02 without sequence preflight', async () => {
  const updates: Array<Record<string, unknown>> = [];
  let sequenceQueries = 0;
  const product = {
    id: 'product-1',
    tenantId,
    name: 'Producto de prueba',
    sku: 'SKU-1',
    barcode: null,
    salePrice: new Prisma.Decimal(100),
    price: new Prisma.Decimal(100),
    taxRate: new Prisma.Decimal('0.18'),
    trackInventory: false,
    stock: 0,
    reservedStock: 0,
    unit: ProductUnit.UNIT,
    taxCategory: TaxCategory.ITBIS_18,
    status: ProductStatus.ACTIVE,
  };
  const legacyQuote = {
    id: 'quote-1',
    tenantId,
    orderNumber: 'COT-1',
    status: SalesOrderStatus.QUOTATION,
    destination: SalesOrderDestination.QUOTATION,
    paymentMode: SalePaymentMode.CASH,
    customer: null,
    customerId: null,
    creditApproval: null,
    clientName: 'Nombre de la orden',
    priceLevel: SalesOrderPriceLevel.REGULAR,
    total: new Prisma.Decimal(118),
    fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
    fiscalDocumentTypeSnapshot: InvoiceDocumentType.FISCAL_CREDIT_01,
    fiscalCustomerSnapshot: {
      id: null,
      name: 'Nombre de la orden',
      documentType: 'RNC',
      documentNumber: '101850043',
    },
    items: [
      {
        id: 'item-1',
        productId: product.id,
        quantity: new Prisma.Decimal(1),
        product,
      },
    ],
  };
  const tx = {
    $queryRaw: async () => [{ id: legacyQuote.id }],
    salesOrder: {
      findFirst: async () => legacyQuote,
      update: async (args: { data: Record<string, unknown> }) => {
        updates.push(args.data);
        return { ...legacyQuote, ...args.data };
      },
    },
    product: { findMany: async () => [product] },
    salesOrderItem: { update: async () => ({ id: 'item-1' }) },
    fiscalSequence: {
      findFirst: async () => {
        sequenceQueries += 1;
        throw new Error('quotation acceptance must not query NCF sequences');
      },
    },
    employeeActivityLog: { create: async () => ({ id: 'log-1' }) },
  };
  const prisma = {
    $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx),
  };
  const service = new OrdersService(prisma as never);

  const accepted = await service.accept(tenantId, adminUser(), legacyQuote.id);

  assert.equal(accepted.status, SalesOrderStatus.SENT_TO_CASHIER);
  assert.equal(updates[0].fiscalPurpose, FiscalDocumentPurpose.CONSUMER);
  assert.equal(updates[0].fiscalDocumentTypeSnapshot, InvoiceDocumentType.CONSUMER_02);
  assert.equal(updates[0].fiscalCustomerSnapshot, Prisma.JsonNull);
  assert.equal(sequenceQueries, 0);
});

test('releasing a claimed order clears its fiscal identity and restores provisional B02', async () => {
  const updates: Array<Record<string, unknown>> = [];
  let releasedOrder: Record<string, unknown> | null = null;
  let findCalls = 0;
  const claimedOrder = {
    id: 'order-claimed-1',
    tenantId,
    orderNumber: 'ORD-CLAIMED-1',
    status: SalesOrderStatus.IN_CASHIER,
    destination: SalesOrderDestination.CASH_SALE,
    claimedById: 'cashier-1',
    claimedCashSessionId: 'cash-session-1',
    clientName: 'Cliente fiscal',
    total: new Prisma.Decimal(118),
    fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
    fiscalDocumentTypeSnapshot: InvoiceDocumentType.FISCAL_CREDIT_01,
    fiscalCustomerSnapshot: {
      id: null,
      name: 'Cliente fiscal',
      documentType: 'RNC',
      documentNumber: '101850043',
      verification: {
        outcome: 'VERIFIED',
        source: 'DGII_OFFICIAL',
        sourceUpdatedAt: '2026-08-20T12:00:00.000Z',
        verifiedAt: '2026-08-21T12:00:00.000Z',
        registryStatus: 'ACTIVO',
      },
    },
  };
  const tx = {
    salesOrder: {
      findFirst: async () => {
        findCalls += 1;
        return findCalls === 1 ? claimedOrder : releasedOrder;
      },
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        updates.push(args);
        releasedOrder = { ...claimedOrder, ...args.data };
        return { count: 1 };
      },
    },
    employeeActivityLog: { create: async () => ({ id: 'log-1' }) },
  };
  const prisma = {
    $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx),
  };
  const service = new OrdersService(prisma as never);

  await service.release(tenantId, cashierUser(), claimedOrder.id);

  const where = updates[0].where as Record<string, unknown>;
  const data = updates[0].data as Record<string, unknown>;
  assert.deepEqual(where, {
    id: claimedOrder.id,
    tenantId,
    status: SalesOrderStatus.IN_CASHIER,
    invoiceId: null,
    claimedById: 'cashier-1',
  });
  assert.equal(data.fiscalPurpose, FiscalDocumentPurpose.CONSUMER);
  assert.equal(data.fiscalDocumentTypeSnapshot, InvoiceDocumentType.CONSUMER_02);
  assert.equal(data.fiscalCustomerSnapshot, Prisma.JsonNull);
  assert.equal(findCalls, 2);
});

test('release fails atomically when checkout wins the sales order race', async () => {
  const updateManyCalls: Array<Record<string, unknown>> = [];
  let activityLogCalls = 0;
  let findCalls = 0;
  const claimedOrder = {
    id: 'order-race-1',
    tenantId,
    status: SalesOrderStatus.IN_CASHIER,
    invoiceId: null,
    claimedById: 'cashier-1',
    claimedCashSessionId: 'cash-session-1',
  };
  const tx = {
    salesOrder: {
      findFirst: async () => {
        findCalls += 1;
        return claimedOrder;
      },
      updateMany: async (args: Record<string, unknown>) => {
        updateManyCalls.push(args);
        return { count: 0 };
      },
    },
    employeeActivityLog: {
      create: async () => {
        activityLogCalls += 1;
        return { id: 'unexpected-log' };
      },
    },
  };
  const prisma = {
    $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx),
  };
  const service = new OrdersService(prisma as never);

  await assert.rejects(
    service.release(tenantId, cashierUser(), claimedOrder.id),
    ConflictException,
  );

  const where = updateManyCalls[0].where as Record<string, unknown>;
  assert.deepEqual(where, {
    id: claimedOrder.id,
    tenantId,
    status: SalesOrderStatus.IN_CASHIER,
    invoiceId: null,
    claimedById: 'cashier-1',
  });
  assert.equal(findCalls, 1);
  assert.equal(activityLogCalls, 0);
});

test('expiring a claim clears its fiscal identity before the order can be reclaimed', async () => {
  const capturedUpdates: Array<Record<string, unknown>> = [];
  const prisma = {
    salesOrder: {
      updateMany: async (args: Record<string, unknown>) => {
        capturedUpdates.push(args);
        return { count: 1 };
      },
    },
  };
  const service = new OrdersService(prisma as never);

  await (
    service as unknown as { releaseExpiredClaims: (selectedTenantId: string) => Promise<void> }
  ).releaseExpiredClaims(tenantId);

  const data = capturedUpdates[0].data as Record<string, unknown>;
  assert.equal(data.status, SalesOrderStatus.SENT_TO_CASHIER);
  assert.equal(data.fiscalPurpose, FiscalDocumentPurpose.CONSUMER);
  assert.equal(data.fiscalDocumentTypeSnapshot, InvoiceDocumentType.CONSUMER_02);
  assert.equal(data.fiscalCustomerSnapshot, Prisma.JsonNull);
});
