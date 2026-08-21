'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  lookupTaxIdentity,
  type TaxIdentityDocumentType,
  type TaxIdentityLookup,
  type TaxIdentityOverrideResult,
  type TaxIdentityVerificationEvidence,
} from '@/lib/api';
import {
  formatDominicanDocument,
  normalizeDominicanDocument,
  validateDominicanDocument,
} from '@/lib/dominican-documents';
import { cn } from '@/lib/utils';

export type TaxIdentityVerificationState = {
  result: TaxIdentityLookup | null;
  documentType: TaxIdentityDocumentType;
  documentNumber: string;
  checksumValid: boolean;
  pending: boolean;
};

export function hasVerifiedTaxIdentity(
  state: TaxIdentityVerificationState | null,
  documentType: TaxIdentityDocumentType,
  documentNumber: string,
) {
  return Boolean(
    state?.result?.outcome === 'VERIFIED' &&
    state.result.fiscalName?.trim() &&
    state.documentType === documentType &&
    state.documentNumber === normalizeDominicanDocument(documentNumber),
  );
}

type TaxIdentityVerificationProps = {
  tenantId: string;
  accessToken: string;
  documentType: TaxIdentityDocumentType;
  documentNumber: string;
  onChange?: (state: TaxIdentityVerificationState) => void;
  overrideAction?: React.ReactNode;
  manualOverride?: TaxIdentityOverrideResult | null;
  storedVerification?: TaxIdentityVerificationEvidence | null;
  className?: string;
};

