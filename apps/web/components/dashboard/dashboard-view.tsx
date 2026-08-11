'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  FileText,
  Landmark,
  PackageCheck,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ShoppingBag,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatQuantity } from '@/components/operations/pos/pos-utils';
import {
  getDashboardSummary,
  getProductSalesRanking,
  type DashboardSummary,
  type ProductSalesMetric,
} from '@/lib/api';
import { getSession, type AuthSession } from '@/lib/auth-session';
import { canAccessPath, isAccountantSession } from '@/lib/authorization';
import {
  getStatusVariant,
  translateEmployeeAction,
  translateEntity,
  translateProductUnit,
  translateStatus,
} from '@/lib/display-labels';
import { cn, formatCurrency, formatDate, formatDateTime } from '@/lib/utils';

const emptyAccounting: DashboardSummary['accounting'] = {
  receivables: {
    outstandingBalance: 0,
    overdueBalance: 0,
    overdueCount: 0,
    dueTodayCount: 0,
    dueSoonCount: 0,
    openInvoiceCount: 0,
  },
  payables: {
    outstandingBalance: 0,
    overdueBalance: 0,
    overdueCount: 0,
    dueTodayCount: 0,
    dueSoonCount: 0,
    openInvoiceCount: 0,
  },
  purchaseOrders: {
    draftCount: 0,
    underReviewCount: 0,
    awaitingInvoiceCount: 0,
    overdueCount: 0,
    partiallyReceivedCount: 0,
    awaitingReceiptCount: 0,
  },
  receipts: {
    draftCount: 0,
    itemsWithDifferenceCount: 0,
  },
  creditApprovals: {
    pendingCount: 0,
    pendingFinancedAmount: 0,
    exceedsLimitCount: 0,
  },
};

