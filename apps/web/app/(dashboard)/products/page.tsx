import { Suspense } from 'react';
import { ProductsView } from '@/components/operations/products-view';

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm">
          Cargando productos...
        </div>
      }
    >
      <ProductsView />
    </Suspense>
  );
}
