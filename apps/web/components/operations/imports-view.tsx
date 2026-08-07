'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  FileUp,
  LoaderCircle,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { ActionDialog } from '@/components/ui/action-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  deleteImportBatch,
  getImportBatches,
  getImportBatchRows,
  importProductsFile,
  type ImportBatch,
  type ImportBatchRow,
  type ImportBatchRowsResponse,
  type ImportBatchRowStatus,
} from '@/lib/api';
import { isAdminSession } from '@/lib/authorization';
import { getStatusVariant, translateImportType, translateStatus } from '@/lib/display-labels';
import { formatDate, cn } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';
import { SupplierInvoiceDialog } from './supplier-invoice-dialog';

const rowsPageSize = 50;

export function ImportsView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [detailBatch, setDetailBatch] = useState<ImportBatch | null>(null);
  const [detailStatus, setDetailStatus] = useState<ImportBatchRowStatus>('FAILED');
  const [detailPage, setDetailPage] = useState(1);
  const [batchPendingDeletion, setBatchPendingDeletion] = useState<ImportBatch | null>(null);
  const canManageImports = isAdminSession(session);

  const importsQuery = useQuery({
    queryKey: ['imports', session?.tenantId],
    queryFn: () => getImportBatches(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const rowsQuery = useQuery({
    queryKey: ['import-batch-rows', session?.tenantId, detailBatch?.id, detailStatus, detailPage],
    queryFn: () => {
      if (!session || !detailBatch) {
        throw new Error('Selecciona un lote de importación.');
      }

      return getImportBatchRows(session.tenantId, session.accessToken, detailBatch.id, {
        status: detailStatus,
        page: detailPage,
        limit: rowsPageSize,
      });
    },
    enabled: Boolean(session && detailBatch),
  });
  const importMutation = useMutation({
    mutationFn: (file: File) => {
      if (!session) {
        throw new Error('Sesión requerida.');
      }

      return importProductsFile(session.tenantId, session.accessToken, file);
    },
    onSuccess: async (batch) => {
      setSelectedFile(null);
      await queryClient.invalidateQueries({ queryKey: ['imports'] });
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Importación procesada', {
        description: `${batch.importedRows} producto(s) importado(s).`,
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo importar el archivo.');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (batchId: string) => {
      if (!session) {
        throw new Error('Sesión requerida.');
      }

      return deleteImportBatch(session.tenantId, session.accessToken, batchId);
    },
    onSuccess: async (_result, batchId) => {
      if (detailBatch?.id === batchId) {
        setDetailBatch(null);
      }
      setBatchPendingDeletion(null);
      await queryClient.invalidateQueries({ queryKey: ['imports'] });
      await queryClient.removeQueries({
        queryKey: ['import-batch-rows', session?.tenantId, batchId],
      });
      toast.success('Registro de importación eliminado', {
        description: 'Los productos e inventario que ya se importaron no fueron modificados.',
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar el registro.');
    },
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (selectedFile) {
      importMutation.mutate(selectedFile);
    }
  }

  function openDetails(batch: ImportBatch) {
    setDetailBatch(batch);
    setDetailStatus(getFailedRowsCount(batch) > 0 ? 'FAILED' : 'IMPORTED');
    setDetailPage(1);
  }

  function changeDetailStatus(status: ImportBatchRowStatus) {
    setDetailStatus(status);
    setDetailPage(1);
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Importaciones"
        description="Carga productos en bloque y conserva un historial claro de lo procesado, omitido y su motivo."
      />

      {canManageImports ? (
        <Card>
          <CardHeader>
            <CardTitle>Importar productos</CardTitle>
            <CardDescription>
              Carga masiva del catálogo e inventario inicial desde Excel. Al terminar podrás revisar
              cada fila omitida antes de corregir el archivo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 md:grid-cols-[1fr_auto]" onSubmit={submitImport}>
              <Input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              />
              <Button type="submit" disabled={!selectedFile || importMutation.isPending}>
                {importMutation.isPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}
                {importMutation.isPending ? 'Importando...' : 'Importar productos'}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Lotes de importación</CardTitle>
          <CardDescription>
            Cada lote conserva su resumen. El detalle se carga únicamente cuando eliges verlo, para
            mantener la pantalla rápida incluso con archivos grandes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {importsQuery.isLoading ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Cargando historial de importaciones...
            </div>
          ) : null}

          {importsQuery.isError ? (
            <div className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
              {getErrorMessage(
                importsQuery.error,
                'No se pudo cargar el historial de importaciones.',
              )}
            </div>
          ) : null}

          {!importsQuery.isLoading && !importsQuery.isError && !(importsQuery.data ?? []).length ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
              Aún no hay importaciones registradas.
            </div>
          ) : null}

          {(importsQuery.data ?? []).map((batch) => (
            <ImportBatchCard
              key={batch.id}
              batch={batch}
              canManage={canManageImports}
              deletionPending={deleteMutation.isPending && batchPendingDeletion?.id === batch.id}
              onOpenDetails={() => openDetails(batch)}
              onRequestDeletion={() => setBatchPendingDeletion(batch)}
            />
          ))}
        </CardContent>
      </Card>

      <ImportBatchDetailsDialog
        batch={detailBatch}
        status={detailStatus}
        page={detailPage}
        result={rowsQuery.data}
        isLoading={rowsQuery.isLoading || rowsQuery.isFetching}
        error={rowsQuery.isError ? rowsQuery.error : null}
        onClose={() => setDetailBatch(null)}
        onStatusChange={changeDetailStatus}
        onPageChange={setDetailPage}
      />

      <ActionDialog
        open={Boolean(batchPendingDeletion)}
        onClose={() => {
          if (!deleteMutation.isPending) setBatchPendingDeletion(null);
        }}
        title="Eliminar registro de importación"
        description="Esta acción elimina únicamente el historial y el detalle de este lote. No borra productos, existencias ni movimientos de inventario ya creados."
        tone="danger"
        icon={<Trash2 className="h-5 w-5" aria-hidden="true" />}
        confirmLabel="Eliminar registro"
        cancelLabel="Cancelar"
        isPending={deleteMutation.isPending}
        summary={
          batchPendingDeletion ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Lote
              </p>
              <p className="mt-0.5 font-semibold text-foreground">
                {batchPendingDeletion.filename}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {getImportedRowsCount(batchPendingDeletion)} importada(s) ·{' '}
                {getFailedRowsCount(batchPendingDeletion)} no importada(s)
              </p>
            </div>
          ) : null
        }
        onConfirm={() => {
          if (batchPendingDeletion) {
            deleteMutation.mutate(batchPendingDeletion.id);
          }
        }}
      />
    </div>
  );
}

function ImportBatchCard({
  batch,
  canManage,
  deletionPending,
  onOpenDetails,
  onRequestDeletion,
}: {
  batch: ImportBatch;
  canManage: boolean;
  deletionPending: boolean;
  onOpenDetails: () => void;
  onRequestDeletion: () => void;
}) {
  const importedRows = getImportedRowsCount(batch);
  const failedRows = getFailedRowsCount(batch);
  const totalRows = getTotalRowsCount(batch);

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-foreground sm:text-base">
              {batch.filename}
            </p>
            <Badge variant={getStatusVariant(batch.status)}>{translateStatus(batch.status)}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {translateImportType(batch.type)} · {formatDate(batch.createdAt)}
            {batch.createdBy?.name ? ` · ${batch.createdBy.name}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onOpenDetails}>
            <Eye className="h-4 w-4" aria-hidden="true" />
            Ver más
          </Button>
          {canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:bg-danger/10 hover:text-danger"
              onClick={onRequestDeletion}
              disabled={deletionPending}
              aria-label={`Eliminar historial de ${batch.filename}`}
              title="Eliminar solo el registro de importación"
            >
              {deletionPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ImportMetric label="Filas del archivo" value={totalRows} />
        <ImportMetric label="Válidas" value={batch.validRows} tone="success" />
        <ImportMetric
          label="No importadas"
          value={failedRows}
          tone={failedRows > 0 ? 'danger' : undefined}
        />
        <ImportMetric label="Importadas" value={importedRows} tone="success" />
      </div>

      {failedRows > 0 ? (
        <div className="mt-4 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2.5 text-sm text-danger">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {failedRows} fila(s) no se importaron
          </div>
          <p className="mt-1 text-xs leading-5 text-danger/85">
            Abre “Ver más” para consultar cada motivo y los datos originales de la fila.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ImportMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'danger';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-muted/20 px-3 py-2.5',
        tone === 'success' && 'border-success/20 bg-success/5',
        tone === 'danger' && 'border-danger/20 bg-danger/5',
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-base font-semibold tabular-nums text-foreground',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ImportBatchDetailsDialog({
  batch,
  status,
  page,
  result,
  isLoading,
  error,
  onClose,
  onStatusChange,
  onPageChange,
}: {
  batch: ImportBatch | null;
  status: ImportBatchRowStatus;
  page: number;
  result: ImportBatchRowsResponse | undefined;
  isLoading: boolean;
  error: unknown;
  onClose: () => void;
  onStatusChange: (status: ImportBatchRowStatus) => void;
  onPageChange: (page: number) => void;
}) {
  if (!batch) return null;

  const importedRows = getImportedRowsCount(batch);
  const failedRows = getFailedRowsCount(batch);
  const rows = result?.rows ?? [];
  const pagination = result?.pagination;
  const expectedRows = status === 'IMPORTED' ? importedRows : failedRows;
  const noRowsAvailable =
    !isLoading && !error && rows.length === 0 && (pagination?.total ?? 0) === 0;
  const shouldShowHistoricalFallback = noRowsAvailable && expectedRows > 0;

  return (
    <SupplierInvoiceDialog
      open
      onClose={onClose}
      eyebrow="Historial de importación"
      title={batch.filename}
      description="Revisa las filas procesadas o no importadas. El historial no altera el catálogo ni el inventario."
      icon={<FileText className="h-5 w-5" aria-hidden="true" />}
      size="lg"
    >
      <div className="space-y-5">
        <div className="grid gap-2 sm:grid-cols-3">
          <ImportMetric label="Filas del archivo" value={getTotalRowsCount(batch)} />
          <ImportMetric label="Importadas" value={importedRows} tone="success" />
          <ImportMetric
            label="No importadas"
            value={failedRows}
            tone={failedRows > 0 ? 'danger' : undefined}
          />
        </div>

        <div
          className="flex gap-2 border-b border-border"
          role="tablist"
          aria-label="Detalle del lote"
        >
          <DetailTab
            active={status === 'IMPORTED'}
            count={importedRows}
            label="Importados"
            icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            onClick={() => onStatusChange('IMPORTED')}
          />
          <DetailTab
            active={status === 'FAILED'}
            count={failedRows}
            label="No importados"
            icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
            onClick={() => onStatusChange('FAILED')}
          />
        </div>

        {isLoading ? (
          <div className="flex min-h-44 items-center justify-center gap-2 rounded-xl border border-border bg-muted/15 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Cargando detalle de filas...
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-danger/25 bg-danger/5 p-4 text-sm text-danger">
            {getErrorMessage(error, 'No se pudo cargar el detalle de este lote.')}
          </div>
        ) : null}

        {!isLoading && !error && rows.length ? (
          <div className="space-y-3">
            {rows.map((row) => (
              <ImportRowCard key={row.id} row={row} />
            ))}
          </div>
        ) : null}

        {shouldShowHistoricalFallback ? (
          <HistoricalImportDetails batch={batch} status={status} />
        ) : null}

        {noRowsAvailable && !shouldShowHistoricalFallback ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/15 px-4 py-10 text-center text-sm text-muted-foreground">
            {status === 'IMPORTED'
              ? 'Este lote no tiene filas importadas para mostrar.'
              : 'Este lote no tiene filas no importadas.'}
          </div>
        ) : null}

        {pagination && pagination.totalPages > 1 ? (
          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Mostrando {(pagination.page - 1) * pagination.limit + 1}-
              {Math.min(pagination.page * pagination.limit, pagination.total)} de {pagination.total}{' '}
              fila(s).
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Anterior
              </Button>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {pagination.page} / {pagination.totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => onPageChange(page + 1)}
              >
                Siguiente
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </SupplierInvoiceDialog>
  );
}

function DetailTab({
  active,
  count,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
      )}
    >
      {icon}
      {label}
      <span
        className={cn(
          'rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums',
          active && 'bg-primary/10 text-primary',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function ImportRowCard({ row }: { row: ImportBatchRow }) {
  const originalData = getOriginalDataEntries(row.rawData);
  const productName =
    row.productLabel ??
    getRawField(row.rawData, [
      'producto',
      'product',
      'nombre',
      'name',
      'descripción',
      'descripcion',
      'description',
    ]);
  const sku = getRawField(row.rawData, ['sku', 'código', 'codigo', 'code', 'barcode', 'barra']);
  const isFailed = row.status === 'FAILED';

  return (
    <article
      className={cn(
        'rounded-xl border p-4',
        isFailed ? 'border-danger/25 bg-danger/[0.025]' : 'border-success/20 bg-success/[0.025]',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Fila {row.rowNumber}</p>
            <Badge variant={isFailed ? 'danger' : 'success'}>
              {isFailed ? 'No importada' : 'Importada'}
            </Badge>
          </div>
          {productName ? (
            <p className="mt-1 truncate text-sm text-muted-foreground">{productName}</p>
          ) : null}
        </div>
        {sku ? (
          <p className="text-xs font-medium text-muted-foreground">SKU/Código: {sku}</p>
        ) : null}
      </div>

      {isFailed ? (
        <div className="mt-4 rounded-lg border border-danger/20 bg-danger/5 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-danger">
            Motivo por el que no se importó
          </p>
          {row.reasons.length ? (
            <ul className="mt-2 space-y-1.5 text-sm text-danger">
              {row.reasons.map((reason, index) => (
                <li key={`${reason.field ?? 'reason'}-${index}`} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  <span>
                    {reason.field ? (
                      <strong className="font-semibold">{formatFieldName(reason.field)}: </strong>
                    ) : null}
                    {reason.message}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-danger">
              No se registró un motivo específico para esta fila.
            </p>
          )}
        </div>
      ) : null}

      <OriginalRowData entries={originalData} />
    </article>
  );
}

function HistoricalImportDetails({
  batch,
  status,
}: {
  batch: ImportBatch;
  status: ImportBatchRowStatus;
}) {
  if (status === 'IMPORTED') {
    return (
      <div className="rounded-xl border border-border bg-muted/15 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">
          Detalle no disponible para este lote histórico
        </p>
        <p className="mt-1.5 leading-6">
          Se registraron {getImportedRowsCount(batch)} producto(s), pero este archivo se procesó
          antes de que se conservara el detalle individual de las filas importadas.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-muted/15 p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">Detalle no disponible para este lote histórico</p>
      <p className="mt-1.5 leading-6">
        El lote reporta {getFailedRowsCount(batch)} fila(s) no importada(s), pero no conserva el
        detalle por fila. Las importaciones nuevas sí guardan sus motivos y datos originales.
      </p>
    </div>
  );
}

function OriginalRowData({ entries }: { entries: Array<[string, string]> }) {
  const [showAll, setShowAll] = useState(false);
  const initialEntryLimit = 30;
  const hasMoreEntries = entries.length > initialEntryLimit;
  const visibleEntries = showAll ? entries : entries.slice(0, initialEntryLimit);

  if (!entries.length) {
    return (
      <p className="mt-4 text-xs text-muted-foreground">
        No hay datos originales disponibles para esta fila.
      </p>
    );
  }

  return (
    <details className="mt-4 rounded-lg border border-border bg-card/70 px-3 py-2.5">
      <summary className="cursor-pointer text-sm font-medium text-foreground marker:text-muted-foreground">
        Ver datos originales de la fila
      </summary>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        {visibleEntries.map(([key, value]) => (
          <div key={key} className="min-w-0 rounded-md bg-muted/30 px-2.5 py-2">
            <dt className="truncate font-medium text-muted-foreground">{formatFieldName(key)}</dt>
            <dd className="mt-0.5 break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
      {hasMoreEntries ? (
        <button
          type="button"
          className="mt-3 text-xs font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll
            ? 'Mostrar menos datos'
            : `Mostrar todos los datos (${entries.length - initialEntryLimit} adicionales)`}
        </button>
      ) : null}
    </details>
  );
}

function getImportedRowsCount(batch: ImportBatch) {
  return batch.rowSummary?.imported ?? batch.rowSummary?.importedRows ?? batch.importedRows;
}

function getFailedRowsCount(batch: ImportBatch) {
  return batch.rowSummary?.failed ?? batch.rowSummary?.failedRows ?? batch.invalidRows;
}

function getTotalRowsCount(batch: ImportBatch) {
  if (batch.rowSummary?.total !== undefined) {
    return batch.rowSummary.total;
  }

  // Los lotes históricos no tienen filas detalladas, por lo que _count.rows
  // es 0 aunque el archivo original sí haya tenido filas.
  return batch._count?.rows ? batch._count.rows : batch.totalRows;
}

function getOriginalDataEntries(rawData: ImportBatchRow['rawData']) {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return [];

  return Object.entries(rawData)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => [key, formatRawValue(value)] as [string, string]);
}

function getRawField(rawData: ImportBatchRow['rawData'], fieldNames: string[]) {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null;

  const normalizedNames = new Set(fieldNames.map(normalizeFieldName));
  const match = Object.entries(rawData).find(([key, value]) => {
    return (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      normalizedNames.has(normalizeFieldName(key))
    );
  });

  return match ? formatRawValue(match[1]) : null;
}

function normalizeFieldName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function formatFieldName(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatRawValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toLocaleString('es-DO');
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
