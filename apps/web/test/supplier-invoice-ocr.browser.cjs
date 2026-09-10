/** Opt-in real-image regression. No application/database access or image upload. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.RIVNU_PLAYWRIGHT_MODULE || 'playwright');
const repo = path.resolve(__dirname, '../../..');
const { build } = require(
  require.resolve('esbuild', {
    paths: [repo, fs.realpathSync(path.join(repo, 'packages/database/node_modules/tsx'))],
  }),
);

async function main() {
  const fixturePath = path.resolve(process.argv[2] || path.join(repo, 'docs/factura test.jpeg'));
  const photo = fs.readFileSync(fixturePath);
  const bundle = await build({
    stdin: {
      contents: `import {recognizeSupplierInvoicePages} from './apps/web/lib/supplier-invoice-ocr-recognize';
        window.readInvoice = async () => recognizeSupplierInvoicePages([{image: await (await fetch('/fixture')).blob()}]);`,
      resolveDir: repo,
      loader: 'ts',
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    write: false,
    plugins: [
      {
        name: 'browser-node-fallbacks',
        setup(b) {
          b.onResolve({ filter: /^(fs|path|crypto)$/ }, (a) => ({
            path: a.path,
            namespace: 'stub',
          }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default {}' }));
        },
      },
    ],
  });
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405);
      return response.end();
    }
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      return response.end('<!doctype html><script type="module" src="/ocr.js"></script>');
    }
    if (request.url === '/ocr.js') {
      response.setHeader('Content-Type', 'text/javascript');
      return response.end(bundle.outputFiles[0].contents);
    }
    if (request.url === '/fixture') {
      response.setHeader('Content-Type', 'image/jpeg');
      return response.end(photo);
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const uploads = [];
    await page.route('**/*', (route) => {
      if (!['GET', 'HEAD'].includes(route.request().method())) {
        uploads.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => typeof window.readInvoice === 'function');
    const result = await page.evaluate(() => window.readInvoice());
    for (const [field, value] of Object.entries({
      supplierDocument: '130221792',
      invoiceNumber: 'A00000301018',
      ncf: 'E310000031570',
      issueDate: '2026-07-10',
      paymentDueDate: '2026-08-09',
      ncfValidUntil: '2027-12-31',
      paymentCondition: 'VENTA A CREDITO 30 DIAS',
      subtotal: 6275,
      taxTotal: 1030.5,
      total: 7305.5,
      expectedItemCount: 9,
      pageCount: 1,
    }))
      assert.equal(result[field], value, field);
    const expected = [
      ['00000302', 'BOQUILLA LAVADEROS PVC 2 1/2', 7, 315, 48.05],
      ['00000931', 'CLAVO ACERO COREANO 1 1/2', 0.5, 2488.5, 379.6],
      ['00001238', 'COLIMA ESCUADRA 10 L10020', 10, 900, 137.29],
      ['00002119', 'PUNTILLAS P/ZAPATEROS 1/2', 4, 320, 48.81],
      ['00006226', 'CEDAZO P/BOQUILLA FREGADERO ACERO', 7, 476, 72.61],
      ['00008843', 'PALOMETA P/LAVAMANO DOBLE METAL', 12, 648, 98.85],
      ['00010800', 'COLIMA CEPILLO PLANCHITA', 1, 648, 98.85],
      ['00014708', 'TIZA MECANICA 100/1', 1, 550, 0],
      ['00014792', 'COLIMA PORTA ELECTRODOS 600A CL24159', 6, 960, 146.44],
    ];
    assert.equal(result.items.length, expected.length);
    assert.deepEqual(
      result.items.map((item) => [
        item.code,
        item.description,
        item.quantity,
        item.total,
        item.taxTotal,
      ]),
      expected,
    );
    for (const item of result.items) {
      assert.equal(
        Math.round(item.quantity * item.unitCostNet * 100),
        Math.round((item.total - item.taxTotal) * 100),
      );
      assert.equal(item.taxRate, item.taxTotal === 0 ? 0 : 0.18);
    }
    assert.deepEqual(uploads, [], 'the invoice image must never be uploaded');
    console.log(
      'PASS: real photo, 9 exact products/codes/quantities/taxes/totals, metadata and dates; no uploads.',
    );
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
