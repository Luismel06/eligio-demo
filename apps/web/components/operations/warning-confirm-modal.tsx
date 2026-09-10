'use client';

import { ActionDialog } from '@/components/ui/action-dialog';
import type { ActionDialogTone } from '@/components/ui/action-dialog';

type WarningConfirmModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  isPending?: boolean;
  tone?: ActionDialogTone;
  onClose: () => void;
  onConfirm: () => void;
};

export function WarningConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Revisar monto',
  isPending = false,
  tone = 'warning',
  onClose,
  onConfirm,
}: WarningConfirmModalProps) {
  return (
    <ActionDialog
      open={open}
      title={title}
      description={description}
      tone={tone}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      isPending={isPending}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}
