'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, CreditCard, Search, ShieldAlert, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  approveCreditSale,
  getCreditApprovals,
  rejectCreditSale,
  type CreditApprovalStatus,
  type CreditSaleApproval,
} from '@/lib/api';
import { isAdminSession } from '@/lib/authorization';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';

const filters: Array<{ value: CreditApprovalStatus | 'ALL'; label: string }> = [
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'APPROVED', label: 'Aprobadas' },
  { value: 'REJECTED', label: 'Rechazadas' },
  { value: 'EXPIRED', label: 'Vencidas' },
  { value: 'CANCELLED', label: 'Canceladas' },
  { value: 'ALL', label: 'Todas' },
];

export function CreditApprovalsView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<CreditApprovalStatus | 'ALL'>('PENDING');
  const [search, setSearch] = useState('');
  const [decision, setDecision] = useState<{
    approval: CreditSaleApproval;
    action: 'APPROVE' | 'REJECT';
  } | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [authorizeLimitExcess, setAuthorizeLimitExcess] = useState(false);

  const approvalsQuery = useQuery({
    queryKey: ['credit-approvals', session?.tenantId, status],
    queryFn: () =>
      getCreditApprovals(
        session?.tenantId ?? '',
        session?.accessToken ?? '',
        status === 'ALL' ? undefined : status,
      ),
    enabled: Boolean(session),
  });

  const decideMutation = useMutation({
    mutationFn: async () => {
      if (!session || !decision) {
        throw new Error('Sesión requerida.');
      }
      const note = decisionNote.trim();
      if (decision.action === 'REJECT') {
        if (!note) {
          throw new Error('Debes indicar el motivo del rechazo.');
        }
        return rejectCreditSale(session.tenantId, session.accessToken, decision.approval.id, note);
      }
      if (decision.approval.exceedsCreditLimit && !authorizeLimitExcess) {
        throw new Error('Debes autorizar explícitamente el exceso del límite.');
      }
      if (decision.approval.exceedsCreditLimit && !note) {
        throw new Error('La autorización sobre el límite requiere una nota.');
      }
      return approveCreditSale(session.tenantId, session.accessToken, decision.approval.id, {
        authorizeLimitExcess,
        decisionNote: note || undefined,
      });
    },
    onSuccess: async (approval) => {
      await queryClient.invalidateQueries({ queryKey: ['credit-approvals'] });
      await queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      toast.success(approval.status === 'APPROVED' ? 'Crédito aprobado' : 'Solicitud rechazada', {
        description: approval.salesOrder.orderNumber,
      });
      closeDecision();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo resolver la solicitud.');
    },
  });

  const approvals = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return approvalsQuery.data ?? [];
    }
    return (approvalsQuery.data ?? []).filter((approval) =>
      [
        approval.salesOrder.orderNumber,
        approval.customer.name,
        approval.customer.documentNumber,
        approval.requestedBy.name,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [approvalsQuery.data, search]);

  if (!session) {
    return <SessionRequired session={session} />;
  }

  const canDecide = isAdminSession(session);

  function openDecision(approval: CreditSaleApproval, action: 'APPROVE' | 'REJECT') {
    setDecision({ approval, action });
    setDecisionNote('');
    setAuthorizeLimitExcess(false);
  }

  function closeDecision() {
    setDecision(null);
    setDecisionNote('');
    setAuthorizeLimitExcess(false);
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Aprobaciones de crédito"
        description="Solicitudes de ventas fiadas. Solo un administrador puede aprobar o rechazar."
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              size="sm"
              variant={status === filter.value ? 'default' : 'outline'}
              onClick={() => setStatus(filter.value)}
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
            placeholder="Buscar por orden, cliente o solicitante"
          />
        </div>
      </div>

      {decision ? (
        <Card className={decision.action === 'APPROVE' ? 'border-sky-200' : 'border-red-200'}>
          <CardHeader>
            <CardTitle>
              {decision.action === 'APPROVE' ? 'Aprobar' : 'Rechazar'}{' '}
              {decision.approval.salesOrder.orderNumber}
            </CardTitle>
            <CardDescription>
              Cliente {decision.approval.customer.name} · saldo financiado{' '}
              {formatCurrency(Number(decision.approval.financedAmount))}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {decision.action === 'APPROVE' && decision.approval.exceedsCreditLimit ? (
              <label className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={authorizeLimitExcess}
                  onChange={(event) => setAuthorizeLimitExcess(event.target.checked)}
                />
                <span>
                  <strong>Autorizar exceso del límite de crédito.</strong> El balance proyectado
                  supera el límite configurado; esta decisión quedará auditada.
                </span>
              </label>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="creditDecisionNote">
                {decision.action === 'REJECT' || decision.approval.exceedsCreditLimit
                  ? 'Motivo / nota *'
                  : 'Nota de decisión (opcional)'}
              </Label>
              <textarea
                id="creditDecisionNote"
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.target.value)}
                maxLength={500}
                className="min-h-24 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={decision.action === 'APPROVE' ? 'default' : 'outline'}
                className={
                  decision.action === 'REJECT'
                    ? 'border-danger/30 text-danger hover:bg-danger/5 hover:text-danger'
                    : undefined
                }
                disabled={decideMutation.isPending}
                onClick={() => decideMutation.mutate()}
              >
                {decision.action === 'APPROVE' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                Confirmar {decision.action === 'APPROVE' ? 'aprobación' : 'rechazo'}
              </Button>
              <Button type="button" variant="outline" onClick={closeDecision}>
                Volver
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4">
        {approvalsQuery.isLoading ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Cargando solicitudes...
            </CardContent>
          </Card>
        ) : approvals.length ? (
          approvals.map((approval) => (
            <ApprovalCard
              key={approval.id}
              approval={approval}
              canDecide={canDecide}
              onApprove={() => openDecision(approval, 'APPROVE')}
              onReject={() => openDecision(approval, 'REJECT')}
            />
          ))
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <CreditCard className="mx-auto h-7 w-7 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No hay solicitudes en este filtro.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ApprovalCard({
  approval,
  canDecide,
  onApprove,
  onReject,
}: {
  approval: CreditSaleApproval;
  canDecide: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const projectedBalance =
    Number(approval.customerBalanceSnapshot) + Number(approval.financedAmount);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{approval.salesOrder.orderNumber}</CardTitle>
              <Badge variant={approvalStatusVariant(approval.status)}>
                {approvalStatusLabel(approval.status)}
              </Badge>
              {approval.exceedsCreditLimit ? <Badge variant="warning">Excede límite</Badge> : null}
            </div>
            <CardDescription className="mt-1">
              {approval.customer.name} · solicitado por {approval.requestedBy.name} el{' '}
              {formatDateTime(approval.requestedAt)}
            </CardDescription>
          </div>
          <p className="text-xl font-bold">{formatCurrency(Number(approval.requestedTotal))}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Inicial" value={formatCurrency(Number(approval.initialPaymentAmount))} />
          <Metric label="A financiar" value={formatCurrency(Number(approval.financedAmount))} />
          <Metric
            label="Balance actual"
            value={formatCurrency(Number(approval.customerBalanceSnapshot))}
          />
          <Metric label="Proyectado" value={formatCurrency(projectedBalance)} />
          <Metric label="Límite" value={formatCurrency(Number(approval.creditLimitSnapshot))} />
        </div>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            Vencimiento: <strong>{formatDate(approval.dueDate)}</strong>
          </p>
          <p>
            Productos: <strong>{approval.salesOrder.items.length}</strong>
          </p>
        </div>
        {approval.requestNote ? (
          <p className="rounded-md bg-zinc-50 p-3 text-sm">
            <strong>Nota:</strong> {approval.requestNote}
          </p>
        ) : null}
        {approval.decisionNote ? (
          <p className="rounded-md bg-zinc-50 p-3 text-sm">
            <strong>Decisión:</strong> {approval.decisionNote}
          </p>
        ) : null}
        {approval.status === 'PENDING' && canDecide ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onApprove}>
              <CheckCircle2 className="h-4 w-4" />
              Aprobar
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-danger/30 text-danger hover:bg-danger/5 hover:text-danger"
              onClick={onReject}
            >
              <XCircle className="h-4 w-4" />
              Rechazar
            </Button>
          </div>
        ) : approval.status === 'PENDING' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldAlert className="h-4 w-4" />
            Pendiente de decisión administrativa.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function approvalStatusLabel(status: CreditApprovalStatus) {
  return {
    PENDING: 'Pendiente',
    APPROVED: 'Aprobada',
    REJECTED: 'Rechazada',
    EXPIRED: 'Vencida',
    CANCELLED: 'Cancelada',
  }[status];
}

function approvalStatusVariant(status: CreditApprovalStatus) {
  if (status === 'APPROVED') return 'success' as const;
  if (status === 'REJECTED' || status === 'CANCELLED') return 'danger' as const;
  if (status === 'EXPIRED') return 'warning' as const;
  return 'outline' as const;
}
