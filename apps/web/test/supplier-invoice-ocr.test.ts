import assert from 'node:assert/strict';
import test from 'node:test';
import { extractSupplierInvoiceOcr } from '../lib/supplier-invoice-ocr';
import {
  caribeFooter,
  caribeHeader,
  caribeInvoice,
  caribeRows,
} from './fixtures/caribe-rb-invoice';

const rounded = (value: number) => Math.round(value * 100) / 100;

test('Caribe original nine merchandise rows reconcile exactly, including inclusive ITBIS and exempt chalk', () => {
  const result = extractSupplierInvoiceOcr(caribeInvoice);
  assert.equal(result.items.length, 9);
  assert.equal(result.expectedItemCount, 9);
  assert.equal(result.supplierDocument, '130221792');
  assert.equal(result.invoiceNumber, 'A00000301018');
  assert.equal(result.ncf, 'E310000031570');
  assert.equal(result.issueDate, '2026-07-10');
  assert.equal(result.paymentDueDate, '2026-08-09');
  assert.equal(result.ncfValidUntil, '2027-12-31');
  assert.equal(result.paymentCondition, 'VENTA A CREDITO 30 DIAS');
  assert.equal(result.currency, 'DOP');
  assert.equal(result.subtotal, 6275);
  assert.equal(result.taxTotal, 1030.5);
  assert.equal(result.total, 7305.5);
  assert.deepEqual(
    result.items.map((item) => item.quantity),
    [7, 0.5, 10, 4, 7, 12, 1, 1, 6],
  );
  assert.deepEqual(
    result.items.map((item) => item.code),
    [
      '00000302',
      '00000931',
      '00001238',
      '00002119',
      '00006226',
      '00008843',
      '00010800',
      '00014708',
      '00014792',
    ],
  );
  assert.equal(result.items[1].unit, 'QUINTALES');
  assert.equal(result.items[6].unit, 'DOC');
  assert.equal(result.items[0].description, 'BOQUILLA LAVADEROS PVC 2 1/2');
  assert.equal(result.items[1].description, 'CLAVO ACERO COREANO 1 1/2');
  assert.equal(result.items[2].description, 'COLIMA ESCUADRA 10 L10020');
  assert.equal(result.items[7].description, 'TIZA MECANICA 100/1');
  assert.equal(result.items[8].description, 'COLIMA PORTA ELECTRODOS 600A CL24159');
  assert.deepEqual(
    result.items.map((item) => item.taxRate),
    [0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0.18, 0, 0.18],
  );
  assert.equal(rounded(result.items.reduce((sum, item) => sum + item.subtotal!, 0)), 6275);
  assert.equal(rounded(result.items.reduce((sum, item) => sum + item.taxTotal!, 0)), 1030.5);
  assert.equal(rounded(result.items.reduce((sum, item) => sum + item.total!, 0)), 7305.5);
  for (const item of result.items) {
    assert.equal(rounded(item.unitCostNet! * item.quantity!), item.subtotal);
    assert.equal(item.confidence.total, 'high');
    assert.deepEqual(item.warnings, []);
  }
  assert.deepEqual(result.warnings, []);
});

test('footer quantity 48.50 and sub-total never replace invoice total', () => {
  const result = extractSupplierInvoiceOcr(
    'Sub-Total DOP: 6,275.00\n+ ITBIS DOP: 1,030.50\nTOTAL DOP: 7,305.50\nCant. Total: 48.50 IMPRESO: 11-07-2026 09:29:16',
  );
  assert.equal(result.total, 7305.5);
  assert.equal(result.subtotal, 6275);
  assert.equal(result.taxTotal, 1030.5);
  assert.equal(
    extractSupplierInvoiceOcr('Sub-Total DOP: 6,275.00\nCant. Total: 48.50').total,
    undefined,
  );
});

test('supports footer values read on separate lines without borrowing product prices', () => {
  const result = extractSupplierInvoiceOcr(
    'Sub-Total DOP:\n+ ITBIS DOP:\nTOTAL DOP:\n6,275.00\n1,030.50\n7,305.50',
  );
  assert.equal(result.subtotal, 6275);
  assert.equal(result.taxTotal, 1030.5);
  assert.equal(result.total, 7305.5);
  assert.equal(
    extractSupplierInvoiceOcr(
      'DESCRIPCION PRECIO ITBIS TOTAL\n7.00 0032 UNIDAD PVC 45.00 48.05 315.00',
    ).total,
    undefined,
  );
});

test('uses spatial rows as one reading, without merging duplicate OCR passes', () => {
  const result = extractSupplierInvoiceOcr(`${caribeHeader}\n${caribeRows[1]}\n${caribeFooter}`, {
    layoutLines: caribeInvoice.split('\n').map((line) => line.replace(/ /g, '\t')),
  });
  assert.equal(result.items.length, 9);
  assert.equal(result.total, 7305.5);
});

