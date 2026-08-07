'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, ChevronDown, ChevronUp, DoorClosed, DoorOpen } from 'lucide-react';
import Link from 'next/link';
import { Fragment, FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { closeCashSession, getCashRegisters, getCashSessions, openCashSession } from '@/lib/api';
import { isAdminSession } from '@/lib/authorization';
import {
  getStatusVariant,
  translateCashMovementType,
  translatePaymentMethod,
  translateStatus,
} from '@/lib/display-labels';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import {
  clearCurrencyInput,
  formatCurrencyInput,
  parseCurrencyInput,
  sanitizeCurrencyInput,
} from './pos/currency-input';
import { SessionRequired, useCurrentSession } from './session-required';
import { WarningConfirmModal } from './warning-confirm-modal';

export function CashSessionsView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const [selectedRegisterId, setSelectedRegisterId] = useState('');
  const [selectedClosingSessionId, setSelectedClosingSessionId] = useState('');
  const [openingAmount, setOpeningAmount] = useState(clearCurrencyInput());
  const [closingAmount, setClosingAmount] = useState(clearCurrencyInput());
  const [message, setMessage] = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [zeroClosingWarningOpen, setZeroClosingWarningOpen] = useState(false);

  const sessionsQuery = useQuery({
    queryKey: ['cash-sessions', session?.tenantId],
    queryFn: () => getCashSessions(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const registersQuery = useQuery({
    queryKey: ['cash-registers', session?.tenantId],
    queryFn: () => getCashRegisters(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const openSessions = (sessionsQuery.data ?? []).filter(
    (cashSession) => cashSession.status === 'OPEN',
  );
  const selectedOpenSession = openSessions.find(
    (cashSession) => cashSession.id === selectedClosingSessionId,
  );
  const selectedRegisterOpenSession = openSessions.find(
    (cashSession) => cashSession.cashRegister.id === selectedRegisterId,
  );
  const canOpenCashSession =
    Boolean(session?.permissions.canOpenCashSession) && !isAdminSession(session);

  useEffect(() => {
    const firstRegister = registersQuery.data?.find(
      (register) =>
        register.status === 'ACTIVE' &&
        !openSessions.some((cashSession) => cashSession.cashRegister.id === register.id),
    );

    if (!selectedRegisterId && firstRegister) {
      setSelectedRegisterId(firstRegister.id);
    }
  }, [registersQuery.data, selectedRegisterId, sessionsQuery.data]);

  useEffect(() => {
    const firstOpenSession = sessionsQuery.data?.find(
      (cashSession) => cashSession.status === 'OPEN',
    );

    if (!selectedClosingSessionId && firstOpenSession) {
      setSelectedClosingSessionId(firstOpenSession.id);
    }
  }, [selectedClosingSessionId, sessionsQuery.data]);

  const openMutation = useMutation({
    mutationFn: () => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      const parsedOpeningAmount = parseCurrencyInput(openingAmount);
      if (parsedOpeningAmount <= 0) {
        throw new Error('El monto inicial debe ser mayor que 0.');
      }

      return openCashSession(session.tenantId, session.accessToken, {
        cashRegisterId: selectedRegisterId,
        openingAmount: parsedOpeningAmount,
      });
    },
    onSuccess: async () => {
      setMessage('Caja abierta correctamente.');
      toast.success('Caja abierta correctamente.');
      await invalidateCash();
    },
    onError: (error) => {
      const nextMessage = error instanceof Error ? error.message : 'No se pudo abrir la caja.';
      setMessage(nextMessage);
      toast.error(nextMessage);
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => {
      if (!session || !selectedClosingSessionId) {
        throw new Error('Sesion requerida.');
      }

      return closeCashSession(session.tenantId, session.accessToken, selectedClosingSessionId, {
        closingAmount: parseCurrencyInput(closingAmount),
        notes: 'Cierre desde modulo de caja',
      });
    },
    onSuccess: async (closedSession) => {
      setMessage('Caja cerrada correctamente.');
      toast.success('Caja cerrada correctamente.');
      setClosingAmount(clearCurrencyInput());
      setSelectedClosingSessionId('');
      setExpandedSessionId(closedSession.id);
      await invalidateCash();
    },
    onError: (error) => {
      const nextMessage = error instanceof Error ? error.message : 'No se pudo cerrar la caja.';
      setMessage(nextMessage);
      toast.error(nextMessage);
    },
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  const readOnly = session.role === 'ACCOUNTANT';

  async function invalidateCash() {
    await queryClient.invalidateQueries({ queryKey: ['cash-sessions'] });
    await queryClient.invalidateQueries({ queryKey: ['cash-session-current'] });
    await queryClient.invalidateQueries({ queryKey: ['cash-movements'] });
    await queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
  }

  function submitOpen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    openMutation.mutate();
  }

  function submitClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (parseCurrencyInput(closingAmount) === 0) {
      setZeroClosingWarningOpen(true);
      return;
    }

    closeMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Sesiones de caja"
        description="Apertura, control y cierre de caja de Ferreteria RIVNU."
      />

      {canOpenCashSession ? (
        <Card>
          <CardHeader>
            <CardTitle>Abrir caja</CardTitle>
            <CardDescription>
              Declara el monto inicial y selecciona una caja fisica disponible. Puedes abrir varias
              cajas a la vez si son cajas distintas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-[1fr_1fr_auto]" onSubmit={submitOpen}>
              <div className="space-y-2">
                <Label htmlFor="cashRegister">Caja</Label>
                <select
                  id="cashRegister"
                  value={selectedRegisterId}
                  onChange={(event) => setSelectedRegisterId(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                  required
                >
                  {(registersQuery.data ?? []).map((register) => {
                    const openSession = openSessions.find(
                      (cashSession) => cashSession.cashRegister.id === register.id,
                    );

                    return (
                      <option key={register.id} value={register.id}>
                        {register.name}
                        {openSession
                          ? ` - abierta por ${openSession.openedBy?.name ?? 'otro empleado'}`
                          : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="openingAmount">
                  Monto inicial <span className="text-danger">*</span>
                </Label>
                <Input
                  id="openingAmount"
                  type="text"
                  inputMode="decimal"
                  value={openingAmount}
                  onChange={(event) => setOpeningAmount(sanitizeCurrencyInput(event.target.value))}
                  onBlur={(event) => setOpeningAmount(formatCurrencyInput(event.target.value))}
                  onFocus={(event) => event.currentTarget.select()}
                  required
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  disabled={
                    !selectedRegisterId ||
                    openMutation.isPending ||
                    Boolean(selectedRegisterOpenSession) ||
                    parseCurrencyInput(openingAmount) <= 0
                  }
                >
                  <DoorOpen className="h-4 w-4" />
                  Abrir caja
                </Button>
              </div>
            </form>
            {selectedRegisterOpenSession ? (
              <p className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
                {selectedRegisterOpenSession.cashRegister.name} ya esta abierta por{' '}
                {selectedRegisterOpenSession.openedBy?.name ?? 'otro empleado'}. Selecciona otra
                caja fisica.
              </p>
            ) : null}
            {message ? <p className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {!readOnly ? (
        <Card>
          <CardHeader>
            <CardTitle>Cerrar caja</CardTitle>
            <CardDescription>
              {openSessions.length
                ? `${openSessions.length} sesion(es) abierta(s). Selecciona una para cierre.`
                : 'No hay cajas abiertas en este momento.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {openSessions.length ? (
              <form className="grid gap-4 md:grid-cols-[1fr_1fr_auto]" onSubmit={submitClose}>
                <div className="space-y-2">
                  <Label htmlFor="openSession">Sesion abierta</Label>
                  <select
                    id="openSession"
                    value={selectedClosingSessionId}
                    onChange={(event) => setSelectedClosingSessionId(event.target.value)}
                    className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                    required
                  >
                    {openSessions.map((cashSession) => (
                      <option key={cashSession.id} value={cashSession.id}>
                        {cashSession.cashRegister.name} - {cashSession.openedBy?.name ?? 'Empleado'}
                      </option>
                    ))}
                  </select>
                  {selectedOpenSession ? (
                    <p className="text-xs text-muted-foreground">
                      Abierta el {formatDateTime(selectedOpenSession.openedAt)} con{' '}
                      {formatCurrency(Number(selectedOpenSession.openingAmount))}.
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="closingAmount">Monto contado para cierre</Label>
                  <Input
                    id="closingAmount"
                    type="text"
                    inputMode="decimal"
                    value={closingAmount}
                    onChange={(event) =>
                      setClosingAmount(sanitizeCurrencyInput(event.target.value))
                    }
                    onBlur={(event) => setClosingAmount(formatCurrencyInput(event.target.value))}
                    onFocus={(event) => event.currentTarget.select()}
                    required
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" variant="outline" disabled={closeMutation.isPending}>
                    <DoorClosed className="h-4 w-4" />
                    Cerrar caja
                  </Button>
                </div>
              </form>
            ) : (
              <p className="rounded-md bg-zinc-50 px-3 py-2 text-sm text-muted-foreground">
                Abre una caja para comenzar a registrar ventas y movimientos.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Historial</CardTitle>
          <CardDescription>
            {sessionsQuery.data?.length ?? 0} sesiones en historial con reporte de movimientos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-3 pr-4">Caja</th>
                  <th className="py-3 pr-4">Estado</th>
                  <th className="py-3 pr-4">Apertura</th>
                  <th className="py-3 pr-4">Cierre</th>
                  <th className="py-3 pr-4 text-right">Esperado</th>
                  <th className="py-3 pr-4 text-right">Contado</th>
                  <th className="py-3 pr-4 text-right">Diferencia</th>
                  <th className="py-3 text-right">Reporte</th>
                </tr>
              </thead>
              <tbody>
                {(sessionsQuery.data ?? []).map((cashSession) => {
                  const expanded = expandedSessionId === cashSession.id;
                  const expectedAmount = Number(
                    cashSession.expectedAmount ?? cashSession.openingAmount,
                  );
                  const closingAmount =
                    cashSession.closingAmount !== null ? Number(cashSession.closingAmount) : null;
                  const difference =
                    cashSession.difference !== null ? Number(cashSession.difference) : null;

                  return (
                    <Fragment key={cashSession.id}>
                      <tr key={cashSession.id} className="border-b border-border">
                        <td className="py-3 pr-4">
                          <div className="font-medium">{cashSession.cashRegister.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {cashSession.openedBy?.name ?? 'Empleado'}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <Badge variant={getStatusVariant(cashSession.status)}>
                            {translateStatus(cashSession.status)}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4">{formatDateTime(cashSession.openedAt)}</td>
                        <td className="py-3 pr-4">
                          {cashSession.closedAt ? formatDateTime(cashSession.closedAt) : '-'}
                        </td>
                        <td
                          className={`py-3 pr-4 text-right ${getNegativeAmountClass(expectedAmount)}`}
                        >
                          {formatCurrency(expectedAmount)}
                        </td>
                        <td
                          className={`py-3 pr-4 text-right ${getNegativeAmountClass(closingAmount)}`}
                        >
                          {closingAmount !== null ? formatCurrency(closingAmount) : '-'}
                        </td>
                        <td
                          className={`py-3 pr-4 text-right ${getNegativeAmountClass(difference)}`}
                        >
                          {difference !== null ? formatCurrency(difference) : '-'}
                        </td>
                        <td className="py-3 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setExpandedSessionId(expanded ? null : cashSession.id)}
                          >
                            {expanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                            {expanded ? 'Ocultar' : 'Ver'}
                          </Button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr
                          key={`${cashSession.id}-report`}
                          className="border-b border-border bg-zinc-50/70"
                        >
                          <td colSpan={8} className="px-0 py-4">
                            <CashSessionReport cashSession={cashSession} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <WarningConfirmModal
        open={zeroClosingWarningOpen}
        title="Cerrar caja con RD$0.00"
        description="El monto contado esta en cero. Confirma solo si realmente la caja fisica no tiene efectivo al cierre."
        confirmLabel="Cerrar en RD$0.00"
        isPending={closeMutation.isPending}
        onClose={() => setZeroClosingWarningOpen(false)}
        onConfirm={() => {
          setZeroClosingWarningOpen(false);
          closeMutation.mutate();
        }}
      />
    </div>
  );
}

function CashSessionReport({
  cashSession,
}: {
  cashSession: NonNullable<Awaited<ReturnType<typeof closeCashSession>>>;
}) {
  const movements = cashSession.movements ?? [];
  const salesOrders = cashSession.claimedSalesOrders ?? [];
  const invoices = cashSession.invoices ?? [];
  const orderInvoices = invoices.filter((invoice) => invoice.salesOrder);
  const quotationInvoices = invoices.filter((invoice) =>
    invoice.salesOrder?.orderNumber.startsWith('COT-'),
  );
  const directInvoices = invoices.filter((invoice) => !invoice.salesOrder);
  const paymentTotals = getInvoicePaymentTotals(invoices);
  const summary = getCashSessionSummary(cashSession);

  return (
    <div className="space-y-4 px-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ReportMetric
          label="Fondo inicial"
          value={formatCurrency(summary.opening)}
          tone="opening"
        />
        <ReportMetric
          label="Ventas en efectivo"
          value={formatCurrency(summary.sales)}
          tone="sale"
        />
        <ReportMetric
          label="Entradas manuales"
          value={formatCurrency(summary.cashIn)}
          tone="cashIn"
        />
        <ReportMetric
          label="Salidas y devoluciones"
          value={formatCurrency(summary.cashOut + summary.refunds)}
          tone="cashOut"
        />
        <ReportMetric
          label="Ajustes"
          value={formatCurrency(summary.adjustments)}
          tone="adjustment"
        />
        <ReportMetric
          label="Esperado"
          value={formatCurrency(Number(cashSession.expectedAmount ?? summary.expected))}
          tone="expected"
        />
        <ReportMetric
          label="Contado"
          value={
            cashSession.closingAmount ? formatCurrency(Number(cashSession.closingAmount)) : '-'
          }
          tone="counted"
        />
        <ReportMetric
          label="Diferencia"
          value={cashSession.difference ? formatCurrency(Number(cashSession.difference)) : '-'}
          tone={Number(cashSession.difference ?? 0) === 0 ? 'balanced' : 'warning'}
        />
      </div>

      <details className="rounded-md border border-border bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium marker:content-none">
          <span>Desglose comercial</span>
          <span className="text-xs font-normal text-muted-foreground">
            {invoices.length} factura(s) · {salesOrders.length} orden(es)
          </span>
        </summary>
        <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2 xl:grid-cols-4">
          <ReportMetric
            label="Facturas desde tickets"
            value={`${orderInvoices.length} / ${formatCurrency(sumInvoiceTotals(orderInvoices))}`}
            tone="order"
          />
          <ReportMetric
            label="Cotizaciones cobradas"
            value={`${quotationInvoices.length} / ${formatCurrency(sumInvoiceTotals(quotationInvoices))}`}
            tone="quote"
          />
          <ReportMetric
            label="Ventas directas"
            value={`${directInvoices.length} / ${formatCurrency(sumInvoiceTotals(directInvoices))}`}
            tone="admin"
          />
          <ReportMetric
            label="Órdenes cobradas"
            value={String(salesOrders.filter((order) => order.status === 'COMPLETED').length)}
            tone="order"
          />
          <ReportMetric
            label="Pagos en efectivo"
            value={formatCurrency(paymentTotals.CASH)}
            tone="cash"
          />
          <ReportMetric
            label="Pagos con tarjeta"
            value={formatCurrency(paymentTotals.CARD)}
            tone="card"
          />
          <ReportMetric
            label="Pagos por transferencia"
            value={formatCurrency(paymentTotals.TRANSFER)}
            tone="transfer"
          />
        </div>
      </details>

      <div className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground">
          El arqueo y los movimientos de efectivo permanecen aquí. Las acciones comerciales se
          consultan en Logs operativos.
        </p>
        <Button type="button" variant="outline" size="sm" className="shrink-0" asChild>
          <Link href="/operations/logs">
            Ver logs operativos
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      <details className="rounded-md border border-border bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium marker:content-none">
          <span>Detalle comercial de esta sesión</span>
          <span className="text-xs font-normal text-muted-foreground">
            {invoices.length} factura(s) · {salesOrders.length} orden(es)
          </span>
        </summary>
        <div className="space-y-4 border-t border-border p-4">
          <div className="surface-scrollbar max-h-80 overflow-auto rounded-md border border-border bg-white">
            <table className="w-full min-w-[48rem] text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-50">
                <tr className="border-b border-border text-left">
                  <th className="px-3 py-2">Origen</th>
                  <th className="px-3 py-2">Factura</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Cajero</th>
                  <th className="px-3 py-2">Método</th>
                  <th className="px-3 py-2 text-right">Pagado</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length ? (
                  invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2">
                        {invoice.salesOrder
                          ? `Ticket ${invoice.salesOrder.orderNumber}`
                          : 'Venta directa admin'}
                      </td>
                      <td className="px-3 py-2 font-medium">{invoice.invoiceNumber}</td>
                      <td className="px-3 py-2">{invoice.customer?.name ?? 'Consumidor final'}</td>
                      <td className="px-3 py-2">{invoice.issuedBy?.name ?? 'Empleado'}</td>
                      <td className="px-3 py-2">{translatePaymentMethod(invoice.paymentMethod)}</td>
                      <td className="px-3 py-2 text-right">
                        {formatCurrency(Number(invoice.paidAmount))}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatCurrency(Number(invoice.total))}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">
                      Esta sesión no tiene facturas emitidas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="surface-scrollbar max-h-80 overflow-auto rounded-md border border-border bg-white">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-50">
                <tr className="border-b border-border text-left">
                  <th className="px-3 py-2">Orden</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Ordenanza</th>
                  <th className="px-3 py-2">Factura</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {salesOrders.length ? (
                  salesOrders.map((order) => (
                    <tr key={order.id} className="border-b border-border last:border-b-0">
                      <td className="px-3 py-2 font-medium">{order.orderNumber}</td>
                      <td className="px-3 py-2">{order.customer?.name ?? 'Consumidor final'}</td>
                      <td className="px-3 py-2">
                        <Badge variant={getStatusVariant(order.status)}>
                          {translateStatus(order.status)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">{order.createdBy.name}</td>
                      <td className="px-3 py-2">{order.invoice?.invoiceNumber ?? '-'}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatCurrency(Number(order.total))}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                      Esta sesión no tiene órdenes tomadas en caja.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <div className="surface-scrollbar max-h-96 overflow-auto rounded-md border border-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-zinc-50 text-left">
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Usuario</th>
              <th className="px-3 py-2">Referencia</th>
              <th className="px-3 py-2">Metodo</th>
              <th className="px-3 py-2 text-right">Monto</th>
            </tr>
          </thead>
          <tbody>
            {movements.length ? (
              movements.map((movement) => (
                <tr key={movement.id} className="border-b border-border last:border-b-0">
                  <td className="px-3 py-2">{formatDateTime(movement.createdAt)}</td>
                  <td className="px-3 py-2">
                    <span className={getCashMovementPillClass(movement.type)}>
                      {translateCashMovementType(movement.type)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{movement.user?.name ?? 'Empleado'}</td>
                  <td className="px-3 py-2">
                    {movement.invoice?.invoiceNumber ??
                      movement.reference ??
                      movement.reason ??
                      '-'}
                  </td>
                  <td className="px-3 py-2">{translatePaymentMethod(movement.method)}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatCurrency(Number(movement.amount))}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                  Esta sesion no tiene movimientos registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: ReportMetricTone;
}) {
  const classes = reportMetricClasses[tone] ?? reportMetricClasses.neutral;
  const hasNegativeAmount = value.includes('-RD$');

  return (
    <div className={`rounded-md border p-3 ${classes.card}`}>
      <p className={`text-xs ${classes.label}`}>{label}</p>
      <p className={`mt-1 font-semibold ${hasNegativeAmount ? 'text-red-600' : classes.value}`}>
        {value}
      </p>
    </div>
  );
}

function getNegativeAmountClass(amount: number | null) {
  return amount !== null && amount < 0 ? 'font-medium text-red-600' : '';
}

type ReportMetricTone =
  | 'neutral'
  | 'opening'
  | 'sale'
  | 'order'
  | 'quote'
  | 'admin'
  | 'cash'
  | 'card'
  | 'transfer'
  | 'cashIn'
  | 'cashOut'
  | 'adjustment'
  | 'expected'
  | 'counted'
  | 'balanced'
  | 'warning';

const reportMetricClasses: Record<
  ReportMetricTone,
  { card: string; label: string; value: string }
> = {
  neutral: {
    card: 'border-border bg-white',
    label: 'text-muted-foreground',
    value: 'text-zinc-950',
  },
  opening: {
    card: 'border-sky-200 bg-sky-50',
    label: 'text-sky-700',
    value: 'text-sky-950',
  },
  sale: {
    card: 'border-emerald-200 bg-emerald-50',
    label: 'text-emerald-700',
    value: 'text-emerald-950',
  },
  order: {
    card: 'border-[#f36c10]/25 bg-[#f36c10]/10',
    label: 'text-[#9a3f05]',
    value: 'text-[#7a3103]',
  },
  quote: {
    card: 'border-purple-200 bg-purple-50',
    label: 'text-purple-700',
    value: 'text-purple-950',
  },
  admin: {
    card: 'border-violet-200 bg-violet-50',
    label: 'text-violet-700',
    value: 'text-violet-950',
  },
  cash: {
    card: 'border-lime-200 bg-lime-50',
    label: 'text-lime-700',
    value: 'text-lime-950',
  },
  card: {
    card: 'border-indigo-200 bg-indigo-50',
    label: 'text-indigo-700',
    value: 'text-indigo-950',
  },
  transfer: {
    card: 'border-cyan-200 bg-cyan-50',
    label: 'text-cyan-700',
    value: 'text-cyan-950',
  },
  cashIn: {
    card: 'border-teal-200 bg-teal-50',
    label: 'text-teal-700',
    value: 'text-teal-950',
  },
  cashOut: {
    card: 'border-rose-200 bg-rose-50',
    label: 'text-rose-700',
    value: 'text-rose-950',
  },
  adjustment: {
    card: 'border-amber-200 bg-amber-50',
    label: 'text-amber-700',
    value: 'text-amber-950',
  },
  expected: {
    card: 'border-zinc-300 bg-zinc-50',
    label: 'text-zinc-600',
    value: 'text-zinc-950',
  },
  counted: {
    card: 'border-blue-200 bg-blue-50',
    label: 'text-blue-700',
    value: 'text-blue-950',
  },
  balanced: {
    card: 'border-emerald-200 bg-emerald-50',
    label: 'text-emerald-700',
    value: 'text-emerald-950',
  },
  warning: {
    card: 'border-warning/40 bg-warning/10',
    label: 'text-warning',
    value: 'text-warning',
  },
};

function getCashMovementPillClass(type: string) {
  const classes: Record<string, string> = {
    OPENING: 'inline-flex rounded-full bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700',
    SALE_PAYMENT:
      'inline-flex rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700',
    CASH_IN: 'inline-flex rounded-full bg-teal-50 px-2 py-1 text-xs font-medium text-teal-700',
    CASH_OUT: 'inline-flex rounded-full bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700',
    REFUND: 'inline-flex rounded-full bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700',
    CLOSING: 'inline-flex rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700',
    ADJUSTMENT: 'inline-flex rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700',
  };

  return (
    classes[type] ??
    'inline-flex rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700'
  );
}

type ReportInvoice = NonNullable<
  NonNullable<Awaited<ReturnType<typeof closeCashSession>>>['invoices']
>[number];

function sumInvoiceTotals(invoices: ReportInvoice[]) {
  return invoices.reduce((sum, invoice) => sum + Number(invoice.total), 0);
}

function getInvoicePaymentTotals(invoices: ReportInvoice[]) {
  const totals = {
    CASH: 0,
    CARD: 0,
    TRANSFER: 0,
  };

  for (const invoice of invoices) {
    if (invoice.payments?.length) {
      for (const payment of invoice.payments) {
        if (payment.method in totals) {
          totals[payment.method as keyof typeof totals] += Number(payment.amount);
        }
      }
      continue;
    }

    if (invoice.paymentMethod && invoice.paymentMethod in totals) {
      totals[invoice.paymentMethod as keyof typeof totals] += Number(invoice.paidAmount);
    }
  }

  return totals;
}

function getCashSessionSummary(
  cashSession: NonNullable<Awaited<ReturnType<typeof closeCashSession>>>,
) {
  const summary = {
    opening: 0,
    sales: 0,
    cashIn: 0,
    cashOut: 0,
    refunds: 0,
    adjustments: 0,
    expected: 0,
  };

  for (const movement of cashSession.movements ?? []) {
    const amount = Number(movement.amount);
    const affectsCash = !movement.method || movement.method === 'CASH';

    if (movement.type === 'OPENING') {
      summary.opening += amount;
      summary.expected += amount;
    } else if (movement.type === 'SALE_PAYMENT') {
      if (affectsCash) {
        summary.sales += amount;
        summary.expected += amount;
      }
    } else if (movement.type === 'CASH_IN') {
      if (affectsCash) {
        summary.cashIn += amount;
        summary.expected += amount;
      }
    } else if (movement.type === 'CASH_OUT') {
      if (affectsCash) {
        summary.cashOut += amount;
        summary.expected -= amount;
      }
    } else if (movement.type === 'REFUND') {
      if (affectsCash) {
        summary.refunds += amount;
        summary.expected -= amount;
      }
    } else if (movement.type === 'ADJUSTMENT') {
      if (affectsCash) {
        summary.adjustments += amount;
        summary.expected += amount;
      }
    }
  }

  return summary;
}
