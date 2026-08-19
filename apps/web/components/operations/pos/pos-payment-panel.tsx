'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, LoaderCircle, ReceiptText } from 'lucide-react';
import { useEffect, useState } from 'react';
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
} from '@/lib/api';
import { updatePosOrderFiscalDetails } from '@/lib/api';
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
  const customerName = getOrderFiscalName(order);
  const persistedIdentity = getPersistedFiscalIdentity(order);
  const normalizedDraftDocumentNumber = normalizeDominicanDocument(draftDocumentNumber);
  const usesApprovedCreditCustomer = Boolean(creditSale && order?.customerId);
  const inlineIdentityRequired =
    !usesApprovedCreditCustomer &&
    (draftPurpose === 'FISCAL_CREDIT' ||
      (draftFiscalDocumentType === 'CONSUMER_02' && totals.subtotal >= 250_000));
  const fiscalNameMissing = inlineIdentityRequired && !customerName;
  const fiscalDocumentInvalid =
    inlineIdentityRequired &&
    !validateDominicanDocument(draftDocumentType, normalizedDraftDocumentNumber);
  const persistedDocumentNumber = persistedIdentity
    ? normalizeDominicanDocument(persistedIdentity.documentNumber)
    : '';
  const fiscalIdentityDirty = inlineIdentityRequired
    ? persistedIdentity?.documentType !== draftDocumentType ||
      persistedDocumentNumber !== normalizedDraftDocumentNumber
    : false;
  const fiscalDetailsDirty = draftPurpose !== fiscalPurpose || fiscalIdentityDirty;

  const saveFiscalDetailsMutation = useMutation({
    mutationFn: () => {
      if (!order) {
        throw new Error('Carga una orden antes de confirmar sus datos fiscales.');
      }

      if (fiscalNameMissing) {
        throw new Error('La orden no tiene el nombre requerido para emitir este comprobante.');
      }

      if (fiscalDocumentInvalid) {
        throw new Error(
          draftDocumentType === 'RNC'
            ? 'El RNC digitado no es válido.'
            : 'La cédula digitada no es válida.',
        );
      }

      return updatePosOrderFiscalDetails(tenantId, accessToken, order.id, {
        fiscalPurpose: draftPurpose,
        ...(inlineIdentityRequired
          ? {
              documentType: draftDocumentType,
              documentNumber: normalizedDraftDocumentNumber,
            }
          : {}),
      });
    },
    onSuccess: async (updatedOrder) => {
      onFiscalOrderUpdated(updatedOrder);
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

  const fiscalDetailsInvalid = fiscalNameMissing || fiscalDocumentInvalid;
  const fiscalDetailsSaving = saveFiscalDetailsMutation.isPending;
  const fiscalDetailsBlockPayment =
    fiscalDetailsDirty || fiscalDetailsInvalid || fiscalDetailsSaving;

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
                  ? 'bg-amber-100 text-amber-900'
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

          <fieldset className="space-y-2" disabled={!order || fiscalDetailsSaving || isCompleting}>
            <legend className="text-sm font-medium">Tipo de comprobante</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={draftPurpose === 'CONSUMER'}
                onClick={() => setDraftPurpose('CONSUMER')}
                className={cn(
                  'rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                  draftPurpose === 'CONSUMER'
                    ? 'border-[#f36c10] bg-[#f36c10]/10 ring-1 ring-[#f36c10]/20'
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
                onClick={() => setDraftPurpose('FISCAL_CREDIT')}
                className={cn(
                  'rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
                  draftPurpose === 'FISCAL_CREDIT'
                    ? 'border-[#f36c10] bg-[#f36c10]/10 ring-1 ring-[#f36c10]/20'
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
            <div className="space-y-3 rounded-lg border border-[#f36c10]/30 bg-[#f36c10]/5 p-3">
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
                <Label htmlFor="posFiscalCustomerName">Razón social / nombre</Label>
                <Input
                  id="posFiscalCustomerName"
                  value={customerName}
                  readOnly
                  aria-readonly="true"
                  className="bg-zinc-100"
                  placeholder="Nombre recibido desde la toma de orden"
                />
                <p className="text-xs text-muted-foreground">
                  Este nombre proviene de la toma de orden.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
                <div className="space-y-2">
                  <Label htmlFor="posFiscalDocumentType">Documento</Label>
                  <select
                    id="posFiscalDocumentType"
                    value={draftDocumentType}
                    disabled={!order || fiscalDetailsSaving || isCompleting}
                    onChange={(event) => {
                      setDraftDocumentType(event.target.value as FiscalIdentityDocumentType);
                      setDraftDocumentNumber('');
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
                    disabled={!order || fiscalDetailsSaving || isCompleting}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={draftDocumentType === 'RNC' ? '1-01-00000-1' : '001-0000000-1'}
                    onChange={(event) => setDraftDocumentNumber(event.target.value)}
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

              {fiscalNameMissing ? (
                <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                  La orden no tiene nombre. Corrige la orden antes de emitir este comprobante.
                </p>
              ) : fiscalDocumentInvalid ? (
                <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
                  Digita un {draftDocumentType === 'RNC' ? 'RNC' : 'número de cédula'} válido.
                </p>
              ) : null}

              <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
                Al confirmar, RIVNU comprobará que exista una secuencia {fiscalDocument.code}{' '}
                disponible. El NCF se reservará solo al facturar.
              </p>
            </div>
          ) : usesApprovedCreditCustomer && draftPurpose === 'FISCAL_CREDIT' ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
              Esta venta fiada utilizará el nombre y el documento fiscal del cliente aprobado.
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

      <div className="rounded-md border-2 border-[#f36c10]/40 bg-white p-4 shadow-sm">
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

          {fiscalDetailsDirty ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
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
            className="h-16 w-full bg-[#f36c10] text-lg font-bold text-white hover:bg-[#d85f0e]"
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
              <div className="flex justify-between text-base font-semibold text-amber-800">
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

function getOrderFiscalName(order: SalesOrder | null) {
  return order?.clientName?.trim() || order?.fiscalCustomerSnapshot?.name.trim() || '';
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
