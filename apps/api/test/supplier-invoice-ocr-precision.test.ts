import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@qorvex/database';
import { SupplierInvoiceItemDto } from '../src/modules/supplier-invoices/dto/supplier-invoice.dto';
import { MobileOcrCaptureItemDto } from '../src/modules/supplier-invoices/dto/mobile-ocr-capture.dto';
import { SupplierInvoicesService } from '../src/modules/supplier-invoices/supplier-invoices.service';

// Transcribed amounts from the supplied Caribe RB invoice, not OCR output.
const printedLines = [
  { quantity: 7, total: 315, tax: 48.05 },
  { quantity: 0.5, total: 2488.5, tax: 379.6 },
  { quantity: 10, total: 900, tax: 137.29 },
  { quantity: 4, total: 320, tax: 48.81 },
  { quantity: 7, total: 476, tax: 72.61 },
  { quantity: 12, total: 648, tax: 98.85 },
  { quantity: 1, total: 648, tax: 98.85 },
  { quantity: 1, total: 550, tax: 0 },
  { quantity: 6, total: 960, tax: 146.44 },
];

function harness() {
  const service = new SupplierInvoicesService(
    {
      product: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({
            id,
            name: `Producto ${id}`,
            sku: id,
            barcode: null,
            unit: 'UNIT',
          })),
      },
    } as never,
    {} as never,
  );

  return service as unknown as {
    computeItems: (
      tenant: string,
      items: SupplierInvoiceItemDto[],
      order: null,
    ) => Promise<{
      items: Array<{
        quantity: Prisma.Decimal;
        unitCostNet: Prisma.Decimal;
        subtotal: Prisma.Decimal;
        taxTotal: Prisma.Decimal;
        total: Prisma.Decimal;
        discountTotal: Prisma.Decimal;
      }>;
      subtotal: Prisma.Decimal;
      taxTotal: Prisma.Decimal;
      total: Prisma.Decimal;
    }>;
  };
}

test('the nine tax-inclusive invoice lines reach accounting without a second ITBIS or rounding drift', async () => {
  const items = printedLines.map((line, index) => ({
    productId: String(index),
    quantity: line.quantity,
    unitCostNet: new Prisma.Decimal(line.total)
      .minus(line.tax)
      .div(line.quantity)
      .toDecimalPlaces(6)
      .toNumber(),
    taxRate: line.tax ? 0.18 : 0,
  }));
  const result = await harness().computeItems('preview-tenant', items, null);
  assert.equal(result.items.length, 9);
  assert.equal(result.subtotal.toFixed(2), '6275.00');
  assert.equal(result.taxTotal.toFixed(2), '1030.50');
  assert.equal(result.total.toFixed(2), '7305.50');
  result.items.forEach((item, index) => {
    assert.equal(item.total.toNumber(), printedLines[index].total);
    assert.equal(item.taxTotal.toNumber(), printedLines[index].tax);
  });
});

test('invoice and mobile handoff accept six-decimal net prices but reject excessive precision', async () => {
  const line = { productId: 'one', quantity: 7, unitCostNet: 38.135714, taxRate: 0.18 };
  assert.deepEqual(await validate(plainToInstance(SupplierInvoiceItemDto, line)), []);
  const { productId: _productId, ...mobileLine } = line;
  assert.deepEqual(await validate(plainToInstance(MobileOcrCaptureItemDto, mobileLine)), []);
  for (const dto of [SupplierInvoiceItemDto, MobileOcrCaptureItemDto]) {
    const invalid = plainToInstance(dto as typeof SupplierInvoiceItemDto, {
      ...(dto === SupplierInvoiceItemDto ? line : mobileLine),
      unitCostNet: 38.1357149,
    });
    assert.ok((await validate(invalid)).some((error) => error.property === 'unitCostNet'));
  }
});

test('a fractional unit and line discount survive draft reconstruction without being applied twice', async () => {
  const service = harness();
  const first = await service.computeItems(
    'preview-tenant',
    [
      {
        productId: 'one',
        quantity: 0.5,
        unitCostNet: 4217.8,
        taxRate: 0.18,
        discountTotal: 10,
      },
    ],
    null,
  );
  const saved = first.items[0];
  const reloaded = await service.computeItems(
    'preview-tenant',
    [
      {
        productId: 'one',
        quantity: saved.quantity.toNumber(),
        unitCostNet: saved.subtotal
          .add(saved.discountTotal)
          .div(saved.quantity)
          .toDecimalPlaces(6)
          .toNumber(),
        taxRate: 0.18,
        discountTotal: saved.discountTotal.toNumber(),
      },
    ],
    null,
  );
  assert.equal(reloaded.total.toFixed(2), first.total.toFixed(2));
  assert.equal(reloaded.items[0].discountTotal.toFixed(2), '10.00');
});
