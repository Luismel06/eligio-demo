'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { getSupplierInvoice } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { ProcurementStatusBadge } from './procurement-ui';
import { SessionRequired, useCurrentSession } from './session-required';

export function SupplierInvoicePrint({
  invoiceId,
  autoPrint = false,
}: {
  invoiceId: string;
  autoPrint?: boolean;
}) {
  const session = useCurrentSession();
  const autoPrintTriggeredRef = useRef(false);
  const invoiceQuery = useQuery({
    queryKey: ['supplier-invoice', invoiceId, session?.tenantId],
    queryFn: () =>
      getSupplierInvoice(session?.tenantId ?? '', session?.accessToken ?? '', invoiceId),
    enabled: Boolean(session && invoiceId),
  });

  useEffect(() => {
    if (autoPrint && invoiceQuery.data && !autoPrintTriggeredRef.current) {
      autoPrintTriggeredRef.current = true;
      window.setTimeout(() => window.print(), 300);
    }
  }, [autoPrint, invoiceQuery.data]);

  if (!session) return <SessionRequired session={session} />;

  if (invoiceQuery.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Cargando factura de suplidor...</p>;
  }

  if (invoiceQuery.error || !invoiceQuery.data) {
    return (
      <div className="p-6">
        <p className="text-sm text-danger">
          {invoiceQuery.error instanceof Error
            ? invoiceQuery.error.message
            : 'No se encontró la factura de suplidor.'}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Button>
      </div>
    );
  }

  const invoice = invoiceQuery.data;
  const activePayments = invoice.payments?.filter((payment) => payment.status !== 'CANCELLED') ?? [];
  const cancelledPayments = invoice.payments?.filter((payment) => payment.status === 'CANCELLED') ?? [];

  return (
    <>
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm;
          }

          body {
            background: #ffffff !important;
          }

          * {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>

      <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6 print:max-w-none print:p-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <div>
            <h1 className="text-2xl font-bold">Factura de suplidor</h1>
            <p className="text-sm text-muted-foreground">
              Consulta el documento completo o guárdalo como PDF desde el diálogo de impresión.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.history.back()}>
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
          {invoice.status === 'CANCELLED' ? (
            <div className="absolute right-[-52px] top-10 rotate-45 border-y-2 border-red-600 px-16 py-1 text-sm font-bold uppercase tracking-[0.2em] text-red-600 print:right-[-34px]">
              Anulada
            </div>
          ) : null}

          <header className="flex flex-col gap-5 border-b border-zinc-200 pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f36c10]">
                Factura de suplidor
              </p>
              <h2 className="mt-2 text-2xl font-bold">{invoice.invoiceNumber}</h2>
              <div className="mt-3">
                <ProcurementStatusBadge status={invoice.displayStatus} />
              </div>
            </div>
            <div className="text-sm sm:text-right">
              <p className="font-semibold">{session.tenantName}</p>
              <p>Moneda: DOP / RD$</p>
              <p>Registrada: {formatDateTime(invoice.createdAt)}</p>
            </div>
          </header>

          <section className="grid gap-5 border-b border-zinc-200 py-5 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">Suplidor</p>
              <p className="mt-1 text-lg font-semibold">{invoice.supplierNameSnapshot}</p>
              <p className="text-sm">
                {invoice.supplierDocumentTypeSnapshot}: {invoice.supplierDocumentNumberSnapshot}
              </p>
              {invoice.supplierAddressSnapshot ? (
                <p className="mt-1 text-sm">{invoice.supplierAddressSnapshot}</p>
              ) : null}
              {invoice.supplier?.contactName ? (
                <p className="mt-2 text-sm">
                  Contacto: {invoice.supplier.contactName}
                  {invoice.supplier.contactPhone ? ` · ${invoice.supplier.contactPhone}` : ''}
                </p>
              ) : invoice.supplier?.phone ? (
                <p className="mt-2 text-sm">Teléfono: {invoice.supplier.phone}</p>
              ) : null}
              {invoice.supplier?.email ? <p className="text-sm">{invoice.supplier.email}</p> : null}
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2 md:ml-auto md:max-w-md md:text-right">
              <PrintMeta label="Factura / documento #" value={invoice.invoiceNumber} />
              <PrintMeta label="NCF / e-NCF" value={invoice.ncf ?? 'Sin NCF'} />
              <PrintMeta label="Fecha de emisión" value={formatDate(invoice.issueDate)} />
              <PrintMeta
                label="Condición de pago"
                value={invoice.paymentCondition ?? 'No indicada'}
              />
              <PrintMeta label="Fecha límite de pago" value={formatDate(invoice.dueDate)} />
              <PrintMeta
                label="Vigencia fiscal NCF / e-NCF"
                value={invoice.ncfValidUntil ? formatDate(invoice.ncfValidUntil) : 'No indicada'}
              />
              <PrintMeta
                label="Orden de compra"
                value={invoice.purchaseOrder?.orderNumber ?? 'Sin orden previa'}
              />
              <PrintMeta label="Registrada por" value={invoice.createdBy?.name ?? 'No disponible'} />
            </div>
          </section>

          <section className="py-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-600">
              Detalle facturado
            </h3>
            <div className="overflow-x-auto rounded-md border border-zinc-200">
              <table className="min-w-[760px] w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-300 bg-zinc-50 text-left">
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-3 py-2 text-right">Cant.</th>
                    <th className="px-3 py-2 text-right">Costo neto</th>
                    <th className="px-3 py-2 text-right">Descuento</th>
                    <th className="px-3 py-2 text-right">ITBIS</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items?.map((item) => (
                    <tr key={item.id} className="border-b border-zinc-100 last:border-0">
                      <td className="px-3 py-3">
                        <p className="font-medium">{item.descriptionSnapshot}</p>
                        <p className="text-xs text-zinc-500">
                          {item.skuSnapshot ?? 'Sin SKU'} · {item.unitSnapshot}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right">{Number(item.quantity)}</td>
                      <td className="px-3 py-3 text-right">
                        {formatCurrency(Number(item.unitCostNet))}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {formatCurrency(Number(item.discountTotal))}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <p>{formatCurrency(Number(item.taxTotal))}</p>
                        <p className="text-xs text-zinc-500">
                          {(Number(item.taxRate) * 100).toLocaleString('es-DO', {
                            maximumFractionDigits: 2,
                          })}
                          %
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right font-medium">
                        {formatCurrency(Number(item.total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-5 border-t border-zinc-200 pt-5 md:grid-cols-[minmax(0,1fr)_21rem]">
            <div className="space-y-4">
              {invoice.notes ? (
                <div className="rounded-md border border-zinc-200 p-4 text-sm">
                  <p className="font-semibold">Notas</p>
                  <p className="mt-1 whitespace-pre-wrap text-zinc-700">{invoice.notes}</p>
                </div>
              ) : null}

              {invoice.goodsReceipts?.length ? (
                <div className="rounded-md border border-zinc-200 p-4 text-sm">
                  <p className="font-semibold">Entradas de mercancía</p>
                  <ul className="mt-2 space-y-1 text-zinc-700">
                    {invoice.goodsReceipts.map((receipt) => (
                      <li key={receipt.id}>
                        {receipt.receiptNumber} · {paymentStatusLabel(receipt.status)}
                        {receipt.confirmedAt ? ` · ${formatDateTime(receipt.confirmedAt)}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {invoice.status === 'CANCELLED' ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-950">
                  <p className="font-semibold">Factura anulada</p>
                  <p className="mt-1">
                    {invoice.cancelledAt ? `Fecha: ${formatDateTime(invoice.cancelledAt)} · ` : ''}
                    Responsable: {invoice.cancelledBy?.name ?? 'No disponible'}
                  </p>
                  <p className="mt-1">Motivo: {invoice.cancelReason ?? 'No indicado'}</p>
                </div>
              ) : null}
            </div>

            <div className="space-y-2 rounded-md bg-zinc-50 p-4 text-sm print:border print:border-zinc-200 print:bg-white">
              <AmountLine label="Subtotal" value={Number(invoice.subtotal)} />
              <AmountLine label="Descuento" value={Number(invoice.discountTotal)} />
              <AmountLine label="ITBIS" value={Number(invoice.taxTotal)} />
              <AmountLine label="Total facturado" value={Number(invoice.total)} strong />
              <div className="my-3 border-t border-zinc-200" />
              <AmountLine label="Pagado" value={Number(invoice.paidAmount)} />
              <AmountLine label="Saldo pendiente" value={Number(invoice.balance)} emphasized />
            </div>
          </section>

          <section className="mt-6 border-t border-zinc-200 pt-5">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">
                Historial de pagos
              </h3>
              <span className="text-xs text-zinc-500">
                {activePayments.length} pago(s) aplicado(s)
              </span>
            </div>
            {activePayments.length ? (
              <div className="overflow-x-auto rounded-md border border-zinc-200">
                <table className="min-w-[720px] w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-300 bg-zinc-50 text-left">
                      <th className="px-3 py-2">Comprobante</th>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">Método</th>
                      <th className="px-3 py-2 text-right">Entregado</th>
                      <th className="px-3 py-2 text-right">Cambio</th>
                      <th className="px-3 py-2 text-right">Aplicado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePayments.map((payment) => (
                      <tr key={payment.id} className="border-b border-zinc-100 last:border-0">
                        <td className="px-3 py-3">
                          <p className="font-medium">{payment.paymentNumber}</p>
                          {payment.reference ? (
                            <p className="text-xs text-zinc-500">Ref.: {payment.reference}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3">{formatDateTime(payment.paidAt)}</td>
                        <td className="px-3 py-3">{paymentMethodLabel(payment.method)}</td>
                        <td className="px-3 py-3 text-right">
                          {formatCurrency(Number(payment.tenderedAmount ?? payment.amount))}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {formatCurrency(Number(payment.changeAmount ?? 0))}
                        </td>
                        <td className="px-3 py-3 text-right font-medium">
                          {formatCurrency(Number(payment.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-md border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
                Esta factura todavía no tiene pagos aplicados.
              </p>
            )}

            {cancelledPayments.length ? (
              <p className="mt-3 text-xs text-zinc-500">
                {cancelledPayments.length} pago(s) anulado(s) conservado(s) en el historial de la
                factura.
              </p>
            ) : null}
          </section>

          <footer className="mt-10 border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500">
            Documento generado por {session.tenantName}. Los importes se expresan en pesos
            dominicanos (RD$).
          </footer>
        </article>
      </div>
    </>
  );
}

function PrintMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function AmountLine({
  label,
  value,
  strong = false,
  emphasized = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
  emphasized?: boolean;
}) {
  return (
    <div
      className={
        emphasized
          ? 'flex items-center justify-between rounded-md bg-zinc-200/70 px-3 py-2 text-base'
          : strong
            ? 'flex items-center justify-between pt-1 text-lg'
            : 'flex items-center justify-between'
      }
    >
      <span className={strong || emphasized ? 'font-semibold' : ''}>{label}</span>
      <strong>{formatCurrency(value)}</strong>
    </div>
  );
}

function paymentMethodLabel(method: 'CASH' | 'TRANSFER' | 'CHECK') {
  if (method === 'CASH') return 'Efectivo';
  if (method === 'TRANSFER') return 'Transferencia';
  return 'Cheque';
}

function paymentStatusLabel(status: string) {
  if (status === 'CONFIRMED') return 'Confirmada';
  if (status === 'COMPLETED') return 'Completado';
  if (status === 'CANCELLED') return 'Anulada';
  if (status === 'REVERSED') return 'Revertida';
  return status.replaceAll('_', ' ').toLowerCase();
}
