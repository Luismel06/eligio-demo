'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, CircleAlert, UserRoundPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ActionDialog } from '@/components/ui/action-dialog';
import { Input } from '@/components/ui/input';
import {
  createSupplier,
  updateSupplier,
  type Supplier,
  type SupplierPayload,
  type TaxIdentityOverrideResult,
} from '@/lib/api';
import type { AuthSession } from '@/lib/auth-session';
import {
  formatDominicanDocument,
  normalizeDominicanDocument,
  validateDominicanDocument,
} from '@/lib/dominican-documents';
import { FormField, selectClassName } from './procurement-ui';
import { TaxIdentityApprovalRequestPanel } from './tax-identity-approval-request';
import {
  hasVerifiedTaxIdentity,
  TaxIdentityVerification,
  type TaxIdentityVerificationState,
} from './tax-identity-verification';

type SupplierDocumentType = 'RNC' | 'CEDULA';

export type SupplierQuickCreatePrefill = {
  commercialName?: string;
  documentNumber?: string;
  documentType?: SupplierDocumentType;
  phone?: string;
  email?: string;
  paymentTerms?: string;
  creditDays?: number;
};

type SupplierQuickCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: AuthSession | null;
  existingSuppliers?: Supplier[];
  prefill?: SupplierQuickCreatePrefill;
  onCreated: (supplier: Supplier) => void;
  /** Allows the parent flow to select a duplicate instead of creating another record. */
  onExistingSupplier?: (supplier: Supplier) => void;
};

type QuickSupplierForm = {
  commercialName: string;
  legalName: string;
  documentType: SupplierDocumentType;
  documentNumber: string;
  phone: string;
  email: string;
  contactName: string;
  paymentTerms: string;
  creditDays: string;
};

