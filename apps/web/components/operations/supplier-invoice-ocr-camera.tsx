'use client';

import {
  Camera,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  ScanText,
  Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { preprocessSupplierInvoiceImage } from '@/lib/supplier-invoice-ocr-image';
import { readSupplierInvoiceQr } from '@/lib/supplier-invoice-qr';
import {
  extractSupplierInvoiceOcr,
  type SupplierInvoiceOcrResult,
} from '@/lib/supplier-invoice-ocr';
import { SupplierInvoiceDialog } from './supplier-invoice-dialog';

type OcrProgress = {
  status: string;
  value: number;
  page: number;
  totalPages: number;
};

type CapturedPage = {
  id: string;
  image: Blob;
  previewUrl: string;
  label: string;
};

type SupplierInvoiceOcrCameraProps = {
  open: boolean;
  onClose: () => void;
  onRecognized: (result: SupplierInvoiceOcrResult) => void;
};

const MAX_CAPTURED_PAGES = 10;

export function SupplierInvoiceOcrCamera({
  open,
  onClose,
  onRecognized,
}: SupplierInvoiceOcrCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cameraRequestRef = useRef(0);
  const currentOcrPageRef = useRef(1);
  const pagesRef = useRef<CapturedPage[]>([]);
  const [pages, setPages] = useState<CapturedPage[]>([]);
  const [activeView, setActiveView] = useState<'camera' | string>('camera');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [processing, setProcessing] = useState(false);

  const selectedPage = activeView === 'camera' ? null : pages.find((page) => page.id === activeView);

  useEffect(() => {
    if (!open) {
      stopCamera();
      clearPages();
      return;
    }
    void activateCamera();

    return () => {
      stopCamera();
    };
  }, [open]);

  useEffect(() => {
    if (!open || activeView !== 'camera') return;
    if (streamRef.current) {
      void attachStream();
    }
  }, [activeView, open]);

  useEffect(
    () => () => {
      stopCamera();
      revokePageUrls(pagesRef.current);
      pagesRef.current = [];
    },
    [],
  );

  async function activateCamera() {
    stopCamera();
    const requestId = cameraRequestRef.current;
    setCameraError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Este navegador no permite acceder a la cámara. Puedes seleccionar imágenes en su lugar.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      await attachStream();
    } catch {
      setCameraError(
        'No se pudo activar la cámara. Verifica el permiso del navegador o selecciona una imagen.',
      );
    }
  }

  async function attachStream() {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      setCameraError('No se pudo iniciar la vista de la cámara. Inténtalo nuevamente.');
    }
  }

  function stopCamera() {
    cameraRequestRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function setCapturePages(nextPages: CapturedPage[]) {
    pagesRef.current = nextPages;
    setPages(nextPages);
  }

  function clearPages() {
    revokePageUrls(pagesRef.current);
    setCapturePages([]);
    setActiveView('camera');
  }

  function addPages(images: Blob[], sourceLabel: string) {
    if (!images.length) return;

    const availableSlots = MAX_CAPTURED_PAGES - pagesRef.current.length;
    const acceptedImages = images.slice(0, availableSlots);
    if (acceptedImages.length < images.length) {
      setOcrError(`Solo se pueden procesar hasta ${MAX_CAPTURED_PAGES} páginas por factura.`);
    }

    const startIndex = pagesRef.current.length;
    const newPages = acceptedImages.map((image, index) => ({
      id: createPageId(),
      image,
      previewUrl: URL.createObjectURL(image),
      label: `${sourceLabel} ${startIndex + index + 1}`,
    }));
    if (!newPages.length) return;

    // Una vez existe una página para revisar, no dejamos la cámara abierta en
    // segundo plano. El usuario puede reabrirla con "Agregar" si hace falta.
    stopCamera();
    setOcrError(null);
    setCapturePages([...pagesRef.current, ...newPages]);
    setActiveView(newPages.at(-1)?.id ?? 'camera');
  }

  function takePhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setCameraError('La cámara aún se está preparando. Inténtalo de nuevo en unos segundos.');
      return;
    }

    const longestSide = Math.max(video.videoWidth, video.videoHeight);
    const scale = Math.min(1, 2600 / longestSide);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('No se pudo preparar la imagen para el OCR.');
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        canvas.width = 1;
        canvas.height = 1;
        if (!blob) {
          setCameraError('No se pudo capturar la foto. Inténtalo nuevamente.');
          return;
        }
        // No mantenemos la cámara encendida mientras el usuario revisa una
        // página temporal; volverá a abrirse solamente si agrega otra foto.
        stopCamera();
        addPages([blob], 'Foto');
      },
      'image/jpeg',
      0.94,
    );
  }

  function removePage(pageId: string) {
    const page = pagesRef.current.find((item) => item.id === pageId);
    if (!page) return;

    URL.revokeObjectURL(page.previewUrl);
    const nextPages = pagesRef.current.filter((item) => item.id !== pageId);
    setCapturePages(nextPages);
    setActiveView(nextPages.at(-1)?.id ?? 'camera');
  }

  function handleFileSelection(event: React.ChangeEvent<HTMLInputElement>) {
    const images = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (!images.length && event.target.files?.length) {
      setOcrError('Selecciona solamente imágenes de la factura para usar el OCR.');
    } else {
      addPages(images, 'Archivo');
    }
    event.target.value = '';
  }

  async function recognizePages() {
    const capturePages = [...pagesRef.current];
    if (!capturePages.length) return;

    setProcessing(true);
    setOcrError(null);
    setOcrProgress({ status: 'Preparando OCR local', value: 0, page: 1, totalPages: capturePages.length });
    let worker: Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>> | null = null;

    try {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      worker = await createWorker('spa+eng', OEM.LSTM_ONLY, {
        logger: (message) => {
          const page = Math.min(capturePages.length, Math.max(1, currentOcrPageRef.current));
          const progress = Number.isFinite(message.progress) ? message.progress : 0;
          setOcrProgress({ status: message.status, value: progress, page, totalPages: capturePages.length });
        },
      });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });

      const pageTexts: string[] = [];
      const qrValues: string[] = [];
      for (let index = 0; index < capturePages.length; index += 1) {
        currentOcrPageRef.current = index + 1;
        setOcrProgress({
          status: 'Mejorando legibilidad de la imagen',
          value: 0,
          page: index + 1,
          totalPages: capturePages.length,
        });
        // This derived Blob lives only for this recognition call and is never
        // attached to the invoice or included in the OCR result.
        const preparedImage = await preprocessSupplierInvoiceImage(capturePages[index].image);
        const qrValue = await readSupplierInvoiceQr(capturePages[index].image);
        if (qrValue) qrValues.push(qrValue);
        const { data } = await worker.recognize(preparedImage);
        let pageText = data.text.trim();
        // Una factura muy clara o ya digitalizada puede perder detalle al
        // aumentar el contraste. En ese caso hacemos un único intento con la
        // toma original y conservamos la lectura más completa.
        if (pageText.length < 24) {
          const fallback = await worker.recognize(capturePages[index].image);
          const fallbackText = fallback.data.text.trim();
          if (fallbackText.length > pageText.length) pageText = fallbackText;
        }
        if (pageText) {
          pageTexts.push(`--- PÁGINA ${index + 1} ---\n${pageText}`);
        }
      }

      const rawText = pageTexts.join('\n\n').trim();
      const result = {
        ...extractSupplierInvoiceOcr(rawText, { qrValues }),
        pageCount: capturePages.length,
      };
      if (!result.rawText) {
        throw new Error('No se pudo leer texto en las imágenes. Prueba con mejor iluminación o usa el ingreso manual.');
      }

      clearPages();
      onRecognized(result);
    } catch (error) {
      setOcrError(
        error instanceof Error
          ? error.message
          : 'No se pudieron procesar las imágenes con OCR. Inténtalo nuevamente.',
      );
    } finally {
      currentOcrPageRef.current = 1;
      await worker?.terminate();
      setProcessing(false);
    }
  }

  function showCamera() {
    setActiveView('camera');
    setOcrError(null);
    if (!streamRef.current || cameraError) void activateCamera();
  }

  function close() {
    if (processing) return;
    stopCamera();
    clearPages();
    setCameraError(null);
    setOcrError(null);
    setOcrProgress(null);
    onClose();
  }

  return (
    <SupplierInvoiceDialog
      open={open}
      title="Capturar factura con OCR"
      description="Las imágenes se procesan localmente solo para sugerir datos. No se suben ni se guardan en la factura."
      icon={<ScanText className="h-5 w-5" />}
      size="lg"
      layer="overlay"
      onClose={close}
    >
      <div className="space-y-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          aria-label="Seleccionar imágenes de la factura"
          onChange={handleFileSelection}
        />

        <div className="relative overflow-hidden rounded-xl border bg-muted/30">
          {selectedPage ? (
            <img
              src={selectedPage.previewUrl}
              alt={`Vista previa de ${selectedPage.label} para OCR`}
              className="max-h-[48dvh] w-full bg-black object-contain"
            />
          ) : cameraError ? (
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 bg-muted/40 p-6 text-center">
              <Camera className="h-8 w-8 text-muted-foreground" />
              <p className="max-w-md text-sm leading-6 text-muted-foreground">
                Puedes volver a intentar la cámara o seleccionar una o varias imágenes de la factura.
              </p>
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="aspect-[4/3] w-full bg-black object-cover"
            />
          )}
          {!selectedPage && !cameraError ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-5">
              <div className="flex h-[82%] w-[78%] items-end rounded-lg border-2 border-dashed border-white/85 bg-black/5 p-3 shadow-[0_0_0_999px_rgba(0,0,0,0.12)]">
                <span className="rounded bg-black/55 px-2 py-1 text-xs font-medium text-white">
                  Encierra toda la factura dentro del marco
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {pages.length ? (
          <div className="rounded-xl border bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">
                Páginas capturadas <span className="text-muted-foreground">({pages.length})</span>
              </p>
              <span className="text-xs text-muted-foreground">Temporales: no se adjuntarán a la factura</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {pages.map((page, index) => {
                const isSelected = page.id === activeView;
                return (
                  <div
                    key={page.id}
                    className={`relative w-20 shrink-0 overflow-hidden rounded-lg border ${
                      isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border'
                    }`}
                  >
                    <button
                      type="button"
                      className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setActiveView(page.id)}
                      aria-label={`Ver página ${index + 1}`}
                    >
                      <img
                        src={page.previewUrl}
                        alt=""
                        className="h-24 w-full bg-muted object-cover"
                      />
                      <span className="block truncate px-1.5 py-1 text-center text-xs font-medium">
                        Página {index + 1}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="absolute right-1 top-1 rounded-md bg-primary/85 p-1 text-primary-foreground shadow-sm transition-colors hover:bg-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => removePage(page.id)}
                      disabled={processing}
                      aria-label={`Quitar página ${index + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={showCamera}
                disabled={processing || pages.length >= MAX_CAPTURED_PAGES}
                className={`flex h-[7.25rem] w-20 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  activeView === 'camera'
                    ? 'border-primary bg-primary/5 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                <Camera className="h-4 w-4" />
                Agregar
              </button>
            </div>
          </div>
        ) : null}

        {cameraError ? (
          <p className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{cameraError}</p>
        ) : null}
        {ocrError ? (
          <p className="rounded-lg bg-danger/10 p-3 text-sm text-danger">{ocrError}</p>
        ) : null}
        {ocrProgress ? (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">
                {processing
                  ? `Leyendo página ${ocrProgress.page} de ${ocrProgress.totalPages}`
                  : 'OCR listo'}
              </span>
              <span className="text-muted-foreground">{Math.round(ocrProgress.value * 100)}%</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{humanizeOcrStatus(ocrProgress.status)}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{
                  width: `${Math.max(
                    3,
                    Math.round(
                      ((ocrProgress.page - 1 + ocrProgress.value) / ocrProgress.totalPages) * 100,
                    ),
                  )}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        <p className="text-sm leading-6 text-muted-foreground">
          Puedes añadir varias páginas si la factura continúa al reverso o en una hoja adicional. Procura que cada
          página esté completa, recta y bien iluminada. Siempre podrás revisar y corregir los datos antes de
          confirmar la compra.
        </p>

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
          <Button type="button" variant="outline" onClick={close} disabled={processing}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={processing || pages.length >= MAX_CAPTURED_PAGES}
          >
            <ImagePlus className="h-4 w-4" />
            Añadir imágenes
          </Button>
          {selectedPage ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => removePage(selectedPage.id)}
              disabled={processing}
            >
              <RefreshCw className="h-4 w-4" />
              Repetir página
            </Button>
          ) : (
            <Button type="button" onClick={() => (cameraError ? void activateCamera() : takePhoto())}>
              <Camera className="h-4 w-4" />
              {cameraError ? 'Reintentar cámara' : 'Tomar foto'}
            </Button>
          )}
          {pages.length ? (
            <Button type="button" onClick={() => void recognizePages()} disabled={processing}>
              {processing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
              {processing ? 'Procesando OCR…' : `Leer ${pages.length} ${pages.length === 1 ? 'página' : 'páginas'} con OCR`}
            </Button>
          ) : null}
        </div>
      </div>
    </SupplierInvoiceDialog>
  );
}

function createPageId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function revokePageUrls(capturedPages: CapturedPage[]) {
  capturedPages.forEach((page) => URL.revokeObjectURL(page.previewUrl));
}

function humanizeOcrStatus(status: string) {
  const labels: Record<string, string> = {
    'loading tesseract core': 'Cargando motor de lectura',
    'initializing tesseract': 'Inicializando motor de lectura',
    'loading language traineddata': 'Cargando idioma de lectura',
    'initializing api': 'Preparando reconocimiento',
    'recognizing text': 'Reconociendo texto',
  };
  return labels[status.toLowerCase()] ?? status;
}
