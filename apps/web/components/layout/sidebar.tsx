'use client';

import {
  Activity,
  BadgeDollarSign,
  Boxes,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ClipboardPlus,
  FileText,
  FileUp,
  Landmark,
  LayoutDashboard,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Users,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getSession, type AuthSession } from '@/lib/auth-session';
import { canTakeOrders, isAccountantSession, isAdminSession } from '@/lib/authorization';
import { cn } from '@/lib/utils';

type NavigationSectionId = 'main' | 'accounting' | 'secondary' | 'logs' | 'settings';
type NavigationGroupId = 'accounting' | 'logs';

export type NavigationItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  primary?: boolean;
  section: NavigationSectionId;
};

type NavigationSection = {
  id: NavigationSectionId;
  label?: string;
  icon?: LucideIcon;
  items: NavigationItem[];
};

const sectionDefinitions: Array<Pick<NavigationSection, 'id' | 'label' | 'icon'>> = [
  { id: 'main' },
  { id: 'accounting', label: 'Contable', icon: Landmark },
  { id: 'secondary' },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'settings' },
];

export const navigation: NavigationItem[] = [
  { name: 'Panel', href: '/dashboard', icon: LayoutDashboard, section: 'main' },
  { name: 'Caja POS', href: '/pos', icon: ShoppingCart, primary: true, section: 'main' },
  {
    name: 'Toma de órdenes',
    href: '/orders',
    icon: ClipboardPlus,
    primary: true,
    section: 'main',
  },
  { name: 'Cotizaciones', href: '/quotations', icon: FileText, section: 'main' },
  { name: 'Productos', href: '/products', icon: Package, section: 'main' },
  { name: 'Clientes', href: '/customers', icon: Users, section: 'main' },
  { name: 'Facturas', href: '/invoices', icon: FileText, primary: true, section: 'main' },
  { name: 'Devoluciones', href: '/returns', icon: RotateCcw, primary: true, section: 'main' },
  {
    name: 'Órdenes de compra',
    href: '/purchase-orders',
    icon: ClipboardList,
    section: 'accounting',
  },
  {
    name: 'Facturas de suplidores',
    href: '/supplier-invoices',
    icon: FileText,
    section: 'accounting',
  },
  { name: 'Cuentas por pagar', href: '/payables', icon: ScrollText, section: 'accounting' },
  { name: 'Cuentas por cobrar', href: '/receivables', icon: FileText, section: 'accounting' },
  {
    name: 'Secuencias fiscales',
    href: '/settings/fiscal-sequences',
    icon: ScrollText,
    section: 'accounting',
  },
  { name: 'Suplidores', href: '/suppliers', icon: Users, section: 'secondary' },
  {
    name: 'Aprobaciones de crédito',
    href: '/credit-approvals',
    icon: BadgeDollarSign,
    section: 'secondary',
  },
  {
    name: 'Validaciones fiscales',
    href: '/tax-identity-approvals',
    icon: ShieldCheck,
    section: 'secondary',
  },
  { name: 'Empleados', href: '/employees', icon: Users, section: 'secondary' },
  { name: 'Logs operativos', href: '/operations/logs', icon: Activity, section: 'logs' },
  { name: 'Movimiento de caja', href: '/cash/logs', icon: ClipboardList, section: 'logs' },
  { name: 'Sesiones', href: '/cash/sessions', icon: ScrollText, section: 'logs' },
  { name: 'Importaciones', href: '/settings/imports', icon: FileUp, section: 'settings' },
  { name: 'Configuración', href: '/settings', icon: Settings, section: 'settings' },
];

export function Sidebar({
  collapsed = false,
  onToggle,
  onNavigate,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-30 hidden border-r border-slate-800 bg-slate-950 text-slate-100 transition-[width] duration-200 print:hidden lg:block',
        collapsed ? 'w-[4.5rem]' : 'w-72',
      )}
    >
      <SidebarContent collapsed={collapsed} onToggle={onToggle} onNavigate={onNavigate} />
    </aside>
  );
}

