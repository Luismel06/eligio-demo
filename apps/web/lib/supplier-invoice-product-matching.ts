import type { Product, ProductUnit, Supplier } from './api';
import type { SupplierInvoiceOcrItem } from './supplier-invoice-ocr';

export type OcrProductMatchSource =
  | 'SUPPLIER_SKU'
  | 'SUPPLIER_PRIMARY'
  | 'SUPPLIER_PRODUCT'
  | 'CATALOG_CODE'
  | 'CATALOG_DESCRIPTION';

export type OcrProductMatch = {
  product?: Product;
  source?: OcrProductMatchSource;
  isPrimarySupplierProduct?: boolean;
  highConfidence?: boolean;
  warning?: string;
  alternatives?: Product[];
};

type Candidate = {
  product: Product;
  source: OcrProductMatchSource;
  score: number;
  exactCode: boolean;
  primary: boolean;
  conflict: boolean;
};

/** Codes are supplier-scoped. Descriptions help a human choose, never merge stock. */
export function findProductForOcrItem(
  item: SupplierInvoiceOcrItem,
  products: Product[],
  supplierProducts: Supplier['products'] = [],
): OcrProductMatch {
  const links = new Map(
    supplierProducts.filter((link) => link.active).map((link) => [link.productId, link]),
  );
  const candidates: Candidate[] = [];
  for (const product of products) {
    if (product.status !== 'ACTIVE') continue;
    const link = links.get(product.id);
    const supplierScore = item.code ? catalogCodeMatchScore(item.code, link?.supplierSku) : 0;
    const catalogScore = item.code
      ? Math.max(
          catalogCodeMatchScore(item.code, product.sku),
          catalogCodeMatchScore(item.code, product.barcode),
        )
      : 0;
    const textScore = descriptionScore(item.description ?? '', product);
    const conflict =
      hasConflictingProductSpecifications(item.description ?? '', product.name) ||
      (words(item.description ?? '').length >= 2 &&
        words(product.name).length >= 2 &&
        textScore < 45);
    let source: OcrProductMatchSource = 'CATALOG_DESCRIPTION';
    let score = textScore;
    let exactCode = false;
    if (supplierScore === 100) {
      source = 'SUPPLIER_SKU';
      score = 1000;
      exactCode = true;
    } else if (catalogScore === 100) {
      source = 'CATALOG_CODE';
      score = 900;
      exactCode = true;
    } else if (supplierScore > 0) {
      source = 'SUPPLIER_SKU';
      score = 200 + supplierScore;
    } else {
      if (textScore < 63 || conflict) continue;
      if (link) {
        source = link.isPrimary ? 'SUPPLIER_PRIMARY' : 'SUPPLIER_PRODUCT';
        score += 5;
      }
    }
    // A precise code with contradictory size/model still needs human confirmation.
    candidates.push({
      product,
      source,
      score,
      exactCode,
      primary: Boolean(link?.isPrimary),
      conflict,
    });
  }
  candidates.sort(
    (a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'es'),
  );
  const best = candidates[0];
  if (!best) return {};
  const next = candidates[1];
  const alternatives = candidates.slice(0, 4).map((candidate) => candidate.product);
  if (next && (best.exactCode ? next.score === best.score : best.score - next.score < 5)) {
    return {
      alternatives,
      warning:
        'Hay varias coincidencias posibles. Elige la medida, marca y presentación correctas.',
    };
  }
  return {
    product: best.product,
    source: best.source,
    isPrimarySupplierProduct: best.primary,
    highConfidence: best.exactCode && !best.conflict && item.confidence.code !== 'low',
    alternatives,
    warning: best.conflict
      ? 'El código coincide, pero la descripción, medida o referencia difiere. Confirma contra la factura.'
      : best.exactCode && item.confidence.code === 'low'
        ? 'La lectura del código es dudosa. Confirma el producto contra la factura.'
        : best.exactCode
          ? undefined
          : 'Producto sugerido por similitud. Confirma su medida, marca y presentación.',
  };
}

export function normalizeCatalogText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function catalogCodeMatchScore(value: string, expected?: string | null) {
  const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const detected = normalize(value);
  const candidate = normalize(expected ?? '');
  if (!detected || !candidate) return 0;
  if (detected === candidate) return 100;
  // Fragments are useful suggestions, but never exact matches.
  const fragments = value.split(/[\s|/;,:]+/).map(normalize);
  if (candidate.length >= 4 && fragments.includes(candidate)) return 94;
  return Math.min(detected.length, candidate.length) >= 7 &&
    (detected.startsWith(candidate) || candidate.startsWith(detected))
    ? 88
    : 0;
}

