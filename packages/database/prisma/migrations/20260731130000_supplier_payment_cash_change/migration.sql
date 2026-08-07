-- Guarda el efectivo entregado y el cambio sin alterar el importe aplicado a
-- cuentas por pagar. Los pagos históricos equivalen a "entregado = aplicado"
-- y no tuvieron cambio.
ALTER TABLE "SupplierPayment"
ADD COLUMN "tenderedAmount" DECIMAL(14,2),
ADD COLUMN "changeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0;

UPDATE "SupplierPayment"
SET "tenderedAmount" = "amount"
WHERE "tenderedAmount" IS NULL;

ALTER TABLE "SupplierPayment"
ALTER COLUMN "tenderedAmount" SET NOT NULL,
ALTER COLUMN "tenderedAmount" DROP DEFAULT;

ALTER TABLE "SupplierPayment"
ADD CONSTRAINT "SupplierPayment_tenderedAmount_check"
CHECK (
  "tenderedAmount" >= "amount"
  AND "changeAmount" >= 0
  AND "tenderedAmount" = "amount" + "changeAmount"
  AND (
    "method" = 'CASH'
    OR (
      "tenderedAmount" = "amount"
      AND "changeAmount" = 0
    )
  )
);

-- La regla inicial exigía una sesión de caja para todo pago CASH. Los pagos a
-- suplidores ya no impactan caja. Conservamos vínculos CASH históricos, pero
-- impedimos que TRANSFER o CHECK tengan una sesión de caja asociada.
ALTER TABLE "SupplierPayment"
DROP CONSTRAINT IF EXISTS "SupplierPayment_cashSession_check";

ALTER TABLE "SupplierPayment"
ADD CONSTRAINT "SupplierPayment_cashSession_check"
CHECK (
  "cashSessionId" IS NULL
  OR "method" = 'CASH'
);
