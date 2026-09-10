const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Pure invoice helpers have only type imports; compile them without a browser/build.
const filename = path.resolve(__dirname, '../lib/supplier-invoice-product-matching.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const loaded = new Module(filename, module);
loaded._compile(compiled.outputText, filename);
const {
  findProductForOcrItem,
  catalogCodeMatchScore,
  hasConflictingProductSpecifications,
  invoiceUnitToProductUnit,
  createOcrInvoiceItem,
  mergeOcrInvoiceItems,
  selectInvoiceProduct,
  needsInvoiceUnitReview,
  convertInvoiceUnit,
  formatInvoiceCalendarDate,
} = loaded.exports;

const product = (id, name, extra = {}) => ({
  id,
  name,
  sku: `SKU-${id}`,
  barcode: null,
  description: null,
  brand: null,
  unit: 'UNIT',
  status: 'ACTIVE',
  cost: '999.99',
  taxRate: '0.16',
  ...extra,
});
const line = (extra = {}) => ({
  rawText: '0.50 0000931 QUINTALES CLAVO ACERO COREANO 1 1/2 4977.00 379.60 2488.50',
  code: '0000931',
  description: 'CLAVO ACERO COREANO 1 1/2',
  unit: 'QUINTALES',
  quantity: 0.5,
  unitCostNet: 4217.79661,
  taxRate: 0.18,
  confidence: {},
  warnings: [],
  ...extra,
});
const link = (productId, supplierSku, extra = {}) => ({
  productId,
  supplierSku,
  active: true,
  isPrimary: false,
  ...extra,
});

test('supplier-scoped exact code wins over another catalog code', () => {
  const a = product('a', 'CLAVO ACERO COREANO 1 1/2');
  const b = product('b', 'CLAVO ACERO COREANO 1 1/2', { sku: '0000931' });
  const result = findProductForOcrItem(line(), [a, b], [link('a', '0000931')]);
  assert.equal(result.product.id, 'a');
  assert.equal(result.highConfidence, true);
  assert.equal(result.source, 'SUPPLIER_SKU');
});

test('primary supplier flag cannot disambiguate duplicate exact codes', () => {
  const result = findProductForOcrItem(
    line(),
    [product('a', 'CLAVO ACERO COREANO 1 1/2'), product('b', 'CLAVO ACERO COREANO 1 1/2')],
    [link('a', '0000931', { isPrimary: true }), link('b', '0000931')],
  );
  assert.equal(result.product, undefined);
  assert.equal(result.alternatives.length, 2);
});

test('exact linked description is a suggestion, never a falsely labelled code match', () => {
  const result = findProductForOcrItem(
    line({ code: undefined }),
    [product('a', 'CLAVO ACERO COREANO 1 1/2')],
    [link('a', 'other')],
  );
  assert.equal(result.product.id, 'a');
  assert.equal(result.highConfidence, false);
});

test('fuzzy words tolerate one OCR typo while preserving mixed fractional size', () => {
  const result = findProductForOcrItem(
    line({ code: undefined, description: 'CLAVO ACERO COREAN0 1 1/2' }),
    [product('a', 'Clavos acero coreano 1 1/2'), product('b', 'Clavos acero coreano 1/2')],
  );
  assert.equal(result.product.id, 'a');
  assert.equal(result.highConfidence, false);
});

test('different fractions, models and amperages are not interchangeable', () => {
  for (const [a, b] of [
    ['TUBO PVC 1/2', 'TUBO PVC 3/4'],
    ['BREAKER 20A 1 POLO', 'BREAKER 30A 1 POLO'],
    ['COLIMA 10 L10020', 'COLIMA 12 L10020'],
  ]) {
    assert.equal(hasConflictingProductSpecifications(a, b), true);
    assert.equal(
      findProductForOcrItem(line({ code: undefined, description: a }), [product('a', b)]).product,
      undefined,
    );
  }
});

test('fraction glyph and separated fraction normalize consistently', () => {
  assert.equal(hasConflictingProductSpecifications('TUBO PVC ½', 'TUBO PVC 1 / 2'), false);
});

test('contradictory description downgrades even exact supplier code', () => {
  const result = findProductForOcrItem(
    line(),
    [product('a', 'CLAVO ACERO COREANO 3/4')],
    [link('a', '0000931')],
  );
  assert.equal(result.product.id, 'a');
  assert.equal(result.highConfidence, false);
  assert.match(result.warning, /difiere/);
});

test('code suffixes and fragments never become exact automatic matches', () => {
  assert.equal(catalogCodeMatchScore('0000931 extra', '0000931'), 94);
  assert.notEqual(catalogCodeMatchScore('ABC000093199', 'ABC0000931'), 100);
  assert.equal(catalogCodeMatchScore('Ab-123', 'AB123'), 100);
  assert.equal(catalogCodeMatchScore('31', '0000931'), 0);
});

test('an exact code with disjoint product identity or doubtful OCR still needs review', () => {
  const unrelated = findProductForOcrItem(
    line(),
    [product('a', 'BOQUILLA LAVADERO PVC')],
    [link('a', '0000931')],
  );
  assert.equal(unrelated.highConfidence, false);
  const doubtful = findProductForOcrItem(
    line({ confidence: { code: 'low' } }),
    [product('a', 'CLAVO ACERO COREANO 1 1/2')],
    [link('a', '0000931')],
  );
  assert.equal(doubtful.highConfidence, false);
});

test('inactive products are not auto-applied and unknown products remain editable', () => {
  const result = findProductForOcrItem(line(), [
    product('a', 'CLAVO ACERO COREANO 1 1/2', { status: 'INACTIVE', sku: '0000931' }),
  ]);
  assert.equal(result.product, undefined);
  const draft = createOcrInvoiceItem(line(), 'draft', 'batch:0');
  assert.equal(draft.productId, '');
  assert.equal(draft.quantity, '0.5');
  assert.equal(draft.unitCostNet, '4217.79661');
});

test('missing numbers are left blank instead of inventing a quantity or tax exemption', () => {
  const draft = createOcrInvoiceItem(
    line({ quantity: undefined, unitCostNet: undefined, taxRate: undefined }),
    'draft',
    'batch:0',
  );
  assert.equal(draft.quantity, '');
  assert.equal(draft.unitCostNet, '');
  assert.equal(draft.taxPercent, '');
});

test('catalog selection retains the invoice cost, tax and manual changes', () => {
  const draft = {
    ...createOcrInvoiceItem(line(), 'draft', 'batch:0'),
    quantity: '0.75',
    discountTotal: '5',
  };
  const selected = selectInvoiceProduct(draft, product('a', 'CLAVO ACERO COREANO 1 1/2'));
  assert.equal(selected.unitCostNet, '4217.79661');
  assert.equal(selected.taxPercent, '18');
  assert.equal(selected.quantity, '0.75');
  assert.equal(selected.discountTotal, '5');
  assert.equal(selected.ocrItem, draft.ocrItem);
});

test('unread OCR cost is not silently filled from catalog cost when selecting or creating', () => {
  const selected = selectInvoiceProduct(
    createOcrInvoiceItem(line({ unitCostNet: undefined, taxRate: undefined }), 'draft', 'batch:0'),
    product('new', 'Nuevo'),
  );
  assert.equal(selected.unitCostNet, '');
  assert.equal(selected.taxPercent, '');
});

test('applying OCR preserves manual/PO lines and is idempotent by occurrence', () => {
  const manual = {
    key: 'manual',
    productId: 'manual',
    purchaseOrderItemId: 'po:1',
    quantity: '8',
    unitCostNet: '15',
    taxPercent: '18',
    discountTotal: '0',
  };
  const suggested = [
    createOcrInvoiceItem(line(), 'a', 'batch:0'),
    createOcrInvoiceItem(line(), 'b', 'batch:1'),
  ];
  const merged = mergeOcrInvoiceItems([manual], suggested);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged[0], manual);
  merged[1].quantity = '0.75';
  const repeated = mergeOcrInvoiceItems(merged, suggested);
  assert.equal(repeated, merged);
  assert.equal(repeated[1].quantity, '0.75');
});

