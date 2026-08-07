'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getSalesOrder } from '@/lib/api';
import { getOrderClientLabel } from '@/lib/order-client';
import { translateStatus } from '@/lib/display-labels';
import { formatCurrency, formatDate } from '@/lib/utils';
import { formatQuantity } from './pos/pos-utils';
import { SessionRequired, useCurrentSession } from './session-required';

export function QuotationPrint({
  orderId,
  autoPrint = false,
}: {
  orderId: string;
  autoPrint?: boolean;
}) {
  const session = useCurrentSession();
  const router = useRouter();

  const orderQuery = useQuery({
    queryKey: ['sales-order', orderId, session?.tenantId],
    queryFn: () => getSalesOrder(session?.tenantId ?? '', session?.accessToken ?? '', orderId),
    enabled: Boolean(session && orderId),
  });

  useEffect(() => {
    if (autoPrint && orderQuery.data) {
      window.setTimeout(() => window.print(), 300);
    }
  }, [autoPrint, orderQuery.data]);

  if (!session) {
    return <SessionRequired session={session} />;
  }

  if (orderQuery.isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Cargando cotizacion...</p>;
  }

  const order = orderQuery.data;

  if (!order || !isQuotationRecord(order)) {
    return (
      <div className="p-6">
        <p className="text-sm text-danger">Cotizacion no encontrada.</p>
        <Button className="mt-4" variant="outline" onClick={() => router.push('/quotations')}>
          Volver a cotizaciones
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 print:p-0">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Cotizacion {order.orderNumber}</h1>
          <p className="text-sm text-muted-foreground">{formatDate(order.createdAt)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push('/quotations')}>
            Volver
          </Button>
          <Button onClick={() => window.print()}>Imprimir</Button>
        </div>
      </div>

      <article className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none">
        <header className="border-b border-zinc-200 pb-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-[#f36c10]">Cotizacion</p>
          <h2 className="mt-2 text-2xl font-bold">{order.orderNumber}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline">{translateStatus(order.status)}</Badge>
            {order.paymentMode === 'CREDIT' ? (
              <Badge variant="outline">Modalidad: fiado</Badge>
            ) : (
              <Badge variant="outline">Modalidad: contado</Badge>
            )}
          </div>
        </header>

        <section className="grid gap-4 py-4 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase text-muted-foreground">Cliente</p>
            <p className="font-medium">{getOrderClientLabel(order)}</p>
          </div>
          {order.quotationDocumentType && order.quotationDocumentNumber ? (
            <div>
              <p className="text-xs uppercase text-muted-foreground">Documento</p>
              <p className="font-medium">
                {order.quotationDocumentType}: {order.quotationDocumentNumber}
              </p>
            </div>
          ) : null}
          <div>
            <p className="text-xs uppercase text-muted-foreground">Elaborada por</p>
            <p className="font-medium">{order.createdBy.name}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-muted-foreground">Fecha</p>
            <p className="font-medium">{formatDate(order.createdAt)}</p>
          </div>
          {order.paymentMode === 'CREDIT' ? (
            <>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Pago inicial</p>
                <p className="font-medium">{formatCurrency(Number(order.initialPaymentAmount))}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Saldo financiado</p>
                <p className="font-medium">
                  {formatCurrency(Number(order.total) - Number(order.initialPaymentAmount))}
                </p>
              </div>
              {order.dueDate ? (
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Vencimiento previsto</p>
                  <p className="font-medium">{formatDate(order.dueDate)}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </section>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left">
              <th className="py-2">Producto</th>
              <th className="py-2 text-right">Cant.</th>
              <th className="py-2 text-right">Precio</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id} className="border-b border-zinc-100">
                <td className="py-2">{item.description}</td>
                <td className="py-2 text-right">{formatQuantity(item.quantity)}</td>
                <td className="py-2 text-right">{formatCurrency(Number(item.unitPrice))}</td>
                <td className="py-2 text-right">{formatCurrency(Number(item.total))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="mt-4 space-y-2 border-t border-zinc-200 pt-4 text-sm">
          <div className="flex justify-between">
            <span>Subtotal</span>
            <strong>{formatCurrency(Number(order.subtotal))}</strong>
          </div>
          <div className="flex justify-between">
            <span>ITBIS</span>
            <strong>{formatCurrency(Number(order.taxTotal))}</strong>
          </div>
          <div className="flex justify-between text-base">
            <span>Total</span>
            <strong>{formatCurrency(Number(order.total))}</strong>
          </div>
          {order.notes ? (
            <p className="pt-2 text-muted-foreground">
              <span className="font-medium text-zinc-950">Notas:</span> {order.notes}
            </p>
          ) : null}
        </footer>
      </article>
    </div>
  );
}

function isQuotationRecord(order: { destination?: string; orderNumber: string }) {
  return order.destination === 'QUOTATION' || order.orderNumber.startsWith('COT-');
}
