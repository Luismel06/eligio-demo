'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CirclePause, Pencil, Plus, Printer, Search, Send, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createPurchaseOrder,
  getProducts,
  getPurchaseOrders,
  getSupplier,
  getSuppliers,
  transitionPurchaseOrder,
  updatePurchaseOrder,
  type PurchaseOrder,
  type PurchaseOrderPayload,
  type PurchaseOrderStatus,
} from '@/lib/api';
import { isAdminSession } from '@/lib/authorization';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { CancelReasonModal } from './cancel-reason-modal';
import { ModuleHeader } from './module-header';
import { ProductCombobox } from './product-combobox';
import {
  FormField,
  ProcurementStatusBadge,
  QueryState,
  procurementStatusLabel,
  selectClassName,
} from './procurement-ui';
import { SessionRequired, useCurrentSession } from './session-required';

type EditablePurchaseItem = {
  key: string;
  productId: string;
  quantity: string;
  unitCostNet: string;
  taxPercent: string;
  discountTotal: string;
};

const blankItem = (): EditablePurchaseItem => ({
  key: crypto.randomUUID(),
  productId: '',
  quantity: '1',
  unitCostNet: '',
  taxPercent: '18',
  discountTotal: '0',
});

type PurchaseOrderTransition = 'request' | 'issue' | 'pause' | 'resume' | 'cancel';

type PurchaseOrderTransitionDialog = {
  order: PurchaseOrder;
  transition: PurchaseOrderTransition;
};

