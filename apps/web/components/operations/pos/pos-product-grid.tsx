'use client';

import { PackagePlus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { Product } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import {
  canAddProduct,
  formatQuantity,
  getAvailableStock,
  getProductInitials,
  getProductPrice,
} from './pos-utils';

type PosProductGridProps = {
  products: Product[];
  quantitiesByProduct: Record<string, number>;
  isLoading?: boolean;
  onAddProduct: (product: Product) => void;
};

export function PosProductGrid({
  products,
  quantitiesByProduct,
  isLoading,
  onAddProduct,
}: PosProductGridProps) {
  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-48 rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
            <div className="h-24 rounded-md bg-zinc-100" />
            <div className="mt-3 h-4 w-3/4 rounded-sm bg-zinc-100" />
            <div className="mt-2 h-4 w-1/2 rounded-sm bg-zinc-100" />
          </div>
        ))}
      </div>
    );
  }

  if (!products.length) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-muted-foreground">
        No hay productos para esa busqueda. Prueba con nombre, SKU, marca o codigo.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {products.map((product) => {
        const quantityInCart = quantitiesByProduct[product.id] ?? 0;
        const availableStock = getAvailableStock(product);
        const lowStock = product.trackInventory && availableStock <= Number(product.minStock);
        const outOfStock = product.trackInventory && availableStock <= 0;
        const disabled = !canAddProduct(product, quantityInCart);

        return (
          <button
            key={product.id}
            type="button"
            onClick={() => onAddProduct(product)}
            disabled={disabled}
            className="group overflow-hidden rounded-md border border-zinc-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-55"
          >
            <ProductImage product={product} />
            <div className="space-y-3 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-semibold text-zinc-950">{product.name}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {product.category?.name ?? 'Sin tipo'} - {product.brand ?? 'Sin proveedor'}
                  </p>
                </div>
                <Badge variant={lowStock || outOfStock ? 'danger' : 'outline'}>
                  {outOfStock
                    ? 'Sin stock'
                    : product.trackInventory
                      ? formatQuantity(availableStock)
                      : 'Servicio'}
                </Badge>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-lg font-bold text-zinc-950">{formatCurrency(getProductPrice(product))}</p>
                  <p className="text-xs text-muted-foreground">{product.sku ?? product.barcode ?? 'Sin SKU'}</p>
                </div>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-evc-600 text-white transition group-hover:bg-evc-700">
                  <PackagePlus className="h-4 w-4" />
                </span>
              </div>

              {quantityInCart ? (
                <p className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
                  En carrito: {formatQuantity(quantityInCart)}
                </p>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ProductImage({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);

  if (product.imageUrl && !failed) {
    return (
      <div className="flex h-32 items-center justify-center bg-zinc-100 p-2">
        <img
          src={product.imageUrl}
          alt={product.name}
          className="max-h-full max-w-full object-contain"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-32 items-center justify-center bg-gradient-to-br from-zinc-100 to-zinc-200">
      <div className="flex h-16 w-16 items-center justify-center rounded-md bg-zinc-950 text-lg font-bold text-white">
        {getProductInitials(product) || 'RV'}
      </div>
    </div>
  );
}