export function DashboardView() {
  const session = getSession();
  const summaryQuery = useQuery({
    queryKey: ['dashboard-summary', session?.tenantId],
    queryFn: () => getDashboardSummary(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session?.tenantId && session.accessToken),
  });
  const productSalesQuery = useQuery({
    queryKey: ['product-sales-ranking', session?.tenantId, 'dashboard-preview'],
    queryFn: () => getProductSalesRanking(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session?.tenantId && session.accessToken),
  });

  if (!session) {
    return <SessionRequiredCard />;
  }

  if (summaryQuery.isLoading) {
    return <DashboardSkeleton />;
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    return <DashboardUnavailableCard />;
  }

  const summary = summaryQuery.data;
  const accounting = summary.accounting ?? emptyAccounting;
  const expectedCash = summary.openCashSessionDetails.reduce(
    (total, cashSession) => total + cashSession.expectedCashAmount,
    0,
  );
  const topSellingProducts = productSalesQuery.data?.mostSold.slice(0, 3) ?? [];
  const leastSellingProducts = productSalesQuery.data?.leastSold.slice(0, 3) ?? [];
  const greeting = getGreeting();
  const firstName = session.user.name.split(' ')[0] || session.user.name;
  const dateLabel = new Intl.DateTimeFormat('es-DO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date());

  const quickActions = [
    {
      label: 'Órdenes de compra',
      description: 'Gestionar compras',
      href: '/purchase-orders',
      icon: ShoppingCart,
      tone: 'bg-sky-500/10 text-sky-700',
    },
    {
      label: 'Facturas de suplidores',
      description: 'Registrar y consultar',
      href: '/supplier-invoices',
      icon: FileText,
      tone: 'bg-violet-500/10 text-violet-700',
    },
    {
      label: 'Cuentas por pagar',
      description: 'Pagos y vencimientos',
      href: '/payables',
      icon: Wallet,
      tone: 'bg-orange-500/10 text-orange-700',
    },
    {
      label: 'Cuentas por cobrar',
      description: 'Cartera de clientes',
      href: '/receivables',
      icon: BadgeDollarSign,
      tone: 'bg-emerald-500/10 text-emerald-700',
    },
    {
      label: 'Aprobaciones de crédito',
      description: 'Ventas fiadas',
      href: '/credit-approvals',
      icon: CreditCard,
      tone: 'bg-rose-500/10 text-rose-700',
    },
    {
      label: 'Actividad operativa',
      description: 'Revisar logs',
      href: '/operations/logs',
      icon: Activity,
      tone: 'bg-cyan-500/10 text-cyan-700',
    },
  ].filter((action) => canAccessPath(session, action.href));

  const attentionItems = [
    {
      label: 'Cuentas por cobrar vencidas',
      value: accounting.receivables.overdueCount,
      detail: formatCurrency(accounting.receivables.overdueBalance),
      href: '/receivables',
      tone: 'danger' as const,
      icon: Clock3,
    },
    {
      label: 'Cuentas por pagar vencidas',
      value: accounting.payables.overdueCount,
      detail: formatCurrency(accounting.payables.overdueBalance),
      href: '/payables',
      tone: 'danger' as const,
      icon: AlertTriangle,
    },
    {
      label: 'Créditos por aprobar',
      value: accounting.creditApprovals.pendingCount,
      detail: `${formatCurrency(accounting.creditApprovals.pendingFinancedAmount)} por financiar`,
      href: '/credit-approvals',
      tone: 'warning' as const,
      icon: CreditCard,
    },
    {
      label: 'Órdenes de compra en revisión',
      value: accounting.purchaseOrders.underReviewCount,
      detail: `${accounting.purchaseOrders.overdueCount} con entrega retrasada`,
      href: '/purchase-orders',
      tone: 'warning' as const,
      icon: ShoppingBag,
    },
    {
      label: 'Entradas de mercancía pendientes',
      value: accounting.purchaseOrders.awaitingReceiptCount,
      detail:
        accounting.receipts.itemsWithDifferenceCount > 0
          ? `${accounting.receipts.itemsWithDifferenceCount} diferencias por revisar`
          : `${accounting.receipts.draftCount} recepciones en borrador`,
      href: '/supplier-invoices',
      tone: 'warning' as const,
      icon: PackageCheck,
    },
    {
      label: 'Secuencias fiscales con alerta',
      value: summary.fiscalSequenceAlerts.length,
      detail: 'Requieren seguimiento',
      href: '/settings/fiscal-sequences',
      tone: 'warning' as const,
      icon: FileText,
    },
  ].filter((item) => item.value > 0);

  const activity = buildActivityFeed(summary).slice(0, 6);
  const salesQueueHref = canAccessPath(session, '/pos') ? '/pos' : '/orders';

  return (
    <div className="space-y-5 pb-4 sm:space-y-6">
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-accent">
              <span className="h-2 w-2 rounded-full bg-accent" />
              Vista general
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {greeting}, {firstName}.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {isAccountantSession(session)
                ? `Consulta la salud financiera y el avance de compras de ${session.tenantName}.`
                : `Aquí tienes lo más importante de ${session.tenantName} para tomar decisiones hoy.`}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/45 px-3 py-2.5 text-sm">
              <CalendarDays className="h-4 w-4 shrink-0 text-accent" />
              <div className="min-w-0">
                <p className="capitalize font-medium text-foreground">{dateLabel}</p>
                <p className="text-xs text-muted-foreground">
                  Actualizado {summaryQuery.dataUpdatedAt ? formatDateTime(new Date(summaryQuery.dataUpdatedAt)) : 'ahora'}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => void summaryQuery.refetch()}
              disabled={summaryQuery.isFetching}
            >
              <RefreshCw className={cn('h-4 w-4', summaryQuery.isFetching && 'animate-spin')} />
              Actualizar
            </Button>
          </div>
        </div>
      </section>

      <section aria-label="Indicadores principales" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Cobrado neto del mes"
          value={formatCurrency(summary.netSalesMonth)}
          detail={`Hoy: ${formatCurrency(summary.netSalesToday)}`}
          icon={ReceiptText}
          href="/invoices"
          session={session}
          tone="accent"
          negative={summary.netSalesMonth < 0}
        />
        <MetricCard
          label="Saldo por cobrar"
          value={formatCurrency(accounting.receivables.outstandingBalance)}
          detail={buildDueDetail(accounting.receivables.overdueCount, accounting.receivables.overdueBalance, 'vencida')}
          icon={BadgeDollarSign}
          href="/receivables"
          session={session}
          tone={accounting.receivables.overdueCount ? 'danger' : 'success'}
          negative={accounting.receivables.outstandingBalance < 0}
        />
        <MetricCard
          label="Saldo por pagar"
          value={formatCurrency(accounting.payables.outstandingBalance)}
          detail={buildDueDetail(accounting.payables.overdueCount, accounting.payables.overdueBalance, 'vencida')}
          icon={Wallet}
          href="/payables"
          session={session}
          tone={accounting.payables.overdueCount ? 'danger' : 'warning'}
          negative={accounting.payables.outstandingBalance < 0}
        />
        <MetricCard
          label="Cajas abiertas"
          value={summary.openCashSessions.toString()}
          detail={
            summary.openCashSessions
              ? `Esperado: ${formatCurrency(expectedCash)}`
              : 'No hay sesiones activas'
          }
          icon={Landmark}
          href="/cash/sessions"
          session={session}
          tone="primary"
          detailDanger={expectedCash < 0}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.85fr)]">
        <SalesChart summary={summary} />
        <AttentionCard items={attentionItems} session={session} />
      </section>

      {quickActions.length ? (
        <section aria-label="Accesos rápidos">
          <SectionHeading
            eyebrow="Navegación"
            title="Accesos rápidos"
            description="Entra directo a las áreas que concentran la gestión diaria."
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {quickActions.map((action) => {
              const Icon = action.icon;

              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className="group flex min-w-0 items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 shadow-sm transition hover:-translate-y-px hover:border-primary/30 hover:shadow-md"
                >
                  <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', action.tone)}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{action.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{action.description}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-3">
        <QueueCard
          title="Venta y caja"
          description="Cobros, cotizaciones y operación de caja."
          href="/invoices"
          session={session}
          icon={ReceiptText}
          items={[
            {
              label: 'Órdenes en caja',
              value: summary.ordersInCashier,
              detail: `${summary.pendingOrders} por cobrar · ${summary.claimedOrders} tomadas`,
              href: salesQueueHref,
            },
            {
              label: 'Cotizaciones pendientes',
              value: summary.pendingQuotations,
              detail: `${summary.quotationSalesInCashier} listas para cobrar`,
              href: '/quotations',
            },
            {
              label: 'Devoluciones por validar',
              value: summary.pendingReturns,
              detail: formatCurrency(summary.pendingReturnAmount),
              href: '/returns',
              tone: summary.pendingReturns ? 'danger' : 'neutral',
            },
            {
              label: 'Facturas pendientes',
              value: summary.pendingInvoices,
              detail: `${summary.completedOrdersToday} órdenes completadas hoy`,
              href: '/invoices',
            },
          ]}
        />
        <QueueCard
          title="Compras y suplidores"
          description="Sigue cada paso desde la orden hasta la entrada."
          href="/purchase-orders"
          session={session}
          icon={ShoppingBag}
          items={[
            {
              label: 'Órdenes en borrador',
              value: accounting.purchaseOrders.draftCount,
              detail: 'Aún no se han solicitado',
              href: '/purchase-orders',
            },
            {
              label: 'Órdenes en revisión',
              value: accounting.purchaseOrders.underReviewCount,
              detail: `${accounting.purchaseOrders.overdueCount} con entrega retrasada`,
              href: '/purchase-orders',
              tone: accounting.purchaseOrders.underReviewCount ? 'warning' : 'neutral',
            },
            {
              label: 'Emitidas sin factura',
              value: accounting.purchaseOrders.awaitingInvoiceCount,
              detail: 'Pendientes de registrar como factura de suplidor',
              href: '/supplier-invoices',
            },
            {
              label: 'Facturas sin entrada confirmada',
              value: accounting.purchaseOrders.awaitingReceiptCount,
              detail:
                accounting.receipts.itemsWithDifferenceCount > 0
                  ? `${accounting.receipts.itemsWithDifferenceCount} diferencias por validar`
                  : `${accounting.receipts.draftCount} recepciones en borrador`,
              href: '/supplier-invoices',
              tone: accounting.receipts.draftCount ? 'warning' : 'neutral',
            },
          ]}
        />
        <QueueCard
          title="Crédito y cartera"
          description="Prioriza vencimientos y ventas a crédito."
          href="/receivables"
          session={session}
          icon={CreditCard}
          items={[
            {
              label: 'Créditos pendientes',
              value: accounting.creditApprovals.pendingCount,
              detail: `${formatCurrency(accounting.creditApprovals.pendingFinancedAmount)} por aprobar`,
              href: '/credit-approvals',
              tone: accounting.creditApprovals.pendingCount ? 'warning' : 'neutral',
            },
            {
              label: 'Vencen hoy',
              value: accounting.receivables.dueTodayCount,
              detail: 'Facturas de clientes',
              href: '/receivables',
              tone: accounting.receivables.dueTodayCount ? 'warning' : 'neutral',
            },
            {
              label: 'Próximas a vencer',
              value: accounting.receivables.dueSoonCount,
              detail: 'Dentro de los próximos 7 días',
              href: '/receivables',
            },
            {
              label: 'Cartera vencida',
              value: accounting.receivables.overdueCount,
              detail: formatCurrency(accounting.receivables.overdueBalance),
              href: '/receivables',
              tone: accounting.receivables.overdueCount ? 'danger' : 'neutral',
            },
          ]}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <ActivityCard activity={activity} session={session} />
        <RecentInvoicesCard invoices={summary.recentInvoices} session={session} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <ProductPerformanceCard
          topSellingProducts={topSellingProducts}
          leastSellingProducts={leastSellingProducts}
          loading={productSalesQuery.isLoading}
        />
        <ControlAlertsCard summary={summary} session={session} />
      </section>
    </div>
  );
}

function SessionRequiredCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sesión requerida</CardTitle>
        <CardDescription>Inicia sesión para consultar los indicadores protegidos de tu empresa.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <a href="/login">Ir al login</a>
        </Button>
      </CardContent>
    </Card>
  );
}

function DashboardUnavailableCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Panel no disponible</CardTitle>
        <CardDescription>
          No pudimos cargar los datos del panel. Revisa que el API esté corriendo y que tu sesión tenga acceso al tenant.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  href,
  session,
  tone,
  negative = false,
  detailDanger = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  href: string;
  session: AuthSession;
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'primary';
  negative?: boolean;
  detailDanger?: boolean;
}) {
  const tones = {
    accent: 'bg-cyan-500/10 text-cyan-700',
    success: 'bg-emerald-500/10 text-emerald-700',
    warning: 'bg-orange-500/10 text-orange-700',
    danger: 'bg-rose-500/10 text-rose-700',
    primary: 'bg-primary/10 text-primary',
  };
  const content = (
    <CardContent className="flex min-w-0 items-start justify-between gap-3 p-4 sm:p-5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className={cn('mt-2 truncate text-xl font-semibold tracking-tight sm:text-2xl', negative && 'text-danger')}>
          {value}
        </p>
        <p className={cn('mt-1.5 truncate text-xs text-muted-foreground', detailDanger && 'font-medium text-danger')}>
          {detail}
        </p>
      </div>
      <span className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-lg', tones[tone])}>
        <Icon className="h-5 w-5" />
      </span>
    </CardContent>
  );

  return (
    <Card className="overflow-hidden rounded-xl transition hover:-translate-y-px hover:border-primary/25 hover:shadow-md">
      {canAccessPath(session, href) ? (
        <Link href={href} aria-label={`Abrir ${label}`} className="block h-full">
          {content}
        </Link>
      ) : (
        content
      )}
    </Card>
  );
}

