-- Keeps the external authorization / transaction reference and the immutable
-- settlement snapshot for a refund. Nullable by design so completed
-- historical returns remain valid.
ALTER TABLE "ReturnRequest"
ADD COLUMN "refundReference" VARCHAR(120),
ADD COLUMN "debtBefore" DECIMAL(12, 2),
ADD COLUMN "debtAfter" DECIMAL(12, 2),
ADD COLUMN "paidAmountBefore" DECIMAL(12, 2),
ADD COLUMN "paidAmountAfter" DECIMAL(12, 2);
