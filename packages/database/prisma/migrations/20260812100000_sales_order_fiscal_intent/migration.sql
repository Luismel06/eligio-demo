BEGIN;

CREATE TYPE "FiscalDocumentPurpose" AS ENUM ('CONSUMER', 'FISCAL_CREDIT');
CREATE TYPE "FiscalIssuanceMode" AS ENUM ('LOCAL_NCF', 'ELECTRONIC_ECF');

ALTER TABLE "Tenant"
  ADD COLUMN "fiscalIssuanceMode" "FiscalIssuanceMode" NOT NULL DEFAULT 'LOCAL_NCF';

-- An open sales order or quotation created by an older build has no
-- authoritative fiscal purpose: checkout previously allowed the cashier to
-- choose B01 or B02. Do not silently relabel pending commercial documents.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SalesOrder"
    WHERE "invoiceId" IS NULL
      AND "status" NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED')
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate open sales orders or quotations without confirmed fiscal purpose; complete, cancel, or recreate them first.';
  END IF;
END $$;

-- Only completed/cancelled/expired historical orders remain at this point.
-- Backfill the neutral consumer purpose without changing issued invoices.
ALTER TABLE "SalesOrder"
  ADD COLUMN "fiscalPurpose" "FiscalDocumentPurpose" NOT NULL DEFAULT 'CONSUMER',
  ADD COLUMN "fiscalDocumentTypeSnapshot" "InvoiceDocumentType" NOT NULL DEFAULT 'CONSUMER_02',
  ADD COLUMN "fiscalCustomerSnapshot" JSONB;

ALTER TABLE "SalesOrder"
  ADD CONSTRAINT "SalesOrder_fiscal_purpose_document_type_check"
  CHECK (
    (
      "fiscalPurpose" = 'CONSUMER'
      AND "fiscalDocumentTypeSnapshot" IN (
        'CONSUMER_02'::"InvoiceDocumentType",
        'CONSUMER_ELECTRONIC_32'::"InvoiceDocumentType"
      )
    )
    OR
    (
      "fiscalPurpose" = 'FISCAL_CREDIT'
      AND "fiscalDocumentTypeSnapshot" IN (
        'FISCAL_CREDIT_01'::"InvoiceDocumentType",
        'FISCAL_CREDIT_ELECTRONIC_31'::"InvoiceDocumentType"
      )
    )
  );

ALTER TABLE "SalesOrder"
  ADD CONSTRAINT "SalesOrder_fiscal_customer_snapshot_check"
  CHECK (
    (
      "fiscalPurpose" = 'FISCAL_CREDIT'
      AND (
        (
          COALESCE(jsonb_typeof("fiscalCustomerSnapshot"), 'null') = 'null'
          AND "invoiceId" IS NULL
        )
        OR (
          COALESCE(jsonb_typeof("fiscalCustomerSnapshot"), '') = 'object'
          AND BTRIM(COALESCE("fiscalCustomerSnapshot" ->> 'name', '')) <> ''
          AND (
            (
              "fiscalCustomerSnapshot" ->> 'documentType' = 'RNC'
              AND COALESCE("fiscalCustomerSnapshot" ->> 'documentNumber', '') ~ '^[0-9]{9}$'
            )
            OR (
              "fiscalCustomerSnapshot" ->> 'documentType' = 'CEDULA'
              AND COALESCE("fiscalCustomerSnapshot" ->> 'documentNumber', '') ~ '^[0-9]{11}$'
            )
          )
          AND (
            (
              "fiscalCustomerSnapshot" ->> 'id' IS NULL
            )
            OR (
              "customerId" IS NOT NULL
              AND "fiscalCustomerSnapshot" ->> 'id' = "customerId"
            )
          )
        )
      )
    )
    OR (
      "fiscalPurpose" = 'CONSUMER'
      AND (
        COALESCE(jsonb_typeof("fiscalCustomerSnapshot"), 'null') = 'null'
        OR (
          COALESCE(jsonb_typeof("fiscalCustomerSnapshot"), '') = 'object'
          AND BTRIM(COALESCE("fiscalCustomerSnapshot" ->> 'name', '')) <> ''
          AND (
            (
              "fiscalCustomerSnapshot" ->> 'documentType' = 'RNC'
              AND COALESCE("fiscalCustomerSnapshot" ->> 'documentNumber', '') ~ '^[0-9]{9}$'
            )
            OR (
              "fiscalCustomerSnapshot" ->> 'documentType' = 'CEDULA'
              AND COALESCE("fiscalCustomerSnapshot" ->> 'documentNumber', '') ~ '^[0-9]{11}$'
            )
            OR (
              "fiscalCustomerSnapshot" ->> 'documentType' = 'PASSPORT'
              AND BTRIM(COALESCE("fiscalCustomerSnapshot" ->> 'documentNumber', '')) <> ''
            )
          )
          AND (
            (
              "fiscalCustomerSnapshot" ->> 'id' IS NULL
            )
            OR (
              "customerId" IS NOT NULL
              AND "fiscalCustomerSnapshot" ->> 'id' = "customerId"
            )
          )
        )
      )
      AND (
        "invoiceId" IS NULL
        OR "fiscalDocumentTypeSnapshot" <> 'CONSUMER_02'::"InvoiceDocumentType"
        OR "subtotal" < 250000
        OR COALESCE(jsonb_typeof("fiscalCustomerSnapshot"), '') = 'object'
      )
    )
  ) NOT VALID;

CREATE INDEX "SalesOrder_tenantId_fiscalDocumentTypeSnapshot_status_idx"
  ON "SalesOrder"("tenantId", "fiscalDocumentTypeSnapshot", "status");

COMMIT;
