import { parseDgiiEcfQrPayload, type DgiiEcfQrPayload } from './supplier-invoice-qr';

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
  /** Number of merchandise rows explicitly printed on the document, when present. */
  expectedItemCount?: number;
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

export type SupplierInvoiceOcrOptions = {
  qrValues?: string[];
  /** Physical rows reconstructed from OCR word coordinates; never another invoice. */
  layoutLines?: string[];
};

type SupplierTemplate = {
  key: string;
  name: string;
  aliases: RegExp[];
  /**
   * RNC observado en las facturas reales del suplidor. Se usa solamente para
   * dar prioridad a un RNC que también apareció en el texto OCR; nunca se
   * inventa el documento si la lectura no lo contiene.
   */
  knownDocuments?: string[];
  itemLayout: SupplierItemLayout;
  invoicePatterns?: RegExp[];
};

type SupplierItemLayout = 'CANO' | 'BELLON' | 'PROMACO' | 'YANWILS' | 'CARIBE_RB' | 'WURTH';

type AmountToken = {
  value: number;
  index: number;
};

type DgiiQrSelection = {
  evidence?: DgiiEcfQrPayload;
  hasMultipleInvoices: boolean;
  hasFieldConflict: boolean;
};

const supplierTemplates: SupplierTemplate[] = [
  {
    key: 'CANO',
    name: 'Cano Industrial S.R.L.',
    aliases: [/\bCANO\s+INDUSTRIAL\b/i, /\bCANO\b/i],
    knownDocuments: ['101019409'],
    itemLayout: 'CANO',
    invoicePatterns: [/\bFACTURA\s*:\s*([A-Z0-9/-]{3,})\b/i],
  },
  {
    key: 'BELLON',
    name: 'Bellón, S.A.S.',
    aliases: [/\bBELLON\b/i],
    knownDocuments: ['102000621'],
    itemLayout: 'BELLON',
    invoicePatterns: [/\bFACT\.?\s*:\s*(FTV[A-Z0-9/-]{3,})\b/i],
  },
  {
    key: 'PROMACO',
    name: 'Proveedores de Materiales de Construcción',
    aliases: [/\bPROVEEDORES\s+DE\s+MATERIALES\b/i, /\bPROMACO\b/i],
    knownDocuments: ['131467849'],
    itemLayout: 'PROMACO',
    invoicePatterns: [/\bFACTURA\s*(?:NO\.?|#)?\s*[:#-]?\s*(B\d{5,})\b/i],
  },
  {
    key: 'YANWILS',
    name: 'Yanwils Comercial S.R.L.',
    aliases: [/\bYANWILS\b/i],
    itemLayout: 'YANWILS',
    invoicePatterns: [/\bDOCUMENTO\s*#?\s*([A-Z0-9/-]{4,})\b/i],
  },
  {
    key: 'CARIBE_RB',
    name: 'Comercial del Caribe RB, SRL',
    aliases: [/\bCOMERCIAL\s+DEL\s+CARIBE\b/i],
    knownDocuments: ['130221792'],
    itemLayout: 'CARIBE_RB',
    invoicePatterns: [/\bFACTURA\s*#\s*([A-Z0-9/-]{4,})\b/i],
  },
  {
    key: 'WURTH',
    name: 'Würth Dominicana S.A.',
    aliases: [/\bWURTH\b/i],
    knownDocuments: ['101874996'],
    itemLayout: 'WURTH',
    invoicePatterns: [/\bFACTURA\s+INTERNA\s*:\s*([A-Z0-9/-]{4,})\b/i],
  },
];

// An OCR-truncated year (e.g. "10-07-20,") must not silently become 2020.
const dateExpression = /\b(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})\b/;
const amountExpression = /(?:RD\$?\s*)?(?:\d{1,3}(?:[.,]\d{3})+[.,]\d{2}|\d+(?:[.,]\d{2}))/gi;
const unitPattern =
  'UNIDADES|UNIDAD|QUINTALES|QUINTAL|DOCENAS|DOCENA|CIENTO|LIBRAS|LIBRA|PLIEGOS|PLIEGO|FUNDAS|FUNDA|METROS|METRO|PIEZAS|PIEZA|GALONES|GALON|CAJAS|CAJA|UND|UNI|DOC|GAL|PZA|PZ|CJ|GL|OZ|LB|UD';

/**
 * Convierte el texto producido por Tesseract en sugerencias conservadoras.
 * Este parser no crea productos ni asume que los resultados sean definitivos:
 * cualquier campo ambiguo se deja vacío o se acompaña de una advertencia.
 *
 */

export function extractSupplierInvoiceOcr(
  rawText: string,
  options: SupplierInvoiceOcrOptions = {},
): SupplierInvoiceOcrResult {
  const raw = normalizeRawText(rawText);
  const originalLines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const layoutLines = options.layoutLines?.map((line) => line.trim()).filter(Boolean);
  const lines = layoutLines?.length ? layoutLines : originalLines;
  const foldedLines = lines.map(foldText);
  const warnings: string[] = [];
  const confidence: SupplierInvoiceOcrResult['confidence'] = {};
  const template = findSupplierTemplate(raw);

  const supplierDocumentResult = findSupplierDocument(lines, foldedLines, template);
  const supplierName = findSupplierName(lines, template, supplierDocumentResult.index);
  const ocrNcf = findNcf(lines);
  const ocrIssueDate = findIssueDate(lines);
  const ocrTotals = findTotals(lines);
  const qrSelection = selectDgiiEcfQrEvidence(options.qrValues ?? [], {
    ncf: ocrNcf,
    supplierDocument: supplierDocumentResult.value,
  });
  const qrEvidence = qrSelection.evidence;
  const supplierDocument = qrEvidence?.issuerRnc ?? supplierDocumentResult.value;
  const ncf = qrEvidence?.eNcf ?? ocrNcf;
  const invoiceNumber = findInvoiceNumber(lines, ncf, template);
  const issueDate = qrEvidence?.issueDate ?? ocrIssueDate;
  const ncfValidUntil = findNcfValidUntil(lines);
  const paymentDueDate = findPaymentDueDate(lines, issueDate, ncfValidUntil);
  const paymentCondition = findPaymentCondition(lines);
  const totals = {
    ...ocrTotals,
    taxTotal: qrEvidence?.taxTotal ?? ocrTotals.taxTotal,
    total: qrEvidence?.total ?? ocrTotals.total,
    confidence: {
      ...ocrTotals.confidence,
      ...(qrEvidence?.taxTotal !== undefined ? { taxTotal: 'high' as OcrConfidence } : {}),
      ...(qrEvidence?.total !== undefined ? { total: 'high' as OcrConfidence } : {}),
    },
  };
  const purchaseOrderNumber = findPurchaseOrderNumber(lines);
  const spatialItems = findItems(lines, template);
  const originalItems = layoutLines?.length ? findItems(originalLines, template) : spatialItems;
  // Choose one complete reading. Combining OCR passes would duplicate merchandise.
  const items =
    scoreItemReading(originalItems, totals) > scoreItemReading(spatialItems, totals)
      ? originalItems
      : spatialItems;

  if (template) {
    confidence.supplierName = 'high';
  } else if (supplierName) {
    confidence.supplierName = 'low';
  }
  if (supplierDocument) {
    confidence.supplierDocument = qrEvidence ? 'high' : supplierDocumentResult.confidence;
  }
  if (ncf) confidence.ncf = 'high';
  if (invoiceNumber) confidence.invoiceNumber = template ? 'high' : 'medium';
  if (issueDate) confidence.issueDate = 'high';
  if (paymentDueDate) confidence.paymentDueDate = 'high';
  if (ncfValidUntil) confidence.ncfValidUntil = 'high';
  if (purchaseOrderNumber) confidence.purchaseOrderNumber = 'medium';
  if (totals.subtotal !== undefined) confidence.subtotal = totals.confidence.subtotal;
  if (totals.discountTotal !== undefined)
    confidence.discountTotal = totals.confidence.discountTotal;
  if (totals.taxTotal !== undefined) confidence.taxTotal = totals.confidence.taxTotal;
  if (totals.total !== undefined) confidence.total = totals.confidence.total;

  if (!supplierDocument) {
    warnings.push('No se pudo confirmar el RNC del suplidor. Selecciónalo manualmente.');
  }
  if (!invoiceNumber) {
    warnings.push('No se pudo identificar con certeza el número interno de factura.');
  }
  if (!issueDate) {
    warnings.push('No se pudo leer una fecha de emisión completa. Confírmala en la factura.');
  }
  if (totals.total === undefined) {
    warnings.push(
      'No se pudo leer el total monetario de la factura. Confírmalo antes de aplicar los productos.',
    );
  }
  if (qrSelection.hasMultipleInvoices) {
    warnings.push(
      qrEvidence
        ? 'Se detectaron QR de más de un comprobante. Solo se aplicó el que coincide con la lectura OCR.'
        : 'Se detectaron QR de más de un comprobante y no se aplicó ninguno automáticamente.',
    );
  }
  if (qrSelection.hasFieldConflict) {
    warnings.push(
      'Las lecturas del QR DGII contienen datos distintos para el mismo comprobante. Revisa los campos sugeridos.',
    );
  }
  if (
    qrEvidence &&
    supplierDocumentResult.value &&
    supplierDocumentResult.value !== qrEvidence.issuerRnc
  ) {
    warnings.push(
      'El RNC del emisor en el QR DGII no coincide con el texto OCR. Se priorizó el QR.',
    );
  }
  if (qrEvidence && ocrNcf && ocrNcf !== qrEvidence.eNcf) {
    warnings.push('El e-NCF leído en el QR DGII no coincide con el texto OCR. Se priorizó el QR.');
  }
  if (qrEvidence?.issueDate && ocrIssueDate && ocrIssueDate !== qrEvidence.issueDate) {
    warnings.push(
      'La fecha de emisión del QR DGII no coincide con el texto OCR. Se priorizó el QR.',
    );
  }
  if (
    qrEvidence?.taxTotal !== undefined &&
    ocrTotals.taxTotal !== undefined &&
    !isClose(qrEvidence.taxTotal, ocrTotals.taxTotal, 0.08)
  ) {
    warnings.push('El ITBIS del QR DGII no coincide con el texto OCR. Se priorizó el QR.');
  }
  if (
    qrEvidence?.total !== undefined &&
    ocrTotals.total !== undefined &&
    !isClose(qrEvidence.total, ocrTotals.total, 0.08)
  ) {
    warnings.push('El total del QR DGII no coincide con el texto OCR. Se priorizó el QR.');
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
  if (
    totals.subtotal !== undefined &&
    totals.taxTotal !== undefined &&
    totals.total !== undefined
  ) {
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
  warnings.push(...validateInvoiceCoherence(items, totals));
  const declaredItemCount = findDeclaredItemCount(lines);
  if (declaredItemCount !== undefined && declaredItemCount !== items.length) {
    warnings.push(
      `La factura indica ${declaredItemCount} líneas de productos y se leyeron ${items.length}. Revisa las líneas faltantes antes de continuar.`,
    );
  }

  return {
    rawText: raw,
    expectedItemCount: declaredItemCount,
    supplierName,
    supplierDocument,
    supplierTemplate: template?.key,
    invoiceNumber,
    ncf,
    issueDate,
    paymentDueDate:
      paymentDueDate && (!issueDate || paymentDueDate >= issueDate) ? paymentDueDate : undefined,
    ncfValidUntil,
    paymentCondition,
    currency: /\bDOP\b|RD\$|\bPESOS\s+DOMINICANOS?\b/i.test(raw) ? 'DOP' : undefined,
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

function selectDgiiEcfQrEvidence(
  values: string[],
  ocr: { ncf?: string; supplierDocument?: string },
): DgiiQrSelection {
  const parsed = values
    .map((value) => parseDgiiEcfQrPayload(value))
    .filter((value): value is DgiiEcfQrPayload => Boolean(value));
  if (!parsed.length) {
    return { hasMultipleInvoices: false, hasFieldConflict: false };
  }

  const groups = new Map<string, DgiiEcfQrPayload[]>();
  for (const value of parsed) {
    const key = `${value.issuerRnc}|${value.eNcf}`;
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  const candidates = [...groups.values()];
  let selected = candidates.length === 1 ? candidates[0] : undefined;
  if (!selected) {
    const matchesOcr = candidates.filter((candidate) => {
      const sample = candidate[0];
      return sample.eNcf === ocr.ncf || sample.issuerRnc === ocr.supplierDocument;
    });
    if (matchesOcr.length === 1) selected = matchesOcr[0];
  }
  if (!selected) {
    return { hasMultipleInvoices: true, hasFieldConflict: false };
  }

  const consolidated = consolidateDgiiEcfQrEvidence(selected);
  return {
    evidence: consolidated.evidence,
    hasMultipleInvoices: candidates.length > 1,
    hasFieldConflict: consolidated.hasFieldConflict,
  };
}

function consolidateDgiiEcfQrEvidence(values: DgiiEcfQrPayload[]) {
  const sample = [...values].sort(
    (left, right) => qrEvidenceCompleteness(right) - qrEvidenceCompleteness(left),
  )[0];
  const buyerRnc = consistentQrValue(values.map((value) => value.buyerRnc));
  const issueDate = consistentQrValue(values.map((value) => value.issueDate));
  const taxTotal = consistentQrValue(values.map((value) => value.taxTotal));
  const total = consistentQrValue(values.map((value) => value.total));
  return {
    evidence: {
      ...sample,
      buyerRnc: buyerRnc.value,
      issueDate: issueDate.value,
      taxTotal: taxTotal.value,
      total: total.value,
    },
    hasFieldConflict:
      buyerRnc.hasConflict || issueDate.hasConflict || taxTotal.hasConflict || total.hasConflict,
  };
}

function qrEvidenceCompleteness(value: DgiiEcfQrPayload) {
  return [value.buyerRnc, value.issueDate, value.taxTotal, value.total].filter(
    (field) => field !== undefined,
  ).length;
}

function consistentQrValue<T extends string | number>(values: Array<T | undefined>) {
  const distinct = [...new Set(values.filter((value): value is T => value !== undefined))];
  return {
    value: distinct.length === 1 ? distinct[0] : undefined,
    hasConflict: distinct.length > 1,
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
  const folded = foldText(text);
  return supplierTemplates.find((template) => template.aliases.some((alias) => alias.test(folded)));
}

function findSupplierName(
  lines: string[],
  template: SupplierTemplate | undefined,
  documentIndex: number,
) {
  if (template) return template.name;

  const scanEnd =
    documentIndex >= 0 ? Math.min(lines.length, documentIndex + 2) : Math.min(lines.length, 8);
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
  return value
    .replace(/\s{2,}/g, ' ')
    .replace(/[|_]+/g, ' ')
    .trim();
}

function findSupplierDocument(
  lines: string[],
  foldedLines: string[],
  template: SupplierTemplate | undefined,
) {
  const candidates: Array<{ value: string; score: number; index: number }> = [];

  // Un nombre comercial puede aparecer tanto arriba como dentro de sellos o
  // pies de página. Cuando el perfil también conoce su RNC, una coincidencia
  // textual exacta es la señal más segura para no seleccionar el RNC del
  // cliente que suele estar en la misma factura.
  for (const knownDocument of template?.knownDocuments ?? []) {
    const matchIndex = lines.findIndex((line) => line.replace(/\D/g, '').includes(knownDocument));
    if (matchIndex >= 0) {
      candidates.push({ value: knownDocument, score: 20, index: matchIndex });
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const folded = foldedLines[index];
    const matches = [
      ...line.matchAll(
        /\b(?:RNC|CEDULA)\s*(?:NO\.?|NUM(?:ERO)?|#)?\s*[:#-]?\s*([\d\s-]{9,16})\b/gi,
      ),
    ];
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
        /\b(?:CLIENTE|FACTURADO\s+A|RAZON\s+SOCIAL\s+CLIENTE|RNC\s+CLIENTE)\b/.test(folded) ||
        /\b(?:FACTURADO\s+A|RAZON\s+SOCIAL\s+CLIENTE)\b/.test(previousLine)
      ) {
        score -= 8;
      }
      if (/\b(?:SUPLIDOR|EMISOR|VENDEDOR)\b/.test(folded)) score += 2;
      if (/\bRNC\b/.test(folded)) score += 1;
      candidates.push({ value, score, index });
    }
  }

  const selected = [...candidates].sort(
    (left, right) => right.score - left.score || left.index - right.index,
  )[0];
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
    for (const match of line.matchAll(/\b(B\d{10}|E\d{12})\b/gi)) {
      const value = match[1].toUpperCase();
      let score = 1;
      if (/\b(?:E-?NCF|NCF|E-BF)\b/.test(folded)) score += 5;
      if (/\b(?:FACTURA|DOCUMENTO)\b/.test(folded)) score += 1;
      matches.push({ value, score });
    }
  }
  return matches.sort((left, right) => right.score - left.score)[0]?.value;
}

function findInvoiceNumber(
  lines: string[],
  ncf: string | undefined,
  template: SupplierTemplate | undefined,
) {
  const patterns = [
    ...(template?.invoicePatterns ?? []),
    /\b(?:FACTURA\s+(?:NO\.?|NUM(?:ERO)?|#|INTERNA)|FACT(?:\.)?(?=\s|:|#|$)|DOCUMENTO)\s*(?:NO\.?|NUM(?:ERO)?|#|:)?\s*([A-Z0-9][A-Z0-9/-]{2,})\b/i,
    /\b(?:FACTURA|DOCUMENTO)\s*(?:#|NO\.?|NUM(?:ERO)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{2,})\b/i,
    /\b(?:FACTURA[S#]?|DOCUMENTO)\s*:\s*([A-Z0-9][A-Z0-9/-]{2,})\b/i,
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
    /\b(?:FECHA\s+(?:DE\s+)?EMIS[I1L](?:O|Ó)N|EMIS[I1L](?:O|Ó)N|FECHA\s+DOC(?:UMENTO)?|FECHA\s+FACTURA)\b[^\d]{0,24}/i,
    /\bFECHA\s*[:.-]?\s*(?=\d)/i,
  ];
  for (const line of lines) {
    const folded = foldText(line);
    for (const pattern of patterns) {
      const prefix = line.match(pattern);
      if (!prefix) continue;
      if (pattern === patterns[1] && /\b(?:VENCE|VENCIMIENTO|VALIDO|FIRMA|IMPRESO)\b/.test(folded))
        continue;
      const date = findDateInValue(line.slice((prefix.index ?? 0) + prefix[0].length));
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
    const label = /\b(?:VENCE|VENCIMIENTO|FECHA\s+DE\s+VENCIMIENTO)\b/.exec(folded);
    if (!label) continue;
    // Una línea que habla de NCF/e-NCF o "válido hasta" es fiscal, aunque
    // contenga la palabra vencimiento.
    const precedingLabel = folded.slice(Math.max(0, label.index - 25), label.index);
    if (/\b(?:E-?NCF|NCF|VALIDO\s+HASTA)\b/.test(precedingLabel)) continue;
    const date = findDateInValue(line.slice(label.index + label[0].length));
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
      const label = /\b(?:VALIDO\s+HASTA|VENCIMIENTO)\b/.exec(folded);
      const date = findDateInValue(line.slice((label?.index ?? 0) + (label?.[0].length ?? 0)));
      if (date) return date;
    }
  }
  return undefined;
}

function findPaymentCondition(lines: string[]) {
  for (const line of lines) {
    const label =
      /\b(?:CONDICI[OÓ]N(?:ES)?(?:\s+DE\s+PAGO)?|T[EÉ]RMINOS(?:\s+DE\s+PAGO)?)\s*[:.-]?\s*/i.exec(
        line,
      );
    if (label) {
      const value = line.slice(label.index + label[0].length).trim();
      if (value) return value.slice(0, 180);
    }
  }
  // "Crédito fiscal" describes the tax document, never its payment terms.
  return lines
    .find((line) =>
      /\b(?:VENTA\s+A\s+CREDITO|CREDITO\s+(?:A\s+)?\d+\s*DIAS|CONTADO|PAGO\s+POR\s+ADELANTADO)\b/.test(
        foldText(line),
      ),
    )
    ?.trim()
    .slice(0, 180);
}

function findPurchaseOrderNumber(lines: string[]) {
  for (const line of lines) {
    const match = line.match(
      /\b(?:O\/?C|ORDEN(?:\s+DE\s+COMPRA)?|PEDIDO)\s*(?:NO\.?|NUM(?:ERO)?|#|:)?\s*([A-Z0-9][A-Z0-9/-]{2,})\b/i,
    );
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

  type TotalField = 'subtotal' | 'discountTotal' | 'taxTotal' | 'total';
  const classifyLabel = (line: string): { field: TotalField; remainder: string } | undefined => {
    // A stamp in the left column can share a physical baseline with footer
    // labels on the right. Geometry's tabs preserve that column boundary.
    const cells = line.split('\t');
    const labelCell = cells.findIndex((cell) =>
      /^\s*[+*=|_-]*\s*(?:SUB\s*-?\s*TOTAL|(?:TOTAL\s+)?ITBIS|(?:TOTAL\s+)?DESCUENTOS?|TOTAL|IMPORTE\s+TOTAL)\b/i.test(
        foldText(cell),
      ),
    );
    const labelText = labelCell > 0 ? cells.slice(labelCell).join('\t') : line;
    const folded = foldText(labelText).replace(/^[\s+*=|_-]+/, '');
    const patterns: Array<[TotalField, RegExp]> = [
      ['subtotal', /^(?:SUB\s*-?\s*TOTAL|SUBTOTAL)\b/],
      ['taxTotal', /^(?:TOTAL\s+)?ITBIS\b/],
      ['discountTotal', /^(?:TOTAL\s+)?DESCUENTOS?\b/],
      ['total', /^(?:TOTAL(?:\s+(?:A\s+)?PAGAR)?|IMPORTE\s+TOTAL)\b/],
    ];
    for (const [field, pattern] of patterns) {
      const match = folded.match(pattern);
      if (!match) continue;
      const remainder = folded
        .slice(match[0].length)
        .replace(/^\s*(?:RD\$|DOP|RD|\$)?\s*[:=-]?\s*/, '');
      // Table headings, product descriptions and subtotals by tax band are not document totals.
      if (
        /^(?:ITBIS|GRAVADO|EXENTO|BULTOS|LINEAS|ITEMS|CANTIDAD|LINEA|%|PRECIO|VALOR)\b/.test(
          remainder,
        ) ||
        remainder.startsWith('%')
      )
        return undefined;
      if (/[A-Z]/.test(remainder)) return undefined;
      return { field, remainder };
    }
    return undefined;
  };
  const numberOnly = (line: string) => {
    const value = line.replace(/(?:RD\$|DOP|\$)/gi, '').replace(/[\s:]/g, '');
    return /^\d[\d.,]*$/.test(value) ? parseLocalizedNumber(value) : undefined;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const label = classifyLabel(lines[index]);
    if (!label) continue;
    const inlineAmount = numberOnly(label.remainder);
    if (inlineAmount !== undefined) {
      result[label.field] = inlineAmount;
      result.confidence[label.field] = 'high';
      continue;
    }
    if (label.remainder) continue;
    // Some OCR layouts emit footer labels in one column followed by their values.
    const labels = [label];
    let cursor = index + 1;
    while (cursor < lines.length && labels.length < 4) {
      const next = classifyLabel(lines[cursor]);
      if (!next || next.remainder) break;
      labels.push(next);
      cursor += 1;
    }
    const values = labels.map((_, offset) => numberOnly(lines[cursor + offset] ?? ''));
    if (values.some((value) => value === undefined)) continue;
    labels.forEach((entry, offset) => {
      result[entry.field] = values[offset];
      result.confidence[entry.field] = labels.length > 1 ? 'medium' : 'high';
    });
    index = cursor + labels.length - 1;
  }

  return result;
}

function validateInvoiceCoherence(
  items: SupplierInvoiceOcrItem[],
  totals: {
    subtotal?: number;
    taxTotal?: number;
    total?: number;
  },
) {
  const warnings: string[] = [];
  const reliableItems = items.filter(
    (item) => item.total !== undefined && item.confidence.total === 'high',
  );
  if (!reliableItems.length) return warnings;

  const lineTotal = roundCurrency(reliableItems.reduce((sum, item) => sum + (item.total ?? 0), 0));
  const lineSubtotal = roundCurrency(
    reliableItems.reduce((sum, item) => sum + (item.subtotal ?? 0), 0),
  );
  const lineTax = roundCurrency(reliableItems.reduce((sum, item) => sum + (item.taxTotal ?? 0), 0));

  if (totals.total !== undefined) {
    const tolerance = Math.max(0.05, reliableItems.length * 0.02);
    if (!isClose(lineTotal, totals.total, tolerance)) {
      warnings.push(
        lineTotal > totals.total
          ? 'Las líneas OCR superan el total de la factura. Revisa cantidades, ITBIS y descuentos.'
          : 'Las líneas OCR no alcanzan el total de la factura. Puede faltar una página o una línea.',
      );
    }
  }
  if (totals.subtotal !== undefined) {
    const tolerance = Math.max(0.05, reliableItems.length * 0.02);
    if (!isClose(lineSubtotal, totals.subtotal, tolerance)) {
      warnings.push('El subtotal de las líneas OCR no coincide con el subtotal de la factura.');
    }
  }
  if (totals.taxTotal !== undefined) {
    const tolerance = Math.max(0.05, reliableItems.length * 0.02);
    if (!isClose(lineTax, totals.taxTotal, tolerance)) {
      warnings.push('El ITBIS de las líneas OCR no coincide con el ITBIS de la factura.');
    }
  }
  return warnings;
}

function findItems(lines: string[], template: SupplierTemplate | undefined) {
  const tableRanges = findTableRanges(lines);
  const items: SupplierInvoiceOcrItem[] = [];
  // A known supplier's header can be unreadable while its merchandise rows are intact.
  // Only the strict quantity/code/unit structure is eligible for this fallback.
  if (!tableRanges.length && template?.itemLayout === 'CARIBE_RB') {
    return lines
      .map((line) => parseQuantityCodeUnitLine(line))
      .filter((item): item is SupplierInvoiceOcrItem => Boolean(item));
  }
  for (const range of tableRanges) {
    for (let index = range.start; index < range.end; index += 1) {
      let row = lines[index];
      // A description or its numeric columns may wrap. Join only a visible row
      // prefix, never two independently numbered products or a footer.
      if (hasQuantityCodeUnitPrefix(row) && !hasFinancialSuffix(row)) {
        for (let next = index + 1; next < Math.min(range.end, index + 4); next += 1) {
          if (hasQuantityCodeUnitPrefix(lines[next]) || isTableBoundary(lines[next])) break;
          row += `\n${lines[next]}`;
          if (hasFinancialSuffix(row)) {
            index = next;
            break;
          }
        }
      }
      const flatRow = row.replace(/\s+/g, ' ').trim();
      const strictRow =
        template?.itemLayout === 'CARIBE_RB' || range.priceTaxValue
          ? parseQuantityCodeUnitLine(row)
          : undefined;
      const item =
        strictRow ??
        (template ? parseTemplateItemLine(flatRow, template) : undefined) ??
        parseItemLine(flatRow, template?.key);
      if (item) item.rawText = row;
      if (item) items.push(item);
    }
  }
  // Equal rows can be real repeated purchases. Geometry selects one OCR pass;
  // deleting equal descriptions here would silently lose invoice quantities.
  return items;
}

function findDeclaredItemCount(lines: string[]) {
  for (const line of lines) {
    const match = foldText(line).match(
      /^\s*(?:TOTAL\s+(?:DE\s+)?)?(?:[IL1]TEMS|ARTICULOS|LINEAS)\s*[:=]?\s*(\d{1,5})(?:\s*[^\d\w].*)?\s*$/,
    );
    if (match) return Number(match[1]);
  }
  return undefined;
}

function scoreItemReading(items: SupplierInvoiceOcrItem[], totals: { total?: number }) {
  const complete = items.filter(
    (item) => item.quantity !== undefined && item.unitCostNet !== undefined,
  );
  let score = complete.length * 5 + items.length;
  score -= items.reduce((sum, item) => sum + item.warnings.length, 0);
  if (totals.total !== undefined && items.length) {
    const sum = items.reduce((value, item) => value + (item.total ?? 0), 0);
    if (isClose(sum, totals.total, 0.1)) score += 20;
    else if (sum > totals.total + 0.1) score -= 20;
  }
  return score;
}

function isTableBoundary(line: string) {
  return /\b(?:SUB\s*-?\s*TOTAL|SUBTOTAL|TOTAL\s+(?:A\s+)?PAGAR|FIN\s+DE\s+PRODUCTOS|ULTIMA\s+LINEA)\b|^---\s*PAGINA\s+\d+\s*---$|^\s*(?:[IL1]TEMS\s*:|[*><_=])/.test(
    foldText(line),
  );
}

function findTableRanges(lines: string[]) {
  const ranges: Array<{ start: number; end: number; priceTaxValue: boolean }> = [];
  const isHeader = (line: string) =>
    /\bDESCRIP(?:CION)?\b/.test(foldText(line)) &&
    /\b(?:CANT(?:IDAD)?|PRECIO|CODIGO|ARTICULO)\b/.test(foldText(line));
  for (let index = 0; index < lines.length; index += 1) {
    const folded = foldText(lines[index]);
    if (!isHeader(lines[index])) continue;

    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = foldText(lines[cursor]);
      if (isTableBoundary(candidate) || isHeader(candidate)) {
        end = cursor;
        break;
      }
      if (/^---\s*PAGINA\s+\d+\s*---$/.test(candidate)) {
        end = cursor;
        break;
      }
    }
    if (end > index + 1)
      ranges.push({
        start: index + 1,
        end,
        priceTaxValue: /\bPRECIO\b.*\bITBIS\b.*\b(?:VALOR|IMPORTE)\b/.test(folded),
      });
  }
  return ranges;
}

const quantityCodeUnitExpression = new RegExp(
  `^\\s*(\\d+(?:[.,]\\d{1,3})?)\\s+(?:([A-Z0-9][A-Z0-9./-]{2,})\\s+(?:[—–|]+\\s*)?)?(${unitPattern})\\b\\s*`,
  'i',
);
const financialSuffixExpression = /\s+([\d][\d.,]*)\s+([\d][\d.,]*)\s+([\d][\d.,]*)\s*[|]*\s*$/;

function hasQuantityCodeUnitPrefix(line: string) {
  return quantityCodeUnitExpression.test(line);
}

function hasFinancialSuffix(line: string) {
  return financialSuffixExpression.test(line);
}

function recognizedTaxRate(subtotal: number, tax: number) {
  if (tax === 0) return 0;
  if (subtotal <= 0) return undefined;
  return [0.18, 0.16].find((rate) => isClose(roundCurrency(subtotal * rate), tax, 0.025));
}

/** Parse explicit columns without deleting size/model numbers from the description. */
function parseQuantityCodeUnitLine(line: string): SupplierInvoiceOcrItem | undefined {
  const prefix = quantityCodeUnitExpression.exec(line);
  if (!prefix) return undefined;
  const quantity = parseLocalizedNumber(prefix[1]);
  if (quantity === undefined || !isPlausibleQuantity(quantity)) return undefined;
  const tail = line.slice(prefix[0].length);
  const money = financialSuffixExpression.exec(tail);
  const description = (
    money ? tail.slice(0, money.index) : tail.replace(/(?:\s+\d[\d.,]*[.,]\d{2}){1,2}\s*$/, '')
  )
    .replace(/^[“”"|]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (description.length < 3 || !/[A-ZÁÉÍÓÚÑ]/i.test(description)) return undefined;
  const item: SupplierInvoiceOcrItem = {
    rawText: line,
    code: prefix[2]?.toUpperCase(),
    unit: prefix[3].toUpperCase(),
    description,
    quantity,
    confidence: {
      ...(prefix[2] ? { code: 'medium' as const } : {}),
      description: 'medium',
      quantity: 'high',
    },
    warnings: [],
  };
  const [price, tax, value] = money ? money.slice(1, 4).map(parseLocalizedNumber) : [];
  if (price === undefined || tax === undefined || value === undefined) {
    item.warnings.push(
      'Se leyó el producto, pero faltan sus importes. Completa costo e ITBIS manualmente.',
    );
    return item;
  }
  item.total = value;
  item.taxTotal = tax;
  if (price === 0 || value === 0) {
    item.confidence.total = 'low';
    item.warnings.push(
      'Se leyó un importe cero. Confirma el costo de este producto antes de aplicarlo.',
    );
    return item;
  }
  const multiplicationMatches = isClose(
    roundCurrency(quantity * price),
    value,
    Math.max(0.025, quantity * 0.005),
  );
  const includedSubtotal = roundCurrency(value - tax);
  const includedRate = recognizedTaxRate(includedSubtotal, tax);
  const excludedRate = recognizedTaxRate(value, tax);
  if (!multiplicationMatches || (includedRate === undefined && excludedRate === undefined)) {
    item.confidence.total = 'low';
    item.warnings.push(
      !multiplicationMatches
        ? 'La cantidad por el precio no coincide con el valor leído. Revisa los tres importes de esta línea.'
        : 'No se pudo confirmar si el precio incluye ITBIS. Revisa el costo neto y el impuesto de esta línea.',
    );
    return item;
  }
  const included = includedRate !== undefined;
  item.subtotal = included ? includedSubtotal : value;
  item.total = included ? value : roundCurrency(value + tax);
  item.taxRate = included ? includedRate : excludedRate;
  item.unitCostNet = roundUnitCost(item.subtotal / quantity);
  item.confidence.unitCostNet = 'high';
  item.confidence.taxRate = 'high';
  item.confidence.total = 'high';
  return item;
}

type TemplateQuantity = {
  quantity: number;
  unit?: string;
};

type TemplateItemFinancials = {
  unitCostNet: number;
  subtotal: number;
  discountTotal?: number;
  taxTotal?: number;
  taxRate?: number;
  total: number;
  warnings: string[];
};

/**
 * Las seis facturas de referencia no comparten la misma semántica de
 * columnas. Este parser solo se activa dentro de una tabla detectada y, si no
 * puede demostrar una fila coherente, devuelve `undefined` para dejar que el
 * fallback genérico (o la revisión manual) tome el control.
 */
function parseTemplateItemLine(
  line: string,
  template: SupplierTemplate,
): SupplierInvoiceOcrItem | undefined {
  const folded = foldText(line);
  if (
    line.length < 8 ||
    /\b(?:TOTAL|SUBTOTAL|ITBIS|DESCUENTO|PAGADO|DESPACHADO|FIRMA|OBSERVACION)\b/.test(folded)
  ) {
    return undefined;
  }

  const quantity = findTemplateQuantity(line, template.itemLayout);
  const descriptionStart = findLikelyDescriptionStart(line);
  if (!quantity || descriptionStart < 0) return undefined;

  const financials = inferTemplateItemFinancials(
    line,
    template.itemLayout,
    quantity.quantity,
    descriptionStart,
  );
  if (!financials) return undefined;

  const description = inferDescription(
    line,
    extractAmounts(line),
    quantity.quantity,
    template.itemLayout,
  );
  if (!description || description.length < 3) return undefined;
  const code = inferCode(line, description, template.key);
  const confidence: SupplierInvoiceOcrItem['confidence'] = {
    description: 'medium',
    quantity: 'high',
    unitCostNet: 'high',
    total: financials.warnings.length ? 'medium' : 'high',
  };
  if (code) confidence.code = 'medium';
  if (financials.discountTotal !== undefined) confidence.discountTotal = 'high';
  if (financials.taxRate !== undefined) confidence.taxRate = 'high';

  return {
    rawText: line,
    code,
    description,
    unit: quantity.unit ?? inferUnit(line),
    quantity: quantity.quantity,
    unitCostNet: financials.unitCostNet,
    discountTotal: financials.discountTotal,
    taxRate: financials.taxRate,
    taxTotal: financials.taxTotal,
    subtotal: financials.subtotal,
    total: financials.total,
    confidence,
    warnings: financials.warnings,
  };
}

function findTemplateQuantity(
  line: string,
  layout: SupplierItemLayout,
): TemplateQuantity | undefined {
  const withUnitAfterQuantity = new RegExp(
    `\\b(\\d+(?:[.,]\\d+)?)\\s+(${unitPattern})\\s+(?=[A-ZÁÉÍÓÚÑ]{3,})`,
    'gi',
  );

  if (layout === 'CANO') {
    // CANO imprime primero EMP/U-E y luego CANT/U-M. Se elige la última
    // pareja cantidad/unidad antes de la descripción para no tomar EMP como
    // cantidad.
    const matches = [...line.matchAll(withUnitAfterQuantity)];
    const match = matches.at(-1);
    if (match?.[1]) {
      const quantity = parseLocalizedNumber(match[1]);
      if (quantity !== undefined && isPlausibleQuantity(quantity)) {
        return { quantity: roundQuantity(quantity), unit: match[2]?.toUpperCase() };
      }
    }
  }

  if (layout === 'BELLON') {
    const match = line.match(
      new RegExp(
        `\\b[A-Z0-9-]{3,}\\s+(${unitPattern})\\s+(\\d+(?:[.,]\\d+)?)\\s+(?=[A-ZÁÉÍÓÚÑ]{2,})`,
        'i',
      ),
    );
    const quantity = match?.[2] ? parseLocalizedNumber(match[2]) : undefined;
    if (quantity !== undefined && isPlausibleQuantity(quantity)) {
      return { quantity: roundQuantity(quantity), unit: match?.[1]?.toUpperCase() };
    }
  }

  if (layout === 'CARIBE_RB') {
    const match = line.match(
      new RegExp(
        `^\\s*(\\d+(?:[.,]\\d+)?)\\s+[A-Z0-9-]{4,}\\s+(${unitPattern})\\s+(?=[A-ZÁÉÍÓÚÑ]{2,})`,
        'i',
      ),
    );
    const quantity = match?.[1] ? parseLocalizedNumber(match[1]) : undefined;
    if (quantity !== undefined && isPlausibleQuantity(quantity)) {
      return { quantity: roundQuantity(quantity), unit: match?.[2]?.toUpperCase() };
    }
  }

  if (layout === 'WURTH') {
    // El código de Würth puede tener un segundo segmento (p. ej. 058411 220).
    const match = line.match(
      /^\s*\d{5,}(?:\s+\d{1,4})?\s+(\d+(?:[.,]\d+)?)\s+(?=[A-ZÁÉÍÓÚÑ]{3,})/i,
    );
    const quantity = match?.[1] ? parseLocalizedNumber(match[1]) : undefined;
    if (quantity !== undefined && isPlausibleQuantity(quantity)) {
      return { quantity: roundQuantity(quantity), unit: inferUnit(line) };
    }
  }

  if (layout === 'PROMACO' || layout === 'YANWILS') {
    const match = line.match(/^\s*(\d+(?:[.,]\d+)?)\s+(?=[A-ZÁÉÍÓÚÑ]{2,})/i);
    const quantity = match?.[1] ? parseLocalizedNumber(match[1]) : undefined;
    if (quantity !== undefined && isPlausibleQuantity(quantity)) {
      return { quantity: roundQuantity(quantity), unit: inferUnit(line) };
    }
  }

  return undefined;
}

function inferTemplateItemFinancials(
  line: string,
  layout: SupplierItemLayout,
  quantity: number,
  descriptionStart: number,
): TemplateItemFinancials | undefined {
  const moneyText = line.replace(/\b\d+(?:[.,]\d+)?\s*%/g, (value) => ' '.repeat(value.length));
  const allValues = extractSignedAmounts(moneyText)
    .filter((token) => token.index > descriptionStart)
    .map((token) => token.value);
  const columnCount =
    layout === 'YANWILS' || (layout === 'WURTH' && allValues.some((value) => value < 0)) ? 4 : 3;
  const values = allValues.slice(-columnCount);
  const positive = values.filter((value) => value >= 0);
  const warnings: string[] = [];

  const build = (
    unitCostNet: number,
    subtotal: number,
    taxTotal: number | undefined,
    total: number,
    discountTotal?: number,
  ): TemplateItemFinancials | undefined => {
    if (unitCostNet <= 0 || subtotal < 0 || total < 0) return undefined;
    const normalizedTax = taxTotal !== undefined ? roundCurrency(taxTotal) : undefined;
    const normalizedTotal = roundCurrency(total);
    const expectedTotal = roundCurrency(subtotal + (normalizedTax ?? 0));
    const tolerance = Math.max(0.12, normalizedTotal * 0.003);
    if (!isClose(expectedTotal, normalizedTotal, tolerance)) {
      warnings.push('El total de esta línea no coincide con su subtotal e ITBIS.');
    }
    const gross = roundCurrency(quantity * unitCostNet);
    if (discountTotal === undefined && !isClose(gross, subtotal, Math.max(0.12, gross * 0.004))) {
      warnings.push('El precio por cantidad no coincide con el subtotal de esta línea.');
    }
    const taxRate =
      normalizedTax !== undefined ? recognizedTaxRate(subtotal, normalizedTax) : undefined;
    if (normalizedTax !== undefined && taxRate === undefined) {
      warnings.push(
        'El ITBIS leído no corresponde a una tasa verificable. Confirma el impuesto de esta línea.',
      );
    }
    return {
      unitCostNet: roundUnitCost(unitCostNet),
      subtotal: roundCurrency(subtotal),
      discountTotal:
        discountTotal !== undefined ? roundCurrency(Math.abs(discountTotal)) : undefined,
      taxTotal: normalizedTax,
      taxRate,
      total: normalizedTotal,
      warnings,
    };
  };

  // Bellón y PROMACO imprimen el ITBIS dentro del importe de la línea: el
  // precio por cantidad cuadra con "Importe/Valor", mientras que el ITBIS es
  // la porción incluida. Para guardar el costo neto hay que descontarlo y no
  // volver a sumarlo al total.
  const buildTaxIncluded = (
    unitCostWithTax: number,
    taxTotal: number,
    total: number,
  ): TemplateItemFinancials | undefined => {
    const subtotal = roundCurrency(total - taxTotal);
    const result = build(roundUnitCost(subtotal / quantity), subtotal, taxTotal, total);
    if (
      result &&
      !isClose(
        roundCurrency(quantity * unitCostWithTax),
        roundCurrency(total),
        Math.max(0.12, total * 0.004),
      )
    ) {
      result.warnings.push('El precio con ITBIS incluido no coincide con el importe de la línea.');
    }
    return result;
  };

  if (layout === 'CANO' && positive.length >= 3) {
    const [price, subtotal, tax] = positive;
    const gross = roundCurrency(quantity * price);
    const percent = line.match(/\b(\d{1,2}(?:[.,]\d+)?)\s*%/)?.[1];
    const discountRate = percent ? parseLocalizedNumber(percent) : undefined;
    const discount = discountRate !== undefined ? roundCurrency(gross - subtotal) : undefined;
    return build(price, subtotal, tax, subtotal + tax, discount);
  }

  if (layout === 'BELLON' && positive.length >= 3) {
    const [priceWithTax, total, tax] = positive;
    return buildTaxIncluded(priceWithTax, tax, total);
  }

  if (layout === 'PROMACO' && positive.length >= 3) {
    const [priceWithTax, tax, total] = positive;
    return buildTaxIncluded(priceWithTax, tax, total);
  }

  if (layout === 'YANWILS' && positive.length >= 4) {
    const [price, subtotal, tax, total] = positive;
    return build(price, subtotal, tax, total);
  }

  if (layout === 'CARIBE_RB' && positive.length >= 3) {
    const [price, tax, value] = positive.slice(-3);
    if (recognizedTaxRate(roundCurrency(value - tax), tax) !== undefined) {
      return buildTaxIncluded(price, tax, value);
    }
    if (recognizedTaxRate(value, tax) !== undefined) return build(price, value, tax, value + tax);
    return undefined;
  }

  if (layout === 'WURTH') {
    const price = positive[0];
    if (price === undefined) return undefined;
    const discount = values.find((value) => value < 0);
    const valuesAfterPrice = values.slice(values.indexOf(price) + 1).filter((value) => value >= 0);
    const tax = valuesAfterPrice[0];
    const total = valuesAfterPrice[1];
    if (tax === undefined || total === undefined) return undefined;
    const subtotal = roundCurrency(quantity * price - Math.abs(discount ?? 0));
    return build(
      price,
      subtotal,
      tax,
      total,
      discount === undefined ? undefined : Math.abs(discount),
    );
  }

  return undefined;
}

function parseItemLine(
  line: string,
  templateKey: string | undefined,
): SupplierInvoiceOcrItem | undefined {
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
  const verifiedTaxRate =
    inferred.taxTotal !== undefined
      ? recognizedTaxRate(inferred.subtotal, inferred.taxTotal)
      : undefined;
  if (verifiedTaxRate !== undefined) confidence.taxRate = 'medium';
  if (!inferred.explicitQuantity) {
    warnings.push('La cantidad se infirió por los importes; compárala con la factura.');
  }
  if (verifiedTaxRate === undefined) {
    warnings.push(
      'El ITBIS de esta línea no pudo validarse. Confirma si el precio incluye impuestos.',
    );
    confidence.unitCostNet = 'low';
  }

  return {
    rawText: line,
    code,
    description,
    unit,
    quantity: inferred.quantity,
    unitCostNet: inferred.unitCostNet,
    discountTotal: inferred.discountTotal,
    taxRate: verifiedTaxRate,
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
  const descriptionStart = findLikelyDescriptionStart(line);
  const numericValues = extractNumericValues(
    descriptionStart >= 0 ? line.slice(0, descriptionStart) : '',
  );
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
  const ignoredWords = new Set(unitPattern.split('|'));
  for (const match of line.matchAll(/\b[A-ZÁÉÍÓÚÑ]{3,}\b/gi)) {
    if (!ignoredWords.has(foldText(match[0])) && match.index !== undefined) return match.index;
  }
  return -1;
}

function inferDescription(
  line: string,
  amounts: AmountToken[],
  quantity: number,
  layout?: SupplierItemLayout,
) {
  const start = findLikelyDescriptionStart(line);
  // Preserve dimensions, decimals and model numbers instead of removing all numbers.
  const valueCount =
    layout === 'YANWILS'
      ? 4
      : layout === 'WURTH' && /\s-\d/.test(line)
        ? 4
        : layout
          ? 3
          : undefined;
  const suffix = line.match(
    valueCount
      ? new RegExp(`(?:\\s+-?\\d[\\d.,]*(?:\\s*%)?){${valueCount}}\\s*$`)
      : /\s+-?\d[\d.,]*[.,]\d{2}(?:\s+-?\d[\d.,]*[.,]\d{2}){1,}\s*$/,
  );
  if (start >= 0 && suffix?.index !== undefined && suffix.index > start) {
    return line.slice(start, suffix.index).replace(/[|_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  let value = line;
  for (const amount of [...amounts].reverse()) {
    const token = line.slice(amount.index).match(amountExpression)?.[0];
    if (token) {
      const absoluteIndex = value.lastIndexOf(token);
      if (absoluteIndex >= 0)
        value = `${value.slice(0, absoluteIndex)} ${value.slice(absoluteIndex + token.length)}`;
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
    .replace(/\s+\d{1,4}$/g, '')
    .replace(/\s+-\s*$/, '');
  return value.replace(/\s{2,}/g, ' ').trim();
}

function inferCode(line: string, description: string, templateKey: string | undefined) {
  const numericCodeBeforeUnit = line.match(
    new RegExp(`\\b(\\d{2,8})\\s+(?:${unitPattern})\\b`, 'i'),
  )?.[1];
  if (numericCodeBeforeUnit) return numericCodeBeforeUnit;
  const alphanumeric = [...line.matchAll(/\b(?:[A-Z]{1,5}\d{2,}[A-Z0-9-]*|\d{5,})\b/gi)].at(
    -1,
  )?.[0];
  if (!alphanumeric) return undefined;
  if (foldText(description).includes(foldText(alphanumeric))) return undefined;
  // Los números de RNC/documento no pertenecen a una fila de producto porque
  // las líneas se toman únicamente dentro de la tabla.
  if (/^\d{9,11}$/.test(alphanumeric)) return undefined;
  if (templateKey === 'CANO' && /^[A-Z]{2}\d+$/.test(alphanumeric))
    return alphanumeric.toUpperCase();
  return alphanumeric.toUpperCase();
}

function inferUnit(line: string) {
  return line.match(new RegExp(`\\b(${unitPattern})\\b`, 'i'))?.[1]?.toUpperCase();
}

function extractAmounts(line: string): AmountToken[] {
  const values: AmountToken[] = [];
  for (const match of line.matchAll(amountExpression)) {
    const value = parseLocalizedNumber(match[0]);
    if (value !== undefined && match.index !== undefined)
      values.push({ value, index: match.index });
  }
  return values;
}

function extractSignedAmounts(line: string): AmountToken[] {
  const values: AmountToken[] = [];
  const expression = /(-?)\s*(?:RD\$?\s*)?(\d{1,3}(?:[.,]\d{3})+[.,]\d{2}|\d+(?:[.,]\d{2}))/gi;
  for (const match of line.matchAll(expression)) {
    const parsed = parseLocalizedNumber(match[2]);
    if (parsed === undefined || match.index === undefined) continue;
    values.push({ value: match[1] === '-' ? -parsed : parsed, index: match.index });
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
    normalized =
      lastDot > lastComma
        ? compact.replaceAll(',', '')
        : compact.replaceAll('.', '').replace(',', '.');
  } else if (lastComma >= 0) {
    normalized =
      compact.split(',').at(-1)?.length === 2
        ? compact.replace(',', '.')
        : compact.replaceAll(',', '');
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

function unique(values: string[]) {
  return [...new Set(values)];
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundUnitCost(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
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
  return (
    Number.isFinite(value) &&
    value > 0 &&
    value <= 1_000_000 &&
    Math.abs(value * 1_000 - Math.round(value * 1_000)) < 0.02
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
