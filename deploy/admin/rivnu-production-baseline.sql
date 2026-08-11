\set ON_ERROR_STOP on

-- One-time production baseline for Ferreteria RIVNU.
--
-- Preconditions:
--   * the API is stopped;
--   * a full, verified pg_dump exists;
--   * migrations through 20260811101000_local_ncf_foundation are applied;
--   * production still contains only the known BA0009 rehearsal transaction.
--
-- This script deliberately preserves identities, memberships, employees,
-- product/catalog data, imports, opening inventory, branding and registers.
-- It refuses to run after real local B01/B02 issuance has started.

BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '5min';

SELECT pg_advisory_xact_lock(hashtextextended('rivnu:production-baseline:20260811', 0));

LOCK TABLE
  "Tenant",
  "Product",
  "InventoryMovement",
  "Invoice",
  "InvoiceItem",
  "Payment",
  "ElectronicDocument",
  "SalesOrder",
  "SalesOrderItem",
  "CreditSaleApproval",
  "ReturnRequest",
  "ReturnRequestItem",
  "CashSession",
  "CashMovement",
  "EmployeeActivityLog",
  "FiscalSequence",
  "AuditLog"
IN SHARE ROW EXCLUSIVE MODE;

DO $baseline_preflight$
DECLARE
  target_tenant_id TEXT;
BEGIN
  SELECT id INTO STRICT target_tenant_id
  FROM "Tenant"
  WHERE slug = 'ferreteria-rivnu';

  IF (SELECT count(*) FROM "User") <> 6 THEN
    RAISE EXCEPTION 'Preflight failed: expected 6 users.';
  END IF;

  IF (SELECT count(*) FROM "Membership" WHERE "tenantId" = target_tenant_id) <> 5 THEN
    RAISE EXCEPTION 'Preflight failed: expected 5 RIVNU memberships.';
  END IF;

  IF (SELECT count(*) FROM "EmployeeProfile" WHERE "tenantId" = target_tenant_id) <> 5 THEN
    RAISE EXCEPTION 'Preflight failed: expected 5 RIVNU employee profiles.';
  END IF;

  IF (SELECT count(*) FROM "Product" WHERE "tenantId" = target_tenant_id) <> 796 THEN
    RAISE EXCEPTION 'Preflight failed: expected 796 RIVNU products.';
  END IF;

  IF (
    SELECT count(*)
    FROM "InventoryMovement"
    WHERE "tenantId" = target_tenant_id
      AND type = 'INITIAL_STOCK'
  ) <> 796 THEN
    RAISE EXCEPTION 'Preflight failed: expected 796 opening inventory movements.';
  END IF;

  IF (
    SELECT count(*)
    FROM "Invoice"
    WHERE "tenantId" = target_tenant_id
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM "Invoice"
    WHERE "tenantId" = target_tenant_id
      AND "invoiceNumber" = 'RIV-BA0009'
      AND COALESCE(ncf, '') = 'BA0009'
  ) THEN
    RAISE EXCEPTION 'Preflight failed: invoice set is not the known BA0009 rehearsal.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Invoice"
    WHERE "tenantId" = target_tenant_id
      AND (
        "documentType"::text IN ('CONSUMER_02', 'FISCAL_CREDIT_01')
        OR COALESCE(ncf, '') ~ '^B0[12][0-9]{8}$'
      )
  ) THEN
    RAISE EXCEPTION 'Preflight failed: a local fiscal invoice already exists.';
  END IF;

  IF (SELECT count(*) FROM "SalesOrder" WHERE "tenantId" = target_tenant_id) <> 1 THEN
    RAISE EXCEPTION 'Preflight failed: expected one rehearsal sales order.';
  END IF;

  IF (SELECT count(*) FROM "Payment" WHERE "tenantId" = target_tenant_id) <> 1 THEN
    RAISE EXCEPTION 'Preflight failed: expected one rehearsal payment.';
  END IF;

  IF (
    SELECT count(*)
    FROM "InventoryMovement"
    WHERE "tenantId" = target_tenant_id
      AND type IN ('SALE', 'RETURN')
  ) <> 2 THEN
    RAISE EXCEPTION 'Preflight failed: expected two rehearsal stock movements.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "FiscalSequence"
    WHERE "tenantId" = target_tenant_id
      AND (
        "documentType"::text IN ('CONSUMER_02', 'FISCAL_CREDIT_01')
        OR "authorizationNumber" IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Preflight failed: a real/local fiscal range may already be configured.';
  END IF;
END
$baseline_preflight$;

CREATE TEMPORARY TABLE rivnu_stock_restore ON COMMIT DROP AS
SELECT
  movement."productId",
  SUM(
    CASE
      WHEN movement.type = 'SALE' THEN movement.quantity
      WHEN movement.type = 'RETURN' THEN -movement.quantity
      ELSE 0
    END
  ) AS quantity
FROM "InventoryMovement" AS movement
WHERE movement."tenantId" = (
    SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu'
  )
  AND movement.type IN ('SALE', 'RETURN')
GROUP BY movement."productId";

DO $stock_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM rivnu_stock_restore AS restore
    LEFT JOIN "Product" AS product ON product.id = restore."productId"
    WHERE product.id IS NULL
      OR product."tenantId" <> (
        SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu'
      )
      OR product.stock + restore.quantity < 0
  ) THEN
    RAISE EXCEPTION 'Stock restoration preflight failed.';
  END IF;
