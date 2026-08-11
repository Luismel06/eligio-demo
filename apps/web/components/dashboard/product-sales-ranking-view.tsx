'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  PackageSearch,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatQuantity } from '@/components/operations/pos/pos-utils';
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
import { getProductSalesRanking, type ProductSalesMetric } from '@/lib/api';
import { getSession } from '@/lib/auth-session';
import { translateProductUnit } from '@/lib/display-labels';
import { cn, formatCurrency, formatDate } from '@/lib/utils';

type RankingMode = 'most' | 'least';
type PeriodPreset = 'all' | 'today' | '7d' | '30d' | 'month';
type RankingMetric = 'quantitySold' | 'grossAmount' | 'invoiceCount';
type SalesPresence = 'all' | 'with-sales' | 'without-sales';

type ProductSalesRange = {
  from?: string;
  to?: string;
};

const ALL_CATEGORIES = '__all__';
const UNCATEGORIZED = '__uncategorized__';
const EMPTY_PRODUCTS: ProductSalesMetric[] = [];
const PAGE_SIZES = [25, 50, 100] as const;

const periodLabels: Record<PeriodPreset, string> = {
  all: 'Todo el historial',
  today: 'Hoy',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  month: 'Este mes',
};

const metricLabels: Record<RankingMetric, string> = {
  quantitySold: 'cantidad vendida',
  grossAmount: 'monto facturado',
  invoiceCount: 'número de facturas',
};

