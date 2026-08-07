const MAX_OCR_EDGE = 2400;
const MIN_OCR_EDGE = 1400;
const ANALYSIS_MAX_EDGE = 720;

type Point = { x: number; y: number };

type CvMat = {
  cols: number;
  rows: number;
  data32S?: Int32Array;
  delete: () => void;
};

type CvMatVector = {
  get: (index: number) => CvMat;
  size: () => number;
  delete: () => void;
};

type CvRuntime = {
  BORDER_REPLICATE: number;
  CHAIN_APPROX_SIMPLE: number;
  COLOR_RGBA2GRAY: number;
  CV_32FC2: number;
  INTER_CUBIC: number;
  RETR_LIST: number;
  Mat: new () => CvMat;
  MatVector: new () => CvMatVector;
  Point: new (x: number, y: number) => unknown;
  Size: new (width: number, height: number) => unknown;
  GaussianBlur: (
    source: CvMat,
    destination: CvMat,
    kernelSize: unknown,
    sigmaX: number,
    sigmaY?: number,
    borderType?: number,
  ) => void;
  Canny: (source: CvMat, destination: CvMat, threshold1: number, threshold2: number) => void;
  approxPolyDP: (curve: CvMat, approximation: CvMat, epsilon: number, closed: boolean) => void;
  arcLength: (curve: CvMat, closed: boolean) => number;
  contourArea: (contour: CvMat) => number;
  cvtColor: (source: CvMat, destination: CvMat, code: number) => void;
  dilate: (source: CvMat, destination: CvMat, kernel: CvMat) => void;
  findContours: (
    image: CvMat,
    contours: CvMatVector,
    hierarchy: CvMat,
    mode: number,
    method: number,
    offset?: unknown,
  ) => void;
  getPerspectiveTransform: (source: CvMat, destination: CvMat) => CvMat;
  getStructuringElement: (shape: number, kernelSize: unknown) => CvMat;
  imread: (source: HTMLCanvasElement) => CvMat;
  imshow: (destination: HTMLCanvasElement, source: CvMat) => void;
  isContourConvex: (contour: CvMat) => boolean;
  matFromArray: (rows: number, cols: number, type: number, values: number[]) => CvMat;
  warpPerspective: (
    source: CvMat,
    destination: CvMat,
    transform: CvMat,
    destinationSize: unknown,
    flags?: number,
    borderMode?: number,
  ) => void;
};

let openCvPromise: Promise<CvRuntime | null> | null = null;

export type SupplierInvoiceImageQuality = {
  status: 'good' | 'warning';
  message?: string;
};

export type SupplierInvoiceOcrRegion = {
  id: 'header' | 'footer';
  image: Blob;
};

/**
 * Produces a temporary, OCR-friendly image in the browser. The caller owns the
 * returned Blob and must never persist it: it is intentionally only an input
 * for the local Tesseract worker.
 *
 * OpenCV is loaded only in the browser and only while OCR is used. If it cannot
 * be loaded, or no credible document contour is found, the former contrast
 * pipeline remains the safe fallback.
 */
