'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CircleDollarSign, Search } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
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
  getPayablesSummary,
  getSupplierInvoices,
  getSuppliers,
  type SupplierInvoiceStatus,
} from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import {
  ProcurementStatusBadge,
  QueryState,
  selectClassName,
} from './procurement-ui';
import { SessionRequired, useCurrentSession } from './session-required';

export function PayablesView() {
  const session = useCurrentSession();
  const [supplierId, setSupplierId] = useState('');
  const [search, setSearch] = useState('');
  const [invoiceFilter, setInvoiceFilter] = useState<'OPEN' | 'PAID' | 'ALL'>('OPEN');
  const summaryQuery = useQuery({
    queryKey: ['payables', 'summary', session?.tenantId, supplierId],
    queryFn: () =>
      getPayablesSummary(session?.tenantId ?? '', session?.accessToken ?? '', supplierId || undefined),
    enabled: Boolean(session),
  });
  const invoicesQuery = useQuery({
    queryKey: ['payables', 'invoices', session?.tenantId, supplierId, search, invoiceFilter],
    queryFn: () =>
      getSupplierInvoices(session?.tenantId ?? '', session?.accessToken ?? '', {
        supplierId: supplierId || undefined,
        q: search,
        status: invoiceFilter === 'PAID' ? ('PAID' as SupplierInvoiceStatus) : undefined,
      }),
    enabled: Boolean(session),
  });
  const suppliersQuery = useQuery({
    queryKey: ['suppliers', session?.tenantId, 'payables'],
    queryFn: () => getSuppliers(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });

  if (!session) return <SessionRequired session={session} />;

  const invoices = (invoicesQuery.data ?? []).filter((invoice) => {
    if (invoiceFilter === 'OPEN') {
      return ['PENDING', 'PARTIALLY_PAID'].includes(invoice.status);
    }

    return true;
  });
  const invoiceListTitle =
    invoiceFilter === 'PAID'
      ? 'Facturas pagadas'
      : invoiceFilter === 'ALL'
        ? 'Todas las facturas'
        : 'Obligaciones abiertas';
  const invoiceListDescription =
    invoiceFilter === 'PAID'
      ? 'Consulta las facturas de suplidores cuyo saldo ya fue liquidado.'
      : invoiceFilter === 'ALL'
        ? 'Incluye facturas pendientes, pagadas, borradores y canceladas.'
        : 'Las vencidas aparecen primero; luego las fechas de vencimiento más próximas.';
  const emptyMessage =
    invoiceFilter === 'PAID'
      ? 'No hay facturas pagadas para el filtro actual.'
      : invoiceFilter === 'ALL'
        ? 'No hay facturas para el filtro actual.'
        : 'No hay cuentas pendientes para el filtro actual.';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <ModuleHeader
          title="Cuentas por pagar"
          description="Compromisos con suplidores ordenados por vencimiento y saldo pendiente."
        />
        <Button asChild>
          <Link href="/supplier-invoices">Registrar factura o pago</Link>
        </Button>
      </div>

      <QueryState loading={summaryQuery.isLoading} error={summaryQuery.error} />
      {summaryQuery.data ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={<CircleDollarSign />}
            label="Saldo pendiente"
            value={formatCurrency(Number(summaryQuery.data.outstandingBalance))}
            detail={`${summaryQuery.data.openInvoiceCount} factura(s) abierta(s)`}
          />
          <MetricCard
            icon={<AlertTriangle />}
            label="Vencido"
            value={formatCurrency(Number(summaryQuery.data.overdueBalance))}
            detail={`${summaryQuery.data.overdueCount} factura(s)`}
            danger={summaryQuery.data.overdueCount > 0}
          />
          <MetricCard
            icon={<CalendarClock />}
            label="Vence hoy"
            value={formatCurrency(Number(summaryQuery.data.dueTodayBalance))}
            detail={`${summaryQuery.data.dueTodayCount} factura(s)`}
          />
          <MetricCard
            label="Próximos 7 días"
            value={formatCurrency(Number(summaryQuery.data.dueSoonBalance))}
            detail={`${summaryQuery.data.dueSoonCount} factura(s)`}
          />
        </section>
      ) : null}

      <Card>
        <CardContent className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_240px_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar factura, NCF o suplidor"
            />
          </div>
          <select
            className={selectClassName}
            value={supplierId}
            onChange={(event) => setSupplierId(event.target.value)}
          >
            <option value="">Todos los suplidores</option>
            {suppliersQuery.data?.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.commercialName}
              </option>
            ))}
          </select>
          <select
            aria-label="Estado de las facturas por pagar"
            className={selectClassName}
            value={invoiceFilter}
            onChange={(event) => setInvoiceFilter(event.target.value as typeof invoiceFilter)}
          >
            <option value="OPEN">Pendientes de pago</option>
            <option value="PAID">Facturas pagadas</option>
            <option value="ALL">Todas las facturas</option>
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{invoiceListTitle}</CardTitle>
          <CardDescription>{invoiceListDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState
            loading={invoicesQuery.isLoading}
            error={invoicesQuery.error}
            empty={!invoicesQuery.isLoading && !invoices.length}
            emptyMessage={emptyMessage}
          />
          {invoices.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Prioridad</TableHead>
                    <TableHead>Factura</TableHead>
                    <TableHead>Suplidor</TableHead>
                    <TableHead>Vencimiento</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Pagado</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <ProcurementStatusBadge status={invoice.displayStatus} />
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{invoice.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">{invoice.ncf ?? 'Sin NCF'}</p>
                      </TableCell>
                      <TableCell>{invoice.supplierNameSnapshot}</TableCell>
                      <TableCell>
                        <span className={invoice.isOverdue ? 'font-medium text-danger' : ''}>
                          {formatDate(invoice.dueDate)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(invoice.total))}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(invoice.paidAmount))}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatCurrency(Number(invoice.balance))}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/supplier-invoices/${invoice.id}/print`}>Ver detalle</Link>
                          </Button>
                          {['PENDING', 'PARTIALLY_PAID'].includes(invoice.status) ? (
                            <Button asChild size="sm">
                              <Link href={`/supplier-invoices?invoiceId=${invoice.id}`}>Pagar</Link>
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resumen por suplidor</CardTitle>
          <CardDescription>Deuda consolidada para conciliación y planificación de pagos.</CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState
            loading={summaryQuery.isLoading}
            empty={!summaryQuery.data?.bySupplier.length}
            emptyMessage="No hay saldos abiertos agrupados por suplidor."
          />
          {summaryQuery.data?.bySupplier.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {summaryQuery.data.bySupplier.map((supplier) => (
                <div key={supplier.supplierId} className="rounded-md border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{supplier.supplierName}</p>
                      <p className="text-xs text-muted-foreground">
                        {supplier.invoiceCount} factura(s) abierta(s)
                      </p>
                    </div>
                    {supplier.overdueCount ? (
                      <ProcurementStatusBadge status="OVERDUE" />
                    ) : null}
                  </div>
                  <p className="mt-4 text-xl font-semibold">
                    {formatCurrency(Number(supplier.outstandingBalance))}
                  </p>
                  {supplier.overdueCount ? (
                    <p className="mt-1 text-sm text-danger">
                      {formatCurrency(Number(supplier.overdueBalance))} vencidos
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-muted-foreground">Sin facturas vencidas</p>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  danger,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  danger?: boolean;
}) {
  return (
    <Card className={danger ? 'border-danger/40' : undefined}>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {icon ? <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
          {label}
        </div>
        <p className={danger ? 'mt-2 text-2xl font-semibold text-danger' : 'mt-2 text-2xl font-semibold'}>
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
