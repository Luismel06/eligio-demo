'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createEmployee, getEmployee, updateEmployee } from '@/lib/api';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';

const permissionFields = [
  ['canUsePos', 'Usar caja'],
  ['canOpenCashSession', 'Abrir caja'],
  ['canCloseCashSession', 'Cerrar caja'],
  ['canApplyDiscount', 'Aplicar descuentos'],
  ['canCancelInvoice', 'Cancelar facturas'],
  ['canVoidInvoice', 'Anular facturas'],
  ['canManageProducts', 'Gestionar productos'],
  ['canAdjustInventory', 'Ajustar inventario'],
  ['canManageEmployees', 'Gestionar empleados'],
  ['canViewReports', 'Ver reportes'],
  ['canManageFiscalSequences', 'Secuencias fiscales'],
  ['canViewCashLogs', 'Ver logs de caja'],
  ['canReprintReceipt', 'Reimprimir recibos'],
  ['canTakeOrders', 'Tomar ordenes'],
] as const;

type EmployeeFormState = Record<(typeof permissionFields)[number][0], boolean> & {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: string;
  employeeCode: string;
  jobTitle: string;
  documentNumber: string;
  status: string;
};

const defaultState: EmployeeFormState = {
  name: '',
  email: '',
  phone: '',
  password: '',
  role: 'CASHIER',
  employeeCode: '',
  jobTitle: '',
  documentNumber: '',
  status: 'ACTIVE',
  canUsePos: true,
  canOpenCashSession: true,
  canCloseCashSession: true,
  canApplyDiscount: false,
  canCancelInvoice: false,
  canVoidInvoice: false,
  canManageProducts: false,
  canAdjustInventory: false,
  canManageEmployees: false,
  canViewReports: false,
  canManageFiscalSequences: false,
  canViewCashLogs: false,
  canReprintReceipt: true,
  canTakeOrders: false,
};

