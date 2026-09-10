'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Banknote,
  Camera,
  FilePlus2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ActionDialog } from '@/components/ui/action-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  addSupplierProduct,
  cancelSupplierInvoice,
  cancelSupplierPayment,
  createSupplierInvoice,
  getProducts,
  getPurchaseOrders,
  getSupplier,
  getSupplierInvoice,
  getSupplierInvoices,
  getSuppliers,
  registerSupplierPayment,
  updateSupplierInvoice,
  type Product,
  type PurchaseOrder,
  type Supplier,
  type SupplierInvoice,
  type SupplierInvoicePayload,
  type SupplierInvoiceStatus,
  type SupplierPayment,
} from '@/lib/api';
import { canCreateSuppliers, isAdminSession } from '@/lib/authorization';
import type { SupplierInvoiceOcrItem, SupplierInvoiceOcrResult } from '@/lib/supplier-invoice-ocr';
import {
  catalogCodeMatchScore,
  convertInvoiceUnit,
  createOcrInvoiceItem,
  findProductForOcrItem,
  formatInvoiceCalendarDate,
  invoiceUnitToProductUnit,
  mergeOcrInvoiceItems,
  needsInvoiceUnitReview,
  selectInvoiceProduct,
  type OcrEditableItem,
  type OcrProductMatchSource,
} from '@/lib/supplier-invoice-product-matching';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { translateProductUnit } from '@/lib/display-labels';
import { CancelReasonModal } from './cancel-reason-modal';
import { ModuleHeader } from './module-header';
import { ProductCombobox } from './product-combobox';
import { FormField, ProcurementStatusBadge, QueryState, selectClassName } from './procurement-ui';
import { SessionRequired, useCurrentSession } from './session-required';
import { SupplierInvoiceEntryPanel } from './supplier-invoice-entry-panel';
import { SupplierInvoiceDialog } from './supplier-invoice-dialog';
import { SupplierInvoiceOcrCamera } from './supplier-invoice-ocr-camera';
import { SupplierInvoiceMobileCapturePanel } from './supplier-invoice-mobile-capture-panel';
import { SupplierQuickCreateDialog } from './supplier-quick-create-dialog';
import { QuickProductCreateDialog } from './quick-product-create-dialog';

type EditableInvoiceItem = OcrEditableItem;

const blankItem = (): EditableInvoiceItem => ({
  key: crypto.randomUUID(),
  productId: '',
  quantity: '1',
  unitCostNet: '',
  taxPercent: '18',
  discountTotal: '0',
});

const emptyProductSearchTerms: string[] = [];

type PurchaseOrderOcrSuggestion = {
  ocrItem: SupplierInvoiceOcrItem;
  quantity?: number;
  costTotal: number;
  costWeight: number;
  taxRate?: number | null;
  discountTotal?: number;
};

type SupplierInvoiceActionDialog =
  | { action: 'cancel-invoice'; invoice: SupplierInvoice }
  | {
      action: 'cancel-payment';
      invoiceId: string;
      invoiceNumber: string;
      payment: SupplierPayment;
    };

type OcrMappingLearningResult = {
  learned: number;
  skippedDuplicateCodes: string[];
};

