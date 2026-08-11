'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, PackageCheck, RotateCcw } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ActionDialog } from '@/components/ui/action-dialog';
import { Badge } from '@/components/ui/badge';
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
  cancelGoodsReceipt,
  confirmGoodsReceipt,
  confirmSupplierInvoiceEntry,
  getGoodsReceipts,
  getPurchaseOrder,
  getProducts,
  reverseGoodsReceipt,
  type GoodsReceipt,
  type PurchaseOrder,
  type ReceiptPriceDecision,
  type SupplierInvoice,
  type SupplierInvoiceItem,
} from '@/lib/api';
import { isAdminSession } from '@/lib/authorization';
import type { AuthSession } from '@/lib/auth-session';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { CancelReasonModal } from './cancel-reason-modal';
import { FormField, ProcurementStatusBadge, QueryState, textareaClassName } from './procurement-ui';

type EntryItem = {
  invoiceItem: SupplierInvoiceItem;
  included: boolean;
  quantityReceived: string;
  differenceAccepted: boolean;
  differenceNote: string;
  lotNumber: string;
  serialNumber: string;
  expirationDate: string;
  priceDecision: ReceiptPriceDecision;
  manualSalePrice: string;
};

type ReceiptAction =
  | { action: 'confirm-legacy'; receipt: GoodsReceipt }
  | { action: 'cancel-legacy'; receipt: GoodsReceipt }
  | { action: 'reverse'; receipt: GoodsReceipt };

