-- Commercial condition indicated on the supplier invoice. It is distinct from
-- the commercial due date (`dueDate`) and fiscal validity of the NCF.
ALTER TABLE "SupplierInvoice"
ADD COLUMN "paymentCondition" VARCHAR(120);