export function TaxIdentityVerification({
  tenantId,
  accessToken,
  documentType,
  documentNumber,
  onChange,
  overrideAction,
  manualOverride,
  storedVerification,
  className,
}: TaxIdentityVerificationProps) {
  const [, setExpirationTick] = useState(0);
  const normalizedDocument = normalizeDominicanDocument(documentNumber);
  const hasInput = documentNumber.trim().length > 0;
  const checksumValid = validateDominicanDocument(documentType, documentNumber);
  const usableManualOverride = Boolean(
    manualOverride?.outcome === 'VERIFIED' &&
    manualOverride.documentType === documentType &&
    normalizeDominicanDocument(manualOverride.documentNumber) === normalizedDocument &&
    new Date(manualOverride.expiresAt).getTime() > Date.now(),
  );
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;

  useEffect(() => {
    if (
      !manualOverride ||
      manualOverride.documentType !== documentType ||
      normalizeDominicanDocument(manualOverride.documentNumber) !== normalizedDocument
    ) {
      return;
    }

    const expirationTime = new Date(manualOverride.expiresAt).getTime();
    if (!Number.isFinite(expirationTime) || expirationTime <= Date.now()) return;

    const timeout = window.setTimeout(
      () => setExpirationTick((current) => current + 1),
      expirationTime - Date.now() + 50,
    );

    return () => window.clearTimeout(timeout);
  }, [documentType, manualOverride, normalizedDocument]);

  const query = useQuery({
    queryKey: ['tax-identity', tenantId, documentType, normalizedDocument],
    queryFn: () =>
      lookupTaxIdentity(tenantId, accessToken, {
        documentType,
        documentNumber: normalizedDocument,
      }),
    enabled: Boolean(tenantId && accessToken && checksumValid && !usableManualOverride),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const currentResult = useMemo(() => {
    if (manualOverride && usableManualOverride) {
      return manualOverride;
    }

    const result = query.data;
    if (
      !result ||
      result.documentType !== documentType ||
      normalizeDominicanDocument(result.documentNumber) !== normalizedDocument
    ) {
      return null;
    }
    return result;
  }, [documentType, manualOverride, normalizedDocument, query.data, usableManualOverride]);

  useEffect(() => {
    callbackRef.current?.({
      result: checksumValid ? currentResult : null,
      documentType,
      documentNumber: normalizedDocument,
      checksumValid,
      pending: checksumValid && query.isFetching,
    });
  }, [checksumValid, currentResult, documentType, normalizedDocument, query.isFetching]);

  if (!hasInput) {
    return (
      <div
        className={cn(
          'rounded-md border border-dashed p-3 text-xs text-muted-foreground',
          className,
        )}
        aria-live="polite"
      >
        Escribe el {documentType === 'RNC' ? 'RNC' : 'número de cédula'} para consultar la identidad
        fiscal en el padrón de DGII.
      </div>
    );
  }

  if (!checksumValid) {
    return (
      <div
        className={cn('rounded-md border border-warning/35 bg-warning/10 p-3 text-sm', className)}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            Completa un{' '}
            {documentType === 'RNC'
              ? 'RNC válido de 9 dígitos'
              : 'número de cédula válido de 11 dígitos'}
            .
          </p>
        </div>
      </div>
    );
  }

  if (query.isLoading || (query.isFetching && !currentResult)) {
    return (
      <div
        className={cn(
          'rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900',
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Consultando el padrón fiscal de DGII…
        </div>
      </div>
    );
  }

  if (query.isError && !currentResult) {
    return (
      <StatusPanel
        tone="warning"
        title="No fue posible consultar DGII"
        description="El documento no ha sido verificado. Intenta nuevamente; si el servicio continúa indisponible, solicita autorización de un supervisor."
        onRetry={() => void query.refetch()}
        refreshing={query.isFetching}
        overrideAction={overrideAction}
        storedVerification={storedVerification}
        className={className}
      />
    );
  }

  if (!currentResult) return null;

  if (currentResult.outcome === 'VERIFIED') {
    const manual = currentResult.source === 'MANUAL_OVERRIDE';
    const manualExpiresAt =
      manual && manualOverride && manualOverride.overrideId === currentResult.overrideId
        ? manualOverride.expiresAt
        : null;
    return (
      <div
        className={cn(
          'rounded-md border p-3 text-sm',
          manual
            ? 'border-amber-300 bg-amber-50 text-amber-950'
            : 'border-emerald-200 bg-emerald-50 text-emerald-950',
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-2">
          <CheckCircle2
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0',
              manual ? 'text-amber-700' : 'text-emerald-700',
            )}
            aria-hidden="true"
          />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">
              {manual
                ? 'Identidad autorizada manualmente por un supervisor'
                : 'Razón social verificada por DGII'}
            </p>
            <p className="break-words text-base font-medium">{currentResult.fiscalName}</p>
            <p className={cn('text-xs', manual ? 'text-amber-800' : 'text-emerald-800')}>
              {documentType} {formatDominicanDocument(documentType, normalizedDocument)}
              {currentResult.registryStatus
                ? ` · Estado: ${translateRegistryStatus(currentResult.registryStatus)}`
                : ''}
            </p>
            <p className={cn('text-xs', manual ? 'text-amber-800' : 'text-emerald-800')}>
              Fuente:{' '}
              {currentResult.source === 'MANUAL_OVERRIDE'
                ? 'Autorización manual'
                : (currentResult.source ?? 'DGII')}
              {currentResult.sourceUpdatedAt
                ? ` · Padrón actualizado ${formatVerificationDate(currentResult.sourceUpdatedAt)}`
                : ''}
            </p>
            {manualExpiresAt ? (
              <p className="text-xs font-medium text-amber-800">
                Válida hasta {formatVerificationDate(manualExpiresAt)}. Guarda el registro antes de
                que expire.
              </p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const copy = outcomeCopy(currentResult);
  return (
    <StatusPanel
      tone={currentResult.outcome === 'NON_ACTIVE' ? 'danger' : 'warning'}
      title={copy.title}
      description={copy.description}
      detail={
        currentResult.sourceUpdatedAt
          ? `Padrón actualizado ${formatVerificationDate(currentResult.sourceUpdatedAt)}.`
          : undefined
      }
      onRetry={() => void query.refetch()}
      refreshing={query.isFetching}
      overrideAction={overrideAction}
      storedVerification={
        currentResult.outcome === 'UNAVAILABLE' || currentResult.outcome === 'REGISTRY_STALE'
          ? storedVerification
          : null
      }
      className={className}
    />
  );
}

function StatusPanel({
  tone,
  title,
  description,
  detail,
  onRetry,
  refreshing,
  overrideAction,
  storedVerification,
  className,
}: {
  tone: 'warning' | 'danger';
  title: string;
  description: string;
  detail?: string;
  onRetry: () => void;
  refreshing: boolean;
  overrideAction?: React.ReactNode;
  storedVerification?: TaxIdentityVerificationEvidence | null;
  className?: string;
}) {
  const danger = tone === 'danger';
  return (
    <div
      className={cn(
        'rounded-md border p-3 text-sm',
        danger ? 'border-danger/30 bg-danger/5 text-danger' : 'border-warning/35 bg-warning/10',
        className,
      )}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        {danger ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold">{title}</p>
          <p className={danger ? undefined : 'text-foreground'}>{description}</p>
          {detail ? <p className="text-xs opacity-80">{detail}</p> : null}
          {hasStoredTaxIdentityVerification(storedVerification) ? (
            <div className="space-y-1">
              <p className="text-xs font-medium">
                Este registro conserva una verificación anterior. Puedes editar sus datos de
                contacto siempre que no cambies el documento fiscal.
              </p>
              <TaxIdentityVerificationBadge verification={storedVerification} />
            </div>
          ) : (
            <>
              <p className="text-xs font-medium">
                Para continuar se requiere verificación manual y autorización de un supervisor.
              </p>
              {overrideAction ? <div className="pt-1">{overrideAction}</div> : null}
            </>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={refreshing}
          aria-label="Consultar nuevamente en DGII"
        >
          <RefreshCw
            className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')}
            aria-hidden="true"
          />
          Reintentar
        </Button>
      </div>
    </div>
  );
}

export function hasStoredTaxIdentityVerification(
  verification: TaxIdentityVerificationEvidence | null | undefined,
) {
  return verification?.outcome === 'VERIFIED' || verification?.outcome === 'MANUAL_OVERRIDE';
}

export function TaxIdentityVerificationBadge({
  verification,
  applicable = true,
  className,
}: {
  verification: TaxIdentityVerificationEvidence | null | undefined;
  applicable?: boolean;
  className?: string;
}) {
  if (!applicable) {
    return <Badge variant="outline">No fiscal</Badge>;
  }

  if (!verification) {
    return (
      <div className={cn('space-y-1', className)}>
        <Badge variant="warning">Pendiente de verificar</Badge>
        <p className="text-xs text-muted-foreground">Sin evidencia fiscal guardada.</p>
      </div>
    );
  }

  const manual = verification.source === 'MANUAL_OVERRIDE';
  const date = verification.sourceUpdatedAt ?? verification.verifiedAt;
  return (
    <div className={cn('space-y-1', className)}>
      <Badge variant={manual ? 'warning' : 'success'}>
        {manual ? 'Autorizado por supervisor' : 'Verificado por DGII'}
      </Badge>
      <p className="text-xs text-muted-foreground">
        {translateVerificationSource(verification.source)}
        {verification.registryStatus
          ? ` · ${translateRegistryStatus(verification.registryStatus)}`
          : ''}
        {date ? ` · ${formatVerificationDate(date)}` : ''}
      </p>
    </div>
  );
}

function translateVerificationSource(source: TaxIdentityVerificationEvidence['source']) {
  if (source === 'DGII_OFFICIAL') return 'DGII · padrón oficial';
  if (source === 'TEST_FIXTURE') return 'Padrón de prueba';
  return 'Autorización manual';
}

function outcomeCopy(result: TaxIdentityLookup) {
  switch (result.outcome) {
    case 'NOT_FOUND':
      return {
        title: 'Documento no encontrado en el padrón DGII',
        description:
          'Esto no significa que el número sea matemáticamente inválido, pero su identidad fiscal no pudo verificarse.',
      };
    case 'NON_ACTIVE':
      return {
        title: 'Contribuyente sin estado activo',
        description: `${result.fiscalName ?? 'La identidad consultada'} figura con estado ${translateRegistryStatus(result.registryStatus ?? 'NO ACTIVO')}.`,
      };
    case 'REGISTRY_STALE':
      return {
        title: 'El padrón local necesita actualización',
        description:
          'No se usará este resultado para registrar datos fiscales hasta sincronizar nuevamente con DGII.',
      };
    default:
      return {
        title: 'Consulta DGII no disponible',
        description: 'No fue posible confirmar la identidad fiscal en este momento.',
      };
  }
}

function translateRegistryStatus(status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === 'ACTIVE' || normalized === 'ACTIVO') return 'Activo';
  if (normalized === 'INACTIVE' || normalized === 'INACTIVO') return 'Inactivo';
  return status;
}

function formatVerificationDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-DO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
