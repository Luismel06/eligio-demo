export type OcrConfidence = 'high' | 'medium' | 'low';

export type SupplierInvoiceOcrItem = {
  /** Línea original, para que la persona pueda contrastarla con la factura. */
  rawText: string;
  code?: string;
  description?: string;
  unit?: string;
  quantity?: number;
  unitCostNet?: number;
  discountTotal?: number;
  taxRate?: number;
  taxTotal?: number;
  subtotal?: number;
  total?: number;
  confidence: Partial<
    Record<
      'code' | 'description' | 'quantity' | 'unitCostNet' | 'discountTotal' | 'taxRate' | 'total',
      OcrConfidence
    >
  >;
  warnings: string[];
};

type OcrResultField =
  | 'supplierName'
  | 'supplierDocument'
  | 'invoiceNumber'
  | 'ncf'
  | 'issueDate'
  | 'paymentDueDate'
  | 'ncfValidUntil'
  | 'subtotal'
  | 'discountTotal'
  | 'taxTotal'
  | 'total'
  | 'purchaseOrderNumber';

export type SupplierInvoiceOcrResult = {
  rawText: string;
  /** Número de páginas procesadas localmente. Nunca incluye la imagen. */
  pageCount?: number;
  supplierName?: string;
  supplierDocument?: string;
  supplierTemplate?: string;
  invoiceNumber?: string;
  ncf?: string;
  issueDate?: string;
  /** Fecha comercial para cuentas por pagar; nunca la vigencia fiscal del NCF. */
  paymentDueDate?: string;
  /** Vigencia fiscal del NCF/e-NCF; no se usa como vencimiento de pago. */
  ncfValidUntil?: string;
  paymentCondition?: string;
  currency?: 'DOP';
  subtotal?: number;
  discountTotal?: number;
  taxTotal?: number;
  total?: number;
  purchaseOrderNumber?: string;
  items: SupplierInvoiceOcrItem[];
  confidence: Partial<Record<OcrResultField, OcrConfidence>>;
  warnings: string[];
};

type SupplierInvoiceOcrOptions = {
  qrValues?: string[];
};

type SupplierTemplate = {
  key: string;
  name: string;
  aliases: RegExp[];
};

type AmountToken = {
  value: number;
  index: number;
};

const supplierTemplates: SupplierTemplate[] = [
  {
    key: 'CANO',
    name: 'Cano Industrial S.R.L.',
    aliases: [/\bCANO\s+INDUSTRIAL\b/i, /\bCANO\b/i],
  },
  {
    key: 'BELLON',
    name: 'Bellón, S.A.S.',
    aliases: [/\bBELL[OÓ]N\b/i],
  },
  {
    key: 'PROMACO',
    name: 'Proveedores de Materiales de Construcción',
    aliases: [/\bPROVEEDORES\s+DE\s+MATERIALES\b/i, /\bPROMACO\b/i],
  },
  {
    key: 'YANWILS',
    name: 'Yanwils Comercial S.R.L.',
    aliases: [/\bYANWILS\b/i],
  },
  {
    key: 'CARIBE_RB',
    name: 'Comercial del Caribe RB, SRL',
    aliases: [/\bCOMERCIAL\s+DEL\s+CARIBE\b/i],
  },
  {
    key: 'WURTH',
    name: 'Würth Dominicana S.A.',
    aliases: [/\bW[UÜ]RTH\b/i],
  },
];

