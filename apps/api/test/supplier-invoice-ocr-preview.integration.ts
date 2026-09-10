import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, ProductUnit } from '@qorvex/database';
import { PrismaService } from '../src/prisma/prisma.service';
import { SupplierInvoicesService } from '../src/modules/supplier-invoices/supplier-invoices.service';
import { ReceiptsService } from '../src/modules/receipts/receipts.service';
import type { CreateSupplierInvoiceDto } from '../src/modules/supplier-invoices/dto/supplier-invoice.dto';

/**
 * Opt-in real PostgreSQL test, exclusively against the existing isolated preview.
 *
 * Required: NODE_ENV=test, RIVNU_PREVIEW_GUARD=RIVNU_DGII_PREVIEW_ONLY,
 * RIVNU_OCR_PREVIEW_INTEGRATION_CONFIRM=rollback-only-preview and a separately
 * supplied RIVNU_OCR_PREVIEW_INTEGRATION_DATABASE_URL. No .env is loaded.
 * All service calls and temporary fixtures share ONE outer transaction, whose
 * success path intentionally throws to force rollback. No cleanup DELETE runs.
 * Run with the repository's tsx runner and --tsconfig apps/api/tsconfig.json.
 */
const databaseUrl = process.env.RIVNU_OCR_PREVIEW_INTEGRATION_DATABASE_URL;

function assertPreviewOnly(rawUrl: string) {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.RIVNU_PREVIEW_GUARD, 'RIVNU_DGII_PREVIEW_ONLY');
  assert.equal(process.env.RIVNU_OCR_PREVIEW_INTEGRATION_CONFIRM, 'rollback-only-preview');
  const url = new URL(rawUrl);
  assert.equal(url.protocol, 'postgresql:');
  assert.equal(decodeURIComponent(url.username), 'rivnu_preview');
  assert.equal(url.pathname, '/rivnu_dgii_preview');
  assert.ok(
    ['rivnu-dgii-preview-db', '127.0.0.1', 'localhost'].includes(url.hostname) ||
      /^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(url.hostname),
    'Only the preview container, its private Docker bridge, or a loopback tunnel is allowed.',
  );
  assert.equal(url.searchParams.get('schema') ?? 'public', 'public');
}

