'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Barcode,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Pencil,
  Plus,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
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
import {
  deleteProduct,
  generateProductBarcode,
  getProductLabel,
  getProducts,
  type Product,
} from '@/lib/api';
import { getStatusVariant, translateBarcodeType, translateStatus } from '@/lib/display-labels';
import { cn, formatCurrency } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { formatQuantity } from './pos/pos-utils';
import { SessionRequired, useCurrentSession } from './session-required';

type StockTab = 'ALL' | 'LOW' | 'OUT';
type ProductStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
type ProductSort = 'URGENCY' | 'STOCK_ASC' | 'STOCK_DESC' | 'PRICE_ASC' | 'PRICE_DESC' | 'NAME_ASC';
type ProductStockState = 'SERVICE' | 'OUT' | 'LOW' | 'AVAILABLE';

const allBrandsFilter = '__ALL_BRANDS__';
const noBrandFilter = '__NO_BRAND__';

const stockTabs: Array<{ id: StockTab; label: string }> = [
  { id: 'ALL', label: 'Todos' },
  { id: 'LOW', label: 'Bajo stock' },
  { id: 'OUT', label: 'Agotados' },
];

export function ProductsView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [stockTab, setStockTab] = useState<StockTab>('ALL');
  const [brandFilter, setBrandFilter] = useState(allBrandsFilter);
  const [statusFilter, setStatusFilter] = useState<ProductStatusFilter>('ALL');
  const [minimumPrice, setMinimumPrice] = useState('');
  const [maximumPrice, setMaximumPrice] = useState('');
  const [minimumStock, setMinimumStock] = useState('');
  const [maximumStock, setMaximumStock] = useState('');
  const [sort, setSort] = useState<ProductSort>('URGENCY');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [productPendingDeactivation, setProductPendingDeactivation] = useState<{
    id: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    setSearch(searchParams.get('q') ?? '');

    const requestedStockTab = searchParams.get('stock')?.toUpperCase();
    if (requestedStockTab === 'LOW' || requestedStockTab === 'OUT') {
      setStockTab(requestedStockTab);
    } else {
      setStockTab('ALL');
    }

    const requestedStatus = searchParams.get('status')?.toUpperCase();
    if (
      requestedStatus === 'ACTIVE' ||
      requestedStatus === 'INACTIVE' ||
      requestedStatus === 'DISCONTINUED'
    ) {
      setStatusFilter(requestedStatus);
    } else {
      setStatusFilter('ALL');
    }
  }, [searchParams]);

  useEffect(() => {
    setPage(1);
  }, [
    brandFilter,
    maximumPrice,
    maximumStock,
    minimumPrice,
    minimumStock,
    search,
    sort,
    statusFilter,
    stockTab,
  ]);

  const productsQuery = useQuery({
    queryKey: ['products', session?.tenantId],
    queryFn: () => getProducts(session?.tenantId ?? '', session?.accessToken ?? ''),
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

  const readOnly = session?.role === 'ACCOUNTANT';
  const products = productsQuery.data ?? [];
  const brands = useMemo(() => getUniqueBrands(products), [products]);
  const productsMatchingFilters = useMemo(
    () =>
      products.filter((product) =>
        matchesProductFilters(product, {
          search,
          brand: brandFilter,
          status: statusFilter,
          minimumPrice,
          maximumPrice,
          minimumStock,
          maximumStock,
        }),
      ),
    [
      brandFilter,
      maximumPrice,
      maximumStock,
      minimumPrice,
      minimumStock,
      products,
      search,
      statusFilter,
    ],
  );
  const tabCounts = useMemo(
    () => ({
      ALL: productsMatchingFilters.length,
      LOW: productsMatchingFilters.filter((product) => isLowStock(product)).length,
      OUT: productsMatchingFilters.filter((product) => isOutOfStock(product)).length,
    }),
    [productsMatchingFilters],
  );
  const filteredProducts = useMemo(() => {
    const matchingTab = productsMatchingFilters.filter((product) => {
      if (stockTab === 'LOW') return isLowStock(product);
      if (stockTab === 'OUT') return isOutOfStock(product);
      return true;
    });

    return [...matchingTab].sort((left, right) => compareProducts(left, right, sort));
  }, [productsMatchingFilters, sort, stockTab]);
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rangeStart = filteredProducts.length ? (currentPage - 1) * pageSize + 1 : 0;
  const rangeEnd = Math.min(currentPage * pageSize, filteredProducts.length);
  const visibleProducts = filteredProducts.slice(rangeStart ? rangeStart - 1 : 0, rangeEnd);
  const hasActiveFilters =
    search.trim().length > 0 ||
    stockTab !== 'ALL' ||
    brandFilter !== allBrandsFilter ||
    statusFilter !== 'ALL' ||
    minimumPrice !== '' ||
    maximumPrice !== '' ||
    minimumStock !== '' ||
    maximumStock !== '' ||
    sort !== 'URGENCY';

  if (!session) {
    return <SessionRequired session={session} />;
  }

  function selectStockTab(nextTab: StockTab) {
    const nextStatus: ProductStatusFilter = nextTab === 'ALL' ? 'ALL' : 'ACTIVE';
    const nextParams = new URLSearchParams(searchParams.toString());

    setStockTab(nextTab);
    setStatusFilter(nextStatus);

    if (nextTab === 'ALL') {
      nextParams.delete('stock');
      nextParams.delete('status');
    } else {
      nextParams.set('stock', nextTab);
      nextParams.set('status', nextStatus);
    }

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `/products?${nextQuery}` : '/products', { scroll: false });
  }

  function clearFilters() {
    setSearch('');
    setStockTab('ALL');
    setBrandFilter(allBrandsFilter);
    setStatusFilter('ALL');
    setMinimumPrice('');
    setMaximumPrice('');
    setMinimumStock('');
    setMaximumStock('');
    setSort('URGENCY');
    router.replace('/products', { scroll: false });
  }

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
            onChange={(event) => setSearch(event.target.value)}
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
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div
            className="grid gap-2 rounded-lg border border-border bg-muted/30 p-1 sm:grid-cols-3"
            role="group"
            aria-label="Disponibilidad de productos"
          >
            {stockTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={stockTab === tab.id}
                onClick={() => selectStockTab(tab.id)}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm font-semibold transition',
                  stockTab === tab.id
                    ? 'bg-white text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:bg-white/70 hover:text-foreground',
                )}
              >
                <span>{tab.label}</span>
                <Badge
                  variant={
                    tab.id === 'OUT'
                      ? 'danger'
                      : tab.id === 'LOW'
                        ? 'warning'
                        : stockTab === tab.id
                          ? 'default'
                          : 'outline'
                  }
                >
                  {tabCounts[tab.id]}
                </Badge>
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <FilterField label="Marca">
              <select
                aria-label="Filtrar por marca"
                value={brandFilter}
                onChange={(event) => setBrandFilter(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value={allBrandsFilter}>Todas las marcas</option>
                <option value={noBrandFilter}>Sin marca</option>
                {brands.map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Estado">
              <select
                aria-label="Filtrar por estado"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as ProductStatusFilter)}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="ALL">Todos los estados</option>
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
                <option value="DISCONTINUED">Descontinuado</option>
              </select>
            </FilterField>

            <FilterField label="Precio (RD$)">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={minimumPrice}
                  onChange={(event) => setMinimumPrice(event.target.value)}
                  placeholder="Mínimo"
                  aria-label="Precio mínimo"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={maximumPrice}
                  onChange={(event) => setMaximumPrice(event.target.value)}
                  placeholder="Máximo"
                  aria-label="Precio máximo"
                />
              </div>
            </FilterField>

            <FilterField label="Stock disponible">
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={minimumStock}
                  onChange={(event) => setMinimumStock(event.target.value)}
                  placeholder="Mínimo"
                  aria-label="Stock disponible mínimo"
                />
                <Input
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={maximumStock}
                  onChange={(event) => setMaximumStock(event.target.value)}
                  placeholder="Máximo"
                  aria-label="Stock disponible máximo"
                />
              </div>
            </FilterField>
          </div>

          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end sm:justify-between">
            <FilterField label="Ordenar por" className="w-full sm:max-w-xs">
              <select
                aria-label="Ordenar productos"
                value={sort}
                onChange={(event) => setSort(event.target.value as ProductSort)}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="URGENCY">Más urgentes primero</option>
                <option value="STOCK_ASC">Stock: menor a mayor</option>
                <option value="STOCK_DESC">Stock: mayor a menor</option>
                <option value="PRICE_ASC">Precio: menor a mayor</option>
                <option value="PRICE_DESC">Precio: mayor a menor</option>
                <option value="NAME_ASC">Nombre: A-Z</option>
              </select>
            </FilterField>
            <Button
              type="button"
              variant="outline"
              disabled={!hasActiveFilters}
              onClick={clearFilters}
            >
              <X className="h-4 w-4" />
              Limpiar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Catalogo</CardTitle>
          <CardDescription>
            {filteredProducts.length === products.length
              ? `${products.length} productos activos o inactivos.`
              : `${filteredProducts.length} de ${products.length} productos coinciden con los filtros.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {productsQuery.isLoading ? (
            <div className="flex min-h-56 items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/15 text-sm text-muted-foreground">
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
              Cargando catálogo de productos...
            </div>
          ) : productsQuery.isError ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-danger/30 bg-danger/5 p-6 text-center">
              <AlertTriangle className="h-7 w-7 text-danger" aria-hidden="true" />
              <div>
                <p className="font-semibold text-foreground">No se pudo cargar el catálogo</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Revisa la conexión e inténtalo nuevamente.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={() => productsQuery.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/15 p-6 text-center">
              <Search className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              <div>
                <p className="font-semibold text-foreground">No encontramos productos</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {hasActiveFilters
                    ? 'Cambia o limpia los filtros para ampliar los resultados.'
                    : 'El catálogo todavía no tiene productos registrados.'}
                </p>
              </div>
              {hasActiveFilters ? (
                <Button type="button" variant="outline" onClick={clearFilters}>
                  <X className="h-4 w-4" />
                  Limpiar filtros
                </Button>
              ) : null}
            </div>
          ) : (
            <>
              <ProductPagination
                page={currentPage}
                pageCount={pageCount}
                pageSize={pageSize}
                rangeStart={rangeStart}
                rangeEnd={rangeEnd}
                total={filteredProducts.length}
                onPageChange={setPage}
                onPageSizeChange={(nextPageSize) => {
                  setPageSize(nextPageSize);
                  setPage(1);
                }}
              />

              <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1 md:hidden">
                {visibleProducts.map((product) => {
                  const stockState = getProductStockState(product);
                  return (
                    <div
                      key={product.id}
                      className={cn(
                        'rounded-md border border-border p-3',
                        stockState === 'OUT' && 'border-danger/35 bg-danger/5',
                        stockState === 'LOW' && 'border-warning/40 bg-warning/5',
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{product.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {product.sku ?? 'Sin SKU'} · {product.brand?.trim() || 'Sin marca'}
                          </p>
                        </div>
                        <Badge variant={getStatusVariant(product.status)}>
                          {translateStatus(product.status)}
                        </Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                        <span className="font-semibold">
                          {formatCurrency(Number(product.price))}
                        </span>
                        <ProductStockBadge product={product} />
                      </div>
                      {product.trackInventory ? (
                        <p className="mt-1 text-right text-xs text-muted-foreground">
                          {formatQuantity(getAvailableStock(product))} disponibles · mínimo{' '}
                          {formatQuantity(product.minStock)} ·{' '}
                          {formatQuantity(product.reservedStock)} reservados
                        </p>
                      ) : null}
                      {!readOnly ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/70 pt-3">
                          {!product.barcode ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={generateMutation.isPending}
                              onClick={() => generateMutation.mutate(product.id)}
                            >
                              <Barcode className="h-4 w-4" />
                              Código
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={labelMutation.isPending}
                              onClick={() => labelMutation.mutate(product.id)}
                            >
                              <Printer className="h-4 w-4" />
                              Etiqueta
                            </Button>
                          )}
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/products/${product.id}/edit`}>
                              <Pencil className="h-4 w-4" />
                              Editar
                            </Link>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="col-span-2"
                            disabled={deleteMutation.isPending}
                            onClick={() =>
                              setProductPendingDeactivation({
                                id: product.id,
                                name: product.name,
                              })
                            }
                            aria-label={`Desactivar ${product.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                            Desactivar
                          </Button>
                        </div>
                      ) : null}
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
                      const stockState = getProductStockState(product);
                      return (
                        <TableRow
                          key={product.id}
                          className={cn(
                            stockState === 'OUT' && 'bg-danger/5 hover:bg-danger/10',
                            stockState === 'LOW' && 'bg-warning/5 hover:bg-warning/10',
                          )}
                        >
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
                                <ProductStockBadge product={product} />
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {formatQuantity(getAvailableStock(product))} disponibles / total{' '}
                                  {formatQuantity(product.stock)} / mínimo{' '}
                                  {formatQuantity(product.minStock)}
                                </p>
                              </div>
                            ) : (
                              <ProductStockBadge product={product} />
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
                                    disabled={generateMutation.isPending}
                                    onClick={() => generateMutation.mutate(product.id)}
                                    aria-label="Generar codigo de barras"
                                  >
                                    <Barcode className="h-4 w-4" />
                                  </Button>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="icon"
                                    disabled={labelMutation.isPending}
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
                total={filteredProducts.length}
                onPageChange={setPage}
                onPageSizeChange={(nextPageSize) => {
                  setPageSize(nextPageSize);
                  setPage(1);
                }}
              />
            </>
          )}
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

function FilterField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5 text-sm', className)}>
      <span className="block font-medium text-foreground">{label}</span>
      {children}
    </div>
  );
}

function ProductStockBadge({ product }: { product: Product }) {
  const stockState = getProductStockState(product);

  if (stockState === 'SERVICE') {
    return <Badge variant="outline">Servicio</Badge>;
  }

  if (stockState === 'OUT') {
    return <Badge variant="danger">Agotado</Badge>;
  }

  if (stockState === 'LOW') {
    return <Badge variant="warning">Bajo mínimo</Badge>;
  }

  return <Badge variant="success">Disponible</Badge>;
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

function matchesProductFilters(
  product: Product,
  filters: {
    search: string;
    brand: string;
    status: ProductStatusFilter;
    minimumPrice: string;
    maximumPrice: string;
    minimumStock: string;
    maximumStock: string;
  },
) {
  const normalizedSearch = normalizeFilterText(filters.search);
  if (
    normalizedSearch &&
    ![product.name, product.sku, product.barcode, product.brand]
      .filter((value): value is string => Boolean(value))
      .some((value) => normalizeFilterText(value).includes(normalizedSearch))
  ) {
    return false;
  }

  const productBrand = product.brand?.trim() ?? '';
  if (filters.brand === noBrandFilter && productBrand) {
    return false;
  }
  if (
    filters.brand !== allBrandsFilter &&
    filters.brand !== noBrandFilter &&
    productBrand.localeCompare(filters.brand, 'es', { sensitivity: 'base' }) !== 0
  ) {
    return false;
  }

  if (filters.status !== 'ALL' && product.status !== filters.status) {
    return false;
  }

  const price = Number(product.price);
  const minimumPrice = parseOptionalFilterNumber(filters.minimumPrice);
  const maximumPrice = parseOptionalFilterNumber(filters.maximumPrice);
  if (minimumPrice !== null && price < minimumPrice) {
    return false;
  }
  if (maximumPrice !== null && price > maximumPrice) {
    return false;
  }

  const minimumStock = parseOptionalFilterNumber(filters.minimumStock);
  const maximumStock = parseOptionalFilterNumber(filters.maximumStock);
  if ((minimumStock !== null || maximumStock !== null) && !product.trackInventory) {
    return false;
  }

  const availableStock = getAvailableStock(product);
  if (minimumStock !== null && availableStock < minimumStock) {
    return false;
  }
  if (maximumStock !== null && availableStock > maximumStock) {
    return false;
  }

  return true;
}

function getUniqueBrands(products: Product[]) {
  const brandsByNormalizedName = new Map<string, string>();

  for (const product of products) {
    const brand = product.brand?.trim();
    if (brand) {
      const normalizedBrand = normalizeFilterText(brand);
      if (!brandsByNormalizedName.has(normalizedBrand)) {
        brandsByNormalizedName.set(normalizedBrand, brand);
      }
    }
  }

  return [...brandsByNormalizedName.values()].sort((left, right) =>
    left.localeCompare(right, 'es', { sensitivity: 'base' }),
  );
}

function normalizeFilterText(value: string) {
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
}

function parseOptionalFilterNumber(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function compareProducts(left: Product, right: Product, sort: ProductSort) {
  const byName = left.name.localeCompare(right.name, 'es', { sensitivity: 'base' });

  if (sort === 'NAME_ASC') {
    return byName;
  }

  if (sort === 'PRICE_ASC' || sort === 'PRICE_DESC') {
    const difference = Number(left.price) - Number(right.price);
    return (sort === 'PRICE_ASC' ? difference : -difference) || byName;
  }

  if (sort === 'STOCK_ASC' || sort === 'STOCK_DESC') {
    if (left.trackInventory !== right.trackInventory) {
      return left.trackInventory ? -1 : 1;
    }
    const difference = getAvailableStock(left) - getAvailableStock(right);
    return (sort === 'STOCK_ASC' ? difference : -difference) || byName;
  }

  const severityDifference = getStockUrgencyRank(left) - getStockUrgencyRank(right);
  if (severityDifference !== 0) {
    return severityDifference;
  }

  return getAvailableStock(left) - getAvailableStock(right) || byName;
}

function getStockUrgencyRank(product: Product) {
  const state = getProductStockState(product);
  if (state === 'OUT') return 0;
  if (state === 'LOW') return 1;
  if (state === 'AVAILABLE') return 2;
  return 3;
}

function getProductStockState(product: Product): ProductStockState {
  if (!product.trackInventory) {
    return 'SERVICE';
  }

  const availableStock = getAvailableStock(product);
  if (availableStock <= 0) {
    return 'OUT';
  }
  if (availableStock <= Number(product.minStock)) {
    return 'LOW';
  }

  return 'AVAILABLE';
}

function isLowStock(product: Product) {
  const state = getProductStockState(product);
  return state === 'LOW' || state === 'OUT';
}

function isOutOfStock(product: Product) {
  return getProductStockState(product) === 'OUT';
}

function getAvailableStock(product: { stock: number | string; reservedStock: number | string }) {
  return Math.max(Number(product.stock) - Number(product.reservedStock), 0);
}
