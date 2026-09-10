'use client';

import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getInventoryMovements, getProducts } from '@/lib/api';
import { translateInventoryMovementType } from '@/lib/display-labels';
import { formatDate } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { formatQuantity } from './pos/pos-utils';
import { SessionRequired, useCurrentSession } from './session-required';

export function InventoryView() {
  const session = useCurrentSession();
  const movementsQuery = useQuery({
    queryKey: ['inventory-movements', session?.tenantId],
    queryFn: () => getInventoryMovements(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const productsQuery = useQuery({
    queryKey: ['products-for-inventory', session?.tenantId],
    queryFn: () => getProducts(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  const lowStock = (productsQuery.data ?? []).filter(
    (product) => product.trackInventory && getAvailableStock(product) <= Number(product.minStock),
  );

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Inventario"
        description="Stock y movimientos de EligioValdez Comercial consultados directamente desde PostgreSQL."
      />

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Productos con stock</p>
            <p className="mt-2 text-2xl font-semibold">
              {(productsQuery.data ?? []).filter((product) => product.trackInventory).length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Bajo minimo</p>
            <p className="mt-2 text-2xl font-semibold text-danger">{lowStock.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Movimientos</p>
            <p className="mt-2 text-2xl font-semibold">{movementsQuery.data?.length ?? 0}</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Movimientos recientes</CardTitle>
          <CardDescription>Entradas, salidas y ajustes registrados para el tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="surface-scrollbar max-h-[32rem] space-y-3 overflow-y-auto pr-2 md:hidden">
            {(movementsQuery.data ?? []).map((movement) => (
              <div key={movement.id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{movement.product.name}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(movement.createdAt)}</p>
                  </div>
                  <Badge variant={movement.type === 'OUTBOUND' || movement.type === 'SALE' ? 'warning' : 'success'}>
                    {translateInventoryMovementType(movement.type)}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span>Cantidad {formatQuantity(movement.quantity)}</span>
                  <span className="text-muted-foreground">{movement.reference ?? movement.reason ?? 'Sin referencia'}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="surface-scrollbar hidden max-h-[calc(100vh-22rem)] overflow-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Referencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(movementsQuery.data ?? []).map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell>{formatDate(movement.createdAt)}</TableCell>
                    <TableCell className="font-medium">{movement.product.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          movement.type === 'OUTBOUND' || movement.type === 'SALE'
                            ? 'warning'
                            : 'success'
                        }
                      >
                        {translateInventoryMovementType(movement.type)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatQuantity(movement.quantity)}</TableCell>
                    <TableCell>
                      {movement.reference ?? movement.reason ?? 'Sin referencia'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function getAvailableStock(product: { stock: number | string; reservedStock: number | string }) {
  return Math.max(Number(product.stock) - Number(product.reservedStock), 0);
}
