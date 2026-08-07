-- Procurement, supplier accounting, goods receiving and customer credit foundation.
-- This migration intentionally does not modify any existing employee assignment.

CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "PurchaseOrderStatus" AS ENUM (
  'DRAFT',
  'REQUESTED',
  'UNDER_REVIEW',
  'APPROVED',
  'ISSUED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'PAUSED',
  'CANCELLED'
);
CREATE TYPE "SupplierInvoiceStatus" AS ENUM (
  'DRAFT',
  'PENDING',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED'
);
CREATE TYPE "GoodsReceiptStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'REVERSED', 'CANCELLED');
CREATE TYPE "SalePaymentMode" AS ENUM ('CASH', 'CREDIT');
CREATE TYPE "InitialPaymentOption" AS ENUM ('NONE', 'PERCENT_30', 'PERCENT_50', 'PERCENT_70');
CREATE TYPE "CreditTermOption" AS ENUM (
  'CUSTOMER_DEFAULT',
  'DAYS_15',
  'DAYS_30',
  'DAYS_45',
  'CUSTOM_DATE'
);
CREATE TYPE "CustomerCreditStatus" AS ENUM ('ACTIVE', 'BLOCKED');
CREATE TYPE "CreditApprovalStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED'
);
CREATE TYPE "SupplierInvoiceAttachmentSource" AS ENUM ('CAMERA', 'UPLOAD');
CREATE TYPE "OcrStatus" AS ENUM (
  'NOT_REQUESTED',
  'PROCESSING',
  'REVIEW_REQUIRED',
  'FAILED',
  'CONFIRMED'
);
CREATE TYPE "ReceiptPriceDecision" AS ENUM ('KEEP', 'RECALCULATE_MARGIN', 'MANUAL');
CREATE TYPE "Currency" AS ENUM ('DOP');

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';
ALTER TYPE "CashMovementType" ADD VALUE IF NOT EXISTS 'CREDIT_PAYMENT';
ALTER TYPE "CashMovementType" ADD VALUE IF NOT EXISTS 'SUPPLIER_PAYMENT';

ALTER TABLE "Customer"
ADD COLUMN "creditEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "creditLimit" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "creditBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "creditTermDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "creditStatus" "CustomerCreditStatus" NOT NULL DEFAULT 'BLOCKED',
ADD COLUMN "creditEnabledAt" TIMESTAMP(3),
ADD COLUMN "creditEnabledById" TEXT;

ALTER TABLE "Product"
ADD COLUMN "costWithTax" DECIMAL(14,2);

ALTER TABLE "SalesOrder"
ADD COLUMN "paymentMode" "SalePaymentMode" NOT NULL DEFAULT 'CASH',
ADD COLUMN "initialPaymentOption" "InitialPaymentOption",
ADD COLUMN "initialPaymentRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
ADD COLUMN "initialPaymentAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "creditTermOption" "CreditTermOption",
ADD COLUMN "creditTermDays" INTEGER,
ADD COLUMN "dueDate" TIMESTAMP(3);

ALTER TABLE "Invoice"
ADD COLUMN "paymentMode" "SalePaymentMode" NOT NULL DEFAULT 'CASH';

ALTER TABLE "ReturnRequest"
ADD COLUMN "creditAppliedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "cashRefundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

ALTER TABLE "Payment"
ADD COLUMN "receiptNumber" TEXT,
ADD COLUMN "cancelledById" TEXT,
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "cancelReason" TEXT;

ALTER TABLE "InventoryMovement"
ADD COLUMN "supplierInvoiceId" TEXT,
ADD COLUMN "goodsReceiptId" TEXT;

ALTER TABLE "CashMovement"
ADD COLUMN "supplierPaymentId" TEXT;

CREATE TABLE "Supplier" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "commercialName" TEXT NOT NULL,
  "legalName" TEXT,
  "documentType" "DocumentType" NOT NULL,
  "documentNumber" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "contactName" TEXT,
  "contactPhone" TEXT,
  "contactEmail" TEXT,
  "address" TEXT,
  "paymentTerms" TEXT,
  "creditDays" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT,
  "deactivatedById" TEXT,
  "deactivatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Supplier_creditDays_check" CHECK ("creditDays" >= 0),
  CONSTRAINT "Supplier_documentType_check" CHECK ("documentType" IN ('RNC', 'CEDULA'))
);

CREATE TABLE "SupplierProduct" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "supplierSku" TEXT,
  "lastCostNet" DECIMAL(14,2),
  "lastCostWithTax" DECIMAL(14,2),
  "leadTimeDays" INTEGER,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupplierProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierProduct_costs_check" CHECK (
    ("lastCostNet" IS NULL OR "lastCostNet" >= 0)
    AND ("lastCostWithTax" IS NULL OR "lastCostWithTax" >= 0)
  ),
  CONSTRAINT "SupplierProduct_leadTimeDays_check" CHECK (
    "leadTimeDays" IS NULL OR "leadTimeDays" >= 0
  )
);

CREATE TABLE "PurchaseOrder" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" "Currency" NOT NULL DEFAULT 'DOP',
  "requestDate" TIMESTAMP(3),
  "expectedDeliveryDate" TIMESTAMP(3),
  "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "supplierNameSnapshot" TEXT NOT NULL,
  "supplierDocumentTypeSnapshot" "DocumentType" NOT NULL,
  "supplierDocumentNumberSnapshot" TEXT NOT NULL,
  "supplierContactSnapshot" TEXT,
  "supplierAddressSnapshot" TEXT,
  "createdById" TEXT NOT NULL,
  "requestedById" TEXT,
  "reviewedById" TEXT,
  "approvedById" TEXT,
  "issuedById" TEXT,
  "pausedById" TEXT,
  "cancelledById" TEXT,
  "requestedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "issuedAt" TIMESTAMP(3),
  "pausedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "pauseReason" TEXT,
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrder_amounts_check" CHECK (
    "subtotal" >= 0
    AND "taxTotal" >= 0
    AND "discountTotal" >= 0
    AND "total" >= 0
  )
);

CREATE TABLE "PurchaseOrderItem" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "supplierProductId" TEXT,
  "skuSnapshot" TEXT,
  "barcodeSnapshot" TEXT,
  "descriptionSnapshot" TEXT NOT NULL,
  "unitSnapshot" "ProductUnit" NOT NULL,
  "supplierSkuSnapshot" TEXT,
  "quantity" DECIMAL(14,3) NOT NULL,
  "receivedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "unitCostNet" DECIMAL(14,2) NOT NULL,
  "unitCostWithTax" DECIMAL(14,2) NOT NULL,
  "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "taxRate" DECIMAL(5,4) NOT NULL,
  "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "total" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseOrderItem_quantity_check" CHECK (
    "quantity" > 0 AND "receivedQuantity" >= 0
  ),
  CONSTRAINT "PurchaseOrderItem_amounts_check" CHECK (
    "unitCostNet" >= 0
    AND "unitCostWithTax" >= 0
    AND "discountTotal" >= 0
    AND "taxRate" >= 0
    AND "taxRate" <= 1
    AND "taxTotal" >= 0
    AND "subtotal" >= 0
    AND "total" >= 0
  )
);

