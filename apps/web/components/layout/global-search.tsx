'use client';

import { useQuery } from '@tanstack/react-query';
import { FileText, Package, Search, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getCustomers, getInvoices, getProducts } from '@/lib/api';
import type { AuthSession } from '@/lib/auth-session';
import { isAccountantSession, isAdminSession } from '@/lib/authorization';
import { translateDocumentType, translateStatus } from '@/lib/display-labels';
import { formatCurrency, formatDate } from '@/lib/utils';

type SearchResult = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  type: 'product' | 'customer' | 'invoice';
};

const resultIcons = {
  product: Package,
  customer: Users,
  invoice: FileText,
};

export function GlobalSearch({ session }: { session: AuthSession }) {
  const router = useRouter();
  const canSearchGlobally = isAdminSession(session) || isAccountantSession(session);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 180);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const searchReady = canSearchGlobally && debouncedSearch.length >= 2;
  const productsQuery = useQuery({
    queryKey: ['global-search-products', session.tenantId, debouncedSearch],
    queryFn: () => getProducts(session.tenantId, session.accessToken, debouncedSearch),
    enabled: searchReady,
  });
  const customersQuery = useQuery({
    queryKey: ['global-search-customers', session.tenantId],
    queryFn: () => getCustomers(session.tenantId, session.accessToken),
    enabled: searchReady,
  });
  const invoicesQuery = useQuery({
    queryKey: ['global-search-invoices', session.tenantId],
    queryFn: () => getInvoices(session.tenantId, session.accessToken),
    enabled: searchReady,
  });

  const results = useMemo(() => {
    if (!searchReady) {
      return [];
    }

    const normalizedSearch = debouncedSearch.toLowerCase();
    const products: SearchResult[] = (productsQuery.data ?? []).slice(0, 4).map((product) => ({
      id: `product-${product.id}`,
      type: 'product',
      title: product.name,
      subtitle: `${product.sku ?? 'Sin SKU'} · ${formatCurrency(Number(product.price))}`,
      href: `/products?q=${encodeURIComponent(product.sku ?? product.name)}`,
    }));
    const customers: SearchResult[] = (customersQuery.data ?? [])
      .filter((customer) =>
        [
          customer.name,
          customer.documentNumber,
          customer.email,
          customer.phone,
          translateDocumentType(customer.documentType),
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(normalizedSearch)),
      )
      .slice(0, 4)
      .map((customer) => ({
        id: `customer-${customer.id}`,
        type: 'customer',
        title: customer.name,
        subtitle: `${translateDocumentType(customer.documentType)} ${
          customer.documentNumber ?? 'sin documento'
        }`,
        href: `/customers?q=${encodeURIComponent(customer.name)}`,
      }));
    const invoices: SearchResult[] = (invoicesQuery.data ?? [])
      .filter((invoice) =>
        [
          invoice.invoiceNumber,
          invoice.eNcf,
          invoice.ncf,
          invoice.customer?.name,
          invoice.issuedBy?.name,
          translateStatus(invoice.status),
          invoice.total,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedSearch)),
      )
      .slice(0, 4)
      .map((invoice) => ({
        id: `invoice-${invoice.id}`,
        type: 'invoice',
        title: invoice.invoiceNumber,
        subtitle: `${invoice.customer?.name ?? 'Consumidor final'} · ${translateStatus(
          invoice.status,
        )} · ${formatDate(invoice.issuedAt ?? invoice.createdAt)}`,
        href: `/invoices/${invoice.id}`,
      }));

    return [...invoices, ...products, ...customers].slice(0, 8);
  }, [customersQuery.data, debouncedSearch, invoicesQuery.data, productsQuery.data, searchReady]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSearchGlobally) {
      router.push('/pos');
      return;
    }

    if (results[0]) {
      setOpen(false);
      router.push(results[0].href);
      return;
    }

    if (search.trim()) {
      setOpen(false);
      router.push(`/products?q=${encodeURIComponent(search.trim())}`);
    }
  }

  function clearSearch() {
    setSearch('');
    setDebouncedSearch('');
    setOpen(false);
  }

  if (!canSearchGlobally) {
    return (
      <Link
        href="/pos"
        className="hidden min-w-0 max-w-md flex-1 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-muted-foreground md:flex"
      >
        <Search className="h-4 w-4" />
        <span>Buscar productos desde la caja</span>
      </Link>
    );
  }

  const loading = productsQuery.isLoading || customersQuery.isLoading || invoicesQuery.isLoading;

  return (
    <form className="relative hidden min-w-0 max-w-md flex-1 md:block" onSubmit={handleSubmit}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        className="h-10 bg-zinc-50 pl-9 pr-10"
        placeholder="Buscar cliente, producto o factura"
        autoComplete="off"
      />
      {search ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1 h-8 w-8"
          aria-label="Limpiar busqueda"
          onClick={clearSearch}
        >
          <X className="h-4 w-4" />
        </Button>
      ) : null}

      {open && searchReady ? (
        <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-xl">
          {loading ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Buscando...</p>
          ) : results.length ? (
            <div className="max-h-96 overflow-y-auto p-1">
              {results.map((result) => {
                const Icon = resultIcons[result.type];

                return (
                  <Link
                    key={result.id}
                    href={result.href}
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition hover:bg-zinc-50"
                    onClick={clearSearch}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-zinc-950">
                        {result.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {result.subtitle}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              Sin resultados para esa busqueda.
            </p>
          )}
        </div>
      ) : null}
    </form>
  );
}
