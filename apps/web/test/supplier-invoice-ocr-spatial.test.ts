import assert from 'node:assert/strict';
import test from 'node:test';
import {
  locateSupplierInvoiceTable,
  reconstructSupplierInvoiceOcrLines,
  replaceSupplierInvoiceOcrRegion,
  type SupplierInvoiceOcrGeometryInput,
  type SupplierInvoiceOcrWord,
} from '../lib/supplier-invoice-ocr-spatial';
import {
  recognizeSupplierInvoicePages,
  scoreSupplierInvoiceOcrReading,
} from '../lib/supplier-invoice-ocr-recognize';
import { extractSupplierInvoiceOcr } from '../lib/supplier-invoice-ocr';
import { normalizeSupplierInvoiceLuminance } from '../lib/supplier-invoice-ocr-image';

function word(text: string, x: number, y: number, width = text.length * 6): SupplierInvoiceOcrWord {
  return { text, confidence: 95, bbox: { x0: x, y0: y, x1: x + width, y1: y + 12 } };
}

function geometry(words: SupplierInvoiceOcrWord[]): SupplierInvoiceOcrGeometryInput {
  return {
    text: words.map((entry) => entry.text).join('\n'),
    blocks: words.map((entry) => ({ paragraphs: [{ lines: [{ words: [entry] }] }] })),
  };
}

test('rebuilds rows when sparse OCR reads entire columns first', () => {
  const quantities = ['7.00', '0.50', '10.00', '4.00', '7.00', '12.00', '1.00', '1.00', '6.00'];
  const words = [
    ...quantities.map((quantity, index) => word(quantity, 0, index * 23)),
    ...quantities.map((_, index) => word(`0000${index + 31}`, 60, index * 23 + 1)),
    ...quantities.map((_, index) => word('UNIDAD', 125, index * 23 - 1)),
    ...quantities.map((_, index) => word(`PRODUCTO ${index + 1} 1/2`, 200, index * 23)),
    ...quantities.map((_, index) => word('45.00', 360, index * 23 + 2)),
    ...quantities.map((_, index) => word('48.05', 420, index * 23)),
    ...quantities.map((_, index) => word('315.00', 480, index * 23 + 1)),
  ];
  const lines = reconstructSupplierInvoiceOcrLines(geometry(words));
  assert.equal(lines.length, 9);
  assert.match(lines[1].text, /^0\.50\t000032\tUNIDAD\tPRODUCTO 2 1\/2\t45\.00\t48\.05\t315\.00$/);
  assert.equal(lines[8].words[0].text, '6.00');
});

test('corrects residual baseline slope without merging neighboring products', () => {
  const lines = [0, 1, 2].map((index) => ({
    baseline: { x0: 0, y0: 20 + index * 24, x1: 800, y1: 36 + index * 24 },
    words: [
      word('1.00', 0, index * 24),
      word('TORNILLO 1/2', 250, 5 + index * 24),
      word('42.00', 800, 16 + index * 24),
    ],
  }));
  const result = reconstructSupplierInvoiceOcrLines({
    text: '',
    blocks: [{ paragraphs: [{ lines }] }],
  });
  assert.equal(result.length, 3);
  for (const row of result) assert.equal(row.words.length, 3);
});

test('crop bounds follow actual column header and totals, not guessed page percentages', () => {
  const words = [
    word('COMERCIAL DEL CARIBE RB SRL', 20, 20),
    word('CANT.', 10, 300),
    word('CÓDIGO', 80, 300),
    word('UNIDAD', 160, 300),
    word('DESCRIPCIÓN', 250, 300),
    word('PRECIO', 470, 300),
    word('ITBIS', 550, 300),
    word('VALOR', 620, 300),
    word('7.00 0000032 UNIDAD BOQUILLA 2 1/2 45.00 48.05 315.00', 10, 325),
    word('0.50 0000931 QUINTALES CLAVO 1 1/2 4977.00 379.60 2488.50', 10, 350),
    word('Items: 2', 10, 385),
    word('Sub-Total DOP: 2500.00', 420, 410),
  ];
  const bounds = locateSupplierInvoiceTable(
    reconstructSupplierInvoiceOcrLines(geometry(words)),
    700,
    1400,
  );
  assert.ok(bounds.top < 300 && bounds.top > 270);
  assert.ok(bounds.top + bounds.height > 362 && bounds.top + bounds.height < 385);
  assert.equal(bounds.left, 0);
  assert.equal(bounds.width, 700);
});