export function PurchaseOrdersView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const admin = isAdminSession(session);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | PurchaseOrderStatus | 'OVERDUE'>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<EditablePurchaseItem[]>([blankItem()]);
  const [transitionDialog, setTransitionDialog] = useState<PurchaseOrderTransitionDialog | null>(
    null,
  );
  const [transitionNote, setTransitionNote] = useState('');

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('q');
    if (query) setSearch(query);
  }, []);

  const ordersQuery = useQuery({
    queryKey: ['purchase-orders', session?.tenantId, search, status],
    queryFn: () =>
      getPurchaseOrders(session?.tenantId ?? '', session?.accessToken ?? '', {
        q: search,
        status: status === 'ALL' ? undefined : status,
      }),
    enabled: Boolean(session),
  });
  const suppliersQuery = useQuery({
    queryKey: ['suppliers', session?.tenantId, 'ACTIVE', 'purchase-order'],
    queryFn: () =>
      getSuppliers(session?.tenantId ?? '', session?.accessToken ?? '', { status: 'ACTIVE' }),
    enabled: Boolean(session),
  });
  const supplierQuery = useQuery({
    queryKey: ['supplier', session?.tenantId, supplierId, 'purchase-order'],
    queryFn: () => getSupplier(session?.tenantId ?? '', session?.accessToken ?? '', supplierId),
    enabled: Boolean(session && supplierId),
  });
  const productsQuery = useQuery({
    queryKey: ['products', session?.tenantId, 'purchase-order'],
    queryFn: () => getProducts(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });

  const requestOrderMutation = useMutation({
    mutationFn: async (payload: PurchaseOrderPayload) => {
      if (!session) throw new Error('Sesión requerida.');
      const order = editingId
        ? await updatePurchaseOrder(session.tenantId, session.accessToken, editingId, payload)
        : await createPurchaseOrder(session.tenantId, session.accessToken, payload);

      return transitionPurchaseOrder(session.tenantId, session.accessToken, order.id, 'request');
    },
    onSuccess: async (order) => {
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      resetForm();
      toast.success(`Orden ${order.orderNumber} solicitada correctamente.`);
    },
    onError: showError,
  });
  const transitionMutation = useMutation({
    mutationFn: ({
      orderId,
      transition,
      note,
    }: {
      orderId: string;
      transition: PurchaseOrderTransition;
      note?: string;
    }) => {
      if (!session) throw new Error('Sesión requerida.');
      return transitionPurchaseOrder(
        session.tenantId,
        session.accessToken,
        orderId,
        transition,
        note,
      );
    },
    onSuccess: async (order) => {
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      setTransitionDialog(null);
      setTransitionNote('');
      toast.success(`Orden ${order.orderNumber}: ${procurementStatusLabel(order.displayStatus)}.`);
    },
    onError: showError,
  });

  const productOptions = useMemo(
    () => (productsQuery.data ?? []).filter((product) => product.status === 'ACTIVE'),
    [productsQuery.data],
  );
  const totals = useMemo(() => calculateTotals(items), [items]);

  if (!session) return <SessionRequired session={session} />;

  function resetForm() {
    setEditingId(null);
    setSupplierId('');
    setExpectedDeliveryDate('');
    setNotes('');
    setItems([blankItem()]);
    setShowForm(false);
  }

  function submitOrder(event: FormEvent) {
    event.preventDefault();
    if (!supplierId) {
      toast.error('Selecciona un suplidor.');
      return;
    }
    if (!items.length || items.some((item) => !item.productId)) {
      toast.error('Completa los productos de la orden.');
      return;
    }
    if (new Set(items.map((item) => item.productId)).size !== items.length) {
      toast.error('Un producto solo puede aparecer una vez en la orden.');
      return;
    }
    requestOrderMutation.mutate({
      supplierId,
      expectedDeliveryDate: expectedDeliveryDate || undefined,
      notes: notes.trim() || undefined,
      items: items.map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        unitCostNet: Number(item.unitCostNet),
        taxRate: Number(item.taxPercent || 0) / 100,
        discountTotal: Number(item.discountTotal || 0),
      })),
    });
  }

  function editOrder(order: PurchaseOrder) {
    setEditingId(order.id);
    setSupplierId(order.supplierId);
    setExpectedDeliveryDate(toDateInput(order.expectedDeliveryDate));
    setNotes(order.notes ?? '');
    setItems(
      order.items.map((item) => ({
        key: item.id,
        productId: item.productId,
        quantity: String(Number(item.quantity)),
        unitCostNet: String(Number(item.unitCostNet)),
        taxPercent: String(Number(item.taxRate) * 100),
        discountTotal: String(Number(item.discountTotal)),
      })),
    );
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateItem(key: string, patch: Partial<EditablePurchaseItem>) {
    setItems((current) =>
      current.map((item) => {
        if (item.key !== key) return item;
        const next = { ...item, ...patch };
        if (patch.productId) {
          const product = productOptions.find((candidate) => candidate.id === patch.productId);
          const relation = supplierQuery.data?.products?.find(
            (candidate) => candidate.productId === patch.productId && candidate.active,
          );
          next.unitCostNet = String(
            Number(relation?.lastCostNet ?? product?.cost ?? item.unitCostNet ?? 0),
          );
          next.taxPercent = String(Number(product?.taxRate ?? 0.18) * 100);
        }
        return next;
      }),
    );
  }

  function requestTransition(order: PurchaseOrder, transition: PurchaseOrderTransition) {
    setTransitionDialog({ order, transition });
    setTransitionNote('');
  }

  function confirmTransition() {
    if (!transitionDialog) return;
    const requiresReason = ['pause', 'cancel'].includes(transitionDialog.transition);
    const note = transitionNote.trim();
    if (requiresReason && !note) {
      toast.error('El motivo es obligatorio.');
      return;
    }
    transitionMutation.mutate({
      orderId: transitionDialog.order.id,
      transition: transitionDialog.transition,
      note: note || undefined,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <ModuleHeader
          title="Órdenes de compra"
          description="Prepara la orden, solicítala y el administrador la valida antes de emitirla al suplidor."
        />
        <Button
          onClick={() => {
            if (showForm) resetForm();
            else setShowForm(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Nueva orden
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Editar borrador' : 'Crear orden de compra'}</CardTitle>
            <CardDescription>
              Completa la orden y solicítala. Quedará lista para que un administrador la valide y
              emita.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitOrder} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                <FormField label="Suplidor">
                  <select
                    required
                    className={selectClassName}
                    value={supplierId}
                    onChange={(event) => setSupplierId(event.target.value)}
                  >
                    <option value="">Selecciona un suplidor...</option>
                    {suppliersQuery.data?.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.commercialName}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField
                  label="Fecha estimada de entrega"
                  hint="Se usará para detectar órdenes en retraso."
                >
                  <Input
                    type="date"
                    value={expectedDeliveryDate}
                    onChange={(event) => setExpectedDeliveryDate(event.target.value)}
                  />
                </FormField>
                <FormField label="Notas">
                  <Input
                    value={notes}
                    maxLength={1000}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Condiciones, observaciones..."
                  />
                </FormField>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Productos solicitados</h3>
                    <p className="text-sm text-muted-foreground">
                      Los costos se guardan netos; el ITBIS se calcula por línea.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setItems((current) => [...current, blankItem()])}
                  >
                    <Plus className="h-4 w-4" />
                    Línea
                  </Button>
                </div>
                {items.map((item, index) => (
                  <div
                    key={item.key}
                    className="grid gap-3 rounded-md border bg-muted/10 p-3 md:grid-cols-12"
                  >
                    <FormField label={`Producto ${index + 1}`} className="md:col-span-4">
                      <ProductCombobox
                        products={productOptions}
                        value={item.productId}
                        required
                        ariaLabel={`Buscar producto para la línea ${index + 1}`}
                        disabledProductIds={items
                          .filter((other) => other.key !== item.key && Boolean(other.productId))
                          .map((other) => other.productId)}
                        onValueChange={(productId) => updateItem(item.key, { productId })}
                      />
                    </FormField>
                    <FormField label="Cantidad" className="md:col-span-2">
                      <Input
                        required
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={item.quantity}
                        onChange={(event) => updateItem(item.key, { quantity: event.target.value })}
                      />
                    </FormField>
                    <FormField label="Costo neto" className="md:col-span-2">
                      <Input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitCostNet}
                        onChange={(event) =>
                          updateItem(item.key, { unitCostNet: event.target.value })
                        }
                      />
                    </FormField>
                    <FormField label="ITBIS %" className="md:col-span-1">
                      <Input
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={item.taxPercent}
                        onChange={(event) =>
                          updateItem(item.key, { taxPercent: event.target.value })
                        }
                      />
                    </FormField>
                    <FormField label="Descuento" className="md:col-span-2">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.discountTotal}
                        onChange={(event) =>
                          updateItem(item.key, { discountTotal: event.target.value })
                        }
                      />
                    </FormField>
                    <div className="flex items-end justify-end md:col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={items.length === 1}
                        onClick={() =>
                          setItems((current) => current.filter((entry) => entry.key !== item.key))
                        }
                        aria-label="Eliminar línea"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 rounded-md border bg-card p-4 text-sm sm:grid-cols-4">
                <Total label="Subtotal" value={totals.subtotal} />
                <Total label="Descuento" value={totals.discount} />
                <Total label="ITBIS" value={totals.tax} />
                <Total label="Total" value={totals.total} strong />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cerrar
                </Button>
                <Button disabled={requestOrderMutation.isPending}>
                  {requestOrderMutation.isPending ? 'Solicitando...' : 'Solicitar orden de compra'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_240px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por número, suplidor o documento"
            />
          </div>
          <select
            className={selectClassName}
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="ALL">Todos los estados</option>
            <option value="DRAFT">Borradores</option>
            <option value="REQUESTED">Solicitadas</option>
            <option value="UNDER_REVIEW">En revisión</option>
            <option value="APPROVED">Aprobadas</option>
            <option value="ISSUED">Emitidas</option>
            <option value="PARTIALLY_RECEIVED">Recibidas parcialmente</option>
            <option value="RECEIVED">Recibidas</option>
            <option value="PAUSED">Pausadas</option>
            <option value="OVERDUE">En retraso</option>
            <option value="CANCELLED">Canceladas</option>
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Historial y seguimiento</CardTitle>
          <CardDescription>
            El contador prepara y solicita; el administrador valida, emite, pausa o cancela la
            orden.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <QueryState
            loading={ordersQuery.isLoading}
            error={ordersQuery.error}
            empty={!ordersQuery.isLoading && !ordersQuery.data?.length}
            emptyMessage="No hay órdenes de compra en este filtro."
          />
          {ordersQuery.data?.map((order) => (
            <details key={order.id} className="group rounded-md border bg-card">
              <summary className="cursor-pointer list-none p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold">{order.orderNumber}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {order.supplierNameSnapshot} · {order.items.length} producto(s)
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <ProcurementStatusBadge status={order.displayStatus} />
                    <span className="font-semibold">{formatCurrency(Number(order.total))}</span>
                    <span className="text-sm text-muted-foreground">
                      Entrega: {formatDate(order.expectedDeliveryDate)}
                    </span>
                  </div>
                </div>
              </summary>
              <div className="space-y-5 border-t p-4">
                <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <Meta label="Creada" value={formatDateTime(order.createdAt)} />
                  <Meta label="Creada por" value={order.createdBy.name} />
                  <Meta label="Solicitud" value={formatDateTime(order.requestedAt)} />
                  <Meta label="Entrega estimada" value={formatDate(order.expectedDeliveryDate)} />
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Solicitado</TableHead>
                        <TableHead className="text-right">Recibido</TableHead>
                        <TableHead className="text-right">Costo neto</TableHead>
                        <TableHead className="text-right">ITBIS</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {order.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <p className="font-medium">{item.descriptionSnapshot}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.skuSnapshot ?? 'Sin SKU'}
                            </p>
                          </TableCell>
                          <TableCell className="text-right">{Number(item.quantity)}</TableCell>
                          <TableCell className="text-right">
                            {Number(item.receivedQuantity)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(Number(item.unitCostNet))}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(Number(item.taxTotal))}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(Number(item.total))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {order.notes ? (
                  <div className="rounded-md bg-muted/40 p-3 text-sm">
                    <span className="font-medium">Notas:</span> {order.notes}
                  </div>
                ) : null}
                <PurchaseOrderNextStep order={order} />
                <div>
                  <h4 className="mb-2 text-sm font-semibold">Trazabilidad</h4>
                  <div className="flex flex-wrap gap-2">
                    {order.events.map((event) => (
                      <div key={event.id} className="rounded-md border px-3 py-2 text-xs">
                        <p className="font-medium">
                          {procurementStatusLabel(event.toStatus)} · {event.createdBy.name}
                        </p>
                        <p className="text-muted-foreground">{formatDateTime(event.createdAt)}</p>
                        {event.note ? <p className="mt-1 max-w-sm">{event.note}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                  <Button asChild type="button" variant="outline" size="sm">
                    <Link href={`/purchase-orders/${order.id}/print`}>
                      <Printer className="h-4 w-4" />
                      Imprimir / PDF
                    </Link>
                  </Button>
                  {order.status === 'DRAFT' ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => editOrder(order)}
                      >
                        <Pencil className="h-4 w-4" />
                        Editar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => requestTransition(order, 'request')}
                      >
                        <Send className="h-4 w-4" />
                        Solicitar orden de compra
                      </Button>
                    </>
                  ) : null}
                  {admin && ['REQUESTED', 'UNDER_REVIEW', 'APPROVED'].includes(order.status) ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => requestTransition(order, 'issue')}
                    >
                      <ArrowRight className="h-4 w-4" />
                      Emitir orden
                    </Button>
                  ) : null}
                  {admin &&
                  ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'ISSUED'].includes(order.status) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => requestTransition(order, 'pause')}
                    >
                      <CirclePause className="h-4 w-4" />
                      Pausar
                    </Button>
                  ) : null}
                  {admin && order.status === 'PAUSED' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => requestTransition(order, 'resume')}
                    >
                      Reanudar
                    </Button>
                  ) : null}
                  {admin &&
                  !['CANCELLED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(order.status) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => requestTransition(order, 'cancel')}
                    >
                      Cancelar
                    </Button>
                  ) : null}
                </div>
              </div>
            </details>
          ))}
        </CardContent>
      </Card>
      <CancelReasonModal
        open={Boolean(transitionDialog)}
        title={
          transitionDialog?.transition === 'cancel'
            ? 'Cancelar orden de compra'
            : transitionDialog?.transition === 'pause'
              ? 'Pausar orden de compra'
              : 'Confirmar transición de la orden'
        }
        description={
          transitionDialog
            ? `Orden ${transitionDialog.order.orderNumber} · ${purchaseOrderTransitionDescription(transitionDialog.transition)}`
            : ''
        }
        reason={transitionNote}
        inputLabel={
          transitionDialog && ['pause', 'cancel'].includes(transitionDialog.transition)
            ? 'Motivo de la acción'
            : 'Nota para la transición'
        }
        placeholder={
          transitionDialog && ['pause', 'cancel'].includes(transitionDialog.transition)
            ? 'Explica por qué se debe pausar o cancelar esta orden.'
            : 'Agrega contexto opcional para el historial de la orden.'
        }
        hint={
          transitionDialog && ['pause', 'cancel'].includes(transitionDialog.transition)
            ? 'El motivo será obligatorio y quedará registrado para auditoría.'
            : 'La nota es opcional; si la agregas, quedará en la trazabilidad de la orden.'
        }
        required={Boolean(
          transitionDialog && ['pause', 'cancel'].includes(transitionDialog.transition),
        )}
        tone={
          transitionDialog?.transition === 'cancel'
            ? 'danger'
            : transitionDialog?.transition === 'pause'
              ? 'warning'
              : 'default'
        }
        confirmLabel={
          transitionDialog ? purchaseOrderTransitionLabel(transitionDialog.transition) : 'Continuar'
        }
        isPending={transitionMutation.isPending}
        onReasonChange={setTransitionNote}
        onClose={() => {
          setTransitionDialog(null);
          setTransitionNote('');
        }}
        onConfirm={confirmTransition}
      />
    </div>
  );
}

