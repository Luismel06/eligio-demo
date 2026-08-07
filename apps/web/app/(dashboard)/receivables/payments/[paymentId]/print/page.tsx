import { ReceivablePaymentPrint } from '@/components/operations/receivable-payment-print';

export default async function ReceivablePaymentPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<{ autoPrint?: string }>;
}) {
  const { paymentId } = await params;
  const { autoPrint } = await searchParams;

  return <ReceivablePaymentPrint paymentId={paymentId} autoPrint={autoPrint === '1'} />;
}
