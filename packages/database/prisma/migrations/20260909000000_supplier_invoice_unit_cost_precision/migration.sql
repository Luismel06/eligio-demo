-- Preserve net unit costs derived from tax-inclusive supplier prices.
-- Invoice bases, taxes and totals continue to be rounded and stored in cents.
-- This widens fractional precision without reducing the existing integer range.
ALTER TABLE "SupplierInvoiceItem"
  ALTER COLUMN "unitCostNet" TYPE DECIMAL(18,6);

-- Historical records intentionally retain their original two-decimal costs.
-- Every other accounting invariant remains unchanged.
ALTER TABLE "SupplierInvoiceItem"
  DROP CONSTRAINT "SupplierInvoiceItem_amounts_check",
  ADD CONSTRAINT "SupplierInvoiceItem_amounts_check" CHECK (
    "unitCostNet" >= 0
    AND "unitCostWithTax" >= 0
    AND "discountTotal" >= 0
    AND "taxRate" >= 0
    AND "taxRate" <= 1
    AND "taxTotal" >= 0
    AND "subtotal" >= 0
    AND "total" >= 0
    AND "taxTotal" = round("subtotal" * "taxRate", 2)
    AND "total" = "subtotal" + "taxTotal"
    AND (
      "unitCostNet" = round("subtotal" / "quantity", 6)
      OR "unitCostNet" = round("subtotal" / "quantity", 2)
    )
    AND "unitCostWithTax" = round("total" / "quantity", 2)
  );
