'use client';

import { ActionDialog, type ActionDialogTone } from '@/components/ui/action-dialog';
import { Label } from '@/components/ui/label';

type CancelReasonModalProps = {
  open: boolean;
  title: string;
  description: string;
  reason: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ActionDialogTone;
  inputLabel?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  isPending?: boolean;
  onReasonChange: (reason: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function CancelReasonModal({
  open,
  title,
  description,
  reason,
  confirmLabel = 'Confirmar cancelación',
  cancelLabel = 'Atrás',
  tone = 'danger',
  inputLabel = 'Motivo',
  placeholder = 'Explica brevemente el motivo de esta acción.',
  hint = 'Este motivo quedará guardado en el historial para auditoría.',
  required = true,
  isPending = false,
  onReasonChange,
  onClose,
  onConfirm,
}: CancelReasonModalProps) {
  return (
    <ActionDialog
      open={open}
      title={title}
      description={description}
      tone={tone}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      isPending={isPending}
      confirmDisabled={required && !reason.trim()}
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="cancelReason">
            {inputLabel} {required ? <span className="text-danger">*</span> : null}
          </Label>
          <textarea
            id="cancelReason"
            data-dialog-autofocus
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            className="min-h-28 w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={300}
            placeholder={placeholder}
          />
        </div>
        <p className="rounded-md bg-muted/45 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {hint}
        </p>
      </div>
    </ActionDialog>
  );
}