test('reconstructs wrapped product description and missing numeric line', () => {
  const result = extractSupplierInvoiceOcr(
    `${caribeHeader}\n7.00 0000032 UNIDAD BOQUILLA LAVADEROS\nPVC 2 1/2\n45.00 48.05 315.00\nSub-Total DOP: 266.95\nITBIS DOP: 48.05\nTOTAL DOP: 315.00`,
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].description, 'BOQUILLA LAVADEROS PVC 2 1/2');
  assert.equal(result.items[0].total, 315);
});

test('missing/malformed amounts leave visible reviewable product rather than fabricated money', () => {
  const result = extractSupplierInvoiceOcr(
    `${caribeHeader}\n7.00 0000032 UNIDAD BOQUILLA LAVADEROS PVC 2 1/2\n0.50 0000931 QUINTALES CLAVO ACERO COREANO 1 1/2 4,977.00 999.60 2,488.50\n${caribeFooter}`,
  );
  assert.equal(result.items.length, 2);
  for (const item of result.items) {
    assert.equal(item.unitCostNet, undefined);
    assert.ok(item.warnings.length > 0);
  }
  assert.ok(result.warnings.some((warning) => warning.includes('se leyeron 2')));
});

test('preserves genuinely repeated rows across pages, not silently losing their quantities', () => {
  const result = extractSupplierInvoiceOcr(
    `${caribeHeader}\n${caribeRows[0]}\n--- PAGINA 2 ---\nCANT CODIGO UNIDAD DESCRIPCION PRECIO ITBIS VALOR\n${caribeRows[0]}\nSub-Total DOP: 533.90\nITBIS DOP: 96.10\nTOTAL DOP: 630.00`,
  );
  assert.equal(result.items.length, 2);
  assert.equal(
    result.items.reduce((sum, item) => sum + item.quantity!, 0),
    14,
  );
});

test('identifies tax-exclusive columns through arithmetic and does not add tax twice', () => {
  const result = extractSupplierInvoiceOcr(
    `${caribeHeader}\n2.00 0000999 UNIDAD PRODUCTO 1/2 100.00 36.00 200.00\nSub-Total DOP: 200.00\nITBIS DOP: 36.00\nTOTAL DOP: 236.00`,
  );
  assert.equal(result.items[0].unitCostNet, 100);
  assert.equal(result.items[0].taxRate, 0.18);
  assert.equal(result.items[0].total, 236);
});

test('credit fiscal title never becomes payment terms or payment due date', () => {
  const result = extractSupplierInvoiceOcr(
    'FACTURA DE CREDITO FISCAL ELECTRONICA\nFecha Emision: 10-07-2026\nVALIDO HASTA: 31-12-2027',
  );
  assert.equal(result.paymentCondition, undefined);
  assert.equal(result.paymentDueDate, undefined);
  assert.equal(result.ncfValidUntil, '2027-12-31');
});

test('damaged identifiers and truncated years are not marked as verified readings', () => {
  const result = extractSupplierInvoiceOcr('e-NCF: E310000031 o\nFecha Emision: 10-07-20,');
  assert.equal(result.ncf, undefined);
  assert.equal(result.issueDate, undefined);
  assert.equal(result.confidence.ncf, undefined);
  assert.equal(result.confidence.issueDate, undefined);
});

test('damaged trailing rows do not absorb footer text or silently accept zero-priced goods', () => {
  const result = extractSupplierInvoiceOcr(
    `${caribeHeader}\n7.00\t00006226\tUNIDAD\tCEDAZO P/BOQUILLA FREGADERO ACERO\t68.00\t476.00\n1.00\t00014708\tCIENTO\tTIZA MECANICA 100/1\t00\t0.00\t0.00\n6.00\t00014792\tUNIDAD\tCOLIMA PORTA ELECT!\t0.00\n*... UL:\tNL\nltems: 9\t-d\nve`,
  );
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].description, 'CEDAZO P/BOQUILLA FREGADERO ACERO');
  assert.equal(result.items[1].unitCostNet, undefined);
  assert.equal(result.items[1].confidence.total, 'low');
  assert.equal(result.items[2].description, 'COLIMA PORTA ELECT!');
  assert.equal(result.expectedItemCount, 9);
});

