-- Reconcile return-refund audit columns that existed in the restored RIVNU
-- production schema but were absent from the repository migration history.
-- IF NOT EXISTS makes this a no-op on that restored database while keeping a
-- clean migration replay complete for new and disaster-recovery databases.
ALTER TABLE "ReturnRequest"
  ADD COLUMN IF NOT EXISTS "refundReference" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "debtBefore" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "debtAfter" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "paidAmountBefore" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "paidAmountAfter" DECIMAL(12,2);
