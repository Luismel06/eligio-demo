'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell, Building2, LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { clearSession, getSession, type AuthSession } from '@/lib/auth-session';
import { canAccessPath, getDefaultPathForSession } from '@/lib/authorization';
import { getCurrentCashSession, getDashboardSummary } from '@/lib/api';
import { translateRole } from '@/lib/display-labels';
import { cn, formatCurrency } from '@/lib/utils';
import { GlobalSearch } from './global-search';
import { MobileNavigation, Sidebar } from './sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const pathname = usePathname();
  const router = useRouter();

  const summaryQuery = useQuery({
    queryKey: ['dashboard-summary', session?.tenantId, 'layout'],
    queryFn: () => getDashboardSummary(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session && canAccessPath(session, '/dashboard')),
  });
  const currentCashSessionQuery = useQuery({
    queryKey: ['cash-session-current', session?.tenantId, 'logout-guard'],
    queryFn: () => getCurrentCashSession(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
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
        router.push(canAccessPath(session, '/cash/sessions') ? '/cash/sessions' : getDefaultPathForSession(session));
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

  return (
    <div className="min-h-screen bg-zinc-100">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((current) => !current)} />

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
              <Button
                variant="ghost"
                size="icon"
                aria-label="Notificaciones"
                className="hidden sm:inline-flex"
                onClick={() => setNotificationsOpen((current) => !current)}
              >
                <Bell className="h-5 w-5" />
              </Button>
              {notificationsOpen ? (
                <NotificationsPanel
                  pendingInvoices={summaryQuery.data?.pendingInvoices ?? 0}
                  lowStockProducts={summaryQuery.data?.lowStockProducts ?? 0}
                  openCashSessions={summaryQuery.data?.openCashSessions ?? 0}
                  loading={summaryQuery.isLoading}
                  onClose={() => setNotificationsOpen(false)}
                />
              ) : null}
              <div className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 sm:px-3">
                <div className="h-8 w-8 rounded-md bg-primary text-center text-sm font-semibold leading-8 text-primary-foreground">
                  {session?.user.name.slice(0, 2).toUpperCase() ?? 'RV'}
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium">{session?.user.name ?? 'Ferreteria RIVNU'}</p>
                  <p className="text-xs text-muted-foreground">{translateRole(session?.role) ?? 'Operacion'}</p>
                </div>
              </div>
              <Button variant="outline" size="icon" aria-label="Cerrar sesion" onClick={handleLogout}>
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

function NotificationsPanel({
  pendingInvoices,
  lowStockProducts,
  openCashSessions,
  loading,
  onClose,
}: {
  pendingInvoices: number;
  lowStockProducts: number;
  openCashSessions: number;
  loading: boolean;
  onClose: () => void;
}) {
  const notifications = [
    {
      label: 'Facturas pendientes',
      value: pendingInvoices,
      href: '/invoices',
    },
    {
      label: 'Productos bajo stock',
      value: lowStockProducts,
      href: '/products',
    },
    {
      label: 'Cajas abiertas',
      value: openCashSessions,
      href: '/cash/sessions',
    },
  ];

  return (
    <div className="absolute right-12 top-12 z-50 w-80 rounded-md border border-zinc-200 bg-white p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">Notificaciones</p>
        <button type="button" className="text-xs text-muted-foreground" onClick={onClose}>
          Cerrar
        </button>
      </div>
      {loading ? (
        <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-muted-foreground">Cargando alertas...</p>
      ) : (
        <div className="space-y-2">
          {notifications.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={onClose}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 text-sm transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              <span>{item.label}</span>
              <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', item.value ? 'bg-[#f36c10]/10 text-[#b94c08]' : 'bg-zinc-100 text-zinc-500')}>
                {item.value}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
