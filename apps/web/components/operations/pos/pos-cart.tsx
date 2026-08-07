'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/utils';
import { formatQuantity, getAvailableStock, getProductPrice, getQuantityStep } from './pos-utils';
import type { CartItem } from './types';

type PosCartProps = {
  items: CartItem[];
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onClear: () => void;
  readOnly?: boolean;
  emptyMessage?: string;
};

export function PosCart({
  items,
  onUpdateQuantity,
  onClear,
  readOnly = false,
  emptyMessage = 'Agrega productos desde la izquierda o escanea un codigo para empezar.',
}: PosCartProps) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 p-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">Carrito</h2>
          <p className="text-xs text-muted-foreground">{items.length} linea(s) agregada(s)</p>
        </div>
        {!readOnly ? (
          <Button type="button" variant="outline" size="sm" onClick={onClear} disabled={!items.length}>
            Limpiar
          </Button>
        ) : null}
      </div>

      <div className="surface-scrollbar max-h-[26rem] space-y-2 overflow-y-auto p-3">
        {items.length ? (
          items.map((item) => {
            const unitPrice = item.unitPrice ?? getProductPrice(item.product);
            const subtotal = item.subtotal ?? unitPrice * item.quantity;
            const discountTotal = item.discountTotal ?? 0;
            const availableStock = getAvailableStock(item.product);
            const quantityStep = getQuantityStep(item.product);
            const stockWarning = item.product.trackInventory && item.quantity >= availableStock;

            return (
              <div key={item.product.id} className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-950">{item.product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(unitPrice)} x {formatQuantity(item.quantity)}
                    </p>
                    {discountTotal > 0 ? (
                      <p className="mt-1 text-xs font-medium text-emerald-700">
                        Descuento aplicado: {formatCurrency(discountTotal)}
                      </p>
                    ) : null}
                    {stockWarning ? (
                      <Badge variant="warning" className="mt-2">
                        Limite de stock
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-zinc-950">{formatCurrency(subtotal)}</p>
                    {!readOnly ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onUpdateQuantity(item.product.id, 0)}
                        aria-label="Quitar producto"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => onUpdateQuantity(item.product.id, item.quantity - quantityStep)}
                      aria-label="Reducir cantidad"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  ) : null}
                  {readOnly ? (
                    <span className="h-9 min-w-12 rounded-md border border-zinc-200 bg-white px-2 text-center text-sm font-semibold leading-9">
                      {formatQuantity(item.quantity)}
                    </span>
                  ) : (
                    <Input
                      type="number"
                      min={quantityStep}
                      step={quantityStep}
                      value={item.quantity}
                      onChange={(event) =>
                        onUpdateQuantity(item.product.id, Number(event.target.value || 0))
                      }
                      onFocus={(event) => event.currentTarget.select()}
                      aria-label={`Cantidad de ${item.product.name}`}
                      className="h-9 w-24 text-center text-sm font-semibold"
                    />
                  )}
                  {!readOnly ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => onUpdateQuantity(item.product.id, item.quantity + quantityStep)}
                      disabled={
                        item.product.trackInventory &&
                        item.quantity + quantityStep > availableStock
                      }
                      aria-label="Aumentar cantidad"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {readOnly && item.reservedQuantity
                      ? `Reservado: ${formatQuantity(item.reservedQuantity)}`
                      : `Disponible: ${
                          item.product.trackInventory ? formatQuantity(availableStock) : 'No aplica'
                        }`}
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-md border border-dashed border-zinc-300 bg-white p-5 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        )}
      </div>
    </div>
  );
}
