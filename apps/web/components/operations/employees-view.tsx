'use client';

import { useQuery } from '@tanstack/react-query';
import { Eye, Pencil, Plus } from 'lucide-react';
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
import { getEmployees } from '@/lib/api';
import { getStatusVariant, translateRole, translateStatus } from '@/lib/display-labels';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';

export function EmployeesView() {
  const session = useCurrentSession();
  const employeesQuery = useQuery({
    queryKey: ['employees', session?.tenantId],
    queryFn: () => getEmployees(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Empleados"
        description="Usuarios operativos de EligioValdez Comercial con roles y permisos por tenant."
      />

      <div className="flex justify-end">
        <Button asChild>
          <Link href="/employees/new">
            <Plus className="h-4 w-4" />
            Nuevo empleado
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Equipo EligioValdez</CardTitle>
          <CardDescription>{employeesQuery.data?.length ?? 0} perfiles laborales registrados.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empleado</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Permisos</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(employeesQuery.data ?? []).map((employee) => {
                const membership = employee.user.memberships[0];
                return (
                  <TableRow key={employee.id}>
                    <TableCell>
                      <div className="font-medium">{employee.user.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {employee.employeeCode ?? 'Sin codigo'} - {employee.user.email}
                      </div>
                    </TableCell>
                    <TableCell>{translateRole(membership?.role) ?? 'Sin rol'}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {membership?.role === 'ACCOUNTANT' ? (
                          <Badge variant="success">Acceso contable</Badge>
                        ) : null}
                        {membership?.canUsePos ? <Badge variant="success">Usar caja</Badge> : null}
                        {membership?.canTakeOrders ? <Badge variant="success">Tomar ordenes</Badge> : null}
                        {membership?.canOpenCashSession ? <Badge variant="outline">Abrir caja</Badge> : null}
                        {membership?.canCloseCashSession ? <Badge variant="outline">Cerrar caja</Badge> : null}
                        {membership?.canApplyDiscount ? (
                          <Badge variant="outline">Descuentos</Badge>
                        ) : null}
                        {membership?.canCancelInvoice ? (
                          <Badge variant="outline">Cancelar facturas</Badge>
                        ) : null}
                        {membership?.canVoidInvoice ? (
                          <Badge variant="outline">Anular facturas</Badge>
                        ) : null}
                        {membership?.canManageProducts ? <Badge variant="outline">Productos</Badge> : null}
                        {membership?.canAdjustInventory ? (
                          <Badge variant="outline">Inventario</Badge>
                        ) : null}
                        {membership?.canManageEmployees ? <Badge variant="outline">Empleados</Badge> : null}
                        {membership?.canViewReports ? <Badge variant="outline">Reportes</Badge> : null}
                        {membership?.canManageFiscalSequences ? (
                          <Badge variant="outline">Secuencias fiscales</Badge>
                        ) : null}
                        {membership?.canViewCashLogs ? (
                          <Badge variant="outline">Logs de caja</Badge>
                        ) : null}
                        {membership?.canReprintReceipt ? (
                          <Badge variant="outline">Reimprimir recibos</Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(employee.status)}>{translateStatus(employee.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="icon">
                          <Link href={`/employees/${employee.id}`} aria-label="Ver empleado">
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button asChild variant="ghost" size="icon">
                          <Link href={`/employees/${employee.id}/edit`} aria-label="Editar empleado">
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