export async function preprocessSupplierInvoiceImage(source: Blob): Promise<Blob> {
  const bitmap = await loadImage(source);
  const sourceCanvas = document.createElement('canvas');
  let workingCanvas: HTMLCanvasElement | null = sourceCanvas;

  try {
    const { width, height } = normalizeDimensions(bitmap.width, bitmap.height);
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceContext) throw new Error('No se pudo preparar la imagen para el OCR.');

    sourceContext.imageSmoothingEnabled = true;
    sourceContext.imageSmoothingQuality = 'high';
    sourceContext.fillStyle = '#ffffff';
    sourceContext.fillRect(0, 0, width, height);
    sourceContext.drawImage(bitmap, 0, 0, width, height);

    // A photographed receipt is often tilted or includes the table around it.
    // This rectifies only a large, convex four-corner contour; otherwise it
    // deliberately leaves the source untouched instead of cropping valid text.
    const rectifiedCanvas = await rectifyDocumentWithOpenCv(sourceCanvas);
    if (rectifiedCanvas) {
      workingCanvas = rectifiedCanvas;
      sourceCanvas.width = 1;
      sourceCanvas.height = 1;
    }

    const workingContext = workingCanvas.getContext('2d', { willReadFrequently: true });
    if (!workingContext) throw new Error('No se pudo preparar la imagen para el OCR.');

    // The perspective correction handles the main rotation. This tiny second
    // pass aligns printed rows when the document was already tightly cropped.
    const skewAngle = estimateDeskewAngle(
      workingContext,
      workingCanvas.width,
      workingCanvas.height,
    );
    if (Math.abs(skewAngle) >= 0.35) {
      workingCanvas = rotateCanvas(workingCanvas, -skewAngle);
    }

    const enhancedContext = workingCanvas.getContext('2d', { willReadFrequently: true });
    if (!enhancedContext) throw new Error('No se pudo preparar la imagen para el OCR.');
    enhanceInvoiceImage(enhancedContext, workingCanvas.width, workingCanvas.height);

    return await canvasToBlob(workingCanvas);
  } finally {
    sourceCanvas.width = 1;
    sourceCanvas.height = 1;
    if (workingCanvas && workingCanvas !== sourceCanvas) {
      workingCanvas.width = 1;
      workingCanvas.height = 1;
    }
    if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

/**
 * Runs a lightweight, local quality check before OCR. It never stores the
 * image; it only lets the capture UI suggest retaking visibly dark, flat or
 * blurred photographs.
 */
export async function assessSupplierInvoiceImageQuality(
  source: Blob,
): Promise<SupplierInvoiceImageQuality> {
  let bitmap: DecodedImage | null = null;
  const canvas = document.createElement('canvas');

  try {
    bitmap = await loadImage(source);
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, ANALYSIS_MAX_EDGE / Math.max(1, longestEdge));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || width < 12 || height < 12) return { status: 'good' };

    context.drawImage(bitmap, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const grayscale = new Uint8Array(width * height);
    let luminanceSum = 0;
    let luminanceSquares = 0;

    for (let pixel = 0, offset = 0; pixel < grayscale.length; pixel += 1, offset += 4) {
      const value = Math.round(
        imageData.data[offset] * 0.2126 +
          imageData.data[offset + 1] * 0.7152 +
          imageData.data[offset + 2] * 0.0722,
      );
      grayscale[pixel] = value;
      luminanceSum += value;
      luminanceSquares += value * value;
    }

    const total = grayscale.length;
    const average = luminanceSum / total;
    const contrast = Math.sqrt(Math.max(0, luminanceSquares / total - average * average));
    let laplacianSum = 0;
    let laplacianSquares = 0;
    let laplacianCount = 0;

    for (let y = 1; y < height - 1; y += 2) {
      for (let x = 1; x < width - 1; x += 2) {
        const index = y * width + x;
        const laplacian =
          4 * grayscale[index] -
          grayscale[index - 1] -
          grayscale[index + 1] -
          grayscale[index - width] -
          grayscale[index + width];
        laplacianSum += laplacian;
        laplacianSquares += laplacian * laplacian;
        laplacianCount += 1;
      }
    }

    const sharpness = Math.max(
      0,
      laplacianSquares / laplacianCount - (laplacianSum / laplacianCount) ** 2,
    );
    const warnings: string[] = [];
    if (average < 58 || average > 245) warnings.push('la iluminación es extrema');
    if (contrast < 18) warnings.push('hay poco contraste');
    if (sharpness < 28) warnings.push('la foto parece poco nítida');

    return warnings.length
      ? { status: 'warning', message: `Conviene repetirla: ${warnings.join(', ')}.` }
      : { status: 'good' };
  } catch {
    // Quality feedback should never block a manual photograph or OCR.
    return { status: 'good' };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    if (bitmap && 'close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

/**
 * Creates temporary OCR zones from the already corrected page. Header fields
 * such as RNC/NCF and footer totals benefit from a different page segmentation
 * mode. The Blobs are only kept for the current recognition call.
 */
export async function createSupplierInvoiceOcrRegions(
  source: Blob,
): Promise<SupplierInvoiceOcrRegion[]> {
  let bitmap: DecodedImage | null = null;
  const canvas = document.createElement('canvas');

  try {
    bitmap = await loadImage(source);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context || canvas.width < 16 || canvas.height < 16) return [];

    context.drawImage(bitmap, 0, 0);
    const header = await cropCanvasToBlob(canvas, 0.025, 0.02, 0.95, 0.34);
    const footer = await cropCanvasToBlob(canvas, 0.025, 0.62, 0.95, 0.35);
    return [
      { id: 'header', image: header },
      { id: 'footer', image: footer },
    ];
  } catch {
    // Regional OCR is optional. The general reading remains usable if a
    // browser cannot decode a crop from an otherwise valid page.
    return [];
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    if (bitmap && 'close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
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
      element.onerror = () =>
        reject(new Error('No se pudo abrir una de las imágenes seleccionadas.'));
      element.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function normalizeDimensions(sourceWidth: number, sourceHeight: number) {
  const longestEdge = Math.max(sourceWidth, sourceHeight);
  const scale =
    longestEdge > MAX_OCR_EDGE
      ? MAX_OCR_EDGE / longestEdge
      : longestEdge < MIN_OCR_EDGE
        ? MIN_OCR_EDGE / longestEdge
        : 1;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

async function rectifyDocumentWithOpenCv(
  sourceCanvas: HTMLCanvasElement,
): Promise<HTMLCanvasElement | null> {
  const cv = await loadOpenCv();
  if (!cv) return null;

  let source: CvMat | null = null;
  let grayscale: CvMat | null = null;
  let blurred: CvMat | null = null;
  let edges: CvMat | null = null;
  let dilated: CvMat | null = null;
  let kernel: CvMat | null = null;
  let contours: CvMatVector | null = null;
  let hierarchy: CvMat | null = null;
  let inputCorners: CvMat | null = null;
  let outputCorners: CvMat | null = null;
  let transform: CvMat | null = null;
  let rectified: CvMat | null = null;

  try {
    source = cv.imread(sourceCanvas);
    grayscale = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    dilated = new cv.Mat();
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();

    cv.cvtColor(source, grayscale, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(grayscale, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 45, 150);
    kernel = cv.getStructuringElement(0, new cv.Size(5, 5));
    cv.dilate(edges, dilated, kernel);
    cv.findContours(
      dilated,
      contours,
      hierarchy,
      cv.RETR_LIST,
      cv.CHAIN_APPROX_SIMPLE,
      new cv.Point(0, 0),
    );

    const corners = findLargestDocumentCorners(
      cv,
      contours,
      sourceCanvas.width,
      sourceCanvas.height,
    );
    if (!corners) return null;

    const { width, height } = getRectifiedDimensions(
      corners,
      sourceCanvas.width,
      sourceCanvas.height,
    );
    if (width < 300 || height < 300) return null;

    inputCorners = cv.matFromArray(
      4,
      1,
      cv.CV_32FC2,
      corners.flatMap((point) => [point.x, point.y]),
    );
    outputCorners = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0,
      0,
      width - 1,
      0,
      width - 1,
      height - 1,
      0,
      height - 1,
    ]);
    transform = cv.getPerspectiveTransform(inputCorners, outputCorners);
    rectified = new cv.Mat();
    cv.warpPerspective(
      source,
      rectified,
      transform,
      new cv.Size(width, height),
      cv.INTER_CUBIC,
      cv.BORDER_REPLICATE,
    );

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    cv.imshow(canvas, rectified);
    return canvas;
  } catch {
    // OpenCV is an enhancement, never a hard dependency for invoice entry.
    return null;
  } finally {
    rectified?.delete();
    transform?.delete();
    outputCorners?.delete();
    inputCorners?.delete();
    hierarchy?.delete();
    contours?.delete();
    kernel?.delete();
    dilated?.delete();
    edges?.delete();
    blurred?.delete();
    grayscale?.delete();
    source?.delete();
  }
}

function findLargestDocumentCorners(
  cv: CvRuntime,
  contours: CvMatVector,
  width: number,
  height: number,
): Point[] | null {
  const minimumArea = width * height * 0.22;
  let bestCorners: Point[] | null = null;
  let bestArea = minimumArea;

  for (let index = 0; index < contours.size(); index += 1) {
    const contour = contours.get(index);
    let approximation: CvMat | null = null;

    try {
      const contourArea = Math.abs(cv.contourArea(contour));
      if (contourArea < bestArea) continue;

      approximation = new cv.Mat();
      cv.approxPolyDP(contour, approximation, cv.arcLength(contour, true) * 0.02, true);
      const points = contourToPoints(approximation);
      if (points.length !== 4 || !cv.isContourConvex(approximation)) continue;

      const ordered = orderCorners(points);
      const quadrilateralArea = polygonArea(ordered);
      if (quadrilateralArea < bestArea || !hasPlausibleDocumentShape(ordered, width, height))
        continue;

      bestArea = quadrilateralArea;
      bestCorners = ordered;
    } finally {
      approximation?.delete();
      contour.delete();
    }
  }

  return bestCorners;
}

function contourToPoints(contour: CvMat): Point[] {
  const values = contour.data32S;
  if (!values || values.length < 8) return [];
  const points: Point[] = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push({ x: values[index], y: values[index + 1] });
  }
  return points;
}

function orderCorners(points: Point[]): Point[] {
  const sortedBySum = [...points].sort((left, right) => left.x + left.y - (right.x + right.y));
  const sortedByDifference = [...points].sort(
    (left, right) => left.y - left.x - (right.y - right.x),
  );
  return [
    sortedBySum[0],
    sortedByDifference[0],
    sortedBySum.at(-1) as Point,
    sortedByDifference.at(-1) as Point,
  ];
}

function hasPlausibleDocumentShape(points: Point[], sourceWidth: number, sourceHeight: number) {
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  const sides = [
    distance(topLeft, topRight),
    distance(topRight, bottomRight),
    distance(bottomRight, bottomLeft),
    distance(bottomLeft, topLeft),
  ];
  const smallestSide = Math.min(...sides);
  const largestSide = Math.max(...sides);
  const diagonal = Math.hypot(sourceWidth, sourceHeight);

  // A full invoice is large and reasonably quadrilateral. These guards avoid
  // treating a table cell, barcode or a dark object near the document as paper.
  return smallestSide > diagonal * 0.14 && largestSide / smallestSide < 6.5;
}

function getRectifiedDimensions(points: Point[], sourceWidth: number, sourceHeight: number) {
  const [topLeft, topRight, bottomRight, bottomLeft] = points;
  const rawWidth = Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight));
  const rawHeight = Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight));
  const longestEdge = Math.max(rawWidth, rawHeight);
  const scale = longestEdge > MAX_OCR_EDGE ? MAX_OCR_EDGE / longestEdge : 1;

  return {
    width: Math.max(1, Math.round(rawWidth * scale)),
    height: Math.max(1, Math.round(rawHeight * scale)),
  };
}

