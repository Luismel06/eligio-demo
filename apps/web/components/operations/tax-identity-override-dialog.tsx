'use client';

import { ShieldCheck } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import { ActionDialog } from '@/components/ui/action-dialog';
import { Input } from '@/components/ui/input';
import {
  authorizeTaxIdentityOverride,
  type TaxIdentityContextType,
  type TaxIdentityDocumentType,
  type TaxIdentityLookupOutcome,
  type TaxIdentityOverrideResult,
} from '@/lib/api';
import type { AuthSession } from '@/lib/auth-session';
import { formatDominicanDocument } from '@/lib/dominican-documents';
import { FormField, textareaClassName } from './procurement-ui';

type TaxIdentityOverrideDialogProps = {
  open: boolean;
  onClose: () => void;
  session: Pick<AuthSession, 'tenantId' | 'accessToken'>;
  contextType: TaxIdentityContextType;
  contextId: string;
  documentType: TaxIdentityDocumentType;
  documentNumber: string;
  suggestedFiscalName?: string | null;
  registryOutcome?: TaxIdentityLookupOutcome | null;
  onAuthorized: (result: TaxIdentityOverrideResult) => void;
};

export function TaxIdentityOverrideDialog({
  open,
  onClose,
  session,
  contextType,
  contextId,
  documentType,
  documentNumber,
  suggestedFiscalName,
  registryOutcome,
  onAuthorized,
}: TaxIdentityOverrideDialogProps) {
  const errorId = useId();
  const [fiscalName, setFiscalName] = useState('');
  const [reason, setReason] = useState('');
  const [supervisorEmail, setSupervisorEmail] = useState('');
  const [supervisorPassword, setSupervisorPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setFiscalName(suggestedFiscalName?.trim() ?? '');
      setReason('');
      setSupervisorEmail('');
      setSupervisorPassword('');
      setError(null);
      return;
    }

    clearDialogState();
    // The dialog is intentionally reset only when its open state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function clearDialogState() {
    setFiscalName('');
    setReason('');
    setSupervisorEmail('');
    setSupervisorPassword('');
    setError(null);
  }

  function close() {
    if (pending) return;
    clearDialogState();
    onClose();
  }

  async function authorize() {
    const normalizedFiscalName = fiscalName.trim();
    const normalizedReason = reason.trim();
    const normalizedEmail = supervisorEmail.trim().toLowerCase();

    if (!contextId.trim()) {
      setError('El formulario perdió su identificador de seguridad. Ciérralo e intenta de nuevo.');
      return;
    }
    if (!normalizedFiscalName) {
      setError('Indica el nombre o la razón social que aparecerá en el documento fiscal.');
      return;
    }
    if (normalizedReason.length < 10) {
      setError('Explica el motivo de la autorización con al menos 10 caracteres.');
      return;
    }
    if (!normalizedEmail || !supervisorPassword) {
      setError('Ingresa el correo y la contraseña del supervisor.');
      return;
    }

    const passwordForRequest = supervisorPassword;
    setSupervisorPassword('');
    setError(null);
    setPending(true);

    try {
      const result = await authorizeTaxIdentityOverride(session.tenantId, session.accessToken, {
        contextType,
        contextId,
        documentType,
        documentNumber,
        fiscalName: normalizedFiscalName,
        reason: normalizedReason,
        supervisorEmail: normalizedEmail,
        supervisorPassword: passwordForRequest,
        expiresInMinutes: 10,
      });

      clearDialogState();
      toast.success('Autorización fiscal aprobada por el supervisor.', {
        description: 'Guarda el registro antes de que la autorización expire.',
      });
      onAuthorized(result);
      onClose();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'No se pudo validar la autorización del supervisor.',
      );
    } finally {
      setSupervisorPassword('');
      setPending(false);
    }
  }

  const confirmDisabled =
    !fiscalName.trim() ||
    reason.trim().length < 10 ||
    !supervisorEmail.trim() ||
    supervisorPassword.length < 8;

  return (
    <ActionDialog
      open={open}
      onClose={close}
      onConfirm={() => void authorize()}
      title="Autorizar identidad fiscal manualmente"
      description="Un supervisor debe confirmar este caso excepcional. La autorización queda auditada, vinculada a este formulario y vence en 10 minutos."
      tone="warning"
      icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
      confirmLabel="Autorizar por 10 minutos"
      cancelLabel="Cancelar"
      size="lg"
      isPending={pending}
      confirmDisabled={confirmDisabled}
      summary={
        <div className="space-y-1">
          <p className="font-semibold">
            {documentType} {formatDominicanDocument(documentType, documentNumber)}
          </p>
          <p className="text-xs text-muted-foreground">
            Resultado del padrón: {registryOutcomeLabel(registryOutcome)}
          </p>
        </div>
      }
    >
      <form
        className="grid gap-4 sm:grid-cols-2"
        aria-describedby={error ? errorId : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmDisabled && !pending) void authorize();
        }}
      >
        <FormField
          label="Nombre o razón social fiscal"
          htmlFor="tax-override-fiscal-name"
          className="sm:col-span-2"
          hint="Este nombre se utilizará como identidad fiscal si el supervisor aprueba."
        >
          <Input
            id="tax-override-fiscal-name"
            data-dialog-autofocus
            value={fiscalName}
            maxLength={200}
            onChange={(event) => setFiscalName(event.target.value)}
            autoComplete="off"
            required
          />
        </FormField>
        <FormField
          label="Motivo de la excepción"
          htmlFor="tax-override-reason"
          className="sm:col-span-2"
          hint="Mínimo 10 caracteres. No incluyas contraseñas ni información innecesaria."
        >
          <textarea
            id="tax-override-reason"
            className={textareaClassName}
            value={reason}
            minLength={10}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            required
          />
        </FormField>
        <FormField label="Correo del supervisor" htmlFor="tax-override-supervisor-email">
          <Input
            id="tax-override-supervisor-email"
            type="email"
            value={supervisorEmail}
            maxLength={254}
            onChange={(event) => setSupervisorEmail(event.target.value)}
            autoComplete="username"
            required
          />
        </FormField>
        <FormField
          label="Contraseña del supervisor"
          htmlFor="tax-override-supervisor-password"
          hint="Se envía una sola vez para autorizar y se elimina inmediatamente del formulario."
        >
          <Input
            id="tax-override-supervisor-password"
            type="password"
            value={supervisorPassword}
            minLength={8}
            maxLength={200}
            onChange={(event) => setSupervisorPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </FormField>
        {error ? (
          <div
            id={errorId}
            className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger sm:col-span-2"
            role="alert"
            aria-live="assertive"
          >
            {error}
          </div>
        ) : null}
      </form>
    </ActionDialog>
  );
}

function registryOutcomeLabel(outcome?: TaxIdentityLookupOutcome | null) {
  if (outcome === 'NOT_FOUND') return 'No encontrado';
  if (outcome === 'NON_ACTIVE') return 'Contribuyente no activo';
  if (outcome === 'REGISTRY_STALE') return 'Padrón desactualizado';
  if (outcome === 'UNAVAILABLE') return 'Consulta no disponible';
  if (outcome === 'VERIFIED') return 'Verificado';
  return 'No verificado';
}