test('retains supported supplier column layouts and item model digits', () => {
  const fixtures = [
    ['CANO INDUSTRIAL', '1 UND 3 GL PINTURA MODELO 1000 100.00 300.00 54.00', 3, 100, 354],
    ['BELLON', '12345 UNIDAD 2 TORNILLO 2 1/2 118.00 236.00 36.00', 2, 100, 236],
    ['PROMACO', '2 TUBO PVC 1/2 118.00 36.00 236.00', 2, 100, 236],
    ['YANWILS', '2 TUBO PVC 1/2 100.00 200.00 36.00 236.00', 2, 100, 236],
    ['WURTH', '058411 220 2 TORNILLO MODELO 1000 100.00 36.00 236.00', 2, 100, 236],
  ] as const;
  for (const [supplier, row, quantity, cost, total] of fixtures) {
    const result = extractSupplierInvoiceOcr(
      `${supplier}\nCANTIDAD DESCRIPCION PRECIO\n${row}\nTOTAL DOP: ${total.toFixed(2)}`,
    );
    assert.equal(result.items.length, 1, supplier);
    assert.equal(result.items[0].quantity, quantity, supplier);
    assert.equal(result.items[0].unitCostNet, cost, supplier);
    assert.equal(result.items[0].total, total, supplier);
    if (supplier === 'CANO INDUSTRIAL' || supplier === 'WURTH')
      assert.ok(result.items[0].description?.endsWith('1000'));
  }
});

test('generic two-money rows preserve products but require explicit manual tax confirmation', () => {
  const result = extractSupplierInvoiceOcr(
    'SUPLIDOR INDEPENDIENTE\nCANTIDAD DESCRIPCION PRECIO TOTAL\n2 TUBO PVC 1/2 100.00 200.00\nTOTAL DOP: 200.00',
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].quantity, 2);
  assert.equal(result.items[0].description, 'TUBO PVC 1/2');
  assert.equal(result.items[0].taxRate, undefined);
  assert.ok(result.items[0].warnings.some((warning) => warning.includes('ITBIS')));
});

test('decimal dimensions in descriptions do not become financial columns', () => {
  const result = extractSupplierInvoiceOcr(
    'CANO INDUSTRIAL\nCANTIDAD DESCRIPCION PRECIO\n1 UND 3 GL PINTURA MEDIDA 2.50 100.00 300.00 54.00\nTOTAL DOP: 354.00',
  );
  assert.equal(result.items[0].description, 'PINTURA MEDIDA 2.50');
  assert.equal(result.items[0].unitCostNet, 100);
  assert.equal(result.items[0].subtotal, 300);
  assert.equal(result.items[0].taxRate, 0.18);
});

test('row separators between code and unit preserve products and code precision', () => {
  for (const separator of ['—', '–', '|']) {
    const row = caribeRows[0].replace('00000302 UNIDAD', `00000302 ${separator} UNIDAD`);
    const result = extractSupplierInvoiceOcr(`${caribeHeader}\n${row}\nTOTAL DOP: 315.00`);
    assert.equal(result.items.length, 1, separator);
    assert.equal(result.items[0].code, '00000302', separator);
    assert.equal(result.items[0].description, 'BOQUILLA LAVADEROS PVC 2 1/2', separator);
    assert.equal(result.items[0].quantity, 7, separator);
    assert.equal(result.items[0].total, 315, separator);
  }
});

test('legible quantity/unit/description remains usable even when product code was unreadable', () => {
  const row = caribeRows[0].replace('00000302 ', '');
  const result = extractSupplierInvoiceOcr(`${caribeHeader}\n${row}\nTOTAL DOP: 315.00`);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].code, undefined);
  assert.equal(result.items[0].confidence.code, undefined);
  assert.equal(result.items[0].description, 'BOQUILLA LAVADEROS PVC 2 1/2');
  assert.equal(result.items[0].quantity, 7);
});

test('stamp text to the left of footer labels does not hide amounts in spatial output', () => {
  const result = extractSupplierInvoiceOcr(
    'WE,\tBE:\tSub-Total DOP:\t6,275.00\nFIRMA\t+ ITBIS DOP:\t1,030.50\nDES ALE\t4\t| 0\tTOTAL DOP:\t7,305.50\nCant. Total:\t48.50 IMPRESO:',
  );
  assert.equal(result.subtotal, 6275);
  assert.equal(result.taxTotal, 1030.5);
  assert.equal(result.total, 7305.5);
});

test('OCR FACTURAS label finds invoice number without confusing fiscal credit title', () => {
  const result = extractSupplierInvoiceOcr(
    'FACTURA DE CREDITO FISCAL ELECTRONICA\nFACTURAS: A00000301018\ne-NCF: E310000031570',
  );
  assert.equal(result.invoiceNumber, 'A00000301018');
  assert.equal(result.ncf, 'E310000031570');
});

test('generic FECHA requires a directly adjacent date and excludes digital signature timestamps', () => {
  const result = extractSupplierInvoiceOcr(
    'FECHA: 10-07-2026\nFecha de Firma Digital: 11-07-2026 09:28:54',
  );
  assert.equal(result.issueDate, '2026-07-10');
  assert.equal(
    extractSupplierInvoiceOcr('Fecha de Firma Digital: 11-07-2026 09:28:54').issueDate,
    undefined,
  );
  assert.equal(extractSupplierInvoiceOcr('Fecha Realizado: 11-07-2026').issueDate, undefined);
});
