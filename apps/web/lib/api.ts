import type { SupplierInvoiceOcrItem, SupplierInvoiceOcrResult } from './supplier-invoice-ocr';

export type Tenant = {
  id: string;
  name: string;
  slug: string;
};

export type DashboardSummary = {
  totalBilledMonth: number;
  totalBilledToday: number;
  grossSalesMonth: number;
  grossSalesToday: number;
  refundsMonth: number;
  refundsToday: number;
  netSalesMonth: number;
  netSalesToday: number;
  pendingReturnAmount: number;
  pendingInvoices: number;
  paidInvoices: number;
  draftInvoices: number;
  cancelledInvoices: number;
  activeCustomers: number;
  activeProducts: number;
  activeEmployees: number;
  openCashSessions: number;
  pendingOrders: number;
  claimedOrders: number;
  ordersInCashier: number;
  pendingQuotations: number;
  quotationSalesInCashier: number;
  quotationSalesInCashierAmount: number;
  completedQuotationSalesToday: number;
  completedQuotationSalesTodayAmount: number;
  completedOrdersToday: number;
  pendingReturns: number;
  completedReturns: number;
  lowStockProducts: number;
  openCashSessionDetails: Array<{
    id: string;
    registerName: string;
    openedByName: string;
    openingAmount: number;
    expectedCashAmount: number;
    openedAt: string;
  }>;
  recentInvoices: Array<{
    id: string;
    invoiceNumber: string;
    customerName: string;
    status: string;
    total: number;
    cashierName: string | null;
    issuedAt: string | null;
    createdAt: string;
  }>;
  recentReturns: Array<{
    id: string;
    status: string;
    reason: string;
    refundAmount: number;
    invoiceId: string;
    invoiceNumber: string;
    requestedByName: string;
    resolvedByName: string | null;
    createdAt: string;
    completedAt: string | null;
  }>;
  recentInventoryAlerts: Array<{
    id: string;
    name: string;
    sku: string | null;
    stock: number;
    reservedStock: number;
    minStock: number;
  }>;
  recentCashMovements: CashMovement[];
  recentEmployeeLogs: EmployeeLog[];
  fiscalSequenceAlerts: Array<{
    id: string;
    documentType: string;
    prefix: string;
    status: FiscalSequenceStatus | 'MISSING';
    startNumber: number;
    nextNumber: number;
    endNumber: number;
    remaining: number;
    authorizedCount: number;
    alertThreshold: number;
    severity: 'WARNING' | 'CRITICAL';
    validUntil: string | null;
    hasQueuedReplacement: boolean;
  }>;
  employeeSummary: {
    activeEmployees: number;
    openCashSessions: number;
  };
  accounting: {
    receivables: {
      outstandingBalance: number;
      overdueBalance: number;
      overdueCount: number;
      dueTodayCount: number;
      dueSoonCount: number;
      openInvoiceCount: number;
    };
    payables: {
      outstandingBalance: number;
      overdueBalance: number;
      overdueCount: number;
      dueTodayCount: number;
      dueSoonCount: number;
      openInvoiceCount: number;
    };
    purchaseOrders: {
      draftCount: number;
      underReviewCount: number;
      awaitingInvoiceCount: number;
      overdueCount: number;
      partiallyReceivedCount: number;
      awaitingReceiptCount: number;
    };
    receipts: {
      draftCount: number;
      itemsWithDifferenceCount: number;
    };
    creditApprovals: {
      pendingCount: number;
      pendingFinancedAmount: number;
      exceedsLimitCount: number;
    };
  };
  recentAuditActivity: Array<{
    id: string;
    action: string;
    entity: string;
    entityId: string | null;
    userName: string | null;
    createdAt: string;
  }>;
  salesSeries: Array<{
    month: string;
    total: number;
  }>;
};

export type ProductSalesMetric = {
  productId: string;
  name: string;
  sku: string | null;
  brand: string | null;
  unit: string;
  categoryId: string | null;
  categoryName: string;
  currentPrice: number;
  quantitySold: number;
  grossAmount: number;
  invoiceCount: number;
  lastSoldAt: string | null;
};

export type ProductSalesRanking = {
  generatedAt: string;
  range: {
    from: string | null;
    to: string | null;
  };
  productCount: number;
  productsWithSales: number;
  productsWithoutSales: number;
  mostSold: ProductSalesMetric[];
  leastSold: ProductSalesMetric[];
};

export type FiscalSequenceOperationalAlert = DashboardSummary['fiscalSequenceAlerts'][number];

export type OperationalAlertsSummary = {
  pendingInvoices: number;
  lowStockProducts: number;
  openCashSessions: number;
  fiscalSequenceAlerts: FiscalSequenceOperationalAlert[];
};

export type ProductSalesQuery = {
  from?: string;
  to?: string;
};

export type LoginResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
  memberships: Array<{
    id: string;
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    role: string;
    permissions: Record<string, boolean>;
  }>;
};

export type CustomerDocumentType = 'RNC' | 'CEDULA' | 'PASSPORT' | 'CONSUMER_FINAL' | 'OTHER';
export type TaxIdentityDocumentType = 'RNC' | 'CEDULA';
export type TaxIdentityLookupOutcome =
  | 'VERIFIED'
  | 'NOT_FOUND'
  | 'NON_ACTIVE'
  | 'REGISTRY_STALE'
  | 'UNAVAILABLE';
export type TaxIdentityLookup = {
  outcome: TaxIdentityLookupOutcome;
  documentType: TaxIdentityDocumentType;
  documentNumber: string;
  fiscalName: string | null;
  registryStatus: string | null;
  source: string | null;
  sourceUpdatedAt: string | null;
  checkedAt: string;
  overrideId?: string;
};
export type TaxIdentityVerificationEvidence = {
  outcome: 'VERIFIED' | 'MANUAL_OVERRIDE';
  documentType: TaxIdentityDocumentType;
  documentNumber: string;
  fiscalName: string;
  source: 'DGII_OFFICIAL' | 'TEST_FIXTURE' | 'MANUAL_OVERRIDE';
  sourceUpdatedAt: string | null;
  verifiedAt: string;
  registryStatus: string;
  overrideId?: string;
};
export type FiscalCustomerVerificationEvidence = Pick<
  TaxIdentityVerificationEvidence,
  'outcome' | 'source' | 'sourceUpdatedAt' | 'verifiedAt' | 'registryStatus' | 'overrideId'
>;
export type TaxIdentityContextType =
  | 'POS_ORDER'
  | 'CUSTOMER'
  | 'SUPPLIER'
  | 'CUSTOMER_CREATE'
  | 'SUPPLIER_CREATE';
export type TaxIdentityOverridePayload = {
  contextType: TaxIdentityContextType;
  contextId: string;
  documentType: TaxIdentityDocumentType;
  documentNumber: string;
  fiscalName: string;
  reason: string;
  supervisorEmail: string;
  supervisorPassword: string;
  expiresInMinutes?: number;
};
export type TaxIdentityOverrideResult = TaxIdentityLookup & {
  overrideId: string;
  expiresAt: string;
};
export type FiscalCustomerSnapshot = {
  id: string | null;
  name: string;
  operationalName?: string;
  documentType: CustomerDocumentType;
  documentNumber: string;
  verification?: FiscalCustomerVerificationEvidence;
};
export type FiscalDocumentPurpose = 'CONSUMER' | 'FISCAL_CREDIT';
export type LocalNcfDocumentType = 'CONSUMER_02' | 'FISCAL_CREDIT_01';
export type InvoiceDocumentType =
  | LocalNcfDocumentType
  | 'CONSUMER_ELECTRONIC_32'
  | 'FISCAL_CREDIT_ELECTRONIC_31'
  | 'DEBIT_NOTE_ELECTRONIC_33'
  | 'CREDIT_NOTE_ELECTRONIC_34';
export type InvoiceFiscalStatus =
  | 'NOT_APPLICABLE'
  | 'PENDING_SEQUENCE'
  | 'LOCAL_ISSUED'
  | 'LEGACY_UNVERIFIED'
  | 'READY_TO_SEND'
  | 'PENDING_SIGNATURE'
  | 'SIGNED'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'FAILED'
  | 'CANCELLED';
export type ProductUnit =
  | 'UNIT'
  | 'BOX'
  | 'PACK'
  | 'BAG'
  | 'ROLL'
  | 'METER'
  | 'FOOT'
  | 'YARD'
  | 'POUND'
  | 'GALLON'
  | 'LITER'
  | 'KILOGRAM'
  | 'SERVICE';
export type PosPaymentMethod = 'CASH' | 'CARD' | 'TRANSFER';
export type PaymentMethod = PosPaymentMethod | 'CHECK' | 'OTHER';
export type FiscalSequenceStatus = 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'EXHAUSTED';
export type ReturnRequestStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'COMPLETED' | 'CANCELLED';

export type Customer = {
  id: string;
  name: string;
  documentType: CustomerDocumentType;
  documentNumber: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: string;
  creditEnabled: boolean;
  creditLimit: string;
  creditBalance: string;
  creditTermDays: number;
  creditStatus: 'ACTIVE' | 'BLOCKED';
  creditEnabledAt: string | null;
  creditEnabledById: string | null;
  taxIdentityVerification: TaxIdentityVerificationEvidence | null;
  createdAt: string;
};

export type UpdatePosOrderFiscalDetailsPayload = {
  fiscalPurpose: FiscalDocumentPurpose;
  /** Compatibility-only; omit it to preserve the customer already linked to the order. */
  customerId?: string | null;
  documentType?: 'RNC' | 'CEDULA';
  documentNumber?: string;
  taxIdentityOverrideId?: string;
};

export type ProductTaxCategory = 'ITBIS_18' | 'ITBIS_16' | 'EXEMPT';

export type Product = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  barcodeType: string | null;
  generatedBarcode: boolean;
  barcodeLabelPrintCount: number;
  description: string | null;
  imageUrl: string | null;
  brand: string | null;
  unit: ProductUnit;
  price: string;
  salePrice: string;
  cost: string | null;
  costWithTax?: string | null;
  margin?: string | null;
  taxCategory: ProductTaxCategory;
  taxRate: string;
  trackInventory: boolean;
  stock: number;
  reservedStock: number;
  minStock: number;
  status: string;
  category?: {
    id: string;
    name: string;
  } | null;
};

export type CreateProductPayload = {
  categoryId?: string;
  name: string;
  sku?: string;
  barcode?: string;
  barcodeType?: string;
  brand?: string;
  unit?: ProductUnit;
  description?: string;
  imageUrl?: string;
  price: number;
  cost?: number;
  taxCategory?: ProductTaxCategory;
  taxRate?: number;
  trackInventory?: boolean;
  stock: number;
  minStock: number;
  status?: string;
};

export type UpdateProductPayload = Partial<CreateProductPayload>;

