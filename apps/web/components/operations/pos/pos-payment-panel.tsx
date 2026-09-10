'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, LoaderCircle, ReceiptText, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type {
  CustomerDocumentType,
  FiscalDocumentPurpose,
  InvoiceDocumentType,
  PosPaymentMethod,
  SalesOrder,
  TaxIdentityLookup,
} from '@/lib/api';
import { lookupTaxIdentity, updatePosOrderFiscalDetails } from '@/lib/api';
import {
  formatDominicanDocument,
  normalizeDominicanDocument,
  validateDominicanDocument,
} from '@/lib/dominican-documents';
import { cn, formatCurrency } from '@/lib/utils';
import {
  formatCurrencyInput,
  formatCurrencyInputFromNumber,
  sanitizeCurrencyInput,
} from './currency-input';
import { PaymentCalculator } from './payment-calculator';
import type { PosTotals } from './types';
import { TaxIdentityApprovalRequestPanel } from '../tax-identity-approval-request';

type PosPaymentPanelProps = {
  tenantId: string;
  accessToken: string;
  order: SalesOrder | null;
  fiscalPurpose: FiscalDocumentPurpose;
  fiscalDocumentType: InvoiceDocumentType;
  paymentMethod: PosPaymentMethod;
  salePaymentMode: 'CASH' | 'CREDIT';
  dueDate?: string | null;
  amountReceived: string;
  totals: PosTotals;
  message: string | null;
  canCompleteSale: boolean;
  isCompleting: boolean;
  onPaymentMethodChange: (value: PosPaymentMethod) => void;
  onAmountReceivedChange: (value: string) => void;
  onFiscalOrderUpdated: (order: SalesOrder) => void;
  onCompleteSale: () => void;
};

type FiscalIdentityDocumentType = Extract<CustomerDocumentType, 'RNC' | 'CEDULA'>;
type UsableTaxIdentityLookup = TaxIdentityLookup & {
  overrideId?: string;
  expiresAt?: string;
};
type TaxIdentityLookupRequest = {
  orderId: string;
  documentType: FiscalIdentityDocumentType;
  documentNumber: string;
};

