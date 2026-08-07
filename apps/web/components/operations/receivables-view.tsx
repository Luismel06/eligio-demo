'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  CalendarClock,
  FileText,
  Printer,
  Search,
  UserRound,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  cancelReceivablePayment,
  createReceivablePayment,
  getCashSessions,
  getReceivableCustomerSummary,
  getReceivables,
  type CashSession,
  type ReceivableDueBucket,
  type ReceivableInvoice,
  type ReceivablePayment,
} from '@/lib/api';
import { isAdminSession } from '@/lib/authorization';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';

const bucketFilters: Array<{ value: ReceivableDueBucket | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'Todas' },
  { value: 'OVERDUE', label: 'Vencidas' },
  { value: 'TODAY', label: 'Vencen hoy' },
  { value: 'DUE_SOON', label: 'Próximos 7 días' },
  { value: 'CURRENT', label: 'Al día' },
  { value: 'PAID', label: 'Pagadas' },
];

type PaymentTarget = {
  invoice: ReceivableInvoice;
  amount: string;
  cashSessionId: string;
  idempotencyKey: string;
};

type CancellationTarget = {
  payment: NonNullable<ReceivableInvoice['payments']>[number];
  invoice: ReceivableInvoice;
  reason: string;
  cashSessionId: string;
};