CREATE TABLE "PurchaseOrderEvent" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "purchaseOrderId" TEXT NOT NULL,
  "fromStatus" "PurchaseOrderStatus",
  "toStatus" "PurchaseOrderStatus" NOT NULL,
  "note" TEXT,
  "metadata" JSONB,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PurchaseOrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupplierInvoice" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "invoiceNumber" TEXT NOT NULL,
  "ncf" TEXT,
  "issueDate" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "currency" "Currency" NOT NULL DEFAULT 'DOP',
  "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "supplierNameSnapshot" TEXT NOT NULL,
  "supplierDocumentTypeSnapshot" "DocumentType" NOT NULL,
  "supplierDocumentNumberSnapshot" TEXT NOT NULL,
  "supplierAddressSnapshot" TEXT,
  "createdById" TEXT NOT NULL,
  "updatedById" TEXT,
  "cancelledById" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierInvoice_amounts_check" CHECK (
    "subtotal" >= 0
    AND "taxTotal" >= 0
    AND "discountTotal" >= 0
    AND "total" >= 0
    AND "paidAmount" >= 0
    AND "balance" >= 0
    AND "total" = "subtotal" + "taxTotal"
    AND "paidAmount" <= "total"
    AND (
      (
        "status" = 'CANCELLED'
        AND "paidAmount" = 0
        AND "balance" = 0
      )
      OR (
        "status" <> 'CANCELLED'
        AND "balance" = "total" - "paidAmount"
      )
    )
    AND (
      (
        "status" IN ('DRAFT', 'PENDING')
        AND "paidAmount" = 0
      )
      OR (
        "status" = 'PARTIALLY_PAID'
        AND "paidAmount" > 0
        AND "balance" > 0
      )
      OR (
        "status" = 'PAID'
        AND "paidAmount" = "total"
        AND "balance" = 0
      )
      OR "status" = 'CANCELLED'
    )
  ),
  CONSTRAINT "SupplierInvoice_dates_check" CHECK (
    "dueDate" IS NULL OR "dueDate"::date >= "issueDate"::date
  )
);

CREATE TABLE "SupplierInvoiceItem" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "supplierInvoiceId" TEXT NOT NULL,
  "purchaseOrderItemId" TEXT,
  "productId" TEXT NOT NULL,
  "skuSnapshot" TEXT,
  "barcodeSnapshot" TEXT,
  "descriptionSnapshot" TEXT NOT NULL,
  "unitSnapshot" "ProductUnit" NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unitCostNet" DECIMAL(14,2) NOT NULL,
  "unitCostWithTax" DECIMAL(14,2) NOT NULL,
  "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "taxRate" DECIMAL(5,4) NOT NULL,
  "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "total" DECIMAL(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupplierInvoiceItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierInvoiceItem_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "SupplierInvoiceItem_amounts_check" CHECK (
    "unitCostNet" >= 0
    AND "unitCostWithTax" >= 0
    AND "discountTotal" >= 0
    AND "taxRate" >= 0
    AND "taxRate" <= 1
    AND "taxTotal" >= 0
    AND "subtotal" >= 0
    AND "total" >= 0
    AND "taxTotal" = round("subtotal" * "taxRate", 2)
    AND "total" = "subtotal" + "taxTotal"
    AND "unitCostNet" = round("subtotal" / "quantity", 2)
    AND "unitCostWithTax" = round("total" / "quantity", 2)
  )
);

CREATE TABLE "SupplierInvoiceAttachment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "supplierInvoiceId" TEXT NOT NULL,
  "storageBucket" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "source" "SupplierInvoiceAttachmentSource" NOT NULL,
  "ocrStatus" "OcrStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "ocrData" JSONB,
  "ocrError" TEXT,
  "uploadedById" TEXT NOT NULL,
  "confirmedById" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupplierInvoiceAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierInvoiceAttachment_fileSize_check" CHECK ("fileSize" > 0)
);

CREATE TABLE "SupplierPayment" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "supplierInvoiceId" TEXT NOT NULL,
  "paymentNumber" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'COMPLETED',
  "cashSessionId" TEXT,
  "reference" TEXT,
  "notes" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT NOT NULL,
  "cancelledById" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplierPayment_amount_check" CHECK ("amount" > 0),
  CONSTRAINT "SupplierPayment_cashSession_check" CHECK (
    (
      "method" = 'CASH'
      AND "cashSessionId" IS NOT NULL
    )
    OR (
      "method" IN ('TRANSFER', 'CHECK')
      AND "cashSessionId" IS NULL
    )
  ),
  CONSTRAINT "SupplierPayment_status_check" CHECK (
    (
      "status" = 'COMPLETED'
      AND "cancelledById" IS NULL
      AND "cancelledAt" IS NULL
      AND "cancelReason" IS NULL
    )
    OR (
      "status" = 'CANCELLED'
      AND "cancelledById" IS NOT NULL
      AND "cancelledAt" IS NOT NULL
      AND length(btrim(COALESCE("cancelReason", ''))) > 0
    )
  )
);

CREATE TABLE "GoodsReceipt" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  "purchaseOrderId" TEXT,
  "supplierInvoiceId" TEXT NOT NULL,
  "receiptNumber" TEXT NOT NULL,
  "status" "GoodsReceiptStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "confirmedById" TEXT,
  "reversedById" TEXT,
  "cancelledById" TEXT,
  "confirmedAt" TIMESTAMP(3),
  "reversedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "reversalReason" TEXT,
  "cancelReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoodsReceiptItem" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "goodsReceiptId" TEXT NOT NULL,
  "supplierInvoiceItemId" TEXT NOT NULL,
  "purchaseOrderItemId" TEXT,
  "productId" TEXT NOT NULL,
  "quantityOrdered" DECIMAL(14,3),
  "quantityInvoiced" DECIMAL(14,3) NOT NULL,
  "quantityReceived" DECIMAL(14,3) NOT NULL,
  "differenceAccepted" BOOLEAN NOT NULL DEFAULT false,
  "differenceNote" TEXT,
  "lotNumber" TEXT,
  "serialNumber" TEXT,
  "expirationDate" TIMESTAMP(3),
  "previousCostNet" DECIMAL(14,2),
  "newCostNet" DECIMAL(14,2) NOT NULL,
  "previousCostWithTax" DECIMAL(14,2),
  "newCostWithTax" DECIMAL(14,2) NOT NULL,
  "priceDecision" "ReceiptPriceDecision" NOT NULL DEFAULT 'KEEP',
  "previousSalePrice" DECIMAL(14,2) NOT NULL,
  "suggestedSalePrice" DECIMAL(14,2),
  "finalSalePrice" DECIMAL(14,2),
  "previousStock" DOUBLE PRECISION,
  "newStock" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GoodsReceiptItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoodsReceiptItem_quantities_check" CHECK (
    ("quantityOrdered" IS NULL OR "quantityOrdered" >= 0)
    AND "quantityInvoiced" > 0
    AND "quantityReceived" > 0
    AND (
      "differenceAccepted" = false
      OR length(btrim(COALESCE("differenceNote", ''))) > 0
    )
  ),
  CONSTRAINT "GoodsReceiptItem_costs_check" CHECK (
    ("previousCostNet" IS NULL OR "previousCostNet" >= 0)
    AND "newCostNet" >= 0
    AND ("previousCostWithTax" IS NULL OR "previousCostWithTax" >= 0)
    AND "newCostWithTax" >= 0
    AND "previousSalePrice" >= 0
    AND ("suggestedSalePrice" IS NULL OR "suggestedSalePrice" >= 0)
    AND ("finalSalePrice" IS NULL OR "finalSalePrice" >= 0)
  )
);

CREATE TABLE "CreditSaleApproval" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "salesOrderId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "status" "CreditApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "initialPaymentOption" "InitialPaymentOption" NOT NULL,
  "creditTermOption" "CreditTermOption" NOT NULL,
  "requestedTotal" DECIMAL(14,2) NOT NULL,
  "initialPaymentAmount" DECIMAL(14,2) NOT NULL,
  "financedAmount" DECIMAL(14,2) NOT NULL,
  "customerBalanceSnapshot" DECIMAL(14,2) NOT NULL,
  "creditLimitSnapshot" DECIMAL(14,2) NOT NULL,
  "exceedsCreditLimit" BOOLEAN NOT NULL DEFAULT false,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "requestNote" TEXT,
  "decisionNote" TEXT,
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "rejectedById" TEXT,
  "cancelledById" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "rejectedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CreditSaleApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditSaleApproval_amounts_check" CHECK (
    "requestedTotal" >= 0
    AND "initialPaymentAmount" >= 0
    AND "financedAmount" >= 0
    AND "customerBalanceSnapshot" >= 0
    AND "creditLimitSnapshot" >= 0
    AND "initialPaymentAmount" <= "requestedTotal"
    AND "financedAmount" = "requestedTotal" - "initialPaymentAmount"
    AND "exceedsCreditLimit" = (
      "customerBalanceSnapshot" + "financedAmount" > "creditLimitSnapshot"
    )
  )
);