const dateExpression = /(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/;
const amountExpression = /(?:RD\$?\s*)?(?:\d{1,3}(?:[.,]\d{3})+[.,]\d{2}|\d+(?:[.,]\d{2}))/gi;

/**
 * Convierte el texto producido por Tesseract en sugerencias conservadoras.
 * Este parser no crea productos ni asume que los resultados sean definitivos:
 * cualquier campo ambiguo se deja vacío o se acompaña de una advertencia.
 */
export function extractSupplierInvoiceOcr(
  rawText: string,
  options: SupplierInvoiceOcrOptions = {},
): SupplierInvoiceOcrResult {
  const raw = normalizeRawText(rawText);
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const foldedLines = lines.map(foldText);
  const warnings: string[] = [];
  const confidence: SupplierInvoiceOcrResult['confidence'] = {};
  const template = findSupplierTemplate(raw);

  const supplierDocumentResult = findSupplierDocument(lines, foldedLines, template);
  const supplierName = findSupplierName(lines, template, supplierDocumentResult.index);
  const ocrNcf = findNcf(lines);
  const qrNcf = findNcf(options.qrValues ?? []);
  const ncf = qrNcf ?? ocrNcf;
  const invoiceNumber = findInvoiceNumber(lines, ncf);
  const issueDate = findIssueDate(lines);
  const ncfValidUntil = findNcfValidUntil(lines);
  const paymentDueDate = findPaymentDueDate(lines, issueDate, ncfValidUntil);
  const paymentCondition = findPaymentCondition(lines);
  const totals = findTotals(lines);
  const purchaseOrderNumber = findPurchaseOrderNumber(lines);
  const items = findItems(lines, template?.key);

  if (template) {
    confidence.supplierName = 'high';
  } else if (supplierName) {
    confidence.supplierName = 'low';
  }
  if (supplierDocumentResult.value) confidence.supplierDocument = supplierDocumentResult.confidence;
  if (ncf) confidence.ncf = 'high';
  if (invoiceNumber) confidence.invoiceNumber = template ? 'high' : 'medium';
  if (issueDate) confidence.issueDate = 'high';
  if (paymentDueDate) confidence.paymentDueDate = 'high';
  if (ncfValidUntil) confidence.ncfValidUntil = 'high';
  if (purchaseOrderNumber) confidence.purchaseOrderNumber = 'medium';
  if (totals.subtotal !== undefined) confidence.subtotal = totals.confidence.subtotal;
  if (totals.discountTotal !== undefined) confidence.discountTotal = totals.confidence.discountTotal;
  if (totals.taxTotal !== undefined) confidence.taxTotal = totals.confidence.taxTotal;
  if (totals.total !== undefined) confidence.total = totals.confidence.total;

  if (!supplierDocumentResult.value) {
    warnings.push('No se pudo confirmar el RNC del suplidor. Selecciónalo manualmente.');
  }
  if (!invoiceNumber) {
    warnings.push('No se pudo identificar con certeza el número interno de factura.');
  }
  if (qrNcf && ocrNcf && qrNcf !== ocrNcf) {
    warnings.push('El NCF leído en el QR no coincide con el texto OCR. Verifica el comprobante.');
  }
  if (!paymentDueDate && ncfValidUntil) {
    warnings.push(
      'Se detectó la vigencia fiscal del NCF, pero no un vencimiento comercial. Indica el vencimiento de pago manualmente.',
    );
  } else if (!paymentDueDate) {
    warnings.push('No se detectó el vencimiento comercial de la factura. Indícalo manualmente.');
  }
  if (paymentDueDate && issueDate && paymentDueDate < issueDate) {
    warnings.push('El vencimiento detectado es anterior a la emisión y fue descartado.');
  }
  if (totals.subtotal !== undefined && totals.taxTotal !== undefined && totals.total !== undefined) {
    const expected = roundCurrency(totals.subtotal + totals.taxTotal);
    if (!isClose(expected, totals.total, 0.08)) {
      warnings.push(
        'Los totales detectados no cuadran automáticamente. Revisa subtotal, ITBIS, descuentos y total.',
      );
    }
  }
  if (!items.length) {
    warnings.push(
      'No se pudieron reconstruir líneas de productos con seguridad. Completa o corrige los productos manualmente.',
    );
  } else if (items.some((item) => item.warnings.length)) {
    warnings.push('Algunas líneas de productos requieren revisión antes de aplicarlas.');
  }

  return {
    rawText: raw,
    supplierName,
    supplierDocument: supplierDocumentResult.value,
    supplierTemplate: template?.key,
    invoiceNumber,
    ncf,
    issueDate,
    paymentDueDate:
      paymentDueDate && (!issueDate || paymentDueDate >= issueDate) ? paymentDueDate : undefined,
    ncfValidUntil,
    paymentCondition,
    currency: /\b(?:DOP|RD\$|PESOS\s+DOMINICANOS)\b/i.test(raw) ? 'DOP' : undefined,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    total: totals.total,
    purchaseOrderNumber,
    items,
    confidence,
    warnings: unique(warnings),
  };
}

function normalizeRawText(value: string) {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[\t ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function foldText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .toUpperCase();
}

function findSupplierTemplate(text: string) {
  return supplierTemplates.find((template) => template.aliases.some((alias) => alias.test(text)));
}

function findSupplierName(lines: string[], template: SupplierTemplate | undefined, documentIndex: number) {
  if (template) return template.name;

  const scanEnd = documentIndex >= 0 ? Math.min(lines.length, documentIndex + 2) : Math.min(lines.length, 8);
  for (let index = 0; index < scanEnd; index += 1) {
    const line = lines[index];
    const folded = foldText(line);
    if (
      line.length >= 5 &&
      line.length <= 90 &&
      /[A-ZÁÉÍÓÚÑ]/i.test(line) &&
      !/\b(?:FACTURA|RNC|CEDULA|DIRECCION|TELEFONO|EMAIL|PAGINA|MONEDA)\b/.test(folded)
    ) {
      return cleanBusinessName(line);
    }
  }
  return undefined;
}

function cleanBusinessName(value: string) {
  return value.replace(/\s{2,}/g, ' ').replace(/[|_]+/g, ' ').trim();
}

function findSupplierDocument(
  lines: string[],
  foldedLines: string[],
  template: SupplierTemplate | undefined,
) {
  const candidates: Array<{ value: string; score: number; index: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const folded = foldedLines[index];
    const matches = [...line.matchAll(/\b(?:RNC|CEDULA)\s*(?:NO\.?|NUM(?:ERO)?|#)?\s*[:#-]?\s*([\d\s-]{9,16})\b/gi)];
    for (const match of matches) {
      const value = match[1].replace(/\D/g, '');
      if (value.length !== 9 && value.length !== 11) continue;
      const previousLine = foldText(lines[Math.max(0, index - 1)] ?? '');
      let score = 1;
      if (index < Math.ceil(lines.length * 0.35)) score += 3;
      if (template && index < 12) score += 3;
      // Solo penalizamos etiquetas de cliente que estén en la misma línea o
      // justo antes. Muchas facturas imprimen el RNC del emisor y el bloque de
      // cliente uno debajo de otro.
      if (
        /\b(?:CLIENTE|FACTURADO\s+A|RAZON\s+SOCIAL\s+CLIENTE|RNC\s+CLIENTE)\b/.test(
          folded,
        ) ||
        /\b(?:FACTURADO\s+A|RAZON\s+SOCIAL\s+CLIENTE)\b/.test(previousLine)
      ) {
        score -= 8;
      }
      if (/\b(?:SUPLIDOR|EMISOR|VENDEDOR)\b/.test(folded)) score += 2;
      if (/\bRNC\b/.test(folded)) score += 1;
      candidates.push({ value, score, index });
    }
  }

  const selected = [...candidates].sort((left, right) => right.score - left.score || left.index - right.index)[0];
  if (!selected || selected.score < 1) {
    return { value: undefined, confidence: 'low' as OcrConfidence, index: -1 };
  }
  return {
    value: selected.value,
    confidence: selected.score >= 5 ? ('high' as OcrConfidence) : ('medium' as OcrConfidence),
    index: selected.index,
  };
}

function findNcf(lines: string[]) {
  const matches: Array<{ value: string; score: number }> = [];
  for (const line of lines) {
    const folded = foldText(line);
    for (const match of line.matchAll(/\b([BE]\d{8,14})\b/gi)) {
      const value = match[1].toUpperCase();
      let score = 1;
      if (/\b(?:E-?NCF|NCF|E-BF)\b/.test(folded)) score += 5;
      if (/\b(?:FACTURA|DOCUMENTO)\b/.test(folded)) score += 1;
      matches.push({ value, score });
    }
  }
  return matches.sort((left, right) => right.score - left.score)[0]?.value;
}

function findInvoiceNumber(lines: string[], ncf: string | undefined) {
  const patterns = [
    /\b(?:FACTURA\s+(?:NO\.?|NUM(?:ERO)?|#|INTERNA)|FACT(?:\.)?(?=\s|:|#|$)|DOCUMENTO)\s*(?:NO\.?|NUM(?:ERO)?|#|:)?\s*([A-Z0-9][A-Z0-9/-]{2,})\b/i,
    /\b(?:FACTURA|DOCUMENTO)\s*(?:#|NO\.?|NUM(?:ERO)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})\b/i,
    /\b(?:FACTURA|DOCUMENTO)\s*:\s*([A-Z0-9][A-Z0-9/-]{2,})\b/i,
  ];
  const candidates: string[] = [];
  for (const line of lines) {
    const folded = foldText(line);
    if (/\b(?:E-?NCF|NCF)\b/.test(folded) && !/\b(?:FACTURA|DOCUMENTO)\b/.test(folded)) {
      continue;
    }
    for (const pattern of patterns) {
      const value = line.match(pattern)?.[1]?.toUpperCase();
      // Algunos suplidores usan números internos que también comienzan por B
      // o E. Si la etiqueta dice FACTURA/DOCUMENTO, conserva el número aun si
      // se parece a un NCF; solo se descarta el NCF exacto ya identificado.
      if (value && value !== ncf) candidates.push(value);
    }
  }
  return candidates[0];
}

function findIssueDate(lines: string[]) {
  const patterns = [
    /\b(?:FECHA\s+(?:DE\s+)?EMISION|EMISION|FECHA\s+DOC(?:UMENTO)?|FECHA\s+FACTURA)\b[^\d]{0,24}/i,
    /\bFECHA\b[^\d]{0,12}/i,
  ];
  for (const line of lines) {
    const folded = foldText(line);
    if (/\b(?:VENCE|VENCIMIENTO|VALIDO|FIRMA|IMPRESO)\b/.test(folded)) continue;
    for (const pattern of patterns) {
      const prefix = line.match(pattern);
      if (!prefix) continue;
      const date = findDateInValue(line.slice(prefix.index));
      if (date) return date;
    }
  }
  return undefined;
}

function findPaymentDueDate(
  lines: string[],
  issueDate: string | undefined,
  ncfValidUntil: string | undefined,
) {
  for (const line of lines) {
    const folded = foldText(line);
    if (!/\b(?:VENCE|VENCIMIENTO|FECHA\s+DE\s+VENCIMIENTO)\b/.test(folded)) continue;
    // Una línea que habla de NCF/e-NCF o "válido hasta" es fiscal, aunque
    // contenga la palabra vencimiento.
    if (/\b(?:E-?NCF|NCF|VALIDO\s+HASTA)\b/.test(folded)) continue;
    const date = findDateInValue(line);
    if (!date || (issueDate && date < issueDate) || date === ncfValidUntil) continue;
    return date;
  }
  return undefined;
}

function findNcfValidUntil(lines: string[]) {
  for (const line of lines) {
    const folded = foldText(line);
    if (
      /\bVALIDO\s+HASTA\b/.test(folded) ||
      (/\b(?:E-?NCF|NCF|E-BF)\b/.test(folded) && /\bVENCIMIENTO\b/.test(folded))
    ) {
      const date = findDateInValue(line);
      if (date) return date;
    }
  }
  return undefined;
}

function findPaymentCondition(lines: string[]) {
  const line = lines.find((candidate) => {
    const folded = foldText(candidate);
    return /\b(?:CONDICION|TERMINOS|PAGO\s+POR|VENTA\s+A\s+CREDITO|CREDITO)\b/.test(folded);
  });
  if (!line) return undefined;
  return line.replace(/\s{2,}/g, ' ').trim().slice(0, 180);
}

function findPurchaseOrderNumber(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/\b(?:O\/?C|ORDEN(?:\s+DE\s+COMPRA)?|PEDIDO)\s*(?:NO\.?|NUM(?:ERO)?|#|:)?\s*([A-Z0-9][A-Z0-9/-]{2,})\b/i);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return undefined;
}

function findTotals(lines: string[]) {
  const result: {
    subtotal?: number;
    discountTotal?: number;
    taxTotal?: number;
    total?: number;
    confidence: Partial<Record<'subtotal' | 'discountTotal' | 'taxTotal' | 'total', OcrConfidence>>;
  } = { confidence: {} };

  const reversed = [...lines].reverse();
  for (const line of reversed) {
    const folded = foldText(line);
    const amount = lastAmountInLine(line);
    if (amount === undefined) continue;

    if (
      result.total === undefined &&
      /\b(?:TOTAL\s+(?:A\s+)?PAGAR|TOTAL\s+(?:RD\$|DOP)|IMPORTE\s+TOTAL|TOTAL)\b/.test(folded) &&
      !/\b(?:TOTAL\s+(?:ITBIS|GRAVADO|EXENTO|BULTOS|LINEAS|ITEMS)|CANT(?:IDAD)?\s+TOTAL)\b/.test(folded)
    ) {
      result.total = amount;
      result.confidence.total = /\b(?:A\s+PAGAR|RD\$|DOP|IMPORTE\s+TOTAL)\b/.test(folded)
        ? 'high'
        : 'medium';
      continue;
    }
    if (
      result.taxTotal === undefined &&
      /\b(?:TOTAL\s+)?ITBIS\b/.test(folded) &&
      !/\b(?:ITBIS\s*%|ITBIS\s+LINEA)\b/.test(folded)
    ) {
      result.taxTotal = amount;
      result.confidence.taxTotal = /\bTOTAL\b/.test(folded) ? 'high' : 'medium';
      continue;
    }
    if (
      result.discountTotal === undefined &&
      /\b(?:TOTAL\s+)?DESCUENTO(?:S)?\b/.test(folded) &&
      !/\bDESCUENTO\s+LINEA\b/.test(folded)
    ) {
      result.discountTotal = amount;
      result.confidence.discountTotal = /\bTOTAL\b/.test(folded) ? 'high' : 'medium';
      continue;
    }
    if (
      result.subtotal === undefined &&
      /\b(?:SUB\s*-?\s*TOTAL|SUBTOTAL)\b/.test(folded) &&
      !/\b(?:GRAVADO|EXENTO)\b/.test(folded)
    ) {
      result.subtotal = amount;
      result.confidence.subtotal = 'high';
    }
  }

  return result;
}

function findItems(lines: string[], templateKey: string | undefined) {
  const tableRanges = findTableRanges(lines);
  const items: SupplierInvoiceOcrItem[] = [];
  for (const range of tableRanges) {
    for (let index = range.start; index < range.end; index += 1) {
      const item = parseItemLine(lines[index], templateKey);
      if (item) items.push(item);
    }
  }
  return dedupeItems(items);
}

function findTableRanges(lines: string[]) {
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < lines.length; index += 1) {
    const folded = foldText(lines[index]);
    const isHeader =
      /\bDESCRIP(?:CION)?\b/.test(folded) &&
      /\b(?:CANT(?:IDAD)?|PRECIO|CODIGO|ARTICULO)\b/.test(folded);
    if (!isHeader) continue;

    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = foldText(lines[cursor]);
      if (/\b(?:SUB\s*-?\s*TOTAL|SUBTOTAL|TOTAL\s+(?:A\s+)?PAGAR|FIN\s+DE\s+PRODUCTOS)\b/.test(candidate)) {
        end = cursor;
        break;
      }
      if (/^---\s*PAGINA\s+\d+\s*---$/.test(candidate)) {
        end = cursor;
        break;
      }
    }
    if (end > index + 1) ranges.push({ start: index + 1, end });
  }
  return ranges;
}

function parseItemLine(line: string, templateKey: string | undefined): SupplierInvoiceOcrItem | undefined {
  const folded = foldText(line);
  if (
    line.length < 8 ||
    /\b(?:TOTAL|SUBTOTAL|ITBIS|DESCUENTO|PAGADO|DESPACHADO|FIRMA|OBSERVACION)\b/.test(folded)
  ) {
    return undefined;
  }

  const amounts = extractAmounts(line);
  if (amounts.length < 2) return undefined;
  const inferred = inferItemFinancials(line, amounts);
  if (!inferred) return undefined;

  const description = inferDescription(line, amounts, inferred.quantity);
  if (!description || description.length < 3) return undefined;
  const code = inferCode(line, description, templateKey);
  const unit = inferUnit(line);
  const warnings: string[] = [];
  const confidence: SupplierInvoiceOcrItem['confidence'] = {
    description: 'medium',
    quantity: inferred.explicitQuantity ? 'high' : 'medium',
    unitCostNet: inferred.explicitQuantity ? 'high' : 'medium',
    total: inferred.taxTotal !== undefined ? 'medium' : 'low',
  };
  if (code) confidence.code = 'medium';
  if (inferred.discountTotal !== undefined) confidence.discountTotal = 'medium';
  if (inferred.taxRate !== undefined) confidence.taxRate = 'medium';
  if (!inferred.explicitQuantity) {
    warnings.push('La cantidad se infirió por los importes; compárala con la factura.');
  }
  if (inferred.taxRate !== undefined && (inferred.taxRate < 0 || inferred.taxRate > 1)) {
    warnings.push('El ITBIS de esta línea no pudo validarse.');
  }

  return {
    rawText: line,
    code,
    description,
    unit,
    quantity: inferred.quantity,
    unitCostNet: inferred.unitCostNet,
    discountTotal: inferred.discountTotal,
    taxRate:
      inferred.taxRate !== undefined && inferred.taxRate >= 0 && inferred.taxRate <= 1
        ? inferred.taxRate
        : undefined,
    taxTotal: inferred.taxTotal,
    subtotal: inferred.subtotal,
    total: inferred.total,
    confidence,
    warnings,
  };
}

function inferItemFinancials(line: string, amounts: AmountToken[]) {
  const percent = line.match(/\b(\d{1,2}(?:[.,]\d+)?)\s*%/)?.[1];
  const parsedDiscountPercent = percent ? parseLocalizedNumber(percent) : undefined;
  const discountRate = parsedDiscountPercent !== undefined ? parsedDiscountPercent / 100 : 0;
  const numericValues = extractNumericValues(line);
  const descriptionStart = findLikelyDescriptionStart(line);
  let best:
    | {
        quantity: number;
        unitCostNet: number;
        subtotal: number;
        discountTotal?: number;
        taxTotal?: number;
        taxRate?: number;
        total: number;
        explicitQuantity: boolean;
        score: number;
      }
    | undefined;

  for (let priceIndex = 0; priceIndex < amounts.length; priceIndex += 1) {
    const price = amounts[priceIndex];
    if (price.value <= 0 || (descriptionStart >= 0 && price.index < descriptionStart)) continue;
    for (let subtotalIndex = priceIndex + 1; subtotalIndex < amounts.length; subtotalIndex += 1) {
      const subtotalToken = amounts[subtotalIndex];
      if (subtotalToken.value <= 0) continue;
      const quantity = subtotalToken.value / (price.value * Math.max(0.01, 1 - discountRate));
      if (!isPlausibleQuantity(quantity)) continue;
      const explicitQuantity = numericValues.some((value) => isClose(value, quantity, 0.012));
      // Sin una cantidad visible, dejamos la sugerencia como baja confianza y
      // exigimos que la línea sea especialmente coherente.
      if (!explicitQuantity && amounts.length < 3) continue;
      const gross = roundCurrency(quantity * price.value);
      const subtotal = roundCurrency(subtotalToken.value);
      const discountTotal = discountRate ? roundCurrency(gross - subtotal) : undefined;
      const laterAmounts = amounts.slice(subtotalIndex + 1).map((token) => token.value);
      const betweenAmounts = amounts
        .slice(priceIndex + 1, subtotalIndex)
        .map((token) => token.value);
      const taxCandidate = [...laterAmounts, ...betweenAmounts].find(
        (value) => value > 0 && value <= subtotal * 0.5 && value !== subtotal,
      );
      const taxTotal = taxCandidate !== undefined ? roundCurrency(taxCandidate) : undefined;
      const taxRate = taxTotal !== undefined ? roundRate(taxTotal / subtotal) : undefined;
      const visibleTotal = laterAmounts.find(
        (value) => taxTotal !== undefined && isClose(value, subtotal + taxTotal, 0.08),
      );
      const fallbackVisibleTotal = laterAmounts.at(-1);
      const total = roundCurrency(
        visibleTotal ??
          (fallbackVisibleTotal !== undefined && fallbackVisibleTotal >= subtotal
            ? fallbackVisibleTotal
            : subtotal + (taxTotal ?? 0)),
      );
      const score =
        (explicitQuantity ? 10 : 2) +
        (discountRate ? 2 : 0) +
        (taxTotal !== undefined ? 2 : 0) +
        (visibleTotal !== undefined ? 1 : 0);
      const candidate = {
        quantity: roundQuantity(quantity),
        unitCostNet: roundCurrency(price.value),
        subtotal,
        discountTotal,
        taxTotal,
        taxRate,
        total,
        explicitQuantity,
        score,
      };
      if (!best || candidate.score > best.score) best = candidate;
    }
  }

  // En formatos como Würth, el único importe de línea puede ser el total con
  // ITBIS. Probamos total - ITBIS como subtotal neto antes de abandonar la línea.
  for (let priceIndex = 0; priceIndex < amounts.length; priceIndex += 1) {
    const price = amounts[priceIndex];
    if (descriptionStart >= 0 && price.index < descriptionStart) continue;
    for (let taxIndex = priceIndex + 1; taxIndex < amounts.length; taxIndex += 1) {
      const tax = amounts[taxIndex];
      for (let totalIndex = taxIndex + 1; totalIndex < amounts.length; totalIndex += 1) {
        const total = amounts[totalIndex];
        const subtotal = roundCurrency(total.value - tax.value);
        if (subtotal <= 0) continue;
        const quantity = subtotal / price.value;
        if (!isPlausibleQuantity(quantity)) continue;
        const explicitQuantity = numericValues.some((value) => isClose(value, quantity, 0.012));
        if (!explicitQuantity) continue;
        const candidate = {
          quantity: roundQuantity(quantity),
          unitCostNet: roundCurrency(price.value),
          subtotal,
          taxTotal: roundCurrency(tax.value),
          taxRate: roundRate(tax.value / subtotal),
          total: roundCurrency(total.value),
          explicitQuantity,
          score: 13,
        };
        if (!best || candidate.score > best.score) best = candidate;
      }
    }
  }

  return best;
}

function findLikelyDescriptionStart(line: string) {
  const ignoredWords = new Set([
    'UND',
    'UNI',
    'UNIDAD',
    'GL',
    'GAL',
    'CJ',
    'CAJA',
    'FUNDA',
    'FUNDAS',
    'LIBRA',
    'LIBRAS',
    'CIENTO',
    'PLIEGO',
    'OZ',
  ]);
  for (const match of line.matchAll(/\b[A-ZÁÉÍÓÚÑ]{3,}\b/gi)) {
    if (!ignoredWords.has(foldText(match[0])) && match.index !== undefined) return match.index;
  }
  return -1;
}

function inferDescription(line: string, amounts: AmountToken[], quantity: number) {
  let value = line;
  for (const amount of [...amounts].reverse()) {
    const token = line.slice(amount.index).match(amountExpression)?.[0];
    if (token) {
      const absoluteIndex = value.lastIndexOf(token);
      if (absoluteIndex >= 0) value = `${value.slice(0, absoluteIndex)} ${value.slice(absoluteIndex + token.length)}`;
    }
  }
  value = value
    .replace(/\b\d{1,2}(?:[.,]\d+)?\s*%/g, ' ')
    .replace(new RegExp(`\\b${escapeRegExp(String(quantity))}\\b`, 'g'), ' ')
    .replace(/\b(?:UND|UNI|UNIDAD|GL|GAL|CJ|CAJA|FUNDAS?|LIBRAS?|CIENTO|PLIEGO|OZ)\b/gi, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Quita los códigos de bodega cortos al inicio, pero conserva nombres que
  // contienen medidas o modelos como "PVC 1/2".
  value = value
    .replace(/^(?:(?:[A-Z]{1,5}\d{2,}|[A-Z]{1,3}\d?|\d{1,3})\s+)+/i, '')
    .replace(/^\.?\d+(?:[.,]\d+)?\s+/, '')
    .replace(/\s+\d{1,4}$/g, '');
  return value.replace(/\s{2,}/g, ' ').trim();
}

function inferCode(line: string, description: string, templateKey: string | undefined) {
  const numericCodeBeforeUnit = line.match(
    /\b(\d{2,4})\s+(?:UND|UNI|UNIDAD|GL|GAL|CJ|CAJA|FUNDA|FUNDAS|LIBRA|LIBRAS|CIENTO|PLIEGO|OZ)\b/i,
  )?.[1];
  if (numericCodeBeforeUnit) return numericCodeBeforeUnit;
  const alphanumeric = [
    ...line.matchAll(/\b(?:[A-Z]{1,5}\d{2,}[A-Z0-9-]*|\d{5,})\b/gi),
  ].at(-1)?.[0];
  if (!alphanumeric) return undefined;
  if (foldText(description).includes(foldText(alphanumeric))) return undefined;
  // Los números de RNC/documento no pertenecen a una fila de producto porque
  // las líneas se toman únicamente dentro de la tabla.
  if (/^\d{9,11}$/.test(alphanumeric)) return undefined;
  if (templateKey === 'CANO' && /^[A-Z]{2}\d+$/.test(alphanumeric)) return alphanumeric.toUpperCase();
  return alphanumeric.toUpperCase();
}

function inferUnit(line: string) {
  return line.match(/\b(UND|UNI|UNIDAD|GL|GAL|CJ|CAJA|FUNDA|FUNDAS|LIBRA|LIBRAS|CIENTO|PLIEGO|OZ)\b/i)?.[1]?.toUpperCase();
}

function extractAmounts(line: string): AmountToken[] {
  const values: AmountToken[] = [];
  for (const match of line.matchAll(amountExpression)) {
    const value = parseLocalizedNumber(match[0]);
    if (value !== undefined && match.index !== undefined) values.push({ value, index: match.index });
  }
  return values;
}

function extractNumericValues(line: string) {
  return [...line.matchAll(/\b\d+(?:[.,]\d+)?\b/g)]
    .map((match) => parseLocalizedNumber(match[0]))
    .filter((value): value is number => value !== undefined);
}

function lastAmountInLine(line: string) {
  return extractAmounts(line).at(-1)?.value;
}

function parseLocalizedNumber(value: string) {
  const compact = value.replace(/RD\$?/gi, '').replace(/\s/g, '');
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastDot > lastComma ? compact.replaceAll(',', '') : compact.replaceAll('.', '').replace(',', '.');
  } else if (lastComma >= 0) {
    normalized = compact.split(',').at(-1)?.length === 2 ? compact.replace(',', '.') : compact.replaceAll(',', '');
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function findDateInValue(value: string) {
  const match = value.match(dateExpression)?.[1];
  return match ? toIsoDate(match) : undefined;
}

function toIsoDate(value: string) {
  const parts = value.split(/[/-]/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return undefined;
  const [first, second, third] = parts;
  const year = first > 999 ? first : third < 100 ? 2000 + third : third;
  const month = first > 999 ? second : second;
  const day = first > 999 ? third : first;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return date.toISOString().slice(0, 10);
}

function dedupeItems(items: SupplierInvoiceOcrItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${foldText(item.description ?? item.rawText)}|${item.quantity ?? ''}|${item.unitCostNet ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundRate(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}

function isClose(left: number, right: number, tolerance: number) {
  return Math.abs(left - right) <= tolerance;
}

function isPlausibleQuantity(value: number) {
  return Number.isFinite(value) && value > 0 && value <= 1_000_000 && Math.abs(value * 1_000 - Math.round(value * 1_000)) < 0.02;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
