'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  ClipboardCheck,
  DoorClosed,
  DoorOpen,
  Search,
  ShieldCheck,
  Store,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  closeCashSession,
  completePosSale,
  claimSalesOrder,
  getCashRegisters,
  getCashSessions,
  getCurrentCashSession,
  getCustomers,
  getPosProductByBarcode,
  getSalesOrders,
  openCashSession,
  releaseSalesOrder,
  searchPosProducts,
  type Customer,
  type LocalNcfDocumentType,
  type PosPaymentMethod,
  type Product,
  type SalesOrder,
} from '@/lib/api';
import { validateDominicanDocument } from '@/lib/dominican-documents';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { isAdminSession } from '@/lib/authorization';
import { getOrderClientLabel, getOrderSearchLabel } from '@/lib/order-client';
import { getStatusVariant, translateStatus } from '@/lib/display-labels';
import { ModuleHeader } from './module-header';
import { BarcodeInput } from './pos/barcode-input';
import {
  clearCurrencyInput,
  formatCurrencyInput,
  formatCurrencyInputFromNumber,
  parseCurrencyInput,
  sanitizeCurrencyInput,
} from './pos/currency-input';
import { PosCart } from './pos/pos-cart';
import { PosPaymentPanel } from './pos/pos-payment-panel';
import { PosProductGrid } from './pos/pos-product-grid';
import {
  canAddProduct,
  getAvailableStock,
  getDefaultQuantity,
  getProductPrice,
  getQuantityStep,
  roundQuantity,
  uniqueValues,
} from './pos/pos-utils';
import { playScanFeedback } from './pos/scan-feedback';
import type { CartItem } from './pos/types';
import { SessionRequired, useCurrentSession } from './session-required';
import { WarningConfirmModal } from './warning-confirm-modal';

type BarcodeDetectorResult = { rawValue: string };
type BarcodeDetectorInstance = {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;
type WindowWithBarcodeDetector = Window &
  typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor };

function hasValidFiscalCreditIdentity(customer?: Customer) {
  if (
    !customer?.documentNumber ||
    (customer.documentType !== 'RNC' && customer.documentType !== 'CEDULA')
  ) {
    return false;
  }

  return validateDominicanDocument(customer.documentType, customer.documentNumber);
}

function hasReportableConsumerIdentity(customer?: Customer) {
  if (!customer?.documentNumber) {
    return false;
  }

  if (customer.documentType === 'RNC' || customer.documentType === 'CEDULA') {
    return validateDominicanDocument(customer.documentType, customer.documentNumber);
  }

  return customer.documentType === 'PASSPORT';
}