export function PosPaymentPanel({
  tenantId,
  accessToken,
  order,
  fiscalPurpose,
  fiscalDocumentType,
  paymentMethod,
  salePaymentMode,
  dueDate,
  amountReceived,
  totals,
  message,
  canCompleteSale,
  isCompleting,
  onPaymentMethodChange,
  onAmountReceivedChange,
  onFiscalOrderUpdated,
  onCompleteSale,
}: PosPaymentPanelProps) {
  const queryClient = useQueryClient();
  const [draftPurpose, setDraftPurpose] = useState<FiscalDocumentPurpose>(fiscalPurpose);
  const [draftDocumentType, setDraftDocumentType] = useState<FiscalIdentityDocumentType>('RNC');
  const [draftDocumentNumber, setDraftDocumentNumber] = useState('');
  const [overrideClockMs, setOverrideClockMs] = useState(() => Date.now());
  const activeOrderIdRef = useRef(order?.id);
  const lastAutomaticLookupKeyRef = useRef<string | null>(null);
  const [taxIdentityLookup, setTaxIdentityLookup] = useState<{
    orderId: string;
    documentType: FiscalIdentityDocumentType;
    documentNumber: string;
    result: UsableTaxIdentityLookup;
  } | null>(null);

  activeOrderIdRef.current = order?.id;

  useEffect(() => {
    const persistedIdentity = getPersistedFiscalIdentity(order);
    setDraftPurpose(fiscalPurpose);
    setDraftDocumentType(persistedIdentity?.documentType ?? 'RNC');
    setDraftDocumentNumber(persistedIdentity?.documentNumber ?? '');
  }, [
    fiscalPurpose,
    order?.fiscalCustomerSnapshot?.documentNumber,
    order?.fiscalCustomerSnapshot?.documentType,
    order?.id,
  ]);

  const cashInsufficient =
    paymentMethod === 'CASH' &&
    totals.requiredPayment > 0 &&
    totals.received < totals.requiredPayment;
  const cashPayment = paymentMethod === 'CASH';
  const creditSale = salePaymentMode === 'CREDIT';
  const draftFiscalDocumentType = getDraftFiscalDocumentType(fiscalDocumentType, draftPurpose);
  const fiscalDocument = getFiscalDocumentDisplay(draftPurpose, draftFiscalDocumentType);
  const operationalCustomerName = getOrderOperationalName(order);
  const persistedIdentity = getPersistedFiscalIdentity(order);
  const normalizedDraftDocumentNumber = normalizeDominicanDocument(draftDocumentNumber);
  const inlineIdentityRequired =
    draftPurpose === 'FISCAL_CREDIT' ||
    (draftFiscalDocumentType === 'CONSUMER_02' && totals.subtotal >= 250_000);
  const operationalNameMissing = inlineIdentityRequired && !operationalCustomerName;
  const fiscalDocumentInvalid =
    inlineIdentityRequired &&
    !validateDominicanDocument(draftDocumentType, normalizedDraftDocumentNumber);
  const matchingLocalTaxIdentityLookup =
    taxIdentityLookup !== null &&
    taxIdentityLookup.orderId === order?.id &&
    taxIdentityLookup.documentType === draftDocumentType &&
    taxIdentityLookup.documentNumber === normalizedDraftDocumentNumber
      ? taxIdentityLookup
      : null;
  const localTaxIdentityLookup = matchingLocalTaxIdentityLookup?.result ?? null;
  const localOverrideExpiresAtMs =
    localTaxIdentityLookup?.source === 'MANUAL_OVERRIDE'
      ? parseTimestamp(localTaxIdentityLookup.expiresAt)
      : null;
  const localOverrideExpired = Boolean(
    localTaxIdentityLookup?.source === 'MANUAL_OVERRIDE' &&
    (localOverrideExpiresAtMs === null || localOverrideExpiresAtMs <= overrideClockMs),
  );
  const persistedTaxIdentityLookup = getPersistedTaxIdentityLookup(order);
  const currentTaxIdentityLookup = matchingLocalTaxIdentityLookup
    ? localOverrideExpired
      ? null
      : localTaxIdentityLookup
    : persistedTaxIdentityLookup?.documentType === draftDocumentType &&
        normalizeDominicanDocument(persistedTaxIdentityLookup.documentNumber) ===
          normalizedDraftDocumentNumber
      ? persistedTaxIdentityLookup
      : null;
  const fiscalIdentityVerified =
    !inlineIdentityRequired ||
    (currentTaxIdentityLookup?.outcome === 'VERIFIED' &&
      currentTaxIdentityLookup.documentType === draftDocumentType &&
      normalizeDominicanDocument(currentTaxIdentityLookup.documentNumber) ===
        normalizedDraftDocumentNumber &&
      Boolean(currentTaxIdentityLookup.fiscalName?.trim()));
  const fiscalIdentityVerificationMissing = inlineIdentityRequired && !fiscalIdentityVerified;
  const persistedDocumentNumber = persistedIdentity
    ? normalizeDominicanDocument(persistedIdentity.documentNumber)
    : '';
  const fiscalIdentityDirty = inlineIdentityRequired
    ? persistedIdentity?.documentType !== draftDocumentType ||
      persistedDocumentNumber !== normalizedDraftDocumentNumber
    : false;
  const canonicalFiscalNameDirty =
    inlineIdentityRequired &&
    fiscalIdentityVerified &&
    normalizeComparableName(order?.fiscalCustomerSnapshot?.name) !==
      normalizeComparableName(currentTaxIdentityLookup?.fiscalName);
  const fiscalDetailsDirty =
    draftPurpose !== fiscalPurpose || fiscalIdentityDirty || canonicalFiscalNameDirty;
  const taxIdentityLookupKey =
    order && inlineIdentityRequired && !fiscalDocumentInvalid
      ? createTaxIdentityLookupKey(order.id, draftDocumentType, normalizedDraftDocumentNumber)
      : null;

  const verifyTaxIdentityMutation = useMutation({
    onMutate: () => {
      setTaxIdentityLookup(null);
    },
    mutationFn: (request: TaxIdentityLookupRequest) => {
      if (!validateDominicanDocument(request.documentType, request.documentNumber)) {
        throw new Error(
          request.documentType === 'RNC'
            ? 'El RNC digitado no es válido.'
            : 'La cédula digitada no es válida.',
        );
      }

      return lookupTaxIdentity(tenantId, accessToken, {
        documentType: request.documentType,
        documentNumber: request.documentNumber,
      });
    },
    onSuccess: (result, request) => {
      if (activeOrderIdRef.current !== request.orderId) {
        return;
      }

      setTaxIdentityLookup({
        orderId: request.orderId,
        documentType: request.documentType,
        documentNumber: request.documentNumber,
        result,
      });

      if (result.outcome === 'VERIFIED' && result.fiscalName?.trim()) {
        toast.success('Identidad fiscal verificada', {
          description: result.fiscalName.trim(),
        });
      }
    },
    onError: (error, request) => {
      if (activeOrderIdRef.current !== request.orderId) {
        return;
      }

      setTaxIdentityLookup(null);
      toast.error(
        error instanceof Error ? error.message : 'No se pudo consultar el padrón de DGII.',
      );
    },
  });

  const saveFiscalDetailsMutation = useMutation({
    mutationFn: () => {
      if (!order) {
        throw new Error('Carga una orden antes de confirmar sus datos fiscales.');
      }

      if (operationalNameMissing) {
        throw new Error('La orden no tiene el nombre operativo requerido para facturar.');
      }

      if (fiscalDocumentInvalid) {
        throw new Error(
          draftDocumentType === 'RNC'
            ? 'El RNC digitado no es válido.'
            : 'La cédula digitada no es válida.',
        );
      }

      if (!fiscalIdentityVerified) {
        throw new Error(
          'Verifica el RNC o la cédula con DGII o consigue autorización administrativa antes de confirmar.',
        );
      }

      return updatePosOrderFiscalDetails(tenantId, accessToken, order.id, {
        fiscalPurpose: draftPurpose,
        ...(inlineIdentityRequired
          ? {
              documentType: draftDocumentType,
              documentNumber: normalizedDraftDocumentNumber,
              ...(currentTaxIdentityLookup?.overrideId
                ? { taxIdentityOverrideId: currentTaxIdentityLookup.overrideId }
                : {}),
            }
          : {}),
      });
    },
    onSuccess: async (updatedOrder) => {
      onFiscalOrderUpdated(updatedOrder);
      setTaxIdentityLookup(null);
      await queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success('Datos fiscales confirmados', {
        description: `${
          getFiscalDocumentDisplay(
            getOrderFiscalPurpose(updatedOrder),
            getOrderFiscalDocumentType(updatedOrder),
          ).purposeLabel
        } listo para facturar.`,
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'No se pudieron confirmar los datos fiscales.',
      );
    },
  });

  useEffect(() => {
    setTaxIdentityLookup(null);
    setOverrideClockMs(Date.now());
    lastAutomaticLookupKeyRef.current = null;
    verifyTaxIdentityMutation.reset();
    saveFiscalDetailsMutation.reset();
    // React Query exposes stable reset callbacks; this effect intentionally follows persisted order identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fiscalPurpose,
    order?.fiscalCustomerSnapshot?.documentNumber,
    order?.fiscalCustomerSnapshot?.documentType,
    order?.id,
  ]);

  useEffect(() => {
    if (localOverrideExpiresAtMs === null || localOverrideExpired) {
      return;
    }

    const updateClock = () => setOverrideClockMs(Date.now());
    const intervalId = window.setInterval(updateClock, 1_000);
    const expirationId = window.setTimeout(
      updateClock,
      Math.max(0, localOverrideExpiresAtMs - Date.now()) + 25,
    );

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(expirationId);
    };
  }, [localOverrideExpiresAtMs, localOverrideExpired]);

  useEffect(() => {
    if (
      !order?.id ||
      !taxIdentityLookupKey ||
      fiscalIdentityVerified ||
      localOverrideExpired ||
      lastAutomaticLookupKeyRef.current === taxIdentityLookupKey
    ) {
      return;
    }

    const request: TaxIdentityLookupRequest = {
      orderId: order.id,
      documentType: draftDocumentType,
      documentNumber: normalizedDraftDocumentNumber,
    };
    const timeoutId = window.setTimeout(() => {
      if (lastAutomaticLookupKeyRef.current === taxIdentityLookupKey) {
        return;
      }

      lastAutomaticLookupKeyRef.current = taxIdentityLookupKey;
      saveFiscalDetailsMutation.reset();
      verifyTaxIdentityMutation.mutate(request);
    }, 650);

    return () => window.clearTimeout(timeoutId);
    // The request is intentionally keyed by the normalized fiscal identity rather than hook objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fiscalIdentityVerified, localOverrideExpired, taxIdentityLookupKey]);

  function invalidateFiscalIdentityVerification() {
    setTaxIdentityLookup(null);
    setOverrideClockMs(Date.now());
    lastAutomaticLookupKeyRef.current = null;
    verifyTaxIdentityMutation.reset();
    saveFiscalDetailsMutation.reset();
  }

  function requestTaxIdentityLookup() {
    if (!order || !taxIdentityLookupKey) {
      return;
    }

    lastAutomaticLookupKeyRef.current = taxIdentityLookupKey;
    saveFiscalDetailsMutation.reset();
    verifyTaxIdentityMutation.mutate({
      orderId: order.id,
      documentType: draftDocumentType,
      documentNumber: normalizedDraftDocumentNumber,
    });
  }

  const fiscalDetailsInvalid =
    operationalNameMissing || fiscalDocumentInvalid || fiscalIdentityVerificationMissing;
  const fiscalDetailsSaving = saveFiscalDetailsMutation.isPending;
  const fiscalIdentityChecking = verifyTaxIdentityMutation.isPending;
  const fiscalDetailsBlockPayment =
    fiscalDetailsDirty || fiscalDetailsInvalid || fiscalDetailsSaving || fiscalIdentityChecking;
  const taxIdentityDisplay = getTaxIdentityOutcomeDisplay(currentTaxIdentityLookup?.outcome);
  const manualIdentityAuthorized = currentTaxIdentityLookup?.source === 'MANUAL_OVERRIDE';
  const taxIdentityHeading = getTaxIdentityHeading(
    currentTaxIdentityLookup,
    fiscalIdentityChecking,
  );
  const overrideRemainingMs =
    manualIdentityAuthorized && localOverrideExpiresAtMs !== null
      ? Math.max(0, localOverrideExpiresAtMs - overrideClockMs)
      : null;
  const lookupAttemptedForCurrentDocument = Boolean(
    taxIdentityLookupKey &&
    (lastAutomaticLookupKeyRef.current === taxIdentityLookupKey ||
      currentTaxIdentityLookup ||
      verifyTaxIdentityMutation.isError),
  );
  const lookupButtonLabel = fiscalIdentityChecking
    ? 'Consultando DGII...'
    : currentTaxIdentityLookup?.outcome === 'VERIFIED'
      ? 'Verificar nuevamente'
      : lookupAttemptedForCurrentDocument
        ? 'Reintentar'
        : 'Verificar ahora';
  const canRequestManualApproval = Boolean(
    order &&
    !fiscalDocumentInvalid &&
    !fiscalIdentityVerified &&
    !fiscalIdentityChecking &&
    (localOverrideExpired ||
      (currentTaxIdentityLookup && currentTaxIdentityLookup.outcome !== 'VERIFIED') ||
      verifyTaxIdentityMutation.isError),
  );

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="space-y-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div>
              <p className="text-sm font-semibold">Confirmación fiscal</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Confirma B02 o B01 antes de cobrar. El NCF se asignará únicamente al emitir la
                factura.
              </p>
            </div>
            <span
              className={cn(
                'w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
                fiscalDetailsDirty || fiscalDetailsInvalid
                  ? 'bg-evc-100 text-evc-900'
                  : 'bg-success/10 text-success',
              )}
              aria-live="polite"
            >
              {fiscalDetailsDirty
                ? 'Cambios sin confirmar'
                : fiscalDetailsInvalid
                  ? 'Requiere corrección'
                  : 'Confirmado'}
            </span>
          </div>

          <fieldset
            className="space-y-2"
            disabled={!order || fiscalDetailsSaving || fiscalIdentityChecking || isCompleting}
          >
            <legend className="text-sm font-medium">Tipo de comprobante</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={draftPurpose === 'CONSUMER'}
                onClick={() => {
                  setDraftPurpose('CONSUMER');
                  invalidateFiscalIdentityVerification();
                }}
                className={cn(
                  'rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                  draftPurpose === 'CONSUMER'
                    ? 'border-evc-500 bg-evc-50 ring-1 ring-evc-300/60'
                    : 'border-zinc-200 bg-white hover:bg-zinc-50',
                )}
              >
                <span className="block text-sm font-semibold">Consumo · B02</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Venta normal. Es la opción predeterminada.
                </span>
              </button>
              <button
                type="button"
                aria-pressed={draftPurpose === 'FISCAL_CREDIT'}
                onClick={() => {
                  setDraftPurpose('FISCAL_CREDIT');
                  invalidateFiscalIdentityVerification();
                }}
                className={cn(
                  'rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                  draftPurpose === 'FISCAL_CREDIT'
                    ? 'border-evc-500 bg-evc-50 ring-1 ring-evc-300/60'
                    : 'border-zinc-200 bg-white hover:bg-zinc-50',
                )}
              >
                <span className="block text-sm font-semibold">Crédito fiscal · B01</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Requiere razón social y RNC o cédula válida.
                </span>
              </button>
            </div>
          </fieldset>

          {inlineIdentityRequired ? (
            <div className="space-y-3 rounded-lg border border-evc-300/60 bg-evc-50 p-3">
              <div>
                <p className="text-sm font-semibold">
                  {draftPurpose === 'FISCAL_CREDIT'
                    ? 'Datos para la factura B01'
                    : 'Identificación requerida para esta B02'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Estos datos se guardan únicamente en la orden y la factura. No se creará un
                  cliente en el módulo Clientes.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="posFiscalCustomerName">Nombre operativo de la orden</Label>
                <Input
                  id="posFiscalCustomerName"
                  value={operationalCustomerName}
                  readOnly
                  aria-readonly="true"
                  className="bg-zinc-100"
                  placeholder="Nombre recibido desde la toma de orden"
                />
                <p className="text-xs text-muted-foreground">
                  Proviene de Toma de órdenes y se conserva como referencia. Para la factura se
                  usará la identidad fiscal verificada o autorizada.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
                <div className="space-y-2">
                  <Label htmlFor="posFiscalDocumentType">Documento</Label>
                  <select
                    id="posFiscalDocumentType"
                    value={draftDocumentType}
                    disabled={
                      !order || fiscalDetailsSaving || fiscalIdentityChecking || isCompleting
                    }
                    onChange={(event) => {
                      setDraftDocumentType(event.target.value as FiscalIdentityDocumentType);
                      setDraftDocumentNumber('');
                      invalidateFiscalIdentityVerification();
                    }}
                    className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-zinc-100"
                  >
                    <option value="RNC">RNC</option>
                    <option value="CEDULA">Cédula</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="posFiscalDocumentNumber">
                    {draftDocumentType === 'RNC' ? 'Número de RNC' : 'Número de cédula'}
                  </Label>
                  <Input
                    id="posFiscalDocumentNumber"
                    value={draftDocumentNumber}
                    disabled={
                      !order || fiscalDetailsSaving || fiscalIdentityChecking || isCompleting
                    }
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={draftDocumentType === 'RNC' ? '1-01-00000-1' : '001-0000000-1'}
                    onChange={(event) => {
                      setDraftDocumentNumber(event.target.value);
                      invalidateFiscalIdentityVerification();
                    }}
                    onBlur={() => {
                      if (normalizedDraftDocumentNumber) {
                        setDraftDocumentNumber(
                          formatDominicanDocument(draftDocumentType, normalizedDraftDocumentNumber),
                        );
                      }
                    }}
                    aria-invalid={fiscalDocumentInvalid}
                    required
                  />
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  La consulta no crea ni modifica registros en el módulo Clientes.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    !order ||
                    fiscalDocumentInvalid ||
                    fiscalIdentityChecking ||
                    fiscalDetailsSaving ||
                    isCompleting
                  }
                  onClick={requestTaxIdentityLookup}
                  aria-label={`${lookupAttemptedForCurrentDocument ? 'Reintentar la consulta de' : 'Verificar'} ${
                    draftDocumentType === 'RNC' ? 'RNC' : 'cédula'
                  } en el padrón de DGII`}
                >
                  {fiscalIdentityChecking ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Search className="h-4 w-4" aria-hidden="true" />
                  )}
                  {lookupButtonLabel}
                </Button>
              </div>

              <div
                className={cn('rounded-md border px-3 py-3', taxIdentityDisplay.containerClassName)}
                role={
                  currentTaxIdentityLookup && currentTaxIdentityLookup.outcome !== 'VERIFIED'
                    ? 'alert'
                    : 'status'
                }
                aria-live="polite"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <p className="text-xs font-semibold uppercase tracking-wide">
                        {taxIdentityHeading}
                      </p>
                    </div>
                    <p className="mt-1 break-words text-sm font-semibold">
                      {fiscalIdentityChecking
                        ? 'Consultando el padrón oficial...'
                        : currentTaxIdentityLookup?.fiscalName?.trim() ||
                          taxIdentityDisplay.message}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold',
                      taxIdentityDisplay.badgeClassName,
                    )}
                  >
                    {fiscalIdentityChecking
                      ? 'Consultando'
                      : manualIdentityAuthorized
                        ? 'Autorizado'
                        : taxIdentityDisplay.badgeLabel}
                  </span>
                </div>

                {currentTaxIdentityLookup ? (
                  <dl
                    className={cn(
                      'mt-3 grid gap-2 border-t border-current/15 pt-3 text-xs',
                      overrideRemainingMs === null ? 'sm:grid-cols-3' : 'sm:grid-cols-4',
                    )}
                  >
                    <div>
                      <dt className="font-medium opacity-70">Estado en padrón</dt>
                      <dd className="mt-0.5 font-semibold">
                        {formatRegistryStatus(currentTaxIdentityLookup.registryStatus)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium opacity-70">Fuente / actualización</dt>
                      <dd className="mt-0.5 font-semibold">
                        {formatTaxIdentitySource(currentTaxIdentityLookup.source)} ·{' '}
                        {formatLookupDate(currentTaxIdentityLookup.sourceUpdatedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium opacity-70">Consultado</dt>
                      <dd className="mt-0.5 font-semibold">
                        {formatLookupDate(currentTaxIdentityLookup.checkedAt)}
                      </dd>
                    </div>
                    {overrideRemainingMs !== null ? (
                      <div>
                        <dt className="font-medium opacity-70">Autorización vigente</dt>
                        <dd className="mt-0.5 font-semibold">
                          {formatOverrideRemainingTime(overrideRemainingMs)}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                ) : null}
              </div>

              {localOverrideExpired ? (
                <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                  La validación manual venció. Envía una nueva solicitud al administrador antes de
                  confirmar los datos fiscales.
                </p>
              ) : null}

              {verifyTaxIdentityMutation.isError ? (
                <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                  {verifyTaxIdentityMutation.error instanceof Error
                    ? verifyTaxIdentityMutation.error.message
                    : 'No se pudo consultar el padrón de DGII.'}
                </p>
              ) : null}

              {canRequestManualApproval && order ? (
                <TaxIdentityApprovalRequestPanel
                  tenantId={tenantId}
                  accessToken={accessToken}
                  contextType="POS_ORDER"
                  contextId={order.id}
                  documentType={draftDocumentType}
                  documentNumber={normalizedDraftDocumentNumber}
                  suggestedFiscalName={operationalCustomerName}
                  registryOutcome={currentTaxIdentityLookup?.outcome ?? null}
                  disabled={fiscalDetailsSaving || isCompleting}
                  onApproved={(result) => {
                    setOverrideClockMs(Date.now());
                    verifyTaxIdentityMutation.reset();
                    saveFiscalDetailsMutation.reset();
                    setTaxIdentityLookup({
                      orderId: order.id,
                      documentType: draftDocumentType,
                      documentNumber: normalizedDraftDocumentNumber,
                      result,
                    });
                  }}
                />
              ) : null}

              {operationalNameMissing ? (
                <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                  La orden no tiene nombre. Corrige la orden antes de emitir este comprobante.
                </p>
              ) : fiscalDocumentInvalid ? (
                <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                  Digita un {draftDocumentType === 'RNC' ? 'RNC' : 'número de cédula'} válido.
                </p>
              ) : currentTaxIdentityLookup && !fiscalIdentityVerified ? (
                <p className="rounded-md border border-evc-200 bg-evc-50 px-3 py-2 text-sm text-evc-900" role="alert">
                  No se puede confirmar este comprobante con el resultado actual. Verifica los datos
                  o envía una solicitud de validación al administrador.
                </p>
              ) : null}

              <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
                Al confirmar, CoreStack comprobará que exista una secuencia {fiscalDocument.code}{' '}
                disponible. El NCF se reservará solo al facturar.
              </p>
            </div>
          ) : null}

          {saveFiscalDetailsMutation.isError ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
              {saveFiscalDetailsMutation.error instanceof Error
                ? saveFiscalDetailsMutation.error.message
                : 'No se pudieron confirmar los datos fiscales.'}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <p className="font-semibold">
                {fiscalDocument.purposeLabel} · {fiscalDocument.code}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {fiscalDetailsDirty
                  ? 'Confirma este cambio antes de habilitar el cobro.'
                  : 'Los datos fiscales de esta orden están confirmados.'}
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={
                !order ||
                !fiscalDetailsDirty ||
                fiscalDetailsInvalid ||
                fiscalDetailsSaving ||
                isCompleting
              }
              onClick={() => saveFiscalDetailsMutation.mutate()}
            >
              {saveFiscalDetailsMutation.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              )}
              {saveFiscalDetailsMutation.isPending
                ? 'Confirmando...'
                : fiscalDetailsDirty
                  ? 'Confirmar cambios'
                  : 'Datos confirmados'}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 border-t border-zinc-200 pt-4">
          <div className="space-y-2">
            <Label htmlFor="paymentMethod">Metodo de pago</Label>
            <select
              id="paymentMethod"
              value={paymentMethod}
              onChange={(event) => onPaymentMethodChange(event.target.value as PosPaymentMethod)}
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="CASH">Efectivo</option>
              <option value="CARD">Tarjeta</option>
              <option value="TRANSFER">Transferencia</option>
            </select>
          </div>
        </div>
        {creditSale ? (
          <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
            Venta fiada aprobada. En esta factura se cobra únicamente la inicial de{' '}
            <strong>{formatCurrency(totals.requiredPayment)}</strong>
            {dueDate
              ? ` y el saldo vence el ${new Date(dueDate).toLocaleDateString('es-DO')}.`
              : '.'}
          </div>
        ) : null}
      </div>

      <div className="rounded-md border-2 border-evc-300/70 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3">
          <div className="flex-1 space-y-2">
            <Label htmlFor="amountReceived">
              {cashPayment ? 'Monto entregado por el cliente' : 'Monto pagado'}
            </Label>
            <Input
              id="amountReceived"
              type="text"
              inputMode="decimal"
              value={amountReceived}
              disabled={!cashPayment}
              onChange={(event) =>
                onAmountReceivedChange(sanitizeCurrencyInput(event.target.value))
              }
              onBlur={(event) => onAmountReceivedChange(formatCurrencyInput(event.target.value))}
              onFocus={(event) => event.currentTarget.select()}
              placeholder={
                totals.requiredPayment
                  ? formatCurrencyInputFromNumber(totals.requiredPayment)
                  : '0.00'
              }
              className="h-14 text-2xl font-semibold"
            />
          </div>
          <div className={creditSale ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2'}>
            <div className="rounded-md bg-zinc-950 px-4 py-3 text-white">
              <p className="text-xs text-zinc-300">Total</p>
              <p className="text-2xl font-bold">{formatCurrency(totals.total)}</p>
            </div>
            {creditSale ? (
              <div className="rounded-md bg-sky-100 px-4 py-3 text-sky-950">
                <p className="text-xs">Inicial</p>
                <p className="text-2xl font-bold">{formatCurrency(totals.requiredPayment)}</p>
              </div>
            ) : null}
            <div className="rounded-md bg-success/10 px-4 py-3 text-success">
              <p className="text-xs">Devuelta</p>
              <p className="text-2xl font-bold">{formatCurrency(totals.change)}</p>
            </div>
          </div>

          {cashInsufficient ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              El efectivo recibido debe cubrir el monto requerido para completar la venta.
            </p>
          ) : null}

          {fiscalIdentityChecking ? (
            <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-950" role="status">
              Consultando la identidad fiscal en el padrón de DGII...
            </p>
          ) : fiscalIdentityVerificationMissing && !fiscalDocumentInvalid ? (
            <p className="rounded-md bg-evc-50 px-3 py-2 text-sm text-evc-900" role="status">
              Verifica el RNC o la cédula con DGII o consigue autorización administrativa para
              habilitar la facturación.
            </p>
          ) : fiscalDetailsDirty ? (
            <p className="rounded-md bg-evc-50 px-3 py-2 text-sm text-evc-900" role="status">
              Hay cambios fiscales sin confirmar. Confírmalos arriba para habilitar el cobro.
            </p>
          ) : fiscalDetailsInvalid ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
              Corrige los datos fiscales indicados arriba antes de facturar.
            </p>
          ) : fiscalDetailsSaving ? (
            <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-950" role="status">
              Guardando los datos fiscales de la orden...
            </p>
          ) : null}

          <Button
            type="button"
            className="h-16 w-full bg-evc-600 text-lg font-bold text-white hover:bg-evc-700"
            disabled={
              !canCompleteSale || cashInsufficient || fiscalDetailsBlockPayment || isCompleting
            }
            onClick={onCompleteSale}
          >
            <ReceiptText className="h-5 w-5" />
            {isCompleting ? 'Facturando...' : 'Facturar e imprimir'}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            Al confirmar, se emite la factura y se abre el recibo para imprimir automaticamente.
          </p>
        </div>
        {!cashPayment ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Tarjeta y transferencia se registran por el monto exacto requerido.
          </p>
        ) : null}
      </div>

      <PaymentCalculator
        total={totals.requiredPayment}
        amountReceived={amountReceived}
        disabled={!cashPayment}
        onAmountChange={onAmountReceivedChange}
      />

      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <span>{formatCurrency(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span>Descuento</span>
            <span>{formatCurrency(totals.discount)}</span>
          </div>
          <div className="flex justify-between">
            <span>ITBIS</span>
            <span>{formatCurrency(totals.tax)}</span>
          </div>
          <div className="flex justify-between border-t border-zinc-200 pt-3 text-xl font-bold text-zinc-950">
            <span>Total</span>
            <span>{formatCurrency(totals.total)}</span>
          </div>
          {creditSale ? (
            <>
              <div className="flex justify-between text-base font-semibold text-sky-800">
                <span>Inicial a cobrar</span>
                <span>{formatCurrency(totals.requiredPayment)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold text-evc-800">
                <span>Saldo pendiente</span>
                <span>{formatCurrency(totals.remainingBalance)}</span>
              </div>
            </>
          ) : null}
          <div className="flex justify-between text-base font-semibold text-success">
            <span>Devuelta</span>
            <span>{formatCurrency(totals.change)}</span>
          </div>
        </div>

        {message ? <p className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
      </div>
    </div>
  );
}

function createTaxIdentityLookupKey(
  orderId: string,
  documentType: FiscalIdentityDocumentType,
  documentNumber: string,
) {
  return `${orderId}:${documentType}:${documentNumber}`;
}

function parseTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getTaxIdentityHeading(lookup: UsableTaxIdentityLookup | null, checking: boolean) {
  if (checking) {
    return 'Consulta de identidad fiscal en curso';
  }

  if (lookup?.source === 'MANUAL_OVERRIDE') {
    return 'Nombre fiscal autorizado por administrador';
  }

  if (lookup?.outcome === 'VERIFIED') {
    return lookup.source === 'TEST_FIXTURE'
      ? 'Identidad verificada en el padrón de prueba'
      : 'Razón social verificada por DGII';
  }

  return 'Consulta de identidad fiscal';
}

function formatTaxIdentitySource(value: string | null | undefined) {
  switch (value) {
    case 'DGII_OFFICIAL':
      return 'Padrón oficial DGII';
    case 'TEST_FIXTURE':
      return 'Padrón de prueba';
    case 'MANUAL_OVERRIDE':
      return 'Autorización administrativa';
    case null:
    case undefined:
    case '':
      return 'Fuente no indicada';
    default:
      return value
        .replace(/_/g, ' ')
        .toLocaleLowerCase('es-DO')
        .replace(/^./, (character) => character.toLocaleUpperCase('es-DO'));
  }
}

function formatOverrideRemainingTime(value: number) {
  const totalSeconds = Math.max(0, Math.ceil(value / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds} s restantes`;
  }

  return `${minutes} min ${seconds.toString().padStart(2, '0')} s`;
}

function getOrderOperationalName(order: SalesOrder | null) {
  return order?.clientName?.trim() || '';
}

function normalizeComparableName(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('es-DO');
}

function formatLookupDate(value: string | null | undefined) {
  if (!value) {
    return 'No indicada';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'No indicada';
  }

  return new Intl.DateTimeFormat('es-DO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatRegistryStatus(value: string | null | undefined) {
  if (!value) {
    return 'No informado';
  }

  if (value === 'MANUAL_OVERRIDE') {
    return 'Validación manual';
  }

  return value
    .replace(/_/g, ' ')
    .toLocaleLowerCase('es-DO')
    .replace(/^./, (character) => character.toLocaleUpperCase('es-DO'));
}

function getTaxIdentityOutcomeDisplay(outcome: TaxIdentityLookup['outcome'] | undefined) {
  const displays: Record<
    TaxIdentityLookup['outcome'],
    {
      badgeLabel: string;
      message: string;
      containerClassName: string;
      badgeClassName: string;
    }
  > = {
    VERIFIED: {
      badgeLabel: 'Verificado',
      message: 'Identidad fiscal verificada.',
      containerClassName: 'border-emerald-200 bg-emerald-50 text-emerald-950',
      badgeClassName: 'bg-emerald-100 text-emerald-900',
    },
    NOT_FOUND: {
      badgeLabel: 'No encontrado',
      message: 'El documento no aparece en el padrón local sincronizado de DGII.',
      containerClassName: 'border-evc-200 bg-evc-50 text-evc-900',
      badgeClassName: 'bg-evc-100 text-evc-800',
    },
    NON_ACTIVE: {
      badgeLabel: 'No activo',
      message: 'El contribuyente aparece con un estado no activo en DGII.',
      containerClassName: 'border-red-200 bg-red-50 text-red-950',
      badgeClassName: 'bg-red-100 text-red-900',
    },
    REGISTRY_STALE: {
      badgeLabel: 'Padrón desactualizado',
      message: 'La copia local del padrón requiere sincronización antes de validar.',
      containerClassName: 'border-danger/25 bg-danger/10 text-danger',
      badgeClassName: 'bg-danger/15 text-danger',
    },
    UNAVAILABLE: {
      badgeLabel: 'No disponible',
      message: 'La validación fiscal no está disponible en este momento.',
      containerClassName: 'border-red-200 bg-red-50 text-red-950',
      badgeClassName: 'bg-red-100 text-red-900',
    },
  };

  return outcome
    ? displays[outcome]
    : {
        badgeLabel: 'Pendiente',
        message: 'Digita un documento válido para consultarlo automáticamente en DGII.',
        containerClassName: 'border-zinc-200 bg-white text-zinc-800',
        badgeClassName: 'bg-zinc-100 text-zinc-700',
      };
}

function getPersistedFiscalIdentity(order: SalesOrder | null): {
  documentType: FiscalIdentityDocumentType;
  documentNumber: string;
} | null {
  const snapshot = order?.fiscalCustomerSnapshot;
  if (
    !snapshot?.documentNumber ||
    (snapshot.documentType !== 'RNC' && snapshot.documentType !== 'CEDULA')
  ) {
    return null;
  }

  return {
    documentType: snapshot.documentType,
    documentNumber: snapshot.documentNumber,
  };
}

function getPersistedTaxIdentityLookup(order: SalesOrder | null): UsableTaxIdentityLookup | null {
  const snapshot = order?.fiscalCustomerSnapshot;
  const verification = snapshot?.verification;
  if (
    !snapshot ||
    !verification ||
    (snapshot.documentType !== 'RNC' && snapshot.documentType !== 'CEDULA') ||
    !snapshot.documentNumber ||
    !snapshot.name
  ) {
    return null;
  }

  return {
    outcome: 'VERIFIED',
    documentType: snapshot.documentType,
    documentNumber: snapshot.documentNumber,
    fiscalName: snapshot.name,
    registryStatus: verification.registryStatus,
    source: verification.source,
    sourceUpdatedAt: verification.sourceUpdatedAt,
    checkedAt: verification.verifiedAt,
  };
}

function getDraftFiscalDocumentType(
  currentType: InvoiceDocumentType,
  purpose: FiscalDocumentPurpose,
): InvoiceDocumentType {
  const electronic =
    currentType === 'CONSUMER_ELECTRONIC_32' || currentType === 'FISCAL_CREDIT_ELECTRONIC_31';

  if (electronic) {
    return purpose === 'FISCAL_CREDIT' ? 'FISCAL_CREDIT_ELECTRONIC_31' : 'CONSUMER_ELECTRONIC_32';
  }

  return purpose === 'FISCAL_CREDIT' ? 'FISCAL_CREDIT_01' : 'CONSUMER_02';
}

function getOrderFiscalPurpose(order: SalesOrder): FiscalDocumentPurpose {
  if (order.fiscalPurpose) {
    return order.fiscalPurpose;
  }

  return order.fiscalDocumentTypeSnapshot === 'FISCAL_CREDIT_01' ||
    order.fiscalDocumentTypeSnapshot === 'FISCAL_CREDIT_ELECTRONIC_31'
    ? 'FISCAL_CREDIT'
    : 'CONSUMER';
}

function getOrderFiscalDocumentType(order: SalesOrder): InvoiceDocumentType {
  if (order.fiscalDocumentTypeSnapshot) {
    return order.fiscalDocumentTypeSnapshot;
  }

  return getOrderFiscalPurpose(order) === 'FISCAL_CREDIT' ? 'FISCAL_CREDIT_01' : 'CONSUMER_02';
}

function getFiscalDocumentDisplay(
  purpose: FiscalDocumentPurpose,
  documentType: InvoiceDocumentType,
) {
  const documents: Partial<
    Record<InvoiceDocumentType, { purposeLabel: string; code: string; description: string }>
  > = {
    CONSUMER_02: {
      purposeLabel: 'Consumo',
      code: 'B02',
      description: 'Factura de consumo local resuelta por el sistema.',
    },
    FISCAL_CREDIT_01: {
      purposeLabel: 'Crédito fiscal',
      code: 'B01',
      description: 'Factura de crédito fiscal local resuelta por el sistema.',
    },
    CONSUMER_ELECTRONIC_32: {
      purposeLabel: 'Consumo',
      code: 'E32',
      description: 'Factura de consumo electrónica resuelta por el sistema.',
    },
    FISCAL_CREDIT_ELECTRONIC_31: {
      purposeLabel: 'Crédito fiscal',
      code: 'E31',
      description: 'Factura de crédito fiscal electrónica resuelta por el sistema.',
    },
  };

  return (
    documents[documentType] ??
    (purpose === 'FISCAL_CREDIT' ? documents.FISCAL_CREDIT_01! : documents.CONSUMER_02!)
  );
}