function distance(left: Point, right: Point) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function polygonArea(points: Point[]) {
  return Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2,
  );
}

function estimateDeskewAngle(context: CanvasRenderingContext2D, width: number, height: number) {
  const maximumEdge = Math.max(width, height);
  const scale = Math.min(1, 900 / Math.max(1, maximumEdge));
  const sampleWidth = Math.max(1, Math.round(width * scale));
  const sampleHeight = Math.max(1, Math.round(height * scale));
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = sampleWidth;
  sampleCanvas.height = sampleHeight;

  try {
    const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!sampleContext) return 0;
    sampleContext.drawImage(context.canvas, 0, 0, sampleWidth, sampleHeight);
    const imageData = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight);
    const points: Point[] = [];
    const horizontalMargin = Math.round(sampleWidth * 0.05);
    const verticalMargin = Math.round(sampleHeight * 0.05);

    for (let y = verticalMargin; y < sampleHeight - verticalMargin; y += 3) {
      for (let x = horizontalMargin; x < sampleWidth - horizontalMargin; x += 3) {
        const offset = (y * sampleWidth + x) * 4;
        const luminance =
          imageData.data[offset] * 0.2126 +
          imageData.data[offset + 1] * 0.7152 +
          imageData.data[offset + 2] * 0.0722;
        if (luminance < 145) points.push({ x, y });
      }
    }

    if (points.length < 120) return 0;
    let bestAngle = 0;
    let bestScore = -1;

    for (let angle = -6; angle <= 6; angle += 0.5) {
      const radians = (angle * Math.PI) / 180;
      const sine = Math.sin(radians);
      const cosine = Math.cos(radians);
      const rows = new Uint16Array(sampleHeight + sampleWidth / 4 + 4);
      for (const point of points) {
        const row = Math.round(-sine * point.x + cosine * point.y);
        const index = row + Math.ceil(sampleWidth / 8);
        if (index >= 0 && index < rows.length && rows[index] < 65535) rows[index] += 1;
      }
      let score = 0;
      for (const count of rows) score += count * count;
      if (score > bestScore) {
        bestScore = score;
        bestAngle = angle;
      }
    }

    // Ignore the edge of the search range: it usually indicates a perspective
    // problem that the document contour did not solve safely.
    return Math.abs(bestAngle) >= 5.5 ? 0 : bestAngle;
  } catch {
    return 0;
  } finally {
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;
  }
}

