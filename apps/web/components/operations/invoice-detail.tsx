'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getInvoice,
  type Invoice,
  type InvoicePrintRegistration,
  registerInvoicePrint,
} from '@/lib/api';
import type { AuthSession } from '@/lib/auth-session';
import { isAdminSession } from '@/lib/authorization';
import {
  translateDocumentType,
  translatePaymentMethod,
  translateProductUnit,
  translateStatus,
} from '@/lib/display-labels';
import { formatCurrency, formatDateOnly, formatDateTime } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { formatQuantity } from './pos/pos-utils';
import { SessionRequired, useCurrentSession } from './session-required';

export function InvoiceDetail({
  invoiceId,
  printMode = false,
  autoPrint = false,
}: {
  invoiceId: string;
  printMode?: boolean;
  autoPrint?: boolean;
}) {
  const session = useCurrentSession();
  const invoiceQuery = useQuery({
    queryKey: ['invoice', invoiceId, session?.tenantId],
    queryFn: () => getInvoice(session?.tenantId ?? '', session?.accessToken ?? '', invoiceId),
    enabled: Boolean(session),
  });
  const invoice = invoiceQuery.data;
  const autoPrintTriggeredRef = useRef(false);
  const printRequestInFlightRef = useRef(false);
  const [printRegistration, setPrintRegistration] = useState<InvoicePrintRegistration | null>(null);
  const [lastRegisteredPrintNumber, setLastRegisteredPrintNumber] = useState<number | null>(null);
  const [isRegisteringPrint, setIsRegisteringPrint] = useState(false);
  const effectivePrintCount = Math.max(
    invoice?.receiptPrintCount ?? 0,
    lastRegisteredPrintNumber ?? 0,
  );
  const printBlockReason = invoice ? getInvoicePrintBlockReason(invoice) : null;
  const printPermissionReason =
    session && invoice && !printBlockReason
      ? getInvoicePrintPermissionReason(invoice, session, effectivePrintCount)
      : null;
  const canRequestPrint = Boolean(
    session && invoice && !printBlockReason && !printPermissionReason,
  );

  useEffect(() => {
    autoPrintTriggeredRef.current = false;
    setLastRegisteredPrintNumber(null);
  }, [invoiceId]);

  useEffect(() => {
    const preventUnregisteredKeyboardPrint = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'p' &&
        (!printMode || !printRegistration)
      ) {
        event.preventDefault();
        toast.warning(
          'La vista previa no se imprime con Ctrl+P. Usa la acción de impresión autorizada de RIVNU.',
        );
      }
    };

    window.addEventListener('keydown', preventUnregisteredKeyboardPrint);
    return () => window.removeEventListener('keydown', preventUnregisteredKeyboardPrint);
  }, [printMode, printRegistration]);

  const registerAndPrint = useCallback(async () => {
    if (!session || !invoice || printRequestInFlightRef.current) {
      return;
    }

    if (!canRequestPrint) {
      toast.error(
        printBlockReason ??
          printPermissionReason ??
          'Esta factura no está disponible para impresión.',
      );
      return;
    }

    printRequestInFlightRef.current = true;
    setIsRegisteringPrint(true);

    try {
      const registration = await registerInvoicePrint(
        session.tenantId,
        session.accessToken,
        invoiceId,
      );

      flushSync(() => {
        setPrintRegistration(registration);
        setLastRegisteredPrintNumber(registration.printNumber);
      });
      window.setTimeout(() => {
        try {
          window.print();
        } finally {
          setPrintRegistration(null);
          printRequestInFlightRef.current = false;
          setIsRegisteringPrint(false);
        }
      }, 0);
    } catch (error) {
      printRequestInFlightRef.current = false;
      setIsRegisteringPrint(false);
      toast.error(
        error instanceof Error ? error.message : 'No se pudo registrar la impresión de la factura.',
      );
    }
  }, [canRequestPrint, invoice, invoiceId, printBlockReason, printPermissionReason, session]);

  useEffect(() => {
    if (printMode && autoPrint && invoice && !autoPrintTriggeredRef.current) {
      autoPrintTriggeredRef.current = true;
      void registerAndPrint();
    }
  }, [autoPrint, invoice, printMode, registerAndPrint]);

  if (!session) {
    return <SessionRequired session={session} />;
  }

  if (!invoice) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Factura</CardTitle>
          <CardDescription>Cargando datos desde PostgreSQL.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (printMode) {
    const customerDestination = printRegistration?.isReprint
      ? 'REIMPRESIÓN PARA CLIENTE'
      : 'ORIGINAL: CLIENTE';
    const sellerDestination = printRegistration?.isReprint
      ? 'REIMPRESIÓN PARA VENDEDOR'
      : 'COPIA: VENDEDOR';

    return (
      <main className="mx-auto max-w-sm bg-white p-4 text-zinc-950 print:max-w-none print:p-0">
        <div className={printRegistration ? undefined : 'print:hidden'}>
          <Receipt
            invoice={invoice}
            destination={customerDestination}
            printRegistration={printRegistration}
          />
          <div className="mt-8 border-t-2 border-dashed border-zinc-500 pt-8 print:break-before-page print:border-0 print:pt-0">
            <Receipt
              invoice={invoice}
              destination={sellerDestination}
              printRegistration={printRegistration}
            />
          </div>
        </div>
        {!printRegistration ? (
          <div className="hidden p-8 text-center font-bold print:block">
            IMPRESIÓN BLOQUEADA.{' '}
            {printBlockReason ??
              printPermissionReason ??
              'USE EL BOTÓN DE IMPRESIÓN AUTORIZADA DE RIVNU.'}
          </div>
        ) : null}
        <div className="mt-4 print:hidden">
          {canRequestPrint ? (
            <Button
              className="w-full"
              disabled={isRegisteringPrint}
              onClick={() => void registerAndPrint()}
            >
              <Printer className="h-4 w-4" />
              {isRegisteringPrint
                ? 'Registrando impresión...'
                : effectivePrintCount > 0
                  ? 'Reimprimir factura'
                  : 'Imprimir factura'}
            </Button>
          ) : (
            <div className="rounded-md border-2 border-danger p-3 text-center text-sm font-semibold text-danger">
              {printBlockReason ?? printPermissionReason}
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Factura"
        description="Detalle persistido con items, pago, cajero y estado fiscal."
      />
      <Card>
        <CardHeader>
          <CardTitle>{invoice.invoiceNumber}</CardTitle>
          <CardDescription>
            {invoice.customer?.name ?? 'Consumidor final'} - {translateStatus(invoice.status)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="print:hidden">
            <Receipt invoice={invoice} destination="VISTA PREVIA" />
            <p className="mt-4 text-center text-xs text-muted-foreground">
              Vista previa solamente. Para imprimir, usa la acción autorizada del listado de
              facturas.
            </p>
          </div>
          <div className="hidden p-8 text-center font-bold print:block">
            IMPRESIÓN BLOQUEADA. LA VISTA PREVIA NO ES UN COMPROBANTE IMPRIMIBLE. USE LA ACCIÓN
            AUTORIZADA DE RIVNU.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Receipt({
  invoice,
  destination,
  printRegistration,
}: {
  invoice: NonNullable<Awaited<ReturnType<typeof getInvoice>>>;
  destination: string;
  printRegistration?: InvoicePrintRegistration | null;
}) {
  const amountReceived =
    Number(invoice.amountReceived) > 0
      ? Number(invoice.amountReceived)
      : Number(invoice.paidAmount);
  const changeAmount = Number(invoice.changeAmount ?? 0);
  const issuer = invoice.fiscalIssuerSnapshot ?? {
    rnc: invoice.tenant?.rnc ?? '',
    legalName: invoice.tenant?.legalName ?? invoice.tenant?.name ?? '',
    commercialName: invoice.tenant?.commercialName ?? invoice.tenant?.name ?? '',
    address: invoice.tenant?.address ?? '',
    phone: invoice.tenant?.phone ?? '',
    email: invoice.tenant?.email ?? '',
    logoUrl: invoice.tenant?.branding?.logoUrl ?? null,
    pointOfSale: invoice.cashSession?.cashRegister.name ?? 'Punto de venta',
    pointOfSaleLocation: invoice.cashSession?.cashRegister.location ?? null,
  };
  const customer = invoice.fiscalCustomerSnapshot;
  const discountTotal = Number(invoice.discountTotal);
  const netBeforeTaxes = Number(invoice.subtotal);
  const grossBeforeDiscounts = netBeforeTaxes + discountTotal;
  const exemptAmount = invoice.items
    .filter((item) => item.taxCategory === 'EXEMPT')
    .reduce((sum, item) => sum + Number(item.subtotal), 0);
  const taxableAmount = Math.max(netBeforeTaxes - exemptAmount, 0);
  const taxesByRate = Array.from(
    invoice.items.reduce((rates, item) => {
      const rate = Number(item.taxRate);
      if (rate <= 0) {
        return rates;
      }
      rates.set(rate, (rates.get(rate) ?? 0) + Number(item.taxTotal));
      return rates;
    }, new Map<number, number>()),
  );
  const documentWatermark = getHistoricalDocumentWatermark(invoice);

  return (
    <section className="space-y-3 text-sm">
      {printRegistration?.isReprint ? (
        <div className="border-2 border-zinc-950 px-3 py-2 text-center text-base font-black">
          REIMPRESIÓN · IMPRESIÓN N.º {printRegistration.printNumber}
        </div>
      ) : null}
      {documentWatermark ? (
        <div className="border-2 border-danger px-3 py-2 text-center font-bold text-danger">
          {documentWatermark}
        </div>
      ) : null}
      <div className="flex flex-col items-center text-center">
        {issuer.logoUrl ? (
          <img
            src={issuer.logoUrl}
            alt={issuer.commercialName || issuer.legalName}
            className="h-20 w-32 object-contain"
          />
        ) : null}
        <p className={issuer.logoUrl ? 'mt-2 font-semibold' : 'font-semibold'}>
          {issuer.legalName}
        </p>
        {issuer.commercialName && issuer.commercialName !== issuer.legalName ? (
          <p className="text-xs">{issuer.commercialName}</p>
        ) : null}
        <p className="text-xs">RNC/Cédula {issuer.rnc}</p>
        {issuer.address ? <p className="text-xs">{issuer.address}</p> : null}
        {issuer.phone || issuer.email ? (
          <p className="text-xs">{[issuer.phone, issuer.email].filter(Boolean).join(' · ')}</p>
        ) : null}
        <p className="mt-1 text-xs font-medium">
          Punto de emisión: {issuer.pointOfSale}
          {issuer.pointOfSaleLocation ? ` · ${issuer.pointOfSaleLocation}` : ''}
        </p>
      </div>

      <div className="border-y border-dashed border-zinc-400 py-2">
        <div className="text-center font-bold">
          {printedFiscalDocumentTitle(invoice.documentType)}
        </div>
        <div className="flex justify-between">
          <span>NCF</span>
          <span className="font-semibold">{invoice.ncf ?? '-'}</span>
        </div>
        {invoice.documentType === 'FISCAL_CREDIT_01' ? (
          <div className="flex justify-between">
            <span>FECHA DE VENCIMIENTO</span>
            <span>{formatDateOnly(invoice.fiscalValidUntil)}</span>
          </div>
        ) : null}
        <div className="flex justify-between">
          <span>Factura interna</span>
          <span>{invoice.invoiceNumber}</span>
        </div>
        <div className="flex justify-between">
          <span>Fecha de emisión</span>
          <span>{formatDateTime(invoice.issuedAt ?? invoice.createdAt)}</span>
        </div>
        <div className="flex justify-between">
          <span>Cajero</span>
          <span>{invoice.issuedBy?.name ?? '-'}</span>
        </div>
        {customer ? (
          <>
            <div className="flex justify-between gap-3">
              <span>Cliente</span>
              <span className="text-right">{customer.name}</span>
            </div>
            <div className="flex justify-between">
              <span>{translateDocumentType(customer.documentType)}</span>
              <span>{customer.documentNumber}</span>
            </div>
          </>
        ) : (
          <div className="flex justify-between">
            <span>Cliente</span>
            <span>Consumidor final</span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {invoice.items.map((item) => (
          <div key={item.id} className="border-b border-dotted border-zinc-300 pb-2 last:border-0">
            <div className="flex justify-between gap-3">
              <span>
                {item.taxCategory === 'EXEMPT' ? <strong>E </strong> : null}
                {item.description}
              </span>
              <span>{formatCurrency(Number(item.total))}</span>
            </div>
            <p className="text-xs text-zinc-600">
              {[item.sku, item.barcode].filter(Boolean).join(' · ') || 'Sin código'}
            </p>
            <p className="text-xs text-zinc-600">
              {formatQuantity(item.quantity)} {translateProductUnit(item.unit)} ×{' '}
              {formatCurrency(Number(item.unitPrice))} · Base{' '}
              {formatCurrency(Number(item.subtotal))} · ITBIS{' '}
              {formatCurrency(Number(item.taxTotal))}
            </p>
            {Number(item.discountTotal) > 0 ? (
              <p className="text-xs text-zinc-600">
                Descuento: {formatCurrency(Number(item.discountTotal))}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="border-t border-dashed border-zinc-400 pt-2">
        <div className="flex justify-between">
          <span>Subtotal bruto</span>
          <span>{formatCurrency(grossBeforeDiscounts)}</span>
        </div>
        {discountTotal > 0 ? (
          <div className="flex justify-between">
            <span>Descuentos</span>
            <span>-{formatCurrency(discountTotal)}</span>
          </div>
        ) : null}
        <div className="flex justify-between">
          <span>Subtotal sin ITBIS</span>
          <span>{formatCurrency(netBeforeTaxes)}</span>
        </div>
        <div className="flex justify-between">
          <span>Base gravada</span>
          <span>{formatCurrency(taxableAmount)}</span>
        </div>
        {exemptAmount > 0 ? (
          <div className="flex justify-between">
            <span>Monto exento</span>
            <span>{formatCurrency(exemptAmount)}</span>
          </div>
        ) : null}
        {taxesByRate.map(([rate, amount]) => (
          <div key={rate} className="flex justify-between">
            <span>ITBIS {Math.round(rate * 100)}%</span>
            <span>{formatCurrency(amount)}</span>
          </div>
        ))}
        {!taxesByRate.length ? (
          <div className="flex justify-between">
            <span>ITBIS</span>
            <span>{formatCurrency(Number(invoice.taxTotal))}</span>
          </div>
        ) : null}
        <div className="flex justify-between font-semibold">
          <span>Total factura</span>
          <span>{formatCurrency(Number(invoice.total))}</span>
        </div>
      </div>

      <div className="border-t border-dashed border-zinc-400 pt-2">
        <div className="flex justify-between">
          <span>Pagado</span>
          <span>{formatCurrency(Number(invoice.paidAmount))}</span>
        </div>
        <div className="flex justify-between">
          <span>Metodo</span>
          <span>{translatePaymentMethod(invoice.paymentMethod)}</span>
        </div>
        <div className="flex justify-between">
          <span>Recibido</span>
          <span>{formatCurrency(amountReceived)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Devuelta</span>
          <span>{formatCurrency(changeAmount)}</span>
        </div>
        <div className="flex justify-between">
          <span>Balance</span>
          <span>{formatCurrency(Number(invoice.balance))}</span>
        </div>
      </div>

      <div className="pt-2 text-center text-xs">
        <p className="font-bold">{destination}</p>
        <p className="text-zinc-500">Powered by CoreStack</p>
      </div>
    </section>
  );
}

function printedFiscalDocumentTitle(documentType: string) {
  if (documentType === 'FISCAL_CREDIT_01') {
    return 'FACTURA DE CRÉDITO FISCAL';
  }

  if (documentType === 'CONSUMER_02') {
    return 'FACTURA DE CONSUMO';
  }

  return 'DOCUMENTO FISCAL LEGADO';
}

const printableInvoiceStatuses = new Set(['ISSUED', 'PAID', 'PARTIALLY_PAID']);

function getInvoicePrintBlockReason(invoice: Invoice) {
  const expectedNcfPrefix =
    invoice.documentType === 'CONSUMER_02'
      ? 'B02'
      : invoice.documentType === 'FISCAL_CREDIT_01'
        ? 'B01'
        : null;

  if (
    !expectedNcfPrefix ||
    !invoice.ncf ||
    !new RegExp(`^${expectedNcfPrefix}\\d{8}$`).test(invoice.ncf) ||
    invoice.fiscalStatus !== 'LOCAL_ISSUED' ||
    !printableInvoiceStatuses.has(invoice.status)
  ) {
    return (
      getHistoricalDocumentWatermark(invoice) ??
      'Solo se pueden imprimir facturas locales B01 o B02 emitidas con un NCF válido.'
    );
  }

  return null;
}

function getInvoicePrintPermissionReason(
  invoice: Invoice,
  session: AuthSession,
  receiptPrintCount: number,
) {
  if (isAdminSession(session)) {
    return null;
  }

  if (receiptPrintCount === 0) {
    return session.role === 'CASHIER' && invoice.issuedBy?.id === session.user.id
      ? null
      : 'La primera impresión solo puede realizarla el cajero emisor o un administrador.';
  }

  return session.permissions.canReprintReceipt
    ? null
    : 'Necesitas permiso para reimprimir facturas.';
}

function getHistoricalDocumentWatermark(invoice: Invoice) {
  if (invoice.status === 'DRAFT') {
    return 'BORRADOR — SIN NCF — SIN VALOR FISCAL';
  }

  if (invoice.fiscalStatus === 'LEGACY_UNVERIFIED') {
    return 'DOCUMENTO LEGADO NO VERIFICADO — NO USAR COMO NCF VÁLIDO';
  }

  if (invoice.status === 'CANCELLED' || invoice.fiscalStatus === 'CANCELLED') {
    return 'FACTURA CANCELADA — SIN VALOR FISCAL';
  }

  if (invoice.status === 'VOID' || invoice.status === 'VOIDED') {
    return 'FACTURA ANULADA — SIN VALOR FISCAL';
  }

  if (invoice.status === 'CREDITED') {
    return 'FACTURA ACREDITADA — DOCUMENTO HISTÓRICO NO IMPRIMIBLE';
  }

  const expectedNcfPrefix =
    invoice.documentType === 'CONSUMER_02'
      ? 'B02'
      : invoice.documentType === 'FISCAL_CREDIT_01'
        ? 'B01'
        : null;

  if (!expectedNcfPrefix) {
    return 'DOCUMENTO FISCAL LEGADO O ELECTRÓNICO — NO IMPRIMIBLE EN ESTE FORMATO';
  }

  if (
    !invoice.ncf ||
    !new RegExp(`^${expectedNcfPrefix}\\d{8}$`).test(invoice.ncf) ||
    invoice.fiscalStatus !== 'LOCAL_ISSUED'
  ) {
    return 'DOCUMENTO NO EMITIDO — SIN VALOR FISCAL';
  }

  if (!printableInvoiceStatuses.has(invoice.status)) {
    return 'DOCUMENTO HISTÓRICO NO IMPRIMIBLE — SIN VALOR FISCAL';
  }

  return null;
}
