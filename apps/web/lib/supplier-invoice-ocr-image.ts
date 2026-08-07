const MAX_OCR_EDGE = 2400;
const MIN_OCR_EDGE = 1400;

/**
 * Produces a temporary, OCR-friendly image in the browser. The caller owns the
 * returned Blob and must never persist it: it is intentionally only an input
 * for the local Tesseract worker.
 */
export async function preprocessSupplierInvoiceImage(source: Blob): Promise<Blob> {
  const bitmap = await loadImage(source);

  try {
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale =
      longestEdge > MAX_OCR_EDGE
        ? MAX_OCR_EDGE / longestEdge
        : longestEdge < MIN_OCR_EDGE
          ? MIN_OCR_EDGE / longestEdge
          : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('No se pudo preparar la imagen para el OCR.');

    context.drawImage(bitmap, 0, 0, width, height);
    enhanceInvoiceImage(context, width, height);

    const image = await canvasToBlob(canvas);
    canvas.width = 1;
    canvas.height = 1;
    return image;
  } finally {
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

type DecodedImage = ImageBitmap | HTMLImageElement;

async function loadImage(source: Blob): Promise<DecodedImage> {
  if ('createImageBitmap' in window) {
    try {
      // Respect the orientation recorded by phone cameras before normalizing scale.
      return await createImageBitmap(source, { imageOrientation: 'from-image' });
    } catch {
      // Some browsers do not support imageOrientation. The image fallback below
      // still lets the user process files instead of failing the whole capture.
    }
  }

  const objectUrl = URL.createObjectURL(source);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('No se pudo abrir una de las imágenes seleccionadas.'));
      element.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function enhanceInvoiceImage(context: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  const histogram = new Uint32Array(256);

  for (let index = 0; index < data.length; index += 4) {
    const luminance = Math.round(data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722);
    histogram[luminance] += 1;
  }

  const low = percentile(histogram, 0.02);
  const high = percentile(histogram, 0.98);
  const range = Math.max(28, high - low);
  const threshold = otsuThreshold(histogram, width * height);
  const normalizedThreshold = Math.min(255, Math.max(0, ((threshold - low) * 255) / range));
  const softLowerBound = Math.max(0, normalizedThreshold - 42);
  const softRange = Math.max(80, Math.min(170, normalizedThreshold + 58 - softLowerBound));

  for (let index = 0; index < data.length; index += 4) {
    const luminance = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    const normalized = Math.min(255, Math.max(0, ((luminance - low) * 255) / range));
    // A soft Otsu threshold removes shadows without destroying thin printed text.
    const enhanced = Math.round(
      Math.min(255, Math.max(0, ((normalized - softLowerBound) * 255) / softRange)),
    );
    data[index] = enhanced;
    data[index + 1] = enhanced;
    data[index + 2] = enhanced;
    data[index + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
}

function percentile(histogram: Uint32Array, percentileValue: number) {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  const target = Math.max(1, Math.ceil(total * percentileValue));
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen >= target) return value;
  }
  return 255;
}

function otsuThreshold(histogram: Uint32Array, total: number) {
  let sum = 0;
  for (let index = 0; index < histogram.length; index += 1) sum += index * histogram[index];

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestThreshold = 127;
  let bestVariance = -1;

  for (let threshold = 0; threshold < histogram.length; threshold += 1) {
    backgroundWeight += histogram[threshold];
    if (backgroundWeight === 0) continue;
    const foregroundWeight = total - backgroundWeight;
    if (foregroundWeight === 0) break;

    backgroundSum += threshold * histogram[threshold];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }

  return bestThreshold;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('No se pudo preparar la imagen para el OCR.'));
      },
      'image/jpeg',
      0.94,
    );
  });
}