export function ProductSalesRankingView() {
  const session = getSession();
  const [mode, setMode] = useState<RankingMode>('most');
  const [period, setPeriod] = useState<PeriodPreset>('all');
  const [metric, setMetric] = useState<RankingMetric>('quantitySold');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [salesPresence, setSalesPresence] = useState<SalesPresence>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(25);
  const periodRange = useMemo(() => getPeriodRange(period), [period]);

  const rankingQuery = useQuery({
    queryKey: [
      'product-sales-ranking',
      session?.tenantId,
      periodRange.from ?? null,
      periodRange.to ?? null,
    ],
    queryFn: () =>
      getProductSalesRanking(session?.tenantId ?? '', session?.accessToken ?? '', periodRange),
    enabled: Boolean(session?.tenantId && session?.accessToken),
  });

  const products = rankingQuery.data?.mostSold ?? EMPTY_PRODUCTS;
  const categories = useMemo(() => getCategoryOptions(products), [products]);
  const filteredProducts = useMemo(
    () => filterAndSortProducts(products, { mode, metric, search, category, salesPresence }),
    [category, metric, mode, products, salesPresence, search],
  );
  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const rangeStart = filteredProducts.length ? (currentPage - 1) * pageSize + 1 : 0;
  const rangeEnd = Math.min(currentPage * pageSize, filteredProducts.length);
  const visibleProducts = filteredProducts.slice(rangeStart ? rangeStart - 1 : 0, rangeEnd);
  const filtersActive =
    mode !== 'most' ||
    period !== 'all' ||
    metric !== 'quantitySold' ||
    search.length > 0 ||
    category !== ALL_CATEGORIES ||
    salesPresence !== 'all';

  function resetPageAnd(update: () => void) {
    update();
    setPage(1);
  }

  function clearFilters() {
    setMode('most');
    setPeriod('all');
    setMetric('quantitySold');
    setSearch('');
    setCategory(ALL_CATEGORIES);
    setSalesPresence('all');
    setPage(1);
  }

  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sesión requerida</CardTitle>
          <CardDescription>Inicia sesión para consultar el ranking de productos.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/login">Ir al login</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (rankingQuery.isLoading) {
    return <ProductSalesSkeleton />;
  }

  if (rankingQuery.isError || !rankingQuery.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ranking no disponible</CardTitle>
          <CardDescription>
            No pude cargar el ranking de productos. Revisa la conexión con el API.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const ranking = rankingQuery.data;
  const RankingIcon = mode === 'most' ? TrendingUp : TrendingDown;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-accent">Analítica de productos</p>
          <h1 className="mt-1 text-2xl font-semibold">Productos vendidos</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Compara el rendimiento del catálogo por cantidad, monto facturado o número de facturas.
            El ranking incluye productos activos.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard">
            <ArrowLeft className="h-4 w-4" />
            Volver al panel
          </Link>
        </Button>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Productos activos" value={ranking.productCount} />
        <MetricCard label="Con ventas" value={ranking.productsWithSales} />
        <MetricCard label="Sin ventas" value={ranking.productsWithoutSales} />
      </section>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted">
                <RankingIcon className="h-5 w-5 text-[#f36c10]" />
              </div>
              <div>
                <CardTitle>{mode === 'most' ? 'Más vendidos' : 'Menos vendidos'}</CardTitle>
                <CardDescription className="mt-1">
                  Ordenados de {mode === 'most' ? 'mayor a menor' : 'menor a mayor'} por{' '}
                  {metricLabels[metric]}. {periodLabels[period]}.
                </CardDescription>
              </div>
            </div>

            <div
              className="grid grid-cols-2 rounded-md border border-border bg-muted/35 p-1"
              role="group"
              aria-label="Dirección del ranking"
            >
              <Button
                type="button"
                size="sm"
                variant={mode === 'most' ? 'default' : 'ghost'}
                className="gap-1 px-2 text-xs sm:gap-2 sm:px-3 sm:text-sm"
                onClick={() => resetPageAnd(() => setMode('most'))}
                aria-pressed={mode === 'most'}
              >
                <TrendingUp className="h-4 w-4" />
                Más vendidos
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'least' ? 'default' : 'ghost'}
                className="gap-1 px-2 text-xs sm:gap-2 sm:px-3 sm:text-sm"
                onClick={() => resetPageAnd(() => setMode('least'))}
                aria-pressed={mode === 'least'}
              >
                <TrendingDown className="h-4 w-4" />
                Menos vendidos
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 sm:grid-cols-2 xl:grid-cols-12">
            <label className="space-y-1.5 sm:col-span-2 xl:col-span-4">
              <span className="text-xs font-medium text-muted-foreground">Buscar producto</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => resetPageAnd(() => setSearch(event.target.value))}
                  className="bg-card pl-9"
                  placeholder="Nombre, SKU, marca o categoría"
                />
              </span>
            </label>

            <FilterSelect
              label="Período"
              value={period}
              onChange={(value) => resetPageAnd(() => setPeriod(value as PeriodPreset))}
              className="xl:col-span-2"
            >
              <option value="all">Todo el historial</option>
              <option value="today">Hoy</option>
              <option value="7d">Últimos 7 días</option>
              <option value="30d">Últimos 30 días</option>
              <option value="month">Este mes</option>
            </FilterSelect>

            <FilterSelect
              label="Ordenar por"
              value={metric}
              onChange={(value) => resetPageAnd(() => setMetric(value as RankingMetric))}
              className="xl:col-span-2"
            >
              <option value="quantitySold">Cantidad vendida</option>
              <option value="grossAmount">Monto facturado</option>
              <option value="invoiceCount">Número de facturas</option>
            </FilterSelect>

            <FilterSelect
              label="Categoría"
              value={category}
              onChange={(value) => resetPageAnd(() => setCategory(value))}
              className="xl:col-span-2"
            >
              <option value={ALL_CATEGORIES}>Todas</option>
              {categories.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </FilterSelect>

            <FilterSelect
              label="Actividad"
              value={salesPresence}
              onChange={(value) => resetPageAnd(() => setSalesPresence(value as SalesPresence))}
              className="xl:col-span-2"
            >
              <option value="all">Todos</option>
              <option value="with-sales">Con ventas</option>
              <option value="without-sales">Sin ventas</option>
            </FilterSelect>

            <div className="flex items-end sm:col-span-2 xl:col-span-12 xl:justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full sm:w-auto"
                disabled={!filtersActive}
                onClick={clearFilters}
              >
                Limpiar filtros
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {filteredProducts.length
                ? `Mostrando ${rangeStart}-${rangeEnd} de ${filteredProducts.length} productos`
                : 'No hay productos que coincidan con los filtros'}
              {rankingQuery.isFetching ? ' · Actualizando…' : ''}
            </p>
            <PageSizeSelect
              value={pageSize}
              onChange={(nextPageSize) => {
                setPageSize(nextPageSize);
                setPage(1);
              }}
            />
          </div>

          {visibleProducts.length ? (
            <>
              <div className="space-y-3 md:hidden">
                {visibleProducts.map((product, index) => (
                  <ProductSalesMobileCard
                    key={product.productId}
                    product={product}
                    rank={rangeStart + index}
                    metric={metric}
                  />
                ))}
              </div>

              <div className="hidden md:block">
                <ProductSalesTable
                  products={visibleProducts}
                  rankStart={rangeStart}
                  metric={metric}
                />
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center">
              <PackageSearch className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No encontramos productos</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Prueba otra búsqueda o limpia los filtros para ver todo el catálogo.
              </p>
            </div>
          )}

          <ProductSalesPagination
            page={currentPage}
            pageCount={pageCount}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            total={filteredProducts.length}
            onPageChange={setPage}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
          <PackageSearch className="h-5 w-5 text-[#f36c10]" />
        </div>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  className,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn('space-y-1.5', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </select>
    </label>
  );
}

