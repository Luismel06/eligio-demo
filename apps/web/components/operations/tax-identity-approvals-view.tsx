'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Search, ShieldCheck, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  approveTaxIdentityApprovalRequest,
  getTaxIdentityApprovalRequests,
  rejectTaxIdentityApprovalRequest,
  type TaxIdentityApprovalRequest,
  type TaxIdentityApprovalRequestStatus,
} from '@/lib/api';
import { isAdminSession } from '@/lib/authorization';
import { formatDominicanDocument } from '@/lib/dominican-documents';
import { formatDateTime } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';

const filters: Array<{ value: TaxIdentityApprovalRequestStatus | 'ALL'; label: string }> = [
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'APPROVED', label: 'Aprobadas' },
  { value: 'REJECTED', label: 'Rechazadas' },
  { value: 'EXPIRED', label: 'Vencidas' },
  { value: 'CANCELLED', label: 'Canceladas' },
  { value: 'ALL', label: 'Todas' },
];

export function TaxIdentityApprovalsView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<TaxIdentityApprovalRequestStatus | 'ALL'>('PENDING');
  const [search, setSearch] = useState('');
  const [decision, setDecision] = useState<{
    request: TaxIdentityApprovalRequest;
    action: 'APPROVE' | 'REJECT';
  } | null>(null);
  const [fiscalName, setFiscalName] = useState('');
  const [decisionNote, setDecisionNote] = useState('');

  const requestsQuery = useQuery({
    queryKey: ['tax-identity-approval-requests', session?.tenantId, status],
    queryFn: () =>
      getTaxIdentityApprovalRequests(
        session?.tenantId ?? '',
        session?.accessToken ?? '',
        status === 'ALL' ? {} : { status },
      ),
    enabled: Boolean(session && isAdminSession(session)),
    refetchInterval: status === 'PENDING' ? 10_000 : 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });

  const decideMutation = useMutation({
    mutationFn: () => {
      if (!session || !decision) {
        throw new Error('Sesión requerida.');
      }

      if (decision.action === 'REJECT') {
        const note = decisionNote.trim();
        if (note.length < 3) {
          throw new Error('Indica el motivo del rechazo.');
        }
        return rejectTaxIdentityApprovalRequest(
          session.tenantId,
          session.accessToken,
          decision.request.id,
          note,
        );
      }

      const approvedFiscalName = fiscalName.replace(/\s+/g, ' ').trim();
      if (approvedFiscalName.length < 2) {
        throw new Error('Confirma o corrige la razón social antes de aprobar.');
      }
      return approveTaxIdentityApprovalRequest(
        session.tenantId,
        session.accessToken,
        decision.request.id,
        {
          fiscalName: approvedFiscalName,
          decisionNote: decisionNote.trim() || undefined,
          expiresInMinutes: 10,
        },
      );
    },
    onSuccess: async (request) => {
      await queryClient.invalidateQueries({ queryKey: ['tax-identity-approval-requests'] });
      toast.success(request.status === 'APPROVED' ? 'Validación aprobada' : 'Solicitud rechazada', {
        description:
          request.status === 'APPROVED'
            ? 'Caja recibirá la aprobación automáticamente.'
            : request.fiscalName,
      });
      closeDecision();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo resolver la solicitud.');
    },
  });

  const requests = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es-DO');
    if (!query) return requestsQuery.data ?? [];

    return (requestsQuery.data ?? []).filter((request) =>
      [
        request.fiscalName,
        request.documentNumber,
        request.documentLast4,
        request.requestedBy.name,
        request.requestedBy.email,
      ]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase('es-DO').includes(query)),
    );
  }, [requestsQuery.data, search]);

  if (!session) {
    return <SessionRequired session={session} />;
  }

  if (!isAdminSession(session)) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold">Acceso administrativo requerido</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Solo un administrador puede aprobar o rechazar validaciones fiscales manuales.
          </p>
        </CardContent>
      </Card>
    );
  }

  function openDecision(request: TaxIdentityApprovalRequest, action: 'APPROVE' | 'REJECT') {
    setDecision({ request, action });
    setFiscalName(request.fiscalName);
    setDecisionNote('');
  }

  function closeDecision() {
    setDecision(null);
    setFiscalName('');
    setDecisionNote('');
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Validaciones fiscales"
        description="Solicitudes enviadas por Caja cuando un RNC o una cédula no pudo verificarse automáticamente con DGII."
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
          {filters.map((filter) => (
            <Button
              key={filter.value}
              type="button"
              size="sm"
              variant={status === filter.value ? 'default' : 'outline'}
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        <div className="relative max-w-xl">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Label htmlFor="tax-approval-search" className="sr-only">
            Buscar solicitudes fiscales
          </Label>
          <Input
            id="tax-approval-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="bg-white pl-9"
            placeholder="Buscar por nombre, documento o solicitante"
          />
        </div>
      </div>

      {decision ? (
        <Card className={decision.action === 'APPROVE' ? 'border-sky-200' : 'border-red-200'}>
          <CardHeader>
            <CardTitle>
              {decision.action === 'APPROVE' ? 'Revisar y aprobar' : 'Rechazar'} identidad fiscal
            </CardTitle>
            <CardDescription>
              {decision.request.documentType}{' '}
              {formatDominicanDocument(
                decision.request.documentType,
                decision.request.documentNumber,
              )}{' '}
              · solicitada por {decision.request.requestedBy.name}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {decision.action === 'APPROVE' ? (
              <div className="space-y-2">
                <Label htmlFor="tax-approval-fiscal-name">Razón social o nombre fiscal *</Label>
                <Input
                  id="tax-approval-fiscal-name"
                  value={fiscalName}
                  onChange={(event) => setFiscalName(event.target.value)}
                  maxLength={200}
                  autoComplete="organization"
                />
                <p className="text-xs text-muted-foreground">
                  Comprueba el documento presentado. Puedes corregir el nombre antes de aprobar;
                  este será el que se use fiscalmente.
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="tax-approval-decision-note">
                {decision.action === 'REJECT' ? 'Motivo del rechazo *' : 'Nota (opcional)'}
              </Label>
              <textarea
                id="tax-approval-decision-note"
                value={decisionNote}
                onChange={(event) => setDecisionNote(event.target.value)}
                maxLength={500}
                className="min-h-24 w-full rounded-md border border-input bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <XCircle className="h-4 w-4" aria-hidden="true" />
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

      <div className="grid gap-4" aria-live="polite">
        {requestsQuery.isLoading ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Cargando solicitudes...
            </CardContent>
          </Card>
        ) : requestsQuery.isError ? (
          <Card className="border-danger/20">
            <CardContent className="p-6 text-sm text-danger" role="alert">
              No se pudieron cargar las solicitudes. Intenta nuevamente.
            </CardContent>
          </Card>
        ) : requests.length ? (
          requests.map((request) => (
            <ApprovalCard
              key={request.id}
              request={request}
              onApprove={() => openDecision(request, 'APPROVE')}
              onReject={() => openDecision(request, 'REJECT')}
            />
          ))
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <ShieldCheck className="mx-auto h-7 w-7 text-muted-foreground" />
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
  request,
  onApprove,
  onReject,
}: {
  request: TaxIdentityApprovalRequest;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="break-words">{request.fiscalName}</CardTitle>
              <Badge variant={approvalStatusVariant(request.status)}>
                {approvalStatusLabel(request.status)}
              </Badge>
            </div>
            <CardDescription className="mt-1">
              Solicitada por {request.requestedBy.name} el {formatDateTime(request.requestedAt)}
            </CardDescription>
          </div>
          <Badge variant="outline">{contextReference(request)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Metric
            label="Documento"
            value={`${request.documentType} ${formatDominicanDocument(
              request.documentType,
              request.documentNumber,
            )}`}
          />
          <Metric label="Resultado DGII" value={registryOutcomeLabel(request.registryOutcome)} />
          <Metric label="Fuente" value={registrySourceLabel(request.registrySource)} />
          <Metric
            label="Padrón actualizado"
            value={formatDateTime(request.registrySourceUpdatedAt)}
          />
          <Metric label="Consultado" value={formatDateTime(request.registryCheckedAt)} />
          <Metric label="Vence" value={formatDateTime(request.expiresAt)} />
        </dl>
        {request.reason ? (
          <p className="rounded-md bg-zinc-50 p-3 text-sm">
            <strong>Motivo de solicitud:</strong> {request.reason}
          </p>
        ) : null}
        {request.decisionNote ? (
          <p className="rounded-md bg-zinc-50 p-3 text-sm">
            <strong>Decisión:</strong> {request.decisionNote}
          </p>
        ) : null}
        {request.status === 'PENDING' ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onApprove}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Revisar y aprobar
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-danger/30 text-danger hover:bg-danger/5 hover:text-danger"
              onClick={onReject}
            >
              <XCircle className="h-4 w-4" aria-hidden="true" />
              Rechazar
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-zinc-200 bg-zinc-50 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold">{value}</dd>
    </div>
  );
}

function approvalStatusLabel(status: TaxIdentityApprovalRequestStatus) {
  return {
    PENDING: 'Pendiente',
    APPROVED: 'Aprobada',
    REJECTED: 'Rechazada',
    EXPIRED: 'Vencida',
    CANCELLED: 'Cancelada',
  }[status];
}

function approvalStatusVariant(status: TaxIdentityApprovalRequestStatus) {
  if (status === 'APPROVED') return 'success' as const;
  if (status === 'REJECTED' || status === 'CANCELLED') return 'danger' as const;
  if (status === 'EXPIRED') return 'warning' as const;
  return 'outline' as const;
}

function registryOutcomeLabel(outcome: TaxIdentityApprovalRequest['registryOutcome']) {
  return {
    NOT_FOUND: 'No encontrado',
    NON_ACTIVE: 'No activo',
    REGISTRY_STALE: 'Padrón desactualizado',
    UNAVAILABLE: 'No disponible',
  }[outcome];
}

function registrySourceLabel(source: string | null) {
  if (!source) return 'No disponible';
  if (source === 'DGII_OFFICIAL') return 'Padrón oficial DGII';
  if (source === 'TEST_FIXTURE') return 'Padrón de prueba';
  return source.replace(/_/g, ' ');
}

function contextLabel(context: TaxIdentityApprovalRequest['contextType']) {
  return context === 'POS_ORDER' ? 'Caja' : 'Contexto retirado';
}

function contextReference(request: TaxIdentityApprovalRequest) {
  const suffix = request.contextId.slice(-8);
  const safeSuffix = request.contextId.length > 8 ? `…${suffix}` : suffix;
  return `${contextLabel(request.contextType)} · ${safeSuffix}`;
}