export function SupplierQuickCreateDialog({
  open,
  onOpenChange,
  session,
  existingSuppliers = [],
  prefill,
  onCreated,
  onExistingSupplier,
}: SupplierQuickCreateDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<QuickSupplierForm>(() => buildForm(prefill));
  const [showOptionalFields, setShowOptionalFields] = useState(hasOptionalPrefill(prefill));
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmedSameName, setConfirmedSameName] = useState(false);
  const [taxIdentity, setTaxIdentity] = useState<TaxIdentityVerificationState | null>(null);
  const [taxIdentityContextId, setTaxIdentityContextId] = useState('');
  const [manualOverride, setManualOverride] = useState<TaxIdentityOverrideResult | null>(null);

  useEffect(() => {
    if (!open) {
      setTaxIdentityContextId('');
      setManualOverride(null);
      setTaxIdentity(null);
      return;
    }

    setForm(buildForm(prefill));
    setShowOptionalFields(hasOptionalPrefill(prefill));
    setFormError(null);
    setConfirmedSameName(false);
    setTaxIdentity(null);
    setManualOverride(null);
    setTaxIdentityContextId((current) => current || createTaxIdentityDraftId('supplier-create'));
  }, [
    open,
    prefill?.commercialName,
    prefill?.creditDays,
    prefill?.documentNumber,
    prefill?.documentType,
    prefill?.email,
    prefill?.paymentTerms,
    prefill?.phone,
  ]);

  const normalizedDocument = normalizeDominicanDocument(form.documentNumber);
  const duplicateByDocument = useMemo(
    () =>
      existingSuppliers.find(
        (supplier) =>
          supplier.documentType === form.documentType &&
          supplier.documentNumber === normalizedDocument,
      ),
    [existingSuppliers, form.documentType, normalizedDocument],
  );
  const duplicateByName = useMemo(() => {
    const name = normalizeSupplierName(form.commercialName);
    if (!name) return undefined;

    return existingSuppliers.find((supplier) => {
      const names = [supplier.commercialName, supplier.legalName]
        .filter((value): value is string => Boolean(value))
        .map(normalizeSupplierName);
      return names.includes(name);
    });
  }, [existingSuppliers, form.commercialName]);
  const duplicateNameNeedsConfirmation =
    Boolean(duplicateByName) && duplicateByName?.id !== duplicateByDocument?.id;

  const createMutation = useMutation({
    mutationFn: (payload: SupplierPayload) => {
      if (!session) throw new Error('La sesión ya no está disponible. Vuelve a iniciar sesión.');
      return createSupplier(session.tenantId, session.accessToken, payload);
    },
    onSuccess: async (supplier) => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Suplidor registrado y listo para usar en la factura.');
      onCreated(supplier);
      onOpenChange(false);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'No se pudo crear el suplidor.';
      if (isDuplicateSupplierError(message)) {
        setFormError(
          'Ya existe un suplidor con este RNC o cédula. Búscalo y selecciónalo; si está inactivo, reactívalo desde Suplidores.',
        );
        return;
      }
      setFormError(message);
    },
  });
  const reactivateMutation = useMutation({
    mutationFn: (supplier: Supplier) => {
      if (!session) throw new Error('La sesión ya no está disponible. Vuelve a iniciar sesión.');
      return updateSupplier(session.tenantId, session.accessToken, supplier.id, {
        status: 'ACTIVE',
      });
    },
    onSuccess: async (supplier) => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Suplidor reactivado y listo para usar en la factura.');
      onExistingSupplier?.(supplier);
      onOpenChange(false);
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'No se pudo reactivar el suplidor.');
    },
  });

  const isBusy = createMutation.isPending || reactivateMutation.isPending;

  function close() {
    if (isBusy) return;
    onOpenChange(false);
  }

  function submit() {
    setFormError(null);

    const commercialName = form.commercialName.trim();
    if (!commercialName) {
      setFormError('Indica el nombre comercial del suplidor.');
      return;
    }
    if (!validateDominicanDocument(form.documentType, form.documentNumber)) {
      setFormError(
        form.documentType === 'RNC'
          ? 'El RNC no es válido. Revisa sus 9 dígitos y el verificador.'
          : 'La cédula no es válida. Revisa sus 11 dígitos y el verificador.',
      );
      return;
    }
    if (!hasVerifiedTaxIdentity(taxIdentity, form.documentType, normalizedDocument)) {
      setFormError(
        'Verifica el RNC o la cédula con DGII o consigue autorización administrativa antes de registrar el suplidor.',
      );
      return;
    }
    if (duplicateByDocument) {
      setFormError('Ese RNC o cédula ya está registrado para este suplidor.');
      return;
    }
    if (duplicateNameNeedsConfirmation && !confirmedSameName) {
      setFormError(
        'Ya existe un suplidor con el mismo nombre. Confirma que no es el mismo antes de continuar.',
      );
      return;
    }

    createMutation.mutate({
      commercialName,
      legalName:
        taxIdentity?.result?.outcome === 'VERIFIED'
          ? (taxIdentity.result.fiscalName ?? form.legalName)
          : form.legalName,
      documentType: form.documentType,
      documentNumber: normalizedDocument,
      phone: optional(form.phone),
      email: optional(form.email),
      contactName: optional(form.contactName),
      paymentTerms: optional(form.paymentTerms),
      creditDays: toCreditDays(form.creditDays),
      taxIdentityOverrideId:
        taxIdentity?.result?.source === 'MANUAL_OVERRIDE'
          ? taxIdentity.result.overrideId
          : undefined,
      taxIdentityContextId:
        taxIdentity?.result?.source === 'MANUAL_OVERRIDE' ? taxIdentityContextId : undefined,
    });
  }

  const duplicateSummary = duplicateByDocument ?? duplicateByName;
  const duplicateIsInactive = duplicateSummary?.status === 'INACTIVE';
  const createDisabled =
    isBusy ||
    Boolean(duplicateByDocument) ||
    (duplicateNameNeedsConfirmation && !confirmedSameName) ||
    !hasVerifiedTaxIdentity(taxIdentity, form.documentType, normalizedDocument);

  function handleTaxIdentityChange(state: TaxIdentityVerificationState) {
    setTaxIdentity(state);
    const fiscalName = state.result?.outcome === 'VERIFIED' ? state.result.fiscalName : null;
    if (!fiscalName) return;

    setForm((current) => {
      if (
        current.documentType !== state.documentType ||
        normalizeDominicanDocument(current.documentNumber) !== state.documentNumber ||
        current.legalName === fiscalName
      ) {
        return current;
      }
      return { ...current, legalName: fiscalName };
    });
  }

  function handleManualOverride(result: TaxIdentityOverrideResult) {
    setManualOverride(result);
    setTaxIdentity({
      result,
      documentType: result.documentType,
      documentNumber: normalizeDominicanDocument(result.documentNumber),
      checksumValid: true,
      pending: false,
    });
    setForm((current) => ({
      ...current,
      legalName: result.fiscalName ?? current.legalName,
    }));
  }

  return (
    <>
      <ActionDialog
        open={open}
        onClose={close}
        onConfirm={submit}
        title="Registrar suplidor para esta factura"
        description="Completa los datos básicos. El documento y la razón social se verifican con DGII o mediante autorización administrativa."
        tone="default"
        icon={<UserRoundPlus className="h-5 w-5" aria-hidden="true" />}
        confirmLabel="Registrar y usar suplidor"
        cancelLabel="Cancelar"
        size="lg"
        isPending={isBusy}
        confirmDisabled={createDisabled}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Nombre comercial"
            htmlFor="quick-supplier-commercial"
            className="sm:col-span-2"
          >
            <Input
              id="quick-supplier-commercial"
              data-dialog-autofocus
              required
              maxLength={160}
              value={form.commercialName}
              onChange={(event) => {
                setConfirmedSameName(false);
                setForm((current) => ({
                  ...current,
                  commercialName: event.target.value,
                }));
              }}
              placeholder="Ej.: Comercial del Caribe"
            />
          </FormField>
          <FormField label="Tipo de documento" htmlFor="quick-supplier-document-type">
            <select
              id="quick-supplier-document-type"
              className={selectClassName}
              value={form.documentType}
              onChange={(event) => {
                setConfirmedSameName(false);
                setTaxIdentity(null);
                setManualOverride(null);
                setForm((current) => ({
                  ...current,
                  documentType: event.target.value as SupplierDocumentType,
                  documentNumber: '',
                  legalName: '',
                }));
              }}
            >
              <option value="RNC">RNC</option>
              <option value="CEDULA">Cédula</option>
            </select>
          </FormField>
          <FormField
            label={form.documentType === 'RNC' ? 'RNC' : 'Cédula'}
            htmlFor="quick-supplier-document"
            hint={
              form.documentNumber.trim()
                ? formatDominicanDocument(form.documentType, form.documentNumber)
                : form.documentType === 'RNC'
                  ? 'Ej.: 1-01-00000-1'
                  : 'Ej.: 001-0000000-1'
            }
          >
            <Input
              id="quick-supplier-document"
              required
              inputMode="numeric"
              maxLength={20}
              value={form.documentNumber}
              onChange={(event) => {
                setConfirmedSameName(false);
                setTaxIdentity(null);
                setManualOverride(null);
                setForm((current) => ({
                  ...current,
                  documentNumber: event.target.value,
                  legalName: '',
                }));
              }}
              placeholder={form.documentType === 'RNC' ? '1-01-00000-1' : '001-0000000-1'}
            />
          </FormField>
          <FormField
            label="Razón social verificada"
            htmlFor="quick-supplier-legal"
            className="sm:col-span-2"
          >
            <Input
              id="quick-supplier-legal"
              value={form.legalName}
              readOnly
              placeholder="Se completará al verificar o recibir aprobación"
            />
          </FormField>
          <TaxIdentityVerification
            tenantId={session?.tenantId ?? ''}
            accessToken={session?.accessToken ?? ''}
            documentType={form.documentType}
            documentNumber={form.documentNumber}
            onChange={handleTaxIdentityChange}
            manualOverride={manualOverride}
            manualReviewAction={
              session && taxIdentityContextId ? (
                <TaxIdentityApprovalRequestPanel
                  tenantId={session.tenantId}
                  accessToken={session.accessToken}
                  contextType="SUPPLIER_CREATE"
                  contextId={taxIdentityContextId}
                  documentType={form.documentType}
                  documentNumber={form.documentNumber}
                  suggestedFiscalName={
                    taxIdentity?.result?.fiscalName || form.legalName || form.commercialName
                  }
                  registryOutcome={taxIdentity?.result?.outcome}
                  disabled={isBusy}
                  compact
                  onApproved={handleManualOverride}
                />
              ) : null
            }
            className="sm:col-span-2"
          />
        </div>

        {duplicateSummary ? (
          <div className="rounded-lg border border-warning/35 bg-warning/10 p-3 text-sm">
            <div className="flex items-start gap-2">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-foreground">
                  {duplicateByDocument
                    ? 'Este documento ya pertenece a un suplidor registrado.'
                    : 'Ya existe un suplidor con el mismo nombre.'}
                </p>
                <p className="text-muted-foreground">
                  {duplicateSummary.commercialName} · {duplicateSummary.documentType}{' '}
                  {formatDominicanDocument(
                    duplicateSummary.documentType,
                    duplicateSummary.documentNumber,
                  )}
                </p>
                {duplicateByDocument ? (
                  <p className="text-xs text-muted-foreground">
                    No se creará un registro nuevo con ese documento.
                  </p>
                ) : (
                  <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 rounded border-input text-primary focus:ring-ring"
                      checked={confirmedSameName}
                      onChange={(event) => setConfirmedSameName(event.target.checked)}
                    />
                    Confirmo que es un suplidor distinto y que su RNC/cédula fue verificado.
                  </label>
                )}
                {onExistingSupplier && duplicateIsInactive ? (
                  <button
                    type="button"
                    className="mt-1 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                    disabled={isBusy}
                    onClick={() => reactivateMutation.mutate(duplicateSummary)}
                  >
                    <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Reactivar y usar suplidor
                  </button>
                ) : onExistingSupplier && !duplicateIsInactive ? (
                  <button
                    type="button"
                    className="mt-1 inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                    disabled={isBusy}
                    onClick={() => {
                      onExistingSupplier(duplicateSummary);
                      onOpenChange(false);
                    }}
                  >
                    <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Usar este suplidor
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Datos opcionales</p>
              <p className="text-xs text-muted-foreground">
                Puedes completarlos ahora o editarlos después desde Suplidores.
              </p>
            </div>
            <button
              type="button"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => setShowOptionalFields((current) => !current)}
            >
              {showOptionalFields ? 'Ocultar' : 'Agregar datos'}
            </button>
          </div>
          {showOptionalFields ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <FormField label="Teléfono" htmlFor="quick-supplier-phone">
                <Input
                  id="quick-supplier-phone"
                  maxLength={40}
                  value={form.phone}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Correo" htmlFor="quick-supplier-email">
                <Input
                  id="quick-supplier-email"
                  type="email"
                  maxLength={254}
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Persona de contacto" htmlFor="quick-supplier-contact">
                <Input
                  id="quick-supplier-contact"
                  maxLength={160}
                  value={form.contactName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      contactName: event.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Condición de pago" htmlFor="quick-supplier-terms">
                <Input
                  id="quick-supplier-terms"
                  maxLength={240}
                  value={form.paymentTerms}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      paymentTerms: event.target.value,
                    }))
                  }
                  placeholder="Ej.: crédito a 30 días"
                />
              </FormField>
              <FormField label="Días de crédito" htmlFor="quick-supplier-credit-days">
                <Input
                  id="quick-supplier-credit-days"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={3650}
                  value={form.creditDays}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      creditDays: event.target.value,
                    }))
                  }
                />
              </FormField>
            </div>
          ) : null}
        </div>

        {formError ? (
          <div
            className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
            role="alert"
            aria-live="assertive"
          >
            {formError}
          </div>
        ) : null}
      </ActionDialog>
    </>
  );
}

