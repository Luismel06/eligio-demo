'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createFiscalSequence,
  getFiscalSequences,
  type FiscalSequence,
  type LocalNcfDocumentType,
} from '@/lib/api';
import {
  getStatusVariant,
  translateInvoiceDocumentType,
  translateStatus,
} from '@/lib/display-labels';
import { formatDateOnly } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';

export function FiscalSequencesView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    documentType: 'CONSUMER_02' as LocalNcfDocumentType,
    startNumber: '',
    endNumber: '',
    nextNumber: '',
    authorizationNumber: '',
    validUntil: '',
  });
  const sequencesQuery = useQuery({
    queryKey: ['fiscal-sequences', session?.tenantId],
    queryFn: () => getFiscalSequences(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });

  useEffect(() => {
    if (!sequencesQuery.data) {
      return;
    }

    const suggestedStart = getSuggestedStart(sequencesQuery.data, form.documentType);
    if (suggestedStart === null) {
      return;
    }

    setForm((current) => {
      if (current.startNumber || current.nextNumber) {
        return current;
      }

      const value = String(suggestedStart);
      return { ...current, startNumber: value, nextNumber: value };
    });
  }, [form.documentType, sequencesQuery.data]);

  const createMutation = useMutation({
    mutationFn: () => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return createFiscalSequence(session.tenantId, session.accessToken, {
        documentType: form.documentType,
        startNumber: Number(form.startNumber),
        endNumber: Number(form.endNumber),
        nextNumber: Number(form.nextNumber),
        authorizationNumber: form.authorizationNumber.trim(),
        validUntil: form.validUntil || undefined,
      });
    },
    onSuccess: async (sequence) => {
      const nextSequences = [
        ...(sequencesQuery.data ?? []).filter((candidate) => candidate.id !== sequence.id),
        sequence,
      ];
      setForm((current) => {
        const nextStart = getSuggestedStart(nextSequences, current.documentType);

        return {
          ...current,
          startNumber: nextStart === null ? '' : String(nextStart),
          endNumber: '',
          nextNumber: nextStart === null ? '' : String(nextStart),
          authorizationNumber: '',
          validUntil: '',
        };
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fiscal-sequences'] }),
        queryClient.invalidateQueries({ queryKey: ['operational-alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
      ]);
      toast.success(
        sequence.status === 'INACTIVE'
          ? 'Bloque fiscal registrado y puesto en espera.'
          : 'Bloque fiscal registrado y activado.',
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar la secuencia.');
    },
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  const canManage =
    Boolean(session.permissions.canManageFiscalSequences) ||
    ['ADMIN', 'SUPER_ADMIN', 'QORVEX_SUPER_ADMIN'].includes(session.role);
  const activeForSelectedType = (sequencesQuery.data ?? []).some(
    (sequence) => sequence.documentType === form.documentType && sequence.status === 'ACTIVE',
  );
  const suggestedStart = sequencesQuery.data
    ? getSuggestedStart(sequencesQuery.data, form.documentType)
    : null;

  function submitSequence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Secuencias fiscales"
        description="Autorizaciones locales NCF B01 y B02 asignadas por DGII."
      />

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Agregar un nuevo bloque autorizado</CardTitle>
            <CardDescription>
              Cada autorización se conserva como un bloque independiente. Nunca se amplía ni se
              reinicia un rango que ya fue registrado.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-medium">
                {!sequencesQuery.data
                  ? 'Consultando el bloque activo para este tipo...'
                  : activeForSelectedType
                    ? 'Ya existe un bloque activo: el nuevo quedará En espera.'
                    : 'No hay un bloque activo para este tipo: el nuevo se activará de inmediato.'}
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-900/80">
                Copia exactamente el rango autorizado por DGII. El siguiente número puede ser mayor
                que el inicio si ya utilizaste NCF fuera de RIVNU. Los rangos nunca pueden
                solaparse.
              </p>
            </div>
            <form className="grid gap-4 md:grid-cols-3" onSubmit={submitSequence}>
              <div className="space-y-2">
                <Label htmlFor="sequenceDocumentType">Tipo</Label>
                <select
                  id="sequenceDocumentType"
                  value={form.documentType}
                  onChange={(event) => {
                    const documentType = event.target.value as LocalNcfDocumentType;
                    const nextStart = sequencesQuery.data
                      ? getSuggestedStart(sequencesQuery.data, documentType)
                      : null;
                    setForm((current) => ({
                      ...current,
                      documentType,
                      startNumber: nextStart === null ? '' : String(nextStart),
                      endNumber: '',
                      nextNumber: nextStart === null ? '' : String(nextStart),
                    }));
                  }}
                  className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                >
                  <option value="CONSUMER_02">Factura de consumo B02</option>
                  <option value="FISCAL_CREDIT_01">Crédito fiscal B01</option>
                </select>
              </div>
              <SequenceNumberInput
                id="sequenceStart"
                label="Número desde"
                value={form.startNumber}
                hint={
                  suggestedStart === null
                    ? undefined
                    : `Sugerido según el historial: ${suggestedStart.toLocaleString('es-DO')}`
                }
                onChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    startNumber: value,
                    nextNumber:
                      !current.nextNumber || current.nextNumber === current.startNumber
                        ? value
                        : current.nextNumber,
                  }))
                }
              />
              <SequenceNumberInput
                id="sequenceEnd"
                label="Número hasta"
                value={form.endNumber}
                onChange={(value) => setForm((current) => ({ ...current, endNumber: value }))}
              />
              <SequenceNumberInput
                id="sequenceNext"
                label="Siguiente a utilizar"
                value={form.nextNumber}
                hint="Déjalo igual al inicio salvo que ya hayas usado números fuera de RIVNU."
                onChange={(value) => setForm((current) => ({ ...current, nextNumber: value }))}
              />
              <div className="space-y-2">
                <Label htmlFor="sequenceAuthorization">No. autorización DGII</Label>
                <Input
                  id="sequenceAuthorization"
                  value={form.authorizationNumber}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      authorizationNumber: event.target.value,
                    }))
                  }
                  required
                  maxLength={80}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sequenceValidUntil">
                  Válida hasta {form.documentType === 'CONSUMER_02' ? '(si DGII la indica)' : ''}
                </Label>
                <Input
                  id="sequenceValidUntil"
                  type="date"
                  value={form.validUntil}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      validUntil: event.target.value,
                    }))
                  }
                  required={form.documentType === 'FISCAL_CREDIT_01'}
                />
              </div>
              <div className="md:col-span-3">
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Registrando...' : 'Agregar bloque autorizado'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Bloques NCF registrados</CardTitle>
          <CardDescription>
            POS consume únicamente el bloque activo. Al agotarse, el siguiente bloque válido en
            espera se activa automáticamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Prefijo</TableHead>
                <TableHead>Siguiente</TableHead>
                <TableHead>Final</TableHead>
                <TableHead>Restantes</TableHead>
                <TableHead>Progreso</TableHead>
                <TableHead>RNC/Cédula emisor</TableHead>
                <TableHead>Autorización</TableHead>
                <TableHead>Vigencia</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sequencesQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                    Cargando bloques fiscales...
                  </TableCell>
                </TableRow>
              ) : sequencesQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-danger">
                    No se pudieron cargar las secuencias fiscales.
                  </TableCell>
                </TableRow>
              ) : !sequencesQuery.data?.length ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                    Todavía no hay bloques fiscales registrados.
                  </TableCell>
                </TableRow>
              ) : (
                sequencesQuery.data.map((sequence) => (
                  <TableRow
                    key={sequence.id}
                    className={sequence.status === 'INACTIVE' ? 'bg-amber-50/60' : undefined}
                  >
                    <TableCell>{translateInvoiceDocumentType(sequence.documentType)}</TableCell>
                    <TableCell>{sequence.prefix}</TableCell>
                    <TableCell className="font-medium">
                      {formatFiscalNumber(sequence.prefix, sequence.nextNumber)}
                    </TableCell>
                    <TableCell>{formatFiscalNumber(sequence.prefix, sequence.endNumber)}</TableCell>
                    <TableCell>
                      {Math.max(sequence.endNumber - sequence.nextNumber + 1, 0)}
                    </TableCell>
                    <TableCell>
                      <SequenceProgress sequence={sequence} />
                    </TableCell>
                    <TableCell>{sequence.issuerTaxId ?? '-'}</TableCell>
                    <TableCell>{sequence.authorizationNumber ?? '-'}</TableCell>
                    <TableCell>
                      {sequence.validUntil ? formatDateOnly(sequence.validUntil) : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(sequence.status)}>
                        {sequence.status === 'INACTIVE'
                          ? 'En espera'
                          : translateStatus(sequence.status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function formatFiscalNumber(prefix: string, number: number) {
  const digits = /^B\d{2}$/.test(prefix) ? 8 : prefix === 'BA' ? 4 : 10;

  return `${prefix}${String(number).padStart(digits, '0')}`;
}

function SequenceNumberInput({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={1}
        max={99_999_999}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      />
      {hint ? <p className="text-xs leading-4 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function getSuggestedStart(
  sequences: FiscalSequence[],
  documentType: FiscalSequence['documentType'],
) {
  const highestEnd = sequences
    .filter((sequence) => sequence.documentType === documentType)
    .reduce((highest, sequence) => Math.max(highest, sequence.endNumber), 0);

  return highestEnd >= 99_999_999 ? null : highestEnd + 1;
}

function SequenceProgress({ sequence }: { sequence: FiscalSequence }) {
  const total = Math.max(sequence.endNumber - sequence.startNumber + 1, 1);
  const used = Math.min(Math.max(sequence.nextNumber - sequence.startNumber, 0), total);
  const percent = Math.round((used / total) * 100);

  return (
    <div className="min-w-32 space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span>{used.toLocaleString('es-DO')} usados</span>
        <span className="text-muted-foreground">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={`Uso del bloque ${sequence.prefix}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
