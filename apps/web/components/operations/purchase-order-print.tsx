'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { getPurchaseOrder } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { ProcurementStatusBadge } from './procurement-ui';
import { SessionRequired, useCurrentSession } from './session-required';

export function PurchaseOrderPrint({
  orderId,
  autoPrint = false,
}: {
  orderId: string;
  autoPrint?: boolean;
}) {
  const session = useCurrentSession();
  const router = useRouter();
  const orderQuery = useQuery({
    queryKey: ['purchase-order', orderId, session?.tenantId],
    queryFn: () =>
      getPurchaseOrder(session?.tenantId ?? '', session?.accessToken ?? '', orderId),
    enabled: Boolean(session && orderId),
  });

  useEffect(() => {
    if (autoPrint && orderQuery.data) {
      window.setTimeout(() => window.print(), 250);
    }
  }, [autoPrint, orderQuery.data]);

  if (!session) return <SessionRequired session={session} />;
  if (orderQuery.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Cargando orden de compra...</p>;
  }
  if (!orderQuery.data) {
    return <p className="p-6 text-sm text-danger">No se encontró la orden de compra.</p>;
  }

  const order = orderQuery.data;

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6 print:max-w-none print:p-0">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Orden {order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">
            Usa “Guardar como PDF” en el diálogo de impresión.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/purchase-orders')}>
            Volver
          </Button>
          <Button onClick={() => window.print()}>Imprimir / PDF</Button>
        </div>
      </div>

      <article className="rounded-lg border bg-white p-7 text-zinc-950 shadow-sm print:border-0 print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-5 border-b border-zinc-200 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f36c10]">
              Orden de compra
            </p>
            <h2 className="mt-2 text-2xl font-bold">{order.orderNumber}</h2>
            <div className="mt-3">
              <ProcurementStatusBadge status={order.displayStatus} />
            </div>
          </div>
          <div className="text-right text-sm">
            <p className="font-semibold">EligioValdez Comercial</p>
            <p>Moneda: DOP / RD$</p>
            <p>Fecha: {formatDate(order.createdAt)}</p>
          </div>
        </header>

        <section className="grid gap-5 border-b border-zinc-200 py-5 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-zinc-500">Suplidor</p>
            <p className="mt-1 font-semibold">{order.supplierNameSnapshot}</p>
            <p className="text-sm">
              {order.supplierDocumentTypeSnapshot}: {order.supplierDocumentNumberSnapshot}
            </p>
            {order.supplierContactSnapshot ? (
              <p className="text-sm">Contacto: {order.supplierContactSnapshot}</p>
            ) : null}
            {order.supplierAddressSnapshot ? (
              <p className="mt-1 text-sm">{order.supplierAddressSnapshot}</p>
            ) : null}
          </div>
          <div className="sm:text-right">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Entrega estimada</p>
            <p className="mt-1 font-semibold">{formatDate(order.expectedDeliveryDate)}</p>
            <p className="mt-3 text-xs uppercase tracking-wide text-zinc-500">Solicitada por</p>
            <p className="font-medium">{order.requestedBy?.name ?? order.createdBy.name}</p>
          </div>
        </section>

        <div className="overflow-hidden py-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left">
                <th className="py-2">Producto</th>
                <th className="py-2 text-right">Cantidad</th>
                <th className="py-2 text-right">Costo neto</th>
                <th className="py-2 text-right">Descuento</th>
                <th className="py-2 text-right">ITBIS</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id} className="border-b border-zinc-100">
                  <td className="py-3">
                    <p className="font-medium">{item.descriptionSnapshot}</p>
                    <p className="text-xs text-zinc-500">{item.skuSnapshot ?? 'Sin SKU'}</p>
                  </td>
                  <td className="py-3 text-right">{Number(item.quantity)}</td>
                  <td className="py-3 text-right">{formatCurrency(Number(item.unitCostNet))}</td>
                  <td className="py-3 text-right">{formatCurrency(Number(item.discountTotal))}</td>
                  <td className="py-3 text-right">{formatCurrency(Number(item.taxTotal))}</td>
                  <td className="py-3 text-right font-medium">
                    {formatCurrency(Number(item.total))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="ml-auto max-w-sm space-y-2 border-t border-zinc-200 pt-4 text-sm">
          <Line label="Subtotal" value={Number(order.subtotal)} />
          <Line label="Descuento" value={Number(order.discountTotal)} />
          <Line label="ITBIS" value={Number(order.taxTotal)} />
          <Line label="Total" value={Number(order.total)} strong />
        </footer>
        {order.notes ? (
          <div className="mt-6 rounded-md border border-zinc-200 p-3 text-sm">
            <strong>Notas:</strong> {order.notes}
          </div>
        ) : null}

        <div className="mt-16 grid grid-cols-2 gap-12 text-center text-sm">
          <div className="border-t border-zinc-500 pt-2">Preparado por</div>
          <div className="border-t border-zinc-500 pt-2">Aprobado por</div>
        </div>
      </article>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between text-lg' : 'flex justify-between'}>
      <span>{label}</span>
      <strong>{formatCurrency(value)}</strong>
    </div>
  );
}
