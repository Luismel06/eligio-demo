'use client';

import {
  CheckCircle2,
  Clipboard,
  Clock3,
  LoaderCircle,
  QrCode,
  RefreshCw,
  Smartphone,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  cancelMobileOcrCapture,
  claimMobileOcrCapture,
  createMobileOcrCapture,
  getMobileOcrCapture,
  type MobileOcrCapture,
} from '@/lib/api';
import type { AuthSession } from '@/lib/auth-session';
import type { SupplierInvoiceOcrResult } from '@/lib/supplier-invoice-ocr';
import { SupplierInvoiceDialog } from './supplier-invoice-dialog';

type SupplierInvoiceMobileCapturePanelProps = {
  open: boolean;
  session: AuthSession | null;
  onClose: () => void;
  onRecognized: (result: SupplierInvoiceOcrResult) => void;
};

const POLL_INTERVAL_MS = 2_000;

/**
 * Vincula temporalmente el OCR del teléfono con el formulario de escritorio.
 * La imagen nunca sale del teléfono: únicamente el resultado estructurado se
 * mantiene el tiempo estrictamente necesario para que la computadora lo tome.
 */
export function SupplierInvoiceMobileCapturePanel({
  open,
  session,
  onClose,
  onRecognized,
}: SupplierInvoiceMobileCapturePanelProps) {
  const [capture, setCapture] = useState<MobileOcrCapture | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [generation, setGeneration] = useState(0);
  const claimingRef = useRef(false);
  const onRecognizedRef = useRef(onRecognized);
  const tenantId = session?.tenantId;
  const accessToken = session?.accessToken;

  useEffect(() => {
    onRecognizedRef.current = onRecognized;
  }, [onRecognized]);

  const mobileUrl = useMemo(() => {
    if (!capture || typeof window === 'undefined') return '';

    const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
    const origin = configuredOrigin || window.location.origin;
    const url = new URL(`/ocr/capture/${capture.id}`, origin);
    // El fragmento no viaja al servidor ni aparece en los logs de navegación.
    url.hash = `t=${capture.token}`;
    return url.toString();
  }, [capture]);

  const secondsRemaining = capture
    ? Math.max(0, Math.ceil((new Date(capture.expiresAt).getTime() - now) / 1_000))
    : 0;
  const isLocalLink = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(
    mobileUrl,
  );
  const isInsecureLink = mobileUrl.startsWith('http://') && !isLocalLink;

  useEffect(() => {
    if (!open || !capture) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [capture, open]);

  useEffect(() => {
    if (!open || !tenantId || !accessToken) return;

    let active = true;
    let createdCaptureId: string | null = null;
    setCapture(null);
    setError(null);
    setInitializing(true);
    setClaiming(false);
    claimingRef.current = false;

    void createMobileOcrCapture(tenantId, accessToken)
      .then((nextCapture) => {
        createdCaptureId = nextCapture.id;
        if (!active) {
          void cancelCapture(nextCapture.id, tenantId, accessToken);
          return;
        }
        setCapture(nextCapture);
        setNow(Date.now());
      })
      .catch((nextError) => {
        if (!active) return;
        setError(toErrorMessage(nextError, 'No se pudo preparar la captura desde el teléfono.'));
      })
      .finally(() => {
        if (active) setInitializing(false);
      });

    return () => {
      active = false;
      if (createdCaptureId) void cancelCapture(createdCaptureId, tenantId, accessToken);
    };
  }, [accessToken, generation, open, tenantId]);

  useEffect(() => {
    if (
      !open ||
      !tenantId ||
      !accessToken ||
      !capture ||
      ['CONSUMED', 'EXPIRED', 'CANCELLED'].includes(capture.status)
    ) {
      return;
    }

    let active = true;

    const checkCapture = async () => {
      try {
        const status = await getMobileOcrCapture(tenantId, accessToken, capture.id);
        if (!active) return;

        if (status.status === 'READY') {
          if (!claimingRef.current) {
            claimingRef.current = true;
            setClaiming(true);
            const claimed = await claimMobileOcrCapture(tenantId, accessToken, capture.id);
            if (!active) return;

            onRecognizedRef.current({
              ...claimed.result,
              items: claimed.result.items.map((item, index) => ({
                ...item,
                rawText: item.rawText ?? item.description ?? item.code ?? `Línea OCR ${index + 1}`,
              })),
              // El texto crudo no se transmite desde el teléfono. El formulario
              // usa los campos estructurados y sigue exigiendo revisión humana.
              rawText: '',
            });
          }
          return;
        }

        // Do not publish READY into `capture` before consuming it. The effect
        // observes that state and would clean up its own in-flight consume
        // request, losing a one-use OCR result before it reaches the form.
        setCapture((current) =>
          current && current.id === capture.id && current.status !== status.status
            ? { ...current, status: status.status }
            : current,
        );

        if (status.status === 'EXPIRED' || status.status === 'CANCELLED') {
          setError(
            status.status === 'EXPIRED'
              ? 'El código venció. Genera uno nuevo para continuar.'
              : 'Esta captura fue cancelada. Genera un código nuevo para continuar.',
          );
        }
      } catch (nextError) {
        if (!active) return;
        claimingRef.current = false;
        setClaiming(false);
        setError(toErrorMessage(nextError, 'No se pudo consultar la captura del teléfono.'));
      }
    };

    void checkCapture();
    const interval = window.setInterval(() => void checkCapture(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [accessToken, capture?.id, capture?.status, open, tenantId]);

  async function regenerate() {
    if (capture && tenantId && accessToken) {
      await cancelCapture(capture.id, tenantId, accessToken);
    }
    setGeneration((current) => current + 1);
  }

  function close() {
    if (capture && tenantId && accessToken) void cancelCapture(capture.id, tenantId, accessToken);
    setCapture(null);
    onClose();
  }

  async function copyMobileUrl() {
    if (!mobileUrl) return;
    try {
      await navigator.clipboard.writeText(mobileUrl);
      toast.success('Enlace de captura copiado.');
    } catch {
      toast.error('No se pudo copiar el enlace. Escanea el código QR desde el teléfono.');
    }
  }

  return (
    <SupplierInvoiceDialog
      open={open}
      title="Capturar con el teléfono"
      description="Escanea el código, toma la foto en tu teléfono y el OCR volverá aquí para revisarlo. La imagen no se sube ni se guarda."
      icon={<Smartphone className="h-5 w-5" />}
      size="md"
      layer="overlay"
      onClose={close}
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.08] via-card to-accent/[0.08] p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <QrCode className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">1. Escanea este código con tu teléfono</p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Se abrirá una cámara segura para esta factura. No necesitas iniciar sesión en el
                teléfono.
              </p>
            </div>
          </div>

          <div className="mt-5 flex min-h-64 items-center justify-center rounded-2xl border bg-white p-4 shadow-sm">
            {initializing ? (
              <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
                <LoaderCircle className="h-7 w-7 animate-spin text-primary" />
                Preparando un código seguro…
              </div>
            ) : mobileUrl ? (
              <QRCodeSVG
                value={mobileUrl}
                size={224}
                level="M"
                includeMargin
                aria-label="Código QR para capturar una factura desde el teléfono"
              />
            ) : (
              <div className="text-center text-sm text-muted-foreground">
                {error ?? 'No se pudo generar el código de captura.'}
              </div>
            )}
          </div>

          {mobileUrl ? (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/80 px-3 py-2.5">
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock3 className="h-4 w-4 text-primary" />
                {secondsRemaining > 0
                  ? `Código temporal: ${formatRemaining(secondsRemaining)}`
                  : 'El código está venciendo…'}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void copyMobileUrl()}>
                <Clipboard className="h-4 w-4" />
                Copiar enlace
              </Button>
            </div>
          ) : null}
        </div>

        {claiming ? (
          <div className="flex items-start gap-3 rounded-xl border border-accent/25 bg-accent/[0.08] p-3 text-sm">
            <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-accent" />
            <p>
              Se recibió la lectura del teléfono. Estamos aplicando las sugerencias para que las
              revises antes de guardar.
            </p>
          </div>
        ) : capture?.status === 'READY' ? (
          <div className="flex items-start gap-3 rounded-xl border border-accent/25 bg-accent/[0.08] p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <p>La lectura ya llegó desde el teléfono. Preparando la revisión…</p>
          </div>
        ) : (
          <div className="rounded-xl bg-muted/50 p-3 text-sm leading-6 text-muted-foreground">
            <strong className="font-medium text-foreground">
              2. Toma la foto y pulsa “Usar OCR”.
            </strong>{' '}
            Esta ventana se actualizará automáticamente cuando el teléfono termine. Puedes cerrar el
            código y continuar manualmente cuando quieras.
          </div>
        )}

        {isLocalLink ? (
          <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm leading-6 text-warning">
            Este QR apunta a <strong>localhost</strong>, que el teléfono no puede abrir. Para probar
            la cámara desde otro dispositivo usa el despliegue HTTPS de Vercel o configura una URL
            pública en <code>NEXT_PUBLIC_APP_URL</code>.
          </p>
        ) : null}
        {isInsecureLink ? (
          <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm leading-6 text-warning">
            La cámara del teléfono requiere una URL HTTPS. Abre esta función desde el despliegue
            seguro de Vercel o usa un túnel HTTPS durante el desarrollo.
          </p>
        ) : null}
        {error ? <p className="rounded-xl bg-danger/10 p-3 text-sm text-danger">{error}</p> : null}

        <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={close} disabled={claiming}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void regenerate()}
            disabled={initializing || claiming}
          >
            <RefreshCw className="h-4 w-4" />
            Generar otro código
          </Button>
        </div>
      </div>
    </SupplierInvoiceDialog>
  );
}

async function cancelCapture(captureId: string, tenantId: string, accessToken: string) {
  try {
    await cancelMobileOcrCapture(tenantId, accessToken, captureId);
  } catch {
    // La sesión puede haber sido consumida, vencido o cancelada previamente.
    // En esos casos ya no hay nada sensible que revocar.
  }
}

function formatRemaining(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')} min`;
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}