ALTER TABLE "Customer"
ADD CONSTRAINT "Customer_credit_check" CHECK (
  "creditLimit" >= 0
  AND "creditBalance" >= 0
  AND "creditTermDays" > 0
);

ALTER TABLE "SalesOrder"
ADD CONSTRAINT "SalesOrder_credit_check" CHECK (
  "initialPaymentRate" >= 0
  AND "initialPaymentRate" <= 1
  AND "initialPaymentAmount" >= 0
  AND "initialPaymentAmount" <= "total"
  AND ("creditTermDays" IS NULL OR "creditTermDays" > 0)
  AND (
    (
      "paymentMode" = 'CASH'
      AND "initialPaymentOption" IS NULL
      AND "initialPaymentRate" = 0
      AND "initialPaymentAmount" = 0
      AND "creditTermOption" IS NULL
      AND "creditTermDays" IS NULL
      AND "dueDate" IS NULL
    )
    OR (
      "paymentMode" = 'CREDIT'
      AND "customerId" IS NOT NULL
      AND "initialPaymentOption" IS NOT NULL
      AND "creditTermOption" IS NOT NULL
      AND "creditTermDays" IS NOT NULL
      AND "dueDate" IS NOT NULL
      AND "initialPaymentAmount" = round("total" * "initialPaymentRate", 2)
      AND (
        ("initialPaymentOption" = 'NONE' AND "initialPaymentRate" = 0)
        OR ("initialPaymentOption" = 'PERCENT_30' AND "initialPaymentRate" = 0.3)
        OR ("initialPaymentOption" = 'PERCENT_50' AND "initialPaymentRate" = 0.5)
        OR ("initialPaymentOption" = 'PERCENT_70' AND "initialPaymentRate" = 0.7)
      )
    )
  )
);

CREATE INDEX "Supplier_tenantId_idx" ON "Supplier"("tenantId");
CREATE INDEX "Supplier_tenantId_status_idx" ON "Supplier"("tenantId", "status");
CREATE INDEX "Supplier_tenantId_commercialName_idx" ON "Supplier"("tenantId", "commercialName");
CREATE INDEX "Supplier_tenantId_legalName_idx" ON "Supplier"("tenantId", "legalName");
CREATE INDEX "Supplier_createdById_idx" ON "Supplier"("createdById");
CREATE INDEX "Supplier_updatedById_idx" ON "Supplier"("updatedById");
CREATE INDEX "Supplier_deactivatedById_idx" ON "Supplier"("deactivatedById");
CREATE UNIQUE INDEX "Supplier_tenantId_documentType_documentNumber_key"
ON "Supplier"("tenantId", "documentType", "documentNumber");

CREATE INDEX "SupplierProduct_tenantId_idx" ON "SupplierProduct"("tenantId");
CREATE INDEX "SupplierProduct_tenantId_productId_active_idx"
ON "SupplierProduct"("tenantId", "productId", "active");
CREATE INDEX "SupplierProduct_tenantId_supplierId_active_idx"
ON "SupplierProduct"("tenantId", "supplierId", "active");
CREATE INDEX "SupplierProduct_createdById_idx" ON "SupplierProduct"("createdById");
CREATE INDEX "SupplierProduct_updatedById_idx" ON "SupplierProduct"("updatedById");
CREATE UNIQUE INDEX "SupplierProduct_tenantId_supplierId_productId_key"
ON "SupplierProduct"("tenantId", "supplierId", "productId");

-- A product may have only one active primary supplier within a tenant.
CREATE UNIQUE INDEX "SupplierProduct_one_active_primary_per_product_key"
ON "SupplierProduct"("tenantId", "productId")
WHERE "isPrimary" = true AND "active" = true;

CREATE INDEX "PurchaseOrder_tenantId_idx" ON "PurchaseOrder"("tenantId");
CREATE INDEX "PurchaseOrder_tenantId_status_idx" ON "PurchaseOrder"("tenantId", "status");
CREATE INDEX "PurchaseOrder_tenantId_expectedDeliveryDate_idx"
ON "PurchaseOrder"("tenantId", "expectedDeliveryDate");
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");
CREATE INDEX "PurchaseOrder_createdById_idx" ON "PurchaseOrder"("createdById");
CREATE INDEX "PurchaseOrder_requestedById_idx" ON "PurchaseOrder"("requestedById");
CREATE INDEX "PurchaseOrder_reviewedById_idx" ON "PurchaseOrder"("reviewedById");
CREATE INDEX "PurchaseOrder_approvedById_idx" ON "PurchaseOrder"("approvedById");
CREATE INDEX "PurchaseOrder_issuedById_idx" ON "PurchaseOrder"("issuedById");
CREATE INDEX "PurchaseOrder_pausedById_idx" ON "PurchaseOrder"("pausedById");
CREATE INDEX "PurchaseOrder_cancelledById_idx" ON "PurchaseOrder"("cancelledById");
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_orderNumber_key"
ON "PurchaseOrder"("tenantId", "orderNumber");

CREATE INDEX "PurchaseOrderItem_tenantId_idx" ON "PurchaseOrderItem"("tenantId");
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");
CREATE INDEX "PurchaseOrderItem_supplierProductId_idx" ON "PurchaseOrderItem"("supplierProductId");

CREATE INDEX "PurchaseOrderEvent_tenantId_idx" ON "PurchaseOrderEvent"("tenantId");
CREATE INDEX "PurchaseOrderEvent_purchaseOrderId_createdAt_idx"
ON "PurchaseOrderEvent"("purchaseOrderId", "createdAt");
CREATE INDEX "PurchaseOrderEvent_createdById_idx" ON "PurchaseOrderEvent"("createdById");

CREATE UNIQUE INDEX "SupplierInvoice_purchaseOrderId_key"
ON "SupplierInvoice"("purchaseOrderId");
CREATE INDEX "SupplierInvoice_tenantId_idx" ON "SupplierInvoice"("tenantId");
CREATE INDEX "SupplierInvoice_tenantId_status_idx" ON "SupplierInvoice"("tenantId", "status");
CREATE INDEX "SupplierInvoice_tenantId_dueDate_idx" ON "SupplierInvoice"("tenantId", "dueDate");
CREATE INDEX "SupplierInvoice_supplierId_idx" ON "SupplierInvoice"("supplierId");
CREATE INDEX "SupplierInvoice_createdById_idx" ON "SupplierInvoice"("createdById");
CREATE INDEX "SupplierInvoice_updatedById_idx" ON "SupplierInvoice"("updatedById");
CREATE INDEX "SupplierInvoice_cancelledById_idx" ON "SupplierInvoice"("cancelledById");
CREATE UNIQUE INDEX "SupplierInvoice_tenantId_supplierId_invoiceNumber_key"
ON "SupplierInvoice"("tenantId", "supplierId", "invoiceNumber");
CREATE UNIQUE INDEX "SupplierInvoice_tenantId_supplierId_ncf_key"
ON "SupplierInvoice"("tenantId", "supplierId", "ncf");

CREATE INDEX "SupplierInvoiceItem_tenantId_idx" ON "SupplierInvoiceItem"("tenantId");
CREATE INDEX "SupplierInvoiceItem_supplierInvoiceId_idx"
ON "SupplierInvoiceItem"("supplierInvoiceId");
CREATE UNIQUE INDEX "SupplierInvoiceItem_supplierInvoiceId_purchaseOrderItemId_key"
ON "SupplierInvoiceItem"("supplierInvoiceId", "purchaseOrderItemId");
CREATE INDEX "SupplierInvoiceItem_purchaseOrderItemId_idx"
ON "SupplierInvoiceItem"("purchaseOrderItemId");
CREATE INDEX "SupplierInvoiceItem_productId_idx" ON "SupplierInvoiceItem"("productId");

CREATE INDEX "SupplierInvoiceAttachment_tenantId_idx"
ON "SupplierInvoiceAttachment"("tenantId");
CREATE INDEX "SupplierInvoiceAttachment_supplierInvoiceId_idx"
ON "SupplierInvoiceAttachment"("supplierInvoiceId");
CREATE INDEX "SupplierInvoiceAttachment_tenantId_ocrStatus_idx"
ON "SupplierInvoiceAttachment"("tenantId", "ocrStatus");
CREATE INDEX "SupplierInvoiceAttachment_uploadedById_idx"
ON "SupplierInvoiceAttachment"("uploadedById");
CREATE INDEX "SupplierInvoiceAttachment_confirmedById_idx"
ON "SupplierInvoiceAttachment"("confirmedById");
CREATE UNIQUE INDEX "SupplierInvoiceAttachment_tenantId_storageBucket_storagePat_key"
ON "SupplierInvoiceAttachment"("tenantId", "storageBucket", "storagePath");

