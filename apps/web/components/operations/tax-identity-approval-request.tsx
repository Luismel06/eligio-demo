'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock3, Send, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  cancelTaxIdentityApprovalRequest,
  createTaxIdentityApprovalRequest,
  getTaxIdentityApprovalRequests,
  type TaxIdentityApprovalRequest,
  type TaxIdentityDocumentType,
  type TaxIdentityLookupOutcome,
  type TaxIdentityOverrideResult,
} from '@/lib/api';
import { normalizeDominicanDocument } from '@/lib/dominican-documents';
import { cn, formatDateTime } from '@/lib/utils';

type TaxIdentityApprovalRequestProps = {
  tenantId: string;
  accessToken: string;
  contextType: 'POS_ORDER';
  contextId: string;
  documentType: TaxIdentityDocumentType;
  documentNumber: string;
  suggestedFiscalName?: string;
  registryOutcome?: TaxIdentityLookupOutcome | null;
  disabled?: boolean;
  compact?: boolean;
  onApproved: (result: TaxIdentityOverrideResult) => void;
};

export function TaxIdentityApprovalRequestPanel({
  tenantId,
  accessToken,
  contextType,
  contextId,
  documentType,
  documentNumber,
  suggestedFiscalName = '',
  registryOutcome,
  disabled = false,
  compact = false,
  onApproved,
}: TaxIdentityApprovalRequestProps) {
  const queryClient = useQueryClient();
  const normalizedDocument = normalizeDominicanDocument(documentNumber);
  const [fiscalName, setFiscalName] = useState(suggestedFiscalName.trim());
  const surfacedDecisionRef = useRef<string | null>(null);
  const queryKey = ['tax-identity-approval-requests', tenantId, contextType, contextId] as const;

  useEffect(() => {
    surfacedDecisionRef.current = null;
  }, [contextId, documentType, normalizedDocument]);

  useEffect(() => {
    setFiscalName(suggestedFiscalName.trim());
  }, [contextId, documentType, normalizedDocument, suggestedFiscalName]);

  const requestsQuery = useQuery({
    queryKey,
    queryFn: () =>
      getTaxIdentityApprovalRequests(tenantId, accessToken, { contextType, contextId }),
    enabled: Boolean(contextId && normalizedDocument),
    refetchInterval: (query) => {
      const requests = query.state.data as TaxIdentityApprovalRequest[] | undefined;
      if (!requests) return false;
      const current = findRequestForIdentity(
        requests,
        contextType,
        contextId,
        documentType,
        normalizedDocument,
      );
      return current?.status === 'PENDING' ? 8_000 : false;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });

  const request = requestsQuery.data
    ? (findRequestForIdentity(
        requestsQuery.data,
        contextType,
        contextId,
        documentType,
        normalizedDocument,
      ) ?? null)
    : null;

  useEffect(() => {
    if (request?.fiscalName) {
      setFiscalName(request.fiscalName);
    }
  }, [request?.fiscalName, request?.id]);

  const createMutation = useMutation({
    mutationFn: () => {
      const normalizedFiscalName = fiscalName.replace(/\s+/g, ' ').trim();
      if (normalizedFiscalName.length < 2) {
        throw new Error('Digita la razón social o el nombre fiscal que aparecerá en la factura.');
      }

      return createTaxIdentityApprovalRequest(tenantId, accessToken, {
        contextType,
        contextId,
        documentType,
        documentNumber: normalizedDocument,
        fiscalName: normalizedFiscalName,
        reason: getApprovalRequestReason(registryOutcome),
      });
    },
    onSuccess: async (created) => {
      queryClient.setQueryData<TaxIdentityApprovalRequest[]>(queryKey, (current = []) => [
        created,
        ...current.filter((candidate) => candidate.id !== created.id),
      ]);
      await queryClient.invalidateQueries({ queryKey: ['tax-identity-approval-requests'] });
      toast.success('Solicitud enviada al administrador', {
        description: 'El estado se actualizará aquí automáticamente cuando sea revisada.',
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo enviar la solicitud de validación.',
      );
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!request || request.status !== 'PENDING') {
        throw new Error('La solicitud ya no está pendiente.');
      }
      return cancelTaxIdentityApprovalRequest(tenantId, accessToken, request.id);
    },
    onSuccess: async (cancelled) => {
      queryClient.setQueryData<TaxIdentityApprovalRequest[]>(queryKey, (current = []) => [
        cancelled,
        ...current.filter((candidate) => candidate.id !== cancelled.id),
      ]);
      await queryClient.invalidateQueries({ queryKey: ['tax-identity-approval-requests'] });
      toast.success('Solicitud cancelada', {
        description: 'Puedes corregir los datos y enviar una nueva solicitud.',
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo cancelar la solicitud.');
    },
  });

  const overrideUsable = isApprovalOverrideUsable(request);

  useEffect(() => {
    if (!request || request.status === 'PENDING') {
      return;
    }

    const decisionKey = `${request.id}:${request.status}:${request.decidedAt ?? ''}`;
    if (surfacedDecisionRef.current === decisionKey) {
      return;
    }

    surfacedDecisionRef.current = decisionKey;
    if (request.status === 'APPROVED' && overrideUsable) {
      onApproved(approvalRequestToLookup(request));
      toast.success('Validación fiscal aprobada', {
        description: 'La identidad manual ya está habilitada para este registro.',
      });
      return;
    }

    if (request.status === 'REJECTED') {
      toast.error('Solicitud de validación rechazada', {
        description:
          request.decisionNote ?? 'Revisa el documento y el nombre fiscal antes de reenviarla.',
      });
    }
  }, [onApproved, overrideUsable, request]);

  const pending = request?.status === 'PENDING';
  const canSubmit =
    !disabled &&
    !createMutation.isPending &&
    !cancelMutation.isPending &&
    !pending &&
    !overrideUsable &&
    fiscalName.trim().length >= 2;

  return (
    <div
      className={cn(
        'space-y-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-950',
        compact && 'p-2.5',
      )}
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">Validación manual administrativa</p>
          <p className="mt-1 text-xs leading-5">
            DGII no pudo verificar este documento. Digita el nombre fiscal y envía la solicitud; no
            tendrás que pedir ni introducir la contraseña del administrador.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`tax-approval-fiscal-name-${contextId}`}>
          Razón social o nombre fiscal manual
        </Label>
        <Input
          id={`tax-approval-fiscal-name-${contextId}`}
          value={fiscalName}
          onChange={(event) => setFiscalName(event.target.value)}
          disabled={disabled || pending || overrideUsable || createMutation.isPending}
          maxLength={200}
          autoComplete="organization"
          placeholder="Escribe el nombre que debe aparecer en la factura"
          aria-describedby={`tax-approval-help-${contextId}`}
        />
        <p id={`tax-approval-help-${contextId}`} className="text-xs text-amber-900/80">
          El administrador podrá comprobarlo y corregirlo antes de aprobar.
        </p>
      </div>

      {request ? <ApprovalStatus request={request} overrideUsable={overrideUsable} /> : null}

      {pending ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-amber-300 bg-white"
          disabled={disabled || cancelMutation.isPending}
          onClick={() => cancelMutation.mutate()}
        >
          <XCircle className="h-4 w-4" aria-hidden="true" />
          {cancelMutation.isPending ? 'Cancelando...' : 'Cancelar solicitud'}
        </Button>
      ) : !overrideUsable ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-amber-300 bg-white"
          disabled={!canSubmit}
          onClick={() => createMutation.mutate()}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {request?.status === 'REJECTED' ||
          request?.status === 'EXPIRED' ||
          request?.status === 'CANCELLED' ||
          request?.status === 'APPROVED'
            ? 'Enviar nueva solicitud'
            : 'Enviar solicitud al administrador'}
        </Button>
      ) : null}

      {requestsQuery.isError ? (
        <div className="flex flex-wrap items-center gap-2" role="alert">
          <p className="text-xs text-danger">No se pudo actualizar el estado de la solicitud.</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={requestsQuery.isFetching}
            onClick={() => void requestsQuery.refetch()}
          >
            Actualizar estado
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ApprovalStatus({
  request,
  overrideUsable,
}: {
  request: TaxIdentityApprovalRequest;
  overrideUsable: boolean;
}) {
  const status = getApprovalStatusDisplay(request, overrideUsable);
  const Icon = status.icon;

  return (
    <div
      className={cn('rounded-md border px-3 py-2 text-sm', status.className)}
      role={request.status === 'REJECTED' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="flex items-center gap-2 font-semibold">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{status.label}</span>
      </div>
      <p className="mt-1 text-xs leading-5">{status.description}</p>
      {request.decisionNote ? (
        <p className="mt-1 text-xs">
          <strong>Nota:</strong> {request.decisionNote}
        </p>
      ) : null}
      <p className="mt-1 text-[0.7rem] opacity-75">
        Solicitada {formatDateTime(request.requestedAt)}
      </p>
    </div>
  );
}

function getApprovalStatusDisplay(request: TaxIdentityApprovalRequest, overrideUsable: boolean) {
  if (request.status === 'PENDING') {
    return {
      icon: Clock3,
      label: 'Pendiente de revisión administrativa',
      description: 'La solicitud ya está en la bandeja del administrador. No necesitas reenviarla.',
      className: 'border-sky-200 bg-sky-50 text-sky-950',
    };
  }
  if (request.status === 'APPROVED' && overrideUsable) {
    return {
      icon: CheckCircle2,
      label: 'Aprobada',
      description: 'La identidad fiscal manual está lista para utilizarse una vez.',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    };
  }
  if (request.status === 'APPROVED' && request.override?.usedAt) {
    return {
      icon: CheckCircle2,
      label: 'Aprobada · autorización utilizada',
      description: 'La autorización manual ya fue consumida por el registro o la operación.',
      className: 'border-zinc-200 bg-zinc-50 text-zinc-800',
    };
  }
  if (request.status === 'APPROVED') {
    return {
      icon: Clock3,
      label: request.override ? 'Aprobada · autorización vencida' : 'Aprobada',
      description: request.override
        ? 'La aprobación se conserva en el historial, pero su autorización temporal venció.'
        : 'La aprobación no tiene una autorización activa. Envía una nueva solicitud.',
      className: 'border-amber-200 bg-amber-50 text-amber-950',
    };
  }
  if (request.status === 'REJECTED') {
    return {
      icon: XCircle,
      label: 'Rechazada',
      description: 'Corrige el nombre o el documento antes de enviar otra solicitud.',
      className: 'border-red-200 bg-red-50 text-red-950',
    };
  }
  return {
    icon: Clock3,
    label: request.status === 'CANCELLED' ? 'Cancelada' : 'Vencida',
    description: 'Esta solicitud ya no puede utilizarse. Puedes enviar una nueva.',
    className: 'border-zinc-200 bg-white text-zinc-800',
  };
}

function isApprovalOverrideUsable(request: TaxIdentityApprovalRequest | null) {
  if (request?.status !== 'APPROVED' || !request.override || request.override.usedAt) {
    return false;
  }

  const expiresAt = Date.parse(request.override.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function approvalRequestToLookup(request: TaxIdentityApprovalRequest): TaxIdentityOverrideResult {
  if (!request.override) {
    throw new Error('La solicitud aprobada no contiene una autorización utilizable.');
  }

  return {
    outcome: 'VERIFIED',
    documentType: request.documentType,
    documentNumber: request.documentNumber,
    fiscalName: request.fiscalName,
    registryStatus: 'MANUAL_OVERRIDE',
    source: 'MANUAL_OVERRIDE',
    sourceUpdatedAt: request.decidedAt ?? request.requestedAt,
    checkedAt: request.decidedAt ?? request.requestedAt,
    overrideId: request.override.overrideId,
    expiresAt: request.override.expiresAt,
  };
}

function getApprovalRequestReason(outcome?: TaxIdentityLookupOutcome | null) {
  const descriptions: Partial<Record<TaxIdentityLookupOutcome, string>> = {
    NOT_FOUND: 'Documento no encontrado en el padrón DGII; requiere revisión manual.',
    NON_ACTIVE: 'Documento con estado no activo en DGII; requiere revisión manual.',
    REGISTRY_STALE: 'Padrón DGII desactualizado; requiere revisión manual.',
    UNAVAILABLE: 'Consulta DGII no disponible; requiere revisión manual.',
  };

  return descriptions[outcome ?? 'UNAVAILABLE'] ?? descriptions.UNAVAILABLE;
}

function findRequestForIdentity(
  requests: TaxIdentityApprovalRequest[],
  contextType: 'POS_ORDER',
  contextId: string,
  documentType: TaxIdentityDocumentType,
  normalizedDocument: string,
) {
  return requests.find(
    (candidate) =>
      candidate.contextType === contextType &&
      candidate.contextId === contextId &&
      candidate.documentType === documentType &&
      normalizeDominicanDocument(candidate.documentNumber) === normalizedDocument,
  );
}
