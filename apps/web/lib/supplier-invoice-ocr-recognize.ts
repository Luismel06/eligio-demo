import type { PSM, Worker } from 'tesseract.js';
import { extractSupplierInvoiceOcr, type SupplierInvoiceOcrResult } from './supplier-invoice-ocr';
import {
  createSupplierInvoiceOcrRegions,
  preprocessSupplierInvoiceImage,
  type SupplierInvoiceImageQuality,
} from './supplier-invoice-ocr-image';
import {
  reconstructSupplierInvoiceOcrLines,
  replaceSupplierInvoiceOcrRegion,
  type SupplierInvoiceOcrLayoutLine,
} from './supplier-invoice-ocr-spatial';
import { readSupplierInvoiceQr } from './supplier-invoice-qr';

export type SupplierInvoiceOcrProgress = {
  status: string;
  value: number;
  page: number;
  totalPages: number;
};

type Reading = { text: string; lines: SupplierInvoiceOcrLayoutLine[] };
type RecognitionOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: SupplierInvoiceOcrProgress) => void;
};

/**
 * One bounded, cancellable local worker for the entire capture. Page/table
 * candidates are compared as a whole; alternate passes never append duplicate
 * invoice lines. Only text leaves this function, never the captured images.
 */
export async function recognizeSupplierInvoicePages(
  pages: Array<{ image: Blob; quality?: SupplierInvoiceImageQuality }>,
  { signal, onProgress }: RecognitionOptions = {},
): Promise<SupplierInvoiceOcrResult> {
  if (!pages.length || pages.length > 10) throw new Error('Selecciona entre 1 y 10 páginas.');
  let worker: Worker | null = null;
  let page = 1;
  let phase = { start: 0, span: 0.25, status: 'Preparando OCR local' };
  const checkAbort = () => {
    if (signal?.aborted) throw new DOMException('Lectura cancelada.', 'AbortError');
  };
  const emit = (value = phase.start, status = phase.status) => {
    if (!signal?.aborted) onProgress?.({ status, value, page, totalPages: pages.length });
  };
  const terminate = () => {
    const currentWorker = worker;
    worker = null;
    if (currentWorker) void currentWorker.terminate().catch(() => undefined);
  };
  signal?.addEventListener('abort', terminate, { once: true });

  try {
    checkAbort();
    emit();
    const { createWorker, OEM, PSM } = await interruptible(import('tesseract.js'), signal);
    worker = await interruptible(
      createWorker(
        'spa+eng',
        OEM.LSTM_ONLY,
        {
          logger: (message) => {
            const progress = Number.isFinite(message.progress) ? message.progress : 0;
            emit(
              phase.start + (message.status === 'recognizing text' ? progress * phase.span : 0),
              message.status === 'recognizing text' ? phase.status : message.status,
            );
          },
        },
        {
          // Hardware codes, abbreviations and fractions are not dictionary words.
          load_system_dawg: '0',
          load_freq_dawg: '0',
        },
      ).then((created) => {
        if (signal?.aborted) {
          void created.terminate().catch(() => undefined);
          throw new DOMException('Lectura cancelada.', 'AbortError');
        }
        return created;
      }),
      signal,
    );

    const recognize = async (image: Blob, mode: PSM): Promise<Reading> => {
      checkAbort();
      if (!worker) throw new DOMException('Lectura cancelada.', 'AbortError');
      await interruptible(
        worker.setParameters({
          tessedit_pageseg_mode: mode,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
          // The default Leptonica threshold preserves small characters on the
          // prepared grayscale image. Forced Sauvola can erase shadowed cells.
          thresholding_method: 0,
        }),
        signal,
      );
      const { data } = await interruptible(
        worker.recognize(image, {}, { text: true, blocks: true }),
        signal,
      );
      const lines = reconstructSupplierInvoiceOcrLines(data);
      if (mode === PSM.SINGLE_LINE && lines.length > 1) {
        // A narrow, explicitly single-line crop may retain a sloped baseline.
        // Keep its recognized text together (e.g. "CRÉDITO 30 DÍAS").
        const words = lines.flatMap((line) => line.words).sort((a, b) => a.bbox.x0 - b.bbox.x0);
        return {
          text: data.text.trim(),
          lines: [
            {
              text: data.text.replace(/\s+/g, ' ').trim(),
              confidence:
                words.reduce((sum, word) => sum + word.confidence, 0) / Math.max(1, words.length),
              bbox: {
                x0: Math.min(...words.map((word) => word.bbox.x0)),
                y0: Math.min(...words.map((word) => word.bbox.y0)),
                x1: Math.max(...words.map((word) => word.bbox.x1)),
                y1: Math.max(...words.map((word) => word.bbox.y1)),
              },
              words,
            },
          ],
        };
      }
      return { text: data.text.trim(), lines };
    };

    const selectedPages: string[] = [];
    const qrValues: string[] = [];
    for (let index = 0; index < pages.length; index += 1) {
      page = index + 1;
      phase = { start: 0, span: 0.25, status: 'Preparando imagen y leyendo encabezado' };
      emit();
      const prepared = await interruptible(
        preprocessSupplierInvoiceImage(pages[index].image),
        signal,
      );
      const qr = await interruptible(readSupplierInvoiceQr(pages[index].image), signal);
      if (qr) qrValues.push(qr);
      const general = await recognize(prepared, PSM.SPARSE_TEXT);
      let selected = general;
      const regions = await interruptible(
        createSupplierInvoiceOcrRegions(prepared, general.lines),
        signal,
      );

      for (const [regionIndex, region] of regions.entries()) {
        checkAbort();
        phase = {
          start: 0.25 + regionIndex * (0.5 / regions.length),
          span: 0.5 / regions.length,
          status:
            region.id === 'table'
              ? 'Leyendo cantidades, productos y precios'
              : 'Comprobando encabezado y totales',
        };
        emit();
        const regional = await recognize(
          region.image,
          region.id === 'metadata'
            ? PSM.SINGLE_LINE
            : region.id === 'header'
              ? PSM.SPARSE_TEXT
              : PSM.SINGLE_BLOCK,
        );
        const lines = replaceSupplierInvoiceOcrRegion(
          selected.lines,
          regional.lines,
          region.rectangle,
        );
        const candidate = { lines, text: lines.map((line) => line.text).join('\n') };
        const candidateScore = scoreSupplierInvoiceOcrReading(parseReading(candidate));
        const selectedScore = scoreSupplierInvoiceOcrReading(parseReading(selected));
        const oldRegionLines = selected.lines.filter((line) => {
          const { left, top, width, height } = region.rectangle;
          return (
            line.bbox.x1 > left &&
            line.bbox.x0 < left + width &&
            line.bbox.y1 > top &&
            line.bbox.y0 < top + height
          );
        });
        const meanConfidence = (entries: Reading['lines']) =>
          entries.reduce((sum, line) => sum + line.confidence, 0) / Math.max(1, entries.length);
        if (
          candidateScore > selectedScore ||
          (region.id === 'metadata' &&
            candidateScore === selectedScore &&
            meanConfidence(regional.lines) > meanConfidence(oldRegionLines) + 3)
        ) {
          selected = candidate;
        }
        // A second segmentation is earned by missing/inconsistent evidence,
        // never by just having a shorter textual output.
        if (region.id === 'table' && needsAnotherReading(parseReading(selected))) {
          phase = { start: 0.53, span: 0.14, status: 'Contrastando las columnas de productos' };
          const sparse = await recognize(region.image, PSM.SPARSE_TEXT);
          const sparseLines = replaceSupplierInvoiceOcrRegion(
            selected.lines,
            sparse.lines,
            region.rectangle,
          );
          const sparseCandidate = {
            lines: sparseLines,
            text: sparseLines.map((line) => line.text).join('\n'),
          };
          if (
            scoreSupplierInvoiceOcrReading(parseReading(sparseCandidate)) >
            scoreSupplierInvoiceOcrReading(parseReading(selected))
          ) {
            selected = sparseCandidate;
          }
        }
      }

      if (needsAnotherReading(parseReading(selected))) {
        phase = { start: 0.81, span: 0.17, status: 'Revisando detalle con los tonos originales' };
        emit();
        const originalTones = await interruptible(
          preprocessSupplierInvoiceImage(pages[index].image, { enhance: false }),
          signal,
        );
        const alternate = await recognize(originalTones, PSM.SINGLE_BLOCK);
        if (
          scoreSupplierInvoiceOcrReading(parseReading(alternate)) >
          scoreSupplierInvoiceOcrReading(parseReading(selected))
        ) {
          selected = alternate;
        }
      }

      // Use one physical reading per page. Repeated rows on different pages
      // remain distinct; alternate OCR attempts never become extra products.
      const canonical = selected.lines.length
        ? selected.lines.map((line) => line.text).join('\n')
        : selected.text;
      if (canonical.trim()) selectedPages.push(`--- PÁGINA ${page} ---\n${canonical.trim()}`);
      emit(1, 'Página comprobada');
    }

    checkAbort();
    const rawText = selectedPages.join('\n\n');
    if (!rawText.trim()) {
      throw new Error(
        'No se pudo leer texto. Prueba con mejor iluminación o usa el ingreso manual.',
      );
    }
    return {
      ...extractSupplierInvoiceOcr(rawText, { qrValues, layoutLines: rawText.split('\n') }),
      pageCount: pages.length,
    };
  } finally {
    signal?.removeEventListener('abort', terminate);
    const currentWorker = worker;
    worker = null;
    if (currentWorker) await currentWorker.terminate().catch(() => undefined);
  }
}

