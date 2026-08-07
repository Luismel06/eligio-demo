import { SupplierInvoicePrint } from '@/components/operations/supplier-invoice-print';

export default async function SupplierInvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoPrint?: string }>;
}) {
  const { id } = await params;
  const { autoPrint } = await searchParams;

  return <SupplierInvoicePrint invoiceId={id} autoPrint={autoPrint === '1'} />;
}