END
$stock_preflight$;

UPDATE "Product" AS product
SET
  stock = product.stock + restore.quantity,
  "reservedStock" = 0,
  "updatedAt" = CURRENT_TIMESTAMP
FROM rivnu_stock_restore AS restore
WHERE product.id = restore."productId";

UPDATE "Product"
SET "reservedStock" = 0, "updatedAt" = CURRENT_TIMESTAMP
WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu')
  AND "reservedStock" <> 0;

DELETE FROM "EmployeeActivityLog"
WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu')
  AND action::text IN (
    'OPEN_CASH_SESSION',
    'CLOSE_CASH_SESSION',
    'CREATE_SALES_ORDER',
    'SEND_SALES_ORDER_TO_CASHIER',
    'CLAIM_SALES_ORDER',
    'RELEASE_SALES_ORDER',
    'COMPLETE_SALES_ORDER',
    'CANCEL_SALES_ORDER',
    'EXPIRE_SALES_ORDER',
    'CREATE_SALE',
    'CANCEL_SALE',
    'ISSUE_INVOICE',
    'CANCEL_INVOICE',
    'PRINT_RECEIPT',
    'REPRINT_RECEIPT',
    'CASH_IN',
    'CASH_OUT',
    'REQUEST_RETURN',
    'APPROVE_RETURN',
    'REJECT_RETURN',
    'COMPLETE_RETURN'
  );

DELETE FROM "ReturnRequest"
WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu');

DELETE FROM "InventoryMovement"
WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu')
  AND type IN ('SALE', 'RETURN');

DELETE FROM "CreditSaleApproval"
WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu');

DELETE FROM "SalesOrder"
WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu');

DELETE FROM "Payment"
WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu');

DELETE FROM "ElectronicDocument"
WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu');

DELETE FROM "Invoice"
WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu');

DELETE FROM "CashSession"
WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu');

DELETE FROM "FiscalSequence"
WHERE "tenantId" = (SELECT id FROM "Tenant" WHERE slug = 'ferreteria-rivnu');

UPDATE "Tenant"
SET
  "legalName" = 'STARLIN ANTONIO RIVAS NUÑEZ',
  rnc = '40220429126',
  "updatedAt" = CURRENT_TIMESTAMP
WHERE slug = 'ferreteria-rivnu';

INSERT INTO "FiscalSequence" (
  id,
  "tenantId",
  "documentType",
  prefix,
  "startNumber",
  "endNumber",
  "nextNumber",
  "authorizationNumber",
  "issuerTaxId",
  "validUntil",
  status,
  "createdAt",
  "updatedAt"
)
SELECT
  'fseq-rivnu-b01-6005410462',
  id,
  'FISCAL_CREDIT_01',
  'B01',
  1,
  30,
  1,
  '6005410462',
  '40220429126',
  DATE '2027-12-31',
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Tenant"
WHERE slug = 'ferreteria-rivnu';

INSERT INTO "AuditLog" (
  id,
  "tenantId",
  "userId",
  action,
  entity,
  "entityId",
  metadata,
  "createdAt"
)
SELECT
  'audit-rivnu-production-baseline-20260811',
  id,
  NULL,
  'PRODUCTION_BASELINE_ESTABLISHED',
  'Tenant',
  id,
  jsonb_build_object(
    'preservedProducts', 796,
    'preservedUsers', 6,
    'removedRehearsalInvoice', 'RIV-BA0009',
    'b01Authorization', '6005410462',
    'b01Start', 1,
    'b01End', 30,
    'b01Next', 1,
    'b01ValidUntil', '2027-12-31'
  ),
  CURRENT_TIMESTAMP