export function PosView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);

  const [customerId, setCustomerId] = useState('');
  const [documentType, setDocumentType] = useState<LocalNcfDocumentType>('CONSUMER_02');
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('CASH');
  const [amountReceived, setAmountReceived] = useState(clearCurrencyInput());
  const [barcode, setBarcode] = useState('');
  const [scannerEnabled, setScannerEnabled] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const [lastScannedProduct, setLastScannedProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [brandFilter, setBrandFilter] = useState('ALL');
  const [selectedRegisterId, setSelectedRegisterId] = useState('');
  const [openingAmount, setOpeningAmount] = useState(clearCurrencyInput());
  const [closingAmount, setClosingAmount] = useState(clearCurrencyInput());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loadedOrder, setLoadedOrder] = useState<SalesOrder | null>(null);
  const [zeroClosingWarningOpen, setZeroClosingWarningOpen] = useState(false);

  const customersQuery = useQuery({
    queryKey: ['pos-customers', session?.tenantId],
    queryFn: () => getCustomers(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const registersQuery = useQuery({
    queryKey: ['cash-registers', session?.tenantId],
    queryFn: () => getCashRegisters(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const currentSessionQuery = useQuery({
    queryKey: ['cash-session-current', session?.tenantId],
    queryFn: () => getCurrentCashSession(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const cashSessionsQuery = useQuery({
    queryKey: ['cash-sessions', session?.tenantId, 'pos'],
    queryFn: () => getCashSessions(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session && isAdminSession(session)),
  });
  const canCreateDirectSale = false;
  const isAdmin = isAdminSession(session);
  const productsQuery = useQuery({
    queryKey: ['pos-products-search', session?.tenantId, search],
    queryFn: () =>
      searchPosProducts(session?.tenantId ?? '', session?.accessToken ?? '', search || 'RIV'),
    enabled: Boolean(session && currentSessionQuery.data && canCreateDirectSale),
  });
  const pendingOrdersQuery = useQuery({
    queryKey: ['sales-orders', session?.tenantId, 'OPEN', 'pos'],
    queryFn: () => getSalesOrders(session?.tenantId ?? '', session?.accessToken ?? '', 'OPEN'),
    enabled: Boolean(session && currentSessionQuery.data),
  });

  const currentCashSession = currentSessionQuery.data;
  const canUsePos =
    session?.permissions.canUsePos ??
    ['ADMIN', 'SUPER_ADMIN', 'QORVEX_SUPER_ADMIN'].includes(session?.role ?? '');
  const canOpenCashSession =
    Boolean(session?.permissions.canOpenCashSession) && !isAdminSession(session);
  const canCloseCashSession =
    session?.permissions.canCloseCashSession ??
    ['ADMIN', 'SUPER_ADMIN', 'QORVEX_SUPER_ADMIN'].includes(session?.role ?? '');
  const cartReadOnly = !canCreateDirectSale && Boolean(loadedOrder);

  useEffect(() => {
    const firstRegister = registersQuery.data?.find((register) => register.status === 'ACTIVE');
    if (!selectedRegisterId && firstRegister) {
      setSelectedRegisterId(firstRegister.id);
    }
  }, [registersQuery.data, selectedRegisterId]);

  useEffect(() => {
    if (currentCashSession && canCreateDirectSale) {
      setScannerEnabled(true);
      window.setTimeout(() => barcodeInputRef.current?.focus(), 0);
    }
  }, [canCreateDirectSale, currentCashSession?.id]);

  useEffect(() => {
    if (scannerEnabled) {
      barcodeInputRef.current?.focus();
    }
  }, [scannerEnabled]);

  const totals = useMemo(() => {
    const subtotal = cart.reduce(
      (sum, item) => sum + (item.subtotal ?? getProductPrice(item.product) * item.quantity),
      0,
    );
    const tax = cart.reduce(
      (sum, item) =>
        sum +
        (item.taxTotal ??
          getProductPrice(item.product) * item.quantity * Number(item.product.taxRate)),
      0,
    );
    const discount = cart.reduce((sum, item) => sum + (item.discountTotal ?? 0), 0);
    const total = subtotal + tax;
    const received = parseCurrencyInput(amountReceived);
    const requiredPayment =
      loadedOrder?.paymentMode === 'CREDIT' ? Number(loadedOrder.initialPaymentAmount ?? 0) : total;

    return {
      subtotal,
      discount,
      tax,
      total,
      requiredPayment,
      remainingBalance: Math.max(total - requiredPayment, 0),
      received,
      change:
        paymentMethod === 'CASH' && received > requiredPayment ? received - requiredPayment : 0,
    };
  }, [amountReceived, cart, loadedOrder, paymentMethod]);

  useEffect(() => {
    if (paymentMethod !== 'CASH' && totals.requiredPayment >= 0) {
      setAmountReceived(formatCurrencyInputFromNumber(totals.requiredPayment));
    }
  }, [paymentMethod, totals.requiredPayment]);

  useEffect(() => () => stopCameraScan(), []);

  const activeCustomers = (customersQuery.data ?? []).filter(
    (customer) => customer.status === 'ACTIVE',
  );
  const selectedCustomer = activeCustomers.find((customer) => customer.id === customerId);
  const fiscalCreditAvailable = hasValidFiscalCreditIdentity(selectedCustomer);
  const customerIdentified = hasReportableConsumerIdentity(selectedCustomer);
  const productPool = productsQuery.data ?? [];
  const categories = uniqueValues(
    productPool
      .map((product) => product.category?.name)
      .filter((value): value is string => Boolean(value)),
  );
  const brands = uniqueValues(
    productPool.map((product) => product.brand).filter((value): value is string => Boolean(value)),
  );
  const filteredProducts = productPool
    .filter((product) => categoryFilter === 'ALL' || product.category?.name === categoryFilter)
    .filter((product) => brandFilter === 'ALL' || product.brand === brandFilter);
  const quantitiesByProduct = Object.fromEntries(
    cart.map((item) => [item.product.id, item.quantity]),
  );
  const canCompleteSale =
    !isAdmin && cart.length > 0 && Boolean(currentCashSession) && Boolean(loadedOrder);
  const selectedOpenSession = (cashSessionsQuery.data ?? []).find(
    (cashSession) =>
      cashSession.status === 'OPEN' && cashSession.cashRegister.id === selectedRegisterId,
  );
  const selectedRegisterOccupied =
    Boolean(selectedOpenSession) && selectedOpenSession?.openedBy?.id !== session?.user.id;

  function handleLoadOrder(order: SalesOrder) {
    if (loadedOrder && loadedOrder.id !== order.id) {
      setMessage('Quita la orden cargada o completala antes de seleccionar otro ticket.');
      toast.info('Primero quita la orden actual para elegir otra.');
      return;
    }

    claimOrderMutation.mutate(order);
  }

  function releaseLoadedOrder() {
    if (!loadedOrder || releaseOrderMutation.isPending || completeSaleMutation.isPending) {
      return;
    }

    releaseOrderMutation.mutate(loadedOrder.id);
  }

  const openSessionMutation = useMutation({
    mutationFn: () => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      const parsedOpeningAmount = parseCurrencyInput(openingAmount);
      if (parsedOpeningAmount <= 0) {
        throw new Error('El monto inicial debe ser mayor que 0.');
      }

      return openCashSession(session.tenantId, session.accessToken, {
        cashRegisterId: selectedRegisterId,
        openingAmount: parsedOpeningAmount,
      });
    },
    onSuccess: async () => {
      setMessage('Caja abierta correctamente.');
      toast.success('Caja abierta correctamente.');
      setAmountReceived(clearCurrencyInput());
      await invalidateCashQueries();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'No se pudo abrir la caja.';
      setMessage(message);
      toast.error(message);
    },
  });

  const closeSessionMutation = useMutation({
    mutationFn: () => {
      if (!session || !currentCashSession) {
        throw new Error('Sesion requerida.');
      }

      return closeCashSession(session.tenantId, session.accessToken, currentCashSession.id, {
        closingAmount: parseCurrencyInput(closingAmount),
        notes: 'Cierre desde caja',
      });
    },
    onSuccess: async () => {
      setMessage('Caja cerrada correctamente.');
      toast.success('Caja cerrada correctamente.');
      setClosingAmount(clearCurrencyInput());
      setCart([]);
      setAmountReceived(clearCurrencyInput());
      await invalidateCashQueries();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'No se pudo cerrar la caja.';
      setMessage(message);
      toast.error(message);
    },
  });

  const barcodeMutation = useMutation({
    mutationFn: (code: string) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }
      return getPosProductByBarcode(session.tenantId, session.accessToken, code);
    },
    onSuccess: (product) => {
      const added = addProduct(product);
      setBarcode('');
      if (added) {
        playScanFeedback('success');
        setLastScannedProduct(product);
        setScannerMessage(`Producto agregado: ${product.name}`);
        toast.success('Producto agregado', { description: product.name });
      } else {
        playScanFeedback('error');
      }
    },
    onError: () => {
      setBarcode('');
      playScanFeedback('error');
      setScannerMessage('Producto no encontrado.');
      toast.error('Producto no encontrado.');
    },
  });

  const completeSaleMutation = useMutation({
    mutationFn: () => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return completePosSale(session.tenantId, session.accessToken, {
        customerId: customerId || undefined,
        documentType,
        paymentMethod,
        cashSessionId: currentCashSession?.id,
        amountReceived: amountReceived ? parseCurrencyInput(amountReceived) : undefined,
        orderId: loadedOrder?.id,
        items: cart.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
      });
    },
    onSuccess: async (invoice) => {
      setMessage(`Factura ${invoice.invoiceNumber} creada correctamente.`);
      setCart([]);
      setLoadedOrder(null);
      setCustomerId('');
      setDocumentType('CONSUMER_02');
      setPaymentMethod('CASH');
      setAmountReceived(clearCurrencyInput());
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      await queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
      await queryClient.invalidateQueries({ queryKey: ['cash-movements'] });
      await queryClient.invalidateQueries({ queryKey: ['employee-logs'] });
      await invalidateCashQueries();
      toast.dismiss();
      router.push(`/invoices/${invoice.id}/print?autoPrint=1`);
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'No se pudo completar la venta.');
      toast.error(error instanceof Error ? error.message : 'No se pudo completar la venta.');
    },
  });

  const claimOrderMutation = useMutation({
    mutationFn: (order: SalesOrder) => {
      if (!session || !currentCashSession) {
        throw new Error('Debes abrir caja antes de tomar una orden.');
      }

      return claimSalesOrder(session.tenantId, session.accessToken, order.id, {
        cashSessionId: currentCashSession.id,
      });
    },
    onSuccess: async (order) => {
      loadClaimedSalesOrder(order);
      await queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success('Orden tomada en caja', { description: order.orderNumber });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo tomar la orden.');
    },
  });

  const releaseOrderMutation = useMutation({
    mutationFn: (orderId: string) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return releaseSalesOrder(session.tenantId, session.accessToken, orderId);
    },
    onSuccess: async (order) => {
      if (loadedOrder?.id === order.id) {
        setLoadedOrder(null);
        setCart([]);
        setCustomerId('');
        setDocumentType('CONSUMER_02');
        setAmountReceived(clearCurrencyInput());
        setMessage(`Orden ${order.orderNumber} quitada. Ya puedes seleccionar otra.`);
      }
      await queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success('Orden liberada', { description: order.orderNumber });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo liberar la orden.');
    },
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  async function invalidateCashQueries() {
    await queryClient.invalidateQueries({ queryKey: ['cash-session-current'] });
    await queryClient.invalidateQueries({ queryKey: ['cash-sessions'] });
    await queryClient.invalidateQueries({ queryKey: ['cash-movements'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
  }

  function addProduct(product: Product) {
    if (!canCreateDirectSale) {
      setMessage('El cajero solo puede cobrar ordenes enviadas a caja.');
      return false;
    }

    const currentQuantity = quantitiesByProduct[product.id] ?? 0;

    unlinkLoadedOrderIfNeeded();

    if (!canAddProduct(product, currentQuantity)) {
      setMessage(`No hay stock disponible para ${product.name}.`);
      return false;
    }

    setMessage(null);
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id);

      if (existing) {
        return current.map((item) =>
          item.product.id === product.id
            ? {
                ...item,
                quantity: roundQuantity(
                  item.product.trackInventory
                    ? Math.min(
                        item.quantity + getQuantityStep(item.product),
                        getAvailableStock(item.product),
                      )
                    : item.quantity + getQuantityStep(item.product),
                ),
              }
            : item,
        );
      }

      return [...current, { product, quantity: getDefaultQuantity(product) }];
    });

    return true;
  }

  function updateQuantity(productId: string, quantity: number) {
    if (!canCreateDirectSale) {
      setMessage('El cajero no puede modificar una orden enviada a caja.');
      return;
    }

    unlinkLoadedOrderIfNeeded();
    setCart((current) =>
      current
        .map((item) => {
          if (item.product.id !== productId) {
            return item;
          }

          if (quantity <= 0) {
            return { ...item, quantity: 0 };
          }

          const availableStock = getAvailableStock(item.product);
          const quantityStep = getQuantityStep(item.product);
          const nextQuantity = item.product.trackInventory
            ? Math.min(Math.max(quantity, quantityStep), availableStock)
            : Math.max(quantity, quantityStep);

          return { ...item, quantity: roundQuantity(nextQuantity) };
        })
        .filter((item) => item.quantity > 0),
    );
  }

  function clearCart() {
    if (loadedOrder) {
      releaseOrderMutation.mutate(loadedOrder.id);
      return;
    }

    setCart([]);
  }

  function requestCloseCashSession() {
    if (parseCurrencyInput(closingAmount) === 0) {
      setZeroClosingWarningOpen(true);
      return;
    }

    closeSessionMutation.mutate();
  }

  function unlinkLoadedOrderIfNeeded() {
    if (loadedOrder) {
      releaseOrderMutation.mutate(loadedOrder.id);
      setLoadedOrder(null);
      setMessage(
        'Orden desvinculada por edicion manual. Esta venta se cobrara como venta directa.',
      );
    }
  }

  function loadClaimedSalesOrder(order: SalesOrder) {
    const items: CartItem[] = [];
    for (const item of order.items) {
      if (!item.product) {
        continue;
      }

      items.push({
        product: item.product,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        discountTotal: Number(item.discountTotal ?? 0),
        reservedQuantity: item.reservedQuantity,
        subtotal: Number(item.subtotal),
        taxTotal: Number(item.taxTotal),
        total: Number(item.total),
      });
    }

    if (items.length !== order.items.length) {
      toast.error('La orden tiene productos no disponibles. Revisa la orden antes de cobrar.');
      return;
    }

    setLoadedOrder(order);
    setCustomerId(order.customerId ?? '');
    setCart(items);
    setMessage(`Orden ${order.orderNumber} cargada para cobrar.`);
  }

  function selectCustomer(value: string) {
    setCustomerId(value);
    const customer = activeCustomers.find((candidate) => candidate.id === value);
    const supportsB01 = hasValidFiscalCreditIdentity(customer);
    if (!supportsB01) {
      setDocumentType('CONSUMER_02');
    }
  }

  function enableScanner() {
    setScannerEnabled(true);
    setScannerMessage(
      'Lector activo. Escanea con pistola USB o usa camara si el navegador lo soporta.',
    );
    window.setTimeout(() => barcodeInputRef.current?.focus(), 0);
  }

  function disableScanner() {
    setScannerEnabled(false);
    setScannerMessage(null);
    stopCameraScan();
  }

  async function startCameraScan() {
    setScannerEnabled(true);
    setScannerMessage(null);

    const detectorConstructor = (window as WindowWithBarcodeDetector).BarcodeDetector;
    if (!detectorConstructor || !navigator.mediaDevices?.getUserMedia) {
      setScannerMessage(
        'Camara QR no disponible en este navegador. Usa el lector USB o escribe el codigo.',
      );
      barcodeInputRef.current?.focus();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);

      if (!videoRef.current) {
        return;
      }

      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const detector = new detectorConstructor({
        formats: ['qr_code', 'code_128', 'ean_13', 'upc_a'],
      });

      const scan = async () => {
        if (!videoRef.current || !streamRef.current) {
          return;
        }

        try {
          const results = await detector.detect(videoRef.current);
          const value = results[0]?.rawValue;
          if (value) {
            setBarcode(value);
            stopCameraScan();
            barcodeMutation.mutate(value);
            return;
          }
        } catch {
          setScannerMessage('No pude leer el codigo todavia. Manten el codigo frente a la camara.');
        }

        scanFrameRef.current = window.requestAnimationFrame(scan);
      };

      scanFrameRef.current = window.requestAnimationFrame(scan);
    } catch {
      setScannerMessage(
        'No se pudo activar la camara. Puedes usar el lector USB o escribir el codigo.',
      );
      barcodeInputRef.current?.focus();
    }
  }

  function stopCameraScan() {
    if (scanFrameRef.current) {
      window.cancelAnimationFrame(scanFrameRef.current);
      scanFrameRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraActive(false);
  }

  return (
    <div className="space-y-5">
      <ModuleHeader
        title="Caja"
        description="Cobro de ordenes enviadas a caja y cierre operativo de Ferreteria RIVNU."
      />

      <CashStatusHeader
        sessionName={session.user.name}
        isOpen={Boolean(currentCashSession)}
        registerName={currentCashSession?.cashRegister.name}
        openedAt={currentCashSession?.openedAt}
        openingAmount={currentCashSession?.openingAmount}
      />

      {!canUsePos ? (
        <Card>
          <CardHeader>
            <CardTitle>Caja bloqueada</CardTitle>
            <CardDescription>Tu usuario no tiene permiso para operar esta caja.</CardDescription>
          </CardHeader>
        </Card>
      ) : !currentCashSession ? (
        <ClosedCashPanel
          registers={registersQuery.data ?? []}
          selectedRegisterId={selectedRegisterId}
          openingAmount={openingAmount}
          canOpenCashSession={canOpenCashSession}
          isOpening={openSessionMutation.isPending}
          message={message}
          occupiedBy={
            selectedRegisterOccupied ? (selectedOpenSession?.openedBy?.name ?? 'otro cajero') : null
          }
          onRegisterChange={setSelectedRegisterId}
          onOpeningAmountChange={setOpeningAmount}
          onOpen={() => openSessionMutation.mutate()}
        />
      ) : (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(24rem,0.8fr)] xl:items-start">
          <div className="space-y-4">
            <SalesOrdersQueuePanel
              orders={pendingOrdersQuery.data ?? []}
              loading={pendingOrdersQuery.isLoading}
              loadedOrder={loadedOrder}
              loadedOrderId={loadedOrder?.id}
              currentUserId={session.user.id}
              claimingId={claimOrderMutation.variables?.id}
              isReleasing={releaseOrderMutation.isPending}
              canChargeOrders={!isAdmin}
              onLoad={handleLoadOrder}
              onReleaseLoaded={releaseLoadedOrder}
            />
            {isAdmin ? (
              <Card className="border-zinc-200 bg-zinc-50">
                <CardHeader>
                  <CardTitle>Cobro solo por cajero</CardTitle>
                  <CardDescription>
                    El administrador no cobra desde caja. Los tickets pendientes deben ser cobrados
                    por un cajero con sesion abierta.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : null}
          </div>

          <div className="space-y-3 xl:sticky xl:top-24">
            {loadedOrder ? (
              <div className="flex flex-col gap-2 rounded-md border border-[#f36c10]/30 bg-[#f36c10]/10 px-3 py-2 text-sm text-[#9a3f05]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    Cobrando ticket pendiente {loadedOrder.orderNumber}. La factura se emitira al
                    completar el cobro.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-[#f36c10]/40 bg-white text-[#9a3f05] hover:bg-[#f36c10]/10 shrink-0"
                    onClick={releaseLoadedOrder}
                    disabled={releaseOrderMutation.isPending || completeSaleMutation.isPending}
                  >
                    <X className="h-4 w-4" />
                    Quitar y elegir otra
                  </Button>
                </div>
                {loadedOrder.notes ? (
                  <div className="mt-1 border-t border-[#f36c10]/20 pt-1 text-xs text-[#9a3f05]">
                    <span className="font-semibold">Nota:</span> {loadedOrder.notes}
                  </div>
                ) : null}
                {loadedOrder.paymentMode === 'CREDIT' ? (
                  <div className="border-t border-[#f36c10]/20 pt-2 text-xs">
                    Venta fiada aprobada · Inicial{' '}
                    <strong>{formatCurrency(Number(loadedOrder.initialPaymentAmount))}</strong> ·
                    Saldo{' '}
                    <strong>
                      {formatCurrency(
                        Number(loadedOrder.total) - Number(loadedOrder.initialPaymentAmount),
                      )}
                    </strong>
                  </div>
                ) : null}
              </div>
            ) : null}
            <PosCart
              items={cart}
              onUpdateQuantity={updateQuantity}
              onClear={clearCart}
              readOnly={cartReadOnly}
              emptyMessage="Carga una orden pendiente desde la lista para poder cobrarla."
            />
            {!isAdmin ? (
              <PosPaymentPanel
                customers={activeCustomers}
                customerId={customerId}
                documentType={documentType}
                fiscalCreditAvailable={fiscalCreditAvailable}
                customerIdentified={customerIdentified}
                paymentMethod={paymentMethod}
                salePaymentMode={loadedOrder?.paymentMode ?? 'CASH'}
                dueDate={loadedOrder?.dueDate}
                customerLocked={Boolean(loadedOrder?.customerId)}
                amountReceived={amountReceived}
                totals={totals}
                message={message}
                canCompleteSale={canCompleteSale}
                isCompleting={completeSaleMutation.isPending}
                onCustomerChange={selectCustomer}
                onDocumentTypeChange={setDocumentType}
                onPaymentMethodChange={setPaymentMethod}
                onAmountReceivedChange={setAmountReceived}
                onCompleteSale={() => completeSaleMutation.mutate()}
              />
            ) : null}

            <CloseCashPanel
              canCloseCashSession={canCloseCashSession}
              cartHasItems={cart.length > 0}
              closingAmount={closingAmount}
              isClosing={closeSessionMutation.isPending}
              onClosingAmountChange={setClosingAmount}
              onClose={(event) => {
                event.preventDefault();
                requestCloseCashSession();
              }}
            />
          </div>
        </section>
      )}

      <WarningConfirmModal
        open={zeroClosingWarningOpen}
        title="Cerrar caja con RD$0.00"
        description="El monto contado esta en cero. Confirma solo si realmente la caja fisica no tiene efectivo al cierre."
        confirmLabel="Cerrar en RD$0.00"
        isPending={closeSessionMutation.isPending}
        onClose={() => setZeroClosingWarningOpen(false)}
        onConfirm={() => {
          setZeroClosingWarningOpen(false);
          closeSessionMutation.mutate();
        }}
      />
    </div>
  );
}

function SalesOrdersQueuePanel({
  orders,
  loading,
  loadedOrder,
  loadedOrderId,
  currentUserId,
  claimingId,
  isReleasing,
  canChargeOrders,
  onLoad,
  onReleaseLoaded,
}: {
  orders: SalesOrder[];
  loading: boolean;
  loadedOrder: SalesOrder | null;
  loadedOrderId?: string;
  currentUserId: string;
  claimingId?: string;
  isReleasing: boolean;
  canChargeOrders: boolean;
  onLoad: (order: SalesOrder) => void;
  onReleaseLoaded: () => void;
}) {
  const [queueSearch, setQueueSearch] = useState('');
  const normalizedSearch = queueSearch.trim().toLowerCase();
  const visibleOrders = normalizedSearch
    ? orders.filter((order) =>
        [
          order.orderNumber,
          order.clientName,
          getOrderClientLabel(order),
          getOrderSearchLabel(order),
          order.customer?.name,
          order.createdBy.name,
          order.claimedBy?.name,
          order.invoice?.invoiceNumber,
          String(order.total),
          formatCurrency(Number(order.total)),
          `${getWaitingMinutes(order)} min`,
          `${getWaitingMinutes(order)} minutos`,
          translateStatus(order.status),
        ]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedSearch)),
      )
    : orders;

  return (
    <Card className="border-zinc-200">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Solicitudes y tickets pendientes</CardTitle>
            <CardDescription>
              Las ventas fiadas solo se pueden cobrar después de la aprobación administrativa.
            </CardDescription>
          </div>
          <Badge variant={orders.length ? 'warning' : 'outline'}>
            {orders.length} pendiente(s)
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {loadedOrder ? (
          <div className="mb-3 rounded-md border border-[#f36c10]/30 bg-[#f36c10]/10 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#9a3f05]">
                  Ticket cargado: {loadedOrder.orderNumber}
                </p>
                <p className="mt-1 text-xs text-[#9a3f05]">
                  {getOrderSearchLabel(loadedOrder)} - {formatCurrency(Number(loadedOrder.total))}
                </p>
                {loadedOrder.notes ? (
                  <p className="mt-2 text-xs text-[#9a3f05] bg-white/50 border border-[#f36c10]/20 rounded px-1.5 py-0.5 inline-block font-medium">
                    Nota: {loadedOrder.notes}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-[#f36c10]/40 bg-white text-[#9a3f05] hover:bg-[#f36c10]/10"
                onClick={onReleaseLoaded}
                disabled={isReleasing}
              >
                <X className="h-4 w-4" />
                Quitar y elegir otra
              </Button>
            </div>
            <p className="mt-2 text-xs text-[#9a3f05]">
              Quita este ticket si no corresponde para poder seleccionar otro de la lista.
            </p>
          </div>
        ) : null}
        <div className="mb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={queueSearch}
              onChange={(event) => setQueueSearch(event.target.value)}
              className="bg-white pl-9"
              placeholder="Buscar por cliente, ticket, orden o monto"
            />
          </div>
        </div>
        {loading ? (
          <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-muted-foreground">
            Cargando ordenes...
          </p>
        ) : visibleOrders.length ? (
          <div className="grid gap-2 lg:grid-cols-2">
            {visibleOrders.map((order) => (
              <div key={order.id} className={getWaitingCardClass(order)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-zinc-950">{getOrderClientLabel(order)}</p>
                      <Badge variant={getStatusVariant(order.status)}>
                        {translateStatus(order.status)}
                      </Badge>
                      {order.paymentMode === 'CREDIT' ? (
                        <Badge variant="outline">
                          {order.creditApproval?.status === 'APPROVED'
                            ? 'Crédito aprobado'
                            : 'Crédito pendiente'}
                        </Badge>
                      ) : null}
                      {order.sentToCashierAt ? (
                        <Badge variant={getWaitingVariant(order)}>
                          {getWaitingMinutes(order)} min
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {getOrderSearchLabel(order)} -{' '}
                      {formatDateTime(order.sentToCashierAt ?? order.createdAt)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Cliente: {getOrderClientLabel(order)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Creada por {order.createdBy.name}
                    </p>
                    {order.notes ? (
                      <p className="mt-1 text-xs text-zinc-600 bg-amber-50 rounded-sm px-1.5 py-0.5 border border-amber-200 inline-block font-medium">
                        Nota: {order.notes}
                      </p>
                    ) : null}
                    {order.claimedBy ? (
                      <p className="mt-1 text-xs text-warning">
                        Tomada por {order.claimedBy.name}
                        {order.claimedCashSession?.cashRegister.name
                          ? ` en ${order.claimedCashSession.cashRegister.name}`
                          : ''}
                      </p>
                    ) : null}
                    {order.paymentMode === 'CREDIT' ? (
                      <p className="mt-1 text-xs text-sky-800">
                        Inicial {formatCurrency(Number(order.initialPaymentAmount))} · Saldo{' '}
                        {formatCurrency(
                          Number(order.total) - Number(order.initialPaymentAmount ?? 0),
                        )}
                      </p>
                    ) : null}
                  </div>
                  <p className="shrink-0 text-sm font-bold">
                    {formatCurrency(Number(order.total))}
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">
                    {order.items.length} producto(s)
                  </span>
                  {canChargeOrders ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onLoad(order)}
                      disabled={
                        loadedOrderId === order.id ||
                        claimingId === order.id ||
                        (Boolean(loadedOrderId) && loadedOrderId !== order.id) ||
                        order.status === 'CREATED' ||
                        (order.status === 'IN_CASHIER' && order.claimedBy?.id !== currentUserId)
                      }
                    >
                      <ClipboardCheck className="h-4 w-4" />
                      {loadedOrderId === order.id
                        ? 'Cargada'
                        : order.status === 'CREATED'
                          ? 'Esperando aprobación'
                          : order.status === 'IN_CASHIER'
                            ? 'Tomada'
                            : 'Cobrar'}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Solo cajero</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center">
            <ClipboardCheck className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              {orders.length
                ? 'No hay tickets que coincidan con la busqueda.'
                : 'No hay tickets pendientes de cobro.'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CashStatusHeader({
  sessionName,
  isOpen,
  registerName,
  openedAt,
  openingAmount,
}: {
  sessionName: string;
  isOpen: boolean;
  registerName?: string;
  openedAt?: string;
  openingAmount?: string | number | null;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm lg:grid-cols-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[#f36c10]/10 text-[#f36c10]">
          <Store className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Estado</p>
          <p className="font-semibold">{isOpen ? 'Caja abierta' : 'Caja cerrada'}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-zinc-500" />
        <div>
          <p className="text-xs text-muted-foreground">Cajero</p>
          <p className="font-semibold">{sessionName}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <CalendarClock className="h-5 w-5 text-zinc-500" />
        <div>
          <p className="text-xs text-muted-foreground">Apertura</p>
          <p className="font-semibold">{openedAt ? formatDateTime(openedAt) : 'Pendiente'}</p>
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Caja / monto inicial</p>
        <p className="font-semibold">
          {registerName ?? 'Sin caja'} - {formatCurrency(Number(openingAmount ?? 0))}
        </p>
      </div>
    </div>
  );
}

function ClosedCashPanel({
  registers,
  selectedRegisterId,
  openingAmount,
  canOpenCashSession,
  isOpening,
  message,
  occupiedBy,
  onRegisterChange,
  onOpeningAmountChange,
  onOpen,
}: {
  registers: Array<{ id: string; name: string; status: string }>;
  selectedRegisterId: string;
  openingAmount: string;
  canOpenCashSession: boolean;
  isOpening: boolean;
  message: string | null;
  occupiedBy: string | null;
  onRegisterChange: (value: string) => void;
  onOpeningAmountChange: (value: string) => void;
  onOpen: () => void;
}) {
  return (
    <Card className="overflow-hidden border-zinc-200">
      <div className="grid lg:grid-cols-[0.85fr_1.15fr]">
        <div className="bg-zinc-950 p-6 text-white">
          <Badge variant="warning">Caja cerrada</Badge>
          <h2 className="mt-4 text-2xl font-bold">
            Para iniciar ventas debes abrir una sesion de caja.
          </h2>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Declara el fondo inicial, selecciona la caja fisica y el sistema registrara la apertura,
            el movimiento de caja y la actividad del empleado.
          </p>
        </div>
        <CardContent className="p-6">
          <form
            className="grid gap-4 md:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              onOpen();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="cashRegister">Caja</Label>
              <select
                id="cashRegister"
                value={selectedRegisterId}
                onChange={(event) => onRegisterChange(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                required
              >
                {registers.map((register) => (
                  <option key={register.id} value={register.id}>
                    {register.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="openingAmount">
                Monto inicial <span className="text-danger">*</span>
              </Label>
              <Input
                id="openingAmount"
                type="text"
                inputMode="decimal"
                value={openingAmount}
                onChange={(event) =>
                  onOpeningAmountChange(sanitizeCurrencyInput(event.target.value))
                }
                onBlur={(event) => onOpeningAmountChange(formatCurrencyInput(event.target.value))}
                onFocus={(event) => event.currentTarget.select()}
                required
              />
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                disabled={
                  !selectedRegisterId ||
                  isOpening ||
                  !canOpenCashSession ||
                  Boolean(occupiedBy) ||
                  parseCurrencyInput(openingAmount) <= 0
                }
              >
                <DoorOpen className="h-4 w-4" />
                Abrir caja
              </Button>
            </div>
          </form>
          {!canOpenCashSession ? (
            <p className="mt-3 text-sm text-danger">Tu usuario no tiene permiso para abrir caja.</p>
          ) : null}
          {occupiedBy ? (
            <p className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
              Esta caja ya esta abierta por {occupiedBy}. Cierra esa sesion o selecciona otra caja.
            </p>
          ) : null}
          {message ? <p className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </div>
    </Card>
  );
}

function CloseCashPanel({
  canCloseCashSession,
  cartHasItems,
  closingAmount,
  isClosing,
  onClosingAmountChange,
  onClose,
}: {
  canCloseCashSession: boolean;
  cartHasItems: boolean;
  closingAmount: string;
  isClosing: boolean;
  onClosingAmountChange: (value: string) => void;
  onClose: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm" onSubmit={onClose}>
      <Label htmlFor="closingAmount">Cierre de caja</Label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id="closingAmount"
          type="text"
          inputMode="decimal"
          value={closingAmount}
          onChange={(event) => onClosingAmountChange(sanitizeCurrencyInput(event.target.value))}
          onBlur={(event) => onClosingAmountChange(formatCurrencyInput(event.target.value))}
          onFocus={(event) => event.currentTarget.select()}
          placeholder="Monto contado"
          required
        />
        <Button
          type="submit"
          variant="outline"
          disabled={!canCloseCashSession || isClosing || cartHasItems}
        >
          <DoorClosed className="h-4 w-4" />
          Cerrar
        </Button>
      </div>
      {cartHasItems ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Limpia o factura el carrito antes de cerrar.
        </p>
      ) : null}
      {!canCloseCashSession ? (
        <p className="mt-2 text-xs text-danger">Sin permiso para cerrar caja.</p>
      ) : null}
    </form>
  );
}

function getWaitingMinutes(order: SalesOrder) {
  const startedAt = new Date(order.sentToCashierAt ?? order.createdAt).getTime();
  return Math.max(Math.floor((Date.now() - startedAt) / 60000), 0);
}

function getWaitingVariant(order: SalesOrder) {
  const minutes = getWaitingMinutes(order);

  if (minutes >= 30) {
    return 'danger' as const;
  }

  if (minutes >= 10) {
    return 'warning' as const;
  }

  return 'outline' as const;
}

function getWaitingCardClass(order: SalesOrder) {
  const minutes = getWaitingMinutes(order);

  if (minutes >= 30) {
    return 'rounded-md border border-danger/40 bg-danger/5 p-3';
  }

  if (minutes >= 10) {
    return 'rounded-md border border-warning/40 bg-warning/10 p-3';
  }

  return 'rounded-md border border-zinc-200 bg-zinc-50 p-3';
}
