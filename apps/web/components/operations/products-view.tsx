'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Barcode,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ActionDialog } from '@/components/ui/action-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { deleteProduct, generateProductBarcode, getProductLabel, getProducts } from '@/lib/api';
import { getStatusVariant, translateBarcodeType, translateStatus } from '@/lib/display-labels';
import { formatCurrency } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { formatQuantity } from './pos/pos-utils';
import { SessionRequired, useCurrentSession } from './session-required';

export function ProductsView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [productPendingDeactivation, setProductPendingDeactivation] = useState<{
    id: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('q');
    if (query) {
      setSearch(query);
    }
  }, []);

  const productsQuery = useQuery({
    queryKey: ['products', session?.tenantId, search],
    queryFn: () => getProducts(session?.tenantId ?? '', session?.accessToken ?? '', search),
    enabled: Boolean(session),
  });
  const generateMutation = useMutation({
    mutationFn: (productId: string) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return generateProductBarcode(session.tenantId, session.accessToken, productId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Codigo generado correctamente.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo generar el codigo.');
    },
  });
  const labelMutation = useMutation({
    mutationFn: (productId: string) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return getProductLabel(session.tenantId, session.accessToken, productId);
    },
    onSuccess: (label) => {
      toast.success('Etiqueta lista para imprimir', {
        description: `${label.name} - ${label.barcode}`,
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo preparar la etiqueta.');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (productId: string) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return deleteProduct(session.tenantId, session.accessToken, productId);
    },
    onSuccess: async (product) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Producto desactivado', { description: product.name });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo desactivar el producto.');
    },
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  const readOnly = session.role === 'ACCOUNTANT';
  const products = productsQuery.data ?? [];
  const pageCount = Math.max(1, Math.ceil(products.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rangeStart = products.length ? (currentPage - 1) * pageSize + 1 : 0;
  const rangeEnd = Math.min(currentPage * pageSize, products.length);
  const visibleProducts = products.slice(rangeStart ? rangeStart - 1 : 0, rangeEnd);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Productos"
        description="Catalogo de productos/servicios de Ferreteria RIVNU, precios e inventario desde PostgreSQL."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            className="bg-white pl-9"
            placeholder="Buscar nombre, SKU, marca o codigo"
          />
        </div>
        {!readOnly ? (
          <Button asChild>
            <Link href="/products/new">
              <Plus className="h-4 w-4" />
              Nuevo producto
            </Link>
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Catalogo</CardTitle>
          <CardDescription>{products.length} productos activos o inactivos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ProductPagination
            page={currentPage}
            pageCount={pageCount}
            pageSize={pageSize}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            total={products.length}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
          />

          <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1 md:hidden">
            {visibleProducts.map((product) => {
              const availableStock = getAvailableStock(product);
              const lowStock = product.trackInventory && availableStock <= Number(product.minStock);
              return (
                <div key={product.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{product.name}</p>
                      <p className="text-xs text-muted-foreground">{product.sku ?? 'Sin SKU'}</p>
                    </div>
                    <Badge variant={getStatusVariant(product.status)}>
                      {translateStatus(product.status)}
                    </Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                    <span className="font-semibold">{formatCurrency(Number(product.price))}</span>
                    {product.trackInventory ? (
                      <Badge variant={lowStock ? 'danger' : 'success'}>
                        {formatQuantity(availableStock)} disp. /{' '}
                        {formatQuantity(product.reservedStock)} res.
                      </Badge>
                    ) : (
                      <Badge variant="outline">Servicio</Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden md:block">
            <Table wrapperClassName="max-h-[65vh] rounded-md border border-border overflow-auto">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Marca</TableHead>
                  <TableHead>Precio</TableHead>
                  <TableHead>Codigo</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead>Estado</TableHead>
                  {!readOnly ? <TableHead className="text-right">Acciones</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleProducts.map((product) => {
                  const availableStock = getAvailableStock(product);
                  const lowStock =
                    product.trackInventory && availableStock <= Number(product.minStock);
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="font-medium">{product.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {product.sku ?? 'Sin SKU'} {product.brand ? `- ${product.brand}` : ''}
                        </div>
                      </TableCell>
                      <TableCell>{product.brand?.trim() || 'Sin marca'}</TableCell>
                      <TableCell>{formatCurrency(Number(product.price))}</TableCell>
                      <TableCell>
                        <div className="text-sm">{product.barcode ?? 'Sin codigo'}</div>
                        <div className="text-xs text-muted-foreground">
                          {translateBarcodeType(product.barcodeType)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {product.trackInventory ? (
                          <div>
                            <Badge variant={lowStock ? 'danger' : 'success'}>
                              {formatQuantity(availableStock)} disp. /{' '}
                              {formatQuantity(product.reservedStock)} res.
                            </Badge>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Total {formatQuantity(product.stock)} / min{' '}
                              {formatQuantity(product.minStock)}
                            </p>
                          </div>
                        ) : (
                          <Badge variant="outline">Servicio</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(product.status)}>
                          {translateStatus(product.status)}
                        </Badge>
                      </TableCell>
                      {!readOnly ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {!product.barcode ? (
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => generateMutation.mutate(product.id)}
                                aria-label="Generar codigo de barras"
                              >
                                <Barcode className="h-4 w-4" />
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => labelMutation.mutate(product.id)}
                                aria-label="Imprimir etiqueta"
                              >
                                <Printer className="h-4 w-4" />
                              </Button>
                            )}
                            <Button asChild variant="ghost" size="icon">
                              <Link
                                href={`/products/${product.id}/edit`}
                                aria-label="Editar producto"
                              >
                                <Pencil className="h-4 w-4" />
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={deleteMutation.isPending}
                              onClick={() =>
                                setProductPendingDeactivation({
                                  id: product.id,
                                  name: product.name,
                                })
                              }
                              aria-label="Desactivar producto"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <ProductPagination
            page={currentPage}
            pageCount={pageCount}
            pageSize={pageSize}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            total={products.length}
            onPageChange={setPage}
            onPageSizeChange={(nextPageSize) => {
              setPageSize(nextPageSize);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>
      <ActionDialog
        open={Boolean(productPendingDeactivation)}
        onClose={() => {
          if (!deleteMutation.isPending) setProductPendingDeactivation(null);
        }}
        title="Desactivar producto"
        description="El producto dejará de estar disponible para nuevas ventas. Su historial, movimientos e inventario se conservarán."
        tone="danger"
        size="sm"
        confirmLabel="Desactivar producto"
        cancelLabel="Cancelar"
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          const product = productPendingDeactivation;
          if (!product) return;
          deleteMutation.mutate(product.id, {
            onSuccess: () => setProductPendingDeactivation(null),
          });
        }}
        summary={
          productPendingDeactivation ? (
            <div>

              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">

                Producto
              </p>
              <p className="mt-0.5 font-semibold text-foreground">
                {productPendingDeactivation.name}
              </p>
            </div>
          ) : null
        }
      />
    </div>
  );
}

function ProductPagination({
  page,
  pageCount,
  pageSize,
  rangeStart,
  rangeEnd,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Mostrar</span>
        <select
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground"
          aria-label="Productos por bloque"
        >
          {[50, 100, 200].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span>por bloque</span>
      </div>

      <div className="flex items-center justify-between gap-2 sm:justify-end">
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Bloque anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-36 text-center text-sm">
          <span className="font-medium text-foreground">
            {rangeStart}-{rangeEnd}
          </span>{' '}
          <span className="text-muted-foreground">de {total}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label="Bloque siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function getAvailableStock(product: { stock: number | string; reservedStock: number | string }) {
  return Math.max(Number(product.stock) - Number(product.reservedStock), 0);
}
