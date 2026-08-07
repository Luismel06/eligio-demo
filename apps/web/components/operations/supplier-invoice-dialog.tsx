'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

type SupplierInvoiceDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  eyebrow?: string;
  icon?: ReactNode;
  size?: 'md' | 'lg' | 'xl';
  layer?: 'base' | 'overlay';
  children: ReactNode;
  onClose: () => void;
};

export function SupplierInvoiceDialog({
  open,
  title,
  description,
  eyebrow = 'Factura de suplidor',
  icon,
  size = 'xl',
  layer = 'base',
  children,
  onClose,
}: SupplierInvoiceDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 ${layer === 'overlay' ? 'z-[110]' : 'z-[90]'} flex items-center justify-center bg-primary/70 p-3 sm:p-5`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={
          `flex max-h-[calc(100dvh-1.5rem)] w-full flex-col overflow-hidden rounded-2xl border border-primary/15 bg-card shadow-[0_30px_90px_-30px_rgb(15_23_42/0.72)] sm:max-h-[calc(100dvh-2.5rem)] ` +
          (size === 'md' ? 'max-w-2xl' : size === 'lg' ? 'max-w-4xl' : 'max-w-6xl')
        }
      >
        <div className="border-b bg-gradient-to-br from-primary/[0.10] via-card to-accent/[0.10] px-4 py-4 sm:px-6">
          <div className="flex items-start gap-3 sm:gap-4">
            {icon ? (
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                {icon}
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {eyebrow}
              </p>
              <h2
                id={titleId}
                className="mt-1 text-lg font-semibold tracking-tight text-foreground sm:text-xl"
              >
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="-mr-1 -mt-1 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-card/85 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Cerrar ventana"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
