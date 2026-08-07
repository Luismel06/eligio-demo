'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Edit, FileText, Printer, Trash } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { acceptSalesOrder, cancelSalesOrder, getSalesOrders, type SalesOrder } from '@/lib/api';
import { getStatusVariant, translateStatus } from '@/lib/display-labels';
import { getOrderClientLabel, getOrderSearchLabel } from '@/lib/order-client';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { CancelReasonModal } from './cancel-reason-modal';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';

type QuotationTab = 'PENDING' | 'ACCEPTED' | 'CANCELLED';

const acceptedStatuses = new Set(['CREATED', 'SENT_TO_CASHIER', 'IN_CASHIER', 'COMPLETED']);

export function QuotationsView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<QuotationTab>('PENDING');
  const [cancelTarget, setCancelTarget] = useState<SalesOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const quotationsQuery = useQuery({
    queryKey: ['sales-orders', session?.tenantId, 'quotations-all'],
    queryFn: () => getSalesOrders(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });

  const groupedQuotations = useMemo(() => {
    const quotations = (quotationsQuery.data ?? []).filter(isQuotationRecord);

    return {
      PENDING: quotations.filter((order) => order.status === 'QUOTATION'),
      ACCEPTED: quotations.filter((order) => acceptedStatuses.has(order.status)),
      CANCELLED: quotations.filter((order) => order.status === 'CANCELLED'),
    } satisfies Record<QuotationTab, SalesOrder[]>;
  }, [quotationsQuery.data]);

  const cancelMutation = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return cancelSalesOrder(session.tenantId, session.accessToken, orderId, reason);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success('Cotizacion cancelada correctamente.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo cancelar la cotizacion.');
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (orderId: string) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return acceptSalesOrder(session.tenantId, session.accessToken, orderId);
    },
    onSuccess: async (order) => {
      await queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      setActiveTab('ACCEPTED');
      toast.success(
        order.paymentMode === 'CREDIT'
          ? 'Cotización aceptada y enviada para aprobación de crédito'
          : 'Cotización aceptada y enviada a caja',
        {
          description: `Codigo: ${order.orderNumber}`,
        },
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo aceptar la cotizacion.');
    },
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  const tabs = [
    {
      id: 'PENDING' as const,
      label: 'Pendientes',
      description: 'Activas',
      count: groupedQuotations.PENDING.length,
    },
    {
      id: 'ACCEPTED' as const,
      label: 'Aceptadas',
      description: 'En aprobación, caja o completadas',
      count: groupedQuotations.ACCEPTED.length,
    },
    {
      id: 'CANCELLED' as const,
      label: 'Canceladas',
      description: 'Canceladas o rechazadas',
      count: groupedQuotations.CANCELLED.length,
    },
  ];
  const activeOrders = groupedQuotations[activeTab];

  function openCancelModal(order: SalesOrder) {
    setCancelTarget(order);
    setCancelReason('');
  }

  function closeCancelModal() {
    setCancelTarget(null);
    setCancelReason('');
  }

  function confirmCancel() {
    const reason = cancelReason.trim();

    if (!reason) {
      toast.error('El motivo de cancelacion es requerido.');
      return;
    }

    if (cancelTarget) {
      cancelMutation.mutate({ orderId: cancelTarget.id, reason });
    }

    closeCancelModal();
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Cotizaciones"
        description="Gestion centralizada de cotizaciones RIVNU: pendientes, aceptadas y canceladas."
      />

      <Card>
        <CardHeader>
          <CardTitle>Historial de cotizaciones</CardTitle>
          <CardDescription>
            Las cotizaciones se clasifican por codigo COT y estado operativo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-1 md:grid-cols-3">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-md px-3 py-3 text-left transition ${
                  activeTab === tab.id
                    ? 'bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200'
                    : 'text-zinc-600 hover:bg-white/70'
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">{tab.label}</span>
                  <Badge variant={activeTab === tab.id ? 'success' : 'outline'}>{tab.count}</Badge>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{tab.description}</span>
              </button>
            ))}
          </div>

          {quotationsQuery.isLoading ? (
            <p className="rounded-md bg-zinc-50 px-3 py-4 text-sm text-muted-foreground">
              Cargando cotizaciones...
            </p>
          ) : activeOrders.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {activeOrders.map((order) => (
                <QuotationCard
                  key={order.id}
                  order={order}
                  tab={activeTab}
                  isAccepting={acceptMutation.isPending && acceptMutation.variables === order.id}
                  isCancelling={
                    cancelMutation.isPending && cancelMutation.variables?.orderId === order.id
                  }
                  onAccept={() => acceptMutation.mutate(order.id)}
                  onEdit={() => router.push(`/orders?edit=${order.id}`)}
                  onCancel={() => openCancelModal(order)}
                />
              ))}
            </div>
          ) : (
            <EmptyQuotationState tab={activeTab} />
          )}
        </CardContent>
      </Card>

      <CancelReasonModal
        open={Boolean(cancelTarget)}
        title="Cancelar cotizacion"
        description={
          cancelTarget
            ? `Indica por que se cancela ${cancelTarget.orderNumber}.`
            : 'Indica por que se cancela esta cotizacion.'
        }
        reason={cancelReason}
        confirmLabel="Cancelar cotizacion"
        isPending={cancelMutation.isPending}
        onReasonChange={setCancelReason}
        onClose={closeCancelModal}
        onConfirm={confirmCancel}
      />
    </div>
  );
}