export function ReceivablesView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'INVOICES' | 'CUSTOMERS'>('INVOICES');
  const [bucket, setBucket] = useState<ReceivableDueBucket | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [paymentTarget, setPaymentTarget] = useState<PaymentTarget | null>(null);
  const [cancellationTarget, setCancellationTarget] = useState<CancellationTarget | null>(null);
  const [lastPayment, setLastPayment] = useState<ReceivablePayment | null>(null);

  const receivablesQuery = useQuery({
    queryKey: ['receivables', session?.tenantId, bucket, search],
    queryFn: () =>
      getReceivables(session?.tenantId ?? '', session?.accessToken ?? '', {
        bucket,
        q: search,
      }),
    enabled: Boolean(session),
  });
  const customerSummaryQuery = useQuery({
    queryKey: ['receivable-customer-summary', session?.tenantId],
    queryFn: () =>
      getReceivableCustomerSummary(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const cashSessionsQuery = useQuery({
    queryKey: ['cash-sessions', session?.tenantId, 'receivables'],
    queryFn: () => getCashSessions(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });

  const openCashSessions = (cashSessionsQuery.data ?? []).filter(
    (cashSession) => cashSession.status === 'OPEN',
  );
  const summary = useMemo(() => {
    const invoices = receivablesQuery.data ?? [];
    return {
      totalBalance: invoices.reduce((sum, invoice) => sum + Number(invoice.balance), 0),
      overdueBalance: invoices
        .filter((invoice) => invoice.dueBucket === 'OVERDUE')
        .reduce((sum, invoice) => sum + Number(invoice.balance), 0),
      dueSoonBalance: invoices
        .filter((invoice) => invoice.dueBucket === 'TODAY' || invoice.dueBucket === 'DUE_SOON')
        .reduce((sum, invoice) => sum + Number(invoice.balance), 0),
      openInvoices: invoices.filter((invoice) => Number(invoice.balance) > 0).length,
    };
  }, [receivablesQuery.data]);

  const paymentMutation = useMutation({
    mutationFn: () => {
      if (!session || !paymentTarget) {
        throw new Error('Sesión requerida.');
      }
      const amount = Number(paymentTarget.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Indica un monto de abono válido.');
      }
      if (amount > Number(paymentTarget.invoice.balance)) {
        throw new Error('El abono no puede superar el saldo de la factura.');
      }
      if (!paymentTarget.cashSessionId) {
        throw new Error('Selecciona una caja abierta.');
      }
      return createReceivablePayment(
        session.tenantId,
        session.accessToken,
        paymentTarget.invoice.id,
        {
          amount,
          cashSessionId: paymentTarget.cashSessionId,
          idempotencyKey: paymentTarget.idempotencyKey,
        },
      );
    },
    onSuccess: async (payment) => {
      setLastPayment(payment);
      setPaymentTarget(null);
      await invalidateReceivableQueries();
      toast.success('Abono registrado', {
        description: payment.receiptNumber ?? payment.invoice.invoiceNumber,
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar el abono.');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!session || !cancellationTarget) {
        throw new Error('Sesión requerida.');
      }
      if (!cancellationTarget.reason.trim()) {
        throw new Error('Indica el motivo de anulación.');
      }
      if (!cancellationTarget.cashSessionId) {
        throw new Error('Selecciona la caja abierta que recibirá la reversión.');
      }
      return cancelReceivablePayment(
        session.tenantId,
        session.accessToken,
        cancellationTarget.payment.id,
        {
          cashSessionId: cancellationTarget.cashSessionId,
          reason: cancellationTarget.reason.trim(),
        },
      );
    },
    onSuccess: async () => {
      setCancellationTarget(null);
      await invalidateReceivableQueries();
      toast.success('Abono anulado y movimiento inverso registrado.');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo anular el abono.');
    },
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  const canCancel = isAdminSession(session);

  async function invalidateReceivableQueries() {
    await queryClient.invalidateQueries({ queryKey: ['receivables'] });
    await queryClient.invalidateQueries({ queryKey: ['receivable-customer-summary'] });
    await queryClient.invalidateQueries({ queryKey: ['cash-sessions'] });
    await queryClient.invalidateQueries({ queryKey: ['cash-movements'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    await queryClient.invalidateQueries({ queryKey: ['customers'] });
  }

  function defaultOpenSessionId() {
    return openCashSessions[0]?.id ?? '';
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Cuentas por cobrar"
        description="Facturas fiadas ordenadas por vencimiento, abonos en efectivo y estados de cuenta."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Saldo visible" value={formatCurrency(summary.totalBalance)} />
        <SummaryCard
          label="Saldo vencido"
          value={formatCurrency(summary.overdueBalance)}
          tone="danger"
        />
        <SummaryCard
          label="Vence hoy / 7 días"
          value={formatCurrency(summary.dueSoonBalance)}
          tone="warning"
        />
        <SummaryCard label="Facturas abiertas" value={String(summary.openInvoices)} />
      </div>

      {lastPayment?.receiptNumber ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-emerald-950">Último abono registrado</p>
              <p className="text-sm text-emerald-800">
                {lastPayment.receiptNumber} · {formatCurrency(Number(lastPayment.amount))}
              </p>
            </div>
            <Button asChild variant="outline" className="bg-white">
              <Link href={`/receivables/payments/${lastPayment.id}/print`}>
                <Printer className="h-4 w-4" />
                Imprimir recibo
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant={view === 'INVOICES' ? 'default' : 'outline'}
          onClick={() => setView('INVOICES')}
        >
          <FileText className="h-4 w-4" />
          Por factura
        </Button>
        <Button
          type="button"
          variant={view === 'CUSTOMERS' ? 'default' : 'outline'}
          onClick={() => setView('CUSTOMERS')}
        >
          <UserRound className="h-4 w-4" />
          Resumen por cliente
        </Button>
      </div>

      {paymentTarget ? (
        <PaymentForm
          target={paymentTarget}
          sessions={openCashSessions}
          pending={paymentMutation.isPending}
          onChange={setPaymentTarget}
          onSubmit={() => paymentMutation.mutate()}
          onClose={() => setPaymentTarget(null)}
        />
      ) : null}

      {cancellationTarget ? (
        <CancellationForm
          target={cancellationTarget}
          sessions={openCashSessions}
          pending={cancelMutation.isPending}
          onChange={setCancellationTarget}
          onSubmit={() => cancelMutation.mutate()}
          onClose={() => setCancellationTarget(null)}
        />
      ) : null}

      {view === 'INVOICES' ? (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {bucketFilters.map((filter) => (
                <Button
                  key={filter.value}
                  type="button"
                  size="sm"
                  variant={bucket === filter.value ? 'default' : 'outline'}
                  onClick={() => setBucket(filter.value)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
            <div className="relative max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="bg-white pl-9"
                placeholder="Buscar factura, cliente o documento"
              />
            </div>
          </div>
          <div className="grid gap-4">
            {receivablesQuery.isLoading ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Cargando cuentas por cobrar...
                </CardContent>
              </Card>
            ) : (receivablesQuery.data ?? []).length ? (
              (receivablesQuery.data ?? []).map((invoice) => (
                <ReceivableCard
                  key={invoice.id}
                  invoice={invoice}
                  canCancel={canCancel}
                  onPayment={() =>
                    setPaymentTarget({
                      invoice,
                      amount: String(Number(invoice.balance).toFixed(2)),
                      cashSessionId: defaultOpenSessionId(),
                      idempotencyKey: crypto.randomUUID(),
                    })
                  }
                  onCancelPayment={(payment) =>
                    setCancellationTarget({
                      payment,
                      invoice,
                      reason: '',
                      cashSessionId: defaultOpenSessionId(),
                    })
                  }
                />
              ))
            ) : (
              <Card>
                <CardContent className="p-8 text-center text-sm text-muted-foreground">
                  No hay facturas en este filtro.
                </CardContent>
              </Card>
            )}
          </div>
        </>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(customerSummaryQuery.data ?? []).map((customer) => (
            <Card key={customer.id}>
              <CardHeader>
                <CardTitle>{customer.name}</CardTitle>
                <CardDescription>
                  {customer.invoiceCount} factura(s) · {customer.creditTermDays} días de crédito
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Metric
                    label="Deuda total"
                    value={formatCurrency(Number(customer.outstanding))}
                  />
                  <Metric label="Vencida" value={formatCurrency(Number(customer.overdue))} danger />
                </div>
                <p className="text-xs text-muted-foreground">
                  Límite {formatCurrency(Number(customer.creditLimit))} ·{' '}
                  {customer.creditEnabled && customer.creditStatus === 'ACTIVE'
                    ? 'Crédito activo'
                    : 'Crédito bloqueado'}
                </p>
                <Button asChild variant="outline" className="w-full">
                  <Link href={`/receivables/customers/${customer.id}/statement`}>
                    <Printer className="h-4 w-4" />
                    Ver / imprimir estado
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ReceivableCard({
  invoice,
  canCancel,
  onPayment,
  onCancelPayment,
}: {
  invoice: ReceivableInvoice;
  canCancel: boolean;
  onPayment: () => void;
  onCancelPayment: (payment: NonNullable<ReceivableInvoice['payments']>[number]) => void;
}) {
  const installments = (invoice.payments ?? []).filter((payment) => payment.receiptNumber);

  return (
    <Card className={invoice.dueBucket === 'OVERDUE' ? 'border-red-200' : undefined}>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{invoice.invoiceNumber}</CardTitle>
              <Badge variant={bucketVariant(invoice.dueBucket)}>
                {bucketLabel(invoice.dueBucket)}
              </Badge>
            </div>
            <CardDescription className="mt-1">
              {invoice.customer?.name ?? 'Cliente no disponible'} · emitida{' '}
              {formatDate(invoice.issuedAt ?? invoice.createdAt)}
            </CardDescription>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Saldo</p>
            <p className="text-xl font-bold">{formatCurrency(Number(invoice.balance))}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-4">
          <Metric label="Total" value={formatCurrency(Number(invoice.total))} />
          <Metric label="Pagado" value={formatCurrency(Number(invoice.paidAmount))} />
          <Metric
            label="Vence"
            value={invoice.dueDate ? formatDate(invoice.dueDate) : 'Sin fecha'}
          />
          <Metric label="Abonos" value={String(installments.length)} />
        </div>
        {installments.length ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Historial de abonos</p>
            {installments.map((payment) => (
              <div
                key={payment.id}
                className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">
                    {payment.receiptNumber} · {formatCurrency(Number(payment.amount))}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(payment.paidAt ?? payment.createdAt)} ·{' '}
                    {payment.status === 'CANCELLED' ? 'Anulado' : 'Aplicado'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/receivables/payments/${payment.id}/print`}>
                      <Printer className="h-4 w-4" />
                      Recibo
                    </Link>
                  </Button>
                  {canCancel && payment.status === 'COMPLETED' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-danger hover:bg-danger/5 hover:text-danger"
                      onClick={() => onCancelPayment(payment)}
                    >
                      <XCircle className="h-4 w-4" />
                      Anular
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {Number(invoice.balance) > 0 ? (
            <Button type="button" onClick={onPayment}>
              <Banknote className="h-4 w-4" />
              Registrar abono
            </Button>
          ) : null}
          {invoice.customerId ? (
            <Button asChild variant="outline">
              <Link href={`/receivables/customers/${invoice.customerId}/statement`}>
                <FileText className="h-4 w-4" />
                Estado del cliente
              </Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentForm({
  target,
  sessions,
  pending,
  onChange,
  onSubmit,
  onClose,
}: {
  target: PaymentTarget;
  sessions: CashSession[];
  pending: boolean;
  onChange: (target: PaymentTarget) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Card className="border-emerald-200">
      <CardHeader>
        <CardTitle>Registrar abono · {target.invoice.invoiceNumber}</CardTitle>
        <CardDescription>
          Solo efectivo. El monto aumentará el esperado de la caja seleccionada.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="receivableAmount">Monto</Label>
          <Input
            id="receivableAmount"
            type="number"
            min="0.01"
            max={Number(target.invoice.balance)}
            step="0.01"
            value={target.amount}
            onChange={(event) => onChange({ ...target, amount: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="receivableCashSession">Caja abierta</Label>
          <select
            id="receivableCashSession"
            value={target.cashSessionId}
            onChange={(event) => onChange({ ...target, cashSessionId: event.target.value })}
            className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
          >
            <option value="">Selecciona una caja</option>
            {sessions.map((cashSession) => (
              <option key={cashSession.id} value={cashSession.id}>
                {cashSession.cashRegister.name} · {cashSession.openedBy?.name ?? 'Usuario'}
              </option>
            ))}
          </select>
        </div>
        {!sessions.length ? (
          <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 md:col-span-2">
            No hay cajas abiertas. Debe abrirse una antes de registrar el abono.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="button" disabled={pending || !sessions.length} onClick={onSubmit}>
            <Banknote className="h-4 w-4" />
            Confirmar abono
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CancellationForm({
  target,
  sessions,
  pending,
  onChange,
  onSubmit,
  onClose,
}: {
  target: CancellationTarget;
  sessions: CashSession[];
  pending: boolean;
  onChange: (target: CancellationTarget) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle>Anular {target.payment.receiptNumber}</CardTitle>
        <CardDescription>
          Se registrará una salida por {formatCurrency(Number(target.payment.amount))} en la caja
          abierta seleccionada.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cancelReceivableReason">Motivo</Label>
          <Input
            id="cancelReceivableReason"
            value={target.reason}
            onChange={(event) => onChange({ ...target, reason: event.target.value })}
            maxLength={500}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cancelReceivableSession">Caja abierta</Label>
          <select
            id="cancelReceivableSession"
            value={target.cashSessionId}
            onChange={(event) => onChange({ ...target, cashSessionId: event.target.value })}
            className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
          >
            <option value="">Selecciona una caja</option>
            {sessions.map((cashSession) => (
              <option key={cashSession.id} value={cashSession.id}>
                {cashSession.cashRegister.name} · {cashSession.openedBy?.name ?? 'Usuario'}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button
            type="button"
            variant="outline"
            className="border-danger/30 text-danger hover:bg-danger/5 hover:text-danger"
            disabled={pending || !sessions.length}
            onClick={onSubmit}
          >
            <XCircle className="h-4 w-4" />
            Confirmar anulación
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Volver
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'danger' | 'warning';
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p
          className={
            tone === 'danger'
              ? 'mt-1 text-xl font-bold text-danger'
              : tone === 'warning'
                ? 'mt-1 text-xl font-bold text-amber-700'
                : 'mt-1 text-xl font-bold'
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-md bg-zinc-50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={danger ? 'font-semibold text-danger' : 'font-semibold'}>{value}</p>
    </div>
  );
}

function bucketLabel(bucket: ReceivableDueBucket) {
  return {
    OVERDUE: 'Vencida',
    TODAY: 'Vence hoy',
    DUE_SOON: 'Próxima',
    CURRENT: 'Al día',
    PAID: 'Pagada',
  }[bucket];
}

function bucketVariant(bucket: ReceivableDueBucket) {
  if (bucket === 'OVERDUE') return 'danger' as const;
  if (bucket === 'TODAY' || bucket === 'DUE_SOON') return 'warning' as const;
  if (bucket === 'PAID') return 'success' as const;
  return 'outline' as const;
}
