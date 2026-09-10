/** Browser-independent reconstruction of printed rows from Tesseract word boxes. */
export type SupplierInvoiceOcrBox = { x0: number; y0: number; x1: number; y1: number };

export type SupplierInvoiceOcrWord = {
  text: string;
  confidence: number;
  bbox: SupplierInvoiceOcrBox;
};

type OcrLineInput = {
  words?: SupplierInvoiceOcrWord[];
  baseline?: SupplierInvoiceOcrBox;
};

export type SupplierInvoiceOcrGeometryInput = {
  text: string;
  blocks?: Array<{ paragraphs: Array<{ lines: OcrLineInput[] }> }> | null;
};

export type SupplierInvoiceOcrLayoutLine = {
  text: string;
  confidence: number;
  bbox: SupplierInvoiceOcrBox;
  words: SupplierInvoiceOcrWord[];
};

export type SupplierInvoiceOcrRectangle = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const center = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[center] : (sorted[center - 1] + sorted[center]) / 2;
};

/**
 * Sparse OCR emits independent blocks in reading order, often one complete
 * column at a time. Grouping by the physical baseline recovers the associations
 * between description, quantity and amounts without inventing missing text.
 */
export function reconstructSupplierInvoiceOcrLines(
  data: SupplierInvoiceOcrGeometryInput,
): SupplierInvoiceOcrLayoutLine[] {
  const sourceLines = (data.blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines),
  );
  const words = sourceLines
    .flatMap((line) => line.words ?? [])
    .filter((word) => {
      const { x0, x1, y0, y1 } = word.bbox;
      return word.text.trim() && [x0, x1, y0, y1].every(Number.isFinite) && x1 > x0 && y1 > y0;
    });
  if (!words.length) return [];

  const typicalHeight = median(words.map((word) => word.bbox.y1 - word.bbox.y0));
  const slopes = sourceLines.flatMap((line) => {
    const baseline = line.baseline;
    if (!baseline || baseline.x1 - baseline.x0 < typicalHeight * 12) return [];
    const slope = (baseline.y1 - baseline.y0) / (baseline.x1 - baseline.x0);
    return Number.isFinite(slope) && Math.abs(slope) < 0.12 ? [slope] : [];
  });
  const slope = slopes.length ? median(slopes) : 0;
  const centerY = (word: SupplierInvoiceOcrWord) =>
    (word.bbox.y0 + word.bbox.y1) / 2 - (slope * (word.bbox.x0 + word.bbox.x1)) / 2;
  const sorted = [...words].sort((a, b) => centerY(a) - centerY(b) || a.bbox.x0 - b.bbox.x0);
  const grouped: SupplierInvoiceOcrWord[][] = [];

  for (const word of sorted) {
    let nearest: SupplierInvoiceOcrWord[] | undefined;
    let distance = Infinity;
    for (let index = grouped.length - 1; index >= Math.max(0, grouped.length - 4); index -= 1) {
      const row = grouped[index];
      const rowCenter = median(row.map(centerY));
      const difference = Math.abs(centerY(word) - rowCenter);
      // Do not let a tall stamp or oversized company logo join adjacent rows.
      const rowHeight = median(row.map((entry) => entry.bbox.y1 - entry.bbox.y0));
      const tolerance = Math.max(2, Math.min(typicalHeight * 1.35, rowHeight) * 0.57);
      if (difference <= tolerance && difference < distance) {
        nearest = row;
        distance = difference;
      }
    }
    if (nearest) nearest.push(word);
    else grouped.push([word]);
  }

  return grouped
    .map((row) => {
      const ordered = row.sort((a, b) => a.bbox.x0 - b.bbox.x0);
      const rowHeight = median(ordered.map((word) => word.bbox.y1 - word.bbox.y0));
      const text = ordered.reduce((value, word, index) => {
        if (!index) return word.text.trim();
        const gap = word.bbox.x0 - ordered[index - 1].bbox.x1;
        return `${value}${gap > rowHeight * 1.15 ? '\t' : ' '}${word.text.trim()}`;
      }, '');
      return {
        text,
        confidence: ordered.reduce((sum, word) => sum + word.confidence, 0) / ordered.length,
        bbox: {
          x0: Math.min(...ordered.map((word) => word.bbox.x0)),
          y0: Math.min(...ordered.map((word) => word.bbox.y0)),
          x1: Math.max(...ordered.map((word) => word.bbox.x1)),
          y1: Math.max(...ordered.map((word) => word.bbox.y1)),
        },
        words: ordered,
      };
    })
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
}

