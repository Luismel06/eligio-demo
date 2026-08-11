ALTER TABLE "Invoice"
  ALTER COLUMN "documentType" SET DEFAULT 'CONSUMER_02',
  ADD COLUMN "fiscalSequenceId" TEXT,
  ADD COLUMN "fiscalAuthorizationNumber" TEXT,
  ADD COLUMN "fiscalValidUntil" DATE,
  ADD COLUMN "fiscalIssuerSnapshot" JSONB,
  ADD COLUMN "fiscalCustomerSnapshot" JSONB;

ALTER TABLE "InvoiceItem"
  ADD COLUMN "unit" "ProductUnit",
  ADD COLUMN "taxCategory" "TaxCategory";

UPDATE "InvoiceItem" AS item
SET "unit" = product."unit"
FROM "Product" AS product
WHERE item."productId" = product."id"
  AND item."unit" IS NULL;

UPDATE "InvoiceItem"
SET "unit" = 'UNIT'
WHERE "unit" IS NULL;

UPDATE "InvoiceItem"
SET "taxCategory" = CASE
  WHEN "taxRate" = 0 THEN 'EXEMPT'::"TaxCategory"
  WHEN "taxRate" = 0.16 THEN 'ITBIS_16'::"TaxCategory"
  WHEN "taxRate" = 0.18 THEN 'ITBIS_18'::"TaxCategory"
END
WHERE "taxRate" IN (0, 0.16, 0.18)
  AND "taxCategory" IS NULL;

UPDATE "InvoiceItem" AS item
SET "taxCategory" = product."taxCategory"
FROM "Product" AS product
WHERE item."productId" = product."id"
  AND item."taxCategory" IS NULL;

UPDATE "InvoiceItem"
SET "taxCategory" = 'ITBIS_18'
WHERE "taxCategory" IS NULL;

ALTER TABLE "InvoiceItem"
  ALTER COLUMN "unit" SET DEFAULT 'UNIT',
  ALTER COLUMN "unit" SET NOT NULL,
  ALTER COLUMN "taxCategory" SET DEFAULT 'ITBIS_18',
  ALTER COLUMN "taxCategory" SET NOT NULL;

-- Preserve the fiscal attributes that applied when each sales-order line was
-- created. Existing rows are backfilled before the columns become mandatory:
-- unit uses the related product when it still exists, while tax category is
-- derived from the already-snapshotted tax rate rather than mutable product data.
ALTER TABLE "SalesOrderItem"
  ADD COLUMN "unit" "ProductUnit",
  ADD COLUMN "taxCategory" "TaxCategory";

UPDATE "SalesOrderItem" AS item
SET "unit" = product."unit"
FROM "Product" AS product
WHERE item."productId" = product."id"
  AND item."unit" IS NULL;

UPDATE "SalesOrderItem"
SET "unit" = 'UNIT'
WHERE "unit" IS NULL;

UPDATE "SalesOrderItem"
SET "taxCategory" = CASE
  WHEN "taxRate" = 0 THEN 'EXEMPT'::"TaxCategory"
  WHEN "taxRate" = 0.16 THEN 'ITBIS_16'::"TaxCategory"
  WHEN "taxRate" = 0.18 THEN 'ITBIS_18'::"TaxCategory"
END
WHERE "taxRate" IN (0, 0.16, 0.18)
  AND "taxCategory" IS NULL;

UPDATE "SalesOrderItem" AS item
SET "taxCategory" = product."taxCategory"
FROM "Product" AS product
WHERE item."productId" = product."id"
  AND item."taxCategory" IS NULL;

UPDATE "SalesOrderItem"
SET "taxCategory" = 'ITBIS_18'
WHERE "taxCategory" IS NULL;

ALTER TABLE "SalesOrderItem"
  ALTER COLUMN "unit" SET DEFAULT 'UNIT',
  ALTER COLUMN "unit" SET NOT NULL,
  ALTER COLUMN "taxCategory" SET DEFAULT 'ITBIS_18',
  ALTER COLUMN "taxCategory" SET NOT NULL;

ALTER TABLE "FiscalSequence"
  ALTER COLUMN "validUntil" TYPE DATE USING "validUntil"::date,
  ADD COLUMN "authorizationNumber" TEXT,
  ADD COLUMN "issuerTaxId" TEXT;

-- Previous POS builds generated electronic-looking/demo values without signing
-- or sending them to DGII. Only alter rows with explicit demo evidence. In
-- particular, an E31/E32 value by itself is not proof that the document is fake
-- and must retain its original fiscal evidence.
UPDATE "FiscalSequence"
SET "status" = 'INACTIVE', "updatedAt" = NOW()
WHERE "status" = 'ACTIVE'
  AND "documentType"::text = 'CONSUMER_ELECTRONIC_32'
  AND "prefix" = 'BA';

UPDATE "Invoice" AS invoice
SET "fiscalStatus" = 'LEGACY_UNVERIFIED'
WHERE invoice."documentType"::text IN (
    'CONSUMER_ELECTRONIC_32',
    'FISCAL_CREDIT_ELECTRONIC_31',
    'DEBIT_NOTE_ELECTRONIC_33',
    'CREDIT_NOTE_ELECTRONIC_34'
  )
  AND (
    -- BA plus four digits is the exact non-fiscal format emitted by the old
    -- demo POS. A real e-CF uses its E-document-type prefix instead.
    COALESCE(invoice."ncf", '') ~ '^BA[0-9]{4}$'
    OR COALESCE(invoice."eNcf", '') ~ '^BA[0-9]{4}$'
    OR EXISTS (
      SELECT 1
      FROM "ElectronicDocument" AS document
      WHERE document."invoiceId" = invoice."id"
        AND (
          document."provider" = 'MOCK'
          OR document."trackId" ILIKE '%DEMO%'
          OR document."requestPayload" ->> 'mode' ILIKE 'demo'
        )
    )
  );

