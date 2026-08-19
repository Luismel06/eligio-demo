type InvoiceCustomerNameSource = {
  fiscalCustomerSnapshot?: { name?: string | null } | null;
  customer?: { name?: string | null } | null;
};

/**
 * Fiscal snapshots are immutable evidence of who received an issued invoice.
 * Prefer that name over the mutable Customer record in every invoice-facing UI.
 */
export function getInvoiceCustomerName(
  invoice: InvoiceCustomerNameSource,
  fallback = 'Consumidor final',
) {
  return invoice.fiscalCustomerSnapshot?.name?.trim() || invoice.customer?.name?.trim() || fallback;
}