export function SupplierInvoicesView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const admin = isAdminSession(session);
  const canCreateSupplier = canCreateSuppliers(session);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | SupplierInvoiceStatus | 'OVERDUE'>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [createChoiceOpen, setCreateChoiceOpen] = useState(false);
  const [ocrCameraOpen, setOcrCameraOpen] = useState(false);
  const [mobileCaptureOpen, setMobileCaptureOpen] = useState(false);
  const [returnToOcrAfterMobileCapture, setReturnToOcrAfterMobileCapture] = useState(false);
  const [quickSupplierOpen, setQuickSupplierOpen] = useState(false);
  const [quickProductItemKey, setQuickProductItemKey] = useState<string | null>(null);
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [pendingProductItemKey, setPendingProductItemKey] = useState<string | null>(null);
  const [ocrBatchKey, setOcrBatchKey] = useState('');
  const [conversionFactors, setConversionFactors] = useState<Record<string, string>>({});
  const [detachOrderOpen, setDetachOrderOpen] = useState(false);
  const [applyOrderOcrOpen, setApplyOrderOcrOpen] = useState(false);
  const invoiceItemsRef = useRef<HTMLDivElement>(null);
  const loadedPurchaseOrderRef = useRef('');
  const [ocrResult, setOcrResult] = useState<SupplierInvoiceOcrResult | null>(null);
  const [ocrUnconfirmedOrderItemIds, setOcrUnconfirmedOrderItemIds] = useState<string[]>([]);
  const [detailStage, setDetailStage] = useState<'capture' | 'review'>('capture');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [ncf, setNcf] = useState('');
  const [issueDate, setIssueDate] = useState(todayInput());
  const [dueDate, setDueDate] = useState('');
  const [ncfValidUntil, setNcfValidUntil] = useState('');
  const [paymentCondition, setPaymentCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<EditableInvoiceItem[]>([blankItem()]);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'CHECK'>('CASH');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [invoiceActionDialog, setInvoiceActionDialog] =
    useState<SupplierInvoiceActionDialog | null>(null);
  const [invoiceActionReason, setInvoiceActionReason] = useState('');
  const [pendingInvoicePayload, setPendingInvoicePayload] = useState<SupplierInvoicePayload | null>(
    null,
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get('q');
    if (query) setSearch(query);
    const requestedPurchaseOrderId = params.get('purchaseOrderId');
    if (requestedPurchaseOrderId) {
      setPurchaseOrderId(requestedPurchaseOrderId);
      setCreateChoiceOpen(true);
    }
    const requestedInvoiceId = params.get('invoiceId');
    if (requestedInvoiceId) {
      setSelectedId(requestedInvoiceId);
      setDetailStage('capture');
    }
  }, []);

  const invoicesQuery = useQuery({
    queryKey: ['supplier-invoices', session?.tenantId, search, status],
    queryFn: () =>
      getSupplierInvoices(session?.tenantId ?? '', session?.accessToken ?? '', {
        q: search,
        status:
          status !== 'ALL' && status !== 'OVERDUE' ? (status as SupplierInvoiceStatus) : undefined,
        overdue: status === 'OVERDUE' ? true : undefined,
      }),
    enabled: Boolean(session),
  });
  const detailQuery = useQuery({
    queryKey: ['supplier-invoice', session?.tenantId, selectedId],
    queryFn: () =>
      getSupplierInvoice(session?.tenantId ?? '', session?.accessToken ?? '', selectedId ?? ''),
    enabled: Boolean(session && selectedId),
  });
  const hasConfirmedGoodsReceipt = Boolean(
    detailQuery.data?.goodsReceipts?.some((receipt) => receipt.status === 'CONFIRMED'),
  );
  const paymentEnteredAmount = toPositiveCurrencyAmount(paymentAmount);
  const paymentBalance = Number(detailQuery.data?.balance ?? 0);
  const paymentAppliedAmount =
    paymentMethod === 'CASH'
      ? Math.min(paymentEnteredAmount, paymentBalance)
      : paymentEnteredAmount;
  const paymentChangeAmount =
    paymentMethod === 'CASH' ? Math.max(paymentEnteredAmount - paymentBalance, 0) : 0;
  const paymentExceedsBalance = paymentMethod !== 'CASH' && paymentEnteredAmount > paymentBalance;
  const suppliersQuery = useQuery({
    queryKey: ['suppliers', session?.tenantId, 'supplier-invoice'],
    queryFn: () => getSuppliers(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const selectedSupplierQuery = useQuery({
    queryKey: ['supplier', session?.tenantId, supplierId, 'supplier-invoice-ocr'],
    queryFn: () => getSupplier(session?.tenantId ?? '', session?.accessToken ?? '', supplierId),
    enabled: Boolean(session && supplierId),
  });
  const supplierProductMappingsLoading =
    Boolean(supplierId) && (selectedSupplierQuery.isLoading || selectedSupplierQuery.isFetching);
  const ordersQuery = useQuery({
    queryKey: ['purchase-orders', session?.tenantId, 'supplier-invoice'],
    queryFn: () => getPurchaseOrders(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const productsQuery = useQuery({
    queryKey: ['products', session?.tenantId, 'supplier-invoice'],
    queryFn: () => getProducts(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const eligibleOrders = (ordersQuery.data ?? []).filter(
    (order) =>
      order.status === 'ISSUED' &&
      (!order.supplierInvoice || order.supplierInvoice.id === editingId) &&
      (!supplierId || order.supplierId === supplierId),
  );
  const productOptions = useMemo(
    () => (productsQuery.data ?? []).filter((product) => product.status === 'ACTIVE'),
    [productsQuery.data],
  );
  const productById = useMemo(
    () => new Map(productOptions.map((product) => [product.id, product])),
    [productOptions],
  );
  const supplierProductSearchTerms = useMemo(() => {
    const termsByProductId = new Map<string, string[]>();

    for (const supplierProduct of selectedSupplierQuery.data?.products ?? []) {
      const supplierSku = supplierProduct.supplierSku?.trim();
      if (!supplierProduct.active || !supplierSku) continue;

      const productTerms = termsByProductId.get(supplierProduct.productId) ?? [];
      productTerms.push(supplierSku);
      termsByProductId.set(supplierProduct.productId, productTerms);
    }

    return termsByProductId;
  }, [selectedSupplierQuery.data?.products]);
  const getSupplierProductSearchText = useCallback(
    (product: Product) => supplierProductSearchTerms.get(product.id) ?? emptyProductSearchTerms,
    [supplierProductSearchTerms],
  );
  const activeSuppliers = useMemo(
    () => (suppliersQuery.data ?? []).filter((supplier) => supplier.status === 'ACTIVE'),
    [suppliersQuery.data],
  );
  const totals = useMemo(() => calculateTotals(items), [items]);
  const quickProductItem = quickProductItemKey
    ? items.find((item) => item.key === quickProductItemKey)
    : undefined;
  const ocrProductMatches = useMemo(
    () =>
      (ocrResult?.items ?? []).map((item) => ({
        item,
        ...findProductForOcrItem(item, productOptions, selectedSupplierQuery.data?.products),
      })),
    [ocrResult, productOptions, selectedSupplierQuery.data?.products],
  );
  const ocrSupplierMatch = useMemo(
    () => (ocrResult ? findMatchingSupplier(ocrResult, activeSuppliers) : undefined),
    [activeSuppliers, ocrResult],
  );
  const ocrTotalDifference =
    ocrResult?.total === undefined ? null : roundCurrency(totals.total - ocrResult.total);
  const hasOcrTotalMismatch = ocrTotalDifference !== null && Math.abs(ocrTotalDifference) > 0.02;
  const orderReconciliation = useMemo(() => {
    const purchaseOrder = purchaseOrderId
      ? ordersQuery.data?.find((order) => order.id === purchaseOrderId)
      : undefined;
    if (!purchaseOrder) {
      return {
        purchaseOrder: null,
        missingItems: [],
        quantityDifferences: [],
        costDifferences: [],
        ocrUnconfirmedItems: [],
      };
    }

    const invoiceItemsByOrderItem = new Map(
      items
        .filter((item) => item.purchaseOrderItemId)
        .map((item) => [item.purchaseOrderItemId!, item]),
    );
    const missingItems = purchaseOrder.items.filter(
      (orderItem) => !invoiceItemsByOrderItem.has(orderItem.id),
    );
    const quantityDifferences = purchaseOrder.items.flatMap((orderItem) => {
      const invoiceItem = invoiceItemsByOrderItem.get(orderItem.id);
      if (!invoiceItem || Number(invoiceItem.quantity) === Number(orderItem.quantity)) return [];
      return [{ orderItem, invoiceItem }];
    });
    const costDifferences = purchaseOrder.items.flatMap((orderItem) => {
      const invoiceItem = invoiceItemsByOrderItem.get(orderItem.id);
      if (!invoiceItem) return [];

      const costChanged = !numbersMatch(orderItem.unitCostNet, invoiceItem.unitCostNet, 0.005);
      const taxChanged = !numbersMatch(
        orderItem.taxRate,
        Number(invoiceItem.taxPercent || 0) / 100,
        0.00005,
      );
      const discountChanged = !numbersMatch(
        orderItem.discountTotal,
        invoiceItem.discountTotal,
        0.005,
      );
      if (!costChanged && !taxChanged && !discountChanged) return [];
      return [{ orderItem, invoiceItem, costChanged, taxChanged, discountChanged }];
    });
    const ocrUnconfirmedItems = purchaseOrder.items.filter((orderItem) =>
      ocrUnconfirmedOrderItemIds.includes(orderItem.id),
    );

    return {
      purchaseOrder,
      missingItems,
      quantityDifferences,
      costDifferences,
      ocrUnconfirmedItems,
    };
  }, [items, ocrUnconfirmedOrderItemIds, ordersQuery.data, purchaseOrderId]);
  const hasOrderReconciliationWarning =
    orderReconciliation.missingItems.length > 0 ||
    orderReconciliation.quantityDifferences.length > 0 ||
    orderReconciliation.costDifferences.length > 0 ||
    orderReconciliation.ocrUnconfirmedItems.length > 0;
  const hasInvoiceReconciliationWarning = hasOrderReconciliationWarning || hasOcrTotalMismatch;

  useEffect(() => {
    if (!showForm || editingId || !purchaseOrderId || !ordersQuery.data) return;
    const order = ordersQuery.data.find((candidate) => candidate.id === purchaseOrderId);
    if (!order) return;
    if (loadedPurchaseOrderRef.current === purchaseOrderId) return;
    loadedPurchaseOrderRef.current = purchaseOrderId;

    setSupplierId(order.supplierId);
    setItems(
      order.items.map((item) => ({
        key: item.id,
        productId: item.productId,
        purchaseOrderItemId: item.id,
        quantity: String(Number(item.quantity)),
        unitCostNet: String(Number(item.unitCostNet)),
        taxPercent: String(Number(item.taxRate) * 100),
        discountTotal: String(Number(item.discountTotal)),
      })),
    );
  }, [editingId, ordersQuery.data, purchaseOrderId, showForm]);

  const saveMutation = useMutation({
    mutationFn: (payload: SupplierInvoicePayload) => {
      if (!session) throw new Error('Sesión requerida.');
      return editingId
        ? updateSupplierInvoice(session.tenantId, session.accessToken, editingId, {
            ...payload,
            purchaseOrderId: payload.purchaseOrderId || null,
          })
        : createSupplierInvoice(session.tenantId, session.accessToken, payload);
    },
    onSuccess: async (invoice) => {
      const mappingLearning = await learnConfirmedOcrMappings();
      await invalidateInvoices(queryClient);
      if (mappingLearning.learned > 0 && session && supplierId) {
        await queryClient.invalidateQueries({
          queryKey: ['supplier', session.tenantId, supplierId],
        });
      }
      resetDetailInputs();
      setSelectedId(invoice.id);
      setDetailStage('review');
      setCreateChoiceOpen(false);
      setPendingInvoicePayload(null);
      resetForm();
      toast.success(
        `Factura ${invoice.invoiceNumber} guardada. Completa la confirmación de factura y entrada.`,
      );
      if (mappingLearning.learned > 0) {
        toast.success(
          `${mappingLearning.learned} ${mappingLearning.learned === 1 ? 'producto fue vinculado' : 'productos fueron vinculados'} al suplidor para mejorar próximas lecturas OCR.`,
        );
      }
      if (mappingLearning.skippedDuplicateCodes.length > 0) {
        const codes = mappingLearning.skippedDuplicateCodes.slice(0, 3).join(', ');
        const remaining = mappingLearning.skippedDuplicateCodes.length - 3;
        toast.warning(
          `${mappingLearning.skippedDuplicateCodes.length} ${mappingLearning.skippedDuplicateCodes.length === 1 ? 'código no se vinculó' : 'códigos no se vincularon'} para evitar una coincidencia OCR incorrecta.`,
          {
            description: `Ya están asignados a otro producto activo de este suplidor: ${codes}${remaining > 0 ? ` y ${remaining} más` : ''}. Revísalos desde Suplidores si corresponde.`,
          },
        );
      }
    },
    onError: showError,
  });
  const cancelInvoiceMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => {
      if (!session) throw new Error('Sesión requerida.');
      return cancelSupplierInvoice(session.tenantId, session.accessToken, id, reason);
    },
    onSuccess: async () => {
      await invalidateInvoices(queryClient);
      closeInvoiceActionDialog();
      toast.success('Factura de suplidor cancelada.');
    },
    onError: showError,
  });
  const paymentMutation = useMutation({
    mutationFn: (invoice: SupplierInvoice) => {
      if (!session) throw new Error('Sesión requerida.');
      const enteredAmount = toPositiveCurrencyAmount(paymentAmount);
      const balance = Number(invoice.balance);
      if (!enteredAmount) throw new Error('Indica un monto válido para registrar el pago.');
      if (paymentMethod !== 'CASH' && enteredAmount > balance) {
        throw new Error('El monto no puede ser mayor que el saldo pendiente de la factura.');
      }

      return registerSupplierPayment(session.tenantId, session.accessToken, invoice.id, {
        method: paymentMethod,
        amount: paymentMethod === 'CASH' ? Math.min(enteredAmount, balance) : enteredAmount,
        tenderedAmount: paymentMethod === 'CASH' ? enteredAmount : undefined,
        reference: paymentReference.trim() || undefined,
        notes: paymentNotes.trim() || undefined,
      });
    },
    onSuccess: async ({ payment }) => {
      await invalidateInvoices(queryClient);
      setPaymentAmount('');
      setPaymentReference('');
      setPaymentNotes('');
      const changeAmount = Number(payment.changeAmount ?? 0);
      toast.success(
        changeAmount > 0
          ? `Pago al suplidor registrado. Cambio: ${formatCurrency(changeAmount)}.`
          : 'Pago al suplidor registrado.',
      );
    },
    onError: showError,
  });
  const cancelPaymentMutation = useMutation({
    mutationFn: ({
      invoiceId,
      paymentId,
      reason,
    }: {
      invoiceId: string;
      paymentId: string;
      reason: string;
    }) => {
      if (!session) throw new Error('Sesión requerida.');
      return cancelSupplierPayment(
        session.tenantId,
        session.accessToken,
        invoiceId,
        paymentId,
        reason,
      );
    },
    onSuccess: async () => {
      await invalidateInvoices(queryClient);
      closeInvoiceActionDialog();
      toast.success('Pago anulado y saldo restaurado.');
    },
    onError: showError,
  });
  function openInvoiceActionDialog(dialog: SupplierInvoiceActionDialog) {
    setInvoiceActionDialog(dialog);
    setInvoiceActionReason('');
  }

  function closeInvoiceActionDialog() {
    setInvoiceActionDialog(null);
    setInvoiceActionReason('');
  }

  function confirmInvoiceAction() {
    if (!invoiceActionDialog) return;

    const reason = invoiceActionReason.trim();
    if (!reason) {
      toast.error('El motivo es obligatorio.');
      return;
    }

    if (invoiceActionDialog.action === 'cancel-invoice') {
      cancelInvoiceMutation.mutate({ id: invoiceActionDialog.invoice.id, reason });
      return;
    }

    cancelPaymentMutation.mutate({
      invoiceId: invoiceActionDialog.invoiceId,
      paymentId: invoiceActionDialog.payment.id,
      reason,
    });
  }
  if (!session) return <SessionRequired session={session} />;

  function resetForm() {
    loadedPurchaseOrderRef.current = '';
    setShowForm(false);
    setEditingId(null);
    setSupplierId('');
    setPurchaseOrderId('');
    setInvoiceNumber('');
    setNcf('');
    setIssueDate(todayInput());
    setDueDate('');
    setNcfValidUntil('');
    setPaymentCondition('');
    setNotes('');
    setItems([blankItem()]);
    setOcrResult(null);
    setOcrUnconfirmedOrderItemIds([]);
    setQuickSupplierOpen(false);
    setQuickProductItemKey(null);
    setPendingProductItemKey(null);
    setSupplierPickerOpen(false);
    setDetachOrderOpen(false);
    setApplyOrderOcrOpen(false);
    setConversionFactors({});
    setPendingInvoicePayload(null);
  }

  function resetDetailInputs() {
    setPaymentMethod('CASH');
    setPaymentAmount('');
    setPaymentReference('');
    setPaymentNotes('');
  }

  function openInvoiceDetail(invoice: SupplierInvoice) {
    resetDetailInputs();
    setSelectedId(invoice.id);
    setDetailStage(invoice.status === 'DRAFT' ? 'capture' : 'review');
  }

  function closeInvoiceDetail() {
    resetDetailInputs();
    setSelectedId(null);
    setDetailStage('capture');
  }

  function startNewInvoice() {
    resetForm();
    setCreateChoiceOpen(true);
  }

  function startManualCapture() {
    setCreateChoiceOpen(false);
    setOcrCameraOpen(false);
    setShowForm(true);
  }

  function openOcrCamera(invoice?: SupplierInvoice) {
    if (invoice && !loadInvoiceIntoForm(invoice)) return;
    setCreateChoiceOpen(false);
    setMobileCaptureOpen(false);
    setReturnToOcrAfterMobileCapture(false);
    setOcrCameraOpen(true);
  }

  function openMobileCaptureFromOcr() {
    setCreateChoiceOpen(false);
    setOcrCameraOpen(false);
    setReturnToOcrAfterMobileCapture(true);
    setMobileCaptureOpen(true);
  }

  function closeOcrCamera() {
    setOcrCameraOpen(false);
    setReturnToOcrAfterMobileCapture(false);
    if (!selectedId) setCreateChoiceOpen(true);
  }

  function closeMobileCapture() {
    setMobileCaptureOpen(false);
    if (returnToOcrAfterMobileCapture) {
      setReturnToOcrAfterMobileCapture(false);
      setOcrCameraOpen(true);
      return;
    }
    if (!selectedId) setCreateChoiceOpen(true);
  }

  function applyOcrResult(result: SupplierInvoiceOcrResult) {
    const matchingSupplier = findMatchingSupplier(result, activeSuppliers);

    setOcrResult(result);
    setOcrBatchKey(crypto.randomUUID());
    setOcrUnconfirmedOrderItemIds([]);
    if (result.invoiceNumber) {
      setInvoiceNumber((current) => current || result.invoiceNumber!);
    }
    if (result.ncf) {
      setNcf((current) => current || result.ncf!);
    }
    if (result.issueDate) setIssueDate(result.issueDate);
    if (result.paymentDueDate) {
      setDueDate((current) => current || result.paymentDueDate!);
    }
    if (result.ncfValidUntil) {
      setNcfValidUntil((current) => current || result.ncfValidUntil!);
    }
    if (result.paymentCondition) {
      setPaymentCondition((current) => current || result.paymentCondition!);
    }
    if (!supplierId && matchingSupplier) setSupplierId(matchingSupplier.id);

    setOcrCameraOpen(false);
    setMobileCaptureOpen(false);
    setReturnToOcrAfterMobileCapture(false);
    setShowForm(true);
    toast.success(
      matchingSupplier
        ? 'OCR completado. Revisa los datos y las coincidencias de productos antes de guardar.'
        : 'OCR completado. Selecciona el suplidor y revisa los datos antes de guardar.',
    );
  }

  function applyOcrProductSuggestions() {
    if (supplierProductMappingsLoading) {
      toast.info('Esperando los productos vinculados a este suplidor antes de aplicar el OCR.');
      return;
    }

    if (purchaseOrderId) {
      const purchaseOrder = ordersQuery.data?.find((order) => order.id === purchaseOrderId);
      if (!purchaseOrder) {
        toast.info('Esperando los detalles de la orden de compra antes de aplicar el OCR.');
        return;
      }

      const orderItemById = new Map(purchaseOrder.items.map((item) => [item.id, item]));
      const orderLines = items.filter(
        (line) => line.purchaseOrderItemId && orderItemById.has(line.purchaseOrderItemId),
      );
      if (!orderLines.length) {
        toast.error('La orden de compra no tiene líneas disponibles para comparar con el OCR.');
        return;
      }

      const suggestions = new Map<string, PurchaseOrderOcrSuggestion>();
      const highConfidenceOccurrencesByProductId = new Map<string, number>();
      for (const match of ocrProductMatches) {
        if (!match.product || !match.highConfidence) continue;
        highConfidenceOccurrencesByProductId.set(
          match.product.id,
          (highConfidenceOccurrencesByProductId.get(match.product.id) ?? 0) + 1,
        );
      }
      let outsideOrder = 0;
      let needsReview = 0;

      for (const match of ocrProductMatches) {
        const { item, product } = match;
        if (!product || !match.highConfidence) {
          needsReview += 1;
          continue;
        }
        const candidateLines = orderLines.filter((line) => line.productId === product.id);
        if (!candidateLines.length) {
          outsideOrder += 1;
          continue;
        }

        const targetLine = findPurchaseOrderLineForOcrItem(
          item,
          candidateLines,
          orderItemById,
          suggestions,
          highConfidenceOccurrencesByProductId.get(product.id) ?? 0,
        );
        if (!targetLine?.purchaseOrderItemId) {
          needsReview += 1;
          continue;
        }

        const quantity = item.quantity;
        const unitCostNet = item.unitCostNet;
        const taxRate = item.taxRate;
        const discountTotal = item.discountTotal;
        const current = suggestions.get(targetLine.purchaseOrderItemId) ?? {
          ocrItem: item,
          costTotal: 0,
          costWeight: 0,
        };

        if (quantity !== undefined && Number.isFinite(quantity) && quantity >= 0) {
          current.quantity = (current.quantity ?? 0) + quantity;
        }
        if (unitCostNet !== undefined && Number.isFinite(unitCostNet) && unitCostNet >= 0) {
          const weight =
            quantity !== undefined && Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
          current.costTotal += unitCostNet * weight;
          current.costWeight += weight;
        }
        if (taxRate !== undefined && Number.isFinite(taxRate) && taxRate >= 0) {
          current.taxRate =
            current.taxRate === undefined || current.taxRate === taxRate ? taxRate : null;
        }
        if (discountTotal !== undefined && Number.isFinite(discountTotal) && discountTotal >= 0) {
          current.discountTotal = (current.discountTotal ?? 0) + discountTotal;
        }
        suggestions.set(targetLine.purchaseOrderItemId, current);
      }

      const unconfirmedOrderItemIds = orderLines.flatMap((line) =>
        line.purchaseOrderItemId && !suggestions.has(line.purchaseOrderItemId)
          ? [line.purchaseOrderItemId]
          : [],
      );
      setOcrUnconfirmedOrderItemIds(unconfirmedOrderItemIds);

      if (!suggestions.size) {
        toast.error(
          'No hay coincidencias OCR de alta confianza para aplicar a esta orden de compra.',
        );
        return;
      }

      setItems((current) =>
        current.map((line) => {
          const suggestion = line.purchaseOrderItemId
            ? suggestions.get(line.purchaseOrderItemId)
            : undefined;
          if (!suggestion) return line;

          return {
            ...line,
            // Conservamos key, productId y purchaseOrderItemId de la orden.
            // El OCR solo actualiza valores de la factura para que las
            // diferencias se muestren antes de confirmar la entrada.
            ocrItem: suggestion.ocrItem,
            quantity:
              suggestion.quantity === undefined ? line.quantity : String(suggestion.quantity),
            unitCostNet:
              suggestion.costWeight > 0
                ? String(roundUnitCost(suggestion.costTotal / suggestion.costWeight))
                : line.unitCostNet,
            taxPercent:
              suggestion.taxRate === undefined || suggestion.taxRate === null
                ? line.taxPercent
                : String(roundCurrency(suggestion.taxRate * 100)),
            discountTotal:
              suggestion.discountTotal === undefined
                ? line.discountTotal
                : String(roundCurrency(suggestion.discountTotal)),
          };
        }),
      );

      toast.success(
        `${suggestions.size} ${suggestions.size === 1 ? 'línea de la orden fue actualizada' : 'líneas de la orden fueron actualizadas'} con datos OCR. Revisa las diferencias antes de guardar.`,
      );
      if (outsideOrder || needsReview) {
        toast.warning(
          [
            outsideOrder
              ? `${outsideOrder} ${outsideOrder === 1 ? 'producto leído no pertenece' : 'productos leídos no pertenecen'} a la orden y no se agregaron.`
              : null,
            needsReview
              ? `${needsReview} ${needsReview === 1 ? 'línea requiere' : 'líneas requieren'} selección manual.`
              : null,
          ]
            .filter(Boolean)
            .join(' '),
        );
      }
      return;
    }
    const suggestedItems = ocrProductMatches.map(({ item, product, highConfidence }, index) =>
      createOcrInvoiceItem(
        item,
        crypto.randomUUID(),
        `${ocrBatchKey}:${index}`,
        highConfidence ? product : undefined,
      ),
    );

    if (!suggestedItems.length) {
      toast.error(
        'No se detectaron líneas utilizables. Agrega los productos manualmente antes de guardar.',
      );
      return;
    }

    setItems((current) => mergeOcrInvoiceItems(current, suggestedItems));
    scrollToInvoiceProducts();
    const missingProducts = suggestedItems.filter((item) => !item.productId).length;
    toast.success(
      missingProducts
        ? `${suggestedItems.length} líneas fueron preparadas. ${missingProducts} requieren seleccionar o registrar un producto.`
        : `${suggestedItems.length} ${suggestedItems.length === 1 ? 'producto sugerido aplicado' : 'productos sugeridos aplicados'}. Verifica cantidades, costos e ITBIS.`,
    );
  }

  function scrollToInvoiceProducts() {
    window.setTimeout(
      () => invoiceItemsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      50,
    );
  }

  function prepareOcrProduct(index: number, selectedProduct?: Product, createMissing = false) {
    if (purchaseOrderId) {
      setDetachOrderOpen(true);
      return;
    }
    const match = ocrProductMatches[index];
    if (!match) return;
    const sourceKey = `${ocrBatchKey}:${index}`;
    const existing = items.find((item) => item.ocrSourceKey === sourceKey);
    const draft =
      existing ?? createOcrInvoiceItem(match.item, crypto.randomUUID(), sourceKey, selectedProduct);
    setItems((current) => {
      const merged = mergeOcrInvoiceItems(current, [draft]);
      return selectedProduct
        ? merged.map((line) =>
            line.key === draft.key ? selectInvoiceProduct(line, selectedProduct) : line,
          )
        : merged;
    });
    if (createMissing) startMissingProduct(draft.key);
    else scrollToInvoiceProducts();
  }

  function startMissingProduct(key: string) {
    if (!admin) return;
    if (productsQuery.isLoading || productsQuery.isError) {
      toast.error('Espera a que cargue el catálogo para comprobar que el producto no exista.');
      return;
    }
    if (!supplierId) {
      setPendingProductItemKey(key);
      setSupplierPickerOpen(true);
      return;
    }
    setQuickProductItemKey(key);
  }

  function selectInvoiceSupplier(id: string) {
    loadedPurchaseOrderRef.current = '';
    setSupplierId(id);
    setPurchaseOrderId('');
    setOcrUnconfirmedOrderItemIds([]);
    // Changing supplier must not erase invoice lines that were already reviewed.
    setItems((current) => current.map((item) => ({ ...item, purchaseOrderItemId: undefined })));
    setSupplierPickerOpen(false);
    if (pendingProductItemKey) {
      setQuickProductItemKey(pendingProductItemKey);
      setPendingProductItemKey(null);
    }
  }

  function selectOrder(orderId: string) {
    setPurchaseOrderId(orderId);
    setOcrUnconfirmedOrderItemIds([]);
    if (!orderId) {
      loadedPurchaseOrderRef.current = '';
      setItems((current) => current.map((item) => ({ ...item, purchaseOrderItemId: undefined })));
      return;
    }
    const order = ordersQuery.data?.find((candidate) => candidate.id === orderId);
    if (!order) return;
    loadedPurchaseOrderRef.current = order.id;
    setSupplierId(order.supplierId);
    setItems(
      order.items.map((item) => ({
        key: item.id,
        productId: item.productId,
        purchaseOrderItemId: item.id,
        quantity: String(Number(item.quantity)),
        unitCostNet: String(Number(item.unitCostNet)),
        taxPercent: String(Number(item.taxRate) * 100),
        discountTotal: String(Number(item.discountTotal)),
      })),
    );
  }

  function submitInvoice(event: FormEvent) {
    event.preventDefault();
    if (!supplierId || !invoiceNumber.trim()) {
      toast.error('Completa el suplidor y el número de factura.');
      return;
    }
    if (!dueDate) {
      toast.error('Indica la fecha de vencimiento de la factura.');
      return;
    }
    if (!items.length || items.some((item) => !item.productId)) {
      toast.error('Completa todos los productos.');
      return;
    }
    if (
      items.some(
        (item) =>
          !item.quantity.trim() ||
          !item.unitCostNet.trim() ||
          !item.taxPercent.trim() ||
          Number(item.quantity) <= 0 ||
          ![item.quantity, item.unitCostNet, item.taxPercent].every((value) =>
            Number.isFinite(Number(value)),
          ),
      )
    ) {
      toast.error(
        'Completa la cantidad, el costo y el ITBIS de todas las líneas. Los datos que no se leyeron quedan vacíos para revisión.',
      );
      scrollToInvoiceProducts();
      return;
    }
    if (items.some((item) => needsInvoiceUnitReview(item, productById.get(item.productId)))) {
      toast.error('Confirma la presentación de los productos señalados antes de guardar.');
      scrollToInvoiceProducts();
      return;
    }
    const payload: SupplierInvoicePayload = {
      supplierId,
      purchaseOrderId: purchaseOrderId || undefined,
      invoiceNumber: invoiceNumber.trim(),
      ncf: ncf.trim() || undefined,
      issueDate,
      dueDate,
      ncfValidUntil: ncfValidUntil || undefined,
      paymentCondition: paymentCondition.trim() || undefined,
      notes: notes.trim() || undefined,
      ocrReview: ocrResult
        ? {
            pageCount: ocrResult.pageCount,
            detectedTotal: ocrResult.total,
            totalMismatchAccepted: false,
            warnings: ocrResult.warnings.slice(0, 12).map((warning) => warning.slice(0, 250)),
          }
        : undefined,
      items: items.map((item) => ({
        productId: item.productId,
        purchaseOrderItemId: item.purchaseOrderItemId,
        quantity: Number(item.quantity),
        unitCostNet: Number(item.unitCostNet),
        taxRate: Number(item.taxPercent || 0) / 100,
        discountTotal: Number(item.discountTotal || 0),
      })),
    };

    if (hasInvoiceReconciliationWarning) {
      setPendingInvoicePayload(payload);
      return;
    }

    saveMutation.mutate(payload);
  }

  function confirmOrderReconciliation() {
    if (!pendingInvoicePayload) return;
    saveMutation.mutate({
      ...pendingInvoicePayload,
      ocrReview: pendingInvoicePayload.ocrReview
        ? {
            ...pendingInvoicePayload.ocrReview,
            totalMismatchAccepted: hasOcrTotalMismatch,
          }
        : undefined,
    });
  }

  function loadInvoiceIntoForm(invoice: SupplierInvoice) {
    if (!invoice.items?.length) return;
    setEditingId(invoice.id);
    setOcrUnconfirmedOrderItemIds([]);
    setSupplierId(invoice.supplierId);
    setPurchaseOrderId(invoice.purchaseOrderId ?? '');
    setInvoiceNumber(invoice.invoiceNumber);
    setNcf(invoice.ncf ?? '');
    setIssueDate(toDateInput(invoice.issueDate));
    setDueDate(toDateInput(invoice.dueDate));
    setNcfValidUntil(toDateInput(invoice.ncfValidUntil));
    setPaymentCondition(invoice.paymentCondition ?? '');
    setNotes(invoice.notes ?? '');
    setItems(
      invoice.items.map((item) => ({
        key: item.id,
        productId: item.productId,
        purchaseOrderItemId: item.purchaseOrderItemId ?? undefined,
        quantity: String(Number(item.quantity)),
        unitCostNet: String(
          roundUnitCost(
            (Number(item.subtotal) + Number(item.discountTotal)) / Number(item.quantity),
          ),
        ),
        taxPercent: String(Number(item.taxRate) * 100),
        discountTotal: String(Number(item.discountTotal)),
      })),
    );
    return true;
  }

  function editInvoice(invoice: SupplierInvoice) {
    if (!loadInvoiceIntoForm(invoice)) return;
    setOcrResult(null);
    setShowForm(true);
  }

  function updateItem(key: string, patch: Partial<EditableInvoiceItem>) {
    const currentItem = items.find((item) => item.key === key);
    if (
      currentItem?.purchaseOrderItemId &&
      (patch.quantity !== undefined ||
        patch.unitCostNet !== undefined ||
        patch.taxPercent !== undefined ||
        patch.discountTotal !== undefined)
    ) {
      setOcrUnconfirmedOrderItemIds((current) =>
        current.filter((itemId) => itemId !== currentItem.purchaseOrderItemId),
      );
    }
    setItems((current) =>
      current.map((item) => {
        if (item.key !== key) return item;
        let next = { ...item, ...patch };
        if (patch.productId) {
          const product = productById.get(patch.productId);
          if (product) next = { ...selectInvoiceProduct(item, product), ...patch };
        }
        return next;
      }),
    );
  }

  function applyQuickCreatedProduct(product: Product, conversion?: { invoiceUnitFactor: number }) {
    if (!quickProductItemKey) return;
    setItems((current) =>
      current.map((item) =>
        item.key === quickProductItemKey
          ? conversion
            ? convertInvoiceUnit(selectInvoiceProduct(item, product), conversion.invoiceUnitFactor)
            : selectInvoiceProduct(item, product)
          : item,
      ),
    );
    setQuickProductItemKey(null);
  }

  async function useExistingProductFromQuickCreate(product: Product) {
    const item = quickProductItem;
    if (!item) return;
    if (product.status !== 'ACTIVE')
      throw new Error('Reactiva el producto desde Productos antes de usarlo.');
    setItems((current) =>
      current.map((line) => (line.key === item.key ? selectInvoiceProduct(line, product) : line)),
    );
    toast.success('Producto existente seleccionado. Conservamos los importes de esta factura.');
  }

  /**
   * Una factura guardada es la confirmación explícita de la persona que la
   * revisó. Solo entonces convertimos un código OCR en una relación
   * producto-suplidor; así el siguiente OCR reconoce el producto sin guardar
   * la foto ni aprender sugerencias que todavía no fueron aceptadas.
   */
  async function learnConfirmedOcrMappings(): Promise<OcrMappingLearningResult> {
    if (!session || !supplierId || !ocrResult) {
      return { learned: 0, skippedDuplicateCodes: [] };
    }

    const alreadyLinked = new Set(
      (selectedSupplierQuery.data?.products ?? [])
        .filter((supplierProduct) => supplierProduct.active)
        .map((supplierProduct) => supplierProduct.productId),
    );
    const supplierSkuProductIds = new Map<string, string>();
    for (const supplierProduct of selectedSupplierQuery.data?.products ?? []) {
      const supplierSku = supplierProduct.supplierSku?.trim();
      if (!supplierProduct.active || !supplierSku) continue;
      const supplierSkuKey = normalizeSupplierSkuKey(supplierSku);
      if (supplierSkuKey) {
        supplierSkuProductIds.set(supplierSkuKey, supplierProduct.productId);
      }
    }
    const candidates = new Map<string, EditableInvoiceItem>();
    const skippedDuplicateCodes = new Set<string>();

    for (const item of items) {
      const supplierSku = item.ocrItem?.code?.trim();
      const supplierSkuKey = supplierSku ? normalizeSupplierSkuKey(supplierSku) : '';
      if (
        !item.productId ||
        !supplierSku ||
        alreadyLinked.has(item.productId) ||
        candidates.has(item.productId)
      ) {
        continue;
      }

      const linkedProductId = supplierSkuProductIds.get(supplierSkuKey);
      if (linkedProductId && linkedProductId !== item.productId) {
        skippedDuplicateCodes.add(supplierSku);
        continue;
      }

      candidates.set(item.productId, item);
      if (supplierSkuKey) {
        supplierSkuProductIds.set(supplierSkuKey, item.productId);
      }
    }

    let learned = 0;
    for (const item of candidates.values()) {
      const costNet = Number(item.unitCostNet);
      const taxRate = Number(item.taxPercent || 0) / 100;
      try {
        await addSupplierProduct(session.tenantId, session.accessToken, supplierId, {
          productId: item.productId,
          supplierSku: item.ocrItem?.code?.trim() || undefined,
          lastCostNet:
            Number.isFinite(costNet) && costNet >= 0 ? roundCurrency(costNet) : undefined,
          lastCostWithTax:
            Number.isFinite(costNet) && costNet >= 0
              ? roundCurrency(costNet * (1 + Math.max(taxRate, 0)))
              : undefined,
        });
        alreadyLinked.add(item.productId);
        learned += 1;
      } catch (error) {
        // La factura ya fue registrada correctamente. Un vínculo que choque
        // con una relación existente se omite para no modificarla ni crear
        // duplicados; podrá revisarse desde Suplidores.
        if (isDuplicateSupplierSkuError(error) && item.ocrItem?.code) {
          skippedDuplicateCodes.add(item.ocrItem.code);
        }
      }
    }

    return {
      learned,
      skippedDuplicateCodes: [...skippedDuplicateCodes],
    };
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <ModuleHeader
          title="Facturas de suplidores"
          description="Registro manual, cuentas por pagar, abonos y trazabilidad de cada factura recibida."
        />
        <Button onClick={startNewInvoice}>
          <FilePlus2 className="h-4 w-4" />
          Registrar factura
        </Button>
      </div>

      {showForm ? (
        <SupplierInvoiceDialog
          open={showForm}
          title={editingId ? 'Completar factura de suplidor' : 'Introducir factura manualmente'}
          description="Registra solo los datos que aparecen en la factura. Antes de guardar revisaremos diferencias con la orden de compra."
          icon={<Pencil className="h-5 w-5" />}
          onClose={resetForm}
        >
          <div className="space-y-5">
            <div className="rounded-lg border border-primary/10 bg-muted/20 p-4 text-sm">
              <p className="font-medium">
                {editingId
                  ? 'Actualiza únicamente los datos que aparecen en la factura.'
                  : 'Registra únicamente los datos que aparecen en la factura.'}
              </p>
              <p className="mt-1 text-muted-foreground">
                Luego revisaremos cualquier diferencia con la orden antes de registrar la cuenta por
                pagar y la entrada de mercancía.
              </p>
            </div>
            {ocrResult ? (
              <div className="rounded-lg border border-accent/25 bg-accent/[0.06] p-4">
                <div className="flex items-start gap-3">
                  <Camera className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">Datos sugeridos por el OCR</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      La foto se procesó solo en este dispositivo y no fue guardada. Verifica cada
                      dato antes de continuar.
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                  {ocrResult.invoiceNumber ? (
                    <OcrDetected label="Factura" value={ocrResult.invoiceNumber} />
                  ) : null}
                  {ocrResult.ncf ? <OcrDetected label="NCF" value={ocrResult.ncf} /> : null}
                  {ocrResult.supplierDocument ? (
                    <OcrDetected label="RNC / cédula" value={ocrResult.supplierDocument} />
                  ) : null}
                  {ocrResult.issueDate ? (
                    <OcrDetected
                      label="Emisión"
                      value={formatInvoiceCalendarDate(ocrResult.issueDate)}
                    />
                  ) : null}
                  {ocrResult.total !== undefined ? (
                    <OcrDetected label="Total detectado" value={formatCurrency(ocrResult.total)} />
                  ) : null}
                </div>
                {ocrResult.supplierName ||
                ocrResult.paymentDueDate ||
                ocrResult.ncfValidUntil ||
                ocrResult.paymentCondition ? (
                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                    {ocrResult.supplierName ? (
                      <OcrDetected
                        label="Suplidor detectado"
                        value={ocrResult.supplierName}
                        confidence={ocrResult.confidence.supplierName}
                      />
                    ) : null}
                    {ocrResult.paymentDueDate ? (
                      <OcrDetected
                        label="Vencimiento de pago"
                        value={formatInvoiceCalendarDate(ocrResult.paymentDueDate)}
                        confidence={ocrResult.confidence.paymentDueDate}
                      />
                    ) : null}
                    {ocrResult.ncfValidUntil ? (
                      <OcrDetected
                        label="Vigencia fiscal NCF"
                        value={formatInvoiceCalendarDate(ocrResult.ncfValidUntil)}
                        confidence={ocrResult.confidence.ncfValidUntil}
                      />
                    ) : null}
                    {ocrResult.paymentCondition ? (
                      <OcrDetected label="Condición" value={ocrResult.paymentCondition} />
                    ) : null}
                  </div>
                ) : null}
                {!supplierId &&
                !ocrSupplierMatch &&
                (ocrResult.supplierName || ocrResult.supplierDocument) ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium">El suplidor detectado aún no está registrado</p>
                      <p className="mt-1 text-muted-foreground">
                        Revísalo y regístralo sin salir de esta factura. Antes validaremos el RNC o
                        la cédula para no duplicarlo.
                      </p>
                    </div>
                    {canCreateSupplier ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setQuickSupplierOpen(true)}
                      >
                        <Plus className="h-4 w-4" />
                        Registrar suplidor
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {supplierId &&
                ocrResult.supplierDocument &&
                selectedSupplierQuery.data &&
                normalizeDocument(selectedSupplierQuery.data.documentNumber) !==
                  normalizeDocument(ocrResult.supplierDocument) ? (
                  <div
                    className="mt-4 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
                    role="alert"
                  >
                    <p className="font-medium">Revisa el suplidor seleccionado</p>
                    <p className="mt-1 text-muted-foreground">
                      La factura indica RNC {ocrResult.supplierDocument}, pero seleccionaste{' '}
                      {selectedSupplierQuery.data.commercialName} (
                      {selectedSupplierQuery.data.documentNumber}). Elige el suplidor de esta
                      factura antes de vincular sus productos.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => setSupplierPickerOpen(true)}
                    >
                      Elegir suplidor
                    </Button>
                  </div>
                ) : null}
                {ocrResult.warnings.length ? (
                  <div className="mt-4 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
                    <p className="font-medium text-warning">Revisión requerida</p>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                      {ocrResult.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {ocrResult.items.length ? (
                  <div className="mt-4 rounded-md border bg-card/70 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">
                          Productos leídos de la factura · {ocrResult.items.length}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Revisa cada producto y su presentación. Puedes usar una coincidencia,
                          buscar otra o registrar el producto faltante aquí mismo.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          supplierProductMappingsLoading ||
                          productsQuery.isLoading ||
                          productsQuery.isError
                        }
                        onClick={() =>
                          purchaseOrderId
                            ? setApplyOrderOcrOpen(true)
                            : applyOcrProductSuggestions()
                        }
                      >
                        {productsQuery.isLoading
                          ? 'Cargando catálogo…'
                          : productsQuery.isError
                            ? 'Catálogo no disponible'
                            : supplierProductMappingsLoading
                              ? 'Cargando vínculos del suplidor…'
                              : purchaseOrderId
                                ? 'Aplicar a líneas de la orden'
                                : 'Preparar líneas detectadas'}
                      </Button>
                    </div>
                    {productsQuery.isError ? (
                      <p className="mt-3 text-sm text-danger" role="alert">
                        No se pudo cargar el catálogo.{' '}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => void productsQuery.refetch()}
                        >
                          Volver a intentar
                        </button>{' '}
                        antes de confirmar que un producto no existe.
                      </p>
                    ) : null}
                    {purchaseOrderId ? (
                      <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs leading-5">
                        Esta factura está vinculada a una orden de compra. Solo se actualizan sus
                        productos coincidentes. Si la factura contiene productos distintos, puedes
                        capturarla sin vincular esta orden.
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-2 block"
                          onClick={() => setDetachOrderOpen(true)}
                        >
                          Capturar todos los productos sin esta orden
                        </Button>
                      </div>
                    ) : null}
                    <div className="mt-3 space-y-2">
                      {ocrProductMatches.map(
                        (
                          {
                            item,
                            product,
                            source,
                            isPrimarySupplierProduct,
                            warning,
                            highConfidence,
                            alternatives,
                          },
                          index,
                        ) => (
                          <div
                            key={`${item.rawText}-${index}`}
                            className="grid gap-2 rounded-md border bg-muted/15 p-2.5 text-sm md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center"
                          >
                            <div className="min-w-0">
                              <p className="font-medium">
                                {item.description ?? 'Descripción por confirmar'}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">
                                {product
                                  ? `Coincide con: ${product.name}${product.sku ? ` · ${product.sku}` : ''}`
                                  : 'Sin coincidencia segura: busca en el catálogo o registra si no existe'}
                              </p>
                              {product ? (
                                <p className="truncate text-xs text-muted-foreground">
                                  {getOcrProductMatchDescription(source, isPrimarySupplierProduct)}
                                </p>
                              ) : null}
                              {warning ? <p className="text-xs text-warning">{warning}</p> : null}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {item.quantity ?? '—'} {item.unit ?? ''} ×{' '}
                              {item.unitCostNet === undefined
                                ? '—'
                                : formatCurrency(item.unitCostNet)}
                            </p>
                            <span
                              className={
                                source === 'SUPPLIER_PRIMARY'
                                  ? 'w-fit rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary'
                                  : source === 'SUPPLIER_SKU' || source === 'SUPPLIER_PRODUCT'
                                    ? 'w-fit rounded-full bg-success/10 px-2 py-1 text-xs font-medium text-success'
                                    : product
                                      ? 'w-fit rounded-full bg-success/10 px-2 py-1 text-xs font-medium text-success'
                                      : 'w-fit rounded-full bg-warning/10 px-2 py-1 text-xs font-medium text-warning'
                              }
                            >
                              {product && highConfidence
                                ? getOcrProductMatchBadge(source, isPrimarySupplierProduct)
                                : 'Revisar'}
                            </span>
                            <div className="flex flex-wrap gap-2 md:col-span-3">
                              {items.some(
                                (line) => line.ocrSourceKey === `${ocrBatchKey}:${index}`,
                              ) ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={scrollToInvoiceProducts}
                                >
                                  Ver línea preparada
                                </Button>
                              ) : null}
                              {product ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => prepareOcrProduct(index, product)}
                                >
                                  Usar {product.name}
                                </Button>
                              ) : (
                                (alternatives ?? []).slice(0, 3).map((candidate) => (
                                  <Button
                                    key={candidate.id}
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => prepareOcrProduct(index, candidate)}
                                  >
                                    Usar {candidate.name}
                                  </Button>
                                ))
                              )}
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => prepareOcrProduct(index)}
                              >
                                <Search className="h-4 w-4" /> Buscar en catálogo
                              </Button>
                              {admin ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => prepareOcrProduct(index, undefined, true)}
                                >
                                  <Plus className="h-4 w-4" /> Registrar si no existe
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                  </div>
                ) : null}
                <details className="mt-4 rounded-md border bg-card/70">
                  <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium marker:content-none">
                    Ver texto detectado
                  </summary>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap border-t p-3 font-sans text-xs leading-5 text-muted-foreground">
                    {ocrResult.rawText.slice(0, 4_000)}
                  </pre>
                </details>
              </div>
            ) : null}
            <form onSubmit={submitInvoice} className="space-y-5">
              <div className="rounded-lg border border-primary/15 bg-primary/[0.03] p-4 text-sm">
                <p className="font-medium">Fechas importantes de la factura</p>
                <p className="mt-1 leading-6 text-muted-foreground">
                  <strong className="font-medium text-foreground">Fecha límite de pago</strong>{' '}
                  corresponde a <em>Vence</em> o <em>Vencimiento</em> y controla la cuenta por
                  pagar.
                  <span className="mx-1.5 text-border">|</span>
                  <strong className="font-medium text-foreground">
                    Vigencia fiscal del NCF/e-NCF
                  </strong>{' '}
                  corresponde únicamente a <em>Válido hasta</em> o <em>NCF vencimiento</em>.
                </p>
              </div>
              <section className="space-y-4 rounded-xl border bg-card/60 p-4 sm:p-5">
                <div>
                  <h3 className="font-semibold">Datos del documento</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Transcribe la identificación que aparece en la factura del suplidor.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <FormField label="Suplidor">
                    <div className="space-y-2">
                      <select
                        required
                        className={selectClassName}
                        value={supplierId}
                        onChange={(event) => selectInvoiceSupplier(event.target.value)}
                      >
                        <option value="">Selecciona...</option>
                        {activeSuppliers.map((supplier) => (
                          <option key={supplier.id} value={supplier.id}>
                            {supplier.commercialName}
                          </option>
                        ))}
                      </select>
                      {!purchaseOrderId && canCreateSupplier ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto px-0 text-primary hover:bg-transparent hover:text-primary/80"
                          onClick={() => setQuickSupplierOpen(true)}
                        >
                          <Plus className="h-4 w-4" />
                          Registrar suplidor sin salir
                        </Button>
                      ) : null}
                      {!purchaseOrderId && !canCreateSupplier ? (
                        <p className="text-xs text-muted-foreground">
                          Un usuario autorizado puede registrar un suplidor nuevo desde esta misma
                          factura.
                        </p>
                      ) : null}
                    </div>
                  </FormField>
                  <FormField
                    label="Orden de compra"
                    hint="Opcional. Solo se muestran órdenes emitidas sin factura."
                  >
                    <select
                      className={selectClassName}
                      value={purchaseOrderId}
                      onChange={(event) => selectOrder(event.target.value)}
                    >
                      <option value="">Sin orden previa</option>
                      {eligibleOrders.map((order) => (
                        <option key={order.id} value={order.id}>
                          {order.orderNumber} · {formatCurrency(Number(order.total))}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Factura / documento #">
                    <Input
                      required
                      maxLength={100}
                      value={invoiceNumber}
                      onChange={(event) => setInvoiceNumber(event.target.value)}
                    />
                  </FormField>
                  <FormField label="NCF / e-NCF">
                    <Input
                      maxLength={50}
                      value={ncf}
                      onChange={(event) => setNcf(event.target.value.toUpperCase())}
                      placeholder="B01... o E31..."
                    />
                  </FormField>
                  <FormField label="Fecha de emisión">
                    <Input
                      required
                      type="date"
                      value={issueDate}
                      onChange={(event) => setIssueDate(event.target.value)}
                    />
                  </FormField>
                </div>

                <div className="border-t border-border/70 pt-4">
                  <h3 className="font-semibold">Pago y datos fiscales</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    El vencimiento de pago y la vigencia fiscal son datos distintos de la factura.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <FormField
                    label="Fecha límite de pago"
                    hint="Obligatoria. Copia “Vence” o “Vencimiento”; controla cuentas por pagar."
                  >
                    <Input
                      required
                      type="date"
                      min={issueDate}
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                    />
                  </FormField>
                  <FormField
                    label="Condición de pago"
                    hint="Por ejemplo: contado, crédito 30 días o pago por adelantado."
                  >
                    <Input
                      maxLength={120}
                      value={paymentCondition}
                      onChange={(event) => setPaymentCondition(event.target.value)}
                      placeholder="Ej.: Crédito 30 días"
                    />
                  </FormField>
                  <FormField
                    label="Vigencia fiscal del NCF / e-NCF"
                    hint="Opcional. Copia solo “Válido hasta” o “NCF vencimiento”; no afecta el pago."
                  >
                    <Input
                      type="date"
                      min={issueDate}
                      value={ncfValidUntil}
                      onChange={(event) => setNcfValidUntil(event.target.value)}
                    />
                  </FormField>
                  <FormField label="Moneda">
                    <Input value="DOP / RD$" disabled />
                  </FormField>
                  <FormField label="Notas">
                    <Input
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      maxLength={2000}
                    />
                  </FormField>
                </div>
              </section>

              <div ref={invoiceItemsRef} className="scroll-mt-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">Productos facturados</h3>
                    <p className="text-sm text-muted-foreground">
                      Selecciona productos existentes o registra de forma controlada los que falten.
                    </p>
                  </div>
                  {!purchaseOrderId ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setItems((current) => [...current, blankItem()])}
                    >
                      <Plus className="h-4 w-4" />
                      Línea
                    </Button>
                  ) : null}
                </div>
                {items.map((item, index) => (
                  <div
                    key={item.key}
                    className="grid gap-3 rounded-md border bg-muted/10 p-3 md:grid-cols-12"
                  >
                    <FormField label={`Producto ${index + 1}`} className="md:col-span-4">
                      <div className="space-y-2">
                        <ProductCombobox
                          products={productOptions}
                          value={item.productId}
                          required
                          disabled={Boolean(purchaseOrderId)}
                          ariaLabel={`Buscar producto ${index + 1}`}
                          getSearchText={getSupplierProductSearchText}
                          onValueChange={(productId) => updateItem(item.key, { productId })}
                        />
                        {!purchaseOrderId && !item.productId ? (
                          <div className="space-y-1">
                            {admin ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-auto px-0 text-primary hover:bg-transparent hover:text-primary/80"
                                onClick={() => startMissingProduct(item.key)}
                              >
                                <Plus className="h-4 w-4" />
                                Registrar producto faltante
                              </Button>
                            ) : null}
                            {!supplierId ? (
                              <p className="text-xs text-muted-foreground">
                                Al registrar, podrás elegir o crear el suplidor y continuar con este
                                producto.
                              </p>
                            ) : null}
                            {!admin ? (
                              <p className="text-xs text-muted-foreground">
                                Un administrador debe registrar los productos faltantes para
                                proteger el catálogo.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {item.ocrItem ? (
                          <p className="text-xs leading-5 text-muted-foreground">
                            Factura: {item.ocrItem.description ?? 'Descripción pendiente'}
                            {item.ocrItem.code ? ` · Código ${item.ocrItem.code}` : ''}
                            {item.ocrItem.unit ? ` · Presentación ${item.ocrItem.unit}` : ''}
                          </p>
                        ) : null}
                      </div>
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
                        step="0.000001"
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
                    {needsInvoiceUnitReview(item, productById.get(item.productId)) ? (
                      <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm md:col-span-12">
                        <p className="font-medium">
                          Confirma la presentación antes de aumentar el inventario
                        </p>
                        <p>
                          La factura usa <strong>{item.ocrItem?.unit}</strong> y el producto del
                          catálogo usa{' '}
                          <strong>
                            {translateProductUnit(productById.get(item.productId)?.unit)}
                          </strong>
                          . Los importes y cantidades aún corresponden a la factura.
                        </p>
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="space-y-1 text-xs">
                            <span className="block">
                              Unidades de inventario por cada {item.ocrItem?.unit}
                            </span>
                            <Input
                              type="number"
                              min="0.000001"
                              step="any"
                              className="w-40"
                              value={conversionFactors[item.key] ?? ''}
                              placeholder="Ej.: 12"
                              onChange={(event) =>
                                setConversionFactors((current) => ({
                                  ...current,
                                  [item.key]: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              try {
                                updateItem(
                                  item.key,
                                  convertInvoiceUnit(item, Number(conversionFactors[item.key])),
                                );
                              } catch (error) {
                                toast.error(
                                  error instanceof Error ? error.message : 'Revisa la conversión.',
                                );
                              }
                            }}
                          >
                            Convertir cantidad y costo
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateItem(item.key, { unitConversionConfirmed: true })}
                          >
                            Ya revisé: cantidad y costo están en la unidad del catálogo
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    <div className="flex items-end justify-end md:col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={items.length === 1}
                        onClick={() => {
                          if (item.purchaseOrderItemId) {
                            setOcrUnconfirmedOrderItemIds((current) =>
                              current.filter((itemId) => itemId !== item.purchaseOrderItemId),
                            );
                          }
                          setItems((current) => current.filter((entry) => entry.key !== item.key));
                        }}
                        aria-label="Eliminar línea"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              {hasOcrTotalMismatch && ocrResult?.total !== undefined ? (
                <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                  <div>
                    <p className="font-medium">El total digitado no coincide con el total leído</p>
                    <p className="mt-1 text-muted-foreground">
                      OCR: {formatCurrency(ocrResult.total)} · factura actual:{' '}
                      {formatCurrency(totals.total)} · diferencia:{' '}
                      {formatCurrency(Math.abs(ocrTotalDifference ?? 0))}. Corrige los datos o
                      confirma explícitamente la diferencia al guardar.
                    </p>
                  </div>
                </div>
              ) : null}
              {hasOrderReconciliationWarning ? (
                <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                  <div>
                    <p className="font-medium">La factura no coincide por completo con la orden</p>
                    <p className="mt-1 text-muted-foreground">
                      Al guardar te mostraremos los productos o cantidades pendientes para que
                      confirmes el total que realmente se debe pagar.
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-4">
                <Total label="Subtotal" value={totals.subtotal} />
                <Total label="Descuento" value={totals.discount} />
                <Total label="ITBIS" value={totals.tax} />
                <Total label="Total" value={totals.total} strong />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cerrar
                </Button>
                <Button disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Guardando...' : 'Guardar y revisar entrada'}
                </Button>
              </div>
            </form>
          </div>
        </SupplierInvoiceDialog>
      ) : null}

      <SupplierInvoiceDialog
        open={createChoiceOpen && !showForm}
        title="¿Cómo deseas registrar la factura?"
        description={
          purchaseOrderId
            ? `Orden ${orderReconciliation.purchaseOrder?.orderNumber ?? ''}. Elige cómo capturar los datos antes de confirmar la entrada.`
            : 'Elige cómo capturar los datos antes de confirmar la factura y la entrada de mercancía.'
        }
        icon={<FilePlus2 className="h-5 w-5" />}
        size="lg"
        onClose={() => {
          setCreateChoiceOpen(false);
          resetForm();
        }}
      >
        <CaptureMethodChoice onManual={startManualCapture} onOcr={() => openOcrCamera()} />
      </SupplierInvoiceDialog>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_240px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar factura, NCF, suplidor o documento"
            />
          </div>
          <select
            className={selectClassName}
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="ALL">Todos los estados</option>
            <option value="DRAFT">Borradores</option>
            <option value="PENDING">Pendientes</option>
            <option value="PARTIALLY_PAID">Pagadas parcialmente</option>
            <option value="PAID">Pagadas</option>
            <option value="OVERDUE">Vencidas</option>
            <option value="CANCELLED">Canceladas</option>
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Facturas registradas</CardTitle>
          <CardDescription>
            Selecciona una factura para consultar su entrada de mercancía, cuenta por pagar y pagos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState
            loading={invoicesQuery.isLoading}
            error={invoicesQuery.error}
            empty={!invoicesQuery.isLoading && !invoicesQuery.data?.length}
            emptyMessage="Aún no hay facturas de suplidores."
          />
          {invoicesQuery.data?.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Factura</TableHead>
                    <TableHead>Suplidor</TableHead>
                    <TableHead>Emisión / vence pago</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoicesQuery.data.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <p className="font-medium">{invoice.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">{invoice.ncf ?? 'Sin NCF'}</p>
                      </TableCell>
                      <TableCell>
                        <p>{invoice.supplierNameSnapshot}</p>
                        <p className="text-xs text-muted-foreground">
                          {invoice.purchaseOrder?.orderNumber ?? 'Sin orden previa'}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p>{formatInvoiceCalendarDate(invoice.issueDate)}</p>
                        <p
                          className={
                            invoice.isOverdue
                              ? 'text-xs font-medium text-danger'
                              : 'text-xs text-muted-foreground'
                          }
                        >
                          Vence pago: {formatInvoiceCalendarDate(invoice.dueDate)}
                        </p>
                      </TableCell>
                      <TableCell>
                        <ProcurementStatusBadge status={invoice.displayStatus} />
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(invoice.total))}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(Number(invoice.balance))}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openInvoiceDetail(invoice)}
                        >
                          Ver detalle
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selectedId && !showForm ? (
        <SupplierInvoiceDialog
          open={Boolean(selectedId && !showForm)}
          title={
            detailQuery.data
              ? `Factura ${detailQuery.data.invoiceNumber}`
              : 'Detalle de factura de suplidor'
          }
          description="La ventana muestra solo el siguiente paso necesario para esta factura."
          icon={<FilePlus2 className="h-5 w-5" />}
          onClose={closeInvoiceDetail}
        >
          <Card className="border-0 shadow-none">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Detalle de factura y entrada</CardTitle>
                  <CardDescription>
                    Revisa y confirma la factura con su entrada de mercancía en un único paso.
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={closeInvoiceDetail}>
                  Cerrar detalle
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <QueryState loading={detailQuery.isLoading} error={detailQuery.error} />
              {detailQuery.data?.status === 'DRAFT' && detailStage === 'capture' ? (
                <CaptureMethodChoice
                  onManual={() => editInvoice(detailQuery.data!)}
                  onOcr={() => openOcrCamera(detailQuery.data!)}
                />
              ) : null}
              {detailQuery.data &&
              !(detailQuery.data.status === 'DRAFT' && detailStage === 'capture') ? (
                <>
                  <div className="grid gap-3 rounded-md border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Meta label="Factura" value={detailQuery.data.invoiceNumber} />
                    <Meta label="Suplidor" value={detailQuery.data.supplierNameSnapshot} />
                    <Meta label="Total" value={formatCurrency(Number(detailQuery.data.total))} />
                    <Meta label="Saldo" value={formatCurrency(Number(detailQuery.data.balance))} />
                  </div>
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Producto</TableHead>
                          <TableHead className="text-right">Cantidad</TableHead>
                          <TableHead className="text-right">Costo neto</TableHead>
                          <TableHead className="text-right">Costo con ITBIS</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailQuery.data.items?.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell>
                              <p className="font-medium">{item.descriptionSnapshot}</p>
                              <p className="text-xs text-muted-foreground">
                                {item.skuSnapshot ?? 'Sin SKU'}
                              </p>
                            </TableCell>
                            <TableCell className="text-right">{Number(item.quantity)}</TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(Number(item.unitCostNet))}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(Number(item.unitCostWithTax))}
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(Number(item.total))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {detailQuery.data.status === 'DRAFT' ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => editInvoice(detailQuery.data!)}
                      >
                        <Pencil className="h-4 w-4" />
                        Editar borrador
                      </Button>
                    </div>
                  ) : null}

                  {detailQuery.data.status === 'DRAFT' || !hasConfirmedGoodsReceipt ? (
                    <SupplierInvoiceEntryPanel invoice={detailQuery.data} session={session} />
                  ) : (
                    <details className="rounded-lg border bg-muted/15">
                      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold marker:content-none">
                        Registrar una entrega adicional
                      </summary>
                      <div className="border-t p-4">
                        <SupplierInvoiceEntryPanel invoice={detailQuery.data} session={session} />
                      </div>
                    </details>
                  )}

                  {['PENDING', 'PARTIALLY_PAID'].includes(detailQuery.data.status) &&
                  !hasConfirmedGoodsReceipt ? (
                    <div className="flex gap-3 rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm">
                      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                      <div>
                        <p className="font-medium">Primero confirma la entrada de mercancía</p>
                        <p className="mt-1 text-muted-foreground">
                          El pago queda bloqueado hasta que exista una entrada confirmada para esta
                          factura. Así la cuenta por pagar siempre coincide con lo recibido.
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {['PENDING', 'PARTIALLY_PAID'].includes(detailQuery.data.status) &&
                  hasConfirmedGoodsReceipt ? (
                    <div className="rounded-md border p-4">
                      <div className="mb-4 flex items-center gap-2">
                        <Banknote className="h-5 w-5 text-accent" />
                        <div>
                          <h3 className="font-semibold">Registrar pago</h3>
                          <p className="text-sm text-muted-foreground">
                            Registra el pago de esta factura sin alterar caja ni el efectivo
                            esperado.
                          </p>
                        </div>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <FormField label="Método">
                          <select
                            className={selectClassName}
                            value={paymentMethod}
                            onChange={(event) =>
                              setPaymentMethod(event.target.value as typeof paymentMethod)
                            }
                          >
                            <option value="CASH">Efectivo</option>
                            <option value="TRANSFER">Transferencia</option>
                            <option value="CHECK">Cheque</option>
                          </select>
                        </FormField>
                        <FormField
                          label={paymentMethod === 'CASH' ? 'Monto entregado' : 'Monto a pagar'}
                          hint={
                            paymentMethod === 'CASH'
                              ? 'Puedes indicar un monto mayor; el cambio se calculará abajo.'
                              : 'No puede superar el saldo pendiente de la factura.'
                          }
                        >
                          <Input
                            type="number"
                            min="0.01"
                            max={
                              paymentMethod === 'CASH'
                                ? undefined
                                : Number(detailQuery.data.balance)
                            }
                            step="0.01"
                            inputMode="decimal"
                            value={paymentAmount}
                            onChange={(event) => setPaymentAmount(event.target.value)}
                          />
                        </FormField>
                        <FormField label="Referencia">
                          <Input
                            value={paymentReference}
                            onChange={(event) => setPaymentReference(event.target.value)}
                            placeholder="Cheque / transferencia"
                          />
                        </FormField>
                        <FormField label="Notas">
                          <Input
                            value={paymentNotes}
                            onChange={(event) => setPaymentNotes(event.target.value)}
                          />
                        </FormField>
                      </div>
                      {paymentMethod === 'CASH' ? (
                        <div className="mt-3 grid gap-2 rounded-md border border-success/25 bg-success/[0.06] p-3 text-sm sm:grid-cols-3">
                          <PaymentAmountSummary label="Saldo pendiente" value={paymentBalance} />
                          <PaymentAmountSummary
                            label="Aplicado a factura"
                            value={paymentAppliedAmount}
                          />
                          <PaymentAmountSummary
                            label="Cambio"
                            value={paymentChangeAmount}
                            emphasis
                          />
                        </div>
                      ) : null}
                      {paymentMethod === 'CASH' ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          El efectivo entregado y el cambio quedan registrados en este pago, sin
                          alterar la caja ni el efectivo esperado.
                        </p>
                      ) : null}
                      {paymentExceedsBalance ? (
                        <p className="mt-3 text-xs font-medium text-danger">
                          Transferencia y cheque deben registrarse por un monto que no supere el
                          saldo pendiente.
                        </p>
                      ) : null}
                      <div className="mt-4 flex justify-end">
                        <Button
                          type="button"
                          disabled={
                            !paymentEnteredAmount ||
                            paymentExceedsBalance ||
                            paymentMutation.isPending
                          }
                          onClick={(event) => {
                            // Esta acción nunca debe convertirse en una navegación GET de un
                            // formulario contenedor. El pago se registra únicamente mediante la
                            // mutación POST de la API.
                            event.preventDefault();
                            event.stopPropagation();
                            paymentMutation.mutate(detailQuery.data!);
                          }}
                        >
                          Registrar pago
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <h3 className="mb-3 font-semibold">Historial de pagos</h3>
                    <QueryState
                      empty={!detailQuery.data.payments?.length}
                      emptyMessage="Esta factura todavía no tiene pagos."
                    />
                    {detailQuery.data.payments?.length ? (
                      <div className="space-y-2">
                        {detailQuery.data.payments.map((payment) => (
                          <div
                            key={payment.id}
                            className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <p className="font-medium">
                                {payment.paymentNumber} · Aplicado{' '}
                                {formatCurrency(Number(payment.amount))}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {payment.method === 'CASH'
                                  ? 'Efectivo'
                                  : payment.method === 'TRANSFER'
                                    ? 'Transferencia'
                                    : 'Cheque'}{' '}
                                · {formatDateTime(payment.paidAt)}
                              </p>
                              {payment.method === 'CASH' &&
                              (Number(payment.tenderedAmount ?? payment.amount) !==
                                Number(payment.amount) ||
                                Number(payment.changeAmount ?? 0) > 0) ? (
                                <p className="mt-1 text-xs font-medium text-success">
                                  Entregado:{' '}
                                  {formatCurrency(Number(payment.tenderedAmount ?? payment.amount))}{' '}
                                  · Cambio: {formatCurrency(Number(payment.changeAmount ?? 0))}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2">
                              <ProcurementStatusBadge status={payment.status} />
                              {admin && payment.status === 'COMPLETED' ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    openInvoiceActionDialog({
                                      action: 'cancel-payment',
                                      invoiceId: detailQuery.data!.id,
                                      invoiceNumber: detailQuery.data!.invoiceNumber,
                                      payment,
                                    });
                                  }}
                                >
                                  Anular
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                    {admin && detailQuery.data.status !== 'CANCELLED' ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          openInvoiceActionDialog({
                            action: 'cancel-invoice',
                            invoice: detailQuery.data!,
                          })
                        }
                      >
                        Cancelar factura
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>
        </SupplierInvoiceDialog>
      ) : null}

      <ActionDialog
        open={Boolean(pendingInvoicePayload)}
        title={
          hasOrderReconciliationWarning
            ? 'Hay diferencias por revisar antes de guardar'
            : 'El total digitado no coincide con el OCR'
        }
        description="La factura se guardará con lo realmente facturado o recibido. El total mostrado será el monto que quedará pendiente de pago."
        summary={
          <div className="space-y-3">
            {hasOcrTotalMismatch && ocrResult?.total !== undefined ? (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <p className="font-medium">Diferencia con el total leído por OCR</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  OCR: {formatCurrency(ocrResult.total)} · confirmado en la factura:{' '}
                  {formatCurrency(totals.total)} · diferencia:{' '}
                  {formatCurrency(Math.abs(ocrTotalDifference ?? 0))}.
                </p>
              </div>
            ) : null}
            {orderReconciliation.missingItems.length ? (
              <div>
                <p className="font-medium">Productos que no están en esta factura</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                  {orderReconciliation.missingItems.map((item) => (
                    <li key={item.id}>
                      {item.descriptionSnapshot} · solicitado: {Number(item.quantity)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {orderReconciliation.ocrUnconfirmedItems.length ? (
              <div>
                <p className="font-medium">Líneas de la orden que el OCR no pudo confirmar</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Se conservan los valores solicitados hasta que los revises o los ajustes
                  manualmente; no se agregaron ni cambiaron automáticamente.
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                  {orderReconciliation.ocrUnconfirmedItems.map((item) => (
                    <li key={item.id}>
                      {item.descriptionSnapshot} · solicitado: {Number(item.quantity)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {orderReconciliation.quantityDifferences.length ? (
              <div>
                <p className="font-medium">Cantidades distintas</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                  {orderReconciliation.quantityDifferences.map(({ orderItem, invoiceItem }) => (
                    <li key={orderItem.id}>
                      {orderItem.descriptionSnapshot} · solicitado: {Number(orderItem.quantity)} ·
                      facturado: {Number(invoiceItem.quantity)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {orderReconciliation.costDifferences.length ? (
              <div>
                <p className="font-medium">Costos, ITBIS o descuentos distintos</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
                  {orderReconciliation.costDifferences.map(
                    ({ orderItem, invoiceItem, costChanged, taxChanged, discountChanged }) => (
                      <li key={orderItem.id}>
                        {orderItem.descriptionSnapshot}
                        {costChanged
                          ? ` · costo solicitado: ${formatCurrency(Number(orderItem.unitCostNet))} · facturado: ${formatCurrency(Number(invoiceItem.unitCostNet))}`
                          : ''}
                        {taxChanged
                          ? ` · ITBIS solicitado: ${roundCurrency(Number(orderItem.taxRate) * 100)}% · facturado: ${roundCurrency(Number(invoiceItem.taxPercent || 0))}%`
                          : ''}
                        {discountChanged
                          ? ` · descuento solicitado: ${formatCurrency(Number(orderItem.discountTotal))} · facturado: ${formatCurrency(Number(invoiceItem.discountTotal || 0))}`
                          : ''}
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ) : null}
            <div className="rounded-md border border-accent/20 bg-accent/[0.06] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Total que se registrará por pagar
              </p>
              <p className="mt-1 text-lg font-semibold text-accent">
                {formatCurrency(totals.total)}
              </p>
            </div>
          </div>
        }
        tone="warning"
        size="lg"
        confirmLabel={
          hasOrderReconciliationWarning
            ? 'Actualizar factura con lo recibido'
            : 'Confirmar total de factura'
        }
        cancelLabel="Seguir corrigiendo"
        isPending={saveMutation.isPending}
        onClose={() => setPendingInvoicePayload(null)}
        onConfirm={confirmOrderReconciliation}
      />

      <SupplierInvoiceOcrCamera
        open={ocrCameraOpen}
        onClose={closeOcrCamera}
        onRecognized={applyOcrResult}
        onUsePhone={openMobileCaptureFromOcr}
      />

      <SupplierInvoiceMobileCapturePanel
        open={mobileCaptureOpen}
        session={session}
        onClose={closeMobileCapture}
        onRecognized={applyOcrResult}
      />

      <SupplierInvoiceDialog
        open={supplierPickerOpen}
        title="Elige el suplidor para continuar"
        description="Los productos que preparaste permanecen en esta factura. Elige un suplidor existente o regístralo aquí mismo."
        layer="overlay"
        size="md"
        onClose={() => {
          setSupplierPickerOpen(false);
          setPendingProductItemKey(null);
        }}
      >
        <div className="space-y-4">
          {ocrResult?.supplierName || ocrResult?.supplierDocument ? (
            <p className="rounded-lg border bg-muted/30 p-3 text-sm">
              Leído en la factura: <strong>{ocrResult.supplierName ?? 'Nombre pendiente'}</strong> ·
              RNC {ocrResult.supplierDocument ?? 'pendiente'}
            </p>
          ) : null}
          <FormField label="Suplidor existente">
            <select
              className={selectClassName}
              value=""
              onChange={(event) => {
                if (event.target.value) selectInvoiceSupplier(event.target.value);
              }}
            >
              <option value="">Selecciona el suplidor de esta factura...</option>
              {activeSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.commercialName} · {supplier.documentNumber}
                </option>
              ))}
            </select>
          </FormField>
          {canCreateSupplier ? (
            <Button
              type="button"
              onClick={() => {
                setSupplierPickerOpen(false);
                setQuickSupplierOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> Registrar nuevo suplidor
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              Un administrador o contador puede registrar el suplidor si aún no existe.
            </p>
          )}
        </div>
      </SupplierInvoiceDialog>

      <SupplierInvoiceDialog
        open={detachOrderOpen}
        title="Capturar la factura sin esta orden de compra"
        description="Podrás seleccionar y registrar todos los productos leídos de la factura."
        layer="overlay"
        size="md"
        onClose={() => setDetachOrderOpen(false)}
      >
        <div className="space-y-4 text-sm">
          <p>
            Se reemplazarán las {items.length} líneas actuales por las {ocrProductMatches.length}{' '}
            líneas leídas. Revisa los datos OCR antes de guardar. El suplidor y los datos del
            documento se conservan; la orden de compra seguirá disponible y sin facturar.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDetachOrderOpen(false)}>
              Conservar la orden
            </Button>
            <Button
              type="button"
              disabled={!ocrProductMatches.length}
              onClick={() => {
                loadedPurchaseOrderRef.current = '';
                setPurchaseOrderId('');
                setOcrUnconfirmedOrderItemIds([]);
                setItems(
                  ocrProductMatches.map(({ item, product, highConfidence }, index) =>
                    createOcrInvoiceItem(
                      item,
                      crypto.randomUUID(),
                      `${ocrBatchKey}:${index}`,
                      highConfidence ? product : undefined,
                    ),
                  ),
                );
                setDetachOrderOpen(false);
                scrollToInvoiceProducts();
              }}
            >
              Usar los productos de la factura
            </Button>
          </div>
        </div>
      </SupplierInvoiceDialog>

      <SupplierInvoiceDialog
        open={applyOrderOcrOpen}
        title="Aplicar importes OCR a la orden"
        description="Se actualizarán cantidad, costo e ITBIS solo donde exista una coincidencia segura."
        layer="overlay"
        size="md"
        onClose={() => setApplyOrderOcrOpen(false)}
      >
        <div className="space-y-4 text-sm">
          <p>
            Los valores revisados de esas líneas serán sustituidos por los de la lectura. Las líneas
            sin coincidencia permanecerán señaladas para revisión y los productos ajenos a la orden
            no se agregarán.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setApplyOrderOcrOpen(false)}>
              Volver
            </Button>
            <Button
              type="button"
              onClick={() => {
                setApplyOrderOcrOpen(false);
                applyOcrProductSuggestions();
              }}
            >
              Aplicar y revisar diferencias
            </Button>
          </div>
        </div>
      </SupplierInvoiceDialog>

      {canCreateSupplier ? (
        <SupplierQuickCreateDialog
          open={quickSupplierOpen}
          onOpenChange={setQuickSupplierOpen}
          session={session}
          existingSuppliers={suppliersQuery.data ?? []}
          prefill={
            ocrResult
              ? {
                  commercialName: ocrResult.supplierName,
                  documentNumber: ocrResult.supplierDocument,
                  documentType: inferSupplierDocumentType(ocrResult.supplierDocument),
                  paymentTerms: ocrResult.paymentCondition,
                }
              : undefined
          }
          onCreated={(supplier) => {
            selectInvoiceSupplier(supplier.id);
            toast.success(`${supplier.commercialName} quedó seleccionado para esta factura.`);
          }}
          onExistingSupplier={(supplier) => {
            if (supplier.status !== 'ACTIVE') {
              toast.error(
                'Este suplidor existe, pero está inactivo. Reactívalo desde Suplidores antes de usarlo.',
              );
              return;
            }
            selectInvoiceSupplier(supplier.id);
            toast.success(`${supplier.commercialName} ya existía y fue seleccionado.`);
          }}
        />
      ) : null}

      {admin ? (
        <QuickProductCreateDialog
          open={Boolean(quickProductItem)}
          onOpenChange={(open) => {
            if (!open) setQuickProductItemKey(null);
          }}
          session={session}
          existingProducts={productsQuery.data ?? []}
          supplierId={supplierId || undefined}
          supplierName={selectedSupplierQuery.data?.commercialName}
          prefill={
            quickProductItem
              ? {
                  name: quickProductItem.ocrItem?.description,
                  supplierSku: quickProductItem.ocrItem?.code,
                  costNet: toOptionalNonNegativeNumber(quickProductItem.unitCostNet),
                  taxRate: quickProductItem.taxPercent.trim()
                    ? Number(quickProductItem.taxPercent) / 100
                    : undefined,
                  unit: invoiceUnitToProductUnit(quickProductItem.ocrItem?.unit),
                  invoiceUnit: quickProductItem.ocrItem?.unit,
                  invoiceQuantity: quickProductItem.quantity.trim()
                    ? Number(quickProductItem.quantity)
                    : undefined,
                }
              : undefined
          }
          onCreated={applyQuickCreatedProduct}
          onSelectExisting={useExistingProductFromQuickCreate}
        />
      ) : null}

      <CancelReasonModal
        open={Boolean(invoiceActionDialog)}
        title={
          invoiceActionDialog?.action === 'cancel-payment'
            ? 'Anular pago al suplidor'
            : 'Cancelar factura de suplidor'
        }
        description={
          invoiceActionDialog?.action === 'cancel-payment'
            ? `Pago ${invoiceActionDialog.payment.paymentNumber} · ${formatCurrency(Number(invoiceActionDialog.payment.amount))} de la factura ${invoiceActionDialog.invoiceNumber}.`
            : invoiceActionDialog?.action === 'cancel-invoice'
              ? `Factura ${invoiceActionDialog.invoice.invoiceNumber} · ${invoiceActionDialog.invoice.supplierNameSnapshot}.`
              : ''
        }
        reason={invoiceActionReason}
        confirmLabel={
          invoiceActionDialog?.action === 'cancel-payment' ? 'Anular pago' : 'Cancelar factura'
        }
        inputLabel="Motivo de la anulación"
        placeholder="Explica el motivo para que quede auditado."
        hint="La operación quedará registrada en el historial y no se puede continuar sin este motivo."
        tone="danger"
        isPending={
          invoiceActionDialog?.action === 'cancel-payment'
            ? cancelPaymentMutation.isPending
            : cancelInvoiceMutation.isPending
        }
        onReasonChange={setInvoiceActionReason}
        onClose={closeInvoiceActionDialog}
        onConfirm={confirmInvoiceAction}
      />
    </div>
  );
}

function CaptureMethodChoice({ onManual, onOcr }: { onManual: () => void; onOcr: () => void }) {
  return (
    <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-2">
      <button
        type="button"
        onClick={onOcr}
        className="group rounded-2xl border border-accent/30 bg-gradient-to-br from-accent/[0.10] via-card to-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-sm">
          <Camera className="h-5 w-5" />
        </span>
        <span className="mt-5 block text-base font-semibold">Capturar con OCR</span>
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">
          Toma una foto con esta cámara o continúa con tu teléfono mediante un QR. La imagen se
          procesa localmente y no se guarda.
        </span>
        <span className="mt-4 inline-flex text-sm font-semibold text-accent transition-transform group-hover:translate-x-0.5">
          Usar captura OCR
        </span>
      </button>

      <button
        type="button"
        onClick={onManual}
        className="group rounded-2xl border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Pencil className="h-5 w-5" />
        </span>
        <span className="mt-5 block text-base font-semibold">Introducir datos manualmente</span>
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">
          Digita productos, cantidades, costos e impuestos tal como aparecen en la factura del
          suplidor.
        </span>
        <span className="mt-4 inline-flex text-sm font-semibold text-primary transition-transform group-hover:translate-x-0.5">
          Introducir factura
        </span>
      </button>
    </div>
  );
}

function calculateTotals(items: EditableInvoiceItem[]) {
  return items.reduce(
    (sum, item) => {
      const gross = roundCurrency(Number(item.quantity || 0) * Number(item.unitCostNet || 0));
      const discount = Math.min(roundCurrency(Number(item.discountTotal || 0)), gross);
      const subtotal = roundCurrency(gross - discount);
      const tax = roundCurrency(subtotal * (Number(item.taxPercent || 0) / 100));
      return {
        subtotal: roundCurrency(sum.subtotal + subtotal),
        discount: roundCurrency(sum.discount + discount),
        tax: roundCurrency(sum.tax + tax),
        total: roundCurrency(sum.total + subtotal + tax),
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

function PaymentAmountSummary({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={emphasis ? 'mt-1 text-lg font-semibold text-success' : 'mt-1 font-semibold'}>
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

function OcrDetected({
  label,
  value,
  confidence,
}: {
  label: string;
  value: string;
  confidence?: 'high' | 'medium' | 'low';
}) {
  return (
    <div className="rounded-md border bg-card/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {confidence ? (
          <span
            className={
              confidence === 'high'
                ? 'text-[10px] font-semibold uppercase tracking-wide text-success'
                : confidence === 'medium'
                  ? 'text-[10px] font-semibold uppercase tracking-wide text-warning'
                  : 'text-[10px] font-semibold uppercase tracking-wide text-danger'
            }
          >
            {confidence === 'high' ? 'Alta' : confidence === 'medium' ? 'Media' : 'Baja'}
          </span>
        ) : null}
      </div>
      <p className="mt-1 truncate font-medium">{value}</p>
    </div>
  );
}

function todayInput() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function toDateInput(value?: string | null) {
  return value ? new Date(value).toISOString().slice(0, 10) : '';
}

function normalizeDocument(value: string) {
  return value.replace(/\D/g, '');
}

function inferSupplierDocumentType(value?: string): 'RNC' | 'CEDULA' {
  return normalizeDocument(value ?? '').length === 11 ? 'CEDULA' : 'RNC';
}

function findMatchingSupplier(result: SupplierInvoiceOcrResult, suppliers: Supplier[]) {
  if (result.supplierDocument) {
    const byDocument = suppliers.find(
      (supplier) =>
        normalizeDocument(supplier.documentNumber) === normalizeDocument(result.supplierDocument!),
    );
    return byDocument;
  }

  const detectedName = normalizeCatalogText(result.supplierName ?? '');
  if (detectedName.length < 5) return undefined;
  const matchingByName = suppliers.filter((supplier) =>
    [supplier.commercialName, supplier.legalName]
      .filter((name): name is string => Boolean(name))
      .map(normalizeCatalogText)
      .some(
        (name) =>
          name === detectedName ||
          (Math.min(name.length, detectedName.length) >= 7 &&
            (name.includes(detectedName) || detectedName.includes(name))),
      ),
  );
  return matchingByName.length === 1 ? matchingByName[0] : undefined;
}

/**
 * Una orden puede tener el mismo producto en más de una línea. La lectura no
 * se agrupa por productId: primero intenta el código guardado en cada línea de
 * la orden y, si no lo distingue, asigna cada aparición OCR a la siguiente
 * línea todavía disponible. Así conservamos la trazabilidad de cada
 * purchaseOrderItemId y no alteramos todas las líneas repetidas a la vez.
 */
function findPurchaseOrderLineForOcrItem(
  item: SupplierInvoiceOcrItem,
  candidateLines: EditableInvoiceItem[],
  orderItemById: Map<string, PurchaseOrder['items'][number]>,
  suggestions: Map<string, PurchaseOrderOcrSuggestion>,
  ocrOccurrenceCount: number,
) {
  const orderLines = candidateLines.filter(
    (line): line is EditableInvoiceItem & { purchaseOrderItemId: string } =>
      Boolean(line.purchaseOrderItemId),
  );
  const code = item.code?.trim();

  if (code) {
    const rankedByCode = orderLines
      .map((line) => {
        const orderItem = orderItemById.get(line.purchaseOrderItemId);
        const score = orderItem
          ? Math.max(
              catalogCodeMatchScore(code, orderItem.supplierSkuSnapshot),
              catalogCodeMatchScore(code, orderItem.skuSnapshot),
              catalogCodeMatchScore(code, orderItem.barcodeSnapshot),
            )
          : 0;
        return { line, score };
      })
      // Una línea de una OC no puede cambiarse por un prefijo OCR. Solo un
      // código normalizado idéntico identifica con seguridad la ocurrencia
      // correcta cuando el mismo producto aparece más de una vez.
      .filter((entry) => entry.score === 100);
    const bestScore = Math.max(0, ...rankedByCode.map((entry) => entry.score));

    if (bestScore) {
      const matchingLines = rankedByCode
        .filter((entry) => entry.score === bestScore)
        .map((entry) => entry.line);
      const nextUnassigned = matchingLines.find(
        (line) => !suggestions.has(line.purchaseOrderItemId),
      );
      if (matchingLines.length === 1) {
        return nextUnassigned ?? matchingLines[0];
      }
      // Códigos idénticos entre líneas repetidas no bastan por sí solos para
      // distinguirlas. Solo usamos el orden de aparición si el OCR leyó la
      // misma cantidad de apariciones del producto que la orden contiene.
      if (ocrOccurrenceCount === orderLines.length && nextUnassigned) {
        return nextUnassigned;
      }
    }
  }

  const nextUnassigned = orderLines.find((line) => !suggestions.has(line.purchaseOrderItemId));
  if (orderLines.length === 1) return nextUnassigned ?? orderLines[0];
  if (ocrOccurrenceCount === orderLines.length && nextUnassigned) return nextUnassigned;

  // Con líneas repetidas y sin una coincidencia por código u ocurrencia
  // completa, no es seguro decidir cuál línea de orden debe alterarse.
  return undefined;
}

function getOcrProductMatchBadge(
  source?: OcrProductMatchSource,
  isPrimarySupplierProduct?: boolean,
) {
  switch (source) {
    case 'SUPPLIER_SKU':
      return isPrimarySupplierProduct ? 'Código suplidor · principal' : 'Código suplidor';
    case 'SUPPLIER_PRIMARY':
      return 'Principal del suplidor';
    case 'SUPPLIER_PRODUCT':
      return 'Vinculado';
    case 'CATALOG_CODE':
      return 'Código catálogo';
    default:
      return 'Coincidencia';
  }
}

function getOcrProductMatchDescription(
  source?: OcrProductMatchSource,
  isPrimarySupplierProduct?: boolean,
) {
  switch (source) {
    case 'SUPPLIER_SKU':
      return isPrimarySupplierProduct
        ? 'Reconocido por el código del producto marcado como principal para este suplidor.'
        : 'Reconocido por el código registrado para este suplidor.';
    case 'SUPPLIER_PRIMARY':
      return 'Coincidencia con el producto marcado como principal para este suplidor.';
    case 'SUPPLIER_PRODUCT':
      return 'Coincidencia con un producto vinculado a este suplidor.';
    case 'CATALOG_CODE':
      return 'Reconocido por un código exacto del catálogo.';
    case 'CATALOG_DESCRIPTION':
      return 'Coincidencia por descripcion del catalogo.';
    default:
      return 'Coincidencia pendiente de revision.';
  }
}

function normalizeCatalogText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCatalogCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeSupplierSkuKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function isDuplicateSupplierSkuError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = normalizeSupplierSkuKey(error.message);
  return message.includes('CODIGODESUPLIDOR') && message.includes('VINCULADOALPRODUCTO');
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundUnitCost(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function numbersMatch(left: string | number, right: string | number, tolerance: number) {
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function toPositiveCurrencyAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function toOptionalNonNegativeNumber(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

async function invalidateInvoices(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['supplier-invoices'] }),
    queryClient.invalidateQueries({ queryKey: ['supplier-invoice'] }),
    queryClient.invalidateQueries({ queryKey: ['payables'] }),
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] }),
  ]);
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : 'No se pudo completar la operación.');
}
