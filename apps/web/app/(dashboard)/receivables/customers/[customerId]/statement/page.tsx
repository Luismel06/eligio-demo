import { ReceivableCustomerStatementPrint } from '@/components/operations/receivable-customer-statement-print';

export default async function ReceivableCustomerStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ autoPrint?: string }>;
}) {
  const { customerId } = await params;
  const { autoPrint } = await searchParams;

  return <ReceivableCustomerStatementPrint customerId={customerId} autoPrint={autoPrint === '1'} />;
}