function specifications(value: string) {
  const text = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[½¼¾]/g, (character) => ({ '½': ' 1/2', '¼': ' 1/4', '¾': ' 3/4' })[character]!);
  return [...text.matchAll(/\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?/g)].map(
    ([number]) =>
      number
        .replace(/\s*\/\s*/g, '/')
        .replace(/\s+/g, ' ')
        .replace(',', '.'),
  );
}

export function hasConflictingProductSpecifications(left: string, right: string) {
  const a = specifications(left);
  const b = specifications(right);
  // Additional references printed only on one side do not prove a conflict.
  // Different explicit sizes (1/2 vs 3/4, 20A vs 30A) must never be fuzzy-matched.
  return Boolean(
    a.length &&
    b.length &&
    !a.every((number) => b.includes(number)) &&
    !b.every((number) => a.includes(number)),
  );
}

function words(value: string) {
  const ignored = new Set([
    'DE',
    'DEL',
    'LA',
    'EL',
    'LOS',
    'LAS',
    'CON',
    'PARA',
    'POR',
    'P',
    'UNIDAD',
    'UNIDADES',
    'UND',
    'UNI',
    'PIEZA',
    'PZA',
    'REF',
    'QUINTAL',
    'QUINTALES',
    'LIBRA',
    'LIBRAS',
    'DOC',
    'DOCENA',
    'CIENTO',
  ]);
  return normalizeCatalogText(value)
    .split(' ')
    .filter((token) => token.length > 1 && !/^\d+$/.test(token) && !ignored.has(token))
    .map((token) => (token.length > 4 && token.endsWith('S') ? token.slice(0, -1) : token));
}

function oneEditApart(left: string, right: string) {
  if (left === right) return true;
  if (Math.min(left.length, right.length) < 5 || Math.abs(left.length - right.length) > 1)
    return false;
  let a = 0;
  let b = 0;
  let edits = 0;
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) {
      a++;
      b++;
      continue;
    }
    if (++edits > 1) return false;
    if (left.length >= right.length) a++;
    if (right.length >= left.length) b++;
  }
  return edits + Number(a < left.length || b < right.length) <= 1;
}

function descriptionScore(description: string, product: Product) {
  const detected = [...new Set(words(description))];
  if (detected.length < 2) return 0;
  const expected = [...new Set(words(product.name))];
  if (expected.length < 2) return 0;
  const remaining = new Set(expected);
  let score = 0;
  let common = 0;
  for (const word of detected) {
    const match =
      [...remaining].find((candidate) => candidate === word) ??
      [...remaining].find((candidate) => oneEditApart(word, candidate));
    if (match) {
      remaining.delete(match);
      score += match === word ? 1 : 0.85;
      common++;
    }
  }
  if (common < 2) return 0;
  const coverage = score / Math.max(detected.length, expected.length);
  const containment = score / Math.min(detected.length, expected.length);
  return Math.round(coverage * 65 + containment * 35);
}

/** Undefined means the presentation requires an explicit inventory conversion. */
export function invoiceUnitToProductUnit(value?: string): ProductUnit | undefined {
  const unit = normalizeCatalogText(value ?? '');
  const units: Record<string, ProductUnit> = {
    UNIT: 'UNIT',
    UNIDAD: 'UNIT',
    UNIDADES: 'UNIT',
    UND: 'UNIT',
    UN: 'UNIT',
    UD: 'UNIT',
    PIEZA: 'UNIT',
    PZA: 'UNIT',
    BOX: 'BOX',
    CAJA: 'BOX',
    CAJAS: 'BOX',
    PACK: 'PACK',
    PAQUETE: 'PACK',
    PAQ: 'PACK',
    BAG: 'BAG',
    SACO: 'BAG',
    ROLL: 'ROLL',
    ROLLO: 'ROLL',
    METER: 'METER',
    METRO: 'METER',
    M: 'METER',
    MT: 'METER',
    MTS: 'METER',
    FOOT: 'FOOT',
    PIE: 'FOOT',
    PIES: 'FOOT',
    FT: 'FOOT',
    YARD: 'YARD',
    YARDA: 'YARD',
    POUND: 'POUND',
    LIBRA: 'POUND',
    LIBRAS: 'POUND',
    LB: 'POUND',
    LBS: 'POUND',
    GALLON: 'GALLON',
    GALON: 'GALLON',
    GAL: 'GALLON',
    LITER: 'LITER',
    LITRO: 'LITER',
    LT: 'LITER',
    KILOGRAM: 'KILOGRAM',
    KILOGRAMO: 'KILOGRAM',
    KG: 'KILOGRAM',
    QUINTAL: 'QUINTAL',
    QUINTALES: 'QUINTAL',
    QQ: 'QUINTAL',
  };
  return units[unit];
}