function PurchaseOrderNextStep({ order }: { order: PurchaseOrder }) {
  const invoice = order.supplierInvoice;

  if (order.status === 'ISSUED') {
    if (!invoice) {
      return (
        <div className="flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Siguiente paso: registrar la factura del suplidor</p>
            <p className="mt-1 text-muted-foreground">
              Usa la cámara para sugerir datos con OCR o introdúcelos manualmente. La foto no se
              guarda y siempre se revisa antes de confirmar la entrada de mercancía.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href={`/supplier-invoices?purchaseOrderId=${order.id}`}>
              Registrar factura
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      );
    }

    if (invoice.status === 'CANCELLED') {
      return (
        <div className="flex flex-col gap-3 rounded-md border border-warning/30 bg-warning/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            La factura vinculada fue cancelada. Para mantener la trazabilidad, cancela esta orden y
            crea una nueva si debes continuar la compra.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href={`/supplier-invoices?invoiceId=${invoice.id}`}>Consultar factura</Link>
          </Button>
        </div>
      );
    }

    if (invoice.status === 'DRAFT') {
      return (
        <div className="flex flex-col gap-3 rounded-md border border-warning/30 bg-warning/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Siguiente paso: completar la factura y la entrada</p>
            <p className="mt-1 text-muted-foreground">
              La factura {invoice.invoiceNumber} aún es un borrador. Completa o valida sus datos
              antes de confirmar la entrada de mercancía.
            </p>
          </div>
          <Button asChild size="sm">
            <Link href={`/supplier-invoices?invoiceId=${invoice.id}`}>
              Completar factura
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Factura y entrada de mercancía</p>
          <p className="mt-1 text-muted-foreground">
            La factura {invoice.invoiceNumber} está vinculada. Ábrela para consultar o completar la
            entrada y actualizar el inventario.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href={`/supplier-invoices?invoiceId=${invoice.id}`}>
            Abrir factura
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    );
  }

  if (order.status === 'PARTIALLY_RECEIVED' && invoice) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-primary/30 bg-primary/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Entrada parcial registrada</p>
          <p className="mt-1 text-muted-foreground">
            Esta orden conserva un historial de entrada parcial. Consulta la factura vinculada para
            revisar el detalle y continuar el flujo desde allí.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href={`/supplier-invoices?invoiceId=${invoice.id}`}>
            Consultar factura
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    );
  }

  if (order.status === 'RECEIVED') {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-success/30 bg-success/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          Proceso de mercancía completado: la orden y su entrada histórica ya están trazadas. No se
          admiten nuevas entradas para esta orden.
        </p>
        {invoice ? (
          <Button asChild size="sm" variant="outline">
            <Link href={`/supplier-invoices?invoiceId=${invoice.id}`}>Consultar factura</Link>
          </Button>
        ) : null}
      </div>
    );
  }

  return null;
}

