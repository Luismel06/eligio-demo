-- Prevent duplicate customer identity documents within the same tenant.
-- PostgreSQL unique indexes allow multiple NULL document numbers, which keeps
-- customers without a document compatible with this constraint.

BEGIN;

-- Keep the preflight result valid until normalization and the unique index
-- have both completed.
LOCK TABLE "Customer" IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  duplicate_group_count BIGINT;
  duplicate_sample TEXT;
BEGIN
  SELECT COUNT(*)
  INTO duplicate_group_count
  FROM (
    SELECT 1
    FROM "Customer"
    CROSS JOIN LATERAL (
      SELECT NULLIF(
        CASE
          WHEN "documentType" IN ('RNC', 'CEDULA')
            AND BTRIM("documentNumber") ~ '^[0-9[:space:]-]+$'
          THEN REGEXP_REPLACE(BTRIM("documentNumber"), '[[:space:]-]', '', 'g')
          ELSE BTRIM("documentNumber")
        END,
        ''
      ) AS canonical_document
    ) AS normalized
    WHERE normalized.canonical_document IS NOT NULL
    GROUP BY "tenantId", "documentType", normalized.canonical_document
    HAVING COUNT(*) > 1
  ) AS duplicate_groups;

  IF duplicate_group_count > 0 THEN
    SELECT STRING_AGG(
      FORMAT(
        'tenant=%s, type=%s, count=%s',
        duplicate_group."tenantId",
        duplicate_group."documentType",
        duplicate_group.duplicate_count
      ),
      '; '
    )
    INTO duplicate_sample
    FROM (
      SELECT
        "tenantId",
        "documentType",
        COUNT(*) AS duplicate_count
      FROM "Customer"
      CROSS JOIN LATERAL (
        SELECT NULLIF(
          CASE
            WHEN "documentType" IN ('RNC', 'CEDULA')
              AND BTRIM("documentNumber") ~ '^[0-9[:space:]-]+$'
            THEN REGEXP_REPLACE(BTRIM("documentNumber"), '[[:space:]-]', '', 'g')
            ELSE BTRIM("documentNumber")
          END,
          ''
        ) AS canonical_document
      ) AS normalized
      WHERE normalized.canonical_document IS NOT NULL
      GROUP BY "tenantId", "documentType", normalized.canonical_document
      HAVING COUNT(*) > 1
      ORDER BY "tenantId", "documentType", normalized.canonical_document
      LIMIT 10
    ) AS duplicate_group;

    RAISE EXCEPTION USING
      MESSAGE = FORMAT(
        'Cannot enforce customer document uniqueness: found %s duplicate group(s).',
        duplicate_group_count
      ),
      DETAIL = duplicate_sample,
      HINT = 'Resolve the duplicate Customer records and re-run this migration.';
  END IF;
END
$$;

-- Match the normalization used by the API without silently removing letters
-- from malformed legacy documents.
UPDATE "Customer"
SET "documentNumber" = NULLIF(
  CASE
    WHEN "documentType" IN ('RNC', 'CEDULA')
      AND BTRIM("documentNumber") ~ '^[0-9[:space:]-]+$'
    THEN REGEXP_REPLACE(BTRIM("documentNumber"), '[[:space:]-]', '', 'g')
    ELSE BTRIM("documentNumber")
  END,
  ''
)
WHERE "documentNumber" IS NOT NULL;

DROP INDEX IF EXISTS "Customer_tenantId_documentNumber_idx";

CREATE UNIQUE INDEX "Customer_tenantId_documentType_documentNumber_key"
ON "Customer"("tenantId", "documentType", "documentNumber");

COMMIT;
