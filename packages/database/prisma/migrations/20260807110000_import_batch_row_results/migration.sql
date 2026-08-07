-- Stores the result of every processed row so a batch can show imported
-- products and failed rows. Deleting a batch never deletes products; the
-- product relation is retained as history and becomes null only if a product
-- is deleted independently.

CREATE TYPE "ImportRowStatus" AS ENUM ('IMPORTED', 'FAILED');

CREATE TABLE "ImportBatchRow" (
  "id" TEXT NOT NULL,
  "importBatchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "status" "ImportRowStatus" NOT NULL,
  "productId" TEXT,
  "productLabel" TEXT,
  "rawData" JSONB NOT NULL,
  "reasons" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ImportBatchRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportBatchRow_importBatchId_rowNumber_key"
ON "ImportBatchRow"("importBatchId", "rowNumber");

CREATE INDEX "ImportBatchRow_importBatchId_status_rowNumber_idx"
ON "ImportBatchRow"("importBatchId", "status", "rowNumber");

CREATE INDEX "ImportBatchRow_productId_idx"
ON "ImportBatchRow"("productId");

ALTER TABLE "ImportBatchRow"
ADD CONSTRAINT "ImportBatchRow_importBatchId_fkey"
FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImportBatchRow"
ADD CONSTRAINT "ImportBatchRow_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "Product"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