UPDATE "ElectronicDocument" AS document
SET
  "provider" = 'MOCK',
  "status" = 'CANCELLED',
  "updatedAt" = NOW()
WHERE document."provider" = 'MOCK'
  OR document."trackId" ILIKE '%DEMO%'
  OR document."requestPayload" ->> 'mode' ILIKE 'demo'
  OR EXISTS (
    SELECT 1
    FROM "Invoice" AS invoice
    WHERE invoice."id" = document."invoiceId"
      AND (
        COALESCE(invoice."ncf", '') ~ '^BA[0-9]{4}$'
        OR COALESCE(invoice."eNcf", '') ~ '^BA[0-9]{4}$'
      )
  );

CREATE UNIQUE INDEX "Invoice_tenantId_ncf_key"
  ON "Invoice"("tenantId", "ncf");

CREATE INDEX "Invoice_fiscalSequenceId_idx"
  ON "Invoice"("fiscalSequenceId");

CREATE UNIQUE INDEX "FiscalSequence_tenantId_id_key"
  ON "FiscalSequence"("tenantId", "id");

CREATE UNIQUE INDEX "FiscalSequence_one_active_per_tenant_type_key"
  ON "FiscalSequence"("tenantId", "documentType")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_tenantId_fiscalSequenceId_fkey"
  FOREIGN KEY ("tenantId", "fiscalSequenceId")
  REFERENCES "FiscalSequence"("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FiscalSequence"
  ADD CONSTRAINT "FiscalSequence_number_range_check"
  CHECK (
    "startNumber" >= 1
    AND "endNumber" <= 99999999
    AND "startNumber" <= "endNumber"
    AND "nextNumber" >= "startNumber"
    AND "nextNumber" <= "endNumber" + 1
  ),
  ADD CONSTRAINT "FiscalSequence_local_metadata_check"
  CHECK (
    "documentType"::text NOT IN ('CONSUMER_02', 'FISCAL_CREDIT_01')
    OR (
      "authorizationNumber" IS NOT NULL
      AND BTRIM("authorizationNumber") <> ''
      AND "issuerTaxId" IS NOT NULL
      AND BTRIM("issuerTaxId") <> ''
      AND "issuerTaxId" ~ '^[0-9]{9}([0-9]{2})?$'
      AND (
        ("documentType"::text = 'CONSUMER_02' AND "prefix" = 'B02')
        OR (
          "documentType"::text = 'FISCAL_CREDIT_01'
          AND "prefix" = 'B01'
          AND "validUntil" IS NOT NULL
        )
      )
    )
  );

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_local_ncf_shape_check"
  CHECK (
    "documentType"::text NOT IN ('CONSUMER_02', 'FISCAL_CREDIT_01')
    OR "fiscalStatus"::text <> 'LOCAL_ISSUED'
    OR (
      "eNcf" IS NULL
      AND "fiscalSequenceId" IS NOT NULL
      AND "fiscalAuthorizationNumber" IS NOT NULL
      AND BTRIM("fiscalAuthorizationNumber") <> ''
      AND "fiscalIssuerSnapshot" IS NOT NULL
      AND COALESCE(jsonb_typeof("fiscalIssuerSnapshot"), '') = 'object'
      AND BTRIM(COALESCE("fiscalIssuerSnapshot" ->> 'rnc', '')) <> ''
      AND COALESCE("fiscalIssuerSnapshot" ->> 'rnc', '') ~ '^[0-9]{9}([0-9]{2})?$'
      AND BTRIM(COALESCE("fiscalIssuerSnapshot" ->> 'legalName', '')) <> ''
      AND BTRIM(COALESCE("fiscalIssuerSnapshot" ->> 'commercialName', '')) <> ''
      AND BTRIM(COALESCE("fiscalIssuerSnapshot" ->> 'address', '')) <> ''
      AND BTRIM(COALESCE("fiscalIssuerSnapshot" ->> 'phone', '')) <> ''
      AND BTRIM(COALESCE("fiscalIssuerSnapshot" ->> 'email', '')) <> ''
      AND BTRIM(COALESCE("fiscalIssuerSnapshot" ->> 'pointOfSale', '')) <> ''
      AND "issuedAt" IS NOT NULL
      AND "ncf" IS NOT NULL
      AND (
        (
          "documentType"::text = 'CONSUMER_02'
          AND "ncf" ~ '^B02[0-9]{8}$'
          AND (
            "subtotal" < 250000
            OR (
              "fiscalCustomerSnapshot" IS NOT NULL
              AND COALESCE(jsonb_typeof("fiscalCustomerSnapshot"), '') = 'object'
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
            )
          )
        )
        OR (
          "documentType"::text = 'FISCAL_CREDIT_01'
          AND "ncf" ~ '^B01[0-9]{8}$'
          AND "fiscalValidUntil" IS NOT NULL
          AND "fiscalValidUntil" >= (
            ("issuedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Santo_Domingo'
          )::date
          AND "fiscalCustomerSnapshot" IS NOT NULL
          AND COALESCE(jsonb_typeof("fiscalCustomerSnapshot"), '') = 'object'
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
        )
      )
    )
  );
