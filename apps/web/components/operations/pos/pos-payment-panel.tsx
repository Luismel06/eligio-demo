'use client';

import { ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Customer, LocalNcfDocumentType, PosPaymentMethod } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import {
  formatCurrencyInput,
  formatCurrencyInputFromNumber,
  sanitizeCurrencyInput,
} from './currency-input';
import { PaymentCalculator } from './payment-calculator';
import type { PosTotals } from './types';

type PosPaymentPanelProps = {
  customers: Customer[];
  customerId: string;
  documentType: LocalNcfDocumentType;
  fiscalCreditAvailable: boolean;
  customerIdentified: boolean;
  paymentMethod: PosPaymentMethod;
  salePaymentMode: 'CASH' | 'CREDIT';
  dueDate?: string | null;
  customerLocked?: boolean;
  amountReceived: string;
  totals: PosTotals;
  message: string | null;
  canCompleteSale: boolean;
  isCompleting: boolean;
  onCustomerChange: (value: string) => void;
  onDocumentTypeChange: (value: LocalNcfDocumentType) => void;
  onPaymentMethodChange: (value: PosPaymentMethod) => void;
  onAmountReceivedChange: (value: string) => void;
  onCompleteSale: () => void;
};

export function PosPaymentPanel({
  customers,
  customerId,
  documentType,
  fiscalCreditAvailable,
  customerIdentified,
  paymentMethod,
  salePaymentMode,
  dueDate,
  customerLocked = false,
  amountReceived,
  totals,
  message,
  canCompleteSale,
  isCompleting,
  onCustomerChange,
  onDocumentTypeChange,
  onPaymentMethodChange,
  onAmountReceivedChange,
  onCompleteSale,
}: PosPaymentPanelProps) {
  const cashInsufficient =
    paymentMethod === 'CASH' &&
    totals.requiredPayment > 0 &&
    totals.received < totals.requiredPayment;
  const cashPayment = paymentMethod === 'CASH';
  const creditSale = salePaymentMode === 'CREDIT';
  const b02IdentityMissing =
    documentType === 'CONSUMER_02' && totals.subtotal >= 250_000 && !customerIdentified;

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="customer">Cliente</Label>
            <select
              id="customer"
              value={customerId}
              disabled={customerLocked}
              onChange={(event) => onCustomerChange(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-zinc-100"
            >
              <option value="">Consumidor final</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="documentType">Comprobante</Label>
            <select
              id="documentType"
              value={documentType}
              onChange={(event) => onDocumentTypeChange(event.target.value as LocalNcfDocumentType)}
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="CONSUMER_02">Factura de consumo B02</option>
              <option value="FISCAL_CREDIT_01" disabled={!fiscalCreditAvailable}>
                Factura de credito fiscal B01
              </option>
            </select>
            {!fiscalCreditAvailable ? (
              <p className="text-xs text-muted-foreground">
                B01 requiere seleccionar un cliente con RNC o cedula valida.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-3 grid gap-3">
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

          {b02IdentityMissing ? (
            <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
              Una B02 de RD$250,000 o mas antes de ITBIS requiere identificar al cliente.
            </p>
          ) : null}

          <Button
            type="button"
            className="h-16 w-full bg-[#f36c10] text-lg font-bold text-white hover:bg-[#d85f0e]"
            disabled={!canCompleteSale || cashInsufficient || b02IdentityMissing || isCompleting}
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