function parseReading(reading: Reading) {
  return extractSupplierInvoiceOcr(reading.text, {
    layoutLines: reading.lines.length ? reading.lines.map((line) => line.text) : undefined,
  });
}

/** Shared with regression tests; longer OCR text is not evidence of accuracy. */
export function scoreSupplierInvoiceOcrReading(result: SupplierInvoiceOcrResult): number {
  let score = 0;
  for (const field of [
    'supplierDocument',
    'ncf',
    'invoiceNumber',
    'issueDate',
    'paymentDueDate',
    'ncfValidUntil',
  ] as const) {
    if (result[field]) score += 2;
  }
  const paymentTerm = result.paymentCondition?.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (
    paymentTerm &&
    /^(?:VENTA\s+(?:A|AL)\s+)?(?:CREDITO(?:\s+\d{1,3}\s+DIAS?)?|CONTADO)$/i.test(paymentTerm)
  )
    score += 2;
  let net = 0;
  let completeRows = 0;
  for (const item of result.items) {
    if (item.description) score += 2;
    if (item.code) score += 1;
    if (
      item.quantity !== undefined &&
      item.quantity > 0 &&
      item.unitCostNet !== undefined &&
      item.unitCostNet >= 0
    ) {
      completeRows += 1;
      score += 6;
      net += item.subtotal ?? item.quantity * item.unitCostNet - (item.discountTotal ?? 0);
    }
    score -= Math.min(4, item.warnings.length);
  }
  if (result.expectedItemCount !== undefined) {
    score +=
      result.items.length === result.expectedItemCount
        ? 90
        : -Math.min(180, Math.abs(result.items.length - result.expectedItemCount) * 25);
  }
  if (result.subtotal !== undefined) score += 5;
  if (result.taxTotal !== undefined) score += 5;
  if (result.total !== undefined) score += 5;
  if (
    result.subtotal !== undefined &&
    result.taxTotal !== undefined &&
    result.total !== undefined
  ) {
    // Item/subtotal bases are already net of line discounts.
    const discrepancy = Math.abs(result.subtotal + result.taxTotal - result.total);
    score += discrepancy <= 0.08 ? 35 : -30;
  }
  if (result.subtotal !== undefined && completeRows === result.items.length && completeRows > 0) {
    const discrepancy = Math.abs(net - result.subtotal);
    score +=
      discrepancy <= Math.max(0.1, completeRows * 0.015)
        ? 80
        : -Math.min(70, (discrepancy / Math.max(1, result.subtotal)) * 100);
  }
  return score;
}

function needsAnotherReading(result: SupplierInvoiceOcrResult) {
  if (!result.items.length || result.total === undefined) return true;
  if (result.expectedItemCount !== undefined && result.expectedItemCount !== result.items.length)
    return true;
  if (
    result.items.some(
      (item) =>
        item.quantity === undefined || item.unitCostNet === undefined || item.warnings.length > 0,
    )
  )
    return true;
  if (result.subtotal !== undefined) {
    const net = result.items.reduce(
      (sum, item) =>
        sum +
        (item.subtotal ??
          (item.quantity ?? 0) * (item.unitCostNet ?? 0) - (item.discountTotal ?? 0)),
      0,
    );
    if (Math.abs(net - result.subtotal) > Math.max(0.1, result.items.length * 0.015)) return true;
  }
  return false;
}

function interruptible<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(new DOMException('Lectura cancelada.', 'AbortError'));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Lectura cancelada.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