export function EmployeeForm({ employeeId }: { employeeId?: string }) {
  const session = useCurrentSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EmployeeFormState>(defaultState);
  const [loadedEmployeeId, setLoadedEmployeeId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const employeeQuery = useQuery({
    queryKey: ['employee', employeeId, session?.tenantId],
    queryFn: () =>
      getEmployee(session?.tenantId ?? '', session?.accessToken ?? '', employeeId ?? ''),
    enabled: Boolean(session && employeeId),
  });

  useEffect(() => {
    if (employeeQuery.data && loadedEmployeeId !== employeeQuery.data.id) {
      const membership = employeeQuery.data.user.memberships[0];
      const role = membership?.role ?? 'CASHIER';
      setLoadedEmployeeId(employeeQuery.data.id);
      setForm({
        ...defaultState,
        name: employeeQuery.data.user.name,
        email: employeeQuery.data.user.email,
        phone: employeeQuery.data.user.phone ?? '',
        password: '',
        role,
        employeeCode: employeeQuery.data.employeeCode ?? '',
        jobTitle: employeeQuery.data.jobTitle ?? '',
        documentNumber: '',
        status: employeeQuery.data.status,
        ...Object.fromEntries(permissionFields.map(([key]) => [key, Boolean(membership?.[key])])),
        ...getForcedPermissionsForRole(role),
      } as EmployeeFormState);
    }
  }, [employeeQuery.data, loadedEmployeeId]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      const payload = {
        ...form,
        password: form.password || undefined,
        documentType: form.documentNumber ? 'CEDULA' : undefined,
        documentNumber: form.documentNumber || undefined,
      };

      if (employeeId) {
        return updateEmployee(session.tenantId, session.accessToken, employeeId, payload);
      }

      return createEmployee(session.tenantId, session.accessToken, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['employees'] });
      router.push('/employees');
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar el empleado.');
    },
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  function setField(key: keyof EmployeeFormState, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setRole(role: string) {
    setForm((current) => ({
      ...current,
      role,
      ...getDefaultPermissionsForRole(role),
    }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title={employeeId ? 'Editar empleado' : 'Nuevo empleado'}
        description="Controla accesos operativos de EligioValdez Comercial sin mezclar usuarios de otros tenants."
      />

      <Card>
        <CardHeader>
          <CardTitle>Perfil y permisos</CardTitle>
          <CardDescription>Los permisos se aplican al tenant actual.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
            <Field label="Nombre">
              <Input
                value={form.name}
                onChange={(event) => setField('name', event.target.value)}
                required
              />
            </Field>
            <Field label="Correo">
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setField('email', event.target.value)}
                required
              />
            </Field>
            <Field label="Telefono">
              <Input
                value={form.phone}
                onChange={(event) => setField('phone', event.target.value)}
              />
            </Field>
            <Field label="Contrasena">
              <Input
                type="password"
                value={form.password}
                onChange={(event) => setField('password', event.target.value)}
                placeholder={employeeId ? 'Dejar vacio para no cambiar' : 'ContrasenaDemo123!'}
              />
            </Field>
            <Field label="Rol">
              <select
                value={form.role}
                onChange={(event) => setRole(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="ADMIN">Administrador</option>
                <option value="ACCOUNTANT">Contador</option>
                <option value="CASHIER">Cajero</option>
                <option value="ORDER_TAKER">Ordenanza</option>
              </select>
            </Field>
            <Field label="Estado">
              <select
                value={form.status}
                onChange={(event) => setField('status', event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
                <option value="BLOCKED">Bloqueado</option>
                <option value="TERMINATED">Terminado</option>
              </select>
            </Field>
            <Field label="Codigo empleado">
              <Input
                value={form.employeeCode}
                onChange={(event) => setField('employeeCode', event.target.value)}
              />
            </Field>
            <Field label="Cargo">
              <Input
                value={form.jobTitle}
                onChange={(event) => setField('jobTitle', event.target.value)}
              />
            </Field>
            <Field label="Cedula">
              <Input
                value={form.documentNumber}
                onChange={(event) => setField('documentNumber', event.target.value)}
              />
            </Field>

            <div className="grid gap-3 rounded-md border border-border p-4 md:col-span-2 sm:grid-cols-2 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-3">
                <p className="text-sm font-semibold">Permisos operativos</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Los permisos bloqueados se asignan automáticamente según el rol.
                </p>
              </div>
              {permissionFields.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={form[key]}
                    disabled={isPermissionLocked(form.role, key)}
                    onChange={(event) => setField(key, event.target.checked)}
                  />
                  {label}
                </label>
              ))}
              {form.role === 'ACCOUNTANT' ? (
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3 sm:col-span-2 lg:col-span-3">
                  <p className="text-sm font-semibold">Acceso contable incluido por el rol</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Consulta facturas de venta, productos, clientes, inventario, suplidores,
                    cuentas por cobrar, cuentas por pagar y caja. También puede preparar órdenes de
                    compra y registrar facturas de suplidores, pagos, recepciones y abonos. Las
                    aprobaciones, cancelaciones y reversiones quedan reservadas al administrador.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="md:col-span-2">
              {message ? <p className="mb-3 text-sm text-muted-foreground">{message}</p> : null}
              <Button type="submit" disabled={saveMutation.isPending}>
                <Save className="h-4 w-4" />
                Guardar empleado
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function getDefaultPermissionsForRole(
  role: string,
): Pick<EmployeeFormState, (typeof permissionFields)[number][0]> {
  const permissions = Object.fromEntries(permissionFields.map(([key]) => [key, false])) as Pick<
    EmployeeFormState,
    (typeof permissionFields)[number][0]
  >;

  if (role === 'ADMIN') {
    return {
      ...permissions,
      canUsePos: true,
      canOpenCashSession: true,
      canCloseCashSession: true,
      canApplyDiscount: true,
      canCancelInvoice: true,
      canVoidInvoice: true,
      canManageProducts: true,
      canAdjustInventory: true,
      canManageEmployees: true,
      canViewReports: true,
      canManageFiscalSequences: true,
      canViewCashLogs: true,
      canReprintReceipt: true,
      canTakeOrders: true,
    };
  }

  if (role === 'ORDER_TAKER') {
    return {
      ...permissions,
      canTakeOrders: true,
    };
  }

  if (role === 'ACCOUNTANT') {
    return {
      ...permissions,
      canViewReports: true,
      canViewCashLogs: true,
      canReprintReceipt: true,
    };
  }

  return {
    ...permissions,
    canUsePos: true,
    canOpenCashSession: true,
    canCloseCashSession: true,
    canReprintReceipt: true,
  };
}

function isPermissionLocked(role: string, key: (typeof permissionFields)[number][0]) {
  if (role === 'ORDER_TAKER') {
    return true;
  }

  if (role === 'ACCOUNTANT') {
    return true;
  }

  if (role === 'CASHIER' && key === 'canTakeOrders') {
    return true;
  }

  if (role === 'ADMIN' && key === 'canTakeOrders') {
    return true;
  }

  return false;
}

function getForcedPermissionsForRole(
  role: string,
): Partial<Pick<EmployeeFormState, (typeof permissionFields)[number][0]>> {
  if (role === 'ORDER_TAKER') {
    return getDefaultPermissionsForRole(role);
  }

  if (role === 'ACCOUNTANT') {
    return getDefaultPermissionsForRole(role);
  }

  if (role === 'CASHIER') {
    return { canTakeOrders: false };
  }

  if (role === 'ADMIN') {
    return { canTakeOrders: true };
  }

  return {};
}