function rotateCanvas(source: HTMLCanvasElement, angle: number) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (!context) return source;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((angle * Math.PI) / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  source.width = 1;
  source.height = 1;
  return canvas;
}

function enhanceInvoiceImage(context: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = context.getImageData(0, 0, width, height);
  const { data } = imageData;
  const histogram = new Uint32Array(256);

  for (let index = 0; index < data.length; index += 4) {
    const luminance = Math.round(
      data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722,
    );
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

function cropCanvasToBlob(
  source: HTMLCanvasElement,
  leftRatio: number,
  topRatio: number,
  widthRatio: number,
  heightRatio: number,
) {
  const x = Math.max(0, Math.floor(source.width * leftRatio));
  const y = Math.max(0, Math.floor(source.height * topRatio));
  const width = Math.max(1, Math.min(source.width - x, Math.round(source.width * widthRatio)));
  const height = Math.max(1, Math.min(source.height - y, Math.round(source.height * heightRatio)));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo preparar la imagen para el OCR.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, x, y, width, height, 0, 0, width, height);

  return canvasToBlob(canvas).finally(() => {
    canvas.width = 1;
    canvas.height = 1;
  });
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

function loadOpenCv() {
  if (!openCvPromise) {
    openCvPromise = (async () => {
      if (typeof window === 'undefined') return null;
      const imported = await import('@techstark/opencv-js');
      const candidate = (imported as unknown as { default?: unknown }).default ?? imported;
      const runtime = await Promise.resolve(candidate);
      if (isOpenCvRuntime(runtime)) return runtime;

      // Depending on the browser bundle, OpenCV either resolves as a Promise
      // or exposes its module first and signals readiness later. Waiting for
      // the latter is important: treating it as unavailable too early would
      // silently leave every capture on the fallback pipeline.
      if (!runtime || typeof runtime !== 'object') return null;
      const initializingRuntime = runtime as {
        onRuntimeInitialized?: () => void;
      };
      return await new Promise<CvRuntime | null>((resolve) => {
        const previous = initializingRuntime.onRuntimeInitialized;
        const timeout = window.setTimeout(() => resolve(null), 20_000);
        initializingRuntime.onRuntimeInitialized = () => {
          window.clearTimeout(timeout);
          previous?.();
          resolve(isOpenCvRuntime(runtime) ? runtime : null);
        };
      });
    })().catch(() => null);
  }
  return openCvPromise;
}

function isOpenCvRuntime(value: unknown): value is CvRuntime {
  if (!value || typeof value !== 'object') return false;
  const runtime = value as Partial<CvRuntime>;
  return (
    typeof runtime.Mat === 'function' &&
    typeof runtime.MatVector === 'function' &&
    typeof runtime.imread === 'function' &&
    typeof runtime.imshow === 'function' &&
    typeof runtime.findContours === 'function' &&
    typeof runtime.getPerspectiveTransform === 'function'
  );
}