CREATE INDEX "SupplierPayment_tenantId_idx" ON "SupplierPayment"("tenantId");
CREATE INDEX "SupplierPayment_tenantId_status_idx" ON "SupplierPayment"("tenantId", "status");
CREATE INDEX "SupplierPayment_supplierInvoiceId_idx" ON "SupplierPayment"("supplierInvoiceId");
CREATE INDEX "SupplierPayment_cashSessionId_idx" ON "SupplierPayment"("cashSessionId");
CREATE INDEX "SupplierPayment_createdById_idx" ON "SupplierPayment"("createdById");
CREATE INDEX "SupplierPayment_cancelledById_idx" ON "SupplierPayment"("cancelledById");
CREATE INDEX "SupplierPayment_tenantId_paidAt_idx" ON "SupplierPayment"("tenantId", "paidAt");
CREATE UNIQUE INDEX "SupplierPayment_tenantId_paymentNumber_key"
ON "SupplierPayment"("tenantId", "paymentNumber");

CREATE INDEX "GoodsReceipt_tenantId_idx" ON "GoodsReceipt"("tenantId");
CREATE INDEX "GoodsReceipt_tenantId_status_idx" ON "GoodsReceipt"("tenantId", "status");
CREATE INDEX "GoodsReceipt_supplierId_idx" ON "GoodsReceipt"("supplierId");
CREATE INDEX "GoodsReceipt_purchaseOrderId_idx" ON "GoodsReceipt"("purchaseOrderId");
CREATE INDEX "GoodsReceipt_supplierInvoiceId_idx" ON "GoodsReceipt"("supplierInvoiceId");
CREATE INDEX "GoodsReceipt_createdById_idx" ON "GoodsReceipt"("createdById");
CREATE INDEX "GoodsReceipt_confirmedById_idx" ON "GoodsReceipt"("confirmedById");
CREATE INDEX "GoodsReceipt_reversedById_idx" ON "GoodsReceipt"("reversedById");
CREATE INDEX "GoodsReceipt_cancelledById_idx" ON "GoodsReceipt"("cancelledById");
CREATE INDEX "GoodsReceipt_tenantId_createdAt_idx" ON "GoodsReceipt"("tenantId", "createdAt");
CREATE UNIQUE INDEX "GoodsReceipt_tenantId_receiptNumber_key"
ON "GoodsReceipt"("tenantId", "receiptNumber");

CREATE INDEX "GoodsReceiptItem_tenantId_idx" ON "GoodsReceiptItem"("tenantId");
CREATE INDEX "GoodsReceiptItem_goodsReceiptId_idx" ON "GoodsReceiptItem"("goodsReceiptId");
CREATE UNIQUE INDEX "GoodsReceiptItem_goodsReceiptId_supplierInvoiceItemId_key"
ON "GoodsReceiptItem"("goodsReceiptId", "supplierInvoiceItemId");
CREATE INDEX "GoodsReceiptItem_supplierInvoiceItemId_idx"
ON "GoodsReceiptItem"("supplierInvoiceItemId");
CREATE INDEX "GoodsReceiptItem_purchaseOrderItemId_idx"
ON "GoodsReceiptItem"("purchaseOrderItemId");
CREATE INDEX "GoodsReceiptItem_productId_idx" ON "GoodsReceiptItem"("productId");
CREATE INDEX "GoodsReceiptItem_expirationDate_idx" ON "GoodsReceiptItem"("expirationDate");

CREATE UNIQUE INDEX "CreditSaleApproval_salesOrderId_key"
ON "CreditSaleApproval"("salesOrderId");
CREATE INDEX "CreditSaleApproval_tenantId_idx" ON "CreditSaleApproval"("tenantId");
CREATE INDEX "CreditSaleApproval_tenantId_status_idx"
ON "CreditSaleApproval"("tenantId", "status");
CREATE INDEX "CreditSaleApproval_tenantId_dueDate_idx"
ON "CreditSaleApproval"("tenantId", "dueDate");
CREATE INDEX "CreditSaleApproval_customerId_idx" ON "CreditSaleApproval"("customerId");
CREATE INDEX "CreditSaleApproval_requestedById_idx" ON "CreditSaleApproval"("requestedById");
CREATE INDEX "CreditSaleApproval_approvedById_idx" ON "CreditSaleApproval"("approvedById");
CREATE INDEX "CreditSaleApproval_rejectedById_idx" ON "CreditSaleApproval"("rejectedById");
CREATE INDEX "CreditSaleApproval_cancelledById_idx" ON "CreditSaleApproval"("cancelledById");

CREATE INDEX "Customer_tenantId_creditEnabled_creditStatus_idx"
ON "Customer"("tenantId", "creditEnabled", "creditStatus");
CREATE INDEX "Customer_creditEnabledById_idx" ON "Customer"("creditEnabledById");
CREATE INDEX "SalesOrder_tenantId_paymentMode_dueDate_idx"
ON "SalesOrder"("tenantId", "paymentMode", "dueDate");
CREATE INDEX "Invoice_tenantId_paymentMode_dueDate_idx"
ON "Invoice"("tenantId", "paymentMode", "dueDate");
CREATE UNIQUE INDEX "Payment_tenantId_receiptNumber_key"
ON "Payment"("tenantId", "receiptNumber");
CREATE INDEX "Payment_cancelledById_idx" ON "Payment"("cancelledById");
CREATE INDEX "InventoryMovement_supplierInvoiceId_idx"
ON "InventoryMovement"("supplierInvoiceId");
CREATE INDEX "InventoryMovement_goodsReceiptId_idx"
ON "InventoryMovement"("goodsReceiptId");
CREATE INDEX "CashMovement_supplierPaymentId_idx"
ON "CashMovement"("supplierPaymentId");