test('only untouched blank placeholder is replaced when preparing OCR', () => {
  const blank = {
    key: 'blank',
    productId: '',
    quantity: '1',
    unitCostNet: '',
    taxPercent: '18',
    discountTotal: '0',
  };
  assert.equal(
    mergeOcrInvoiceItems([blank], [createOcrInvoiceItem(line(), 'a', 'batch:0')]).length,
    1,
  );
  assert.equal(
    mergeOcrInvoiceItems(
      [{ ...blank, quantity: '2' }],
      [createOcrInvoiceItem(line(), 'a', 'batch:0')],
    ).length,
    2,
  );
});

test('invoice units are explicit; quintal is supported, docena/ciento need a chosen presentation', () => {
  assert.equal(invoiceUnitToProductUnit('QUINTALES'), 'QUINTAL');
  assert.equal(invoiceUnitToProductUnit('LIBRAS'), 'POUND');
  assert.equal(invoiceUnitToProductUnit('UNIDAD'), 'UNIT');
  assert.equal(invoiceUnitToProductUnit('DOC'), undefined);
  assert.equal(invoiceUnitToProductUnit('CIENTO'), undefined);
  const draft = createOcrInvoiceItem(line(), 'a', 'batch:0');
  assert.equal(needsInvoiceUnitReview(draft, product('a', 'CLAVO', { unit: 'POUND' })), true);
  assert.equal(needsInvoiceUnitReview(draft, product('a', 'CLAVO', { unit: 'QUINTAL' })), false);
});

test('explicit conversion preserves invoice total with six-decimal unit cost', () => {
  const draft = createOcrInvoiceItem(line(), 'a', 'batch:0');
  const converted = convertInvoiceUnit(draft, 100);
  assert.equal(converted.quantity, '50');
  assert.equal(converted.unitCostNet, '42.177966');
  assert.ok(
    Math.abs(Number(converted.quantity) * Number(converted.unitCostNet) - 0.5 * 4217.79661) < 0.001,
  );
  assert.equal(converted.unitConversionConfirmed, true);
  assert.equal(needsInvoiceUnitReview(converted, product('a', 'CLAVO', { unit: 'POUND' })), false);
});

test('conversion rejects invalid factor or unread values', () => {
  const draft = createOcrInvoiceItem(line(), 'a', 'batch:0');
  for (const factor of [0, -1, NaN, Infinity])
    assert.throws(() => convertInvoiceUnit(draft, factor));
  assert.throws(() => convertInvoiceUnit({ ...draft, quantity: '' }, 12));
});

test('changing selected product invalidates a previously confirmed presentation', () => {
  const draft = {
    ...createOcrInvoiceItem(line(), 'a', 'batch:0', product('a', 'CLAVO')),
    unitConversionConfirmed: true,
  };
  assert.equal(selectInvoiceProduct(draft, product('b', 'Otro')).unitConversionConfirmed, false);
});

test('calendar dates retain invoice day in Dominican timezone', () => {
  const date = formatInvoiceCalendarDate('2026-07-10');
  assert.match(date, /10/);
  assert.match(date, /2026/);
  assert.doesNotMatch(date, /09/);
});
