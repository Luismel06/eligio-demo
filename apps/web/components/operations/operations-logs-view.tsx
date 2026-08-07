'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ClipboardList,
  FileText,
  ReceiptText,
  RefreshCw,
  Search,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  getOperationalLogs,
  type OperationalLog,
  type OperationalLogCategory,
} from '@/lib/api';
import {
  getStatusVariant,
  translateEmployeeAction,
  translatePaymentMethod,
  translateStatus,
} from '@/lib/display-labels';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';

type LogsTab = 'ALL' | OperationalLogCategory;

type TabDefinition = {
  id: LogsTab;
  label: string;
  description: string;
  icon: LucideIcon;
};

const tabs: TabDefinition[] = [
  {
    id: 'ALL',
    label: 'Todo',
    description: 'Cronología completa',
    icon: Activity,
  },
  {
    id: 'ORDER_TAKING',
    label: 'Toma de órdenes',
    description: 'Creación y gestión de órdenes',
    icon: ClipboardList,
  },
  {
    id: 'QUOTATION',
    label: 'Cotizaciones',
    description: 'Historial de propuestas',
    icon: FileText,
  },
  {
    id: 'POS_SALE',
    label: 'Ventas de caja',
    description: 'Cobros y facturación POS',
    icon: ReceiptText,
  },
];