function useOuterTransaction(tx: Prisma.TransactionClient): PrismaService {
  let scoped: PrismaService;
  scoped = new Proxy(tx, {
    get(target, property) {
      if (property === '$transaction') {
        return async (operation: (client: PrismaService) => Promise<unknown>) => {
          assert.equal(
            typeof operation,
            'function',
            'A service must use the shared interactive transaction.',
          );
          return operation(scoped);
        };
      }
      if (['$connect', '$disconnect', '$extends'].includes(String(property))) {
        return () => {
          throw new Error('Cannot escape the rollback-only transaction.');
        };
      }
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as PrismaService;
  return scoped;
}

async function snapshot(db: PrismaService) {
  const [
    tenants,
    users,
    suppliers,
    products,
    invoices,
    items,
    movements,
    receipts,
    payments,
    audits,
  ] = await Promise.all([
    db.tenant.count(),
    db.user.count(),
    db.supplier.count(),
    db.product.findMany({
      select: { id: true, stock: true, reservedStock: true, cost: true, taxRate: true, unit: true },
      orderBy: { id: 'asc' },
    }),
    db.supplierInvoice.count(),
    db.supplierInvoiceItem.count(),
    db.inventoryMovement.count(),
    db.goodsReceipt.count(),
    db.supplierPayment.count(),
    db.auditLog.count(),
  ]);
  return {
    tenants,
    users,
    suppliers,
    products,
    invoices,
    items,
    movements,
    receipts,
    payments,
    audits,
  };
}

// Printed monetary evidence only. DOC and CIENTO quantities are explicitly
// converted to catalog UNIT in the fixture, preserving their line amounts.
const amounts: Array<{ quantity: number; total: number; tax: number; unit: ProductUnit }> = [
  { quantity: 7, total: 315, tax: 48.05, unit: ProductUnit.UNIT },
  { quantity: 0.5, total: 2488.5, tax: 379.6, unit: ProductUnit.QUINTAL },
  { quantity: 10, total: 900, tax: 137.29, unit: ProductUnit.UNIT },
  { quantity: 4, total: 320, tax: 48.81, unit: ProductUnit.POUND },
  { quantity: 7, total: 476, tax: 72.61, unit: ProductUnit.UNIT },
  { quantity: 12, total: 648, tax: 98.85, unit: ProductUnit.UNIT },
  { quantity: 12, total: 648, tax: 98.85, unit: ProductUnit.UNIT },
  { quantity: 100, total: 550, tax: 0, unit: ProductUnit.UNIT },
  { quantity: 6, total: 960, tax: 146.44, unit: ProductUnit.UNIT },
];

test(
  'real preview PostgreSQL persists and edits nine precise OCR lines, then rolls everything back',
  { skip: !databaseUrl, timeout: 60000 },
  async () => {
    assert.ok(databaseUrl);
    assertPreviewOnly(databaseUrl);
    assert.equal(
      ProductUnit.QUINTAL,
      'QUINTAL',
      'Generate and synchronize the Prisma client before running this integration test.',
    );
    const db = new PrismaService({ datasourceUrl: databaseUrl });
    const rollback = new Error('OCR_PREVIEW_VERIFIED_FORCE_ROLLBACK');
    let rollbackObserved = false;
    let checksCompleted = false;
    try {
      const identity = await db.$queryRaw<Array<{ database: string; user: string }>>`
      SELECT current_database() AS database, current_user AS "user"
    `;
      assert.deepEqual(identity, [{ database: 'rivnu_dgii_preview', user: 'rivnu_preview' }]);
      const before = await snapshot(db);
      const runId = randomUUID();
      let operationError: unknown;
      try {
        await db.$transaction(
          async (tx) => {
            const scoped = useOuterTransaction(tx);
            const service = new SupplierInvoicesService(scoped, new ReceiptsService(scoped));
            const tenant = await tx.tenant.create({
              data: { name: 'Rollback OCR integration', slug: `ocr-rollback-${runId}` },
            });
            const user = await tx.user.create({
              data: { name: 'Rollback OCR integration', email: `ocr-${runId}@test.invalid` },
            });
            const supplier = await tx.supplier.create({
              data: {
                tenantId: tenant.id,
                createdById: user.id,
                commercialName: 'Temporary OCR supplier',
                documentType: 'RNC',
                documentNumber: '101010632',
              },
            });
            const products = [];
            for (const [index, amount] of amounts.entries()) {
              products.push(
                await tx.product.create({
                  data: {
                    tenantId: tenant.id,
                    name: `Temporary OCR item ${index + 1}`,
                    sku: `OCR-${index + 1}`,
                    unit: amount.unit,
                    price: 100,
                    salePrice: 100,
                    cost: 99,
                    stock: index + 3,
                  },
                }),
              );
            }
            const dto: CreateSupplierInvoiceDto = {
              supplierId: supplier.id,
              invoiceNumber: `OCR-ROLLBACK-${runId}`,
              issueDate: '2026-07-10',
              dueDate: '2026-08-09',
              ncfValidUntil: '2027-12-31',
              ocrReview: {
                pageCount: 1,
                detectedTotal: 7305.5,
                totalMismatchAccepted: false,
                warnings: [],
              },
              items: amounts.map((amount, index) => ({
                productId: products[index].id,
                quantity: amount.quantity,
                unitCostNet: new Prisma.Decimal(amount.total)
                  .minus(amount.tax)
                  .div(amount.quantity)
                  .toDecimalPlaces(6)
                  .toNumber(),
                taxRate: amount.tax ? 0.18 : 0,
                discountTotal: 0,
              })),
            };
            const created = await service.create(tenant.id, user.id, dto);
            assert.ok(created);
            assert.equal(created.status, 'DRAFT');
            assert.equal(created.items.length, 9);
            assert.equal(created.subtotal.toFixed(2), '6275.00');
            assert.equal(created.taxTotal.toFixed(2), '1030.50');
            assert.equal(created.total.toFixed(2), '7305.50');
            assert.equal(created.paidAmount.toFixed(2), '0.00');
            assert.equal(created.balance.toFixed(2), '7305.50');
            const byProduct = new Map(created.items.map((item) => [item.productId, item]));
            for (const [index, expected] of amounts.entries()) {
              const persisted = byProduct.get(products[index].id)!;
              assert.equal(persisted.quantity.toNumber(), expected.quantity);
              assert.equal(persisted.total.toNumber(), expected.total);
              assert.equal(persisted.taxTotal.toNumber(), expected.tax);
              assert.equal(persisted.unitSnapshot, expected.unit);
            }
            const updated = await service.update(tenant.id, user.id, created.id, {
              items: dto.items,
              notes: 'Reviewed nine lines',
            });
            assert.ok(updated);
            assert.equal(updated.items.length, 9);
            assert.equal(updated.total.toFixed(2), '7305.50');
            assert.equal(await tx.supplierInvoiceItem.count({ where: { tenantId: tenant.id } }), 9);

            // A line discount must survive a subsequent metadata/order-link update,
            // which reconstructs the quoted cost from persisted effective cost.
            const discountedItems = dto.items.map((item, index) => ({
              ...item,
              discountTotal: index === 1 ? 10 : 0,
            }));
            const discounted = await service.update(tenant.id, user.id, created.id, {
              items: discountedItems,
            });
            assert.ok(discounted);
            const reloaded = await service.update(tenant.id, user.id, created.id, {
              purchaseOrderId: null,
            });
            assert.ok(reloaded);
            assert.equal(reloaded.discountTotal.toFixed(2), '10.00');
            assert.equal(reloaded.total.toFixed(2), discounted.total.toFixed(2));
            assert.equal(reloaded.total.toFixed(2), '7293.70');

            const currentProducts = await tx.product.findMany({
              where: { tenantId: tenant.id },
              orderBy: { sku: 'asc' },
            });
            for (const product of currentProducts) {
              const original = products.find((candidate) => candidate.id === product.id)!;
              assert.equal(product.stock, original.stock);
              assert.equal(product.cost?.toFixed(2), original.cost?.toFixed(2));
            }
            assert.equal(await tx.inventoryMovement.count({ where: { tenantId: tenant.id } }), 0);
            assert.equal(await tx.goodsReceipt.count({ where: { tenantId: tenant.id } }), 0);
            assert.equal(await tx.supplierPayment.count({ where: { tenantId: tenant.id } }), 0);
            assert.equal(await tx.auditLog.count({ where: { tenantId: tenant.id } }), 4);
            checksCompleted = true;
            throw rollback;
          },
          {
            timeout: 45000,
            maxWait: 5000,
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      } catch (error) {
        if (error === rollback) rollbackObserved = true;
        else operationError = error;
      }
      assert.deepEqual(
        await snapshot(db),
        before,
        'All original records, counts, costs and stock must be unchanged after rollback.',
      );
      if (operationError) throw operationError;
      assert.ok(
        checksCompleted && rollbackObserved,
        'The transaction must verify all checks and explicitly roll back.',
      );
      assert.equal(await db.tenant.count({ where: { slug: `ocr-rollback-${runId}` } }), 0);
    } finally {
      await db.$disconnect();
    }
  },
);
