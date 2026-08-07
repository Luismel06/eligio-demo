'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  LoaderCircle,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export type ActionDialogTone = 'default' | 'warning' | 'danger' | 'success';

type ActionDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  summary?: ReactNode;
  children?: ReactNode;
  tone?: ActionDialogTone;
  icon?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  isPending?: boolean;
  confirmDisabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  onClose: () => void;
  onConfirm: () => void;
};

const toneStyles: Record<
  ActionDialogTone,
  { icon: string; border: string; accent: string; button: string }
> = {
  default: {
    icon: 'bg-primary text-primary-foreground',
    border: 'border-primary/15',
    accent: 'from-primary/[0.09] via-card to-accent/[0.10]',
    button: '',
  },
  warning: {
    icon: 'bg-warning text-white',
    border: 'border-warning/25',
    accent: 'from-warning/[0.13] via-card to-card',
    button: 'bg-warning text-white hover:bg-warning/90',
  },
  danger: {
    icon: 'bg-danger text-white',
    border: 'border-danger/25',
    accent: 'from-danger/[0.12] via-card to-card',
    button: 'bg-danger text-white hover:bg-danger/90',
  },
  success: {
    icon: 'bg-success text-white',
    border: 'border-success/25',
    accent: 'from-success/[0.11] via-card to-card',
    button: 'bg-success text-white hover:bg-success/90',
  },
};

const defaultIcons: Record<ActionDialogTone, ReactNode> = {
  default: <Info className="h-5 w-5" aria-hidden="true" />,
  warning: <AlertTriangle className="h-5 w-5" aria-hidden="true" />,
  danger: <ShieldAlert className="h-5 w-5" aria-hidden="true" />,
  success: <CheckCircle2 className="h-5 w-5" aria-hidden="true" />,
};

export function ActionDialog({
  open,
  title,
  description,
  summary,
  children,
  tone = 'default',
  icon,
  confirmLabel,
  cancelLabel = 'Volver',
  isPending = false,
  confirmDisabled = false,
  size = 'md',
  onClose,
  onConfirm,
}: ActionDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descriptionId = useId();
  const styles = toneStyles[tone];

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusInitialElement = () => {
      const preferred = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-autofocus]');
      (preferred ?? closeButtonRef.current)?.focus();
    };
    const focusTimer = window.setTimeout(focusInitialElement, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!isPending) {
          event.preventDefault();
          onCloseRef.current();
        }
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus?.();
    };
  }, [isPending, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-primary/65 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'w-full overflow-hidden rounded-xl border bg-card shadow-[0_24px_70px_-24px_rgb(15_23_42/0.55)]',
          styles.border,
          size === 'sm' && 'max-w-md',
          size === 'md' && 'max-w-lg',
          size === 'lg' && 'max-w-2xl',
        )}
      >
        <div className={cn('border-b bg-gradient-to-br px-5 py-4 sm:px-6', styles.accent)}>
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg shadow-sm',
                styles.icon,
              )}
            >
              {icon ?? defaultIcons[tone]}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Confirmación requerida
              </p>
              <h2 id={titleId} className="mt-1 text-lg font-semibold tracking-tight text-foreground">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="-mr-1 -mt-1 rounded-md p-2 text-muted-foreground transition-colors hover:bg-card/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              aria-label="Cerrar diálogo"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {summary || children ? (
          <div className="max-h-[min(56vh,34rem)] space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
            {summary ? <div className="rounded-lg border border-border bg-muted/35 p-3 text-sm">{summary}</div> : null}
            {children}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 border-t bg-muted/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            className={styles.button}
            onClick={onConfirm}
            disabled={isPending || confirmDisabled}
          >
            {isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {isPending ? 'Procesando...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
