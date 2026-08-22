'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell, Building2, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { clearSession, getSession, type AuthSession } from '@/lib/auth-session';
import { canAccessPath, getDefaultPathForSession, isAdminSession } from '@/lib/authorization';
import {
  getCurrentCashSession,
  getOperationalAlerts,
  getTaxIdentityApprovalRequests,
  type OperationalAlertsSummary,
} from '@/lib/api';
import { translateInvoiceDocumentType, translateRole } from '@/lib/display-labels';
import { cn, formatCurrency, formatDateOnly } from '@/lib/utils';
import { GlobalSearch } from './global-search';
import { MobileNavigation, Sidebar } from './sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const surfacedAlertTransitionsRef = useRef(new Set<string>());
  const surfacedFiscalApprovalIdsRef = useRef(new Set<string>());
  const fiscalApprovalBaselineReadyRef = useRef(false);
  const pathname = usePathname();
  const router = useRouter();

  const operationalAlertsQuery = useQuery({
    queryKey: ['operational-alerts', session?.tenantId],
    queryFn: () => getOperationalAlerts(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session && canAccessPath(session, '/dashboard')),
    refetchInterval: 120_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });
  const currentCashSessionQuery = useQuery({
    queryKey: ['cash-session-current', session?.tenantId, 'logout-guard'],
    queryFn: () => getCurrentCashSession(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const fiscalApprovalsQuery = useQuery({
    queryKey: ['tax-identity-approval-requests', session?.tenantId, 'PENDING', 'notification'],
    queryFn: () =>
      getTaxIdentityApprovalRequests(session?.tenantId ?? '', session?.accessToken ?? '', {
        status: 'PENDING',
      }),
    enabled: Boolean(session && isAdminSession(session)),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });

  useEffect(() => {
    const currentSession = getSession();
    setSession(currentSession);

    if (!currentSession) {
      const nextPath = `${pathname}${window.location.search}`;
      router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
      return;
    }

    if (!canAccessPath(currentSession, pathname)) {
      router.replace(getDefaultPathForSession(currentSession));
    }
  }, [pathname, router]);

  useEffect(() => {
    const cashSessionOpen = currentCashSessionQuery.data?.status === 'OPEN';

    if (!session || !cashSessionOpen) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [currentCashSessionQuery.data?.status, session]);

  useEffect(() => {
    setNotificationsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!session || !operationalAlertsQuery.data) {
      return;
    }

    surfaceNewOperationalAlerts({
      summary: operationalAlertsQuery.data,
      session,
      surfacedTransitions: surfacedAlertTransitionsRef.current,
      navigate: (href) => router.push(href),
    });
  }, [operationalAlertsQuery.data, router, session]);

  useEffect(() => {
    fiscalApprovalBaselineReadyRef.current = false;
    surfacedFiscalApprovalIdsRef.current.clear();
  }, [session?.tenantId, session?.user.id]);

  useEffect(() => {
    if (!session || !isAdminSession(session) || !fiscalApprovalsQuery.data) {
      return;
    }

    if (!fiscalApprovalBaselineReadyRef.current) {
      readSeenFiscalApprovalIds(session).forEach((requestId) =>
        surfacedFiscalApprovalIdsRef.current.add(requestId),
      );
      fiscalApprovalBaselineReadyRef.current = true;
    }

    const newRequests = fiscalApprovalsQuery.data.filter(
      (request) => !surfacedFiscalApprovalIdsRef.current.has(request.id),
    );
    fiscalApprovalsQuery.data.forEach((request) =>
      surfacedFiscalApprovalIdsRef.current.add(request.id),
    );
    persistSeenFiscalApprovalIds(session, surfacedFiscalApprovalIdsRef.current);
    if (!newRequests.length) return;

    toast.warning(
      newRequests.length === 1
        ? 'Nueva validación fiscal pendiente'
        : `${newRequests.length} validaciones fiscales pendientes`,
      {
        description:
          newRequests.length === 1
            ? `${newRequests[0].requestedBy.name} solicita revisar ${newRequests[0].documentType}.`
            : 'Caja, Clientes o Suplidores esperan una decisión administrativa.',
        duration: 10_000,
        action: {
          label: 'Revisar',
          onClick: () => router.push('/tax-identity-approvals'),
        },
      },
    );
  }, [fiscalApprovalsQuery.data, router, session]);

  async function handleLogout() {
    if (!session) {
      clearSession();
      router.replace('/login');
      return;
    }

    try {
      const currentCashSession = await getCurrentCashSession(session.tenantId, session.accessToken);

      if (currentCashSession?.status === 'OPEN') {
        toast.warning('Debes cerrar la caja antes de salir.', {
          description: `${currentCashSession.cashRegister.name} sigue abierta con fondo inicial ${formatCurrency(Number(currentCashSession.openingAmount))}.`,
        });
        router.push(
          canAccessPath(session, '/cash/sessions')
            ? '/cash/sessions'
            : getDefaultPathForSession(session),
        );
        return;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No pude validar el estado de la caja.');
      return;
    }

    clearSession();
    toast.success('Sesion cerrada correctamente.');
    router.replace('/login');
  }

  if (session === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-zinc-100 px-4">
        <div className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm">
          Validando sesion...
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="grid min-h-screen place-items-center bg-zinc-100 px-4">
        <div className="rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm text-muted-foreground shadow-sm">
          Redirigiendo al login...
        </div>
      </div>
    );
  }

  const canViewOperationalAlerts = canAccessPath(session, '/dashboard');
  const pendingFiscalApprovalCount = fiscalApprovalsQuery.data?.length ?? 0;
  const activeAlertCount = countActiveAlerts(
    operationalAlertsQuery.data,
    pendingFiscalApprovalCount,
  );

  return (
    <div className="min-h-screen bg-zinc-100">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((current) => !current)}
      />

      <div
        className={cn(
          'min-h-screen pb-24 transition-[padding] duration-200 lg:pb-0',
          sidebarCollapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-72',
          'print:pb-0 print:pl-0',
        )}
      >
        <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur print:hidden">
          <div className="flex h-16 items-center justify-between gap-3 px-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="hidden h-9 w-9 items-center justify-center rounded-md bg-[#f36c10]/10 text-[#f36c10] sm:flex">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">Ferreteria RIVNU</p>
                  <p className="truncate text-xs text-muted-foreground">Operacion del cliente</p>
                </div>
              </div>
            </div>

            <GlobalSearch session={session} />

            <div className="relative flex shrink-0 items-center gap-2">
              {canViewOperationalAlerts ? (
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      activeAlertCount
                        ? `${activeAlertCount} alertas operativas activas`
                        : 'Sin alertas operativas activas'
                    }
                    aria-expanded={notificationsOpen}
                    aria-controls="operational-alerts-panel"
                    className="relative"
                    onClick={() => setNotificationsOpen((current) => !current)}
                  >
                    <Bell className="h-5 w-5" />
                    {activeAlertCount ? (
                      <span className="absolute -right-0.5 -top-0.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] font-bold leading-none text-white ring-2 ring-white">
                        {activeAlertCount > 9 ? '9+' : activeAlertCount}
                      </span>
                    ) : null}
                  </Button>
                  {notificationsOpen ? (
                    <NotificationsPanel
                      summary={operationalAlertsQuery.data}
                      pendingFiscalApprovalCount={pendingFiscalApprovalCount}
                      session={session}
                      loading={operationalAlertsQuery.isLoading || fiscalApprovalsQuery.isLoading}
                      failed={operationalAlertsQuery.isError || fiscalApprovalsQuery.isError}
                      onClose={() => setNotificationsOpen(false)}
                    />
                  ) : null}
                </div>
              ) : null}
              <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 sm:px-3">
                <div className="h-8 w-8 rounded-md bg-primary text-center text-sm font-semibold leading-8 text-primary-foreground">
                  {session?.user.name.slice(0, 2).toUpperCase() ?? 'RV'}
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium">{session?.user.name ?? 'Ferreteria RIVNU'}</p>
                  <p className="text-xs text-muted-foreground">
                    {translateRole(session?.role) ?? 'Operacion'}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Cerrar sesion"
                onClick={handleLogout}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[92rem] px-3 py-4 print:max-w-none print:p-0 sm:px-6 sm:py-6">
          {children}
        </main>
      </div>

      <MobileNavigation />
    </div>
  );
}

type FiscalSequenceAlert = OperationalAlertsSummary['fiscalSequenceAlerts'][number];
type AlertSeverity = FiscalSequenceAlert['severity'];

type PopupAlert = {
  id: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  href: string;
};

const alertTransitionStoragePrefix = 'rivnu:operational-alert-transitions:v1';
const fiscalApprovalSeenStoragePrefix = 'rivnu:fiscal-approval-seen:v1';

function fiscalApprovalSeenStorageKey(session: AuthSession) {
  return `${fiscalApprovalSeenStoragePrefix}:${session.tenantId}:${session.user.id}`;
}

function readSeenFiscalApprovalIds(session: AuthSession) {
  try {
    const raw = window.sessionStorage.getItem(fiscalApprovalSeenStorageKey(session));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string').slice(-200)
      : [];
  } catch {
    return [];
  }
}

function persistSeenFiscalApprovalIds(session: AuthSession, requestIds: Set<string>) {
  try {
    window.sessionStorage.setItem(
      fiscalApprovalSeenStorageKey(session),
      JSON.stringify([...requestIds].slice(-200)),
    );
  } catch {
    // The badge remains accurate even when session storage is unavailable.
  }
}

function NotificationsPanel({
  summary,
  pendingFiscalApprovalCount,
  session,
  loading,
  failed,
  onClose,
}: {
  summary: OperationalAlertsSummary | undefined;
  pendingFiscalApprovalCount: number;
  session: AuthSession;
  loading: boolean;
  failed: boolean;
  onClose: () => void;
}) {
  const notifications = [
    {
      id: 'pending-tax-identity-approvals',
      label: 'Validaciones fiscales',
      description: 'Solicitudes manuales pendientes de decisión administrativa.',
      value: pendingFiscalApprovalCount,
      href: '/tax-identity-approvals',
      tone: 'warning',
    },
    {
      id: 'pending-invoices',
      label: 'Facturas pendientes',
      description: 'Documentos que todavía requieren seguimiento.',
      value: summary?.pendingInvoices ?? 0,
      href: '/invoices',
      tone: 'warning',
    },
    {
      id: 'low-stock-products',
      label: 'Productos bajo stock',
      description: 'Productos en o por debajo de su mínimo.',
      value: summary?.lowStockProducts ?? 0,
      href: '/products?stock=LOW&status=ACTIVE',
      tone: 'danger',
    },
    {
      id: 'open-cash-sessions',
      label: 'Cajas abiertas',
      description: 'Sesiones que permanecen abiertas.',
      value: summary?.openCashSessions ?? 0,
      href: '/cash/sessions',
      tone: 'warning',
    },
  ].filter((notification) => notification.value > 0);
  const fiscalSequenceAlerts = summary?.fiscalSequenceAlerts ?? [];
  const activeAlertCount = countActiveAlerts(summary, pendingFiscalApprovalCount);

  return (
    <div
      id="operational-alerts-panel"
      className="fixed inset-x-3 top-[4.5rem] z-50 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[25rem]"
      role="region"
      aria-label="Alertas operativas"
    >
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-zinc-100 pb-3">
        <div>
          <p className="text-sm font-semibold">Alertas operativas</p>
          <p className="text-xs text-muted-foreground">
            {activeAlertCount
              ? `${activeAlertCount} ${activeAlertCount === 1 ? 'alerta activa' : 'alertas activas'}`
              : 'Todo está bajo control'}
          </p>
        </div>
        <button
          type="button"
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-zinc-100 hover:text-foreground"
          onClick={onClose}
        >
          Cerrar
        </button>
      </div>

      {loading && !summary && !pendingFiscalApprovalCount ? (
        <p className="rounded-lg bg-zinc-50 px-3 py-3 text-sm text-muted-foreground">
          Cargando alertas...
        </p>
      ) : failed && !summary && !pendingFiscalApprovalCount ? (
        <p className="rounded-lg border border-danger/20 bg-danger/5 px-3 py-3 text-sm text-danger">
          No se pudieron actualizar las alertas. Intentaremos nuevamente en breve.
        </p>
      ) : activeAlertCount ? (
        <div className="space-y-3">
          {notifications.length ? (
            <div className="space-y-2">
              {notifications.map((notification) => (
                <Link
                  key={notification.id}
                  href={notification.href}
                  onClick={onClose}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm transition hover:border-zinc-300 hover:bg-zinc-50"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{notification.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {notification.description}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold',
                      notification.tone === 'danger'
                        ? 'bg-danger/10 text-danger'
                        : 'bg-warning/10 text-warning',
                    )}
                  >
                    {notification.value}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}

          {fiscalSequenceAlerts.length ? (
            <div className="space-y-2 border-t border-zinc-100 pt-3">
              <p className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Secuencias fiscales
              </p>
              {fiscalSequenceAlerts.map((sequence) => (
                <FiscalSequenceAlertItem
                  key={sequence.id}
                  sequence={sequence}
                  href={getFiscalSequenceHref(session)}
                  onNavigate={onClose}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-success/20 bg-success/5 px-3 py-4 text-sm text-success">
          No hay alertas que requieran atención ahora mismo.
        </div>
      )}
    </div>
  );
}

function FiscalSequenceAlertItem({
  sequence,
  href,
  onNavigate,
}: {
  sequence: FiscalSequenceAlert;
  href: string;
  onNavigate: () => void;
}) {
  const critical = sequence.severity === 'CRITICAL';
  const availablePercentage = sequence.authorizedCount
    ? Math.min(100, Math.max(0, (sequence.remaining / sequence.authorizedCount) * 100))
    : 0;

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        'block rounded-lg border px-3 py-3 text-sm transition hover:bg-zinc-50',
        critical ? 'border-danger/25' : 'border-warning/30',
      )}
    >
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block truncate font-semibold">
            {translateInvoiceDocumentType(sequence.documentType)} · {sequence.prefix}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
            {describeFiscalSequenceAlert(sequence)}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded-md px-2 py-0.5 text-[0.6875rem] font-semibold',
            critical ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning',
          )}
        >
          {critical ? 'Crítica' : 'Atención'}
        </span>
      </span>

      {sequence.status === 'ACTIVE' ? (
        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-zinc-100">
          <span
            className={cn('block h-full rounded-full', critical ? 'bg-danger' : 'bg-warning')}
            style={{ width: `${availablePercentage}%` }}
          />
        </span>
      ) : null}

      <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
        {sequence.status !== 'MISSING' ? (
          <span>Alerta desde {sequence.alertThreshold} restantes</span>
        ) : null}
        {sequence.validUntil ? <span>Vence {formatDateOnly(sequence.validUntil)}</span> : null}
        {sequence.hasQueuedReplacement ? (
          <span className="font-medium text-success">Reemplazo registrado</span>
        ) : null}
      </span>
    </Link>
  );
}

function countActiveAlerts(
  summary: OperationalAlertsSummary | undefined,
  pendingFiscalApprovalCount = 0,
) {
  return (
    Number(pendingFiscalApprovalCount > 0) +
    Number((summary?.pendingInvoices ?? 0) > 0) +
    Number((summary?.lowStockProducts ?? 0) > 0) +
    Number((summary?.openCashSessions ?? 0) > 0) +
    (summary?.fiscalSequenceAlerts.length ?? 0)
  );
}

function describeFiscalSequenceAlert(sequence: FiscalSequenceAlert) {
  if (sequence.status === 'MISSING') {
    return 'No hay una autorización registrada para este tipo de comprobante.';
  }

  if (sequence.status === 'EXHAUSTED' || sequence.remaining <= 0) {
    return sequence.hasQueuedReplacement
      ? 'Esta autorización se agotó; ya hay un reemplazo registrado.'
      : 'Esta autorización se agotó y necesita un nuevo rango.';
  }

  if (sequence.status === 'EXPIRED') {
    return sequence.hasQueuedReplacement
      ? 'Esta autorización venció; ya hay un reemplazo registrado.'
      : 'Esta autorización venció y necesita un nuevo rango.';
  }

  return `${sequence.remaining} de ${sequence.authorizedCount} comprobantes disponibles.`;
}

function getFiscalSequenceHref(session: AuthSession) {
  return canAccessPath(session, '/settings/fiscal-sequences')
    ? '/settings/fiscal-sequences'
    : '/dashboard';
}

function surfaceNewOperationalAlerts({
  summary,
  session,
  surfacedTransitions,
  navigate,
}: {
  summary: OperationalAlertsSummary;
  session: AuthSession;
  surfacedTransitions: Set<string>;
  navigate: (href: string) => void;
}) {
  const alerts = buildPopupAlerts(summary, session);
  const storageKey = `${alertTransitionStoragePrefix}:${session.tenantId}:${session.user.id}`;
  const previousTransitions = readAlertTransitions(storageKey);
  const activeTransitions: Record<string, AlertSeverity> = {};
  const newAlerts: PopupAlert[] = [];
  const activeTransitionKeys = new Set(
    alerts.map((alert) => `${storageKey}:${alert.id}:${alert.severity}`),
  );

  for (const transitionKey of surfacedTransitions) {
    if (transitionKey.startsWith(`${storageKey}:`) && !activeTransitionKeys.has(transitionKey)) {
      surfacedTransitions.delete(transitionKey);
    }
  }

  for (const alert of alerts) {
    activeTransitions[alert.id] = alert.severity;
    const transitionKey = `${storageKey}:${alert.id}:${alert.severity}`;

    if (
      previousTransitions[alert.id] !== alert.severity &&
      !surfacedTransitions.has(transitionKey)
    ) {
      surfacedTransitions.add(transitionKey);
      newAlerts.push(alert);
    }
  }

  writeAlertTransitions(storageKey, activeTransitions);

  if (!newAlerts.length) {
    return;
  }

  newAlerts.sort(
    (left, right) => Number(right.severity === 'CRITICAL') - Number(left.severity === 'CRITICAL'),
  );

  if (newAlerts.length === 1) {
    showOperationalToast(newAlerts[0], storageKey, navigate);
    return;
  }

  const critical = newAlerts.some((alert) => alert.severity === 'CRITICAL');
  const listedAlerts = newAlerts
    .slice(0, 2)
    .map((alert) => alert.title)
    .join(' · ');
  const remainingCount = newAlerts.length - 2;
  const description =
    remainingCount > 0 ? `${listedAlerts} · y ${remainingCount} más` : listedAlerts;
  const toastOptions = {
    id: `${storageKey}:summary:${newAlerts.map((alert) => `${alert.id}-${alert.severity}`).join('|')}`,
    description,
    duration: 10_000,
    action: {
      label: 'Revisar',
      onClick: () => navigate('/dashboard'),
    },
  };

  if (critical) {
    toast.error(`${newAlerts.length} alertas operativas requieren atención`, toastOptions);
  } else {
    toast.warning(`${newAlerts.length} alertas operativas nuevas`, toastOptions);
  }
}

function buildPopupAlerts(summary: OperationalAlertsSummary, session: AuthSession) {
  const alerts: PopupAlert[] = [];

  if (summary.pendingInvoices > 0) {
    alerts.push({
      id: 'pending-invoices',
      severity: 'WARNING',
      title: `${summary.pendingInvoices} ${summary.pendingInvoices === 1 ? 'factura pendiente' : 'facturas pendientes'}`,
      description: 'Hay documentos que todavía requieren seguimiento.',
      href: '/invoices',
    });
  }

  if (summary.lowStockProducts > 0) {
    alerts.push({
      id: 'low-stock-products',
      severity: 'WARNING',
      title: `${summary.lowStockProducts} ${summary.lowStockProducts === 1 ? 'producto bajo mínimo' : 'productos bajo mínimo'}`,
      description: 'Revisa el inventario para evitar faltantes.',
      href: '/products?stock=LOW&status=ACTIVE',
    });
  }

  if (summary.openCashSessions > 0) {
    alerts.push({
      id: 'open-cash-sessions',
      severity: 'WARNING',
      title: `${summary.openCashSessions} ${summary.openCashSessions === 1 ? 'caja abierta' : 'cajas abiertas'}`,
      description: 'Hay sesiones de caja que permanecen abiertas.',
      href: '/cash/sessions',
    });
  }

  for (const sequence of summary.fiscalSequenceAlerts) {
    alerts.push({
      id: `fiscal-sequence:${sequence.id}`,
      severity: sequence.severity,
      title:
        sequence.status === 'MISSING'
          ? `Falta configurar la secuencia ${sequence.prefix}`
          : sequence.status === 'EXHAUSTED' || sequence.remaining <= 0
            ? `Secuencia ${sequence.prefix} agotada`
            : sequence.status === 'EXPIRED'
              ? `Secuencia ${sequence.prefix} vencida`
              : `Quedan ${sequence.remaining} NCF de ${sequence.prefix}`,
      description: describeFiscalSequenceAlert(sequence),
      href: getFiscalSequenceHref(session),
    });
  }

  return alerts;
}

function showOperationalToast(
  alert: PopupAlert,
  storageKey: string,
  navigate: (href: string) => void,
) {
  const options = {
    id: `${storageKey}:${alert.id}:${alert.severity}`,
    description: alert.description,
    duration: 10_000,
    action: {
      label: 'Revisar',
      onClick: () => navigate(alert.href),
    },
  };

  if (alert.severity === 'CRITICAL') {
    toast.error(alert.title, options);
  } else {
    toast.warning(alert.title, options);
  }
}

function readAlertTransitions(storageKey: string): Record<string, AlertSeverity> {
  try {
    const rawValue = window.localStorage.getItem(storageKey);

    if (!rawValue) {
      return {};
    }

    const parsedValue = JSON.parse(rawValue) as Record<string, unknown>;

    return Object.fromEntries(
      Object.entries(parsedValue).filter(
        (entry): entry is [string, AlertSeverity] =>
          entry[1] === 'WARNING' || entry[1] === 'CRITICAL',
      ),
    );
  } catch {
    return {};
  }
}

function writeAlertTransitions(storageKey: string, transitions: Record<string, AlertSeverity>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(transitions));
  } catch {
    // The in-memory set still prevents repeated toasts while this shell is mounted.
  }
}
