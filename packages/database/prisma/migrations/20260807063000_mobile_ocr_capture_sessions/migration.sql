-- A one-use, short-lived handoff lets a phone run invoice OCR locally after a
-- desktop user scans a QR code. No image binary or complete OCR text is stored.

CREATE TYPE "MobileOcrCaptureStatus" AS ENUM ('PENDING', 'READY');

CREATE TABLE "MobileOcrCaptureSession" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "status" "MobileOcrCaptureStatus" NOT NULL DEFAULT 'PENDING',
  "result" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MobileOcrCaptureSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MobileOcrCaptureSession_tokenHash_key"
ON "MobileOcrCaptureSession"("tokenHash");

CREATE INDEX "MobileOcrCaptureSession_tenantId_createdById_expiresAt_idx"
ON "MobileOcrCaptureSession"("tenantId", "createdById", "expiresAt");

CREATE INDEX "MobileOcrCaptureSession_expiresAt_idx"
ON "MobileOcrCaptureSession"("expiresAt");

ALTER TABLE "MobileOcrCaptureSession"
ADD CONSTRAINT "MobileOcrCaptureSession_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MobileOcrCaptureSession"
ADD CONSTRAINT "MobileOcrCaptureSession_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
