'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getCashMovements } from '@/lib/api';
import { translateCashMovementType } from '@/lib/display-labels';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';

export function CashLogsView() {
  const session = useCurrentSession();
  const cashQuery = useQuery({
    queryKey: ['cash-movements', session?.tenantId],
    queryFn: () => getCashMovements(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Movimientos de caja"
        description="Entradas, salidas, cobros y devoluciones que afectan el efectivo de las cajas."
      />

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Historial de efectivo</CardTitle>
            <CardDescription>
              {cashQuery.data?.length ?? 0} movimientos registrados que impactan el arqueo.
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href="/operations/logs">
              Ver logs operativos
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {cashQuery.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((item) => (
                <div key={item} className="h-12 animate-pulse rounded-md bg-zinc-100" />
              ))}
            </div>
          ) : cashQuery.data?.length ? (
            <div className="surface-scrollbar max-h-[calc(100vh-22rem)] overflow-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-zinc-50">
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Cajero</TableHead>
                    <TableHead>Referencia</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cashQuery.data.map((movement) => {
                    const amount = Number(movement.amount);

                    return (
                      <TableRow key={movement.id}>
                        <TableCell>{formatDateTime(movement.createdAt)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{translateCashMovementType(movement.type)}</Badge>
                        </TableCell>
                        <TableCell>
                          {movement.user?.name ?? movement.cashierName ?? 'Empleado'}
                        </TableCell>
                        <TableCell>{movement.reference ?? movement.invoiceNumber ?? '-'}</TableCell>
                        <TableCell
                          className={`text-right font-medium ${amount < 0 ? 'text-red-600' : ''}`}
                        >
                          {formatCurrency(amount)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-10 text-center text-sm text-muted-foreground">
              No hay movimientos de efectivo registrados todavía.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