export type InventoryMovement = {
  id: string;
  type: string;
  quantity: number;
  previousStock: number | null;
  newStock: number | null;
  reason: string | null;
  reference: string | null;
  createdAt: string;
  product: Product;
};

export type Invoice = {
  id: string;
  tenantId: string;
  customerId: string | null;
  invoiceNumber: string;
  documentType: InvoiceDocumentType;
  eNcf: string | null;
  ncf: string | null;
  fiscalSequenceId: string | null;
  fiscalAuthorizationNumber: string | null;
  fiscalValidUntil: string | null;
  fiscalIssuerSnapshot: {
    rnc: string;
    legalName: string;
    commercialName: string;
    address: string;
    phone: string;
    email: string;
    logoUrl: string | null;
    pointOfSale: string;
    pointOfSaleLocation: string | null;
  } | null;
  fiscalCustomerSnapshot: FiscalCustomerSnapshot | null;
  status: string;
  fiscalStatus: InvoiceFiscalStatus;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  total: string;
  paidAmount: string;
  amountReceived: string;
  changeAmount: string;
  balance: string;
  paymentMode: 'CASH' | 'CREDIT';
  paymentMethod: PaymentMethod | null;
  dueDate: string | null;
  issuedAt: string | null;
  createdAt: string;
  /** Present on invoice list/detail responses; POS create responses may omit it. */
  receiptPrintCount?: number;
  tenant?: {
    id: string;
    name: string;
    commercialName: string | null;
    legalName: string | null;
    rnc: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    branding?: {
      logoUrl: string | null;
    } | null;
  };
  customer: Customer | null;
  issuedBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
  cashSession?: {
    id: string;
    cashRegister: {
      id: string;
      name: string;
      location: string | null;
    };
  } | null;
  payments?: Array<{
    id: string;
    method: PaymentMethod;
    amount: string | number;
    status: string;
    receiptNumber?: string | null;
    cashSessionId?: string | null;
    cancelledAt?: string | null;
    cancelReason?: string | null;
    paidAt: string | null;
    createdAt: string;
  }>;
  salesOrder?: {
    id: string;
    orderNumber: string;
    status: string;
  } | null;
  items: Array<{
    id: string;
    description: string;
    sku: string | null;
    barcode: string | null;
    quantity: string;
    unit: ProductUnit;
    unitPrice: string;
    discountTotal: string;
    taxCategory: ProductTaxCategory;
    taxRate: string;
    taxTotal: string;
    subtotal: string;
    total: string;
  }>;
};

export type InvoicePrintRegistration = {
  action: 'PRINT_RECEIPT' | 'REPRINT_RECEIPT';
  printNumber: number;
  isReprint: boolean;
  registeredAt: string;
};

export type CreateInvoicePayload = {
  customerId?: string;
  invoiceNumber?: string;
  documentType?: LocalNcfDocumentType;
  paymentMethod?: PosPaymentMethod;
  status?: 'DRAFT';
  issuedAt?: string;
  items: Array<{
    productId: string;
    description: string;
    quantity: number;
  }>;
};

export type PosSalePayload = {
  /** @deprecated The fiscal document is resolved from the persisted sales order. */
  customerId?: string;
  /** @deprecated The fiscal document is resolved from the persisted sales order. */
  documentType?: LocalNcfDocumentType;
  paymentMethod: PosPaymentMethod;
  amountReceived?: number;
  cashSessionId?: string;
  orderId?: string;
  items?: Array<{
    productId: string;
    quantity: number;
  }>;
};

export type ReturnInvoiceLookup = Omit<Invoice, 'items'> & {
  salesOrder?: {
    id: string;
    orderNumber: string;
    status: string;
  } | null;
  items: Array<
    Invoice['items'][number] & {
      productId: string | null;
      returnedQuantity: string;
      remainingQuantity: string;
      canReturn: boolean;
      product: Product | null;
    }
  >;
};

export type ReturnRequest = {
  id: string;
  tenantId: string;
  invoiceId: string;
  requestedById: string;
  approvedById: string | null;
  rejectedById: string | null;
  cashSessionId: string | null;
  status: ReturnRequestStatus;
  reason: string;
  adminNote: string | null;
  refundMethod: string | null;
  refundAmount: string;
  creditAppliedAmount: string;
  cashRefundAmount: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  requestedBy: {
    id: string;
    name: string;
    email: string;
  };
  approvedBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
  rejectedBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
  cashSession?: CashSession | null;
  invoice: Omit<ReturnInvoiceLookup, 'items'> & {
    items: Array<
      Invoice['items'][number] & {
        productId: string | null;
        product: Product | null;
      }
    >;
  };
  items: Array<{
    id: string;
    returnRequestId: string;
    invoiceItemId: string;
    productId: string | null;
    description: string;
    quantity: string;
    unitPrice: string;
    discountTotal: string;
    taxRate: string;
    taxTotal: string;
    subtotal: string;
    total: string;
    restock: boolean;
    product: Product | null;
  }>;
};

export type CreateReturnRequestPayload = {
  invoiceId: string;
  reason: string;
  refundMethod?: string;
  items: Array<{
    invoiceItemId: string;
    quantity: number;
    restock?: boolean;
  }>;
};

export type SalesOrderPriceLevel = 'REGULAR' | 'DISCOUNT_10' | 'PREFERRED_18';
export type SalePaymentMode = 'CASH' | 'CREDIT';
export type InitialPaymentOption = 'NONE' | 'PERCENT_30' | 'PERCENT_50' | 'PERCENT_70';
export type CreditTermOption =
  | 'CUSTOMER_DEFAULT'
  | 'DAYS_15'
  | 'DAYS_30'
  | 'DAYS_45'
  | 'CUSTOM_DATE';
export type CreditApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

export type SalesOrder = {
  id: string;
  tenantId: string;
  customerId: string | null;
  destination: 'CASH_SALE' | 'QUOTATION';
  clientName: string | null;
  quotationDocumentType: string | null;
  quotationDocumentNumber: string | null;
  orderNumber: string;
  status: string;
  priceLevel: SalesOrderPriceLevel;
  discountRate: string;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  total: string;
  paymentMode: SalePaymentMode;
  fiscalPurpose: FiscalDocumentPurpose;
  fiscalDocumentTypeSnapshot: InvoiceDocumentType;
  fiscalCustomerSnapshot: FiscalCustomerSnapshot | null;
  initialPaymentOption: InitialPaymentOption | null;
  initialPaymentRate: string;
  initialPaymentAmount: string;
  creditTermOption: CreditTermOption | null;
  creditTermDays: number | null;
  dueDate: string | null;
  creditRequestNote: string | null;
  notes: string | null;
  createdById: string;
  completedById: string | null;
  claimedById: string | null;
  claimedCashSessionId: string | null;
  invoiceId: string | null;
  sentToCashierAt: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  releasedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  customer: Customer | null;
  createdBy: {
    id: string;
    name: string;
    email: string;
  };
  completedBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  claimedBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  claimedCashSession: {
    id: string;
    cashRegister: {
      id: string;
      name: string;
      location: string | null;
    };
  } | null;
  invoice: {
    id: string;
    invoiceNumber: string;
    total: string;
  } | null;
  creditApproval: CreditSaleApproval | null;
  items: Array<{
    id: string;
    salesOrderId: string;
    productId: string | null;
    sku: string | null;
    barcode: string | null;
    description: string;
    quantity: string;
    reservedQuantity: number;
    unitPrice: string;
    discountTotal: string;
    taxRate: string;
    taxTotal: string;
    subtotal: string;
    total: string;
    product: Product | null;
  }>;
};

export type CreateSalesOrderPayload = {
  destination: 'CASH_SALE' | 'QUOTATION';
  clientName?: string;
  customerId?: string;
  priceLevel?: SalesOrderPriceLevel;
  paymentMode?: SalePaymentMode;
  fiscalPurpose?: FiscalDocumentPurpose;
  initialPaymentOption?: InitialPaymentOption;
  creditTermOption?: CreditTermOption;
  customDueDate?: string;
  creditRequestNote?: string;
  quotationDocumentType?: 'RNC' | 'CEDULA';
  quotationDocumentNumber?: string;
  notes?: string;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
};

export type CreditSaleApproval = {
  id: string;
  tenantId: string;
  salesOrderId: string;
  customerId: string;
  status: CreditApprovalStatus;
  initialPaymentOption: InitialPaymentOption;
  creditTermOption: CreditTermOption;
  requestedTotal: string;
  initialPaymentAmount: string;
  financedAmount: string;
  customerBalanceSnapshot: string;
  creditLimitSnapshot: string;
  exceedsCreditLimit: boolean;
  dueDate: string;
  requestNote: string | null;
  decisionNote: string | null;
  requestedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  customer: Customer;
  requestedBy: {
    id: string;
    name: string;
    email: string;
  };
  approvedBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  rejectedBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  salesOrder: {
    id: string;
    orderNumber: string;
    status: string;
    clientName: string | null;
    total: string;
    createdBy: {
      id: string;
      name: string;
      email: string;
    };
    items: SalesOrder['items'];
  };
};

export type ReceivableDueBucket = 'OVERDUE' | 'TODAY' | 'DUE_SOON' | 'CURRENT' | 'PAID';

export type ReceivableInvoice = Invoice & {
  dueBucket: ReceivableDueBucket;
  issuedBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
  salesOrder?: {
    id: string;
    orderNumber: string;
    initialPaymentOption: InitialPaymentOption | null;
    creditTermOption: CreditTermOption | null;
  } | null;
  payments?: Array<
    NonNullable<Invoice['payments']>[number] & {
      user?: {
        id: string;
        name: string;
        email: string;
      } | null;
      cashSession?: CashSession | null;
      cancelledBy?: {
        id: string;
        name: string;
        email: string;
      } | null;
    }
  >;
};

export type ReceivableCustomerSummary = {
  id: string;
  name: string;
  documentType: string;
  documentNumber: string | null;
  creditEnabled: boolean;
  creditStatus: 'ACTIVE' | 'BLOCKED';
  creditLimit: string;
  creditTermDays: number;
  outstanding: string;
  overdue: string;
  invoiceCount: number;
};

export type CustomerStatement = {
  customer: Customer;
  generatedAt: string;
  totals: {
    total: string;
    paid: string;
    balance: string;
  };
  invoices: ReceivableInvoice[];
};

export type ReceivablePayment = {
  id: string;
  tenantId: string;
  invoiceId: string;
  method: 'CASH';
  amount: string;
  status: string;
  receiptNumber: string | null;
  cashSessionId: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  invoice: Invoice;
  user?: {
    id: string;
    name: string;
    email: string;
  } | null;
  cashSession?: CashSession | null;
  cancelledBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
};