function QuotationCard({
  order,
  tab,
  isAccepting,
  isCancelling,
  onAccept,
  onEdit,
  onCancel,
}: {
  order: SalesOrder;
  tab: QuotationTab;
  isAccepting: boolean;
  isCancelling: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const canManage = tab === 'PENDING';

  return (
    <div className="flex min-h-[19rem] flex-col justify-between rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-zinc-950">
              {getOrderSearchLabel(order)}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Creada el {formatDateTime(order.createdAt)}
            </p>
          </div>
          <Badge variant={getStatusVariant(order.status)}>{translateStatus(order.status)}</Badge>
        </div>

        <div className="space-y-1 border-t border-zinc-100 pt-3 text-sm">
          <p className="text-zinc-700">
            <strong className="font-semibold text-zinc-900">Cliente:</strong>{' '}
            {getOrderClientLabel(order)}
          </p>
          {order.quotationDocumentType && order.quotationDocumentNumber ? (
            <p className="text-xs text-muted-foreground">
              {order.quotationDocumentType}: {order.quotationDocumentNumber}
            </p>
          ) : null}
          <p className="text-xs text-zinc-500">Por: {order.createdBy.name}</p>
          {order.paymentMode === 'CREDIT' ? (
            <p className="rounded-md bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
              Venta fiada · inicial {formatCurrency(Number(order.initialPaymentAmount))} · saldo{' '}
              {formatCurrency(Number(order.total) - Number(order.initialPaymentAmount))}
              {order.creditApproval?.status === 'PENDING' ? ' · pendiente de aprobación' : ''}
            </p>
          ) : null}
          {order.sentToCashierAt ? (
            <p className="text-xs text-zinc-500">
              Enviada a caja: {formatDateTime(order.sentToCashierAt)}
            </p>
          ) : null}
          {order.cancelReason ? (
            <p className="rounded-md bg-danger/5 px-2 py-1.5 text-xs text-danger">
              Motivo: {order.cancelReason}
            </p>
          ) : null}
          {order.notes ? (
            <p className="line-clamp-2 rounded-md bg-zinc-50 px-2 py-1.5 text-xs italic text-zinc-600">
              &ldquo;{order.notes}&rdquo;
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 border-t border-zinc-100 pt-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{order.items.length} producto(s)</span>
          <strong className="text-lg font-extrabold text-[#f36c10]">
            {formatCurrency(Number(order.total))}
          </strong>
        </div>

        <div className={canManage ? 'grid grid-cols-2 gap-2' : 'grid gap-2'}>
          {canManage ? (
            <>
              <Button
                type="button"
                className="bg-[#f36c10] text-white hover:bg-[#d85f0e]"
                size="sm"
                onClick={onAccept}
                disabled={isAccepting}
              >
                <Check className="h-4 w-4" />
                Aceptar
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onEdit}>
                <Edit className="h-4 w-4" />
                Modificar
              </Button>
            </>
          ) : null}
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={`/orders/${order.id}/print`}>
              <Printer className="h-4 w-4" />
              Imprimir
            </Link>
          </Button>
          {canManage ? (
            <Button
              type="button"
              variant="ghost"
              className="text-danger hover:bg-danger/5 hover:text-danger"
              size="sm"
              onClick={onCancel}
              disabled={isCancelling}
            >
              <Trash className="h-4 w-4" />
              Eliminar
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EmptyQuotationState({ tab }: { tab: QuotationTab }) {
  const messages: Record<QuotationTab, { title: string; description: string }> = {
    PENDING: {
      title: 'No hay cotizaciones pendientes',
      description: 'Las cotizaciones activas que crees en Toma de ordenes apareceran aqui.',
    },
    ACCEPTED: {
      title: 'No hay cotizaciones aceptadas',
      description: 'Cuando aceptes una cotizacion, pasara a esta pestana.',
    },
    CANCELLED: {
      title: 'No hay cotizaciones canceladas',
      description: 'Las cotizaciones eliminadas o rechazadas quedaran aqui.',
    },
  };

  return (
    <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 py-12 text-center">
      <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
      <p className="mt-4 font-medium text-zinc-900">{messages[tab].title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{messages[tab].description}</p>
    </div>
  );
}

function isQuotationRecord(order: SalesOrder) {
  return order.destination === 'QUOTATION' || order.orderNumber.startsWith('COT-');
}
