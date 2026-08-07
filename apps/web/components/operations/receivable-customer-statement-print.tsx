'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCustomerStatement, type ReceivableInvoice } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { SessionRequired, useCurrentSession } from './session-required';

export function ReceivableCustomerStatementPrint({
  customerId,
  autoPrint = false,
}: {
  customerId: string;
  autoPrint?: boolean;
}) {
  const session = useCurrentSession();
  const router = useRouter();
  const statementQuery = useQuery({
    queryKey: ['receivable-customer-statement', session?.tenantId, customerId],
    queryFn: () =>
      getCustomerStatement(session?.tenantId ?? '', session?.accessToken ?? '', customerId),
    enabled: Boolean(session && customerId),
  });

  useEffect(() => {
    if (autoPrint && statementQuery.data) {
      window.setTimeout(() => window.print(), 250);
    }
  }, [autoPrint, statementQuery.data]);

  if (!session) {
    return <SessionRequired session={session} />;
  }

  if (statementQuery.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Cargando estado de cuenta...</p>;
  }

  if (statementQuery.error || !statementQuery.data) {
    return (
      <div className="p-6">
        <p className="text-sm text-danger">
          {statementQuery.error instanceof Error
            ? statementQuery.error.message
            : 'No se encontró el estado de cuenta.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => router.push('/receivables')}>
          Volver a cuentas por cobrar
        </Button>
      </div>
    );
  }

  const statement = statementQuery.data;
  const appliedPayments = statement.invoices.flatMap((invoice) =>
    (invoice.payments ?? [])
      .filter((payment) => payment.receiptNumber)
      .map((payment) => ({ ...payment, invoiceNumber: invoice.invoiceNumber })),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 print:max-w-none print:p-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Estado de cuenta</h1>
          <p className="text-sm text-muted-foreground">{statement.customer.name}</p>
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

      <article className="rounded-lg border border-zinc-200 bg-white p-4 text-zinc-950 shadow-sm sm:p-7 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-col gap-5 border-b border-zinc-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f36c10]">
              Estado de cuenta por cobrar
            </p>
            <h2 className="mt-2 text-2xl font-bold">{session.tenantName}</h2>
            <p className="mt-1 text-sm text-zinc-600">Ferretería RIVNU</p>
          </div>
          <div className="text-sm sm:text-right">
            <p>
              <span className="text-zinc-500">Generado:</span>{' '}
              {formatDateTime(statement.generatedAt)}
            </p>
            <p>
              <span className="text-zinc-500">Moneda:</span> DOP / RD$
            </p>
            <p>
              <span className="text-zinc-500">Facturas:</span> {statement.invoices.length}
            </p>
          </div>
        </header>

        <section className="grid gap-5 border-b border-zinc-200 py-5 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Cliente</p>
            <p className="mt-1 text-lg font-semibold">{statement.customer.name}</p>
            {statement.customer.documentNumber ? (
              <p className="text-sm">
                {statement.customer.documentType}: {statement.customer.documentNumber}
              </p>
            ) : null}
            {statement.customer.phone ? (
              <p className="text-sm">Teléfono: {statement.customer.phone}</p>
            ) : null}
            {statement.customer.email ? (
              <p className="text-sm">Correo: {statement.customer.email}</p>
            ) : null}
            {statement.customer.address ? (
              <p className="mt-1 text-sm text-zinc-600">{statement.customer.address}</p>
            ) : null}
          </div>
          <div className="sm:text-right">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Condición de crédito</p>
            <p className="mt-1 font-semibold">
              {statement.customer.creditEnabled ? 'Crédito habilitado' : 'Crédito deshabilitado'}
            </p>
            <p className="text-sm">
              Límite: {formatCurrency(Number(statement.customer.creditLimit))}
            </p>
            <p className="text-sm">Plazo configurado: {statement.customer.creditTermDays} días</p>
            <p className="text-sm">
              Estado: {statement.customer.creditStatus === 'ACTIVE' ? 'Activo' : 'Bloqueado'}
            </p>
          </div>
        </section>

        <section className="grid gap-3 border-b border-zinc-200 py-5 sm:grid-cols-3">
          <Summary label="Total financiado" value={Number(statement.totals.total)} />
          <Summary label="Total pagado" value={Number(statement.totals.paid)} />
          <Summary label="Saldo pendiente" value={Number(statement.totals.balance)} emphasized />
        </section>

        <section className="py-5">
          <h3 className="mb-3 font-semibold">Facturas a crédito</h3>
          {statement.invoices.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-zinc-300 text-left">
                    <th className="py-2 pr-3">Factura</th>
                    <th className="px-3 py-2">Emisión</th>
                    <th className="px-3 py-2">Vencimiento</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Pagado</th>
                    <th className="py-2 pl-3 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-zinc-100">
                      <td className="py-3 pr-3 font-medium">{invoice.invoiceNumber}</td>
                      <td className="px-3 py-3">
                        {formatDate(invoice.issuedAt ?? invoice.createdAt)}
                      </td>
                      <td className="px-3 py-3">{formatDate(invoice.dueDate)}</td>
                      <td className="px-3 py-3">
                        <Badge variant={dueBucketVariant(invoice.dueBucket)}>
                          {dueBucketLabel(invoice.dueBucket)}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatCurrency(Number(invoice.total))}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatCurrency(Number(invoice.paidAmount))}
                      </td>
                      <td className="py-3 pl-3 text-right font-semibold">
                        {formatCurrency(Number(invoice.balance))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-5 text-center text-sm text-zinc-500">
              Este cliente no tiene facturas a crédito.
            </p>
          )}
        </section>

        <section className="border-t border-zinc-200 py-5">
          <h3 className="mb-3 font-semibold">Historial de abonos</h3>
          {appliedPayments.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-zinc-300 text-left">
                    <th className="py-2 pr-3">Recibo</th>
                    <th className="px-3 py-2">Factura</th>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="py-2 pl-3 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {appliedPayments.map((payment) => (
                    <tr key={payment.id} className="border-b border-zinc-100">
                      <td className="py-3 pr-3 font-medium">{payment.receiptNumber}</td>
                      <td className="px-3 py-3">{payment.invoiceNumber}</td>
                      <td className="px-3 py-3">
                        {formatDateTime(payment.paidAt ?? payment.createdAt)}
                      </td>
                      <td className="px-3 py-3">
                        {payment.status === 'CANCELLED' ? 'Anulado' : 'Aplicado'}
                      </td>
                      <td
                        className={
                          payment.status === 'CANCELLED'
                            ? 'py-3 pl-3 text-right text-zinc-500 line-through'
                            : 'py-3 pl-3 text-right font-medium'
                        }
                      >
                        {formatCurrency(Number(payment.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-5 text-center text-sm text-zinc-500">
              No hay abonos registrados.
            </p>
          )}
        </section>

        <footer className="border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500">
          Documento generado por Qorvex para {session.tenantName}. Los pagos anulados se conservan
          en el historial para fines de auditoría.
        </footer>
      </article>
    </div>
  );
}

function Summary({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: number;
  emphasized?: boolean;
}) {
  return (
    <div className={emphasized ? 'rounded-md bg-zinc-100 p-3 sm:text-right' : 'p-3 sm:text-right'}>
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={emphasized ? 'mt-1 text-xl font-bold' : 'mt-1 text-lg font-semibold'}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function dueBucketLabel(bucket: ReceivableInvoice['dueBucket']) {
  return {
    OVERDUE: 'Vencida',
    TODAY: 'Vence hoy',
    DUE_SOON: 'Próxima',
    CURRENT: 'Al día',
    PAID: 'Pagada',
  }[bucket];
}

function dueBucketVariant(bucket: ReceivableInvoice['dueBucket']) {
  if (bucket === 'OVERDUE') return 'danger' as const;
  if (bucket === 'TODAY' || bucket === 'DUE_SOON') return 'warning' as const;
  if (bucket === 'PAID') return 'success' as const;
  return 'outline' as const;
}