export type Employee = {
  id: string;
  tenantId: string;
  userId: string;
  employeeCode: string | null;
  jobTitle: string | null;
  status: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    status: string;
    memberships: Array<{
      id: string;
      role: string;
      status: string;
      canUsePos: boolean;
      canOpenCashSession: boolean;
      canCloseCashSession: boolean;
      canApplyDiscount: boolean;
      canCancelInvoice: boolean;
      canVoidInvoice: boolean;
      canAdjustInventory: boolean;
      canManageProducts: boolean;
      canManageEmployees: boolean;
      canViewReports: boolean;
      canManageFiscalSequences: boolean;
      canViewCashLogs: boolean;
      canReprintReceipt: boolean;
      canTakeOrders: boolean;
    }>;
  };
};

export type CashSession = {
  id: string;
  status: string;
  openingAmount: string;
  closingAmount: string | null;
  expectedAmount: string | null;
  difference: string | null;
  openedAt: string;
  closedAt: string | null;
  cashRegister: {
    id: string;
    name: string;
    location: string | null;
  };
  openedBy?: {
    id: string;
    name: string;
    email: string;
  };
  closedBy?: {
    id: string;
    name: string;
    email: string;
  } | null;
  movements?: CashSessionMovement[];
  claimedSalesOrders?: SalesOrder[];
  invoices?: Invoice[];
};

export type CashSessionMovement = {
  id: string;
  type: string;
  amount: number | string;
  method: string | null;
  reason: string | null;
  reference: string | null;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  invoice?: {
    id: string;
    invoiceNumber: string;
    total: number | string;
  } | null;
};

export type CashRegister = {
  id: string;
  name: string;
  location: string | null;
  status: string;
};

export type CashMovement = {
  id: string;
  type: string;
  amount: number | string;
  method: string | null;
  reason: string | null;
  reference: string | null;
  cashierName?: string;
  registerName?: string;
  invoiceNumber?: string | null;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  cashSession?: CashSession;
};

export type EmployeeLog = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  amount: number | string | null;
  employeeName?: string;
  invoiceNumber?: string | null;
  createdAt: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
};

export type OperationalLogCategory = 'ORDER_TAKING' | 'QUOTATION' | 'POS_SALE';

export type OperationalLog = {
  id: string;
  category: OperationalLogCategory;
  action: string;
  entity: string;
  entityId: string | null;
  amount: number | string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  } | null;
  documentNumber: string | null;
  customerName: string | null;
  status: string | null;
  paymentMethod: string | null;
  cashRegisterName: string | null;
  detail: string | null;
};

export type FiscalSequence = {
  id: string;
  documentType: InvoiceDocumentType;
  prefix: string;
  startNumber: number;
  endNumber: number;
  nextNumber: number;
  authorizationNumber: string | null;
  issuerTaxId: string | null;
  validUntil: string | null;
  status: FiscalSequenceStatus;
};

export type CreateFiscalSequencePayload = {
  documentType: LocalNcfDocumentType;
  startNumber: number;
  endNumber: number;
  nextNumber: number;
  authorizationNumber: string;
  validUntil?: string;
};

export type ImportBatch = {
  id: string;
  type: string;
  filename: string;
  status: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  importedRows: number;
  createdAt: string;
  confirmedAt?: string | null;
  errorCount?: number;
  detailedRowCount?: number;
  hasDetailedRows?: boolean;
  hasLegacyErrorRows?: boolean;
  createdBy: {
    id: string;
    name: string;
    email: string;
  } | null;
  /**
   * Compatibilidad con lotes históricos. La lista de lotes puede omitirlos
   * para no descargar todos los errores; el detalle por filas vive en
   * GET /imports/:id/rows.
   */
  errors?: Array<{
    id: string;
    rowNumber: number;
    field: string | null;
    message: string;
  }>;
  /** Disponible en las importaciones con seguimiento por fila. */
  rowSummary?: {
    total?: number;
    imported?: number;
    failed?: number;
    importedRows?: number;
    failedRows?: number;
  } | null;
  _count?: {
    rows?: number;
    errors?: number;
  } | null;
};

export type ImportBatchRowStatus = 'IMPORTED' | 'FAILED';

export type ImportBatchRowReason = {
  field?: string | null;
  message: string;
};

export type ImportBatchRow = {
  id: string;
  rowNumber: number;
  status: ImportBatchRowStatus;
  productId?: string | null;
  productLabel?: string | null;
  rawData?: Record<string, unknown> | null;
  reasons: ImportBatchRowReason[];
};