export type OcrEditableItem = {
  key: string;
  productId: string;
  purchaseOrderItemId?: string;
  ocrItem?: SupplierInvoiceOcrItem;
  /** Occurrence identity, not product ID: an invoice can repeat a product. */
  ocrSourceKey?: string;
  quantity: string;
  unitCostNet: string;
  taxPercent: string;
  discountTotal: string;
  unitConversionConfirmed?: boolean;
};

export function createOcrInvoiceItem(
  item: SupplierInvoiceOcrItem,
  key: string,
  sourceKey: string,
  product?: Product,
): OcrEditableItem {
  return {
    key,
    ocrSourceKey: sourceKey,
    productId: product?.id ?? '',
    ocrItem: item,
    quantity: item.quantity === undefined ? '' : String(item.quantity),
    unitCostNet: item.unitCostNet === undefined ? '' : String(item.unitCostNet),
    taxPercent: item.taxRate === undefined ? '' : String(Math.round(item.taxRate * 10000) / 100),
    discountTotal: String(item.discountTotal ?? 0),
  };
}

/** Re-applying OCR is idempotent and never discards manual edits or duplicate occurrences. */
export function mergeOcrInvoiceItems(current: OcrEditableItem[], suggested: OcrEditableItem[]) {
  const keys = new Set(current.map((item) => item.ocrSourceKey).filter(Boolean));
  const additions = suggested.filter((item) => !item.ocrSourceKey || !keys.has(item.ocrSourceKey));
  if (!additions.length) return current;
  const meaningful = current.filter((item) =>
    Boolean(
      item.productId ||
      item.ocrItem ||
      item.purchaseOrderItemId ||
      item.unitCostNet.trim() ||
      item.quantity !== '1' ||
      item.discountTotal !== '0',
    ),
  );
  return [...meaningful, ...additions];
}

/** Choosing a catalog entry must not silently replace the supplier's invoice prices. */
export function selectInvoiceProduct(item: OcrEditableItem, product: Product): OcrEditableItem {
  return {
    ...item,
    productId: product.id,
    unitConversionConfirmed: item.productId === product.id ? item.unitConversionConfirmed : false,
    unitCostNet: item.unitCostNet.trim()
      ? item.unitCostNet
      : item.ocrItem
        ? ''
        : String(Number(product.cost ?? 0)),
    taxPercent: item.taxPercent.trim()
      ? item.taxPercent
      : item.ocrItem
        ? ''
        : String(Number(product.taxRate) * 100),
  };
}

export function needsInvoiceUnitReview(item: OcrEditableItem, product?: Product) {
  return Boolean(
    item.ocrItem?.unit &&
    product &&
    !item.unitConversionConfirmed &&
    invoiceUnitToProductUnit(item.ocrItem.unit) !== product.unit,
  );
}

export function convertInvoiceUnit(item: OcrEditableItem, factor: number): OcrEditableItem {
  if (!Number.isFinite(factor) || factor <= 0)
    throw new Error('Indica cuántas unidades de inventario contiene una unidad de la factura.');
  if (!item.quantity.trim() || !item.unitCostNet.trim())
    throw new Error('Completa la cantidad y el costo leídos antes de convertir la presentación.');
  const quantity = Math.round(Number(item.quantity) * factor * 1000) / 1000;
  const cost =
    Math.round((Number(item.unitCostNet) / factor + Number.EPSILON) * 1_000_000) / 1_000_000;
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(cost) || cost < 0)
    throw new Error('La conversión no produce una cantidad y un costo válidos.');
  if (Math.abs(quantity * cost - Number(item.quantity) * Number(item.unitCostNet)) > 0.02) {
    throw new Error(
      'Esta conversión cambia el importe por redondeo. Revisa manualmente cantidad y costo y confirma la presentación.',
    );
  }
  return {
    ...item,
    quantity: String(quantity),
    unitCostNet: String(cost),
    unitConversionConfirmed: true,
  };
}

export function formatInvoiceCalendarDate(value?: string | null) {
  if (!value) return '—';
  const dateOnly = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return value;
  return new Intl.DateTimeFormat('es-DO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${dateOnly}T12:00:00Z`));
}