export function OperationsLogsView() {
  const session = useCurrentSession();
  const [activeTab, setActiveTab] = useState<LogsTab>('ALL');
  const [search, setSearch] = useState('');
  const logsQuery = useQuery({
    queryKey: ['operational-logs', session?.tenantId],
    queryFn: () => getOperationalLogs(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });

  const logs = logsQuery.data ?? [];
  const sectionCounts = useMemo(
    () =>
      logs.reduce<Record<OperationalLogCategory, number>>(
        (counts, log) => {
          counts[log.category] += 1;
          return counts;
        },
        { ORDER_TAKING: 0, QUOTATION: 0, POS_SALE: 0 },
      ),
    [logs],
  );
  const filteredLogs = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('es-DO');

    return logs.filter((log) => {
      if (activeTab !== 'ALL' && log.category !== activeTab) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return getSearchText(log).includes(normalizedSearch);
    });
  }, [activeTab, logs, search]);

  if (!session) {
    return <SessionRequired session={session} />;
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Logs operativos"
        description="Historial centralizado de toma de órdenes, cotizaciones y ventas realizadas desde caja."
      />

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Actividad comercial</CardTitle>
              <CardDescription className="mt-1">
                Cada evento conserva el usuario, el documento y el momento en que ocurrió.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => logsQuery.refetch()}
              disabled={logsQuery.isFetching}
            >
              <RefreshCw className={cn('h-4 w-4', logsQuery.isFetching && 'animate-spin')} />
              Actualizar
            </Button>
          </div>

          <div className="grid gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-1 sm:grid-cols-2 xl:grid-cols-4">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const count = tab.id === 'ALL' ? logs.length : sectionCounts[tab.id];

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-pressed={isActive}
                  className={cn(
                    'rounded-md px-3 py-3 text-left transition',
                    isActive
                      ? 'bg-white text-zinc-950 shadow-sm ring-1 ring-zinc-200'
                      : 'text-zinc-600 hover:bg-white/70',
                  )}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                      <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-[#f36c10]')} />
                      <span className="truncate">{tab.label}</span>
                    </span>
                    <Badge variant={isActive ? 'success' : 'outline'}>{count}</Badge>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{tab.description}</span>
                </button>
              );
            })}
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <label className="relative block max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por código, cliente, usuario o acción..."
              aria-label="Buscar logs operativos"
              className="h-10 w-full rounded-md border border-input bg-white py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-[#f36c10]"
            />
          </label>

          {logsQuery.isLoading ? (
            <LoadingState />
          ) : logsQuery.isError ? (
            <ErrorState onRetry={() => logsQuery.refetch()} />
          ) : filteredLogs.length ? (
            <LogsList logs={filteredLogs} />
          ) : (
            <EmptyState hasSearch={Boolean(search.trim())} activeTab={activeTab} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LogsList({ logs }: { logs: OperationalLog[] }) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {logs.length} {logs.length === 1 ? 'evento encontrado' : 'eventos encontrados'}
        </span>
        <span className="hidden sm:inline">Del más reciente al más antiguo</span>
      </div>

      <div className="surface-scrollbar hidden max-h-[calc(100vh-24rem)] overflow-auto rounded-md border md:block">
        <table className="w-full min-w-[60rem] text-sm">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr className="border-b">
              <th className="px-4 py-3 font-medium">Fecha</th>
              <th className="px-4 py-3 font-medium">Sección</th>
              <th className="px-4 py-3 font-medium">Acción</th>
              <th className="px-4 py-3 font-medium">Documento / cliente</th>
              <th className="px-4 py-3 font-medium">Usuario</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 text-right font-medium">Monto</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-zinc-100 align-top last:border-0 hover:bg-zinc-50/70">
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                  {formatDateTime(log.createdAt)}
                </td>
                <td className="px-4 py-3">
                  <CategoryBadge category={log.category} />
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-900">{getOperationalActionLabel(log)}</p>
                  {log.detail ? <p className="mt-1 max-w-xs text-xs text-muted-foreground">{log.detail}</p> : null}
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-900">{log.documentNumber ?? 'Sin documento'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{log.customerName ?? 'Cliente no registrado'}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium text-zinc-900">{log.user?.name ?? 'Usuario no disponible'}</p>
                  {log.cashRegisterName ? (
                    <p className="mt-1 text-xs text-muted-foreground">Caja: {log.cashRegisterName}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {log.status ? (
                      <Badge variant={getStatusVariant(log.status)}>{translateStatus(log.status)}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                    {log.paymentMethod ? (
                      <Badge variant="outline">{translatePaymentMethod(log.paymentMethod)}</Badge>
                    ) : null}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-zinc-900">
                  {formatLogAmount(log.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {logs.map((log) => (
          <article key={log.id} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <CategoryBadge category={log.category} />
                  {log.status ? (
                    <Badge variant={getStatusVariant(log.status)}>{translateStatus(log.status)}</Badge>
                  ) : null}
                </div>
                <p className="mt-2 text-sm font-semibold text-zinc-900">
                  {getOperationalActionLabel(log)}
                </p>
              </div>
              <strong className="whitespace-nowrap text-sm text-zinc-900">{formatLogAmount(log.amount)}</strong>
            </div>
            <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3 text-xs text-muted-foreground">
              <p className="font-medium text-zinc-900">{log.documentNumber ?? 'Sin documento'}</p>
              <p>{log.customerName ?? 'Cliente no registrado'}</p>
              <p className="flex items-center gap-1.5">
                <UserRound className="h-3.5 w-3.5" />
                {log.user?.name ?? 'Usuario no disponible'}
                {log.cashRegisterName ? ` · Caja: ${log.cashRegisterName}` : ''}
              </p>
              {log.paymentMethod ? <p>Método: {translatePaymentMethod(log.paymentMethod)}</p> : null}
              {log.detail ? <p>{log.detail}</p> : null}
              <p>{formatDateTime(log.createdAt)}</p>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function CategoryBadge({ category }: { category: OperationalLogCategory }) {
  const labels: Record<OperationalLogCategory, string> = {
    ORDER_TAKING: 'Toma de órdenes',
    QUOTATION: 'Cotización',
    POS_SALE: 'Venta de caja',
  };
  const variants: Record<OperationalLogCategory, 'outline' | 'success' | 'warning'> = {
    ORDER_TAKING: 'outline',
    QUOTATION: 'warning',
    POS_SALE: 'success',
  };

  return <Badge variant={variants[category]}>{labels[category]}</Badge>;
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-20 animate-pulse rounded-md border bg-zinc-50" />
      ))}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-md border border-danger/30 bg-danger/5 px-4 py-8 text-center">
      <p className="font-medium text-danger">No se pudieron cargar los logs operativos.</p>
      <p className="mt-1 text-sm text-muted-foreground">Verifica la conexión e inténtalo nuevamente.</p>
      <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        Reintentar
      </Button>
    </div>
  );
}

function EmptyState({ hasSearch, activeTab }: { hasSearch: boolean; activeTab: LogsTab }) {
  const tabLabel =
    tabs.find((tab) => tab.id === activeTab)?.label.toLocaleLowerCase('es-DO') ?? 'esta sección';
  const emptyTitle =
    activeTab === 'ALL' ? 'No hay logs operativos todavía' : `No hay logs en ${tabLabel}`;

  return (
    <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-12 text-center">
      <Activity className="mx-auto h-10 w-10 text-muted-foreground" />
      <p className="mt-3 font-medium text-zinc-900">
        {hasSearch ? 'No encontramos eventos con esa búsqueda' : emptyTitle}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasSearch
          ? 'Prueba con otro código, nombre de cliente o usuario.'
          : 'Los nuevos eventos de esta operación aparecerán aquí automáticamente.'}
      </p>
    </div>
  );
}

function getSearchText(log: OperationalLog) {
  return [
    log.action,
    getOperationalActionLabel(log),
    log.documentNumber,
    log.customerName,
    log.user?.name,
    log.user?.email,
    log.status,
    log.cashRegisterName,
    log.paymentMethod,
    log.detail,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('es-DO');
}

function getOperationalActionLabel(log: OperationalLog) {
  if (log.category === 'QUOTATION') {
    const quotationActions: Record<string, string> = {
      CREATE_SALES_ORDER: 'Creó una cotización',
      SEND_SALES_ORDER_TO_CASHIER: 'Aceptó y envió la cotización a caja',
      CLAIM_SALES_ORDER: 'Tomó la cotización en caja',
      RELEASE_SALES_ORDER: 'Liberó la cotización de caja',
      COMPLETE_SALES_ORDER: 'Completó una venta desde cotización',
      CANCEL_SALES_ORDER: 'Canceló la cotización',
      EXPIRE_SALES_ORDER: 'Venció la cotización',
    };

    return quotationActions[log.action] ?? translateEmployeeAction(log.action);
  }

  if (log.category === 'POS_SALE') {
    const saleActions: Record<string, string> = {
      CREATE_SALE: 'Registró una venta en caja',
      ISSUE_INVOICE: 'Emitió una factura de venta',
      CANCEL_SALE: 'Canceló una venta de caja',
      CANCEL_INVOICE: 'Canceló una factura de venta',
      COMPLETE_SALES_ORDER: 'Completó una venta de orden',
    };

    return saleActions[log.action] ?? translateEmployeeAction(log.action);
  }

  return translateEmployeeAction(log.action);
}

function formatLogAmount(amount: OperationalLog['amount']) {
  if (amount === null || amount === undefined) {
    return '—';
  }

  return formatCurrency(Number(amount));
}