function buildForm(prefill?: SupplierQuickCreatePrefill): QuickSupplierForm {
  const documentNumber = prefill?.documentNumber ?? '';
  return {
    commercialName: prefill?.commercialName?.trim() ?? '',
    legalName: '',
    documentType: prefill?.documentType ?? inferDocumentType(documentNumber),
    documentNumber,
    phone: prefill?.phone ?? '',
    email: prefill?.email ?? '',
    contactName: '',
    paymentTerms: prefill?.paymentTerms ?? '',
    creditDays: prefill?.creditDays === undefined ? '0' : String(prefill.creditDays),
  };
}

function inferDocumentType(value: string): SupplierDocumentType {
  return normalizeDominicanDocument(value).length === 11 ? 'CEDULA' : 'RNC';
}

function hasOptionalPrefill(prefill?: SupplierQuickCreatePrefill) {
  return Boolean(
    prefill?.phone || prefill?.email || prefill?.paymentTerms || prefill?.creditDays !== undefined,
  );
}

function optional(value: string) {
  return value.trim() || undefined;
}

function toCreditDays(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 3650 ? parsed : 0;
}

function normalizeSupplierName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDuplicateSupplierError(message: string) {
  const normalized = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return (
    normalized.includes('ya existe un proveedor con este rnc') ||
    normalized.includes('already exists')
  );
}

function createTaxIdentityDraftId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}
