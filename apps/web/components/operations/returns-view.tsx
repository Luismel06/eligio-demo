'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, ReceiptText, RotateCcw, Search, ShieldCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  approveReturnRequest,
  createReturnRequest,
  getCashSessions,
  getReturnRequests,
  lookupReturnInvoice,
  rejectReturnRequest,
  type CashSession,
  type ReturnInvoiceLookup,
  type ReturnRequest,
} from '@/lib/api';
import { isAdminSession } from '@/lib/authorization';
import { getStatusVariant, translatePaymentMethod, translateStatus } from '@/lib/display-labels';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { formatQuantity, getQuantityStep } from './pos/pos-utils';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';

type SelectionState = Record<
  string,
  {
    selected: boolean;
    quantity: string;
    restock: boolean;
  }
>;

type DecisionMode = 'APPROVE' | 'REJECT';

const returnTabs = [
  { id: 'REQUESTED', label: 'Pendientes' },
  { id: 'COMPLETED', label: 'Completadas' },
  { id: 'REJECTED', label: 'Rechazadas' },
  { id: 'ALL', label: 'Todas' },
] as const;

export function ReturnsView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<ReturnInvoiceLookup | null>(null);
  const [selections, setSelections] = useState<SelectionState>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('CASH');
  const [activeTab, setActiveTab] = useState<(typeof returnTabs)[number]['id']>('REQUESTED');
  const [decisionTarget, setDecisionTarget] = useState<ReturnRequest | null>(null);
  const [decisionMode, setDecisionMode] = useState<DecisionMode>('APPROVE');
  const [adminNote, setAdminNote] = useState('');
  const [decisionCashSessionId, setDecisionCashSessionId] = useState('');
  const [decisionRefundMethod, setDecisionRefundMethod] = useState('CASH');

  const admin = isAdminSession(session);

  const returnsQuery = useQuery({
    queryKey: ['returns', session?.tenantId],
    queryFn: () => getReturnRequests(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });

  const cashSessionsQuery = useQuery({
    queryKey: ['cash-sessions', session?.tenantId],
    queryFn: () => getCashSessions(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session && admin),
  });

  const openCashSessions = useMemo(
    () => (cashSessionsQuery.data ?? []).filter((cashSession) => cashSession.status === 'OPEN'),
    [cashSessionsQuery.data],
  );

  const lookupMutation = useMutation({
    mutationFn: (query: string) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return lookupReturnInvoice(session.tenantId, session.accessToken, query);
    },
    onSuccess: (invoice) => {
      setSelectedInvoice(invoice);
      setSelections(createDefaultSelections(invoice));
      setReason('');
      setRefundMethod(invoice.paymentMethod ?? 'CASH');

      if (!invoice.items.some((item) => item.canReturn)) {
        toast.warning('Esta factura no tiene productos disponibles para devolver.');
      }
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo buscar la factura.');
    },
  });

  const createMutation = useMutation({
    mutationFn: () => {
      if (!session || !selectedInvoice) {
        throw new Error('Selecciona una factura antes de solicitar la devolucion.');
      }

      const items = getSelectedItems(selectedInvoice, selections).map(({ item, selection }) => ({
        invoiceItemId: item.id,
        quantity: Number(selection.quantity),
        restock: selection.restock,
      }));

      if (!items.length) {
        throw new Error('Selecciona al menos un producto para devolver.');
      }

      const cleanReason = reason.trim();
      if (!cleanReason) {
        throw new Error('Debes indicar el motivo de la devolucion.');
      }

      return createReturnRequest(session.tenantId, session.accessToken, {
        invoiceId: selectedInvoice.id,
        reason: cleanReason,
        refundMethod,
        items,
      });
    },
    onSuccess: async (request) => {
      await queryClient.invalidateQueries({ queryKey: ['returns'] });
      setSelectedInvoice(null);
      setSelections({});
      setSearch('');
      setReason('');
      setActiveTab('REQUESTED');
      toast.success('Solicitud de devolucion creada.', {
        description: `Factura ${request.invoice.invoiceNumber}`,
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la devolucion.');
    },
  });

  const approveMutation = useMutation({
    mutationFn: (payload: {
      returnRequestId: string;
      cashSessionId?: string;
      refundMethod: string;
      adminNote?: string;
    }) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return approveReturnRequest(session.tenantId, session.accessToken, payload.returnRequestId, {
        cashSessionId: payload.cashSessionId,
        refundMethod: payload.refundMethod,
        adminNote: payload.adminNote,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['returns'] }),
        queryClient.invalidateQueries({ queryKey: ['cash-sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['cash-movements'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory-movements'] }),
      ]);
      closeDecisionModal();
      setActiveTab('COMPLETED');
      toast.success('Devolucion aprobada y completada.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo aprobar la devolucion.');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (payload: { returnRequestId: string; adminNote: string }) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return rejectReturnRequest(session.tenantId, session.accessToken, payload.returnRequestId, {
        adminNote: payload.adminNote,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['returns'] });
      closeDecisionModal();
      setActiveTab('REJECTED');
      toast.success('Devolucion rechazada.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo rechazar la devolucion.');
    },
  });

  const selectedItems = useMemo(
    () => (selectedInvoice ? getSelectedItems(selectedInvoice, selections) : []),
    [selectedInvoice, selections],
  );
  const refundPreview = selectedItems.reduce((sum, { item, selection }) => {
    const quantity = Number(selection.quantity);
    const invoiceQuantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || invoiceQuantity <= 0) {
      return sum;
    }

    return sum + (Number(item.total) / invoiceQuantity) * quantity;
  }, 0);
  const returnRequests = returnsQuery.data ?? [];
  const filteredRequests = returnRequests.filter(
    (request) => activeTab === 'ALL' || request.status === activeTab,
  );
  const pendingCount = returnRequests.filter((request) => request.status === 'REQUESTED').length;

  if (!session) {
    return <SessionRequired session={session} />;
  }

  function submitLookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = search.trim();

    if (!query) {
      toast.error('Escribe el numero de factura u orden.');
      return;
    }

    lookupMutation.mutate(query);
  }

  function updateSelection(itemId: string, patch: Partial<SelectionState[string]>) {
    setSelections((current) => ({
      ...current,
      [itemId]: buildNextSelection(current[itemId], patch),
    }));
  }

  function openDecisionModal(target: ReturnRequest, mode: DecisionMode) {
    const defaultCashSession = openCashSessions.length === 1 ? openCashSessions[0].id : '';
    setDecisionTarget(target);
    setDecisionMode(mode);
    setAdminNote('');
    setDecisionRefundMethod(target.refundMethod ?? 'CASH');
    setDecisionCashSessionId(defaultCashSession);
  }

  function closeDecisionModal() {
    setDecisionTarget(null);
    setAdminNote('');
    setDecisionCashSessionId('');
    setDecisionRefundMethod('CASH');
  }

  function confirmDecision() {
    if (!decisionTarget) {
      return;
    }

    if (decisionMode === 'REJECT') {
      const note = adminNote.trim();
      if (!note) {
        toast.error('El motivo de rechazo es requerido.');
        return;
      }

      rejectMutation.mutate({ returnRequestId: decisionTarget.id, adminNote: note });
      return;
    }

    if (openCashSessions.length > 1 && !decisionCashSessionId) {
      toast.error('Selecciona la caja abierta que entregara el reembolso.');
      return;
    }

    approveMutation.mutate({
      returnRequestId: decisionTarget.id,
      cashSessionId: decisionCashSessionId || undefined,
      refundMethod: decisionRefundMethod,
      adminNote: adminNote.trim() || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Devoluciones"
        description="Solicitudes de devolucion por factura, aprobacion administrativa y reintegro controlado a inventario/caja."
      />

      <section className="grid gap-4 md:grid-cols-3">
        <SummaryCard label="Pendientes" value={pendingCount.toString()} />
        <SummaryCard
          label="Completadas"
          value={returnRequests
            .filter((request) => request.status === 'COMPLETED')
            .length.toString()}
        />
        <SummaryCard
          label="Monto pendiente"
          value={formatCurrency(
            returnRequests
              .filter((request) => request.status === 'REQUESTED')
              .reduce((sum, request) => sum + Number(request.refundAmount), 0),
          )}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Crear solicitud</CardTitle>
          <CardDescription>
            Busca por numero de factura, NCF o numero de orden cobrada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form onSubmit={submitLookup} className="flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="bg-white pl-9"
                placeholder="Ejemplo: B0200000001 u ORD-202606..."
              />
            </div>
            <Button type="submit" disabled={lookupMutation.isPending}>
              <Search className="h-4 w-4" />
              {lookupMutation.isPending ? 'Buscando...' : 'Buscar'}
            </Button>
          </form>

          {selectedInvoice ? (
            <div className="grid gap-5 xl:grid-cols-[1.45fr_0.75fr]">
              <div className="space-y-3">
                <div className="rounded-md border border-border bg-zinc-50 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Factura</p>
                      <h2 className="mt-1 text-xl font-semibold">
                        {selectedInvoice.invoiceNumber}
                      </h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedInvoice.customer?.name ?? 'Consumidor final'} ·{' '}
                        {formatDate(selectedInvoice.issuedAt ?? selectedInvoice.createdAt)}
                      </p>
                    </div>
                    <div className="text-left md:text-right">
                      <Badge variant={getStatusVariant(selectedInvoice.status)}>
                        {translateStatus(selectedInvoice.status)}
                      </Badge>
                      <p className="mt-2 text-lg font-semibold">
                        {formatCurrency(Number(selectedInvoice.total))}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {selectedInvoice.items.map((item) => {
                    const selection = selections[item.id] ?? {
                      selected: false,
                      quantity: item.remainingQuantity,
                      restock: true,
                    };
                    const remaining = Number(item.remainingQuantity);
                    const step = item.product ? getQuantityStep(item.product) : 0.01;

                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'rounded-md border border-border bg-white p-4',
                          !item.canReturn && 'opacity-60',
                        )}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <label className="flex min-w-0 items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 accent-[#f36c10]"
                              checked={selection.selected}
                              disabled={!item.canReturn}
                              onChange={(event) =>
                                updateSelection(item.id, { selected: event.target.checked })
                              }
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-zinc-950">
                                {item.description}
                              </span>
                              <span className="mt-1 block text-xs text-muted-foreground">
                                Vendido: {formatQuantity(item.quantity)} · Disponible:{' '}
                                {formatQuantity(item.remainingQuantity)} · Devuelto/reservado:{' '}
                                {formatQuantity(item.returnedQuantity)}
                              </span>
                            </span>
                          </label>
                          <div className="grid gap-2 sm:grid-cols-[130px_1fr] lg:w-[300px]">
                            <Input
                              type="number"
                              min={step}
                              max={remaining || undefined}
                              step={step}
                              value={selection.quantity}
                              disabled={!selection.selected || !item.canReturn}
                              onChange={(event) =>
                                updateSelection(item.id, { quantity: event.target.value })
                              }
                              className="bg-white"
                              aria-label={`Cantidad a devolver de ${item.description}`}
                            />
                            <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-zinc-50 px-3 text-sm">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-[#f36c10]"
                                checked={selection.restock}
                                disabled={!selection.selected || !item.productId}
                                onChange={(event) =>
                                  updateSelection(item.id, { restock: event.target.checked })
                                }
                              />
                              Regresar al almacen
                            </label>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-4 rounded-md border border-[#f36c10]/35 bg-[#f36c10]/5 p-4">
                <div>
                  <Label htmlFor="returnReason">Motivo de devolucion</Label>
                  <textarea
                    id="returnReason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="mt-2 min-h-28 w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#f36c10]"
                    maxLength={500}
                    placeholder="Ejemplo: producto equivocado, cliente cambio la medida o material defectuoso."
                  />
                </div>

                <div>
                  <Label htmlFor="refundMethod">Metodo de reembolso</Label>
                  <select
                    id="refundMethod"
                    value={refundMethod}
                    onChange={(event) => setRefundMethod(event.target.value)}
                    className="mt-2 h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                  >
                    <option value="CASH">Efectivo</option>
                    <option value="CARD">Tarjeta</option>
                    <option value="TRANSFER">Transferencia</option>
                    <option value="CHECK">Cheque</option>
                    <option value="OTHER">Otro</option>
                  </select>
                </div>

                <div className="rounded-md bg-zinc-950 p-4 text-white">
                  <p className="text-sm text-zinc-300">Monto estimado a devolver</p>
                  <p className="mt-2 text-3xl font-bold">{formatCurrency(refundPreview)}</p>
                  <p className="mt-2 text-xs text-zinc-400">
                    El backend recalcula el monto exacto usando la factura original.
                  </p>
                </div>

                <Button
                  type="button"
                  className="h-12 w-full bg-[#f36c10] text-base text-white hover:bg-[#d95f0e]"
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending || !selectedItems.length}
                >
                  <RotateCcw className="h-5 w-5" />
                  {createMutation.isPending ? 'Creando solicitud...' : 'Solicitar devolucion'}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bandeja de devoluciones</CardTitle>
          <CardDescription>
            {admin
              ? 'Solicitudes pendientes de aprobacion administrativa.'
              : 'Historial de solicitudes realizadas por tu usuario.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-1 md:grid-cols-4">
            {returnTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'rounded-md px-3 py-3 text-left text-sm font-semibold transition',
                  activeTab === tab.id
                    ? 'bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200'
                    : 'text-zinc-600 hover:bg-white/70',
                )}
              >
                <span className="flex items-center justify-between gap-3">
                  {tab.label}
                  <Badge variant={activeTab === tab.id ? 'success' : 'outline'}>
                    {
                      returnRequests.filter(
                        (request) => tab.id === 'ALL' || request.status === tab.id,
                      ).length
                    }
                  </Badge>
                </span>
              </button>
            ))}
          </div>

          {returnsQuery.isLoading ? (
            <p className="rounded-md bg-zinc-50 px-3 py-4 text-sm text-muted-foreground">
              Cargando devoluciones...
            </p>
          ) : filteredRequests.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {filteredRequests.map((request) => (
                <ReturnRequestCard
                  key={request.id}
                  request={request}
                  admin={admin}
                  onApprove={() => openDecisionModal(request, 'APPROVE')}
                  onReject={() => openDecisionModal(request, 'REJECT')}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-md bg-zinc-50 px-3 py-4 text-sm text-muted-foreground">
              No hay devoluciones en esta vista.
            </p>
          )}
        </CardContent>
      </Card>

      <DecisionModal
        target={decisionTarget}
        mode={decisionMode}
        adminNote={adminNote}
        refundMethod={decisionRefundMethod}
        cashSessionId={decisionCashSessionId}
        openCashSessions={openCashSessions}
        isPending={approveMutation.isPending || rejectMutation.isPending}
        onClose={closeDecisionModal}
        onConfirm={confirmDecision}
        onAdminNoteChange={setAdminNote}
        onRefundMethodChange={setDecisionRefundMethod}
        onCashSessionChange={setDecisionCashSessionId}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function ReturnRequestCard({
  request,
  admin,
  onApprove,
  onReject,
}: {
  request: ReturnRequest;
  admin: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-[#f36c10]" />
            <p className="text-sm font-semibold">{request.invoice.invoiceNumber}</p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Solicitada por {request.requestedBy.name} · {formatDate(request.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:justify-end">
          <Badge variant={getStatusVariant(request.status)}>
            {translateStatus(request.status)}
          </Badge>
          <span className="text-sm font-bold">{formatCurrency(Number(request.refundAmount))}</span>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {request.items.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.description}</p>
              <p className="text-xs text-muted-foreground">
                Cantidad {formatQuantity(item.quantity)} ·{' '}
                {item.restock ? 'regresa al almacen' : 'no regresa al almacen'}
              </p>
            </div>
            <span className="shrink-0 text-sm font-semibold">
              {formatCurrency(Number(item.total))}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-md border border-border px-3 py-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Motivo</p>
        <p className="mt-1 text-sm">{request.reason}</p>
        {request.adminNote ? (
          <p className="mt-2 text-xs text-muted-foreground">Nota admin: {request.adminNote}</p>
        ) : null}
      </div>

      <div className="mt-4 flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>Metodo: {translatePaymentMethod(request.refundMethod)}</span>
        {request.cashSession?.cashRegister ? (
          <span>Caja: {request.cashSession.cashRegister.name}</span>
        ) : null}
      </div>

      {admin && request.status === 'REQUESTED' ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onReject}>
            <Ban className="h-4 w-4" />
            Rechazar
          </Button>
          <Button type="button" onClick={onApprove}>
            <ShieldCheck className="h-4 w-4" />
            Aprobar y devolver
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function DecisionModal({
  target,
  mode,
  adminNote,
  refundMethod,
  cashSessionId,
  openCashSessions,
  isPending,
  onClose,
  onConfirm,
  onAdminNoteChange,
  onRefundMethodChange,
  onCashSessionChange,
}: {
  target: ReturnRequest | null;
  mode: DecisionMode;
  adminNote: string;
  refundMethod: string;
  cashSessionId: string;
  openCashSessions: CashSession[];
  isPending: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onAdminNoteChange: (value: string) => void;
  onRefundMethodChange: (value: string) => void;
  onCashSessionChange: (value: string) => void;
}) {
  if (!target) {
    return null;
  }

  const approving = mode === 'APPROVE';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/65 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl">
        <div className="border-b border-[#f36c10]/20 bg-[#f36c10]/10 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#f36c10] text-white">
                {approving ? <Check className="h-5 w-5" /> : <Ban className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-base font-semibold text-zinc-950">
                  {approving ? 'Aprobar devolucion' : 'Rechazar devolucion'}
                </h2>
                <p className="mt-1 text-sm leading-5 text-zinc-700">
                  Factura {target.invoice.invoiceNumber} ·{' '}
                  {formatCurrency(Number(target.refundAmount))}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-zinc-500 hover:bg-white/70 hover:text-zinc-950"
              aria-label="Cerrar modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          {approving ? (
            <>
              <div>
                <Label htmlFor="decisionRefundMethod">Metodo de reembolso</Label>
                <select
                  id="decisionRefundMethod"
                  value={refundMethod}
                  onChange={(event) => onRefundMethodChange(event.target.value)}
                  className="mt-2 h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                >
                  <option value="CASH">Efectivo</option>
                  <option value="CARD">Tarjeta</option>
                  <option value="TRANSFER">Transferencia</option>
                  <option value="CHECK">Cheque</option>
                  <option value="OTHER">Otro</option>
                </select>
              </div>

              {openCashSessions.length > 1 ? (
                <div>
                  <Label htmlFor="decisionCashSession">Caja que entrega el reembolso</Label>
                  <select
                    id="decisionCashSession"
                    value={cashSessionId}
                    onChange={(event) => onCashSessionChange(event.target.value)}
                    className="mt-2 h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                  >
                    <option value="">Seleccionar caja abierta</option>
                    {openCashSessions.map((cashSession) => (
                      <option key={cashSession.id} value={cashSession.id}>
                        {cashSession.cashRegister.name} · {cashSession.openedBy?.name ?? 'Empleado'}
                      </option>
                    ))}
                  </select>
                </div>
              ) : openCashSessions.length === 1 ? (
                <div className="rounded-md border border-border bg-zinc-50 px-3 py-2 text-sm">
                  Caja: {openCashSessions[0].cashRegister.name} ·{' '}
                  {openCashSessions[0].openedBy?.name ?? 'Empleado'}
                </div>
              ) : (
                <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  No hay cajas abiertas para registrar el reembolso.
                </div>
              )}
            </>
          ) : null}

          <div>
            <Label htmlFor="adminNote">
              {approving ? 'Nota administrativa' : 'Motivo de rechazo'}{' '}
              {!approving ? <span className="text-danger">*</span> : null}
            </Label>
            <textarea
              id="adminNote"
              value={adminNote}
              onChange={(event) => onAdminNoteChange(event.target.value)}
              className="mt-2 min-h-28 w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#f36c10]"
              maxLength={500}
              placeholder={
                approving
                  ? 'Ejemplo: aprobado por producto retornado en buen estado.'
                  : 'Ejemplo: factura no coincide o producto no fue entregado.'
              }
              autoFocus
            />
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 bg-zinc-50 px-5 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
            Atras
          </Button>
          <Button
            type="button"
            className={approving ? '' : 'bg-danger text-white hover:bg-danger/90'}
            onClick={onConfirm}
            disabled={isPending || (approving && openCashSessions.length === 0)}
          >
            {isPending ? 'Procesando...' : approving ? 'Aprobar y completar' : 'Rechazar'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function createDefaultSelections(invoice: ReturnInvoiceLookup): SelectionState {
  return Object.fromEntries(
    invoice.items.map((item) => [
      item.id,
      {
        selected: false,
        quantity: item.remainingQuantity,
        restock: true,
      },
    ]),
  );
}

function buildNextSelection(
  current: SelectionState[string] | undefined,
  patch: Partial<SelectionState[string]>,
) {
  return {
    selected: current?.selected ?? false,
    quantity: current?.quantity ?? '0',
    restock: current?.restock ?? true,
    ...patch,
  };
}

function getSelectedItems(invoice: ReturnInvoiceLookup, selections: SelectionState) {
  return invoice.items
    .map((item) => ({
      item,
      selection: selections[item.id],
    }))
    .filter(({ item, selection }) => {
      const quantity = Number(selection?.quantity ?? 0);
      return Boolean(
        selection?.selected && item.canReturn && Number.isFinite(quantity) && quantity > 0,
      );
    });
}