ALTER TABLE "Customer"
ADD CONSTRAINT "Customer_creditEnabledById_fkey"
FOREIGN KEY ("creditEnabledById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Supplier"
ADD CONSTRAINT "Supplier_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Supplier"
ADD CONSTRAINT "Supplier_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Supplier"
ADD CONSTRAINT "Supplier_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Supplier"
ADD CONSTRAINT "Supplier_deactivatedById_fkey"
FOREIGN KEY ("deactivatedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplierProduct"
ADD CONSTRAINT "SupplierProduct_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierProduct"
ADD CONSTRAINT "SupplierProduct_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierProduct"
ADD CONSTRAINT "SupplierProduct_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierProduct"
ADD CONSTRAINT "SupplierProduct_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierProduct"
ADD CONSTRAINT "SupplierProduct_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_issuedById_fkey"
FOREIGN KEY ("issuedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_pausedById_fkey"
FOREIGN KEY ("pausedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder"
ADD CONSTRAINT "PurchaseOrder_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderItem"
ADD CONSTRAINT "PurchaseOrderItem_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderItem"
ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey"
FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderItem"
ADD CONSTRAINT "PurchaseOrderItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderItem"
ADD CONSTRAINT "PurchaseOrderItem_supplierProductId_fkey"
FOREIGN KEY ("supplierProductId") REFERENCES "SupplierProduct"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderEvent"
ADD CONSTRAINT "PurchaseOrderEvent_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderEvent"
ADD CONSTRAINT "PurchaseOrderEvent_purchaseOrderId_fkey"
FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderEvent"
ADD CONSTRAINT "PurchaseOrderEvent_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplierInvoice"
ADD CONSTRAINT "SupplierInvoice_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice"
ADD CONSTRAINT "SupplierInvoice_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice"
ADD CONSTRAINT "SupplierInvoice_purchaseOrderId_fkey"
FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice"
ADD CONSTRAINT "SupplierInvoice_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice"
ADD CONSTRAINT "SupplierInvoice_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoice"
ADD CONSTRAINT "SupplierInvoice_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplierInvoiceItem"
ADD CONSTRAINT "SupplierInvoiceItem_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceItem"
ADD CONSTRAINT "SupplierInvoiceItem_supplierInvoiceId_fkey"
FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceItem"
ADD CONSTRAINT "SupplierInvoiceItem_purchaseOrderItemId_fkey"
FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceItem"
ADD CONSTRAINT "SupplierInvoiceItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplierInvoiceAttachment"
ADD CONSTRAINT "SupplierInvoiceAttachment_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceAttachment"
ADD CONSTRAINT "SupplierInvoiceAttachment_supplierInvoiceId_fkey"
FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceAttachment"
ADD CONSTRAINT "SupplierInvoiceAttachment_uploadedById_fkey"
FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierInvoiceAttachment"
ADD CONSTRAINT "SupplierInvoiceAttachment_confirmedById_fkey"
FOREIGN KEY ("confirmedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplierPayment"
ADD CONSTRAINT "SupplierPayment_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment"
ADD CONSTRAINT "SupplierPayment_supplierInvoiceId_fkey"
FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment"
ADD CONSTRAINT "SupplierPayment_cashSessionId_fkey"
FOREIGN KEY ("cashSessionId") REFERENCES "CashSession"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment"
ADD CONSTRAINT "SupplierPayment_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayment"
ADD CONSTRAINT "SupplierPayment_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GoodsReceipt"
ADD CONSTRAINT "GoodsReceipt_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoodsReceipt"
ADD CONSTRAINT "GoodsReceipt_supplierId_fkey"
FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReceipt"
ADD CONSTRAINT "GoodsReceipt_purchaseOrderId_fkey"
FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoodsReceipt"
ADD CONSTRAINT "GoodsReceipt_supplierInvoiceId_fkey"
FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReceipt"
ADD CONSTRAINT "GoodsReceipt_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReceipt"
ADD CONSTRAINT "GoodsReceipt_confirmedById_fkey"
FOREIGN KEY ("confirmedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoodsReceipt"
ADD CONSTRAINT "GoodsReceipt_reversedById_fkey"
FOREIGN KEY ("reversedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoodsReceipt"
ADD CONSTRAINT "GoodsReceipt_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GoodsReceiptItem"
ADD CONSTRAINT "GoodsReceiptItem_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoodsReceiptItem"
ADD CONSTRAINT "GoodsReceiptItem_goodsReceiptId_fkey"
FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoodsReceiptItem"
ADD CONSTRAINT "GoodsReceiptItem_supplierInvoiceItemId_fkey"
FOREIGN KEY ("supplierInvoiceItemId") REFERENCES "SupplierInvoiceItem"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GoodsReceiptItem"
ADD CONSTRAINT "GoodsReceiptItem_purchaseOrderItemId_fkey"
FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GoodsReceiptItem"
ADD CONSTRAINT "GoodsReceiptItem_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CreditSaleApproval"
ADD CONSTRAINT "CreditSaleApproval_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditSaleApproval"
ADD CONSTRAINT "CreditSaleApproval_salesOrderId_fkey"
FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditSaleApproval"
ADD CONSTRAINT "CreditSaleApproval_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditSaleApproval"
ADD CONSTRAINT "CreditSaleApproval_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CreditSaleApproval"
ADD CONSTRAINT "CreditSaleApproval_approvedById_fkey"
FOREIGN KEY ("approvedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditSaleApproval"
ADD CONSTRAINT "CreditSaleApproval_rejectedById_fkey"
FOREIGN KEY ("rejectedById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditSaleApproval"
ADD CONSTRAINT "CreditSaleApproval_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_supplierInvoiceId_fkey"
FOREIGN KEY ("supplierInvoiceId") REFERENCES "SupplierInvoice"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_goodsReceiptId_fkey"
FOREIGN KEY ("goodsReceiptId") REFERENCES "GoodsReceipt"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashMovement"
ADD CONSTRAINT "CashMovement_supplierPaymentId_fkey"
FOREIGN KEY ("supplierPaymentId") REFERENCES "SupplierPayment"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Prisma scopes every query by tenantId. These triggers also prevent a direct
-- database write from linking records that belong to different tenants.
CREATE FUNCTION "qorvex_enforce_tenant_reference"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  reference_id TEXT;
  reference_tenant_id TEXT;
BEGIN
  reference_id := to_jsonb(NEW) ->> TG_ARGV[1];
  IF reference_id IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format(
    'SELECT "tenantId" FROM %I WHERE "id" = $1',
    TG_ARGV[0]
  )
  INTO reference_tenant_id
  USING reference_id;

  IF reference_tenant_id IS NULL OR reference_tenant_id <> NEW."tenantId" THEN
    RAISE EXCEPTION
      USING
        ERRCODE = '23514',
        MESSAGE = format(
          'Tenant mismatch for %s.%s',
          TG_TABLE_NAME,
          TG_ARGV[1]
        );
  END IF;

  RETURN NEW;
END;
$$;

-- Cross-table procurement links must agree on supplier, source document,
-- order line and product, not only on tenant ownership.
CREATE FUNCTION "qorvex_enforce_supplier_invoice_coherence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  order_supplier_id TEXT;
BEGIN
  IF NEW."purchaseOrderId" IS NOT NULL THEN
    SELECT "supplierId"
    INTO order_supplier_id
    FROM "PurchaseOrder"
    WHERE "id" = NEW."purchaseOrderId";

    IF order_supplier_id IS NULL OR order_supplier_id <> NEW."supplierId" THEN
      RAISE EXCEPTION
        USING ERRCODE = '23514',
              MESSAGE = 'Supplier invoice and purchase order must use the same supplier';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "SupplierInvoiceItem" invoice_item
    LEFT JOIN "PurchaseOrderItem" order_item
      ON order_item."id" = invoice_item."purchaseOrderItemId"
    WHERE invoice_item."supplierInvoiceId" = NEW."id"
      AND (
        (
          NEW."purchaseOrderId" IS NULL
          AND invoice_item."purchaseOrderItemId" IS NOT NULL
        )
        OR (
          NEW."purchaseOrderId" IS NOT NULL
          AND (
            invoice_item."purchaseOrderItemId" IS NULL
            OR order_item."purchaseOrderId" IS DISTINCT FROM NEW."purchaseOrderId"
            OR order_item."productId" IS DISTINCT FROM invoice_item."productId"
          )
        )
      )
  ) THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Supplier invoice items do not match the selected purchase order';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "GoodsReceipt"
    WHERE "supplierInvoiceId" = NEW."id"
      AND (
        "supplierId" IS DISTINCT FROM NEW."supplierId"
        OR "purchaseOrderId" IS DISTINCT FROM NEW."purchaseOrderId"
      )
  ) THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Supplier invoice header cannot invalidate an existing goods receipt';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION "qorvex_enforce_supplier_invoice_item_coherence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  invoice_order_id TEXT;
  order_item_order_id TEXT;
  order_item_product_id TEXT;
BEGIN
  SELECT "purchaseOrderId"
  INTO invoice_order_id
  FROM "SupplierInvoice"
  WHERE "id" = NEW."supplierInvoiceId";

  IF NOT FOUND THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Supplier invoice item references a missing invoice';
  END IF;

  IF invoice_order_id IS NULL THEN
    IF NEW."purchaseOrderItemId" IS NOT NULL THEN
      RAISE EXCEPTION
        USING ERRCODE = '23514',
              MESSAGE = 'Standalone supplier invoice cannot reference a purchase order item';
    END IF;
  ELSE
    IF NEW."purchaseOrderItemId" IS NULL THEN
      RAISE EXCEPTION
        USING ERRCODE = '23514',
              MESSAGE = 'Supplier invoice linked to an order requires an order line per item';
    END IF;

    SELECT "purchaseOrderId", "productId"
    INTO order_item_order_id, order_item_product_id
    FROM "PurchaseOrderItem"
    WHERE "id" = NEW."purchaseOrderItemId";

    IF
      order_item_order_id IS NULL
      OR order_item_order_id <> invoice_order_id
      OR order_item_product_id <> NEW."productId"
    THEN
      RAISE EXCEPTION
        USING ERRCODE = '23514',
              MESSAGE = 'Supplier invoice item does not match its purchase order line';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "GoodsReceiptItem" receipt_item
    JOIN "GoodsReceipt" receipt
      ON receipt."id" = receipt_item."goodsReceiptId"
    WHERE receipt_item."supplierInvoiceItemId" = NEW."id"
      AND (
        receipt."supplierInvoiceId" IS DISTINCT FROM NEW."supplierInvoiceId"
        OR receipt_item."productId" IS DISTINCT FROM NEW."productId"
        OR receipt_item."purchaseOrderItemId"
          IS DISTINCT FROM NEW."purchaseOrderItemId"
      )
  ) THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Supplier invoice item cannot invalidate an existing receipt item';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION "qorvex_enforce_purchase_order_coherence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'PurchaseOrder' THEN
    IF EXISTS (
      SELECT 1
      FROM "SupplierInvoice"
      WHERE "purchaseOrderId" = NEW."id"
        AND "supplierId" IS DISTINCT FROM NEW."supplierId"
    ) THEN
      RAISE EXCEPTION
        USING ERRCODE = '23514',
              MESSAGE = 'Purchase order supplier cannot invalidate its supplier invoice';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM "SupplierInvoiceItem" invoice_item
      JOIN "SupplierInvoice" invoice
        ON invoice."id" = invoice_item."supplierInvoiceId"
      WHERE invoice_item."purchaseOrderItemId" = NEW."id"
        AND (
          invoice."purchaseOrderId" IS DISTINCT FROM NEW."purchaseOrderId"
          OR invoice_item."productId" IS DISTINCT FROM NEW."productId"
        )
    ) THEN
      RAISE EXCEPTION
        USING ERRCODE = '23514',
              MESSAGE = 'Purchase order line cannot invalidate its supplier invoice item';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION "qorvex_enforce_goods_receipt_coherence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  invoice_supplier_id TEXT;
  invoice_order_id TEXT;
BEGIN
  SELECT "supplierId", "purchaseOrderId"
  INTO invoice_supplier_id, invoice_order_id
  FROM "SupplierInvoice"
  WHERE "id" = NEW."supplierInvoiceId";

  IF
    invoice_supplier_id IS NULL
    OR invoice_supplier_id <> NEW."supplierId"
    OR invoice_order_id IS DISTINCT FROM NEW."purchaseOrderId"
  THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Goods receipt must match its supplier invoice supplier and purchase order';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "GoodsReceiptItem" receipt_item
    JOIN "SupplierInvoiceItem" invoice_item
      ON invoice_item."id" = receipt_item."supplierInvoiceItemId"
    WHERE receipt_item."goodsReceiptId" = NEW."id"
      AND (
        invoice_item."supplierInvoiceId" IS DISTINCT FROM NEW."supplierInvoiceId"
        OR invoice_item."productId" IS DISTINCT FROM receipt_item."productId"
        OR invoice_item."purchaseOrderItemId"
          IS DISTINCT FROM receipt_item."purchaseOrderItemId"
      )
  ) THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Goods receipt header does not match its existing items';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION "qorvex_enforce_goods_receipt_item_coherence"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  receipt_invoice_id TEXT;
  receipt_order_id TEXT;
  invoice_item_invoice_id TEXT;
  invoice_item_order_item_id TEXT;
  invoice_item_product_id TEXT;
  invoice_item_quantity DECIMAL(14,3);
  invoice_item_cost_net DECIMAL(14,2);
  invoice_item_cost_with_tax DECIMAL(14,2);
  order_item_quantity DECIMAL(14,3);
BEGIN
  SELECT "supplierInvoiceId", "purchaseOrderId"
  INTO receipt_invoice_id, receipt_order_id
  FROM "GoodsReceipt"
  WHERE "id" = NEW."goodsReceiptId";

  SELECT
    "supplierInvoiceId",
    "purchaseOrderItemId",
    "productId",
    "quantity",
    "unitCostNet",
    "unitCostWithTax"
  INTO
    invoice_item_invoice_id,
    invoice_item_order_item_id,
    invoice_item_product_id,
    invoice_item_quantity,
    invoice_item_cost_net,
    invoice_item_cost_with_tax
  FROM "SupplierInvoiceItem"
  WHERE "id" = NEW."supplierInvoiceItemId";

  IF invoice_item_order_item_id IS NOT NULL THEN
    SELECT "quantity"
    INTO order_item_quantity
    FROM "PurchaseOrderItem"
    WHERE "id" = invoice_item_order_item_id;
  END IF;

  IF
    receipt_invoice_id IS NULL
    OR invoice_item_invoice_id IS NULL
    OR invoice_item_invoice_id <> receipt_invoice_id
    OR invoice_item_product_id <> NEW."productId"
    OR invoice_item_order_item_id IS DISTINCT FROM NEW."purchaseOrderItemId"
    OR invoice_item_quantity IS DISTINCT FROM NEW."quantityInvoiced"
    OR invoice_item_cost_net IS DISTINCT FROM NEW."newCostNet"
    OR invoice_item_cost_with_tax IS DISTINCT FROM NEW."newCostWithTax"
    OR order_item_quantity IS DISTINCT FROM NEW."quantityOrdered"
    OR (
      receipt_order_id IS NULL
      AND NEW."purchaseOrderItemId" IS NOT NULL
    )
  THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Goods receipt item does not match its invoice and order lines';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "SupplierInvoice_procurement_coherence_check"
BEFORE INSERT OR UPDATE OF "supplierId", "purchaseOrderId" ON "SupplierInvoice"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_supplier_invoice_coherence"();
CREATE TRIGGER "SupplierInvoiceItem_procurement_coherence_check"
BEFORE INSERT OR UPDATE OF
  "supplierInvoiceId", "purchaseOrderItemId", "productId"
ON "SupplierInvoiceItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_supplier_invoice_item_coherence"();
CREATE TRIGGER "PurchaseOrder_invoice_supplier_coherence_check"
BEFORE UPDATE OF "supplierId" ON "PurchaseOrder"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_purchase_order_coherence"();
CREATE TRIGGER "PurchaseOrderItem_invoice_coherence_check"
BEFORE UPDATE OF "purchaseOrderId", "productId" ON "PurchaseOrderItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_purchase_order_coherence"();
CREATE TRIGGER "GoodsReceipt_procurement_coherence_check"
BEFORE INSERT OR UPDATE OF
  "supplierId", "purchaseOrderId", "supplierInvoiceId"
ON "GoodsReceipt"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_goods_receipt_coherence"();
CREATE TRIGGER "GoodsReceiptItem_procurement_coherence_check"
BEFORE INSERT OR UPDATE OF
  "goodsReceiptId", "supplierInvoiceItemId", "purchaseOrderItemId", "productId"
ON "GoodsReceiptItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_goods_receipt_item_coherence"();

CREATE TRIGGER "SupplierProduct_supplier_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "supplierId" ON "SupplierProduct"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('Supplier', 'supplierId');
CREATE TRIGGER "SupplierProduct_product_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "productId" ON "SupplierProduct"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('Product', 'productId');

CREATE TRIGGER "PurchaseOrder_supplier_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "supplierId" ON "PurchaseOrder"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('Supplier', 'supplierId');

CREATE TRIGGER "PurchaseOrderItem_order_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "purchaseOrderId" ON "PurchaseOrderItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('PurchaseOrder', 'purchaseOrderId');
CREATE TRIGGER "PurchaseOrderItem_product_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "productId" ON "PurchaseOrderItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('Product', 'productId');
CREATE TRIGGER "PurchaseOrderItem_supplier_product_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "supplierProductId" ON "PurchaseOrderItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('SupplierProduct', 'supplierProductId');

CREATE TRIGGER "PurchaseOrderEvent_order_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "purchaseOrderId" ON "PurchaseOrderEvent"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('PurchaseOrder', 'purchaseOrderId');

CREATE TRIGGER "SupplierInvoice_supplier_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "supplierId" ON "SupplierInvoice"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('Supplier', 'supplierId');
CREATE TRIGGER "SupplierInvoice_order_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "purchaseOrderId" ON "SupplierInvoice"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('PurchaseOrder', 'purchaseOrderId');

CREATE TRIGGER "SupplierInvoiceItem_invoice_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "supplierInvoiceId" ON "SupplierInvoiceItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('SupplierInvoice', 'supplierInvoiceId');
CREATE TRIGGER "SupplierInvoiceItem_order_item_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "purchaseOrderItemId" ON "SupplierInvoiceItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('PurchaseOrderItem', 'purchaseOrderItemId');
CREATE TRIGGER "SupplierInvoiceItem_product_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "productId" ON "SupplierInvoiceItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('Product', 'productId');

CREATE TRIGGER "SupplierInvoiceAttachment_invoice_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "supplierInvoiceId" ON "SupplierInvoiceAttachment"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('SupplierInvoice', 'supplierInvoiceId');

CREATE TRIGGER "SupplierPayment_invoice_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "supplierInvoiceId" ON "SupplierPayment"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('SupplierInvoice', 'supplierInvoiceId');
CREATE TRIGGER "SupplierPayment_cash_session_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "cashSessionId" ON "SupplierPayment"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('CashSession', 'cashSessionId');

CREATE TRIGGER "GoodsReceipt_supplier_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "supplierId" ON "GoodsReceipt"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('Supplier', 'supplierId');
CREATE TRIGGER "GoodsReceipt_order_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "purchaseOrderId" ON "GoodsReceipt"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('PurchaseOrder', 'purchaseOrderId');
CREATE TRIGGER "GoodsReceipt_invoice_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "supplierInvoiceId" ON "GoodsReceipt"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('SupplierInvoice', 'supplierInvoiceId');

CREATE TRIGGER "GoodsReceiptItem_receipt_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "goodsReceiptId" ON "GoodsReceiptItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('GoodsReceipt', 'goodsReceiptId');
CREATE TRIGGER "GoodsReceiptItem_invoice_item_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "supplierInvoiceItemId" ON "GoodsReceiptItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('SupplierInvoiceItem', 'supplierInvoiceItemId');
CREATE TRIGGER "GoodsReceiptItem_order_item_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "purchaseOrderItemId" ON "GoodsReceiptItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('PurchaseOrderItem', 'purchaseOrderItemId');
CREATE TRIGGER "GoodsReceiptItem_product_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "productId" ON "GoodsReceiptItem"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('Product', 'productId');

CREATE TRIGGER "CreditSaleApproval_order_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "salesOrderId" ON "CreditSaleApproval"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('SalesOrder', 'salesOrderId');
CREATE TRIGGER "CreditSaleApproval_customer_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "customerId" ON "CreditSaleApproval"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('Customer', 'customerId');

CREATE TRIGGER "InventoryMovement_supplier_invoice_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "supplierInvoiceId" ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('SupplierInvoice', 'supplierInvoiceId');
CREATE TRIGGER "InventoryMovement_goods_receipt_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "goodsReceiptId" ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('GoodsReceipt', 'goodsReceiptId');
CREATE TRIGGER "CashMovement_supplier_payment_tenant_check"
BEFORE INSERT OR UPDATE OF "tenantId", "supplierPaymentId" ON "CashMovement"
FOR EACH ROW EXECUTE FUNCTION "qorvex_enforce_tenant_reference"('SupplierPayment', 'supplierPaymentId');

-- Accounting checks are deferred so the invoice balance and its payment row
-- can be updated atomically in either order within the same transaction.
CREATE FUNCTION "qorvex_assert_supplier_invoice_accounting"(invoice_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  invoice_record RECORD;
  completed_payments DECIMAL(14,2);
  item_subtotal DECIMAL(14,2);
  item_tax_total DECIMAL(14,2);
  item_discount_total DECIMAL(14,2);
  item_total DECIMAL(14,2);
BEGIN
  SELECT
    "status",
    "subtotal",
    "taxTotal",
    "discountTotal",
    "total",
    "paidAmount",
    "balance"
  INTO invoice_record
  FROM "SupplierInvoice"
  WHERE "id" = invoice_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM("amount"), 0)
  INTO completed_payments
  FROM "SupplierPayment"
  WHERE "supplierInvoiceId" = invoice_id
    AND "status" = 'COMPLETED';

  IF invoice_record."paidAmount" <> completed_payments THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Supplier invoice paid amount must equal its completed payments';
  END IF;

  SELECT
    COALESCE(SUM("subtotal"), 0),
    COALESCE(SUM("taxTotal"), 0),
    COALESCE(SUM("discountTotal"), 0),
    COALESCE(SUM("total"), 0)
  INTO item_subtotal, item_tax_total, item_discount_total, item_total
  FROM "SupplierInvoiceItem"
  WHERE "supplierInvoiceId" = invoice_id;

  IF
    invoice_record."subtotal" <> item_subtotal
    OR invoice_record."taxTotal" <> item_tax_total
    OR invoice_record."discountTotal" <> item_discount_total
    OR invoice_record."total" <> item_total
  THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Supplier invoice totals must equal the sum of its items';
  END IF;

  IF invoice_record."status" = 'CANCELLED' THEN
    IF invoice_record."paidAmount" <> 0 OR invoice_record."balance" <> 0 THEN
      RAISE EXCEPTION
        USING ERRCODE = '23514',
              MESSAGE = 'Cancelled supplier invoice must have zero paid amount and balance';
    END IF;
  ELSIF invoice_record."balance" <> invoice_record."total" - invoice_record."paidAmount" THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Supplier invoice balance must equal total minus paid amount';
  END IF;
END;
$$;

CREATE FUNCTION "qorvex_check_supplier_invoice_accounting"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'SupplierInvoice' THEN
    PERFORM "qorvex_assert_supplier_invoice_accounting"(NEW."id");
  ELSE
    IF TG_OP = 'DELETE' THEN
      PERFORM "qorvex_assert_supplier_invoice_accounting"(OLD."supplierInvoiceId");
    ELSIF TG_OP = 'INSERT' THEN
      PERFORM "qorvex_assert_supplier_invoice_accounting"(NEW."supplierInvoiceId");
    ELSE
      PERFORM "qorvex_assert_supplier_invoice_accounting"(NEW."supplierInvoiceId");
      IF OLD."supplierInvoiceId" IS DISTINCT FROM NEW."supplierInvoiceId" THEN
        PERFORM "qorvex_assert_supplier_invoice_accounting"(OLD."supplierInvoiceId");
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "SupplierInvoice_accounting_check"
AFTER INSERT OR UPDATE
ON "SupplierInvoice"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "qorvex_check_supplier_invoice_accounting"();
CREATE CONSTRAINT TRIGGER "SupplierPayment_accounting_check"
AFTER INSERT OR UPDATE OR DELETE ON "SupplierPayment"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "qorvex_check_supplier_invoice_accounting"();
CREATE CONSTRAINT TRIGGER "SupplierInvoiceItem_accounting_check"
AFTER INSERT OR UPDATE OR DELETE ON "SupplierInvoiceItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "qorvex_check_supplier_invoice_accounting"();

CREATE FUNCTION "qorvex_assert_receipt_differences"(receipt_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  receipt_status "GoodsReceiptStatus";
BEGIN
  SELECT "status"
  INTO receipt_status
  FROM "GoodsReceipt"
  WHERE "id" = receipt_id;

  IF NOT FOUND OR receipt_status <> 'CONFIRMED' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "GoodsReceiptItem"
    WHERE "goodsReceiptId" = receipt_id
  ) THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Confirmed goods receipt must contain at least one item';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "GoodsReceiptItem" receipt_item
    JOIN "SupplierInvoiceItem" invoice_item
      ON invoice_item."id" = receipt_item."supplierInvoiceItemId"
    WHERE receipt_item."goodsReceiptId" = receipt_id
      AND (
        (
          receipt_item."quantityOrdered" IS NOT NULL
          AND receipt_item."quantityOrdered" <> receipt_item."quantityInvoiced"
        )
        OR (
          SELECT COALESCE(SUM(other_item."quantityReceived"), 0)
          FROM "GoodsReceiptItem" other_item
          JOIN "GoodsReceipt" other_receipt
            ON other_receipt."id" = other_item."goodsReceiptId"
          WHERE other_item."supplierInvoiceItemId" = receipt_item."supplierInvoiceItemId"
            AND other_receipt."status" = 'CONFIRMED'
        ) <> invoice_item."quantity"
      )
      AND (
        receipt_item."differenceAccepted" = false
        OR length(btrim(COALESCE(receipt_item."differenceNote", ''))) = 0
      )
  ) THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Receipt quantity differences require explicit acceptance and a note';
  END IF;
END;
$$;

CREATE FUNCTION "qorvex_check_receipt_differences"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'GoodsReceipt' THEN
    PERFORM "qorvex_assert_receipt_differences"(NEW."id");
  ELSE
    IF TG_OP = 'DELETE' THEN
      PERFORM "qorvex_assert_receipt_differences"(OLD."goodsReceiptId");
    ELSIF TG_OP = 'INSERT' THEN
      PERFORM "qorvex_assert_receipt_differences"(NEW."goodsReceiptId");
    ELSE
      PERFORM "qorvex_assert_receipt_differences"(NEW."goodsReceiptId");
      IF OLD."goodsReceiptId" IS DISTINCT FROM NEW."goodsReceiptId" THEN
        PERFORM "qorvex_assert_receipt_differences"(OLD."goodsReceiptId");
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "GoodsReceipt_difference_acceptance_check"
AFTER INSERT OR UPDATE ON "GoodsReceipt"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "qorvex_check_receipt_differences"();
CREATE CONSTRAINT TRIGGER "GoodsReceiptItem_difference_acceptance_check"
AFTER INSERT OR UPDATE OR DELETE ON "GoodsReceiptItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "qorvex_check_receipt_differences"();

CREATE FUNCTION "qorvex_assert_purchase_order_item_received"(order_item_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  stored_received DECIMAL(14,3);
  confirmed_received DECIMAL(14,3);
BEGIN
  SELECT "receivedQuantity"
  INTO stored_received
  FROM "PurchaseOrderItem"
  WHERE "id" = order_item_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(receipt_item."quantityReceived"), 0)
  INTO confirmed_received
  FROM "GoodsReceiptItem" receipt_item
  JOIN "GoodsReceipt" receipt
    ON receipt."id" = receipt_item."goodsReceiptId"
  WHERE receipt_item."purchaseOrderItemId" = order_item_id
    AND receipt."status" = 'CONFIRMED';

  IF stored_received <> confirmed_received THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Purchase order received quantity must equal confirmed receipt items';
  END IF;
END;
$$;

CREATE FUNCTION "qorvex_check_purchase_order_item_received"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  linked_item RECORD;
BEGIN
  IF TG_TABLE_NAME = 'PurchaseOrderItem' THEN
    PERFORM "qorvex_assert_purchase_order_item_received"(NEW."id");
  ELSIF TG_TABLE_NAME = 'GoodsReceipt' THEN
    FOR linked_item IN
      SELECT DISTINCT "purchaseOrderItemId"
      FROM "GoodsReceiptItem"
      WHERE "goodsReceiptId" = NEW."id"
        AND "purchaseOrderItemId" IS NOT NULL
    LOOP
      PERFORM "qorvex_assert_purchase_order_item_received"(
        linked_item."purchaseOrderItemId"
      );
    END LOOP;
  ELSE
    IF TG_OP = 'DELETE' THEN
      IF OLD."purchaseOrderItemId" IS NOT NULL THEN
        PERFORM "qorvex_assert_purchase_order_item_received"(
          OLD."purchaseOrderItemId"
        );
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      IF NEW."purchaseOrderItemId" IS NOT NULL THEN
        PERFORM "qorvex_assert_purchase_order_item_received"(
          NEW."purchaseOrderItemId"
        );
      END IF;
    ELSE
      IF NEW."purchaseOrderItemId" IS NOT NULL THEN
        PERFORM "qorvex_assert_purchase_order_item_received"(
          NEW."purchaseOrderItemId"
        );
      END IF;
      IF
        OLD."purchaseOrderItemId" IS NOT NULL
        AND OLD."purchaseOrderItemId" IS DISTINCT FROM NEW."purchaseOrderItemId"
      THEN
        PERFORM "qorvex_assert_purchase_order_item_received"(
          OLD."purchaseOrderItemId"
        );
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "PurchaseOrderItem_received_quantity_check"
AFTER INSERT OR UPDATE ON "PurchaseOrderItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "qorvex_check_purchase_order_item_received"();
CREATE CONSTRAINT TRIGGER "GoodsReceipt_received_quantity_check"
AFTER INSERT OR UPDATE ON "GoodsReceipt"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "qorvex_check_purchase_order_item_received"();
CREATE CONSTRAINT TRIGGER "GoodsReceiptItem_received_quantity_check"
AFTER INSERT OR UPDATE OR DELETE ON "GoodsReceiptItem"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "qorvex_check_purchase_order_item_received"();

CREATE FUNCTION "qorvex_assert_credit_approval"(approval_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  approval_record RECORD;
BEGIN
  SELECT
    approval."status",
    approval."customerId",
    approval."initialPaymentOption",
    approval."creditTermOption",
    approval."requestedTotal",
    approval."initialPaymentAmount",
    approval."financedAmount",
    approval."dueDate",
    sales_order."customerId" AS order_customer_id,
    sales_order."status" AS order_status,
    sales_order."paymentMode",
    sales_order."initialPaymentOption" AS order_initial_option,
    sales_order."creditTermOption" AS order_term_option,
    sales_order."total" AS order_total,
    sales_order."initialPaymentAmount" AS order_initial_amount,
    sales_order."dueDate" AS order_due_date
  INTO approval_record
  FROM "CreditSaleApproval" approval
  JOIN "SalesOrder" sales_order
    ON sales_order."id" = approval."salesOrderId"
  WHERE approval."id" = approval_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF
    approval_record."paymentMode" <> 'CREDIT'
    OR approval_record.order_customer_id IS DISTINCT FROM approval_record."customerId"
    OR approval_record.order_initial_option
      IS DISTINCT FROM approval_record."initialPaymentOption"
    OR approval_record.order_term_option
      IS DISTINCT FROM approval_record."creditTermOption"
    OR approval_record.order_total IS DISTINCT FROM approval_record."requestedTotal"
    OR approval_record.order_initial_amount
      IS DISTINCT FROM approval_record."initialPaymentAmount"
    OR approval_record.order_due_date IS DISTINCT FROM approval_record."dueDate"
    OR approval_record."financedAmount"
      IS DISTINCT FROM (
        approval_record."requestedTotal" - approval_record."initialPaymentAmount"
      )
  THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Credit approval must match its sales order and customer';
  END IF;

  IF
    (
      approval_record."status" = 'PENDING'
      AND approval_record.order_status <> 'CREATED'
    )
    OR (
      approval_record."status" = 'APPROVED'
      AND approval_record.order_status NOT IN (
        'SENT_TO_CASHIER',
        'IN_CASHIER',
        'COMPLETED'
      )
    )
    OR (
      approval_record."status" IN ('REJECTED', 'EXPIRED', 'CANCELLED')
      AND approval_record.order_status <> 'CANCELLED'
    )
  THEN
    RAISE EXCEPTION
      USING ERRCODE = '23514',
            MESSAGE = 'Credit approval status is inconsistent with its sales order status';
  END IF;
END;
$$;

CREATE FUNCTION "qorvex_check_credit_approval"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  approval_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'CreditSaleApproval' THEN
    approval_id := NEW."id";
  ELSE
    SELECT "id"
    INTO approval_id
    FROM "CreditSaleApproval"
    WHERE "salesOrderId" = NEW."id";
  END IF;

  IF approval_id IS NOT NULL THEN
    PERFORM "qorvex_assert_credit_approval"(approval_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "CreditSaleApproval_business_coherence_check"
AFTER INSERT OR UPDATE ON "CreditSaleApproval"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "qorvex_check_credit_approval"();
CREATE CONSTRAINT TRIGGER "SalesOrder_credit_approval_coherence_check"
AFTER INSERT OR UPDATE ON "SalesOrder"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "qorvex_check_credit_approval"();
