import type { ReactNode } from 'react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const statusLabels: Record<string, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  DRAFT: 'Borrador',
  REQUESTED: 'Solicitada',
  UNDER_REVIEW: 'En revisión',
  APPROVED: 'Aprobada',
  ISSUED: 'Emitida',
  PARTIALLY_RECEIVED: 'Recibida parcialmente',
  RECEIVED: 'Recibida',
  PAUSED: 'Pausada',
  CANCELLED: 'Cancelada',
  PENDING: 'Pendiente',
  PARTIALLY_PAID: 'Pagada parcialmente',
  PAID: 'Pagada',
  OVERDUE: 'En retraso',
  CONFIRMED: 'Confirmada',
  REVERSED: 'Revertida',
  COMPLETED: 'Completado',
};

export function procurementStatusLabel(status: string) {
  return statusLabels[status] ?? status.replaceAll('_', ' ').toLowerCase();
}

export function ProcurementStatusBadge({ status }: { status: string }) {
  const variant =
    status === 'ACTIVE' ||
    status === 'PAID' ||
    status === 'RECEIVED' ||
    status === 'CONFIRMED' ||
    status === 'COMPLETED'
      ? 'success'
      : status === 'CANCELLED' ||
          status === 'REVERSED' ||
          status === 'OVERDUE' ||
          status === 'INACTIVE'
        ? 'danger'
        : status === 'PAUSED' ||
            status === 'PENDING' ||
            status === 'PARTIALLY_PAID' ||
            status === 'PARTIALLY_RECEIVED'
          ? 'warning'
          : 'outline';

  return <Badge variant={variant}>{procurementStatusLabel(status)}</Badge>;
}

export function FormField({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function QueryState({
  loading,
  error,
  empty,
  emptyMessage,
}: {
  loading?: boolean;
  error?: unknown;
  empty?: boolean;
  emptyMessage?: string;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-md border border-dashed p-8 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        Cargando información...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{error instanceof Error ? error.message : 'No se pudo cargar la información.'}</span>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        {emptyMessage ?? 'No hay registros para mostrar.'}
      </div>
    );
  }

  return null;
}

export const selectClassName =
  'h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export const textareaClassName =
  'min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