function PageSizeSelect({
  value,
  onChange,
}: {
  value: (typeof PAGE_SIZES)[number];
  onChange: (value: (typeof PAGE_SIZES)[number]) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      <span>Mostrar</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value) as (typeof PAGE_SIZES)[number])}
        className="h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground"
        aria-label="Productos por página"
      >
        {PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>
      <span>por página</span>
    </label>
  );
}

function ProductSalesTable({
  products,
  rankStart,
  metric,
}: {
  products: ProductSalesMetric[];
  rankStart: number;
  metric: RankingMetric;
}) {
  return (
    <Table wrapperClassName="max-h-[65vh] rounded-md border border-border overflow-auto">
      <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
        <TableRow>
          <TableHead className="w-16">#</TableHead>
          <TableHead>Producto</TableHead>
          <TableHead>Categoría</TableHead>
          <TableHead>Unidad</TableHead>
          <TableHead className={cn('text-right', metric === 'quantitySold' && 'text-foreground')}>
            Cantidad
          </TableHead>
          <TableHead className={cn('text-right', metric === 'invoiceCount' && 'text-foreground')}>
            Facturas
          </TableHead>
          <TableHead className={cn('text-right', metric === 'grossAmount' && 'text-foreground')}>
            Monto facturado
          </TableHead>
          <TableHead>Última venta</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product, index) => (
          <TableRow key={product.productId}>
            <TableCell className="font-medium">{rankStart + index}</TableCell>
            <TableCell>
              <Link
                href={`/products?q=${encodeURIComponent(product.sku ?? product.name)}`}
                className="font-medium text-accent"
              >
                {product.name}
              </Link>
              <p className="text-xs text-muted-foreground">
                {product.sku ?? 'Sin SKU'} {product.brand ? `· ${product.brand}` : ''}
              </p>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{product.categoryName}</Badge>
            </TableCell>
            <TableCell>{translateProductUnit(product.unit)}</TableCell>
            <TableCell
              className={cn('text-right', metric === 'quantitySold' && 'font-semibold text-accent')}
            >
              {formatQuantity(product.quantitySold)}
            </TableCell>
            <TableCell
              className={cn('text-right', metric === 'invoiceCount' && 'font-semibold text-accent')}
            >
              {product.invoiceCount}
            </TableCell>
            <TableCell
              className={cn('text-right', metric === 'grossAmount' && 'font-semibold text-accent')}
            >
              {formatCurrency(product.grossAmount)}
            </TableCell>
            <TableCell>
              {product.lastSoldAt ? formatDate(product.lastSoldAt) : 'Sin ventas'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ProductSalesMobileCard({
  product,
  rank,
  metric,
}: {
  product: ProductSalesMetric;
  rank: number;
  metric: RankingMetric;
}) {
  return (
    <article className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold">
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <Link
            href={`/products?q=${encodeURIComponent(product.sku ?? product.name)}`}
            className="block truncate text-sm font-semibold text-accent"
          >
            {product.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {product.sku ?? 'Sin SKU'} {product.brand ? `· ${product.brand}` : ''}
          </p>
        </div>
        <Badge variant="outline" className="max-w-32 truncate">
          {product.categoryName}
        </Badge>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 rounded-md bg-muted/35 p-2 text-center">
        <MobileMetric
          label="Cantidad"
          value={formatQuantity(product.quantitySold)}
          active={metric === 'quantitySold'}
        />
        <MobileMetric
          label="Facturas"
          value={product.invoiceCount.toString()}
          active={metric === 'invoiceCount'}
        />
        <MobileMetric
          label="Facturado"
          value={formatCurrency(product.grossAmount)}
          active={metric === 'grossAmount'}
        />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{translateProductUnit(product.unit)}</span>
        <span>
          Última venta: {product.lastSoldAt ? formatDate(product.lastSoldAt) : 'Sin ventas'}
        </span>
      </div>
    </article>
  );
}

function MobileMetric({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 truncate text-xs font-semibold', active && 'text-accent')}>
        {value}
      </p>
    </div>
  );
}

function ProductSalesPagination({
  page,
  pageCount,
  rangeStart,
  rangeEnd,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-center text-sm text-muted-foreground sm:text-left">
        {total ? (
          <>
            <span className="font-medium text-foreground">
              {rangeStart}-{rangeEnd}
            </span>{' '}
            de {total}
          </>
        ) : (
          '0 resultados'
        )}
      </p>
      <div className="flex items-center justify-center gap-2 sm:justify-end">
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-24 text-center text-sm">
          Página {page} de {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
          aria-label="Página siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function getCategoryOptions(products: ProductSalesMetric[]) {
  const options = new Map<string, string>();

  for (const product of products) {
    options.set(product.categoryId ?? UNCATEGORIZED, product.categoryName);
  }

  return Array.from(options, ([value, label]) => ({ value, label })).sort((first, second) =>
    first.label.localeCompare(second.label, 'es'),
  );
}

function filterAndSortProducts(
  products: ProductSalesMetric[],
  filters: {
    mode: RankingMode;
    metric: RankingMetric;
    search: string;
    category: string;
    salesPresence: SalesPresence;
  },
) {
  const query = normalizeSearch(filters.search.trim());

  return products
    .filter((product) => {
      if (
        filters.category !== ALL_CATEGORIES &&
        (product.categoryId ?? UNCATEGORIZED) !== filters.category
      ) {
        return false;
      }

      const hasSales = product.invoiceCount > 0;
      if (filters.salesPresence === 'with-sales' && !hasSales) {
        return false;
      }
      if (filters.salesPresence === 'without-sales' && hasSales) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [product.name, product.sku, product.brand, product.categoryName].some(
        (value) => value && normalizeSearch(value).includes(query),
      );
    })
    .sort((first, second) => compareProducts(first, second, filters.metric, filters.mode));
}

function compareProducts(
  first: ProductSalesMetric,
  second: ProductSalesMetric,
  metric: RankingMetric,
  mode: RankingMode,
) {
  const direction = mode === 'most' ? -1 : 1;
  const metricDifference = first[metric] - second[metric];

  if (metricDifference) {
    return metricDifference * direction;
  }

  const tieBreakers: RankingMetric[] = ['grossAmount', 'quantitySold', 'invoiceCount'];
  for (const tieBreaker of tieBreakers) {
    if (tieBreaker === metric) {
      continue;
    }

    const difference = first[tieBreaker] - second[tieBreaker];
    if (difference) {
      return difference * direction;
    }
  }

  return first.name.localeCompare(second.name, 'es');
}

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es');
}

function getPeriodRange(period: PeriodPreset, now = new Date()): ProductSalesRange {
  if (period === 'all') {
    return {};
  }

  const todayKey = getDominicanDateKey(now);
  const fromKey =
    period === 'today'
      ? todayKey
      : period === '7d'
        ? shiftDateKey(todayKey, -6)
        : period === '30d'
          ? shiftDateKey(todayKey, -29)
          : `${todayKey.slice(0, 8)}01`;
  const toKey = shiftDateKey(todayKey, 1);

  return {
    from: dominicanDayStart(fromKey),
    to: dominicanDayStart(toKey),
  };
}

function getDominicanDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santo_Domingo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('No se pudo calcular la fecha operativa.');
  }

  return `${year}-${month}-${day}`;
}

function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function dominicanDayStart(dateKey: string) {
  return new Date(`${dateKey}T00:00:00-04:00`).toISOString();
}

function ProductSalesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-64 rounded-md bg-muted" />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="p-4">
              <div className="h-4 w-28 rounded-sm bg-muted" />
              <div className="mt-3 h-7 w-16 rounded-sm bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="h-80 p-5" />
      </Card>
    </div>
  );
}
