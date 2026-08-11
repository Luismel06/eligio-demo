import type { AuthSession } from './auth-session';

const adminRoles = ['ADMIN', 'SUPER_ADMIN', 'QORVEX_SUPER_ADMIN'];
const accountantExactPaths = new Set([
  '/dashboard',
  '/products',
  '/customers',
  '/inventory',
  '/invoices',
  '/cash/logs',
  '/cash/sessions',
  '/operations/logs',
]);
const accountantNestedPaths = [
  '/dashboard/',
  '/invoices/',
  '/suppliers/',
  '/purchase-orders/',
  '/supplier-invoices/',
  '/payables/',
  '/receivables/',
  '/credit-approvals/',
  '/operations/logs/',
];
const accountantModulePaths = new Set([
  '/suppliers',
  '/purchase-orders',
  '/supplier-invoices',
  '/payables',
  '/receivables',
  '/credit-approvals',
]);

export function isAdminSession(session: AuthSession | null | undefined) {
  return Boolean(session?.role && adminRoles.includes(session.role));
}

export function isAccountantSession(session: AuthSession | null | undefined) {
  return session?.role === 'ACCOUNTANT';
}

export function canTakeOrders(session: AuthSession | null | undefined) {
  return Boolean(isAdminSession(session) || session?.role === 'ORDER_TAKER');
}

export function canAccessPath(session: AuthSession | null | undefined, pathname: string) {
  if (!session) {
    return false;
  }

  if (isAccountantSession(session)) {
    return (
      accountantExactPaths.has(pathname) ||
      accountantModulePaths.has(pathname) ||
      accountantNestedPaths.some((prefix) => pathname.startsWith(prefix))
    );
  }

  if (session.role === 'ADMIN' && (pathname === '/pos' || pathname.startsWith('/pos/'))) {
    return false;
  }

  if (pathname === '/quotations' || pathname.startsWith('/quotations/')) {
    return isAdminSession(session);
  }

  if (pathname === '/returns' || pathname.startsWith('/returns/')) {
    return isAdminSession(session) || Boolean(session.permissions.canUsePos);
  }

  if (isAdminSession(session)) {
    return true;
  }

  if (pathname.startsWith('/invoices/') && pathname.endsWith('/print')) {
    // The API decides whether this is the cashier's first print or a
    // permission-gated reprint. POS cashiers still need to reach this route
    // immediately after completing their own sale.
    return Boolean(session.permissions.canUsePos || session.permissions.canReprintReceipt);
  }

  if (session.permissions.canUsePos && (pathname === '/pos' || pathname.startsWith('/pos/'))) {
    return true;
  }

  if (canTakeOrders(session) && (pathname === '/orders' || pathname.startsWith('/orders/'))) {
    return true;
  }

  return false;
}

export function getDefaultPathForSession(session: AuthSession | null | undefined) {
  if (!session) {
    return '/login';
  }

  if (isAdminSession(session)) {
    return '/dashboard';
  }

  if (isAccountantSession(session)) {
    return '/dashboard';
  }

  if (canTakeOrders(session)) {
    return '/orders';
  }

  if (session.permissions.canUsePos) {
    return '/pos';
  }

  return '/dashboard';
}
