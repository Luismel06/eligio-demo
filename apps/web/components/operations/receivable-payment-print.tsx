'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { getReceivablePayment } from '@/lib/api';
import { getInvoiceCustomerName } from '@/lib/invoice-customer';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { SessionRequired, useCurrentSession } from './session-required';

export function ReceivablePaymentPrint({
  paymentId,
  autoPrint = false,
}: {
  paymentId: string;
  autoPrint?: boolean;
}) {
  const session = useCurrentSession();
  const router = useRouter();
  const paymentQuery = useQuery({
    queryKey: ['receivable-payment', session?.tenantId, paymentId],
    queryFn: () =>
      getReceivablePayment(session?.tenantId ?? '', session?.accessToken ?? '', paymentId),
    enabled: Boolean(session && paymentId),
  });

  useEffect(() => {
    if (autoPrint && paymentQuery.data) {
      window.setTimeout(() => window.print(), 250);
    }
  }, [autoPrint, paymentQuery.data]);

  if (!session) {
    return <SessionRequired session={session} />;
  }

  if (paymentQuery.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Cargando recibo de abono...</p>;
  }

  if (paymentQuery.error || !paymentQuery.data) {
    return (
      <div className="p-6">
        <p className="text-sm text-danger">
          {paymentQuery.error instanceof Error
            ? paymentQuery.error.message
            : 'No se encontró el recibo de abono.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => router.push('/receivables')}>
          Volver a cuentas por cobrar
        </Button>
      </div>
    );
  }

  const payment = paymentQuery.data;
  const invoice = payment.invoice;
  const customer = invoice.customer;
  const fiscalCustomer = invoice.fiscalCustomerSnapshot;
  const customerDocumentType = fiscalCustomer?.documentType ?? customer?.documentType;
  const customerDocumentNumber = fiscalCustomer?.documentNumber ?? customer?.documentNumber;
  const cancelled = payment.status === 'CANCELLED';

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 print:max-w-none print:p-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Recibo de abono</h1>
          <p className="text-sm text-muted-foreground">{payment.receiptNumber ?? payment.id}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => router.push('/receivables')}>
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            Imprimir / PDF
          </Button>
        </div>
      </div>

      <article className="relative overflow-hidden rounded-lg border border-zinc-200 bg-white p-5 text-zinc-950 shadow-sm sm:p-8 print:border-0 print:p-0 print:shadow-none">
        {cancelled ? (
          <div className="absolute right-[-48px] top-8 rotate-45 border-y-2 border-red-600 px-14 py-1 text-sm font-bold uppercase tracking-[0.2em] text-red-600 print:right-[-32px]">
            Anulado
          </div>
        ) : null}

        <header className="flex flex-col gap-5 border-b border-zinc-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f36c10]">
              Recibo de abono
            </p>
            <h2 className="mt-2 text-2xl font-bold">{session.tenantName}</h2>
            <p className="mt-1 text-sm text-zinc-600">Ferretería RIVNU</p>
          </div>
          <div className="text-sm sm:text-right">
            <p className="font-semibold">{payment.receiptNumber ?? 'Recibo sin numeración'}</p>
            <p>Fecha: {formatDateTime(payment.paidAt ?? payment.createdAt)}</p>
            <p>Moneda: DOP / RD$</p>
          </div>
        </header>

        <section className="grid gap-5 border-b border-zinc-200 py-5 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Recibido de</p>
            <p className="mt-1 text-lg font-semibold">
              {getInvoiceCustomerName(invoice, 'Cliente no disponible')}
            </p>
            {customerDocumentNumber ? (
              <p className="text-sm">
                {customerDocumentType}: {customerDocumentNumber}
              </p>
            ) : null}
            {customer?.phone ? <p className="text-sm">Teléfono: {customer.phone}</p> : null}
          </div>
          <div className="sm:text-right">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Aplicado a</p>
            <p className="mt-1 font-semibold">Factura {invoice.invoiceNumber}</p>
            <p className="text-sm">NCF: {invoice.ncf ?? '-'}</p>
            <p className="text-sm">Emitida: {formatDate(invoice.issuedAt ?? invoice.createdAt)}</p>
            <p className="text-sm">Vence: {formatDate(invoice.dueDate)}</p>
          </div>
        </section>

        <section className="py-7 text-center">
          <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">Monto abonado</p>
          <p
            className={
              cancelled
                ? 'mt-2 text-4xl font-bold text-zinc-500 line-through'
                : 'mt-2 text-4xl font-bold'
            }
          >
            {formatCurrency(Number(payment.amount))}
          </p>
          <p className="mt-2 text-sm text-zinc-600">Método: efectivo</p>
        </section>

        <section className="grid gap-3 border-y border-zinc-200 py-5 sm:grid-cols-3">
          <Amount label="Total de factura" value={Number(invoice.total)} />
          <Amount label="Pagado acumulado" value={Number(invoice.paidAmount)} />
          <Amount label="Saldo actual" value={Number(invoice.balance)} emphasized />
        </section>

        <section className="grid gap-4 py-5 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Registrado por</p>
            <p className="mt-1 font-medium">{payment.user?.name ?? 'Usuario no disponible'}</p>
            <p className="text-zinc-600">{payment.user?.email}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Caja receptora</p>
            <p className="mt-1 font-medium">
              {payment.cashSession?.cashRegister.name ?? 'Caja no disponible'}
            </p>
            {payment.cashSession?.cashRegister.location ? (
              <p className="text-zinc-600">{payment.cashSession.cashRegister.location}</p>
            ) : null}
          </div>
        </section>

        {cancelled ? (
          <section className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-950">
            <p className="font-semibold">Abono anulado</p>
            <p className="mt-1">
              Fecha: {formatDateTime(payment.cancelledAt)} · Responsable:{' '}
              {payment.cancelledBy?.name ?? 'No disponible'}
            </p>
            <p className="mt-1">Motivo: {payment.cancelReason ?? 'No indicado'}</p>
          </section>
        ) : null}

        <footer className="mt-6 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500">
          Este recibo confirma un abono en efectivo aplicado a la factura indicada. Conserva este
          documento para conciliación con tu estado de cuenta.
        </footer>
      </article>
    </div>
  );
}

function Amount({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: number;
  emphasized?: boolean;
}) {
  return (
    <div className={emphasized ? 'rounded-md bg-zinc-100 p-3 text-center' : 'p-3 text-center'}>
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={emphasized ? 'mt-1 text-lg font-bold' : 'mt-1 font-semibold'}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}
