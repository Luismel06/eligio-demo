'use client';

import { ActionDialog } from '@/components/ui/action-dialog';

type WarningConfirmModalProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  isPending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function WarningConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  isPending = false,
  onClose,
  onConfirm,
}: WarningConfirmModalProps) {
  return (
    <ActionDialog
      open={open}
      title={title}
      description={description}
      tone="warning"
      confirmLabel={confirmLabel}
      cancelLabel="Revisar monto"
      isPending={isPending}
      onClose={onClose}
      onConfirm={onConfirm}
    />
  );
}