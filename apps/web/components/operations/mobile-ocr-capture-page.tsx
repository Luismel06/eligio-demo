'use client';

import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  ScanText,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { SupplierInvoiceOcrCamera } from '@/components/operations/supplier-invoice-ocr-camera';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMobileOcrCaptureForPhone, submitMobileOcrCaptureResult } from '@/lib/api';
import type { SupplierInvoiceOcrItem, SupplierInvoiceOcrResult } from '@/lib/supplier-invoice-ocr';

type MobileOcrCapturePageProps = {
  sessionId: string;
};

type CapturePhase = 'checking' | 'ready' | 'sending' | 'sent' | 'unavailable';

/**
 * Payload deliberately excludes rawText and every captured image. The OCR
 * happens in the browser on the phone and only its reviewed suggestions are
 * sent to the paired desktop session.
 */
type MobileOcrResult = Omit<SupplierInvoiceOcrResult, 'rawText' | 'items'> & {
  items: Array<Omit<SupplierInvoiceOcrItem, 'rawText'>>;
};

type CaptureAvailability = {
  status?: string;
  expiresAt?: string | null;
};

export function MobileOcrCapturePage({ sessionId }: MobileOcrCapturePageProps) {
  const [phase, setPhase] = useState<CapturePhase>('checking');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureToken, setCaptureToken] = useState<string | null>(null);
  const [message, setMessage] = useState('Comprobando que este enlace siga activo…');
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const validateCapture = useCallback(
    async (token: string) => {
      try {
        const capture = (await getMobileOcrCaptureForPhone(
          sessionId,
          token,
        )) as CaptureAvailability;
        const status = capture.status?.toUpperCase();
        const expires = capture.expiresAt ?? null;
        setExpiresAt(expires);

        if (isExpired(expires) || status === 'EXPIRED' || status === 'CANCELLED') {
          setPhase('unavailable');
          setMessage('Este enlace ya venció o fue cancelado. Pide que generen un código nuevo.');
          return;
        }

        if (
          status === 'READY' ||
          status === 'SUBMITTED' ||
          status === 'COMPLETED' ||
          status === 'CONSUMED'
        ) {
          setPhase('sent');
          setMessage('La información ya fue enviada. Vuelve a la computadora para continuar.');
          return;
        }

        if (status && status !== 'PENDING' && status !== 'OPEN' && status !== 'CLAIMED') {
          setPhase('unavailable');
          setMessage('Este enlace ya no está disponible. Pide que generen un código nuevo.');
          return;
        }

        setPhase('ready');
        setMessage('');
      } catch {
        // No exponemos el detalle del API: un enlace inválido y uno vencido se
        // presentan igual para no revelar información de la sesión de compra.
        setPhase('unavailable');
        setMessage('El enlace no es válido o ya venció. Pide que generen un código nuevo.');
      }
    },
    [sessionId],
  );

  useEffect(() => {
    const token = readTokenFromFragment();
    if (!token) {
      setPhase('unavailable');
      setMessage(
        'Falta el código seguro de esta captura. Escanea nuevamente el QR desde la computadora.',
      );
      return;
    }

    // El fragmento nunca se envía al servidor. Una vez leído, también lo
    // quitamos de la barra del navegador para evitar que se copie por error.
    window.history.replaceState(null, document.title, window.location.pathname);
    setCaptureToken(token);
    void validateCapture(token);
  }, [validateCapture]);

  function handleRecognized(result: SupplierInvoiceOcrResult) {
    if (!captureToken) return;

    setCaptureOpen(false);
    setPhase('sending');
    setMessage('Enviando las sugerencias OCR a la computadora…');

    const mobileResult: MobileOcrResult = {
      ...withoutRawOcrText(result),
      items: result.items.map(({ rawText: _rawText, ...item }) => item),
    };
    void submitMobileOcrCaptureResult(sessionId, captureToken, mobileResult)
      .then(() => {
        setPhase('sent');
        setMessage('Listo. Los datos están esperando en la computadora para que los revises.');
      })
      .catch(async () => {
        // The request can reach the API while the response is interrupted on
        // the phone. Verify once before asking the user to repeat OCR, because
        // the one-use result may already be waiting on the desktop.
        try {
          const capture = (await getMobileOcrCaptureForPhone(
            sessionId,
            captureToken,
          )) as CaptureAvailability;
          if (capture.status?.toUpperCase() === 'READY') {
            setPhase('sent');
            setMessage('Los datos llegaron a la computadora. Vuelve para revisarlos.');
            return;
          }
        } catch {
          // Keep the generic retry state below so no session details leak.
        }
        setPhase('ready');
        setMessage(
          'No se pudieron enviar los datos. Revisa tu conexión e inténtalo de nuevo antes de que venza el enlace.',
        );
      });
  }

  return (
    <main className="min-h-dvh bg-[radial-gradient(circle_at_top,_hsl(var(--accent)/0.18),_transparent_42%),linear-gradient(145deg,_hsl(var(--background)),_hsl(var(--muted)/0.65))] px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-xl flex-col justify-center">
        <div className="mb-5 flex items-center justify-center gap-2 text-sm font-semibold text-primary">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <ScanText className="h-5 w-5" aria-hidden="true" />
          </span>
          Ferretería RIVNU
        </div>

        <Card className="overflow-hidden rounded-2xl border-primary/15 shadow-[0_24px_70px_-35px_rgb(15_23_42/0.45)]">
          <CardHeader className="border-b bg-gradient-to-br from-primary/[0.10] via-card to-accent/[0.12] p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                {phase === 'sent' ? (
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                ) : phase === 'unavailable' ? (
                  <AlertCircle className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Smartphone className="h-5 w-5" aria-hidden="true" />
                )}
              </div>
              <div className="min-w-0">
                <Badge
                  variant={
                    phase === 'unavailable' ? 'danger' : phase === 'sent' ? 'success' : 'outline'
                  }
                >
                  Captura desde teléfono
                </Badge>
                <CardTitle className="mt-2 text-xl sm:text-2xl">
                  {phase === 'sent'
                    ? 'Información enviada'
                    : phase === 'unavailable'
                      ? 'Enlace no disponible'
                      : 'Escanea la factura'}
                </CardTitle>
                <CardDescription className="mt-2 leading-6">
                  {phase === 'sent'
                    ? 'La foto no se conservó ni se adjuntó a la factura.'
                    : phase === 'unavailable'
                      ? 'Por seguridad, estos enlaces son temporales y de un solo uso.'
                      : 'Usa la cámara de este teléfono para leer la factura y enviarla a la computadora.'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-5 sm:p-6">
            {phase === 'checking' ? <CheckingState message={message} /> : null}

            {phase === 'ready' ? (
              <div className="space-y-5">
                {message ? (
                  <p className="rounded-xl bg-danger/10 px-3 py-2.5 text-sm leading-6 text-danger">
                    {message}
                  </p>
                ) : null}
                <ol className="space-y-3 text-sm leading-6 text-muted-foreground">
                  <Instruction
                    number="1"
                    text="Toma una foto nítida o selecciona una imagen de la factura."
                  />
                  <Instruction
                    number="2"
                    text="El teléfono hará el OCR localmente; la imagen no se sube."
                  />
                  <Instruction
                    number="3"
                    text="Los datos llegarán a la computadora para revisarlos antes de guardar."
                  />
                </ol>
                {expiresAt ? (
                  <div className="flex items-center gap-2 rounded-xl border bg-muted/35 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                    <Clock3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Este enlace vence {formatExpiration(expiresAt)}.
                  </div>
                ) : null}
                <Button className="w-full" onClick={() => setCaptureOpen(true)}>
                  <Camera className="h-4 w-4" />
                  Abrir cámara y escanear
                </Button>
                <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                  <ShieldCheck
                    className="mt-0.5 h-4 w-4 shrink-0 text-success"
                    aria-hidden="true"
                  />
                  Este acceso solo permite enviar un resultado temporal a la sesión que generó el
                  QR.
                </p>
              </div>
            ) : null}

            {phase === 'sending' ? <CheckingState message={message} /> : null}

            {phase === 'sent' ? (
              <div className="space-y-5 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-success/12 text-success">
                  <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-base font-semibold">Vuelve a la computadora</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p>
                </div>
                <p className="rounded-xl bg-muted/50 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                  Puedes cerrar esta página. La foto fue usada solo en este teléfono durante el OCR.
                </p>
              </div>
            ) : null}

            {phase === 'unavailable' ? (
              <div className="space-y-4 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-danger/10 text-danger">
                  <AlertCircle className="h-8 w-8" aria-hidden="true" />
                </div>
                <p className="text-sm leading-6 text-muted-foreground">{message}</p>
                <p className="text-xs leading-5 text-muted-foreground">
                  Regresa a la pantalla de factura en la computadora y genera un QR nuevo.
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <SupplierInvoiceOcrCamera
        open={captureOpen && phase === 'ready'}
        onClose={() => setCaptureOpen(false)}
        onRecognized={handleRecognized}
      />
    </main>
  );
}

function CheckingState({ message }: { message: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <LoaderCircle className="h-6 w-6 animate-spin" aria-hidden="true" />
      </span>
      <p className="max-w-sm text-sm leading-6 text-muted-foreground">{message}</p>
    </div>
  );
}

function Instruction({ number, text }: { number: string; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
        {number}
      </span>
      <span>{text}</span>
    </li>
  );
}

function readTokenFromFragment() {
  if (typeof window === 'undefined') return null;
  const token = new URLSearchParams(window.location.hash.slice(1)).get('t')?.trim();
  return token && token.length >= 16 ? token : null;
}

function isExpired(value: string | null) {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function formatExpiration(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'pronto';
  return new Intl.DateTimeFormat('es-DO', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function withoutRawOcrText({ rawText: _rawText, ...result }: SupplierInvoiceOcrResult) {
  return result;
}
