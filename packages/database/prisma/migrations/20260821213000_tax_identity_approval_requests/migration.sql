-- CreateEnum
CREATE TYPE "TaxIdentityApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "TaxIdentityApprovalRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contextType" "TaxIdentityContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "documentNumber" VARCHAR(11) NOT NULL,
    "documentHash" VARCHAR(64) NOT NULL,
    "documentLast4" VARCHAR(4) NOT NULL,
    "fiscalName" TEXT NOT NULL,
    "reason" TEXT,
    "registryOutcome" VARCHAR(32) NOT NULL,
    "registrySource" "DgiiRegistrySource",
    "registryCheckedAt" TIMESTAMP(3) NOT NULL,
    "registrySourceUpdatedAt" TIMESTAMP(3),
    "status" "TaxIdentityApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "overrideId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxIdentityApprovalRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaxIdentityApprovalRequest_document_type_check" CHECK ("documentType" IN ('RNC', 'CEDULA')),
    CONSTRAINT "TaxIdentityApprovalRequest_registry_outcome_check" CHECK ("registryOutcome" IN ('NOT_FOUND', 'NON_ACTIVE', 'REGISTRY_STALE', 'UNAVAILABLE')),
    CONSTRAINT "TaxIdentityApprovalRequest_document_length_check" CHECK (char_length("documentNumber") IN (9, 11))
);

-- At most one unresolved decision may exist for the same fiscal context.
CREATE UNIQUE INDEX "TaxIdentityApprovalRequest_one_pending_context_idx"
ON "TaxIdentityApprovalRequest"("tenantId", "contextType", "contextId")
WHERE "status" = 'PENDING';

-- CreateIndex
CREATE INDEX "TaxIdentityApprovalRequest_tenantId_status_requestedAt_idx" ON "TaxIdentityApprovalRequest"("tenantId", "status", "requestedAt");

-- CreateIndex
CREATE INDEX "TaxIdentityApprovalRequest_context_document_idx" ON "TaxIdentityApprovalRequest"("tenantId", "contextType", "contextId", "documentHash");

-- CreateIndex
CREATE INDEX "TaxIdentityApprovalRequest_requestedById_status_idx" ON "TaxIdentityApprovalRequest"("requestedById", "status");

-- CreateIndex
CREATE INDEX "TaxIdentityApprovalRequest_decidedById_idx" ON "TaxIdentityApprovalRequest"("decidedById");

-- CreateIndex
CREATE INDEX "TaxIdentityApprovalRequest_overrideId_idx" ON "TaxIdentityApprovalRequest"("overrideId");

-- CreateIndex
CREATE INDEX "TaxIdentityApprovalRequest_expiresAt_idx" ON "TaxIdentityApprovalRequest"("expiresAt");

-- AddForeignKey
ALTER TABLE "TaxIdentityApprovalRequest" ADD CONSTRAINT "TaxIdentityApprovalRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxIdentityApprovalRequest" ADD CONSTRAINT "TaxIdentityApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxIdentityApprovalRequest" ADD CONSTRAINT "TaxIdentityApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxIdentityApprovalRequest" ADD CONSTRAINT "TaxIdentityApprovalRequest_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "TaxIdentityOverride"("id") ON DELETE SET NULL ON UPDATE CASCADE;