FROM "Tenant"
WHERE slug = 'ferreteria-rivnu';

DO $baseline_postflight$
DECLARE
  target_tenant_id TEXT;
BEGIN
  SELECT id INTO STRICT target_tenant_id
  FROM "Tenant"
  WHERE slug = 'ferreteria-rivnu';

  IF (SELECT count(*) FROM "User") <> 6
     OR (SELECT count(*) FROM "Membership" WHERE "tenantId" = target_tenant_id) <> 5
     OR (SELECT count(*) FROM "EmployeeProfile" WHERE "tenantId" = target_tenant_id) <> 5
     OR (SELECT count(*) FROM "Product" WHERE "tenantId" = target_tenant_id) <> 796
     OR (SELECT count(*) FROM "InventoryMovement" WHERE "tenantId" = target_tenant_id AND type = 'INITIAL_STOCK') <> 796 THEN
    RAISE EXCEPTION 'Postflight failed: preserved identity/catalog counts changed.';
  END IF;

  IF (SELECT count(*) FROM "Invoice" WHERE "tenantId" = target_tenant_id) <> 0
     OR (SELECT count(*) FROM "InvoiceItem" AS item JOIN "Invoice" AS invoice ON invoice.id = item."invoiceId" WHERE invoice."tenantId" = target_tenant_id) <> 0
     OR (SELECT count(*) FROM "Payment" WHERE "tenantId" = target_tenant_id) <> 0
     OR (SELECT count(*) FROM "ElectronicDocument" WHERE "tenantId" = target_tenant_id) <> 0
     OR (SELECT count(*) FROM "SalesOrder" WHERE "tenantId" = target_tenant_id) <> 0
     OR (SELECT count(*) FROM "ReturnRequest" WHERE "tenantId" = target_tenant_id) <> 0
     OR (SELECT count(*) FROM "CashSession" WHERE "tenantId" = target_tenant_id) <> 0
     OR (SELECT count(*) FROM "CashMovement" WHERE "tenantId" = target_tenant_id) <> 0
     OR (SELECT count(*) FROM "InventoryMovement" WHERE "tenantId" = target_tenant_id AND type IN ('SALE', 'RETURN')) <> 0 THEN
    RAISE EXCEPTION 'Postflight failed: operational rehearsal data remains.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Product"
    WHERE "tenantId" = target_tenant_id
      AND (stock < 0 OR "reservedStock" <> 0)
  ) THEN
    RAISE EXCEPTION 'Postflight failed: invalid product stock remains.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "FiscalSequence"
    WHERE "tenantId" = target_tenant_id
      AND "documentType"::text = 'FISCAL_CREDIT_01'
      AND prefix = 'B01'
      AND "startNumber" = 1
      AND "endNumber" = 30
      AND "nextNumber" = 1
      AND "authorizationNumber" = '6005410462'
      AND "issuerTaxId" = '40220429126'
      AND "validUntil" = DATE '2027-12-31'
      AND status = 'ACTIVE'
  ) OR (SELECT count(*) FROM "FiscalSequence" WHERE "tenantId" = target_tenant_id) <> 1 THEN
    RAISE EXCEPTION 'Postflight failed: exact B01 baseline was not established.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "Tenant"
    WHERE id = target_tenant_id
      AND rnc = '40220429126'
      AND "legalName" = 'STARLIN ANTONIO RIVAS NUÑEZ'
  ) THEN
    RAISE EXCEPTION 'Postflight failed: issuer identity does not match the authorization.';
  END IF;
END
$baseline_postflight$;

COMMIT;

SELECT
  tenant.slug,
  tenant.rnc,
  tenant."legalName",
  sequence."documentType",
  sequence.prefix,
  sequence."startNumber",
  sequence."endNumber",
  sequence."nextNumber",
  sequence."authorizationNumber",
  sequence."validUntil",
  sequence.status
FROM "Tenant" AS tenant
JOIN "FiscalSequence" AS sequence ON sequence."tenantId" = tenant.id
WHERE tenant.slug = 'ferreteria-rivnu';