test('region replacement uses page coordinates and does not double product rows', () => {
  const source = reconstructSupplierInvoiceOcrLines(
    geometry([
      word('RNC 130221792', 10, 10),
      word('OLD PRODUCT', 10, 110),
      word('TOTAL DOP 100.00', 300, 300),
    ]),
  );
  const region = reconstructSupplierInvoiceOcrLines(geometry([word('NEW PRODUCT', 10, 10)]));
  const result = replaceSupplierInvoiceOcrRegion(source, region, {
    left: 0,
    top: 100,
    width: 700,
    height: 100,
  });
  assert.deepEqual(
    result.map((line) => line.text),
    ['RNC 130221792', 'NEW PRODUCT', 'TOTAL DOP 100.00'],
  );
  assert.equal(result[1].bbox.y0, 110);
  assert.equal(result[1].words[0].bbox.y0, 110);
});

test('missing word geometry stays empty rather than inventing layout associations', () => {
  assert.deepEqual(reconstructSupplierInvoiceOcrLines({ text: 'Price 10.00', blocks: null }), []);
  assert.deepEqual(locateSupplierInvoiceTable([], 700, 1400), {
    left: 0,
    top: 0,
    width: 700,
    height: 1400,
  });
});

test('table crop excludes photographed background using the actual heading columns', () => {
  const source = reconstructSupplierInvoiceOcrLines(
    geometry([
      word('\\', 10, 300),
      word('CANT.', 400, 300),
      word('CODIGO', 480, 300),
      word('UNIDAD', 580, 300),
      word('DESCRIPCION', 700, 300),
      word('PRECIO', 1200, 300),
      word('ITBIS', 1300, 300),
      word('VALOR', 1400, 300),
      word('Items: 9', 400, 700),
    ]),
  );
  const rectangle = locateSupplierInvoiceTable(source, 1800, 2000);
  assert.equal(rectangle.left, 350);
  assert.equal(rectangle.left + rectangle.width, 1480);
});

test('narrow regional rereading preserves adjacent metadata in a two-column header', () => {
  const source = reconstructSupplierInvoiceOcrLines(
    geometry([word('Fecha Emision: 10-07-20', 20, 120), word('VENCE: 09-08-2026', 500, 120)]),
  );
  const region = reconstructSupplierInvoiceOcrLines(
    geometry([word('Fecha Emision: 10-07-2026', 10, 10)]),
  );
  const result = replaceSupplierInvoiceOcrRegion(source, region, {
    left: 10,
    top: 110,
    width: 350,
    height: 50,
  });
  assert.deepEqual(result.map((line) => line.text).sort(), [
    'Fecha Emision: 10-07-2026',
    'VENCE: 09-08-2026',
  ]);
});

test('candidate selection prefers declared line completeness and balanced amounts', () => {
  const complete = extractSupplierInvoiceOcr(`COMERCIAL DEL CARIBE RB, SRL
RNC: 130221792
CANT. CODIGO UNIDAD DESCRIPCION PRECIO ITBIS VALOR
7.00 0000032 UNIDAD BOQUILLA LAVADEROS PVC 2 1/2 45.00 48.05 315.00
0.50 0000931 QUINTALES CLAVO ACERO COREANO 1 1/2 4,977.00 379.60 2,488.50
Items: 2
Sub-Total DOP: 2,375.85
ITBIS DOP: 427.65
TOTAL DOP: 2,803.50`);
  const missing = { ...complete, items: complete.items.slice(0, 1), total: 48.5 };
  assert.ok(
    scoreSupplierInvoiceOcrReading(complete) > scoreSupplierInvoiceOcrReading(missing) + 100,
  );
});

test('aborted OCR returns before importing or starting a worker', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    recognizeSupplierInvoicePages([{ image: new Blob() }], { signal: controller.signal }),
    { name: 'AbortError' },
  );
});

test('local illumination correction preserves the same ink on bright and shadowed paper', () => {
  const width = 240;
  const height = 120;
  const luminance = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) luminance[y * width + x] = x < width / 2 ? 225 : 125;
  }
  for (let y = 50; y < 65; y += 1) {
    for (const x of [50, 51, 52, 180, 181, 182]) luminance[y * width + x] = 40;
  }
  const result = normalizeSupplierInvoiceLuminance(luminance, width, height);
  assert.equal(result[55 * width + 50], 0);
  assert.equal(result[55 * width + 180], 0);
  assert.equal(result[55 * width + 75], 255);
  assert.ok(result[55 * width + 205] >= 240);
});