function purchaseOrderTransitionLabel(transition: PurchaseOrderTransition) {
  return {
    request: 'Solicitar orden de compra',
    issue: 'Emitir orden',
    pause: 'Pausar orden',
    resume: 'Reanudar orden',
    cancel: 'Cancelar orden',
  }[transition];
}

function purchaseOrderTransitionDescription(transition: PurchaseOrderTransition) {
  return {
    request: 'La orden se enviará al administrador para su validación y emisión.',
    issue: 'La orden se validará y se marcará como emitida al suplidor.',
    pause: 'La orden quedará detenida hasta que un administrador la reanude.',
    resume: 'La orden retomará el punto del flujo en que fue pausada.',
    cancel: 'Esta acción conserva el historial y requiere un motivo.',
  }[transition];
}
function calculateTotals(items: EditablePurchaseItem[]) {
  return items.reduce(
    (sum, item) => {
      const gross = Number(item.quantity || 0) * Number(item.unitCostNet || 0);
      const discount = Math.min(Number(item.discountTotal || 0), gross);
      const subtotal = gross - discount;
      const tax = subtotal * (Number(item.taxPercent || 0) / 100);
      return {
        subtotal: sum.subtotal + subtotal,
        discount: sum.discount + discount,
        tax: sum.tax + tax,
        total: sum.total + subtotal + tax,
      };
    },
    { subtotal: 0, discount: 0, tax: 0, total: 0 },
  );
}

function Total({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={strong ? 'mt-1 text-lg font-semibold' : 'mt-1 font-medium'}>
        {formatCurrency(value)}
      </p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function toDateInput(value?: string | null) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : 'No se pudo completar la operación.');
}