export type ImportBatchRowsResponse = {
  batch: ImportBatch;
  rows: ImportBatchRow[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type ProductImageUploadResult = {
  imageUrl: string;
  path: string;
  bucket: string;
};

export type SupplierStatus = 'ACTIVE' | 'INACTIVE';

export type SupplierProduct = {
  id: string;
  supplierId: string;
  productId: string;
  supplierSku: string | null;
  lastCostNet: string | null;
  lastCostWithTax: string | null;
  leadTimeDays: number | null;
  isPrimary: boolean;
  active: boolean;
  product: Pick<
    Product,
    'id' | 'name' | 'sku' | 'barcode' | 'status' | 'cost' | 'price' | 'salePrice' | 'taxRate'
  >;
};

export type Supplier = {
  id: string;
  tenantId: string;
  commercialName: string;
  legalName: string | null;
  documentType: 'RNC' | 'CEDULA';
  documentNumber: string;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  address: string | null;
  paymentTerms: string | null;
  creditDays: number;
  notes: string | null;
  status: SupplierStatus;
  deactivatedAt: string | null;
  taxIdentityVerification: TaxIdentityVerificationEvidence | null;
  createdAt: string;
  updatedAt: string;
  products?: SupplierProduct[];
  _count?: {
    products: number;
  };
};

export type SupplierPayload = {
  commercialName: string;
  legalName?: string;
  documentType: 'RNC' | 'CEDULA';
  documentNumber: string;
  phone?: string;
  email?: string;
  address?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  paymentTerms?: string;
  creditDays?: number;
  notes?: string;
  status?: SupplierStatus;
  taxIdentityOverrideId?: string;
  taxIdentityContextId?: string;
};

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'REQUESTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'ISSUED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'PAUSED'
  | 'CANCELLED';

export type PurchaseOrderItem = {
  id: string;
  productId: string;
  supplierProductId: string | null;
  skuSnapshot: string | null;
  barcodeSnapshot: string | null;
  descriptionSnapshot: string;
  unitSnapshot: string;
  supplierSkuSnapshot: string | null;
  quantity: string;
  receivedQuantity: string;
  unitCostNet: string;
  unitCostWithTax: string;
  discountTotal: string;
  taxRate: string;
  taxTotal: string;
  subtotal: string;
  total: string;
  product: Product;
  supplierProduct: SupplierProduct | null;
};

export type PurchaseOrder = {
  id: string;
  tenantId: string;
  supplierId: string;
  orderNumber: string;
  status: PurchaseOrderStatus;
  displayStatus: PurchaseOrderStatus | 'OVERDUE';
  isOverdue: boolean;
  currency: 'DOP';
  requestDate: string | null;
  expectedDeliveryDate: string | null;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  total: string;
  notes: string | null;
  supplierNameSnapshot: string;
  supplierDocumentTypeSnapshot: 'RNC' | 'CEDULA';
  supplierDocumentNumberSnapshot: string;
  supplierContactSnapshot: string | null;
  supplierAddressSnapshot: string | null;
  requestedAt: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  issuedAt: string | null;
  pausedAt: string | null;
  cancelledAt: string | null;
  pauseReason: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  supplier: Supplier;
  items: PurchaseOrderItem[];
  events: Array<{
    id: string;
    fromStatus: PurchaseOrderStatus | null;
    toStatus: PurchaseOrderStatus;
    note: string | null;
    createdAt: string;
    createdBy: { id: string; name: string; email: string };
  }>;
  createdBy: { id: string; name: string; email: string };
  requestedBy: { id: string; name: string; email: string } | null;
  reviewedBy: { id: string; name: string; email: string } | null;
  approvedBy: { id: string; name: string; email: string } | null;
  issuedBy: { id: string; name: string; email: string } | null;
  supplierInvoice: { id: string; invoiceNumber: string; status: string } | null;
  goodsReceipts: Array<{ id: string; receiptNumber: string; status: string }>;
};

export type PurchaseOrderPayload = {
  supplierId: string;
  expectedDeliveryDate?: string;
  notes?: string;
  items: Array<{
    productId: string;
    quantity: number;
    unitCostNet: number;
    taxRate?: number;
    discountTotal?: number;
  }>;
};

export type SupplierInvoiceStatus = 'DRAFT' | 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';

export type SupplierInvoiceItem = {
  id: string;
  supplierInvoiceId: string;
  purchaseOrderItemId: string | null;
  productId: string;
  skuSnapshot: string | null;
  barcodeSnapshot: string | null;
  descriptionSnapshot: string;
  unitSnapshot: string;
  quantity: string;
  unitCostNet: string;
  unitCostWithTax: string;
  discountTotal: string;
  taxRate: string;
  taxTotal: string;
  subtotal: string;
  total: string;
  product: Pick<Product, 'id' | 'name' | 'sku' | 'barcode' | 'unit' | 'status'>;
  purchaseOrderItem: {
    id: string;
    quantity: string;
    receivedQuantity: string;
    productId: string;
  } | null;
};

export type SupplierPayment = {
  id: string;
  paymentNumber: string;
  method: 'CASH' | 'TRANSFER' | 'CHECK';
  amount: string;
  tenderedAmount: string;
  changeAmount: string;
  status: string;
  cashSessionId: string | null;
  reference: string | null;
  notes: string | null;
  paidAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdBy: { id: string; name: string; email: string };
  cancelledBy: { id: string; name: string; email: string } | null;
  cashSession: {
    id: string;
    status: string;
    openedAt: string;
    closedAt: string | null;
    cashRegister: { id: string; name: string };
  } | null;
};

export type SupplierInvoice = {
  id: string;
  tenantId: string;
  supplierId: string;
  purchaseOrderId: string | null;
  invoiceNumber: string;
  ncf: string | null;
  issueDate: string;
  dueDate: string | null;
  ncfValidUntil: string | null;
  paymentCondition: string | null;
  currency: 'DOP';
  status: SupplierInvoiceStatus;
  displayStatus: SupplierInvoiceStatus | 'OVERDUE';
  isOverdue: boolean;
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  total: string;
  paidAmount: string;
  balance: string;
  notes: string | null;
  supplierNameSnapshot: string;
  supplierDocumentTypeSnapshot: 'RNC' | 'CEDULA';
  supplierDocumentNumberSnapshot: string;
  supplierAddressSnapshot: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  supplier: Supplier;
  purchaseOrder: {
    id: string;
    orderNumber: string;
    status: PurchaseOrderStatus;
    expectedDeliveryDate?: string | null;
  } | null;
  items?: SupplierInvoiceItem[];
  payments?: SupplierPayment[];
  goodsReceipts?: Array<{
    id: string;
    receiptNumber: string;
    status: string;
    confirmedAt: string | null;
    createdAt: string;
  }>;
  createdBy: { id: string; name: string; email: string };
  updatedBy?: { id: string; name: string; email: string } | null;
  cancelledBy?: { id: string; name: string; email: string } | null;
  _count?: {
    items: number;
    payments: number;
    goodsReceipts: number;
  };
};

export type SupplierInvoicePayload = {
  supplierId: string;
  purchaseOrderId?: string;
  invoiceNumber: string;
  ncf?: string;
  issueDate: string;
  dueDate: string;
  ncfValidUntil?: string;
  paymentCondition?: string | null;
  notes?: string;
  ocrReview?: {
    pageCount?: number;
    detectedTotal?: number;
    totalMismatchAccepted?: boolean;
    warnings?: string[];
  };
  items: Array<{
    productId: string;
    purchaseOrderItemId?: string;
    quantity: number;
    unitCostNet: number;
    taxRate: number;
    discountTotal?: number;
  }>;
};

/**
 * Short-lived OCR suggestion sent by a paired phone. It deliberately omits the
 * complete text source and any image/file data; individual item labels are
 * reconstructed server-side from the structured code and description.
 */
export type MobileOcrCaptureResult = Omit<SupplierInvoiceOcrResult, 'rawText' | 'items'> & {
  items: Array<Omit<SupplierInvoiceOcrItem, 'rawText'> & { rawText?: string }>;
};

export type MobileOcrCaptureStatus = 'PENDING' | 'READY' | 'CONSUMED' | 'EXPIRED' | 'CANCELLED';

export type MobileOcrCapture = {
  id: string;
  token: string;
  expiresAt: string;
  status: MobileOcrCaptureStatus;
};

export type MobileOcrCaptureStatusResponse = Pick<MobileOcrCapture, 'id' | 'status' | 'expiresAt'>;

export type PayablesSummary = {
  asOf: string;
  invoiceCount: number;
  openInvoiceCount: number;
  overdueCount: number;
  dueTodayCount: number;
  dueSoonCount: number;
  paidInvoiceCount: number;
  totalInvoiced: string;
  paidAmount: string;
  outstandingBalance: string;
  overdueBalance: string;
  dueTodayBalance: string;
  dueSoonBalance: string;
  laterOrNoDueBalance: string;
  bySupplier: Array<{
    supplierId: string;
    supplierName: string;
    invoiceCount: number;
    overdueCount: number;
    outstandingBalance: string;
    overdueBalance: string;
  }>;
};

export type GoodsReceiptStatus = 'DRAFT' | 'CONFIRMED' | 'REVERSED' | 'CANCELLED';
export type ReceiptPriceDecision = 'KEEP' | 'RECALCULATE_MARGIN' | 'MANUAL';

export type GoodsReceiptItem = {
  id: string;
  supplierInvoiceItemId: string;
  purchaseOrderItemId: string | null;
  productId: string;
  quantityOrdered: string | null;
  quantityInvoiced: string;
  quantityReceived: string;
  quantityDifference: string;
  cumulativeReceived: string;
  cumulativeDifference: string;
  quantityRemaining: string;
  projectedCumulativeReceived: string;
  projectedDifference: string;
  projectedRemaining: string;
  differenceAccepted: boolean;
  differenceNote: string | null;
  lotNumber: string | null;
  serialNumber: string | null;
  expirationDate: string | null;
  previousCostNet: string | null;
  newCostNet: string;
  previousCostWithTax: string | null;
  newCostWithTax: string;
  priceDecision: ReceiptPriceDecision;
  previousSalePrice: string;
  suggestedSalePrice: string | null;
  finalSalePrice: string | null;
  previousStock: number | null;
  newStock: number | null;
  product: Pick<
    Product,
    'id' | 'name' | 'sku' | 'barcode' | 'unit' | 'stock' | 'cost' | 'price' | 'salePrice'
  > & { costWithTax?: string | null; margin?: string | null };
  supplierInvoiceItem: Pick<
    SupplierInvoiceItem,
    | 'id'
    | 'descriptionSnapshot'
    | 'quantity'
    | 'unitCostNet'
    | 'unitCostWithTax'
    | 'taxRate'
    | 'total'
  >;
  purchaseOrderItem: {
    id: string;
    quantity: string;
    receivedQuantity: string;
  } | null;
};

export type GoodsReceipt = {
  id: string;
  tenantId: string;
  supplierId: string;
  purchaseOrderId: string | null;
  supplierInvoiceId: string;
  receiptNumber: string;
  status: GoodsReceiptStatus;
  notes: string | null;
  confirmedAt: string | null;
  reversedAt: string | null;
  cancelledAt: string | null;
  reversalReason: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  supplier: Pick<
    Supplier,
    'id' | 'commercialName' | 'legalName' | 'documentType' | 'documentNumber'
  >;
  supplierInvoice: Pick<
    SupplierInvoice,
    'id' | 'invoiceNumber' | 'ncf' | 'issueDate' | 'dueDate' | 'status' | 'total' | 'currency'
  >;
  purchaseOrder: {
    id: string;
    orderNumber: string;
    status: PurchaseOrderStatus;
    expectedDeliveryDate: string | null;
  } | null;
  items: GoodsReceiptItem[];
  quantitySummary: {
    itemCount: number;
    totalQuantityReceived: string;
    itemsWithDifference: number;
  };
  createdBy: { id: string; name: string; email: string };
  confirmedBy: { id: string; name: string; email: string } | null;
  reversedBy: { id: string; name: string; email: string } | null;
  cancelledBy: { id: string; name: string; email: string } | null;
};

export type GoodsReceiptPayload = {
  supplierInvoiceId: string;
  notes?: string;
  /**
   * Se usa únicamente al confirmar una entrada desde una factura ligada a una
   * orden de compra. El servidor vuelve a calcular las diferencias y exige
   * esta aceptación cuando existen.
   */
  orderReconciliationAccepted?: boolean;
  orderReconciliationNote?: string;
  items: Array<{
    supplierInvoiceItemId: string;
    quantityReceived: number;
    differenceAccepted?: boolean;
    differenceNote?: string;
    lotNumber?: string;
    serialNumber?: string;
    expirationDate?: string;
    priceDecision?: ReceiptPriceDecision;
    manualSalePrice?: number;
  }>;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL;

if (!apiUrl) {
  throw new Error(
    'NEXT_PUBLIC_API_URL is required to connect the frontend with the CoreStack API.',
  );
}

const apiMessageTranslations: Record<string, string> = {
  'Missing bearer token.': 'Falta el token de sesion.',
  'Invalid or expired token.': 'La sesion no es valida o expiro.',
  'User is not active.': 'El usuario no esta activo.',
  'Missing x-tenant-id header.': 'Falta identificar la empresa de trabajo.',
  'Missing x-tenant-id header for tenant-scoped request.':
    'Falta identificar la empresa de trabajo.',
  'Authenticated user is required.': 'Debes iniciar sesion para continuar.',
  'User does not belong to this tenant.': 'Tu usuario no pertenece a esta empresa.',
  'Role checks require authenticated tenant context.':
    'No se pudo validar el rol para esta empresa.',
  'Insufficient role for this operation.': 'Tu rol no permite realizar esta operacion.',
  'Invalid credentials.': 'Credenciales invalidas.',
  'Tenant not found.': 'Empresa no encontrada.',
  'This user already belongs to this tenant.': 'Este usuario ya pertenece a esta empresa.',
  'Tenant user limit reached.': 'La empresa ya tiene el limite de 5 usuarios activos.',
  'Employee not found for tenant.': 'Empleado no encontrado en esta empresa.',
  'Employee membership not found.': 'No se encontro la membresia del empleado.',
  'Employee management permission is required.': 'Necesitas permiso para gestionar empleados.',
  'This role cannot be assigned to a tenant employee.':
    'Este rol no puede asignarse a un empleado de la empresa.',
  'At least one active admin must remain for the tenant.':
    'Debe quedar al menos un administrador activo en la empresa.',
  'Customer not found for tenant.': 'Cliente no encontrado en esta empresa.',
  'Product not found for tenant.': 'Producto no encontrado en esta empresa.',
  'Product category not found for tenant.': 'Categoria de producto no encontrada en esta empresa.',
  'Product code already exists for this tenant.':
    'Ese codigo de producto ya existe en esta empresa.',
  'No active product found for barcode.': 'No se encontro un producto activo con ese codigo.',
  'Inventory movement would leave product stock below zero.':
    'El movimiento dejaria el inventario del producto por debajo de cero.',
  'Invoice must include at least one item.': 'La factura debe incluir al menos un producto.',
  'Invoice items must reference products so totals are recalculated from database.':
    'Los productos de la factura deben existir para recalcular los totales desde la base de datos.',
  'One or more invoice products do not belong to tenant.':
    'Uno o mas productos de la factura no pertenecen a esta empresa.',
  'Tracked inventory products require integer quantities.':
    'Los productos con inventario requieren cantidades enteras.',
  'Tracked inventory products require whole quantities.':
    'Este producto requiere cantidades completas.',
  'Invoice not found for tenant.': 'Factura no encontrada en esta empresa.',
  'Sale must include at least one item.': 'La venta debe incluir al menos un producto.',
  'Fiscal credit invoices require an RNC customer.':
    'Las facturas de credito fiscal requieren un cliente con RNC.',
  'Only local B01 and B02 invoices are enabled.':
    'Solo estan habilitados los comprobantes locales B01 y B02.',
  'B01 requires a customer with a valid RNC or Dominican ID.':
    'La factura B01 requiere un cliente con RNC o cedula dominicana valida.',
  'B02 invoices of RD$250,000 or more before ITBIS require an identified customer.':
    'Una factura B02 de RD$250,000 o mas antes de ITBIS requiere identificar al cliente.',
  'Issuer tax identity, legal name, commercial name, address, phone, and email must be configured.':
    'Configura la identificacion fiscal, razon social, nombre comercial, direccion, telefono y correo del emisor.',
  'B01 and B02 require the DGII authorization number.':
    'B01 y B02 requieren el numero de autorizacion de la DGII.',
  'B01 requires its DGII expiration date.':
    'B01 requiere la fecha de vencimiento asignada por la DGII.',
  'Configure a valid issuer RNC or Dominican ID before registering fiscal sequences.':
    'Configura primero el RNC o la cédula válida del emisor.',
  'The fiscal sequence authorization is already expired.':
    'La autorizacion de la secuencia fiscal ya esta vencida.',
  'Fiscal sequence start cannot exceed its end.':
    'El inicio de la secuencia no puede superar el final.',
  'Next fiscal number must be inside the authorized range.':
    'El siguiente NCF debe estar dentro del rango autorizado.',
  'An active fiscal sequence already exists for this type.':
    'Ya existe una secuencia fiscal activa para este tipo.',
  'The authorized range overlaps a sequence already registered.':
    'El rango autorizado se superpone con otra secuencia registrada.',
  'An active or overlapping fiscal sequence was created concurrently.':
    'Otra sesion registro una secuencia activa o superpuesta al mismo tiempo.',
  'Only issued local B01 or B02 invoices with a valid NCF can be printed.':
    'Solo se pueden imprimir facturas locales B01 o B02 emitidas con un NCF valido.',
  'The first print is restricted to the issuing cashier or an administrator.':
    'La primera impresion solo puede realizarla el cajero emisor o un administrador.',
  'Receipt reprint permission is required.': 'Necesitas permiso para reimprimir facturas.',
  'One or more POS products do not belong to tenant.':
    'Uno o mas productos de la venta no pertenecen a esta empresa.',
  'No active fiscal sequence available for this document type.':
    'No hay una secuencia fiscal activa disponible para este tipo de comprobante.',
  'This cash register or cashier already has an open session.':
    'Esta caja o este cajero ya tiene una sesion abierta. Cierra la sesion abierta antes de abrir otra.',
  'This cash register already has an open session.':
    'Esta caja ya tiene una sesion abierta. Selecciona otra caja o cierra la sesion abierta.',
  'Cash register not found for tenant.': 'Caja no encontrada en esta empresa.',
  'Open cash session not found for tenant.':
    'No se encontro una sesion de caja abierta en esta empresa.',
  'Manual cash movements must be cash in, cash out, or adjustment.':
    'Los movimientos manuales de caja deben ser entrada, salida o ajuste.',
  'Employee does not have permission for this cash operation.':
    'Tu usuario no tiene permiso para esta operacion de caja.',
  'Admins cannot open cash sessions.': 'El administrador no puede abrir caja.',
  'Employee does not have permission to view cash logs.':
    'Tu usuario no tiene permiso para ver los logs de caja.',
  'An open cash session for this cashier is required to complete POS sales.':
    'Debes abrir una caja con tu usuario antes de completar ventas.',
  'Employee does not have POS access.': 'Tu usuario no tiene permiso para usar la caja.',
  'Employee profile must be active to use POS.':
    'El perfil del empleado debe estar activo para usar el POS.',
  'Cashier can only charge orders sent to cashier.':
    'El cajero solo puede cobrar ordenes enviadas a caja.',
  'Only admins can create direct POS sales.':
    'Solo el administrador puede crear ventas directas desde el POS.',
  'Amount received cannot be negative.': 'El monto recibido no puede ser negativo.',
  'Cash received must cover the invoice total.':
    'El efectivo recibido debe cubrir el total de la factura.',
  'Payment amount must cover the invoice total.':
    'El monto pagado debe cubrir el total de la factura.',
  'Sales order must include at least one item.': 'La orden debe incluir al menos un producto.',
  'Pending sales order not found for tenant.': 'Orden pendiente no encontrada en esta empresa.',
  'Sales order not found for tenant.': 'Orden no encontrada en esta empresa.',
  'Sales order contains an unavailable product.': 'La orden contiene un producto no disponible.',
  'One or more order products do not belong to tenant.':
    'Uno o mas productos de la orden no pertenecen a esta empresa.',
  'Invalid sales order status.': 'Estado de orden invalido.',
  'Employee does not have permission to take orders.':
    'Tu usuario no tiene permiso para tomar ordenes.',
  'Employee does not have permission to view sales orders.':
    'Tu usuario no tiene permiso para ver ordenes.',
  'Employee does not have permission to view this sales order.':
    'Tu usuario no tiene permiso para ver esta orden.',
  'Employee does not have permission to cancel this sales order.':
    'Tu usuario no tiene permiso para cancelar esta orden.',
  'Employee profile must be active to take orders.':
    'El perfil del empleado debe estar activo para tomar ordenes.',
  'Only pending sales orders can be cancelled.': 'Solo las ordenes pendientes pueden cancelarse.',
  'Sales order has already been completed.': 'Esta orden ya fue cobrada.',
  'Sales order has already been cancelled.': 'Esta orden ya fue cancelada.',
  'Sales order is already claimed by another cashier.':
    'Esta orden ya esta siendo atendida por otro cajero.',
  'Only claimed sales orders can be released.': 'Solo se pueden liberar ordenes tomadas por caja.',
  'Employee does not have permission to release this sales order.':
    'Tu usuario no puede liberar esta orden.',
  'An open cash session for this cashier is required to claim sales orders.':
    'Debes abrir caja antes de tomar una orden para cobrar.',
  'Close pending claimed sales orders before closing cash session.':
    'Libera o cobra las ordenes tomadas antes de cerrar la caja.',
  'Could not reserve fiscal sequence.':
    'No se pudo reservar la secuencia fiscal. Intenta nuevamente.',
  'Could not generate a unique barcode.': 'No se pudo generar un codigo de barras unico.',
  'Could not generate a unique product code.': 'No se pudo generar un codigo de producto unico.',
  'Product must have a barcode before printing labels.':
    'El producto debe tener codigo de barras antes de imprimir etiquetas.',
  'Barcode already exists for this tenant.': 'Ese codigo de barras ya existe en esta empresa.',
  'Product image file is required.': 'Debes seleccionar una imagen de producto.',
  'Product image must be JPG, PNG, WEBP, or GIF.': 'La imagen debe ser JPG, PNG, WEBP o GIF.',
  'Product image cannot be larger than 5 MB.': 'La imagen no puede pesar mas de 5 MB.',
  'Product image storage is not configured.': 'El almacenamiento de imagenes no esta configurado.',
  'Product image could not be uploaded.': 'No se pudo subir la imagen del producto.',
  'Product unit requires whole inventory quantities.':
    'Esta unidad requiere cantidades completas en inventario.',
  'Import file is required.': 'Debes seleccionar un archivo de importacion.',
  'Import file cannot be larger than 10 MB.':
    'El archivo de importacion no puede pesar mas de 10 MB.',
  'Import file does not contain sheets.': 'El archivo no contiene hojas para importar.',
  'Opening amount must be greater than zero.': 'El monto inicial debe ser mayor que 0.',
  'Admins cannot complete POS sales. Cashiers must charge orders.':
    'El administrador no puede cobrar en caja. El cajero debe cobrar la orden.',
  'Direct POS sales are disabled. Load an order to charge.':
    'Las ventas directas estan deshabilitadas. Carga una orden para cobrar.',
  'Admins cannot claim sales orders for charging.':
    'El administrador no puede tomar ordenes para cobrar en caja.',
  'Invoice number is required for return lookup.':
    'Debes escribir el numero de factura u orden para buscar la devolucion.',
  'Invoice not found for return lookup.': 'No se encontro una factura con ese numero.',
  'Invoice status does not allow returns.': 'El estado de esta factura no permite devoluciones.',
  'Return reason is required.': 'Debes indicar el motivo de la devolucion.',
  'Return request must include at least one item.':
    'La solicitud debe incluir al menos un producto.',
  'Return quantities must be greater than zero.':
    'Las cantidades a devolver deben ser mayores que cero.',
  'Return item does not belong to the selected invoice.':
    'Uno de los productos no pertenece a la factura seleccionada.',
  'Return quantity exceeds invoice remaining quantity.':
    'La cantidad a devolver supera lo disponible en la factura.',
  'Return request not found for tenant.': 'Solicitud de devolucion no encontrada en esta empresa.',
  'Only requested returns can be approved.': 'Solo se pueden aprobar devoluciones solicitadas.',
  'Only requested returns can be rejected.': 'Solo se pueden rechazar devoluciones solicitadas.',
  'Return rejection reason is required.': 'Debes indicar el motivo del rechazo.',
  'Employee does not have permission to request returns.':
    'Tu usuario no tiene permiso para solicitar devoluciones.',
  'Only admins can approve or reject returns.':
    'Solo administradores pueden aprobar o rechazar devoluciones.',
  'An open cash session is required to approve a return.':
    'Debe haber una caja abierta para aprobar una devolucion.',
  'Select an open cash session for this refund.':
    'Selecciona la caja abierta que entregara el reembolso.',
  'Invalid return request status.': 'Estado de devolucion invalido.',
  'Quotation requires client name.': 'El nombre del cliente es requerido para la cotizacion.',
  'Quotation document type and document number must be provided together.':
    'Si indicas un documento, selecciona su tipo y escribe el numero completo.',
  'Quotation requires document type and document number.':
    'La cotizacion requiere tipo y numero de documento.',
  'Quotation document type must be RNC or CEDULA.':
    'El tipo de documento de la cotizacion debe ser RNC o cedula.',
  'El RNC debe tener 9 digitos.': 'El RNC debe tener 9 digitos.',
  'El RNC no es valido.': 'El RNC no es valido.',
  'La cedula debe tener 11 digitos.': 'La cedula debe tener 11 digitos.',
  'La cedula no es valida.': 'La cedula no es valida.',
  'Purchase order access is required.': 'No tienes acceso a las órdenes de compra.',
  'Administrator approval is required.':
    'Esta acción requiere la autorización de un administrador.',
  'Purchase order not found for tenant.': 'No se encontró la orden de compra.',
  'Active supplier not found for tenant.': 'No se encontró un suplidor activo.',
  'Only draft purchase orders can be edited.':
    'Solo se pueden editar órdenes de compra en borrador.',
  'Changing the supplier requires resubmitting all purchase order items.':
    'Para cambiar el suplidor debes volver a enviar todos los productos de la orden.',
  'A reason is required to pause a purchase order.':
    'Debes indicar el motivo para pausar la orden de compra.',
  'A reason is required to cancel a purchase order.':
    'Debes indicar el motivo para cancelar la orden de compra.',
  'A received purchase order cannot be cancelled.':
    'No se puede cancelar una orden que ya recibió mercancía.',
  'A product can only appear once in a purchase order.':
    'Un producto solo puede aparecer una vez en la orden de compra.',
  'One or more products are unavailable for this tenant.':
    'Uno o más productos de la orden no están disponibles.',
  'Invalid purchase order status.': 'El estado de la orden de compra no es válido.',
  'The initial due date cannot be after the final due date.':
    'La fecha inicial no puede ser posterior a la fecha final.',
  'Supplier invoice not found for tenant.': 'No se encontró la factura del suplidor.',
  'At least one field is required to update the invoice.':
    'Debes indicar al menos un dato para actualizar la factura.',
  'Only draft supplier invoices can be edited.':
    'Solo se pueden editar facturas de suplidor en borrador.',
  'Only draft supplier invoices can be registered.':
    'Solo se pueden registrar facturas de suplidor en borrador.',
  'A supplier invoice must contain at least one product.':
    'La factura del suplidor debe contener al menos un producto.',
  'Supplier invoice is already cancelled.': 'La factura del suplidor ya está cancelada.',
  'A supplier invoice with confirmed goods receipts cannot be cancelled.':
    'No puedes cancelar una factura con recepciones confirmadas.',
  'Cancel completed supplier payments before cancelling the invoice.':
    'Anula primero los pagos completados antes de cancelar la factura.',
  'Open cash session not found for this tenant.': 'No se encontró la caja abierta seleccionada.',
  'Supplier payment cannot exceed invoice balance.':
    'El pago no puede superar el saldo pendiente de la factura.',
  'Tendered amount must equal the applied amount for transfers and checks.':
    'En transferencias y cheques, el monto entregado debe coincidir con el monto aplicado.',
  'Supplier invoice has no pending balance to pay.':
    'La factura no tiene saldo pendiente para pagar.',
  'Only pending or partially paid supplier invoices accept payments.':
    'Solo las facturas pendientes o parcialmente pagadas aceptan pagos.',
  'Cash supplier payments require a cash session.':
    'Los pagos en efectivo requieren seleccionar una caja abierta.',
  'Only cash supplier payments can reference a cash session.':
    'Solo los pagos en efectivo pueden vincularse a una caja.',
  'Supplier invoice due date cannot be before its issue date.':
    'El vencimiento no puede ser anterior a la fecha de emisión.',
  'Supplier invoice NCF validity cannot be before its issue date.':
    'La vigencia fiscal del NCF no puede ser anterior a la fecha de emisión.',
  'Supplier invoice due date is required.': 'La fecha de vencimiento de la factura es obligatoria.',
  'Supplier payment not found for this invoice and tenant.':
    'No se encontró el pago de esta factura.',
  'Only completed supplier payments can be cancelled.': 'Solo se pueden anular pagos completados.',
  'Payments on a cancelled invoice cannot be changed.':
    'No se pueden cambiar pagos de una factura cancelada.',
  'This supplier already has an invoice with the same number.':
    'Este suplidor ya tiene una factura con el mismo número.',
  'This supplier already has an invoice with the same NCF.':
    'Este suplidor ya tiene una factura con el mismo NCF.',
  'Purchase order and supplier invoice must use the same supplier.':
    'La orden de compra y la factura deben pertenecer al mismo suplidor.',
  'Supplier invoices can only use issued or received purchase orders.':
    'Solo puedes vincular órdenes emitidas o recibidas.',
  'This purchase order already has a supplier invoice.':
    'Esta orden de compra ya tiene una factura vinculada.',
  'One or more supplier invoice products do not belong to this tenant.':
    'Uno o más productos de la factura no pertenecen a esta empresa.',
  'The accounting record changed concurrently. Try the operation again.':
    'El registro cambió mientras se procesaba. Actualiza e inténtalo nuevamente.',
  'Mobile OCR capture session was not found.':
    'La sesión temporal de captura ya no está disponible.',
  'Mobile OCR capture session has expired.':
    'El código de captura venció. Genera uno nuevo para continuar.',
  'The mobile OCR result is not ready yet.': 'La lectura del teléfono todavía no está lista.',
  'The mobile OCR result was already consumed or expired.':
    'La lectura del teléfono ya fue usada o venció.',
  'The mobile OCR result was already sent.': 'Esta lectura ya fue enviada a la computadora.',
  'The mobile OCR capture is no longer available.':
    'La captura desde el teléfono ya no está disponible.',
  'Too many mobile OCR attempts. Try again in a few minutes.':
    'Demasiados intentos de captura. Espera unos minutos e inténtalo de nuevo.',
};

async function fetchJson<T>(path: string, options?: RequestInit) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(getApiErrorMessage(body, response.status));
  }

  if (response.status === 204) {
    return null as T;
  }

  const body = await response.text();

  if (!body.trim()) {
    return null as T;
  }

  return JSON.parse(body) as T;
}

async function fetchFormData<T>(path: string, formData: FormData, headers: Record<string, string>) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(getApiErrorMessage(body, response.status));
  }

  const body = await response.text();

  if (!body.trim()) {
    return null as T;
  }

  return JSON.parse(body) as T;
}