function SalesChart({ summary }: { summary: DashboardSummary }) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Rendimiento</p>
          <CardTitle className="mt-2">Cobros netos</CardTitle>
          <CardDescription className="mt-1">Últimos seis meses, después de devoluciones completadas.</CardDescription>
        </div>
        <div className="hidden rounded-lg bg-success/10 px-3 py-2 text-right sm:block">
          <p className="text-xs text-success">Mes actual</p>
          <p className="text-sm font-semibold text-success">{formatCurrency(summary.netSalesMonth)}</p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={summary.salesSeries} margin={{ left: -12, right: 8, top: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="dashboard-sales-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.26} />
                  <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
              />
              <YAxis
                width={48}
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                tickFormatter={(value) => formatCompactCurrency(Number(value))}
              />
              <Tooltip
                cursor={{ stroke: 'hsl(var(--accent))', strokeOpacity: 0.25 }}
                contentStyle={{
                  borderColor: 'hsl(var(--border))',
                  borderRadius: '0.5rem',
                  boxShadow: '0 8px 24px rgb(15 23 42 / 0.12)',
                }}
                formatter={(value) => [formatCurrency(Number(value)), 'Cobrado neto']}
              />
              <Area
                type="monotone"
                dataKey="total"
                stroke="hsl(var(--accent))"
                fill="url(#dashboard-sales-area)"
                strokeWidth={2.5}
                activeDot={{ r: 4, strokeWidth: 0, fill: 'hsl(var(--accent))' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function AttentionCard({
  items,
  session,
}: {
  items: Array<{
    label: string;
    value: number;
    detail: string;
    href: string;
    tone: 'warning' | 'danger';
    icon: LucideIcon;
  }>;
  session: AuthSession;
}) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warning">Prioridades</p>
          <CardTitle className="mt-2">Atención hoy</CardTitle>
          <CardDescription className="mt-1">Tareas que pueden afectar cobros, compras o continuidad fiscal.</CardDescription>
        </div>
        {items.length ? <Badge variant="warning">{items.length}</Badge> : <Badge variant="success">Al día</Badge>}
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className="space-y-2">
            {items.slice(0, 5).map((item) => (
              <AttentionRow key={item.label} item={item} session={session} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-success/35 bg-success/5 px-5 py-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success/10 text-success">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <p className="mt-3 text-sm font-semibold">No hay pendientes críticos</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">La cartera, compras y alertas principales están bajo control.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttentionRow({
  item,
  session,
}: {
  item: {
    label: string;
    value: number;
    detail: string;
    href: string;
    tone: 'warning' | 'danger';
    icon: LucideIcon;
  };
  session: AuthSession;
}) {
  const Icon = item.icon;
  const tone = item.tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-warning/12 text-warning';
  const content = (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-2.5 transition hover:border-primary/25 hover:bg-muted/45">
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.label}</p>
        <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
      </div>
      <span className="shrink-0 text-lg font-semibold">{item.value}</span>
      {canAccessPath(session, item.href) ? <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
    </div>
  );

  return canAccessPath(session, item.href) ? <Link href={item.href}>{content}</Link> : content;
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">{eyebrow}</p>
      <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function QueueCard({
  title,
  description,
  href,
  session,
  icon: Icon,
  items,
}: {
  title: string;
  description: string;
  href: string;
  session: AuthSession;
  icon: LucideIcon;
  items: Array<{
    label: string;
    value: number;
    detail: string;
    href: string;
    tone?: 'neutral' | 'warning' | 'danger';
  }>;
}) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary">
              <Icon className="h-4 w-4" />
            </span>
            <CardTitle>{title}</CardTitle>
          </div>
          <CardDescription className="mt-2 leading-5">{description}</CardDescription>
        </div>
        {canAccessPath(session, href) ? (
          <Button asChild variant="ghost" size="sm" className="-mr-2 shrink-0 text-accent hover:text-accent">
            <Link href={href}>
              Ver todo
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-1.5">
        {items.map((item) => (
          <QueueItem key={item.label} item={item} session={session} />
        ))}
      </CardContent>
    </Card>
  );
}

function QueueItem({
  item,
  session,
}: {
  item: {
    label: string;
    value: number;
    detail: string;
    href: string;
    tone?: 'neutral' | 'warning' | 'danger';
  };
  session: AuthSession;
}) {
  const tone =
    item.tone === 'danger'
      ? 'bg-danger/10 text-danger'
      : item.tone === 'warning'
        ? 'bg-warning/12 text-warning'
        : 'bg-muted text-foreground';
  const content = (
    <div className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-muted/65">
      <span className={cn('flex h-7 min-w-7 items-center justify-center rounded-md px-1 text-xs font-semibold', tone)}>
        {item.value}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.label}</p>
        <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
      </div>
      {canAccessPath(session, item.href) ? <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
    </div>
  );

  return canAccessPath(session, item.href) ? <Link href={item.href}>{content}</Link> : content;
}

function ActivityCard({ activity, session }: { activity: ActivityFeedItem[]; session: AuthSession }) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Trazabilidad</p>
          <CardTitle className="mt-2">Actividad reciente</CardTitle>
          <CardDescription className="mt-1">Compras, créditos, pagos y operación del equipo.</CardDescription>
        </div>
        {canAccessPath(session, '/operations/logs') ? (
          <Button asChild variant="ghost" size="sm" className="-mr-2 text-accent hover:text-accent">
            <Link href="/operations/logs">Ver logs</Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {activity.length ? (
          <div className="divide-y divide-border">
            {activity.map((item) => {
              const content = (
                <div className="flex min-w-0 items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', item.tone)}>
                    <item.icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.label}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <p className="shrink-0 text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</p>
                </div>
              );

              return item.href && canAccessPath(session, item.href) ? (
                <Link key={item.id} href={item.href} className="block rounded-md px-1 transition hover:bg-muted/55">
                  {content}
                </Link>
              ) : (
                <div key={item.id}>{content}</div>
              );
            })}
          </div>
        ) : (
          <EmptyState message="Todavía no hay actividad registrada para mostrar." />
        )}
      </CardContent>
    </Card>
  );
}

function RecentInvoicesCard({
  invoices,
  session,
}: {
  invoices: DashboardSummary['recentInvoices'];
  session: AuthSession;
}) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Documentos</p>
          <CardTitle className="mt-2">Facturas recientes</CardTitle>
          <CardDescription className="mt-1">Las últimas ventas registradas en la empresa.</CardDescription>
        </div>
        {canAccessPath(session, '/invoices') ? (
          <Button asChild variant="ghost" size="sm" className="-mr-2 text-accent hover:text-accent">
            <Link href="/invoices">Ver todas</Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {invoices.length ? (
          <div className="space-y-2">
            {invoices.map((invoice) => {
              const content = (
                <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-2.5 transition hover:border-primary/25 hover:bg-muted/45">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/8 text-primary">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{invoice.invoiceNumber}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {invoice.customerName} · {formatDate(invoice.issuedAt ?? invoice.createdAt)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold">{formatCurrency(invoice.total)}</p>
                    <Badge className="mt-1" variant={getStatusVariant(invoice.status)}>
                      {translateStatus(invoice.status)}
                    </Badge>
                  </div>
                </div>
              );

              return canAccessPath(session, `/invoices/${invoice.id}`) ? (
                <Link key={invoice.id} href={`/invoices/${invoice.id}`}>
                  {content}
                </Link>
              ) : (
                <div key={invoice.id}>{content}</div>
              );
            })}
          </div>
        ) : (
          <EmptyState message="Todavía no hay facturas registradas." />
        )}
      </CardContent>
    </Card>
  );
}

function ProductPerformanceCard({
  topSellingProducts,
  leastSellingProducts,
  loading,
}: {
  topSellingProducts: ProductSalesMetric[];
  leastSellingProducts: ProductSalesMetric[];
  loading: boolean;
}) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Productos</p>
          <CardTitle className="mt-2">Rendimiento del catálogo</CardTitle>
          <CardDescription className="mt-1">Ranking histórico por cantidad facturada.</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm" className="-mr-2 text-accent hover:text-accent">
          <Link href="/dashboard/productos-vendidos">Ver ranking</Link>
        </Button>
      </CardHeader>
      <CardContent className="grid gap-5 sm:grid-cols-2">
        <ProductList
          title="Más vendidos"
          products={topSellingProducts}
          icon={TrendingUp}
          emptyMessage={loading ? 'Calculando ventas...' : 'Aún no hay ventas para calcular este ranking.'}
        />
        <ProductList
          title="Menos vendidos"
          products={leastSellingProducts}
          icon={TrendingDown}
          emptyMessage={loading ? 'Calculando ventas...' : 'No hay productos activos para revisar.'}
        />
      </CardContent>
    </Card>
  );
}

function ProductList({
  title,
  products,
  icon: Icon,
  emptyMessage,
}: {
  title: string;
  products: ProductSalesMetric[];
  icon: LucideIcon;
  emptyMessage: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-accent" />
        <p className="text-sm font-semibold">{title}</p>
      </div>
      {products.length ? (
        <div className="space-y-1">
          {products.map((product, index) => (
            <Link
              key={product.productId}
              href={`/products?q=${encodeURIComponent(product.sku ?? product.name)}`}
              className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-muted/65"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{product.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {product.sku ?? 'Sin SKU'} · {translateProductUnit(product.unit)}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold">{formatQuantity(product.quantitySold)}</span>
                <span className="block text-[11px] text-muted-foreground">{formatCurrency(product.grossAmount)}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm leading-5 text-muted-foreground">{emptyMessage}</p>
      )}
    </div>
  );
}

function ControlAlertsCard({ summary, session }: { summary: DashboardSummary; session: AuthSession }) {
  const alerts = [
    {
      label: 'Productos bajo mínimo',
      value: summary.lowStockProducts,
      detail: `${summary.activeProducts} productos activos`,
      href: '/products',
      tone: summary.lowStockProducts ? 'danger' : 'success',
      icon: AlertTriangle,
    },
    {
      label: 'Secuencias fiscales',
      value: summary.fiscalSequenceAlerts.length,
      detail: summary.fiscalSequenceAlerts.length ? 'Requieren atención' : 'Sin alertas activas',
      href: '/settings/fiscal-sequences',
      tone: summary.fiscalSequenceAlerts.length ? 'warning' : 'success',
      icon: FileText,
    },
    {
      label: 'Clientes activos',
      value: summary.activeCustomers,
      detail: `${summary.employeeSummary.activeEmployees} usuarios operativos`,
      href: '/customers',
      tone: 'neutral',
      icon: Users,
    },
  ] as const;

  return (
    <Card className="rounded-xl">
      <CardHeader>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">Control</p>
        <CardTitle className="mt-2">Alertas y seguimiento</CardTitle>
        <CardDescription className="mt-1">Una lectura rápida de inventario, documentos fiscales y usuarios.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.map((alert) => {
          const Icon = alert.icon;
          const tone =
            alert.tone === 'danger'
              ? 'bg-danger/10 text-danger'
              : alert.tone === 'warning'
                ? 'bg-warning/12 text-warning'
                : alert.tone === 'success'
                  ? 'bg-success/10 text-success'
                  : 'bg-muted text-foreground';
          const content = (
            <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border px-3 py-3 transition hover:border-primary/25 hover:bg-muted/45">
              <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', tone)}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{alert.label}</p>
                <p className="truncate text-xs text-muted-foreground">{alert.detail}</p>
              </div>
              <span className="text-lg font-semibold">{alert.value}</span>
              {canAccessPath(session, alert.href) ? <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : null}
            </div>
          );

          return canAccessPath(session, alert.href) ? (
            <Link key={alert.label} href={alert.href}>
              {content}
            </Link>
          ) : (
            <div key={alert.label}>{content}</div>
          );
        })}

        {summary.recentInventoryAlerts.length ? (
          <div className="pt-1">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Con menor disponibilidad</p>
            <div className="space-y-1">
              {summary.recentInventoryAlerts.slice(0, 3).map((product) => (
                <Link
                  key={product.id}
                  href={`/products?q=${encodeURIComponent(product.sku ?? product.name)}`}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition hover:bg-muted/65"
                >
                  <span className="min-w-0 truncate">{product.name}</span>
                  <span className="shrink-0 text-xs font-semibold text-danger">
                    {formatQuantity(Math.max(product.stock - product.reservedStock, 0))}/{formatQuantity(product.minStock)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-7 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

type ActivityFeedItem = {
  id: string;
  label: string;
  description: string;
  createdAt: string;
  href: string | null;
  icon: LucideIcon;
  tone: string;
};

function buildActivityFeed(summary: DashboardSummary): ActivityFeedItem[] {
  const auditItems: ActivityFeedItem[] = (summary.recentAuditActivity ?? []).map((item) => ({
    id: `audit-${item.id}`,
    label: translateAuditAction(item.action),
    description: `${item.userName ?? 'Usuario'} · ${translateDashboardEntity(item.entity)}`,
    createdAt: item.createdAt,
    href: getAuditActivityHref(item.entity, item.action),
    icon: getActivityIcon(item.entity),
    tone: getActivityTone(item.entity),
  }));
  const employeeItems: ActivityFeedItem[] = summary.recentEmployeeLogs.map((log) => ({
    id: `employee-${log.id}`,
    label: `${log.employeeName ?? 'Empleado'} ${translateEmployeeAction(log.action)}`,
    description: `${translateEntity(log.entity)}${log.invoiceNumber ? ` · ${log.invoiceNumber}` : ''}`,
    createdAt: log.createdAt,
    href: getEmployeeActivityHref(log.action, log.entity),
    icon: getActivityIcon(log.entity),
    tone: getActivityTone(log.entity),
  }));

  return [...auditItems, ...employeeItems].sort(
    (first, second) => new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime(),
  );
}

function getActivityIcon(entity: string): LucideIcon {
  if (entity === 'SupplierInvoice' || entity === 'SupplierInvoiceAttachment') return FileText;
  if (entity === 'SupplierPayment' || entity === 'Payment') return Wallet;
  if (entity === 'CreditSaleApproval') return CreditCard;
  if (entity === 'GoodsReceipt') return PackageCheck;
  if (entity === 'PurchaseOrder') return ShoppingBag;
  if (entity === 'CashSession' || entity === 'CashMovement') return Landmark;
  if (entity === 'SalesOrder') return ShoppingCart;
  if (entity === 'ReturnRequest') return RotateCcw;
  return Activity;
}

function getActivityTone(entity: string) {
  if (entity === 'SupplierInvoice' || entity === 'SupplierInvoiceAttachment') return 'bg-violet-500/10 text-violet-700';
  if (entity === 'SupplierPayment' || entity === 'Payment') return 'bg-orange-500/10 text-orange-700';
  if (entity === 'CreditSaleApproval') return 'bg-rose-500/10 text-rose-700';
  if (entity === 'GoodsReceipt') return 'bg-cyan-500/10 text-cyan-700';
  if (entity === 'PurchaseOrder') return 'bg-sky-500/10 text-sky-700';
  if (entity === 'CashSession' || entity === 'CashMovement') return 'bg-emerald-500/10 text-emerald-700';
  return 'bg-primary/8 text-primary';
}

function getAuditActivityHref(entity: string, action: string) {
  if (entity === 'SupplierInvoice' || entity === 'SupplierInvoiceAttachment') return '/supplier-invoices';
  if (entity === 'SupplierPayment') return '/payables';
  if (entity === 'CreditSaleApproval') return '/credit-approvals';
  if (entity === 'GoodsReceipt') return '/supplier-invoices';
  if (entity === 'PurchaseOrder') return '/purchase-orders';
  if (entity === 'Payment' && action.startsWith('RECEIVABLE_')) return '/receivables';
  if (entity === 'Product') return '/products';
  return null;
}

function getEmployeeActivityHref(action: string, entity: string) {
  if (entity === 'CashSession' || entity === 'CashMovement' || action.includes('CASH')) return '/cash/logs';
  if (entity === 'Product' || entity === 'InventoryMovement') return '/products';
  if (entity === 'ReturnRequest') return '/returns';
  if (entity === 'Invoice') return '/invoices';
  if (entity === 'SalesOrder') return '/operations/logs';
  return null;
}

function translateAuditAction(action: string) {
  const labels: Record<string, string> = {
    SUPPLIER_INVOICE_ATTACHMENT_UPLOADED: 'Adjuntó un documento de suplidor',
    SUPPLIER_INVOICE_CREATED: 'Creó una factura de suplidor',
    SUPPLIER_INVOICE_UPDATED: 'Actualizó una factura de suplidor',
    SUPPLIER_INVOICE_REGISTERED: 'Registró una factura de suplidor',
    SUPPLIER_INVOICE_CANCELLED: 'Canceló una factura de suplidor',
    SUPPLIER_PAYMENT_REGISTERED: 'Registró un pago a suplidor',
    SUPPLIER_PAYMENT_CANCELLED: 'Canceló un pago a suplidor',
    GOODS_RECEIPT_CREATED: 'Creó una entrada de mercancía',
    GOODS_RECEIPT_UPDATED: 'Actualizó una entrada de mercancía',
    GOODS_RECEIPT_CONFIRMED: 'Confirmó una entrada de mercancía',
    GOODS_RECEIPT_CANCELLED: 'Canceló una entrada de mercancía',
    GOODS_RECEIPT_REVERSED: 'Revirtió una entrada de mercancía',
    PRODUCT_COST_PRICE_DECISION_RECORDED: 'Registró una decisión de costo y precio',
    RECEIVABLE_PAYMENT_CREATED: 'Registró un abono de cliente',
    RECEIVABLE_PAYMENT_CANCELLED: 'Canceló un abono de cliente',
    CREDIT_SALE_APPROVED: 'Aprobó una venta fiada',
    CREDIT_SALE_REJECTED: 'Rechazó una venta fiada',
    CREDIT_SALE_EXPIRED: 'Venció una solicitud de crédito',
  };

  return labels[action] ?? humanize(action);
}

function translateDashboardEntity(entity: string) {
  const labels: Record<string, string> = {
    SupplierInvoice: 'Factura de suplidor',
    SupplierInvoiceAttachment: 'Documento de suplidor',
    SupplierPayment: 'Pago a suplidor',
    GoodsReceipt: 'Entrada de mercancía',
    CreditSaleApproval: 'Aprobación de crédito',
    PurchaseOrder: 'Orden de compra',
    Payment: 'Pago',
  };

  return labels[entity] ?? translateEntity(entity);
}

function buildDueDetail(count: number, balance: number, gender: 'vencida' | 'vencido') {
  if (!count) {
    return 'Sin saldo vencido';
  }

  return `${count} ${count === 1 ? gender : gender === 'vencida' ? 'vencidas' : 'vencidos'} · ${formatCurrency(balance)}`;
}

function formatCompactCurrency(value: number) {
  if (Math.abs(value) >= 1_000_000) return `RD$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `RD$${(value / 1_000).toFixed(0)}k`;
  return `RD$${Math.round(value)}`;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <Card className="rounded-xl">
        <CardContent className="h-36 p-5 sm:p-6">
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="mt-4 h-8 w-64 max-w-full rounded bg-muted" />
          <div className="mt-3 h-4 w-96 max-w-full rounded bg-muted" />
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="rounded-xl">
            <CardContent className="p-5">
              <div className="h-4 w-28 rounded bg-muted" />
              <div className="mt-4 h-7 w-36 rounded bg-muted" />
              <div className="mt-3 h-3 w-24 rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.55fr_0.85fr]">
        <Card className="h-80 rounded-xl" />
        <Card className="h-80 rounded-xl" />
      </div>
    </div>
  );
}
