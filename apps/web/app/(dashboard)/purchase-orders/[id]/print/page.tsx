import { PurchaseOrderPrint } from '@/components/operations/purchase-order-print';

export default async function PurchaseOrderPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoPrint?: string }>;
}) {
  const { id } = await params;
  const { autoPrint } = await searchParams;
  return <PurchaseOrderPrint orderId={id} autoPrint={autoPrint === '1'} />;
}