export function SupplierInvoiceEntryPanel({
  invoice,
  session,
}: {
  invoice: SupplierInvoice;
  session: AuthSession;
}) {
  const queryClient = useQueryClient();
  const admin = isAdminSession(session);
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<EntryItem[]>([]);
  const [confirmingEntry, setConfirmingEntry] = useState(false);
  const [pricingReviewOpen, setPricingReviewOpen] = useState(false);
  const [receiptAction, setReceiptAction] = useState<ReceiptAction | null>(null);
  const [reason, setReason] = useState('');
  const [orderReconciliationAccepted, setOrderReconciliationAccepted] = useState(false);
  const [orderReconciliationNote, setOrderReconciliationNote] = useState('');

  const receiptsQuery = useQuery({
    queryKey: ['goods-receipts', session.tenantId, 'supplier-invoice-entry', invoice.id],
    queryFn: () =>
      getGoodsReceipts(session.tenantId, session.accessToken, {
        supplierInvoiceId: invoice.id,
      }),
  });
  const productsQuery = useQuery({
    queryKey: ['products', session.tenantId, 'supplier-invoice-entry'],
    queryFn: () => getProducts(session.tenantId, session.accessToken),
  });
  const purchaseOrderQuery = useQuery({
    queryKey: ['purchase-order', session.tenantId, invoice.purchaseOrderId, 'supplier-invoice-entry'],
    queryFn: () =>
      getPurchaseOrder(session.tenantId, session.accessToken, invoice.purchaseOrderId ?? ''),
    enabled: Boolean(invoice.purchaseOrderId),
  });

  const confirmedByInvoiceItem = useMemo(() => {
    const totals = new Map<string, number>();
    for (const receipt of receiptsQuery.data ?? []) {
      if (receipt.status !== 'CONFIRMED') continue;
      for (const item of receipt.items) {
        totals.set(
          item.supplierInvoiceItemId,
          (totals.get(item.supplierInvoiceItemId) ?? 0) + Number(item.quantityReceived),
        );
      }
    }
    return totals;
  }, [receiptsQuery.data]);
  const productsById = useMemo(
    () => new Map((productsQuery.data ?? []).map((product) => [product.id, product])),
    [productsQuery.data],
  );
  const changedCostItems = useMemo(
    () =>
      items.filter((item) => {
        if (!item.included) return false;
        const product = productsById.get(item.invoiceItem.productId);
        return (
          product?.cost !== null &&
          product?.cost !== undefined &&
          Number(product.cost) !== Number(item.invoiceItem.unitCostNet)
        );
      }),
    [items, productsById],
  );
  const legacyDraft = (receiptsQuery.data ?? []).find((receipt) => receipt.status === 'DRAFT');
  const canEnter = ['DRAFT', 'PENDING', 'PARTIALLY_PAID', 'PAID'].includes(invoice.status);
  const orderReconciliation = useMemo(
    () => reconcileInvoiceWithPurchaseOrder(invoice.items ?? [], purchaseOrderQuery.data),
    [invoice.items, purchaseOrderQuery.data],
  );
  const orderReconciliationKey = orderReconciliation.fingerprint;
  const invoiceItemsKey = (invoice.items ?? [])
    .map(
      (item) => `${item.id}:${item.quantity}:${item.unitCostNet}:${item.purchaseOrderItemId ?? ''}`,
    )
    .join('|');
  const confirmedQuantitiesKey = [...confirmedByInvoiceItem.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemId, quantity]) => `${itemId}:${quantity}`)
    .join('|');

  useEffect(() => {
    if (!invoice.items?.length) {
      setItems([]);
      return;
    }
    setItems(
      invoice.items.map((invoiceItem) => {
        const received = confirmedByInvoiceItem.get(invoiceItem.id) ?? 0;
        const remaining = Math.max(Number(invoiceItem.quantity) - received, 0);
        const product = productsById.get(invoiceItem.productId);
        const costChanged =
          product?.cost !== null &&
          product?.cost !== undefined &&
          Number(product.cost) !== Number(invoiceItem.unitCostNet);
        const canRecalculateMargin =
          costChanged &&
          calculateSuggestedPrice(Number(invoiceItem.unitCostNet), Number(product?.margin)) !== null;

        return {
          invoiceItem,
          included: remaining > 0,
          quantityReceived: String(remaining),
          differenceAccepted: false,
          differenceNote: '',
          lotNumber: '',
          serialNumber: '',
          expirationDate: '',
          // When the cost changes, preserving the existing margin is the
          // recommended and default choice. KEEP remains the safe fallback
          // for products without a usable margin.
          priceDecision: canRecalculateMargin ? 'RECALCULATE_MARGIN' : 'KEEP',
          manualSalePrice: '',
        };
      }),
    );
  }, [confirmedQuantitiesKey, invoice.id, invoiceItemsKey, productsById]);

  useEffect(() => {
    setOrderReconciliationAccepted(false);
    setOrderReconciliationNote('');
  }, [invoice.id, orderReconciliationKey]);

  const confirmEntryMutation = useMutation({
    mutationFn: () => {
      const selected = items.filter((item) => item.included);
      if (!selected.length) throw new Error('Selecciona al menos un producto para la entrada.');

      if (invoice.purchaseOrderId && purchaseOrderQuery.isLoading) {
        throw new Error('Espera a que cargue la comparación con la orden de compra.');
      }
      if (invoice.purchaseOrderId && purchaseOrderQuery.error) {
        throw new Error('No se pudo validar la factura contra la orden de compra. Intenta de nuevo.');
      }
      if (orderReconciliation.hasStructuralIssue) {
        throw new Error(
          'La factura contiene líneas que no pertenecen a la orden de compra. Corrígelas antes de confirmar.',
        );
      }
      if (orderReconciliation.requiresReview && !orderReconciliationAccepted) {
        throw new Error(
          'Revisa y acepta explícitamente las diferencias con la orden de compra antes de continuar.',
        );
      }
      if (orderReconciliation.requiresReview && !orderReconciliationNote.trim()) {
        throw new Error(
          'Explica la diferencia con la orden de compra para que quede auditada.',
        );
      }

      for (const item of selected) {
        if (!Number(item.quantityReceived) || Number(item.quantityReceived) <= 0) {
          throw new Error(
            `Indica una cantidad válida para ${item.invoiceItem.descriptionSnapshot}.`,
          );
        }
        if (needsDifferenceAcceptance(item, confirmedByInvoiceItem) && !item.differenceAccepted) {
          throw new Error(
            `Confirma la diferencia de ${item.invoiceItem.descriptionSnapshot} antes de continuar.`,
          );
        }
        if (
          needsDifferenceAcceptance(item, confirmedByInvoiceItem) &&
          !item.differenceNote.trim()
        ) {
          throw new Error(
            `Explica la diferencia de ${item.invoiceItem.descriptionSnapshot} para dejarla auditada.`,
          );
        }
        if (item.priceDecision === 'MANUAL' && !Number(item.manualSalePrice)) {
          throw new Error(`Indica el precio manual de ${item.invoiceItem.descriptionSnapshot}.`);
        }
      }

      return confirmSupplierInvoiceEntry(session.tenantId, session.accessToken, invoice.id, {
        notes: notes.trim() || undefined,
        orderReconciliationAccepted: orderReconciliation.requiresReview
          ? orderReconciliationAccepted
          : undefined,
        orderReconciliationNote: orderReconciliation.requiresReview
          ? orderReconciliationNote.trim()
          : undefined,
        items: selected.map((item) => ({
          supplierInvoiceItemId: item.invoiceItem.id,
          quantityReceived: Number(item.quantityReceived),
          differenceAccepted: item.differenceAccepted,
          differenceNote: item.differenceNote.trim() || undefined,
          lotNumber: item.lotNumber.trim() || undefined,
          serialNumber: item.serialNumber.trim() || undefined,
          expirationDate: item.expirationDate || undefined,
          priceDecision: item.priceDecision,
          manualSalePrice:
            item.priceDecision === 'MANUAL' ? Number(item.manualSalePrice) : undefined,
        })),
      });
    },
    onSuccess: async (result) => {
      await invalidateEntryData(queryClient);
      setConfirmingEntry(false);
      setNotes('');
      toast.success(
        `${result.receipt.receiptNumber} confirmada. La factura, la cuenta por pagar y el inventario quedaron actualizados.`,
      );
    },
    onError: showError,
  });
  const confirmLegacyMutation = useMutation({
    mutationFn: (receipt: GoodsReceipt) =>
      confirmGoodsReceipt(session.tenantId, session.accessToken, receipt.id),
    onSuccess: async (receipt) => {
      await invalidateEntryData(queryClient);
      closeReceiptAction();
      toast.success(`${receipt.receiptNumber} confirmada y reflejada en el inventario.`);
    },
    onError: showError,
  });
  const cancelLegacyMutation = useMutation({
    mutationFn: ({
      receipt,
      cancellationReason,
    }: {
      receipt: GoodsReceipt;
      cancellationReason: string;
    }) => cancelGoodsReceipt(session.tenantId, session.accessToken, receipt.id, cancellationReason),
    onSuccess: async () => {
      await invalidateEntryData(queryClient);
      closeReceiptAction();
      toast.success('Borrador histórico de entrada cancelado.');
    },
    onError: showError,
  });
  const reverseMutation = useMutation({
    mutationFn: ({ receipt, reversalReason }: { receipt: GoodsReceipt; reversalReason: string }) =>
      reverseGoodsReceipt(session.tenantId, session.accessToken, receipt.id, reversalReason),
    onSuccess: async () => {
      await invalidateEntryData(queryClient);
      closeReceiptAction();
      toast.success('Entrada revertida con movimientos de inventario auditados.');
    },
    onError: showError,
  });

  function updateItem(itemId: string, patch: Partial<EntryItem>) {
    setItems((current) =>
      current.map((item) => (item.invoiceItem.id === itemId ? { ...item, ...patch } : item)),
    );
  }

  function closeReceiptAction() {
    setReceiptAction(null);
    setReason('');
  }

  function confirmReceiptAction() {
    if (!receiptAction) return;
    if (receiptAction.action === 'confirm-legacy') {
      confirmLegacyMutation.mutate(receiptAction.receipt);
      return;
    }
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      toast.error('Indica el motivo para continuar.');
      return;
    }
    if (receiptAction.action === 'cancel-legacy') {
      cancelLegacyMutation.mutate({
        receipt: receiptAction.receipt,
        cancellationReason: normalizedReason,
      });
      return;
    }
    reverseMutation.mutate({ receipt: receiptAction.receipt, reversalReason: normalizedReason });
  }

  if (invoice.status === 'CANCELLED') return null;

  return (
    <>
      <Card className="border-accent/25 bg-gradient-to-br from-accent/[0.06] via-card to-card">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-sm">
                <PackageCheck className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-base">Factura y entrada de mercancía</CardTitle>
                <CardDescription className="mt-1 leading-6">
                  {invoice.status === 'DRAFT'
                    ? 'Confirma una sola vez: se registra la factura, se crea la cuenta por pagar y entra la mercancía al inventario.'
                    : 'Registra la entrega pendiente desde esta factura. Cada confirmación conserva la trazabilidad de cantidades, costos y precios.'}
                </CardDescription>
              </div>
            </div>
            <Badge variant={invoice.status === 'DRAFT' ? 'warning' : 'outline'}>
              {invoice.status === 'DRAFT' ? 'Pendiente de confirmar' : 'Entrada desde factura'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {legacyDraft ? (
            <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <div>
                  <p className="font-medium">Hay una entrada histórica pendiente</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {legacyDraft.receiptNumber} fue creada antes de simplificar el flujo. Confírmala
                    o cancélala aquí antes de registrar otra entrada.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    setReceiptAction({ action: 'confirm-legacy', receipt: legacyDraft })
                  }
                >
                  Confirmar entrada
                </Button>
                {admin ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setReceiptAction({ action: 'cancel-legacy', receipt: legacyDraft })
                    }
                  >
                    Cancelar borrador
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {canEnter && !legacyDraft ? (
            <>
              <FormField
                label="Notas de la entrada"
                hint="Opcional: transportista, estado de los productos o una observación de la entrega."
              >
                <Input
                  value={notes}
                  maxLength={1000}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Ej. Entrega completa, recibida por almacén."
                />
              </FormField>

              {invoice.purchaseOrderId ? (
                <OrderReconciliationReview
                  order={purchaseOrderQuery.data}
                  loading={purchaseOrderQuery.isLoading}
                  error={purchaseOrderQuery.error}
                  reconciliation={orderReconciliation}
                  accepted={orderReconciliationAccepted}
                  note={orderReconciliationNote}
                  onAcceptedChange={setOrderReconciliationAccepted}
                  onNoteChange={setOrderReconciliationNote}
                />
              ) : null}

              <QueryState
                loading={receiptsQuery.isLoading || productsQuery.isLoading}
                error={receiptsQuery.error ?? productsQuery.error}
              />
              <div className="space-y-3">
                {items.map((item) => {
                  const product = productsById.get(item.invoiceItem.productId);
                  const previouslyReceived = confirmedByInvoiceItem.get(item.invoiceItem.id) ?? 0;
                  const needsAcceptance = needsDifferenceAcceptance(item, confirmedByInvoiceItem);
                  const costChanged =
                    product?.cost !== null &&
                    product?.cost !== undefined &&
                    Number(product.cost) !== Number(item.invoiceItem.unitCostNet);

                  return (
                    <fieldset
                      key={item.invoiceItem.id}
                      className={
                        item.included
                          ? 'rounded-lg border bg-card p-4 shadow-sm'
                          : 'rounded-lg border bg-muted/20 p-4 opacity-75'
                      }
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 accent-accent"
                            checked={item.included}
                            onChange={(event) =>
                              updateItem(item.invoiceItem.id, { included: event.target.checked })
                            }
                          />
                          <span>
                            <span className="block font-semibold">
                              {item.invoiceItem.descriptionSnapshot}
                            </span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              Facturado: {Number(item.invoiceItem.quantity)} · Recibido antes:{' '}
                              {previouslyReceived} · Costo neto:{' '}
                              {formatCurrency(Number(item.invoiceItem.unitCostNet))}
                            </span>
                          </span>
                        </label>
                        {costChanged ? (
                          <Badge variant="warning" className="shrink-0">
                            Costo {formatCurrency(Number(product?.cost))} →{' '}
                            {formatCurrency(Number(item.invoiceItem.unitCostNet))}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="shrink-0">
                            Costo sin cambio
                          </Badge>
                        )}
                      </div>

                      {item.included ? (
                        <>
                          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <FormField
                              label="Cantidad recibida"
                              hint={`Pendiente: ${Math.max(
                                Number(item.invoiceItem.quantity) - previouslyReceived,
                                0,
                              )}`}
                            >
                              <Input
                                type="number"
                                min="0.001"
                                step="0.001"
                                value={item.quantityReceived}
                                onChange={(event) =>
                                  updateItem(item.invoiceItem.id, {
                                    quantityReceived: event.target.value,
                                    differenceAccepted: false,
                                  })
                                }
                              />
                            </FormField>
                            <FormField label="Lote (opcional)">
                              <Input
                                value={item.lotNumber}
                                onChange={(event) =>
                                  updateItem(item.invoiceItem.id, { lotNumber: event.target.value })
                                }
                              />
                            </FormField>
                            <FormField label="Serie (opcional)">
                              <Input
                                value={item.serialNumber}
                                onChange={(event) =>
                                  updateItem(item.invoiceItem.id, {
                                    serialNumber: event.target.value,
                                  })
                                }
                              />
                            </FormField>
                            <FormField label="Vencimiento (opcional)">
                              <Input
                                type="date"
                                value={item.expirationDate}
                                onChange={(event) =>
                                  updateItem(item.invoiceItem.id, {
                                    expirationDate: event.target.value,
                                  })
                                }
                              />
                            </FormField>
                          </div>

                          {needsAcceptance ? (
                            <div className="mt-4 rounded-lg border border-warning/30 bg-warning/5 p-3">
                              <label className="flex items-start gap-2 text-sm font-medium">
                                <input
                                  type="checkbox"
                                  className="mt-1 h-4 w-4 accent-warning"
                                  checked={item.differenceAccepted}
                                  onChange={(event) =>
                                    updateItem(item.invoiceItem.id, {
                                      differenceAccepted: event.target.checked,
                                    })
                                  }
                                />
                                Acepto la diferencia entre lo ordenado, lo facturado o lo recibido.
                              </label>
                              <textarea
                                className={`${textareaClassName} mt-3 min-h-16`}
                                value={item.differenceNote}
                                onChange={(event) =>
                                  updateItem(item.invoiceItem.id, {
                                    differenceNote: event.target.value,
                                  })
                                }
                                placeholder="Explica la diferencia para que quede auditada."
                              />
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </fieldset>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3 rounded-lg border border-accent/20 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {invoice.status === 'DRAFT'
                    ? 'No se creará la cuenta por pagar ni se moverá inventario hasta confirmar.'
                    : 'La nueva entrega actualizará el inventario y conservará el historial anterior.'}
                </p>
                <Button
                  type="button"
                  disabled={!items.some((item) => item.included)}
                  onClick={() =>
                    changedCostItems.length ? setPricingReviewOpen(true) : setConfirmingEntry(true)
                  }
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {invoice.status === 'DRAFT'
                    ? 'Confirmar factura y entrada'
                    : 'Confirmar entrega pendiente'}
                </Button>
              </div>
            </>
          ) : null}

          <ReceiptHistory
            receipts={receiptsQuery.data ?? []}
            admin={admin}
            onReverse={(receipt) => setReceiptAction({ action: 'reverse', receipt })}
          />
        </CardContent>
      </Card>

      <ActionDialog
        open={confirmingEntry}
        title={
          invoice.status === 'DRAFT' ? 'Confirmar factura y entrada' : 'Confirmar entrega pendiente'
        }
        description={
          invoice.status === 'DRAFT'
            ? 'Esta operación registrará la factura, generará la cuenta por pagar e ingresará la mercancía al inventario en un único paso auditado.'
            : 'Esta operación actualizará el inventario, costos y la trazabilidad de la entrega.'
        }
        summary={
          <div className="grid gap-3 sm:grid-cols-3">
            <EntryMeta label="Factura" value={invoice.invoiceNumber} />
            <EntryMeta label="Suplidor" value={invoice.supplierNameSnapshot} />
            <EntryMeta
              label="Productos a confirmar"
              value={`${items.filter((item) => item.included).length} línea(s)`}
            />
          </div>
        }
        tone="warning"
        confirmLabel={invoice.status === 'DRAFT' ? 'Confirmar todo' : 'Confirmar entrega'}
        cancelLabel="Seguir revisando"
        isPending={confirmEntryMutation.isPending}
        onClose={() => setConfirmingEntry(false)}
        onConfirm={() => confirmEntryMutation.mutate()}
      />

      <ActionDialog
        open={pricingReviewOpen}
        title="Revisa los cambios de costo"
        description="El costo de estos productos cambió respecto al catálogo. Decide qué hacer con cada precio de venta antes de confirmar la entrada. Cada decisión quedará auditada."
        summary={
          <div className="space-y-2">
            {changedCostItems.map((item) => {
              const product = productsById.get(item.invoiceItem.productId);
              return (
                <div
                  key={item.invoiceItem.id}
                  className="flex flex-col gap-1 rounded-md border border-warning/20 bg-warning/[0.04] p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="font-medium">{item.invoiceItem.descriptionSnapshot}</span>
                  <span className="text-sm text-muted-foreground">
                    {formatCurrency(Number(product?.cost))} →{' '}
                    {formatCurrency(Number(item.invoiceItem.unitCostNet))}
                  </span>
                </div>
              );
            })}
          </div>
        }
        tone="warning"
        size="lg"
        confirmLabel="Continuar a confirmación"
        cancelLabel="Seguir revisando"
        onClose={() => setPricingReviewOpen(false)}
        onConfirm={() => {
          setPricingReviewOpen(false);
          setConfirmingEntry(true);
        }}
      >
        <div className="space-y-4">
          {changedCostItems.map((item) => {
            const product = productsById.get(item.invoiceItem.productId);
            const suggestedPrice = calculateSuggestedPrice(
              Number(item.invoiceItem.unitCostNet),
              Number(product?.margin),
            );

            return (
              <fieldset key={item.invoiceItem.id} className="rounded-lg border bg-card p-4">
                <legend className="px-1 text-sm font-semibold">
                  {item.invoiceItem.descriptionSnapshot}
                </legend>
                <div className="mt-2 grid gap-3 md:grid-cols-3">
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-muted/15 p-3 text-sm">
                    <input
                      type="radio"
                      name={`price-${item.invoiceItem.id}`}
                      checked={item.priceDecision === 'KEEP'}
                      onChange={() =>
                        updateItem(item.invoiceItem.id, {
                          priceDecision: 'KEEP',
                          manualSalePrice: '',
                        })
                      }
                    />
                    <span>
                      <strong>Mantener</strong>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Precio actual:{' '}
                        {formatCurrency(Number(product?.salePrice ?? product?.price))}
                      </span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 rounded-md border bg-muted/15 p-3 text-sm">
                    <input
                      type="radio"
                      name={`price-${item.invoiceItem.id}`}
                      checked={item.priceDecision === 'RECALCULATE_MARGIN'}
                      disabled={!suggestedPrice}
                      onChange={() =>
                        updateItem(item.invoiceItem.id, {
                          priceDecision: 'RECALCULATE_MARGIN',
                          manualSalePrice: '',
                        })
                      }
                    />
                    <span>
                      <strong>Recalcular margen</strong>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {suggestedPrice
                          ? `Nuevo precio: ${formatCurrency(suggestedPrice)}`
                          : 'Sin margen configurado.'}
                      </span>
                    </span>
                  </label>
                  <label className="cursor-pointer rounded-md border bg-muted/15 p-3 text-sm">
                    <span className="flex items-start gap-2">
                      <input
                        type="radio"
                        name={`price-${item.invoiceItem.id}`}
                        checked={item.priceDecision === 'MANUAL'}
                        onChange={() =>
                          updateItem(item.invoiceItem.id, { priceDecision: 'MANUAL' })
                        }
                      />
                      <strong>Definir manualmente</strong>
                    </span>
                    {item.priceDecision === 'MANUAL' ? (
                      <Input
                        className="mt-2"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={item.manualSalePrice}
                        onChange={(event) =>
                          updateItem(item.invoiceItem.id, {
                            manualSalePrice: event.target.value,
                          })
                        }
                        placeholder="Nuevo precio"
                      />
                    ) : null}
                  </label>
                </div>
              </fieldset>
            );
          })}
        </div>
      </ActionDialog>

      <ActionDialog
        open={receiptAction?.action === 'confirm-legacy'}
        title="Confirmar entrada histórica"
        description="La entrada fue preparada antes de simplificar el flujo. Al confirmarla se actualizarán inventario, costos y trazabilidad."
        summary={
          receiptAction?.action === 'confirm-legacy' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <EntryMeta label="Entrada" value={receiptAction.receipt.receiptNumber} />
              <EntryMeta
                label="Factura"
                value={receiptAction.receipt.supplierInvoice.invoiceNumber}
              />
              <EntryMeta
                label="Mercancía"
                value={`${receiptAction.receipt.quantitySummary.itemCount} producto(s)`}
              />
            </div>
          ) : null
        }
        tone="warning"
        confirmLabel="Confirmar entrada"
        isPending={confirmLegacyMutation.isPending}
        onClose={closeReceiptAction}
        onConfirm={confirmReceiptAction}
      />

      <CancelReasonModal
        open={receiptAction?.action === 'cancel-legacy' || receiptAction?.action === 'reverse'}
        title={
          receiptAction?.action === 'reverse'
            ? 'Revertir entrada confirmada'
            : 'Cancelar entrada histórica'
        }
        description={
          receiptAction
            ? `Entrada ${receiptAction.receipt.receiptNumber} · Factura ${receiptAction.receipt.supplierInvoice.invoiceNumber}.`
            : ''
        }
        reason={reason}
        confirmLabel={receiptAction?.action === 'reverse' ? 'Revertir entrada' : 'Cancelar entrada'}
        inputLabel={
          receiptAction?.action === 'reverse'
            ? 'Motivo de la reversión'
            : 'Motivo de la cancelación'
        }
        placeholder="Explica el motivo para que quede auditado."
        hint={
          receiptAction?.action === 'reverse'
            ? 'El sistema bloqueará la reversión si no queda inventario suficiente.'
            : 'El borrador se cancelará sin alterar las existencias.'
        }
        tone={receiptAction?.action === 'reverse' ? 'danger' : 'warning'}
        isPending={
          receiptAction?.action === 'reverse'
            ? reverseMutation.isPending
            : cancelLegacyMutation.isPending
        }
        onReasonChange={setReason}
        onClose={closeReceiptAction}
        onConfirm={confirmReceiptAction}
      />
    </>
  );
}

type InvoiceOrderReconciliation = {
  missingItems: PurchaseOrder['items'];
  unexpectedInvoiceItems: SupplierInvoiceItem[];
  productMismatches: Array<{
    orderItem: PurchaseOrder['items'][number];
    invoiceItem: SupplierInvoiceItem;
  }>;
  quantityDifferences: Array<{
    orderItem: PurchaseOrder['items'][number];
    invoiceItem: SupplierInvoiceItem;
  }>;
  costDifferences: Array<{
    orderItem: PurchaseOrder['items'][number];
    invoiceItem: SupplierInvoiceItem;
    costChanged: boolean;
    taxChanged: boolean;
    discountChanged: boolean;
  }>;
  hasStructuralIssue: boolean;
  requiresReview: boolean;
  fingerprint: string;
};

function OrderReconciliationReview({
  order,
  loading,
  error,
  reconciliation,
  accepted,
  note,
  onAcceptedChange,
  onNoteChange,
}: {
  order?: PurchaseOrder;
  loading: boolean;
  error: unknown;
  reconciliation: InvoiceOrderReconciliation;
  accepted: boolean;
  note: string;
  onAcceptedChange: (accepted: boolean) => void;
  onNoteChange: (note: string) => void;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-muted bg-muted/15 p-4 text-sm text-muted-foreground">
        Comparando la factura con la orden de compra…
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="flex gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
        <div>
          <p className="font-semibold">No se pudo validar la orden de compra</p>
          <p className="mt-1 text-muted-foreground">
            Vuelve a cargar la factura antes de confirmar la entrada. La confirmación queda
            bloqueada hasta validar sus líneas.
          </p>
        </div>
      </div>
    );
  }

  if (!reconciliation.requiresReview) {
    return (
      <div className="flex gap-3 rounded-lg border border-success/30 bg-success/5 p-4 text-sm">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div>
          <p className="font-semibold">Factura verificada contra la orden {order.orderNumber}</p>
          <p className="mt-1 text-muted-foreground">
            Productos, cantidades, costos e impuestos coinciden con la orden de compra.
          </p>
        </div>
      </div>
    );
  }

  const structuralIssue = reconciliation.hasStructuralIssue;

  return (
    <fieldset className="rounded-lg border border-warning/35 bg-warning/[0.055] p-4">
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div>
          <p className="font-semibold">Revisión requerida contra la orden {order.orderNumber}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            La factura refleja lo entregado por el suplidor. Revisa las diferencias antes de
            confirmar; tu decisión y la nota quedarán auditadas.
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3 rounded-md border border-warning/20 bg-card/75 p-3 text-sm">
        {reconciliation.missingItems.length ? (
          <ReconciliationList title="Solicitados que no aparecen en la factura">
            {reconciliation.missingItems.map((item) => (
              <li key={item.id}>
                {item.descriptionSnapshot} · solicitado: {Number(item.quantity)}
              </li>
            ))}
          </ReconciliationList>
        ) : null}
        {reconciliation.quantityDifferences.length ? (
          <ReconciliationList title="Cantidades distintas">
            {reconciliation.quantityDifferences.map(({ orderItem, invoiceItem }) => (
              <li key={invoiceItem.id}>
                {invoiceItem.descriptionSnapshot} · solicitado: {Number(orderItem.quantity)} ·
                facturado: {Number(invoiceItem.quantity)}
              </li>
            ))}
          </ReconciliationList>
        ) : null}
        {reconciliation.costDifferences.length ? (
          <ReconciliationList title="Costo, ITBIS o descuento distinto">
            {reconciliation.costDifferences.map(
              ({ orderItem, invoiceItem, costChanged, taxChanged, discountChanged }) => (
                <li key={invoiceItem.id}>
                  <span className="font-medium">{invoiceItem.descriptionSnapshot}</span>
                  {costChanged ? (
                    <span>
                      {' '}
                      · costo: {formatCurrency(Number(orderItem.unitCostNet))} →{' '}
                      {formatCurrency(Number(invoiceItem.unitCostNet))}
                    </span>
                  ) : null}
                  {taxChanged ? (
                    <span>
                      {' '}
                      · ITBIS: {Number(orderItem.taxRate) * 100}% →{' '}
                      {Number(invoiceItem.taxRate) * 100}%
                    </span>
                  ) : null}
                  {discountChanged ? (
                    <span>
                      {' '}
                      · descuento: {formatCurrency(Number(orderItem.discountTotal))} →{' '}
                      {formatCurrency(Number(invoiceItem.discountTotal))}
                    </span>
                  ) : null}
                </li>
              ),
            )}
          </ReconciliationList>
        ) : null}
        {reconciliation.unexpectedInvoiceItems.length || reconciliation.productMismatches.length ? (
          <ReconciliationList title="Líneas que no pertenecen a la orden">
            {reconciliation.unexpectedInvoiceItems.map((item) => (
              <li key={item.id}>{item.descriptionSnapshot}</li>
            ))}
            {reconciliation.productMismatches.map(({ orderItem, invoiceItem }) => (
              <li key={invoiceItem.id}>
                {invoiceItem.descriptionSnapshot} no coincide con {orderItem.descriptionSnapshot}.
                Corrige la factura u orden antes de confirmar.
              </li>
            ))}
          </ReconciliationList>
        ) : null}
      </div>

      {structuralIssue ? (
        <div className="mt-4 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm">
          <p className="font-semibold text-danger">Corrige las líneas antes de confirmar</p>
          <p className="mt-1 text-muted-foreground">
            Una factura vinculada a una orden solo puede registrar productos de esa orden. Agrega
            primero el producto a la orden o corrige la selección de la factura.
          </p>
        </div>
      ) : (
        <>
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-warning/25 bg-card/70 p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-warning"
              checked={accepted}
              onChange={(event) => onAcceptedChange(event.target.checked)}
            />
            <span>
              <strong>Confirmo las diferencias de la factura frente a la orden.</strong>
              <span className="mt-1 block text-muted-foreground">
                Solo se registrarán los productos y montos de esta factura. Los artículos faltantes
                seguirán pendientes en la orden.
              </span>
            </span>
          </label>
          <FormField
            className="mt-3"
            label="Motivo de la diferencia"
            hint="Obligatorio cuando la factura no coincide con la orden."
          >
            <Input
              value={note}
              maxLength={500}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="Ej. El suplidor entregó menos unidades y actualizó el costo."
            />
          </FormField>
        </>
      )}
    </fieldset>
  );
}

function ReconciliationList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">{children}</ul>
    </div>
  );
}

function ReceiptHistory({
  receipts,
  admin,
  onReverse,
}: {
  receipts: GoodsReceipt[];
  admin: boolean;
  onReverse: (receipt: GoodsReceipt) => void;
}) {
  if (!receipts.length) return null;

  return (
    <details className="rounded-lg border bg-card">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:content-none">
        Historial de entradas ({receipts.length})
      </summary>
      <div className="space-y-4 border-t p-4">
        {receipts.map((receipt) => (
          <div key={receipt.id} className="rounded-lg border bg-muted/15 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{receipt.receiptNumber}</p>
                <p className="text-xs text-muted-foreground">
                  {receipt.createdBy.name} ·{' '}
                  {formatDateTime(receipt.confirmedAt ?? receipt.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <ProcurementStatusBadge status={receipt.status} />
                {admin && receipt.status === 'CONFIRMED' ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onReverse(receipt)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Revertir
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="mt-3 overflow-x-auto rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Recibida</TableHead>
                    <TableHead className="text-right">Costo nuevo</TableHead>
                    <TableHead className="text-right">Precio final</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receipt.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <p className="font-medium">{item.product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[
                            item.lotNumber && `Lote ${item.lotNumber}`,
                            item.serialNumber && `Serie ${item.serialNumber}`,
                          ]
                            .filter(Boolean)
                            .join(' · ') || 'Sin lote o serie'}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">{Number(item.quantityReceived)}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(item.newCostNet))}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(item.finalSalePrice ?? item.previousSalePrice))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function reconcileInvoiceWithPurchaseOrder(
  invoiceItems: SupplierInvoiceItem[],
  purchaseOrder?: PurchaseOrder,
): InvoiceOrderReconciliation {
  if (!purchaseOrder) {
    return {
      missingItems: [],
      unexpectedInvoiceItems: [],
      productMismatches: [],
      quantityDifferences: [],
      costDifferences: [],
      hasStructuralIssue: false,
      requiresReview: false,
      fingerprint: 'purchase-order-pending',
    };
  }

  const orderItemsById = new Map(purchaseOrder.items.map((item) => [item.id, item]));
  const linkedOrderItemIds = new Set<string>();
  const unexpectedInvoiceItems: SupplierInvoiceItem[] = [];
  const productMismatches: InvoiceOrderReconciliation['productMismatches'] = [];
  const quantityDifferences: InvoiceOrderReconciliation['quantityDifferences'] = [];
  const costDifferences: InvoiceOrderReconciliation['costDifferences'] = [];

  for (const invoiceItem of invoiceItems) {
    const orderItem = invoiceItem.purchaseOrderItemId
      ? orderItemsById.get(invoiceItem.purchaseOrderItemId)
      : undefined;
    if (!orderItem || linkedOrderItemIds.has(orderItem.id)) {
      unexpectedInvoiceItems.push(invoiceItem);
      continue;
    }
    if (orderItem.productId !== invoiceItem.productId) {
      productMismatches.push({ orderItem, invoiceItem });
      continue;
    }

    linkedOrderItemIds.add(orderItem.id);
    if (!numbersMatch(orderItem.quantity, invoiceItem.quantity, 0.0005)) {
      quantityDifferences.push({ orderItem, invoiceItem });
    }

    const costChanged = !numbersMatch(orderItem.unitCostNet, invoiceItem.unitCostNet, 0.005);
    const taxChanged = !numbersMatch(orderItem.taxRate, invoiceItem.taxRate, 0.00005);
    const discountChanged = !numbersMatch(
      orderItem.discountTotal,
      invoiceItem.discountTotal,
      0.005,
    );
    if (costChanged || taxChanged || discountChanged) {
      costDifferences.push({
        orderItem,
        invoiceItem,
        costChanged,
        taxChanged,
        discountChanged,
      });
    }
  }

  const missingItems = purchaseOrder.items.filter((item) => !linkedOrderItemIds.has(item.id));
  const hasStructuralIssue = Boolean(
    unexpectedInvoiceItems.length || productMismatches.length,
  );
  const requiresReview = Boolean(
    missingItems.length ||
      unexpectedInvoiceItems.length ||
      productMismatches.length ||
      quantityDifferences.length ||
      costDifferences.length,
  );

  return {
    missingItems,
    unexpectedInvoiceItems,
    productMismatches,
    quantityDifferences,
    costDifferences,
    hasStructuralIssue,
    requiresReview,
    fingerprint: [
      purchaseOrder.id,
      ...purchaseOrder.items.map(
        (item) =>
          `order:${item.id}:${item.productId}:${item.quantity}:${item.unitCostNet}:${item.taxRate}:${item.discountTotal}`,
      ),
      ...invoiceItems.map(
        (item) =>
          `invoice:${item.id}:${item.purchaseOrderItemId ?? ''}:${item.productId}:${item.quantity}:${item.unitCostNet}:${item.taxRate}:${item.discountTotal}`,
      ),
    ].join('|'),
  };
}

function numbersMatch(left: string, right: string, tolerance: number) {
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function needsDifferenceAcceptance(item: EntryItem, cumulativeByInvoiceItem: Map<string, number>) {
  const previouslyReceived = cumulativeByInvoiceItem.get(item.invoiceItem.id) ?? 0;
  const projected = previouslyReceived + Number(item.quantityReceived || 0);
  const invoiced = Number(item.invoiceItem.quantity);
  const ordered = item.invoiceItem.purchaseOrderItem
    ? Number(item.invoiceItem.purchaseOrderItem.quantity)
    : null;
  return (
    Math.abs(projected - invoiced) > 0.0005 ||
    (ordered !== null && Math.abs(ordered - invoiced) > 0.0005)
  );
}

function calculateSuggestedPrice(cost: number, margin: number) {
  if (!Number.isFinite(cost) || !Number.isFinite(margin) || margin < 0 || margin >= 1) {
    return null;
  }
  return Math.round((cost / (1 - margin)) * 100) / 100;
}

function EntryMeta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

async function invalidateEntryData(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['goods-receipts'] }),
    queryClient.invalidateQueries({ queryKey: ['supplier-invoices'] }),
    queryClient.invalidateQueries({ queryKey: ['supplier-invoice'] }),
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
    queryClient.invalidateQueries({ queryKey: ['products'] }),
    queryClient.invalidateQueries({ queryKey: ['inventory'] }),
    queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
  ]);
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : 'No se pudo completar la operación.');
}