async function fetchBlob(path: string, headers: Record<string, string>) {
  const response = await fetch(`${apiUrl}${path}`, { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(getApiErrorMessage(body, response.status));
  }
  return response.blob();
}

function getApiErrorMessage(body: string, status: number) {
  if (!body) {
    return `No se pudo completar la solicitud (${status}).`;
  }

  try {
    const parsed = JSON.parse(body) as { message?: string | string[] };
    const message = Array.isArray(parsed.message)
      ? parsed.message.map(translateApiMessage).join(', ')
      : parsed.message;

    if (message) {
      return translateApiMessage(message);
    }
  } catch {
    // The API occasionally returns plain text from proxies/dev servers.
  }

  return translateApiMessage(body);
}

function translateApiMessage(message: string) {
  if (apiMessageTranslations[message]) {
    return apiMessageTranslations[message];
  }

  if (message.startsWith('Insufficient stock for ') && message.endsWith('.')) {
    const productName = message.replace('Insufficient stock for ', '').replace(/\.$/, '');
    return `Stock insuficiente para ${productName}.`;
  }

  if (message.startsWith('No active B') && message.endsWith(' sequence is configured.')) {
    const prefix = message.split(' ')[2];
    return `No hay una secuencia ${prefix} activa configurada.`;
  }

  if (message.startsWith('The active B') && message.endsWith(' sequence is expired.')) {
    const prefix = message.split(' ')[2];
    return `La secuencia ${prefix} activa esta vencida.`;
  }

  if (message.startsWith('The active B') && message.endsWith(' sequence is exhausted.')) {
    const prefix = message.split(' ')[2];
    return `La secuencia ${prefix} activa esta agotada.`;
  }

  if (
    message.startsWith('The active B') &&
    message.endsWith(' sequence belongs to a different issuer tax identity.')
  ) {
    const prefix = message.split(' ')[2];
    return `La secuencia ${prefix} pertenece a otro RNC o cédula del emisor.`;
  }

  if (message.startsWith('Insufficient available stock for ') && message.endsWith('.')) {
    const productName = message.replace('Insufficient available stock for ', '').replace(/\.$/, '');
    return `Stock disponible insuficiente para ${productName}.`;
  }

  if (message.startsWith('Tracked product ') && message.endsWith(' requires whole quantities.')) {
    const productName = message
      .replace('Tracked product ', '')
      .replace(' requires whole quantities.', '');
    return `${productName} requiere cantidades completas.`;
  }

  if (message.startsWith('Product unit ') && message.includes(' requires whole quantities for ')) {
    const field = message.split(' requires whole quantities for ')[1]?.replace(/\.$/, '');
    return `La unidad seleccionada requiere cantidades completas${field ? ` en ${field}` : ''}.`;
  }

  if (message.startsWith('Purchase order cannot move from ') && message.includes(' to ')) {
    return 'La orden de compra cambió de estado y ya no admite esa acción.';
  }

  if (message.startsWith('Discount exceeds subtotal for ')) {
    return 'El descuento de un producto supera su subtotal.';
  }

  if (message.startsWith('Discount exceeds the gross subtotal for ')) {
    return 'El descuento de un producto supera su subtotal bruto.';
  }

  return message;
}

export function getTenants() {
  return fetchJson<Tenant[]>('/tenants');
}

export function login(email: string, password: string) {
  return fetchJson<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

function tenantHeaders(tenantId: string, accessToken: string) {
  return {
    'x-tenant-id': tenantId,
    Authorization: `Bearer ${accessToken}`,
  };
}

export function getDashboardSummary(tenantId: string, accessToken: string) {
  return fetchJson<DashboardSummary>('/dashboard/summary', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getOperationalAlerts(tenantId: string, accessToken: string) {
  return fetchJson<OperationalAlertsSummary>('/dashboard/alerts', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getProductSalesRanking(
  tenantId: string,
  accessToken: string,
  query: ProductSalesQuery = {},
) {
  const searchParams = new URLSearchParams();
  if (query.from) searchParams.set('from', query.from);
  if (query.to) searchParams.set('to', query.to);
  const suffix = searchParams.size ? `?${searchParams.toString()}` : '';

  return fetchJson<ProductSalesRanking>(`/dashboard/product-sales${suffix}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getCustomers(tenantId: string, accessToken: string) {
  return fetchJson<Customer[]>('/customers', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function lookupTaxIdentity(
  tenantId: string,
  accessToken: string,
  payload: {
    documentType: TaxIdentityDocumentType;
    documentNumber: string;
  },
) {
  return fetchJson<TaxIdentityLookup>('/tax-identities/lookup', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function authorizeTaxIdentityOverride(
  tenantId: string,
  accessToken: string,
  payload: TaxIdentityOverridePayload,
) {
  return fetchJson<TaxIdentityOverrideResult>('/tax-identities/overrides', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function createCustomer(
  tenantId: string,
  accessToken: string,
  payload: Record<string, string | undefined>,
) {
  return fetchJson<Customer>('/customers', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function updateCustomer(
  tenantId: string,
  accessToken: string,
  customerId: string,
  payload: Record<string, string | undefined>,
) {
  return fetchJson<Customer>(`/customers/${customerId}`, {
    method: 'PATCH',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function deleteCustomer(tenantId: string, accessToken: string, customerId: string) {
  return fetchJson<Customer>(`/customers/${customerId}`, {
    method: 'DELETE',
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getProducts(tenantId: string, accessToken: string, q?: string) {
  const query = q ? `?q=${encodeURIComponent(q)}` : '';
  return fetchJson<Product[]>(`/products${query}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getProduct(tenantId: string, accessToken: string, productId: string) {
  return fetchJson<Product>(`/products/${productId}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function searchPosProducts(tenantId: string, accessToken: string, q: string) {
  return fetchJson<Product[]>(`/pos/products/search?q=${encodeURIComponent(q)}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getPosProductByBarcode(tenantId: string, accessToken: string, barcode: string) {
  return fetchJson<Product>(`/pos/products/barcode/${encodeURIComponent(barcode)}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getSalesOrders(tenantId: string, accessToken: string, status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return fetchJson<SalesOrder[]>(`/orders${query}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getSalesOrder(tenantId: string, accessToken: string, orderId: string) {
  return fetchJson<SalesOrder>(`/orders/${orderId}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function createSalesOrder(
  tenantId: string,
  accessToken: string,
  payload: CreateSalesOrderPayload,
) {
  return fetchJson<SalesOrder>('/orders', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function claimSalesOrder(
  tenantId: string,
  accessToken: string,
  orderId: string,
  payload: { cashSessionId?: string },
) {
  return fetchJson<SalesOrder>(`/orders/${orderId}/claim`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function releaseSalesOrder(tenantId: string, accessToken: string, orderId: string) {
  return fetchJson<SalesOrder>(`/orders/${orderId}/release`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function cancelSalesOrder(
  tenantId: string,
  accessToken: string,
  orderId: string,
  reason?: string,
) {
  return fetchJson<SalesOrder>(`/orders/${orderId}/cancel`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify({ reason }),
  });
}

export function updateSalesOrder(
  tenantId: string,
  accessToken: string,
  orderId: string,
  payload: CreateSalesOrderPayload,
) {
  return fetchJson<SalesOrder>(`/orders/${orderId}`, {
    method: 'PATCH',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function acceptSalesOrder(tenantId: string, accessToken: string, orderId: string) {
  return fetchJson<SalesOrder>(`/orders/${orderId}/accept`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function searchOrderProducts(tenantId: string, accessToken: string, q: string) {
  return fetchJson<Product[]>(`/orders/products/search?q=${encodeURIComponent(q)}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getOrderProductByBarcode(tenantId: string, accessToken: string, barcode: string) {
  return fetchJson<Product>(`/orders/products/barcode/${encodeURIComponent(barcode)}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function createProduct(
  tenantId: string,
  accessToken: string,
  payload: CreateProductPayload,
) {
  return fetchJson<Product>('/products', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function updateProduct(
  tenantId: string,
  accessToken: string,
  productId: string,
  payload: UpdateProductPayload,
) {
  return fetchJson<Product>(`/products/${productId}`, {
    method: 'PATCH',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function deleteProduct(tenantId: string, accessToken: string, productId: string) {
  return fetchJson<Product>(`/products/${productId}`, {
    method: 'DELETE',
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function generateProductBarcode(tenantId: string, accessToken: string, productId: string) {
  return fetchJson<Product>(`/products/${productId}/generate-barcode`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getProductLabel(tenantId: string, accessToken: string, productId: string) {
  return fetchJson<{
    productId: string;
    name: string;
    sku: string | null;
    barcode: string;
    barcodeType: string;
    price: number;
    printedAt: string;
    printCount: number;
  }>(`/products/${productId}/label`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function uploadProductImage(tenantId: string, accessToken: string, file: File) {
  const formData = new FormData();
  formData.append('file', file);

  return fetchFormData<ProductImageUploadResult>(
    '/products/image',
    formData,
    tenantHeaders(tenantId, accessToken),
  );
}

export function getInventoryMovements(tenantId: string, accessToken: string) {
  return fetchJson<InventoryMovement[]>('/inventory/movements', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getInvoices(tenantId: string, accessToken: string) {
  return fetchJson<Invoice[]>('/invoices', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getReturnRequests(tenantId: string, accessToken: string, status?: string) {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return fetchJson<ReturnRequest[]>(`/returns${query}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function lookupReturnInvoice(tenantId: string, accessToken: string, q: string) {
  return fetchJson<ReturnInvoiceLookup>(`/returns/invoice-lookup?q=${encodeURIComponent(q)}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function createReturnRequest(
  tenantId: string,
  accessToken: string,
  payload: CreateReturnRequestPayload,
) {
  return fetchJson<ReturnRequest>('/returns', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function approveReturnRequest(
  tenantId: string,
  accessToken: string,
  returnRequestId: string,
  payload: {
    cashSessionId?: string;
    refundMethod?: string;
    adminNote?: string;
  },
) {
  return fetchJson<ReturnRequest>(`/returns/${returnRequestId}/approve`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function rejectReturnRequest(
  tenantId: string,
  accessToken: string,
  returnRequestId: string,
  payload: { adminNote: string },
) {
  return fetchJson<ReturnRequest>(`/returns/${returnRequestId}/reject`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function getInvoice(tenantId: string, accessToken: string, invoiceId: string) {
  return fetchJson<Invoice>(`/invoices/${invoiceId}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function registerInvoicePrint(tenantId: string, accessToken: string, invoiceId: string) {
  return fetchJson<InvoicePrintRegistration>(`/invoices/${invoiceId}/print`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function createInvoice(
  tenantId: string,
  accessToken: string,
  payload: CreateInvoicePayload,
) {
  return fetchJson<Invoice>('/invoices', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function completePosSale(tenantId: string, accessToken: string, payload: PosSalePayload) {
  return fetchJson<Invoice>('/pos/sales/complete', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function updatePosOrderFiscalDetails(
  tenantId: string,
  accessToken: string,
  orderId: string,
  payload: UpdatePosOrderFiscalDetailsPayload,
) {
  return fetchJson<SalesOrder>(`/pos/orders/${orderId}/fiscal-details`, {
    method: 'PATCH',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function getEmployees(tenantId: string, accessToken: string) {
  return fetchJson<Employee[]>('/employees', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getEmployee(tenantId: string, accessToken: string, employeeId: string) {
  return fetchJson<Employee>(`/employees/${employeeId}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function createEmployee(
  tenantId: string,
  accessToken: string,
  payload: Record<string, string | boolean | undefined>,
) {
  return fetchJson<Employee>('/employees', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function updateEmployee(
  tenantId: string,
  accessToken: string,
  employeeId: string,
  payload: Record<string, string | boolean | undefined>,
) {
  return fetchJson<Employee>(`/employees/${employeeId}`, {
    method: 'PATCH',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function getCashSessions(tenantId: string, accessToken: string) {
  return fetchJson<CashSession[]>('/cash/sessions', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getCashRegisters(tenantId: string, accessToken: string) {
  return fetchJson<CashRegister[]>('/cash/registers', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getCurrentCashSession(tenantId: string, accessToken: string) {
  return fetchJson<CashSession | null>('/cash/sessions/current', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function openCashSession(
  tenantId: string,
  accessToken: string,
  payload: { cashRegisterId: string; openingAmount: number },
) {
  return fetchJson<CashSession>('/cash/sessions/open', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function closeCashSession(
  tenantId: string,
  accessToken: string,
  cashSessionId: string,
  payload: { closingAmount: number; notes?: string },
) {
  return fetchJson<CashSession>(`/cash/sessions/${cashSessionId}/close`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function getCashMovements(tenantId: string, accessToken: string) {
  return fetchJson<CashMovement[]>('/cash/movements', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getEmployeeLogs(tenantId: string, accessToken: string) {
  return fetchJson<EmployeeLog[]>('/employee-logs', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getOperationalLogs(tenantId: string, accessToken: string) {
  return fetchJson<OperationalLog[]>('/employee-logs/operational', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getFiscalSequences(tenantId: string, accessToken: string) {
  return fetchJson<FiscalSequence[]>('/fiscal-sequences', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function createFiscalSequence(
  tenantId: string,
  accessToken: string,
  payload: CreateFiscalSequencePayload,
) {
  return fetchJson<FiscalSequence>('/fiscal-sequences', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function getImportBatches(tenantId: string, accessToken: string) {
  return fetchJson<ImportBatch[]>('/imports', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getImportBatchRows(
  tenantId: string,
  accessToken: string,
  batchId: string,
  filters: {
    status: ImportBatchRowStatus;
    page?: number;
    limit?: number;
  },
) {
  const query = new URLSearchParams({
    status: filters.status,
    page: String(filters.page ?? 1),
    limit: String(filters.limit ?? 50),
  });

  return fetchJson<ImportBatchRowsResponse>(`/imports/${batchId}/rows?${query.toString()}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function deleteImportBatch(tenantId: string, accessToken: string, batchId: string) {
  return fetchJson<{ id: string }>(`/imports/${batchId}`, {
    method: 'DELETE',
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function importProductsFile(tenantId: string, accessToken: string, file: File) {
  const formData = new FormData();
  formData.append('file', file);

  return fetchFormData<ImportBatch>(
    '/imports/products',
    formData,
    tenantHeaders(tenantId, accessToken),
  );
}

export function getSuppliers(
  tenantId: string,
  accessToken: string,
  filters: { q?: string; status?: SupplierStatus } = {},
) {
  const query = new URLSearchParams();
  if (filters.q?.trim()) query.set('q', filters.q.trim());
  if (filters.status) query.set('status', filters.status);
  const suffix = query.size ? `?${query.toString()}` : '';
  return fetchJson<Supplier[]>(`/suppliers${suffix}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getSupplier(tenantId: string, accessToken: string, supplierId: string) {
  return fetchJson<Supplier>(`/suppliers/${supplierId}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function createSupplier(tenantId: string, accessToken: string, payload: SupplierPayload) {
  return fetchJson<Supplier>('/suppliers', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function updateSupplier(
  tenantId: string,
  accessToken: string,
  supplierId: string,
  payload: Partial<SupplierPayload>,
) {
  return fetchJson<Supplier>(`/suppliers/${supplierId}`, {
    method: 'PATCH',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function deactivateSupplier(tenantId: string, accessToken: string, supplierId: string) {
  return fetchJson<Supplier>(`/suppliers/${supplierId}/deactivate`, {
    method: 'PATCH',
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function addSupplierProduct(
  tenantId: string,
  accessToken: string,
  supplierId: string,
  payload: {
    productId: string;
    supplierSku?: string;
    lastCostNet?: number;
    lastCostWithTax?: number;
    leadTimeDays?: number;
    isPrimary?: boolean;
  },
) {
  return fetchJson<SupplierProduct>(`/suppliers/${supplierId}/products`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function updateSupplierProduct(
  tenantId: string,
  accessToken: string,
  supplierId: string,
  productId: string,
  payload: {
    supplierSku?: string;
    lastCostNet?: number;
    lastCostWithTax?: number;
    leadTimeDays?: number;
    isPrimary?: boolean;
    active?: boolean;
  },
) {
  return fetchJson<SupplierProduct>(`/suppliers/${supplierId}/products/${productId}`, {
    method: 'PATCH',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function removeSupplierProduct(
  tenantId: string,
  accessToken: string,
  supplierId: string,
  productId: string,
) {
  return fetchJson<SupplierProduct>(`/suppliers/${supplierId}/products/${productId}`, {
    method: 'DELETE',
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getPurchaseOrders(
  tenantId: string,
  accessToken: string,
  filters: { q?: string; status?: PurchaseOrderStatus | 'OVERDUE' } = {},
) {
  const query = new URLSearchParams();
  if (filters.q?.trim()) query.set('q', filters.q.trim());
  if (filters.status) query.set('status', filters.status);
  const suffix = query.size ? `?${query.toString()}` : '';
  return fetchJson<PurchaseOrder[]>(`/purchase-orders${suffix}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getPurchaseOrder(tenantId: string, accessToken: string, orderId: string) {
  return fetchJson<PurchaseOrder>(`/purchase-orders/${orderId}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function createPurchaseOrder(
  tenantId: string,
  accessToken: string,
  payload: PurchaseOrderPayload,
) {
  return fetchJson<PurchaseOrder>('/purchase-orders', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function updatePurchaseOrder(
  tenantId: string,
  accessToken: string,
  orderId: string,
  payload: Partial<PurchaseOrderPayload>,
) {
  return fetchJson<PurchaseOrder>(`/purchase-orders/${orderId}`, {
    method: 'PATCH',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function transitionPurchaseOrder(
  tenantId: string,
  accessToken: string,
  orderId: string,
  transition: 'request' | 'submit' | 'review' | 'approve' | 'issue' | 'pause' | 'resume' | 'cancel',
  note?: string,
) {
  return fetchJson<PurchaseOrder>(`/purchase-orders/${orderId}/${transition}`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify({ note }),
  });
}

export function getSupplierInvoices(
  tenantId: string,
  accessToken: string,
  filters: {
    q?: string;
    status?: SupplierInvoiceStatus;
    supplierId?: string;
    dueFrom?: string;
    dueTo?: string;
    overdue?: boolean;
  } = {},
) {
  const query = new URLSearchParams();
  if (filters.q?.trim()) query.set('q', filters.q.trim());
  if (filters.status) query.set('status', filters.status);
  if (filters.supplierId) query.set('supplierId', filters.supplierId);
  if (filters.dueFrom) query.set('dueFrom', filters.dueFrom);
  if (filters.dueTo) query.set('dueTo', filters.dueTo);
  if (filters.overdue !== undefined) query.set('overdue', String(filters.overdue));
  const suffix = query.size ? `?${query.toString()}` : '';
  return fetchJson<SupplierInvoice[]>(`/supplier-invoices${suffix}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getSupplierInvoice(tenantId: string, accessToken: string, invoiceId: string) {
  return fetchJson<SupplierInvoice>(`/supplier-invoices/${invoiceId}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function createSupplierInvoice(
  tenantId: string,
  accessToken: string,
  payload: SupplierInvoicePayload,
) {
  return fetchJson<SupplierInvoice>('/supplier-invoices', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function updateSupplierInvoice(
  tenantId: string,
  accessToken: string,
  invoiceId: string,
  payload: Omit<Partial<SupplierInvoicePayload>, 'purchaseOrderId'> & {
    purchaseOrderId?: string | null;
  },
) {
  return fetchJson<SupplierInvoice>(`/supplier-invoices/${invoiceId}`, {
    method: 'PATCH',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function confirmSupplierInvoiceEntry(
  tenantId: string,
  accessToken: string,
  invoiceId: string,
  payload: Omit<GoodsReceiptPayload, 'supplierInvoiceId'>,
) {
  return fetchJson<{ invoice: SupplierInvoice; receipt: GoodsReceipt }>(
    `/supplier-invoices/${invoiceId}/confirm-entry`,
    {
      method: 'POST',
      headers: tenantHeaders(tenantId, accessToken),
      body: JSON.stringify(payload),
    },
  );
}

export function cancelSupplierInvoice(
  tenantId: string,
  accessToken: string,
  invoiceId: string,
  reason: string,
) {
  return fetchJson<SupplierInvoice>(`/supplier-invoices/${invoiceId}/cancel`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify({ reason }),
  });
}

export function registerSupplierPayment(
  tenantId: string,
  accessToken: string,
  invoiceId: string,
  payload: {
    method: 'CASH' | 'TRANSFER' | 'CHECK';
    amount: number;
    tenderedAmount?: number;
    reference?: string;
    notes?: string;
    paidAt?: string;
  },
) {
  return fetchJson<{ payment: SupplierPayment; invoice: SupplierInvoice }>(
    `/supplier-invoices/${invoiceId}/payments`,
    {
      method: 'POST',
      headers: tenantHeaders(tenantId, accessToken),
      body: JSON.stringify(payload),
    },
  );
}

export function cancelSupplierPayment(
  tenantId: string,
  accessToken: string,
  invoiceId: string,
  paymentId: string,
  reason: string,
) {
  return fetchJson<{ payment: SupplierPayment; invoice: SupplierInvoice }>(
    `/supplier-invoices/${invoiceId}/payments/${paymentId}/cancel`,
    {
      method: 'POST',
      headers: tenantHeaders(tenantId, accessToken),
      body: JSON.stringify({ reason }),
    },
  );
}

export function createMobileOcrCapture(tenantId: string, accessToken: string) {
  return fetchJson<Omit<MobileOcrCapture, 'status'>>('/mobile-ocr-captures', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
  }).then((capture) => ({ ...capture, status: 'PENDING' as const }));
}

export function getMobileOcrCapture(tenantId: string, accessToken: string, captureId: string) {
  return fetchJson<MobileOcrCaptureStatusResponse>(`/mobile-ocr-captures/${captureId}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function claimMobileOcrCapture(tenantId: string, accessToken: string, captureId: string) {
  return fetchJson<{ result: MobileOcrCaptureResult }>(
    `/mobile-ocr-captures/${captureId}/consume`,
    {
      method: 'POST',
      headers: tenantHeaders(tenantId, accessToken),
    },
  );
}

export function cancelMobileOcrCapture(tenantId: string, accessToken: string, captureId: string) {
  return fetchJson<{ success: boolean }>(`/mobile-ocr-captures/${captureId}/cancel`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getMobileOcrCaptureForPhone(captureId: string, token: string) {
  return fetchJson<MobileOcrCaptureStatusResponse>(`/mobile-ocr-captures/${captureId}/mobile`, {
    headers: { 'x-mobile-ocr-token': token },
  });
}

export function submitMobileOcrCaptureResult(
  captureId: string,
  token: string,
  result: MobileOcrCaptureResult,
) {
  return fetchJson<MobileOcrCaptureStatusResponse>(
    `/mobile-ocr-captures/${captureId}/mobile/result`,
    {
      method: 'POST',
      headers: { 'x-mobile-ocr-token': token },
      body: JSON.stringify({ result }),
    },
  );
}

export function getPayablesSummary(tenantId: string, accessToken: string, supplierId?: string) {
  const query = supplierId ? `?supplierId=${encodeURIComponent(supplierId)}` : '';
  return fetchJson<PayablesSummary>(`/supplier-invoices/payables/summary${query}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getGoodsReceipts(
  tenantId: string,
  accessToken: string,
  filters: {
    q?: string;
    status?: GoodsReceiptStatus;
    supplierInvoiceId?: string;
    purchaseOrderId?: string;
    supplierId?: string;
  } = {},
) {
  const query = new URLSearchParams();
  if (filters.q?.trim()) query.set('q', filters.q.trim());
  if (filters.status) query.set('status', filters.status);
  if (filters.supplierInvoiceId) query.set('supplierInvoiceId', filters.supplierInvoiceId);
  if (filters.purchaseOrderId) query.set('purchaseOrderId', filters.purchaseOrderId);
  if (filters.supplierId) query.set('supplierId', filters.supplierId);
  const suffix = query.size ? `?${query.toString()}` : '';
  return fetchJson<GoodsReceipt[]>(`/receipts${suffix}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getGoodsReceipt(tenantId: string, accessToken: string, receiptId: string) {
  return fetchJson<GoodsReceipt>(`/receipts/${receiptId}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function createGoodsReceipt(
  tenantId: string,
  accessToken: string,
  payload: GoodsReceiptPayload,
) {
  return fetchJson<GoodsReceipt>('/receipts', {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function updateGoodsReceipt(
  tenantId: string,
  accessToken: string,
  receiptId: string,
  payload: Omit<GoodsReceiptPayload, 'supplierInvoiceId'>,
) {
  return fetchJson<GoodsReceipt>(`/receipts/${receiptId}`, {
    method: 'PATCH',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function confirmGoodsReceipt(tenantId: string, accessToken: string, receiptId: string) {
  return fetchJson<GoodsReceipt>(`/receipts/${receiptId}/confirm`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function cancelGoodsReceipt(
  tenantId: string,
  accessToken: string,
  receiptId: string,
  reason: string,
) {
  return fetchJson<GoodsReceipt>(`/receipts/${receiptId}/cancel`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify({ reason }),
  });
}

export function reverseGoodsReceipt(
  tenantId: string,
  accessToken: string,
  receiptId: string,
  reason: string,
) {
  return fetchJson<GoodsReceipt>(`/receipts/${receiptId}/reverse`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify({ reason }),
  });
}

export function configureCustomerCredit(
  tenantId: string,
  accessToken: string,
  customerId: string,
  payload: {
    creditEnabled: boolean;
    creditStatus: 'ACTIVE' | 'BLOCKED';
    creditLimit: number;
    creditTermDays: number;
  },
) {
  return fetchJson<Customer>(`/customers/${customerId}/credit`, {
    method: 'PATCH',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function getCreditApprovals(
  tenantId: string,
  accessToken: string,
  status?: CreditApprovalStatus,
) {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return fetchJson<CreditSaleApproval[]>(`/credit-approvals${query}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function approveCreditSale(
  tenantId: string,
  accessToken: string,
  approvalId: string,
  payload: {
    authorizeLimitExcess?: boolean;
    decisionNote?: string;
  },
) {
  return fetchJson<CreditSaleApproval>(`/credit-approvals/${approvalId}/approve`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function rejectCreditSale(
  tenantId: string,
  accessToken: string,
  approvalId: string,
  reason: string,
) {
  return fetchJson<CreditSaleApproval>(`/credit-approvals/${approvalId}/reject`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify({ reason }),
  });
}

export function getReceivables(
  tenantId: string,
  accessToken: string,
  filters: {
    q?: string;
    bucket?: ReceivableDueBucket | 'ALL';
  } = {},
) {
  const query = new URLSearchParams();
  if (filters.q?.trim()) query.set('q', filters.q.trim());
  if (filters.bucket && filters.bucket !== 'ALL') query.set('bucket', filters.bucket);
  const suffix = query.size ? `?${query.toString()}` : '';
  return fetchJson<ReceivableInvoice[]>(`/receivables${suffix}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getReceivableCustomerSummary(tenantId: string, accessToken: string) {
  return fetchJson<ReceivableCustomerSummary[]>('/receivables/customers', {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function getCustomerStatement(tenantId: string, accessToken: string, customerId: string) {
  return fetchJson<CustomerStatement>(`/receivables/customers/${customerId}/statement`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function createReceivablePayment(
  tenantId: string,
  accessToken: string,
  invoiceId: string,
  payload: {
    amount: number;
    cashSessionId: string;
    idempotencyKey?: string;
  },
) {
  return fetchJson<ReceivablePayment>(`/receivables/invoices/${invoiceId}/payments`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}

export function getReceivablePayment(tenantId: string, accessToken: string, paymentId: string) {
  return fetchJson<ReceivablePayment>(`/receivables/payments/${paymentId}`, {
    headers: tenantHeaders(tenantId, accessToken),
  });
}

export function cancelReceivablePayment(
  tenantId: string,
  accessToken: string,
  paymentId: string,
  payload: {
    cashSessionId: string;
    reason: string;
  },
) {
  return fetchJson<ReceivablePayment>(`/receivables/payments/${paymentId}/cancel`, {
    method: 'POST',
    headers: tenantHeaders(tenantId, accessToken),
    body: JSON.stringify(payload),
  });
}
