-- La vigencia del NCF/e-NCF es un dato fiscal distinto del vencimiento
-- comercial de la factura. `dueDate` sigue siendo la fecha usada por cuentas
-- por pagar; este campo solo conserva la referencia fiscal capturada.
ALTER TABLE "SupplierInvoice"
ADD COLUMN "ncfValidUntil" TIMESTAMP(3);