export function SidebarContent({
  collapsed = false,
  onToggle,
  onNavigate,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const session = getSession();
  const sections = getNavigationSections(session);
  const [activeGroup, setActiveGroup] = useState<NavigationGroupId | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<NavigationGroupId, boolean>>({
    accounting: false,
    logs: false,
  });

  useEffect(() => {
    setActiveGroup(null);
  }, [collapsed, pathname]);

  useEffect(() => {
    const activeSection = sections.find(
      (section) =>
        (section.id === 'accounting' || section.id === 'logs') &&
        section.items.some((item) => isNavigationItemActive(pathname, item)),
    );

    if (!activeSection) return;

    const groupId = activeSection.id as NavigationGroupId;
    setExpandedGroups((current) => (current[groupId] ? current : { ...current, [groupId]: true }));
  }, [pathname]);

  return (
    <div className="flex h-full flex-col">
      <div
        className={cn(
          'flex h-16 items-center gap-3 border-b border-slate-800 px-4',
          collapsed && 'justify-center px-2',
        )}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white shadow-sm">
          <img
              src="/logo.png"
              alt="Logo EligioValdez Comercial"
            className="h-full w-full object-cover"
          />
        </div>
        <div className={cn('min-w-0', collapsed && 'hidden')}>
            <p className="truncate text-sm font-semibold">EligioValdez Comercial</p>
            <p className="truncate text-xs text-slate-400">Operación comercial</p>
        </div>
      </div>

      {onToggle ? (
        <div className={cn('px-3 pt-3', collapsed && 'px-2')}>
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400',
              collapsed && 'justify-center px-2',
            )}
            aria-label={collapsed ? 'Desplegar menú' : 'Contraer menú'}
            title={collapsed ? 'Desplegar menú' : undefined}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
            <span className={cn(collapsed && 'hidden')}>Contraer menú</span>
          </button>
        </div>
      ) : null}

      <nav
        className="sidebar-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 pr-2"
        aria-label="Navegación principal"
      >
        {sections.map((section, index) => {
          const isGroup = Boolean(section.label && section.icon);

          return (
            <div key={section.id} className={cn(index > 0 && 'mt-1')}>
              {isGroup ? (
                <SidebarNavigationGroup
                  section={section}
                  collapsed={collapsed}
                  pathname={pathname}
                  isOpen={activeGroup === section.id}
                  isExpanded={expandedGroups[section.id as NavigationGroupId]}
                  onOpenChange={(open) =>
                    setActiveGroup(open ? (section.id as NavigationGroupId) : null)
                  }
                  onExpandedChange={(expanded) =>
                    setExpandedGroups((current) => ({
                      ...current,
                      [section.id as NavigationGroupId]: expanded,
                    }))
                  }
                  onNavigate={onNavigate}
                />
              ) : (
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <SidebarNavigationLink
                      key={item.href}
                      item={item}
                      collapsed={collapsed}
                      isActive={isNavigationItemActive(pathname, item)}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className={cn('shrink-0 border-t border-slate-800 p-4', collapsed && 'px-3')}>
        <div
          className={cn(
            'rounded-lg border border-slate-800 bg-slate-900/80 p-3',
            collapsed && 'px-2.5',
          )}
        >
          <div
            className={cn(
              'flex items-center gap-2 text-sm font-medium',
              collapsed && 'justify-center',
            )}
          >
            <Boxes className="h-4 w-4 text-[#f36c10]" />
            <span className={cn(collapsed && 'hidden')}>Centro de control</span>
          </div>
          <p className={cn('mt-2 text-xs leading-5 text-slate-400', collapsed && 'hidden')}>
            Datos aislados por tenant.
          </p>
        </div>
      </div>
    </div>
  );
}

function SidebarNavigationGroup({
  section,
  collapsed,
  pathname,
  isOpen,
  isExpanded,
  onOpenChange,
  onExpandedChange,
  onNavigate,
}: {
  section: NavigationSection;
  collapsed: boolean;
  pathname: string;
  isOpen: boolean;
  isExpanded: boolean;
  onOpenChange: (open: boolean) => void;
  onExpandedChange: (expanded: boolean) => void;
  onNavigate?: () => void;
}) {
  const isActive = section.items.some((item) => isNavigationItemActive(pathname, item));
  const Icon = section.icon ?? ScrollText;

  if (!collapsed) {
    return (
      <div>
        <button
          type="button"
          onClick={() => onExpandedChange(!isExpanded)}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400',
            (isActive || isExpanded) && 'bg-white/[0.08] text-white',
          )}
          aria-expanded={isExpanded}
          aria-controls={`sidebar-section-${section.id}`}
        >
          <Icon className={cn('h-5 w-5', isActive && 'text-[#f36c10]')} />
          <span className="flex-1 text-left">{section.label}</span>
          <ChevronDown
            className={cn('h-4 w-4 transition-transform duration-200', !isExpanded && '-rotate-90')}
          />
        </button>
        <div
          id={`sidebar-section-${section.id}`}
          className={cn(
            'grid transition-[grid-template-rows] duration-200 ease-out',
            isExpanded ? 'mt-1 grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
        >
          <div className="overflow-hidden">
            <div className="ml-5 space-y-1">
              {section.items.map((item) => (
                <SidebarNavigationLink
                  key={item.href}
                  item={item}
                  isActive={isNavigationItemActive(pathname, item)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => onOpenChange(true)}
      onMouseLeave={() => onOpenChange(false)}
      onFocus={() => onOpenChange(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onOpenChange(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onOpenChange(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => onOpenChange(!isOpen)}
        className={cn(
          'flex w-full items-center justify-center rounded-lg p-2.5 text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400',
          isActive && 'bg-white/[0.12] text-white shadow-sm',
        )}
        aria-expanded={isOpen}
        aria-label={`${section.label}: mostrar opciones`}
        title={section.label}
      >
        <Icon className={cn('h-5 w-5', isActive && 'text-[#f36c10]')} />
      </button>

      {isOpen ? (
        <div className="absolute left-[calc(100%+0.75rem)] top-0 z-50 w-60 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-[0_18px_40px_-16px_rgb(0_0_0_/_0.8)]">
          <div className="mb-1 flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            <span>{section.label}</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
          </div>
          <div className="space-y-1">
            {section.items.map((item) => (
              <SidebarNavigationLink
                key={item.href}
                item={item}
                isActive={isNavigationItemActive(pathname, item)}
                onNavigate={() => {
                  onOpenChange(false);
                  onNavigate?.();
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SidebarNavigationLink({
  item,
  collapsed = false,
  isActive,
  onNavigate,
}: {
  item: NavigationItem;
  collapsed?: boolean;
  isActive: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400',
        collapsed && 'justify-center px-2.5',
        isActive
          ? 'bg-white/[0.13] text-white shadow-sm'
          : 'text-slate-300 hover:bg-white/[0.08] hover:text-white',
      )}
      title={collapsed ? item.name : undefined}
      aria-current={isActive ? 'page' : undefined}
    >
      <Icon className={cn('h-5 w-5 shrink-0', isActive && 'text-[#f36c10]')} />
      <span className={cn('min-w-0 truncate', collapsed && 'hidden')}>{item.name}</span>
    </Link>
  );
}

export function MobileNavigation() {
  const pathname = usePathname();
  const session = getSession();
  const sections = getNavigationSections(session);
  const visibleNavigation = sections.flatMap((section) => section.items);
  const quickNavigation = getMobileQuickNavigation(visibleNavigation);
  const accountingSection = sections.find((section) => section.id === 'accounting');
  const logsSection = sections.find((section) => section.id === 'logs');
  const [activePopover, setActivePopover] = useState<NavigationGroupId | 'more' | null>(null);
  const quickNavigationIds = new Set(quickNavigation.map((item) => item.href));
  const moreNavigation = visibleNavigation.filter(
    (item) =>
      !quickNavigationIds.has(item.href) &&
      item.section !== 'accounting' &&
      item.section !== 'logs',
  );
  const popoverItems =
    activePopover === 'more'
      ? moreNavigation
      : (sections.find((section) => section.id === activePopover)?.items ?? []);
  const popoverTitle =
    activePopover === 'more'
      ? 'Más opciones'
      : (sections.find((section) => section.id === activePopover)?.label ?? '');

  useEffect(() => {
    setActivePopover(null);
  }, [pathname]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActivePopover(null);
    };

    if (!activePopover) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activePopover]);

  return (
    <>
      {activePopover ? (
        <button
          type="button"
          className="fixed inset-0 z-40 cursor-default lg:hidden"
          aria-label="Cerrar opciones"
          onClick={() => setActivePopover(null)}
        />
      ) : null}

      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white/95 px-2 pb-2 pt-1 shadow-2xl shadow-slate-950/10 backdrop-blur print:hidden lg:hidden"
        aria-label="Accesos rápidos"
      >
        {activePopover && popoverItems.length ? (
          <div className="absolute inset-x-2 bottom-[calc(100%+0.75rem)] overflow-hidden rounded-2xl border border-slate-700/90 bg-slate-950 p-2 text-slate-100 shadow-[0_18px_42px_-18px_rgb(15_23_42_/_0.8)]">
            <div className="sidebar-scrollbar max-h-[min(42vh,19rem)] overflow-y-auto">
              <div className="flex items-center gap-2 px-2 pb-2 pt-1">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  {popoverTitle}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {popoverItems.map((item) => {
                  const isActive = isNavigationItemActive(pathname, item);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setActivePopover(null)}
                      className={cn(
                        'flex min-h-12 items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400',
                        isActive
                          ? 'bg-white/[0.14] text-white'
                          : 'text-slate-200 hover:bg-white/[0.08] hover:text-white',
                      )}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', isActive && 'text-[#f36c10]')} />
                      <span className="min-w-0 truncate">{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex min-w-0 gap-1">
          {quickNavigation.map((item) => {
            const isActive = isNavigationItemActive(pathname, item);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setActivePopover(null)}
                className={cn(
                  'flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 text-center text-[0.64rem] font-medium text-muted-foreground transition-colors',
                  isActive ? 'bg-slate-950 text-white shadow-sm ring-1 ring-[#f36c10]/70' : '',
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="w-full truncate">{item.name}</span>
              </Link>
            );
          })}
          {accountingSection ? (
            <MobilePopoverTrigger
              label={accountingSection.label ?? 'Contable'}
              icon={accountingSection.icon ?? Landmark}
              active={accountingSection.items.some((item) =>
                isNavigationItemActive(pathname, item),
              )}
              open={activePopover === 'accounting'}
              onClick={() =>
                setActivePopover((current) => (current === 'accounting' ? null : 'accounting'))
              }
            />
          ) : null}
          {logsSection ? (
            <MobilePopoverTrigger
              label={logsSection.label ?? 'Logs'}
              icon={logsSection.icon ?? ScrollText}
              active={logsSection.items.some((item) => isNavigationItemActive(pathname, item))}
              open={activePopover === 'logs'}
              onClick={() => setActivePopover((current) => (current === 'logs' ? null : 'logs'))}
            />
          ) : null}
          {moreNavigation.length ? (
            <MobilePopoverTrigger
              label="Más"
              icon={MoreHorizontal}
              active={moreNavigation.some((item) => isNavigationItemActive(pathname, item))}
              open={activePopover === 'more'}
              onClick={() => setActivePopover((current) => (current === 'more' ? null : 'more'))}
            />
          ) : null}
        </div>
      </nav>
    </>
  );
}

function MobilePopoverTrigger({
  label,
  icon: Icon,
  active,
  open,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  open: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 text-center text-[0.64rem] font-medium text-muted-foreground transition-colors hover:bg-zinc-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        (active || open) && 'bg-slate-950 text-white shadow-sm ring-1 ring-[#f36c10]/70',
      )}
      aria-expanded={open}
      aria-label={`${label}: mostrar opciones`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span className="w-full truncate">{label}</span>
    </button>
  );
}

export function getNavigationSections(session: AuthSession | null): NavigationSection[] {
  const visibleNavigation = getVisibleNavigation(session);

  return sectionDefinitions.flatMap((section) => {
    const items = visibleNavigation.filter((item) => item.section === section.id);
    return items.length ? [{ ...section, items }] : [];
  });
}

export function getVisibleNavigation(session: AuthSession | null) {
  if (isAccountantSession(session)) {
    const accountantPaths = new Set([
      '/dashboard',
      '/products',
      '/customers',
      '/invoices',
      '/suppliers',
      '/purchase-orders',
      '/supplier-invoices',
      '/payables',
      '/receivables',
      '/credit-approvals',
      '/cash/logs',
      '/cash/sessions',
      '/operations/logs',
    ]);

    return navigation.filter((item) => accountantPaths.has(item.href));
  }

  if (isAdminSession(session)) {
    if (session?.role === 'ADMIN') {
      return navigation.filter((item) => item.href !== '/pos');
    }

    return navigation;
  }

  if (canTakeOrders(session) && session?.permissions.canUsePos) {
    return navigation.filter(
      (item) => item.href === '/orders' || item.href === '/pos' || item.href === '/returns',
    );
  }

  if (canTakeOrders(session)) {
    return navigation.filter((item) => item.href === '/orders');
  }

  if (session?.permissions.canUsePos) {
    return navigation.filter((item) => item.href === '/pos' || item.href === '/returns');
  }

  return [];
}

function getMobileQuickNavigation(items: NavigationItem[]) {
  const preferredPaths = ['/dashboard', '/pos', '/orders', '/invoices'];
  const quickItems: NavigationItem[] = [];

  preferredPaths.forEach((href) => {
    if (quickItems.length >= 1) return;
    const item = items.find((candidate) => candidate.href === href);
    if (item) quickItems.push(item);
  });

  items.forEach((item) => {
    if (quickItems.length < 1 && !quickItems.some((candidate) => candidate.href === item.href)) {
      quickItems.push(item);
    }
  });

  return quickItems;
}

function isNavigationItemActive(pathname: string, item: NavigationItem) {
  if (item.href === '/settings') return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
