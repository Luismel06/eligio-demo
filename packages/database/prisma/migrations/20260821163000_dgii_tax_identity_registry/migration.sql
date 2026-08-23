-- CreateEnum
CREATE TYPE "DgiiRegistrySource" AS ENUM ('DGII_OFFICIAL', 'TEST_FIXTURE');

-- CreateEnum
CREATE TYPE "DgiiRegistryDatasetStatus" AS ENUM ('IMPORTING', 'READY', 'ACTIVE', 'SUPERSEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DgiiTaxpayerStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEREGISTERED', 'TEMPORARY_CESSATION', 'ANNULLED', 'REJECTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TaxIdentityContextType" AS ENUM ('POS_ORDER', 'CUSTOMER', 'SUPPLIER', 'CUSTOMER_CREATE', 'SUPPLIER_CREATE');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "taxIdentityVerification" JSONB;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "taxIdentityVerification" JSONB;

-- CreateTable
CREATE TABLE "DgiiRegistryDataset" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source" "DgiiRegistrySource" NOT NULL,
    "status" "DgiiRegistryDatasetStatus" NOT NULL DEFAULT 'IMPORTING',
    "filename" TEXT,
    "checksumSha256" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "invalidRecordCount" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,

    CONSTRAINT "DgiiRegistryDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DgiiTaxpayerRecord" (
    "datasetId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "fiscalName" TEXT NOT NULL,
    "registryStatus" TEXT NOT NULL,
    "status" "DgiiTaxpayerStatus" NOT NULL,

    CONSTRAINT "DgiiTaxpayerRecord_pkey" PRIMARY KEY ("datasetId", "documentType", "documentNumber"),
    CONSTRAINT "DgiiTaxpayerRecord_document_type_check" CHECK ("documentType" IN ('RNC', 'CEDULA'))
);

-- CreateTable
CREATE TABLE "TaxIdentityOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contextType" "TaxIdentityContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "documentHash" VARCHAR(64) NOT NULL,
    "documentLast4" VARCHAR(4) NOT NULL,
    "fiscalName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxIdentityOverride_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaxIdentityOverride_document_type_check" CHECK ("documentType" IN ('RNC', 'CEDULA'))
);

-- One and only one registry version may serve lookups at a time.
CREATE UNIQUE INDEX "DgiiRegistryDataset_one_active_idx"
ON "DgiiRegistryDataset" ((1))
WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "DgiiRegistryDataset_version_key" ON "DgiiRegistryDataset"("version");

-- CreateIndex
CREATE UNIQUE INDEX "DgiiRegistryDataset_checksumSha256_key" ON "DgiiRegistryDataset"("checksumSha256");

-- CreateIndex
CREATE INDEX "DgiiRegistryDataset_status_idx" ON "DgiiRegistryDataset"("status");

-- CreateIndex
CREATE INDEX "DgiiRegistryDataset_source_sourceUpdatedAt_idx" ON "DgiiRegistryDataset"("source", "sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "DgiiRegistryDataset_activatedAt_idx" ON "DgiiRegistryDataset"("activatedAt");

-- CreateIndex
CREATE INDEX "DgiiTaxpayerRecord_datasetId_status_idx" ON "DgiiTaxpayerRecord"("datasetId", "status");

-- CreateIndex
CREATE INDEX "TaxIdentityOverride_tenantId_contextType_contextId_documentHash_expiresAt_idx" ON "TaxIdentityOverride"("tenantId", "contextType", "contextId", "documentHash", "expiresAt");

-- CreateIndex
CREATE INDEX "TaxIdentityOverride_requestedById_idx" ON "TaxIdentityOverride"("requestedById");

-- CreateIndex
CREATE INDEX "TaxIdentityOverride_approvedById_idx" ON "TaxIdentityOverride"("approvedById");

-- CreateIndex
CREATE INDEX "TaxIdentityOverride_expiresAt_idx" ON "TaxIdentityOverride"("expiresAt");

-- CreateIndex
CREATE INDEX "TaxIdentityOverride_usedAt_idx" ON "TaxIdentityOverride"("usedAt");

-- AddForeignKey
ALTER TABLE "DgiiTaxpayerRecord" ADD CONSTRAINT "DgiiTaxpayerRecord_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "DgiiRegistryDataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxIdentityOverride" ADD CONSTRAINT "TaxIdentityOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxIdentityOverride" ADD CONSTRAINT "TaxIdentityOverride_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxIdentityOverride" ADD CONSTRAINT "TaxIdentityOverride_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