/** Locate printed column headings; percentages are only a generous fallback. */
export function locateSupplierInvoiceTable(
  lines: SupplierInvoiceOcrLayoutLine[],
  width: number,
  height: number,
): SupplierInvoiceOcrRectangle {
  const headerIndex = lines.findIndex((line) => {
    const text = fold(line.text);
    const headings = [
      /\bCANT(?:IDAD)?\b|\bANT\b/,
      /\bCOD(?:IGO)?\b|\bREFERENCIA\b/,
      /\bUNID(?:AD)?\b|\bUND\b/,
      /\bDESCRIPCION\b|\bPRODUCTO\b|\bARTICULO\b|\bDETALLE\b/,
      /\bPRECIO\b|\bCOSTO\b/,
      /\bI?[1I]TBIS\b|\bIMPUESTO\b/,
      /\bVALOR\b|\bIMPORTE\b|\bTOTAL\b/,
    ].filter((expression) => expression.test(text)).length;
    return headings >= 4 || (headings >= 3 && /\bDESCRIPCION\b|\bARTICULO\b/.test(text));
  });
  if (headerIndex < 0) return { left: 0, top: 0, width, height };

  const header = lines[headerIndex];
  const padding = Math.max(10, (header.bbox.y1 - header.bbox.y0) * 1.2);
  // A photograph may include a desk, fingers or a neighboring document.
  // Constrain columns using printed headings, never those background marks.
  const headingWords = header.words.filter((word) =>
    /^(?:CANT(?:IDAD)?|ANT|COD(?:IGO)?|REFERENCIA|UNID(?:AD)?|UND|DESCRIPCION|PRODUCTO|ARTICULO|DETALLE|PRECIO|COSTO|I?[1I]TBIS|IMPUESTO|VALOR|IMPORTE|TOTAL)[.:]?$/i.test(
      fold(word.text),
    ),
  );
  const horizontalPadding = Math.max(50, padding * 3);
  const left =
    headingWords.length >= 4
      ? Math.max(
          0,
          Math.floor(Math.min(...headingWords.map((word) => word.bbox.x0)) - horizontalPadding),
        )
      : 0;
  const right =
    headingWords.length >= 4
      ? Math.min(
          width,
          Math.ceil(Math.max(...headingWords.map((word) => word.bbox.x1)) + horizontalPadding),
        )
      : width;
  const footer = lines
    .slice(headerIndex + 1)
    .find((line) =>
      /^(?:SUB\s*[- ]?\s*TOTAL\b|(?:\+\s*)?ITBIS\s*(?:DOP|RD\$|:)|TOTAL\s*(?:DOP|RD\$|A PAGAR|GENERAL|:)|[\s*]*ULTIMA LINEA|[IL1]TEMS?\b)/.test(
        fold(line.text).replace(/^[^A-Z0-9+]+/, ''),
      ),
    );
  const top = Math.max(0, Math.floor(header.bbox.y0 - padding));
  const bottom = footer ? Math.min(height, Math.ceil(footer.bbox.y0 - padding * 0.2)) : height;
  return {
    left,
    top,
    width: right - left,
    height: Math.max(header.bbox.y1 - top + padding, bottom - top),
  };
}

/** Replace one crop, in page coordinates, without repeating its table rows. */
export function replaceSupplierInvoiceOcrRegion(
  pageLines: SupplierInvoiceOcrLayoutLine[],
  regionLines: SupplierInvoiceOcrLayoutLine[],
  rectangle: SupplierInvoiceOcrRectangle,
): SupplierInvoiceOcrLayoutLine[] {
  if (!regionLines.length) return pageLines;
  const translated = regionLines.map((line) => ({
    ...line,
    bbox: translate(line.bbox, rectangle),
    words: line.words.map((word) => ({ ...word, bbox: translate(word.bbox, rectangle) })),
  }));
  const inside = (box: SupplierInvoiceOcrBox) => {
    const centerX = (box.x0 + box.x1) / 2;
    const centerY = (box.y0 + box.y1) / 2;
    return (
      centerX >= rectangle.left &&
      centerX < rectangle.left + rectangle.width &&
      centerY >= rectangle.top &&
      centerY < rectangle.top + rectangle.height
    );
  };
  const outside = pageLines.flatMap((line) => {
    if (!line.words.length) return inside(line.bbox) ? [] : [line];
    const words = line.words.filter((word) => !inside(word.bbox));
    if (words.length === line.words.length) return [line];
    return reconstructSupplierInvoiceOcrLines({
      text: '',
      blocks: [{ paragraphs: [{ lines: [{ words }] }] }],
    });
  });
  return [...outside, ...translated].sort((a, b) => a.bbox.y0 - b.bbox.y0);
}

function translate(box: SupplierInvoiceOcrBox, rectangle: SupplierInvoiceOcrRectangle) {
  return {
    x0: box.x0 + rectangle.left,
    y0: box.y0 + rectangle.top,
    x1: box.x1 + rectangle.left,
    y1: box.y1 + rectangle.top,
  };
}

function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}
