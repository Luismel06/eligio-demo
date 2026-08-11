'use client';

import { useQuery } from '@tanstack/react-query';
import { Printer, Search } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
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
import { getInvoices, type Invoice } from '@/lib/api';
import type { AuthSession } from '@/lib/auth-session';
import { isAdminSession } from '@/lib/authorization';
import { getStatusVariant, translateStatus } from '@/lib/display-labels';
import { formatCurrency, formatDate } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';

export function InvoicesView() {
  const session = useCurrentSession();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [periodFilter, setPeriodFilter] = useState('ALL');

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('q');
    if (query) {
      setSearch(query);
    }
  }, []);

  const invoicesQuery = useQuery({
    queryKey: ['invoices', session?.tenantId],
    queryFn: () => getInvoices(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });

  const filteredInvoices = useMemo(() => {
    const query = search.trim().toLowerCase();

    return (invoicesQuery.data ?? [])
      .filter(
        (invoice) =>
          statusFilter === 'ALL' ||
          (statusFilter === 'VOIDED'
            ? ['VOID', 'VOIDED'].includes(invoice.status)
            : invoice.status === statusFilter),
      )
      .filter((invoice) => matchesPeriod(invoice.issuedAt ?? invoice.createdAt, periodFilter))
      .filter((invoice) => {
        if (!query) {
          return true;
        }

        return [
          invoice.invoiceNumber,
          invoice.ncf,
          invoice.eNcf,
          invoice.customer?.name,
          invoice.issuedBy?.name,
          invoice.status,
          translateStatus(invoice.status),
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(query));
      })
      .sort(
        (a, b) =>
          new Date(b.issuedAt ?? b.createdAt).getTime() -
          new Date(a.issuedAt ?? a.createdAt).getTime(),
      );
  }, [invoicesQuery.data, periodFilter, search, statusFilter]);
  const total = filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.total), 0);

  if (!session) {
    return <SessionRequired session={session} />;
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Facturas"
        description="Facturas locales de Ferreteria RIVNU con NCF B01 o B02."
      />

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Facturas</p>
            <p className="mt-2 text-2xl font-semibold">{filteredInvoices.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Total listado</p>
            <p className="mt-2 text-2xl font-semibold">{formatCurrency(total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Pendientes</p>
            <p className="mt-2 text-2xl font-semibold">
              {filteredInvoices.filter((invoice) => invoice.status === 'ISSUED').length}
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1.4fr_0.8fr_0.8fr]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="bg-white pl-9"
              placeholder="Buscar por factura, cliente, NCF o cajero"
            />
          </div>
          <select
            value={periodFilter}
            onChange={(event) => setPeriodFilter(event.target.value)}
            className="h-10 rounded-md border border-input bg-white px-3 text-sm"
          >
            <option value="ALL">Todas las fechas</option>
            <option value="TODAY">Hoy</option>
            <option value="MONTH">Este mes</option>
            <option value="LAST_MONTH">Mes pasado</option>
            <option value="FIRST_HALF">Primera quincena</option>
            <option value="SECOND_HALF">Segunda quincena</option>
            <option value="YEAR">Este ano</option>
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-10 rounded-md border border-input bg-white px-3 text-sm"
          >
            <option value="ALL">Todos los estados</option>
            <option value="PAID">Pagadas</option>
            <option value="ISSUED">Pendientes</option>
            <option value="DRAFT">Borradores</option>
            <option value="CANCELLED">Canceladas</option>
            <option value="VOIDED">Anuladas</option>
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Listado de facturas</CardTitle>
          <CardDescription>
            Datos reales consultados por tenant, organizados por fecha.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 md:hidden">
            {filteredInvoices.map((invoice) => (
              <div key={invoice.id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{invoice.invoiceNumber}</p>
                    <p className="text-xs font-medium">NCF {invoice.ncf ?? 'pendiente'}</p>
                    <p className="text-xs text-muted-foreground">
                      {invoice.customer?.name ?? 'Consumidor final'}
                    </p>
                  </div>
                  <Badge variant={getStatusVariant(invoice.status)}>
                    {translateStatus(invoice.status)}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span>{formatDate(invoice.issuedAt ?? invoice.createdAt)}</span>
                  <span className="font-semibold">{formatCurrency(Number(invoice.total))}</span>
                </div>
                {canOfferInvoicePrint(invoice, session) ? (
                  <div className="mt-3 flex justify-end">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/invoices/${invoice.id}/print`}>
                        <Printer className="h-4 w-4" />
                        {(invoice.receiptPrintCount ?? 0) > 0 ? 'Reimprimir' : 'Imprimir'}
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Numero</TableHead>
                  <TableHead>NCF</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">
                      <Link href={`/invoices/${invoice.id}`} className="hover:underline">
                        {invoice.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{invoice.ncf ?? '-'}</TableCell>
                    <TableCell>{invoice.customer?.name ?? 'Consumidor final'}</TableCell>
                    <TableCell>{formatDate(invoice.issuedAt ?? invoice.createdAt)}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(invoice.status)}>
                        {translateStatus(invoice.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{invoice.items.length}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(Number(invoice.total))}
                    </TableCell>
                    <TableCell className="text-right">
                      {canOfferInvoicePrint(invoice, session) ? (
                        <Button asChild variant="ghost" size="icon">
                          <Link
                            href={`/invoices/${invoice.id}/print`}
                            aria-label={
                              (invoice.receiptPrintCount ?? 0) > 0
                                ? 'Reimprimir factura'
                                : 'Imprimir factura'
                            }
                          >
                            <Printer className="h-4 w-4" />
                          </Link>
                        </Button>
                      ) : null}
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

function canOfferInvoicePrint(invoice: Invoice, session: AuthSession) {
  const expectedNcfPrefix =
    invoice.documentType === 'CONSUMER_02'
      ? 'B02'
      : invoice.documentType === 'FISCAL_CREDIT_01'
        ? 'B01'
        : null;
  const isIssuedLocalInvoice = Boolean(
    expectedNcfPrefix &&
    invoice.ncf &&
    new RegExp(`^${expectedNcfPrefix}\\d{8}$`).test(invoice.ncf) &&
    invoice.fiscalStatus === 'LOCAL_ISSUED' &&
    ['ISSUED', 'PAID', 'PARTIALLY_PAID'].includes(invoice.status),
  );

  if (!isIssuedLocalInvoice) {
    return false;
  }

  if (isAdminSession(session)) {
    return true;
  }

  if ((invoice.receiptPrintCount ?? 0) === 0) {
    return session.role === 'CASHIER' && invoice.issuedBy?.id === session.user.id;
  }

  return Boolean(session.permissions.canReprintReceipt);
}

function matchesPeriod(dateValue: string, period: string) {
  if (period === 'ALL') {
    return true;
  }

  const date = new Date(dateValue);
  const now = new Date();

  if (period === 'TODAY') {
    return date.toDateString() === now.toDateString();
  }

  if (period === 'MONTH') {
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  }

  if (period === 'LAST_MONTH') {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return (
      date.getFullYear() === lastMonth.getFullYear() && date.getMonth() === lastMonth.getMonth()
    );
  }

  if (period === 'FIRST_HALF') {
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() <= 15
    );
  }

  if (period === 'SECOND_HALF') {
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() > 15
    );
  }

  return date.getFullYear() === now.getFullYear();
}
