'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, CreditCard, FileText, Search, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  cancelSalesOrder,
  createSalesOrder,
  getCustomers,
  getOrderProductByBarcode,
  getSalesOrder,
  getSalesOrders,
  searchOrderProducts,
  updateSalesOrder,
  type Product,
  type CreditTermOption,
  type Customer,
  type InitialPaymentOption,
  type SalePaymentMode,
  type SalesOrder,
  type SalesOrderPriceLevel,
} from '@/lib/api';
import { canTakeOrders, isAdminSession } from '@/lib/authorization';
import { getStatusVariant, translateStatus } from '@/lib/display-labels';
import {
  normalizeDominicanDocument,
  validateDominicanCedula,
  validateDominicanRnc,
} from '@/lib/dominican-documents';
import { getOrderClientLabel, getOrderSearchLabel } from '@/lib/order-client';
import { cn, formatCurrency, formatDate } from '@/lib/utils';
import { CancelReasonModal } from './cancel-reason-modal';
import { ModuleHeader } from './module-header';
import { BarcodeInput } from './pos/barcode-input';
import { PosCart } from './pos/pos-cart';
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

type BarcodeDetectorResult = { rawValue: string };
type BarcodeDetectorInstance = {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;
type WindowWithBarcodeDetector = Window &
  typeof globalThis & { BarcodeDetector?: BarcodeDetectorConstructor };

type OrderDestination = 'CASH_SALE' | 'QUOTATION';
const finalDiscountCustomerId = '__FINAL_DISCOUNT_10__';
const finalPreferredCustomerId = '__FINAL_PREFERRED_18__';

const specialCustomerLabels = [
  'Consumidor final (descuento 5%)',
  'Consumidor final (cliente preferencial 10%)',
  // Keep recognizing labels stored by drafts created before the rate change.
  'Consumidor final (descuento 10%)',
  'Consumidor final (cliente preferencial 18%)',
];

function getPriceLevelDiscountRate(priceLevel: SalesOrderPriceLevel) {
  if (priceLevel === 'DISCOUNT_10') {
    return 0.05;
  }

  if (priceLevel === 'PREFERRED_18') {
    return 0.1;
  }

  return 0;
}

function getSpecialCustomerPriceLevel(
  customerValue: string,
): Exclude<SalesOrderPriceLevel, 'REGULAR'> | null {
  if (customerValue === finalDiscountCustomerId) {
    return 'DISCOUNT_10';
  }

  if (customerValue === finalPreferredCustomerId) {
    return 'PREFERRED_18';
  }

  return null;
}

function getSpecialCustomerValue(priceLevel?: SalesOrderPriceLevel | null) {
  if (priceLevel === 'DISCOUNT_10') {
    return finalDiscountCustomerId;
  }

  if (priceLevel === 'PREFERRED_18') {
    return finalPreferredCustomerId;
  }

  return '';
}

function getRegisteredCustomerId(customerValue: string) {
  return getSpecialCustomerPriceLevel(customerValue) ? '' : customerValue;
}

function normalizeCustomerSearch(value?: string | null) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function buildPricedCartItem(
  product: Product,
  quantity: number,
  priceLevel: SalesOrderPriceLevel,
  reservedQuantity = 0,
): CartItem {
  const regularUnitPrice = getProductPrice(product);
  const discountRate = getPriceLevelDiscountRate(priceLevel);
  const unitPrice = roundMoney(regularUnitPrice * (1 - discountRate));
  const regularSubtotal = roundMoney(regularUnitPrice * quantity);
  const subtotal = roundMoney(unitPrice * quantity);
  const discountTotal = roundMoney(Math.max(regularSubtotal - subtotal, 0));
  const taxTotal = roundMoney(subtotal * Number(product.taxRate));

  return {
    product,
    quantity,
    reservedQuantity,
    unitPrice,
    discountTotal,
    subtotal,
    taxTotal,
    total: roundMoney(subtotal + taxTotal),
  };
}

export function OrdersView() {
  const session = useCurrentSession();
  const canUseOrderTaking = canTakeOrders(session);
  const cashierCreditOnly = session?.role === 'CASHIER';
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const editOrderId = searchParams.get('edit');
  const router = useRouter();
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanFrameRef = useRef<number | null>(null);
  const loadedEditOrderRef = useRef<string | null>(null);
  const editToastShownRef = useRef<string | null>(null);

  const [destination, setDestination] = useState<OrderDestination>('CASH_SALE');
  const [clientName, setClientName] = useState('');
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [quotationDocumentType, setQuotationDocumentType] = useState<'RNC' | 'CEDULA'>('CEDULA');
  const [quotationDocumentNumber, setQuotationDocumentNumber] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [priceLevel, setPriceLevel] = useState<SalesOrderPriceLevel>('REGULAR');
  const [paymentMode, setPaymentMode] = useState<SalePaymentMode>('CASH');
  const [initialPaymentOption, setInitialPaymentOption] =
    useState<InitialPaymentOption>('PERCENT_30');
  const [creditTermOption, setCreditTermOption] = useState<CreditTermOption>('CUSTOMER_DEFAULT');
  const [customDueDate, setCustomDueDate] = useState('');
  const [creditRequestNote, setCreditRequestNote] = useState('');
  const [notes, setNotes] = useState('');
  const [barcode, setBarcode] = useState('');
  const [scannerEnabled, setScannerEnabled] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [scannerMessage, setScannerMessage] = useState<string | null>(null);
  const [lastScannedProduct, setLastScannedProduct] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [brandFilter, setBrandFilter] = useState('ALL');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<'products' | 'order'>('products');
  const [loadedEditOrderId, setLoadedEditOrderId] = useState<string | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [cancelTargetLabel, setCancelTargetLabel] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const customersQuery = useQuery({
    queryKey: ['order-customers', session?.tenantId],
    queryFn: () => getCustomers(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: canUseOrderTaking,
  });
  const productsQuery = useQuery({
    queryKey: ['order-products-search', session?.tenantId, search],
    queryFn: () =>
      searchOrderProducts(session?.tenantId ?? '', session?.accessToken ?? '', search || 'RIV'),
    enabled: canUseOrderTaking,
  });
  const pendingOrdersQuery = useQuery({
    queryKey: ['sales-orders', session?.tenantId, 'OPEN'],
    queryFn: () => getSalesOrders(session?.tenantId ?? '', session?.accessToken ?? '', 'OPEN'),
    enabled: canUseOrderTaking,
  });
  const quotationsQuery = useQuery({
    queryKey: ['sales-orders', session?.tenantId, 'QUOTATION'],
    queryFn: () => getSalesOrders(session?.tenantId ?? '', session?.accessToken ?? '', 'QUOTATION'),
    enabled: canUseOrderTaking,
  });

  useEffect(() => {
    if (scannerEnabled) {
      barcodeInputRef.current?.focus();
    }
  }, [scannerEnabled]);

  useEffect(() => {
    if (cashierCreditOnly && !editOrderId) {
      setPaymentMode('CREDIT');
    }
  }, [cashierCreditOnly, editOrderId]);

  useEffect(() => {
    setCart((current) =>
      current.map((item) =>
        buildPricedCartItem(item.product, item.quantity, priceLevel, item.reservedQuantity),
      ),
    );
  }, [priceLevel]);

  useEffect(() => () => stopCameraScan(), []);

  // Cargar orden para edición si está el parámetro 'edit'
  useEffect(() => {
    if (!editOrderId) {
      loadedEditOrderRef.current = null;
      editToastShownRef.current = null;
      return;
    }

    if (
      !session ||
      !canUseOrderTaking ||
      loadedEditOrderRef.current === editOrderId ||
      loadedEditOrderId === editOrderId
    ) {
      return;
    }

    let active = true;
    loadedEditOrderRef.current = editOrderId;

    async function loadOrder() {
      try {
        const order = await getSalesOrder(session!.tenantId, session!.accessToken, editOrderId!);
        if (!active) return;

        if (order.status !== 'QUOTATION') {
          toast.error('Solo se pueden modificar cotizaciones.');
          loadedEditOrderRef.current = null;
          router.replace('/orders');
          return;
        }

        // Cargar datos
        setDestination('QUOTATION');
        setClientName(order.clientName || '');
        setCustomerId(order.customerId || getSpecialCustomerValue(order.priceLevel));
        setPriceLevel(order.priceLevel ?? 'REGULAR');
        setPaymentMode(order.paymentMode ?? 'CASH');
        setInitialPaymentOption(order.initialPaymentOption ?? 'PERCENT_30');
        setCreditTermOption(order.creditTermOption ?? 'CUSTOMER_DEFAULT');
        setCustomDueDate(
          order.creditTermOption === 'CUSTOM_DATE' && order.dueDate
            ? order.dueDate.slice(0, 10)
            : '',
        );
        setCreditRequestNote(order.creditRequestNote ?? order.creditApproval?.requestNote ?? '');
        setNotes(order.notes || '');
        if (order.quotationDocumentType === 'RNC' || order.quotationDocumentType === 'CEDULA') {
          setQuotationDocumentType(order.quotationDocumentType);
        }
        setQuotationDocumentNumber(order.quotationDocumentNumber || '');

        // Cargar productos en el carrito
        const cartItems = order.items.map((item) => ({
          product: item.product! as Product,
          quantity: Number(item.quantity),
          reservedQuantity: item.reservedQuantity,
          unitPrice: Number(item.unitPrice),
          discountTotal: Number(item.discountTotal ?? 0),
          subtotal: Number(item.subtotal),
          taxTotal: Number(item.taxTotal),
          total: Number(item.total),
        }));

        setCart(cartItems);
        setMobileSection('order');
        setLoadedEditOrderId(editOrderId);
        loadedEditOrderRef.current = null;

        if (editToastShownRef.current !== editOrderId) {
          editToastShownRef.current = editOrderId;
          toast.info(`Editando cotizacion: ${order.orderNumber}`);
        }
      } catch (err) {
        if (!active) return;
        loadedEditOrderRef.current = null;
        toast.error('No se pudo cargar la cotizacion para editar.');
        router.replace('/orders');
      }
    }

    loadOrder();

    return () => {
      active = false;
      if (loadedEditOrderRef.current === editOrderId && loadedEditOrderId !== editOrderId) {
        loadedEditOrderRef.current = null;
      }
    };
  }, [canUseOrderTaking, editOrderId, session, router, loadedEditOrderId]);

  const activeCustomers = (customersQuery.data ?? []).filter(
    (customer) => customer.status === 'ACTIVE',
  );
  const selectedCustomer = activeCustomers.find(
    (customer) => customer.id === getRegisteredCustomerId(customerId),
  );
  const normalizedCustomerSearch = normalizeCustomerSearch(clientName);
  const customerSearchResults = useMemo(() => {
    const matches = normalizedCustomerSearch
      ? activeCustomers.filter((customer) =>
          [customer.name, customer.documentNumber, customer.phone, customer.email].some((value) =>
            normalizeCustomerSearch(value).includes(normalizedCustomerSearch),
          ),
        )
      : activeCustomers.filter((customer) => Number(customer.creditBalance ?? 0) > 0);

    return matches
      .sort((left, right) => {
        const leftStartsWithSearch = normalizeCustomerSearch(left.name).startsWith(
          normalizedCustomerSearch,
        );
        const rightStartsWithSearch = normalizeCustomerSearch(right.name).startsWith(
          normalizedCustomerSearch,
        );
        if (leftStartsWithSearch !== rightStartsWithSearch) {
          return leftStartsWithSearch ? -1 : 1;
        }

        const balanceDifference =
          Number(right.creditBalance ?? 0) - Number(left.creditBalance ?? 0);
        if (balanceDifference) return balanceDifference;
        return left.name.localeCompare(right.name, 'es');
      })
      .slice(0, 8);
  }, [activeCustomers, normalizedCustomerSearch]);
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
  const totals = useMemo(() => {
    const subtotal = cart.reduce(
      (sum, item) => sum + (item.subtotal ?? getProductPrice(item.product) * item.quantity),
      0,
    );
    const discount = cart.reduce((sum, item) => sum + (item.discountTotal ?? 0), 0);
    const tax = cart.reduce(
      (sum, item) =>
        sum +
        (item.taxTotal ??
          getProductPrice(item.product) * item.quantity * Number(item.product.taxRate)),
      0,
    );

    return {
      subtotal,
      discount,
      tax,
      total: subtotal + tax,
    };
  }, [cart]);
  const initialPaymentRate =
    initialPaymentOption === 'PERCENT_30'
      ? 0.3
      : initialPaymentOption === 'PERCENT_50'
        ? 0.5
        : initialPaymentOption === 'PERCENT_70'
          ? 0.7
          : 0;
  const initialPaymentAmount = roundMoney(totals.total * initialPaymentRate);
  const financedAmount = roundMoney(totals.total - initialPaymentAmount);
  const projectedCustomerBalance = roundMoney(
    Number(selectedCustomer?.creditBalance ?? 0) + financedAmount,
  );
  const exceedsCreditLimit = Boolean(
    paymentMode === 'CREDIT' &&
    selectedCustomer &&
    projectedCustomerBalance > Number(selectedCustomer.creditLimit),
  );

  const barcodeMutation = useMutation({
    mutationFn: (code: string) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return getOrderProductByBarcode(session.tenantId, session.accessToken, code);
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

  const createOrderMutation = useMutation({
    mutationFn: () => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      const trimmedClientName = clientName.trim();
      if (!trimmedClientName) {
        throw new Error('El nombre del cliente es requerido.');
      }

      if (paymentMode === 'CREDIT') {
        if (!selectedCustomer) {
          throw new Error('Una venta fiada requiere seleccionar un cliente registrado.');
        }
        if (!selectedCustomer.creditEnabled || selectedCustomer.creditStatus !== 'ACTIVE') {
          throw new Error('El crédito de este cliente no está habilitado o está bloqueado.');
        }
        if (creditTermOption === 'CUSTOM_DATE' && !customDueDate) {
          throw new Error('Selecciona la fecha de vencimiento del crédito.');
        }
      }

      if (destination === 'QUOTATION') {
        const normalizedDocument = normalizeDominicanDocument(quotationDocumentNumber);
        const isValidDocument = normalizedDocument
          ? quotationDocumentType === 'RNC'
            ? validateDominicanRnc(quotationDocumentNumber)
            : validateDominicanCedula(quotationDocumentNumber)
          : true;

        if (!isValidDocument) {
          throw new Error(
            quotationDocumentType === 'RNC' ? 'El RNC no es valido.' : 'La cedula no es valida.',
          );
        }
      }

      const payload = {
        destination,
        clientName: trimmedClientName,
        customerId: getRegisteredCustomerId(customerId) || undefined,
        priceLevel,
        paymentMode,
        initialPaymentOption: paymentMode === 'CREDIT' ? initialPaymentOption : undefined,
        creditTermOption: paymentMode === 'CREDIT' ? creditTermOption : undefined,
        customDueDate:
          paymentMode === 'CREDIT' && creditTermOption === 'CUSTOM_DATE'
            ? customDueDate
            : undefined,
        creditRequestNote:
          paymentMode === 'CREDIT' ? creditRequestNote.trim() || undefined : undefined,
        quotationDocumentType:
          destination === 'QUOTATION' && normalizeDominicanDocument(quotationDocumentNumber)
            ? quotationDocumentType
            : undefined,
        quotationDocumentNumber:
          destination === 'QUOTATION' && normalizeDominicanDocument(quotationDocumentNumber)
            ? normalizeDominicanDocument(quotationDocumentNumber)
            : undefined,
        notes: notes.trim() || undefined,
        items: cart.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
      };

      if (editOrderId) {
        return updateSalesOrder(session.tenantId, session.accessToken, editOrderId, payload);
      }

      return createSalesOrder(session.tenantId, session.accessToken, payload);
    },
    onSuccess: async (order) => {
      const successMessage = editOrderId
        ? `Cotizacion ${order.orderNumber} actualizada correctamente.`
        : destination === 'QUOTATION'
          ? `Cotizacion ${order.orderNumber} registrada correctamente.`
          : paymentMode === 'CREDIT'
            ? `Solicitud de crédito ${order.orderNumber} enviada para aprobación administrativa.`
            : `Ticket pendiente ${order.orderNumber} enviado a caja. No es una factura fiscal.`;
      setMessage(successMessage);
      setCart([]);
      setNotes('');
      setCustomerId('');
      setPriceLevel('REGULAR');
      setPaymentMode(cashierCreditOnly ? 'CREDIT' : 'CASH');
      setInitialPaymentOption('PERCENT_30');
      setCreditTermOption('CUSTOMER_DEFAULT');
      setCustomDueDate('');
      setCreditRequestNote('');
      setClientName('');
      setQuotationDocumentNumber('');
      setMobileSection('products');
      setLoadedEditOrderId(null);
      loadedEditOrderRef.current = editOrderId ? editOrderId : null;
      editToastShownRef.current = null;
      await queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success(
        editOrderId
          ? 'Cotizacion actualizada'
          : destination === 'QUOTATION'
            ? 'Cotizacion creada'
            : paymentMode === 'CREDIT'
              ? 'Crédito enviado para aprobación'
              : 'Ticket enviado a caja',
        { description: order.orderNumber },
      );

      if (editOrderId) {
        router.push('/quotations');
      }
    },
    onError: (error) => {
      const nextMessage = error instanceof Error ? error.message : 'No se pudo enviar la orden.';
      setMessage(nextMessage);
      toast.error(nextMessage);
    },
  });

  const cancelOrderMutation = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason?: string }) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return cancelSalesOrder(session.tenantId, session.accessToken, orderId, reason);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success('Orden cancelada.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo cancelar la orden.');
    },
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  if (!canUseOrderTaking) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Toma de ordenes bloqueada</CardTitle>
          <CardDescription>Tu usuario no tiene permiso para crear ordenes.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  function addProduct(product: Product) {
    const currentQuantity = quantitiesByProduct[product.id] ?? 0;

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
            ? (() => {
                const nextQuantity = item.quantity + getQuantityStep(item.product);
                const cappedQuantity = item.product.trackInventory
                  ? Math.min(nextQuantity, getAvailableStock(item.product))
                  : nextQuantity;

                return buildPricedCartItem(
                  item.product,
                  roundQuantity(cappedQuantity),
                  priceLevel,
                  item.reservedQuantity,
                );
              })()
            : item,
        );
      }

      return [...current, buildPricedCartItem(product, getDefaultQuantity(product), priceLevel)];
    });

    return true;
  }

  function updateQuantity(productId: string, quantity: number) {
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

          return buildPricedCartItem(
            item.product,
            roundQuantity(nextQuantity),
            priceLevel,
            item.reservedQuantity,
          );
        })
        .filter((item) => item.quantity > 0),
    );
  }

  function handleCustomerSelection(nextCustomerId: string) {
    const wasSpecialCustomer = Boolean(getSpecialCustomerPriceLevel(customerId));
    const nextPriceLevel = getSpecialCustomerPriceLevel(nextCustomerId);
    const previousCustomer = activeCustomers.find((customer) => customer.id === customerId);
    const clientNameWasAutoFilled =
      specialCustomerLabels.includes(clientName.trim()) ||
      Boolean(previousCustomer && clientName.trim() === previousCustomer.name);

    setCustomerId(nextCustomerId);

    if (nextPriceLevel) {
      setPriceLevel(nextPriceLevel);
      if (clientNameWasAutoFilled) {
        setClientName('');
      }
      return;
    }

    setPriceLevel('REGULAR');

    if (!nextCustomerId) {
      if (wasSpecialCustomer) {
        setClientName('');
      }
      return;
    }

    const selectedCustomer = activeCustomers.find((customer) => customer.id === nextCustomerId);
    if (selectedCustomer) {
      setClientName(selectedCustomer.name);
    }
  }

  function handleClientNameChange(nextClientName: string) {
    const registeredCustomerId = getRegisteredCustomerId(customerId);
    const currentCustomer = activeCustomers.find(
      (customer) => customer.id === registeredCustomerId,
    );

    // Al cambiar manualmente el texto, se desasocia el cliente seleccionado
    // para nunca adjudicar una orden a otra persona por coincidencia parcial.
    if (
      currentCustomer &&
      normalizeCustomerSearch(nextClientName) !== normalizeCustomerSearch(currentCustomer.name)
    ) {
      setCustomerId('');
      setPriceLevel('REGULAR');
    }

    setClientName(nextClientName);
  }

  function selectRegisteredCustomer(customer: Customer) {
    handleCustomerSelection(customer.id);
    setCustomerSearchOpen(false);
  }

  function useTemporaryQuotationName() {
    // A quotation can be issued for a one-time customer. Keep only the typed
    // name on the quotation and never create or associate a Customer record.
    setCustomerId('');
    setPriceLevel('REGULAR');
    setCustomerSearchOpen(false);
  }

  function handlePaymentModeChange(nextPaymentMode: SalePaymentMode) {
    setPaymentMode(nextPaymentMode);
    if (nextPaymentMode !== 'CREDIT') {
      return;
    }

    if (!getRegisteredCustomerId(customerId)) {
      setCustomerId('');
      setPriceLevel('REGULAR');
      if (specialCustomerLabels.includes(clientName.trim())) {
        setClientName('');
      }
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
    <div className={cn('space-y-5', cart.length ? 'pb-24 xl:pb-0' : '')}>
      <ModuleHeader
        title="Toma de ordenes"
        description="Modo escaner para crear tickets pendientes. La factura se emite solamente cuando caja cobra."
      />

      <div className="grid grid-cols-2 gap-2 rounded-md border border-zinc-200 bg-white p-1 shadow-sm xl:hidden">
        <button
          type="button"
          onClick={() => setMobileSection('products')}
          className={cn(
            'rounded-md px-3 py-2.5 text-sm font-semibold transition',
            mobileSection === 'products'
              ? 'bg-zinc-950 text-white shadow-sm'
              : 'text-zinc-600 hover:bg-zinc-50',
          )}
        >
          Productos
        </button>
        <button
          type="button"
          onClick={() => setMobileSection('order')}
          className={cn(
            'flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-semibold transition',
            mobileSection === 'order'
              ? 'bg-zinc-950 text-white shadow-sm'
              : 'text-zinc-600 hover:bg-zinc-50',
          )}
        >
          Orden
          <span
            className={cn(
              'inline-flex min-w-6 justify-center rounded-full px-2 py-0.5 text-xs',
              mobileSection === 'order' ? 'bg-white/15 text-white' : 'bg-zinc-100 text-zinc-700',
            )}
          >
            {cart.length}
          </span>
        </button>
      </div>

      <section className="grid gap-4 xl:h-[calc(100vh-9rem)] xl:grid-cols-[minmax(0,1.2fr)_minmax(24rem,0.8fr)] xl:items-start xl:overflow-hidden">
        <div
          className={cn(
            'space-y-4 xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:space-y-3',
            mobileSection === 'products' ? 'block' : 'hidden xl:flex',
          )}
        >
          <Card className="border-zinc-200 bg-zinc-50 xl:shrink-0">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>Productos</CardTitle>
                  <CardDescription>
                    Busca por tipo, proveedor, nombre, SKU o codigo.
                  </CardDescription>
                </div>
                {lastScannedProduct ? (
                  <Badge variant="success">Ultimo escaneo: {lastScannedProduct.name}</Badge>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <BarcodeInput
                barcode={barcode}
                scannerEnabled={scannerEnabled}
                cameraActive={cameraActive}
                scannerMessage={scannerMessage}
                barcodeInputRef={barcodeInputRef}
                videoRef={videoRef}
                isPending={barcodeMutation.isPending}
                keepFocus
                onBarcodeChange={setBarcode}
                onSubmit={(code) => barcodeMutation.mutate(code)}
                onEnableScanner={enableScanner}
                onDisableScanner={disableScanner}
                onStartCamera={startCameraScan}
              />

              <div className="grid gap-3 md:grid-cols-[1.2fr_0.9fr_0.9fr]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="bg-white pl-9"
                    placeholder="Buscar producto"
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  className="h-10 rounded-md border border-input bg-white px-3 text-sm"
                >
                  <option value="ALL">Todos los tipos</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <select
                  value={brandFilter}
                  onChange={(event) => setBrandFilter(event.target.value)}
                  className="h-10 rounded-md border border-input bg-white px-3 text-sm"
                >
                  <option value="ALL">Marca/proveedor</option>
                  {brands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </div>
            </CardContent>
          </Card>

          <div className="surface-scrollbar xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:pr-2">
            <PosProductGrid
              products={filteredProducts}
              quantitiesByProduct={quantitiesByProduct}
              isLoading={productsQuery.isLoading}
              onAddProduct={addProduct}
            />
          </div>
        </div>

        <div
          className={cn(
            'surface-scrollbar space-y-3 xl:h-full xl:overflow-y-auto xl:pr-1',
            mobileSection === 'order' ? 'block' : 'hidden xl:block',
          )}
        >
          <PosCart items={cart} onUpdateQuantity={updateQuantity} onClear={() => setCart([])} />
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle>
                    {editOrderId
                      ? 'Modificar cotizacion'
                      : destination === 'QUOTATION'
                        ? 'Registrar cotizacion'
                        : paymentMode === 'CREDIT'
                          ? 'Solicitar venta fiada'
                          : 'Enviar a caja'}
                  </CardTitle>
                  <CardDescription>
                    {editOrderId
                      ? 'Actualiza los productos o datos de la cotización existente.'
                      : destination === 'QUOTATION'
                        ? 'Genera una cotizacion sin enviarla a caja ni emitir factura.'
                        : paymentMode === 'CREDIT'
                          ? 'La solicitud se enviará al administrador; el inventario se reservará al aprobar.'
                          : 'Esto crea una preventa/ticket pendiente para caja. No emite factura fiscal.'}
                  </CardDescription>
                </div>
                {editOrderId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger/5 hover:text-danger"
                    onClick={() => {
                      setCart([]);
                      setNotes('');
                      setCustomerId('');
                      setPriceLevel('REGULAR');
                      setPaymentMode(cashierCreditOnly ? 'CREDIT' : 'CASH');
                      setInitialPaymentOption('PERCENT_30');
                      setCreditTermOption('CUSTOMER_DEFAULT');
                      setCustomDueDate('');
                      setCreditRequestNote('');
                      setClientName('');
                      setQuotationDocumentNumber('');
                      setMobileSection('products');
                      setLoadedEditOrderId(null);
                      loadedEditOrderRef.current = editOrderId;
                      editToastShownRef.current = null;
                      router.replace('/orders');
                    }}
                  >
                    Cancelar edicion
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  createOrderMutation.mutate();
                }}
              >
                <div className="space-y-2">
                  <Label>Destino de la orden</Label>
                  <div className="grid grid-cols-2 gap-2 rounded-md border border-zinc-200 bg-white p-1">
                    <button
                      type="button"
                      className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        destination === 'CASH_SALE'
                          ? 'bg-[#f36c10] text-white shadow-sm'
                          : 'text-zinc-600 hover:bg-zinc-50'
                      }`}
                      onClick={() => setDestination('CASH_SALE')}
                    >
                      Venta de caja
                    </button>
                    <button
                      type="button"
                      className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        destination === 'QUOTATION'
                          ? 'bg-[#f36c10] text-white shadow-sm'
                          : 'text-zinc-600 hover:bg-zinc-50'
                      }`}
                      onClick={() => setDestination('QUOTATION')}
                    >
                      Cotizacion
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="orderPaymentMode">Modalidad de pago</Label>
                  <select
                    id="orderPaymentMode"
                    value={paymentMode}
                    disabled={Boolean(editOrderId) || cashierCreditOnly}
                    onChange={(event) =>
                      handlePaymentModeChange(event.target.value as SalePaymentMode)
                    }
                    className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm disabled:bg-zinc-100"
                  >
                    {!cashierCreditOnly ? <option value="CASH">Contado</option> : null}
                    <option value="CREDIT">Fiado / crédito</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    {cashierCreditOnly
                      ? 'Como cajero puedes crear solicitudes fiadas; el administrador deberá aprobarlas.'
                      : 'La modalidad se fija al crear la orden y no se podrá cambiar al llegar a caja.'}
                  </p>
                </div>

                {destination === 'QUOTATION' ? (
                  <div className="space-y-1 border-l-2 border-[#f36c10] pl-3">
                    <p className="text-sm font-semibold text-foreground">Datos de cotización</p>
                    <p className="text-xs text-muted-foreground">
                      El nombre del cliente es obligatorio. La cédula o el RNC son opcionales.
                    </p>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="orderClientName">
                    Nombre del cliente <span className="text-danger">*</span>
                  </Label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="orderClientName"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-controls="orderCustomerSearchResults"
                      aria-expanded={customerSearchOpen}
                      value={clientName}
                      onFocus={() => setCustomerSearchOpen(true)}
                      onBlur={() => window.setTimeout(() => setCustomerSearchOpen(false), 150)}
                      onChange={(event) => {
                        handleClientNameChange(event.target.value);
                        setCustomerSearchOpen(true);
                      }}
                      placeholder="Busca por nombre, cedula, telefono o correo"
                      className="bg-white pl-9"
                      autoComplete="off"
                      required
                    />
                    {customerSearchOpen ? (
                      <div
                        id="orderCustomerSearchResults"
                        role="listbox"
                        className="absolute z-30 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg"
                      >
                        <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
                          {normalizedCustomerSearch
                            ? 'Clientes registrados coincidentes'
                            : 'Clientes con saldo pendiente'}
                        </div>
                        {destination === 'QUOTATION' && clientName.trim() ? (
                          paymentMode === 'CASH' ? (
                            <button
                              type="button"
                              role="option"
                              className="mb-1 flex w-full flex-col rounded-md border border-primary/25 bg-primary/[0.045] px-3 py-2.5 text-left transition-colors hover:bg-primary/[0.09] focus-visible:bg-primary/[0.09]"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={useTemporaryQuotationName}
                            >
                              <span className="text-sm font-semibold text-foreground">
                                Usar “{clientName.trim()}” solo para esta cotización
                              </span>
                              <span className="mt-0.5 text-xs text-muted-foreground">
                                No se creará ni se vinculará un cliente registrado.
                              </span>
                            </button>
                          ) : (
                            <p className="mb-1 rounded-md border border-warning/25 bg-warning/[0.05] px-3 py-2 text-xs text-muted-foreground">
                              Las cotizaciones fiadas requieren un cliente registrado con crédito
                              habilitado.
                            </p>
                          )
                        ) : null}
                        {customerSearchResults.length ? (
                          customerSearchResults.map((customer) => {
                            const balance = Number(customer.creditBalance ?? 0);
                            const creditUnavailable =
                              paymentMode === 'CREDIT' &&
                              (!customer.creditEnabled || customer.creditStatus !== 'ACTIVE');

                            return (
                              <button
                                key={customer.id}
                                type="button"
                                role="option"
                                aria-selected={customer.id === selectedCustomer?.id}
                                disabled={creditUnavailable}
                                className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => selectRegisteredCustomer(customer)}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium">
                                    {customer.name}
                                  </span>
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {[customer.documentNumber, customer.phone, customer.email]
                                      .filter(Boolean)
                                      .join(' · ') || 'Sin documento ni contacto'}
                                  </span>
                                </span>
                                <span
                                  className={cn(
                                    'shrink-0 rounded-full px-2 py-1 text-xs font-semibold',
                                    balance > 0
                                      ? 'bg-danger/10 text-danger'
                                      : 'bg-success/10 text-success',
                                  )}
                                >
                                  {balance > 0 ? `Debe ${formatCurrency(balance)}` : 'Al dia'}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <p className="px-3 py-3 text-sm text-muted-foreground">
                            {normalizedCustomerSearch
                              ? 'No encontramos clientes registrados con esa busqueda.'
                              : 'No hay clientes con saldo pendiente.'}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {destination === 'QUOTATION'
                      ? 'Puedes usar un cliente registrado o un nombre temporal. El nombre temporal queda solo en esta cotización.'
                      : 'Busca y selecciona un cliente para consultar su saldo. Para contado tambien puedes escribir un cliente no registrado.'}
                  </p>
                  {selectedCustomer ? (
                    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{selectedCustomer.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {selectedCustomer.documentNumber ?? 'Sin documento'}
                          {selectedCustomer.creditEnabled
                            ? ` · Limite ${formatCurrency(Number(selectedCustomer.creditLimit ?? 0))}`
                            : ' · Credito no habilitado'}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-xs text-muted-foreground">Saldo pendiente</p>
                        <p
                          className={cn(
                            'text-sm font-bold',
                            Number(selectedCustomer.creditBalance ?? 0) > 0
                              ? 'text-danger'
                              : 'text-success',
                          )}
                        >
                          {formatCurrency(Number(selectedCustomer.creditBalance ?? 0))}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>

                {destination === 'QUOTATION' ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="quotationDocumentNumber">Cédula o RNC (opcional)</Label>
                      <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-2">
                        <select
                          id="quotationDocumentType"
                          aria-label="Tipo de documento"
                          value={quotationDocumentType}
                          onChange={(event) =>
                            setQuotationDocumentType(event.target.value as 'RNC' | 'CEDULA')
                          }
                          className="h-10 rounded-md border border-input bg-white px-3 text-sm"
                        >
                          <option value="CEDULA">Cédula</option>
                          <option value="RNC">RNC</option>
                        </select>
                        <Input
                          id="quotationDocumentNumber"
                          value={quotationDocumentNumber}
                          onChange={(event) => setQuotationDocumentNumber(event.target.value)}
                          placeholder={
                            quotationDocumentType === 'RNC' ? '123456789' : '00123456789'
                          }
                          inputMode="numeric"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Puedes dejarlo vacío. Si lo indicas, validaremos la cédula o el RNC antes de
                        guardar.
                      </p>
                    </div>
                  </>
                ) : null}

                <div className="hidden">
                  <Label htmlFor="orderCustomer">
                    Cliente registrado
                    {paymentMode === 'CREDIT' ? (
                      <span className="text-danger"> *</span>
                    ) : (
                      ' (opcional)'
                    )}
                  </Label>
                  <select
                    id="orderCustomer"
                    value={customerId}
                    onChange={(event) => handleCustomerSelection(event.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                  >
                    <option value="">
                      {paymentMode === 'CREDIT' ? 'Selecciona un cliente' : 'Consumidor final'}
                    </option>
                    {paymentMode === 'CASH' ? (
                      <>
                        <option value={finalDiscountCustomerId}>
                          Consumidor Final (descuento 5%)
                        </option>
                        <option value={finalPreferredCustomerId}>
                          Consumidor Final (Cliente preferencial 10%)
                        </option>
                      </>
                    ) : null}
                    {activeCustomers.map((customer) => (
                      <option
                        key={customer.id}
                        value={customer.id}
                        disabled={
                          paymentMode === 'CREDIT' &&
                          (!customer.creditEnabled || customer.creditStatus !== 'ACTIVE')
                        }
                      >
                        {customer.name}
                        {paymentMode === 'CREDIT' && !customer.creditEnabled
                          ? ' — crédito no habilitado'
                          : paymentMode === 'CREDIT' && customer.creditStatus !== 'ACTIVE'
                            ? ' — crédito bloqueado'
                            : ''}
                      </option>
                    ))}
                  </select>
                  {priceLevel !== 'REGULAR' ? (
                    <p className="text-xs font-medium text-emerald-700">
                      Se aplicara un descuento de{' '}
                      {Math.round(getPriceLevelDiscountRate(priceLevel) * 100)}% a los productos de
                      esta orden.
                    </p>
                  ) : null}
                </div>

                {paymentMode === 'CASH' ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Accesos rapidos para consumidor final
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={customerId === finalDiscountCustomerId ? 'default' : 'outline'}
                        onClick={() => handleCustomerSelection(finalDiscountCustomerId)}
                      >
                        Descuento 5%
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={customerId === finalPreferredCustomerId ? 'default' : 'outline'}
                        onClick={() => handleCustomerSelection(finalPreferredCustomerId)}
                      >
                        Cliente preferencial 10%
                      </Button>
                    </div>
                  </div>
                ) : null}
                {priceLevel !== 'REGULAR' ? (
                  <p className="text-xs font-medium text-emerald-700">
                    Se aplicara un descuento de{' '}
                    {Math.round(getPriceLevelDiscountRate(priceLevel) * 100)}% a los productos de
                    esta orden.
                  </p>
                ) : null}

                {paymentMode === 'CREDIT' ? (
                  <div className="space-y-4 rounded-md border border-sky-200 bg-sky-50/60 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-sky-950">
                      <CreditCard className="h-4 w-4" />
                      Condiciones de la venta fiada
                    </div>
                    {selectedCustomer ? (
                      <div className="grid gap-2 text-xs sm:grid-cols-3">
                        <div className="rounded-md bg-white p-2">
                          <span className="text-muted-foreground">Balance</span>
                          <p className="font-semibold">
                            {formatCurrency(Number(selectedCustomer.creditBalance ?? 0))}
                          </p>
                        </div>
                        <div className="rounded-md bg-white p-2">
                          <span className="text-muted-foreground">Límite</span>
                          <p className="font-semibold">
                            {formatCurrency(Number(selectedCustomer.creditLimit ?? 0))}
                          </p>
                        </div>
                        <div className="rounded-md bg-white p-2">
                          <span className="text-muted-foreground">Plazo recomendado</span>
                          <p className="font-semibold">{selectedCustomer.creditTermDays} días</p>
                        </div>
                      </div>
                    ) : null}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="initialPaymentOption">Pago inicial</Label>
                        <select
                          id="initialPaymentOption"
                          value={initialPaymentOption}
                          disabled={Boolean(editOrderId)}
                          onChange={(event) =>
                            setInitialPaymentOption(event.target.value as InitialPaymentOption)
                          }
                          className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm disabled:bg-zinc-100"
                        >
                          <option value="NONE">Sin pago inicial</option>
                          <option value="PERCENT_30">30 %</option>
                          <option value="PERCENT_50">50 %</option>
                          <option value="PERCENT_70">70 %</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="creditTermOption">Vencimiento</Label>
                        <select
                          id="creditTermOption"
                          value={creditTermOption}
                          disabled={Boolean(editOrderId)}
                          onChange={(event) =>
                            setCreditTermOption(event.target.value as CreditTermOption)
                          }
                          className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm disabled:bg-zinc-100"
                        >
                          <option value="CUSTOMER_DEFAULT">
                            Plazo del cliente
                            {selectedCustomer ? ` (${selectedCustomer.creditTermDays} días)` : ''}
                          </option>
                          <option value="DAYS_15">15 días</option>
                          <option value="DAYS_30">30 días</option>
                          <option value="DAYS_45">45 días</option>
                          <option value="CUSTOM_DATE">Fecha personalizada</option>
                        </select>
                      </div>
                    </div>
                    {creditTermOption === 'CUSTOM_DATE' ? (
                      <div className="space-y-2">
                        <Label htmlFor="customDueDate">Fecha de vencimiento</Label>
                        <Input
                          id="customDueDate"
                          type="date"
                          min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
                          value={customDueDate}
                          disabled={Boolean(editOrderId)}
                          onChange={(event) => setCustomDueDate(event.target.value)}
                          required
                        />
                      </div>
                    ) : null}
                    <div className="grid gap-2 rounded-md bg-white p-3 text-sm">
                      <div className="flex justify-between">
                        <span>Pago inicial</span>
                        <strong>{formatCurrency(initialPaymentAmount)}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Saldo a financiar</span>
                        <strong>{formatCurrency(financedAmount)}</strong>
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span>Balance proyectado del cliente</span>
                        <strong className={exceedsCreditLimit ? 'text-danger' : ''}>
                          {formatCurrency(projectedCustomerBalance)}
                        </strong>
                      </div>
                    </div>
                    {exceedsCreditLimit ? (
                      <p className="rounded-md bg-amber-100 px-3 py-2 text-xs font-medium text-amber-900">
                        Supera el límite de crédito. El administrador deberá autorizar
                        explícitamente el exceso y dejar una nota.
                      </p>
                    ) : null}
                    <div className="space-y-2">
                      <Label htmlFor="creditRequestNote">Nota para aprobación (opcional)</Label>
                      <textarea
                        id="creditRequestNote"
                        value={creditRequestNote}
                        onChange={(event) => setCreditRequestNote(event.target.value)}
                        className="min-h-16 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                        maxLength={500}
                        placeholder="Contexto para el administrador"
                      />
                    </div>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="orderNotes">Notas</Label>
                  <textarea
                    id="orderNotes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="min-h-20 w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    maxLength={500}
                    placeholder="Referencia del cliente o comentario interno"
                  />
                </div>

                <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <strong>{formatCurrency(totals.subtotal)}</strong>
                  </div>
                  {totals.discount > 0 ? (
                    <div className="mt-2 flex justify-between text-emerald-700">
                      <span>Descuento</span>
                      <strong>-{formatCurrency(totals.discount)}</strong>
                    </div>
                  ) : null}
                  <div className="mt-2 flex justify-between">
                    <span>ITBIS</span>
                    <strong>{formatCurrency(totals.tax)}</strong>
                  </div>
                  <div className="mt-3 flex justify-between border-t border-zinc-200 pt-3 text-base">
                    <span>Total</span>
                    <strong>{formatCurrency(totals.total)}</strong>
                  </div>
                </div>

                {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

                <Button
                  type="submit"
                  className="h-14 w-full bg-[#f36c10] text-base text-white hover:bg-[#d85f0e]"
                  disabled={!cart.length || createOrderMutation.isPending}
                >
                  {editOrderId ? (
                    <>
                      <FileText className="h-5 w-5" />
                      Actualizar cotizacion
                    </>
                  ) : destination === 'QUOTATION' ? (
                    <>
                      <FileText className="h-5 w-5" />
                      Guardar cotizacion
                    </>
                  ) : paymentMode === 'CREDIT' ? (
                    <>
                      <CreditCard className="h-5 w-5" />
                      Solicitar aprobación de crédito
                    </>
                  ) : (
                    <>
                      <Send className="h-5 w-5" />
                      Enviar a caja
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {destination === 'CASH_SALE' ? (
            <PendingOrdersPanel
              orders={pendingOrdersQuery.data ?? []}
              loading={pendingOrdersQuery.isLoading}
              cancellingId={cancelOrderMutation.variables?.orderId}
              onCancel={(order) => {
                setCancelTargetId(order.id);
                setCancelTargetLabel(order.orderNumber);
                setCancelReason('');
                setCancelModalOpen(true);
              }}
            />
          ) : null}

          <QuotationsPanel
            orders={quotationsQuery.data ?? []}
            loading={quotationsQuery.isLoading}
            showManagement={Boolean(isAdminSession(session) || canTakeOrders(session))}
            cancellingId={cancelOrderMutation.variables?.orderId}
            onCancel={(order) => {
              setCancelTargetId(order.id);
              setCancelTargetLabel(order.orderNumber);
              setCancelReason('');
              setCancelModalOpen(true);
            }}
          />
        </div>
      </section>

      <CancelReasonModal
        open={cancelModalOpen}
        title="Cancelar orden o cotizacion"
        description={
          cancelTargetLabel
            ? `Indica por que se cancela ${cancelTargetLabel}.`
            : 'Indica por que se cancela esta orden o cotizacion.'
        }
        reason={cancelReason}
        isPending={cancelOrderMutation.isPending}
        onReasonChange={setCancelReason}
        onClose={() => {
          setCancelModalOpen(false);
          setCancelTargetId(null);
          setCancelTargetLabel('');
          setCancelReason('');
        }}
        onConfirm={() => {
          const trimmedReason = cancelReason.trim();
          if (!trimmedReason) {
            toast.error('El motivo de cancelacion es requerido.');
            return;
          }
          if (cancelTargetId) {
            cancelOrderMutation.mutate({ orderId: cancelTargetId, reason: trimmedReason });
          }
          setCancelModalOpen(false);
          setCancelTargetId(null);
          setCancelTargetLabel('');
          setCancelReason('');
        }}
      />

      {cart.length ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 px-3 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur xl:hidden">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-muted-foreground">
                {cart.length} producto(s) en la orden
              </p>
              <p className="text-base font-extrabold text-zinc-950">
                {formatCurrency(totals.total)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 px-3"
              onClick={() => setMobileSection('products')}
            >
              Productos
            </Button>
            <Button
              type="button"
              className="h-11 bg-[#f36c10] px-4 text-white hover:bg-[#d85f0e]"
              onClick={() => setMobileSection('order')}
            >
              Revisar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PendingOrdersPanel({
  orders,
  loading,
  cancellingId,
  onCancel,
}: {
  orders: SalesOrder[];
  loading: boolean;
  cancellingId?: string;
  onCancel: (order: SalesOrder) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Órdenes abiertas</CardTitle>
        <CardDescription>
          Preventas pendientes de aprobación o cobro. Aún no son facturas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-muted-foreground">
            Cargando ordenes...
          </p>
        ) : orders.length ? (
          orders.map((order) => (
            <div key={order.id} className="rounded-md border border-zinc-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-zinc-950">{order.orderNumber}</p>
                    <Badge variant={getStatusVariant(order.status)}>
                      {translateStatus(order.status)}
                    </Badge>
                    {order.paymentMode === 'CREDIT' ? (
                      <Badge variant="outline">
                        {order.creditApproval?.status === 'PENDING'
                          ? 'Crédito pendiente'
                          : order.creditApproval?.status === 'APPROVED'
                            ? 'Crédito aprobado'
                            : 'Fiado'}
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
                    {formatDate(order.sentToCashierAt ?? order.createdAt)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Creada por {order.createdBy.name}
                  </p>
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
                <p className="shrink-0 text-sm font-bold">{formatCurrency(Number(order.total))}</p>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{order.items.length} producto(s)</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onCancel(order)}
                  disabled={cancellingId === order.id || order.status === 'IN_CASHIER'}
                >
                  <X className="h-4 w-4" />
                  Cancelar
                </Button>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center">
            <ClipboardCheck className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">No hay tickets pendientes.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuotationsPanel({
  orders,
  loading,
  showManagement,
  cancellingId,
  onCancel,
}: {
  orders: SalesOrder[];
  loading: boolean;
  showManagement: boolean;
  cancellingId?: string;
  onCancel: (order: SalesOrder) => void;
}) {
  if (!showManagement) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cotizaciones</CardTitle>
        <CardDescription>
          Cotizaciones registradas sin cobro. Puedes imprimirlas o cancelarlas si aplica.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-muted-foreground">
            Cargando cotizaciones...
          </p>
        ) : orders.length ? (
          orders.map((order) => (
            <div key={order.id} className="rounded-md border border-zinc-200 bg-white p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-zinc-950">{getOrderSearchLabel(order)}</p>
                    <Badge variant={getStatusVariant(order.status)}>
                      {translateStatus(order.status)}
                    </Badge>
                    {order.paymentMode === 'CREDIT' ? (
                      <Badge variant="outline">Cotización fiada</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Cliente: {getOrderClientLabel(order)}
                  </p>
                  {order.quotationDocumentType && order.quotationDocumentNumber ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {order.quotationDocumentType}: {order.quotationDocumentNumber}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    Creada por {order.createdBy.name} - {formatDate(order.createdAt)}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-bold">{formatCurrency(Number(order.total))}</p>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">{order.items.length} producto(s)</p>
                <div className="flex items-center gap-2">
                  <Button asChild type="button" variant="outline" size="sm">
                    <Link href={`/orders/${order.id}/print`}>Ver / imprimir</Link>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onCancel(order)}
                    disabled={cancellingId === order.id}
                  >
                    <X className="h-4 w-4" />
                    Cancelar
                  </Button>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center">
            <FileText className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">No hay cotizaciones registradas.</p>
          </div>
        )}
      </CardContent>
    </Card>
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
