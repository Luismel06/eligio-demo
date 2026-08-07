'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Pencil, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
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
  configureCustomerCredit,
  createCustomer,
  deleteCustomer,
  getCustomers,
  type Customer,
  updateCustomer,
} from '@/lib/api';
import { getStatusVariant, translateDocumentType, translateStatus } from '@/lib/display-labels';
import {
  normalizeDominicanDocument,
  validateDominicanDocument,
} from '@/lib/dominican-documents';
import { formatDate } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import { SessionRequired, useCurrentSession } from './session-required';

type CustomerFormState = {
  name: string;
  documentType: string;
  documentNumber: string;
  email: string;
  phone: string;
  address: string;
};

type CreditFormState = {
  creditEnabled: boolean;
  creditStatus: 'ACTIVE' | 'BLOCKED';
  creditLimit: string;
  creditTermDays: string;
};

const emptyCustomerForm: CustomerFormState = {
  name: '',
  documentType: 'CONSUMER_FINAL',
  documentNumber: '',
  email: '',
  phone: '',
  address: '',
};

export function CustomersView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [creditCustomer, setCreditCustomer] = useState<Customer | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CustomerFormState>(emptyCustomerForm);
  const [creditForm, setCreditForm] = useState<CreditFormState>({
    creditEnabled: false,
    creditStatus: 'BLOCKED',
    creditLimit: '0',
    creditTermDays: '30',
  });

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('q');
    if (query) {
      setSearch(query);
    }
  }, []);

  const customersQuery = useQuery({
    queryKey: ['customers', session?.tenantId],
    queryFn: () => getCustomers(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session),
  });
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      let documentNumber = form.documentNumber.trim();

      if (form.documentType === 'RNC' || form.documentType === 'CEDULA') {
        if (!validateDominicanDocument(form.documentType, documentNumber)) {
          throw new Error(
            form.documentType === 'RNC'
              ? 'El RNC no es valido.'
              : 'La cedula no es valida.',
          );
        }

        documentNumber = normalizeDominicanDocument(documentNumber);
      }

      const payload = {
        name: form.name,
        documentType: form.documentType,
        documentNumber: documentNumber || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
      };

      if (editingCustomer) {
        return updateCustomer(session.tenantId, session.accessToken, editingCustomer.id, payload);
      }

      return createCustomer(session.tenantId, session.accessToken, payload);
    },
    onSuccess: async (customer) => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(editingCustomer ? 'Cliente actualizado' : 'Cliente creado', {
        description: customer.name,
      });
      closeForm();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el cliente.');
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (customerId: string) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return deleteCustomer(session.tenantId, session.accessToken, customerId);
    },
    onSuccess: async (customer) => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Cliente desactivado', { description: customer.name });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo desactivar el cliente.');
    },
  });
  const creditMutation = useMutation({
    mutationFn: () => {
      if (!session || !creditCustomer) {
        throw new Error('Sesión requerida.');
      }

      const creditLimit = Number(creditForm.creditLimit);
      const creditTermDays = Number(creditForm.creditTermDays);
      if (!Number.isFinite(creditLimit) || creditLimit < 0) {
        throw new Error('El límite de crédito no es válido.');
      }
      if (!Number.isInteger(creditTermDays) || creditTermDays < 1 || creditTermDays > 365) {
        throw new Error('Los días de crédito deben estar entre 1 y 365.');
      }

      return configureCustomerCredit(session.tenantId, session.accessToken, creditCustomer.id, {
        creditEnabled: creditForm.creditEnabled,
        creditStatus: creditForm.creditEnabled ? creditForm.creditStatus : 'BLOCKED',
        creditLimit,
        creditTermDays,
      });
    },
    onSuccess: async (customer) => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      await queryClient.invalidateQueries({ queryKey: ['receivables'] });
      toast.success('Crédito actualizado', { description: customer.name });
      setCreditCustomer(null);
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo actualizar el crédito del cliente.',
      );
    },
  });

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return customersQuery.data ?? [];
    }

    return (customersQuery.data ?? []).filter((customer) =>
      [customer.name, customer.documentNumber, customer.email, customer.phone]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query)),
    );
  }, [customersQuery.data, search]);

  if (!session) {
    return <SessionRequired session={session} />;
  }

  const readOnly = session.role === 'ACCOUNTANT';

  function openCreateForm() {
    setEditingCustomer(null);
    setForm(emptyCustomerForm);
    setFormOpen(true);
  }

  function openEditForm(customer: Customer) {
    setEditingCustomer(customer);
    setForm({
      name: customer.name,
      documentType: customer.documentType,
      documentNumber: customer.documentNumber ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      address: customer.address ?? '',
    });
    setFormOpen(true);
  }

  function closeForm() {
    setEditingCustomer(null);
    setForm(emptyCustomerForm);
    setFormOpen(false);
  }

  function openCreditForm(customer: Customer) {
    setCreditCustomer(customer);
    setCreditForm({
      creditEnabled: customer.creditEnabled,
      creditStatus: customer.creditStatus,
      creditLimit: String(customer.creditLimit ?? '0'),
      creditTermDays: String(customer.creditTermDays ?? 30),
    });
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Clientes"
        description="Clientes fiscales y comerciales de Ferreteria RIVNU cargados desde PostgreSQL."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="bg-white pl-9"
            placeholder="Buscar cliente, RNC, correo o telefono"
          />
        </div>
        {!readOnly ? (
          <Button onClick={openCreateForm}>
            <Plus className="h-4 w-4" />
            Nuevo cliente
          </Button>
        ) : null}
      </div>

      {formOpen && !readOnly ? (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>{editingCustomer ? 'Editar cliente' : 'Nuevo cliente'}</CardTitle>
                <CardDescription>Datos fiscales y contacto operativo del cliente.</CardDescription>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={closeForm}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 md:grid-cols-2" onSubmit={submitForm}>
              <Field label="Nombre">
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                />
              </Field>
              <Field label="Documento">
                <select
                  value={form.documentType}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      documentType: event.target.value,
                      documentNumber: '',
                    }))
                  }
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                >
                  <option value="CONSUMER_FINAL">Consumidor final</option>
                  <option value="RNC">RNC</option>
                  <option value="CEDULA">Cedula</option>
                  <option value="PASSPORT">Pasaporte</option>
                  <option value="OTHER">Otro</option>
                </select>
              </Field>
              <Field label="Numero documento">
                <Input
                  value={form.documentNumber}
                  required={form.documentType === 'RNC' || form.documentType === 'CEDULA'}
                  inputMode={
                    form.documentType === 'RNC' || form.documentType === 'CEDULA'
                      ? 'numeric'
                      : undefined
                  }
                  placeholder={
                    form.documentType === 'RNC'
                      ? '1-01-00000-1'
                      : form.documentType === 'CEDULA'
                        ? '001-0000000-1'
                        : undefined
                  }
                  onChange={(event) =>
                    setForm((current) => ({ ...current, documentNumber: event.target.value }))
                  }
                />
              </Field>
              <Field label="Correo">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </Field>
              <Field label="Telefono">
                <Input
                  value={form.phone}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, phone: event.target.value }))
                  }
                />
              </Field>
              <Field label="Direccion">
                <Input
                  value={form.address}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, address: event.target.value }))
                  }
                />
              </Field>
              <div className="md:col-span-2">
                <Button type="submit" disabled={saveMutation.isPending}>
                  <Save className="h-4 w-4" />
                  Guardar cliente
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {creditCustomer && !readOnly ? (
        <Card className="border-sky-200">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Crédito de {creditCustomer.name}</CardTitle>
                <CardDescription>
                  El administrador define si el cliente puede comprar fiado, su límite y plazo
                  recomendado.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setCreditCustomer(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                creditMutation.mutate();
              }}
            >
              <Field label="Acceso a crédito">
                <select
                  value={creditForm.creditEnabled ? 'ENABLED' : 'DISABLED'}
                  onChange={(event) =>
                    setCreditForm((current) => ({
                      ...current,
                      creditEnabled: event.target.value === 'ENABLED',
                      creditStatus:
                        event.target.value === 'ENABLED' ? current.creditStatus : 'BLOCKED',
                    }))
                  }
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                >
                  <option value="DISABLED">No habilitado</option>
                  <option value="ENABLED">Habilitado</option>
                </select>
              </Field>
              <Field label="Estado">
                <select
                  value={creditForm.creditStatus}
                  disabled={!creditForm.creditEnabled}
                  onChange={(event) =>
                    setCreditForm((current) => ({
                      ...current,
                      creditStatus: event.target.value as 'ACTIVE' | 'BLOCKED',
                    }))
                  }
                  className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm disabled:bg-zinc-100"
                >
                  <option value="ACTIVE">Activo</option>
                  <option value="BLOCKED">Bloqueado</option>
                </select>
              </Field>
              <Field label="Límite de crédito (RD$)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={creditForm.creditLimit}
                  onChange={(event) =>
                    setCreditForm((current) => ({
                      ...current,
                      creditLimit: event.target.value,
                    }))
                  }
                  required
                />
              </Field>
              <Field label="Días de crédito recomendados">
                <Input
                  type="number"
                  min="1"
                  max="365"
                  step="1"
                  value={creditForm.creditTermDays}
                  onChange={(event) =>
                    setCreditForm((current) => ({
                      ...current,
                      creditTermDays: event.target.value,
                    }))
                  }
                  required
                />
              </Field>
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm md:col-span-2">
                Balance actual:{' '}
                <strong>
                  RD$
                  {Number(creditCustomer.creditBalance ?? 0).toLocaleString('es-DO', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </div>
              <div className="md:col-span-2">
                <Button type="submit" disabled={creditMutation.isPending}>
                  <Save className="h-4 w-4" />
                  Guardar configuración de crédito
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Directorio</CardTitle>
          <CardDescription>
            {filteredCustomers.length} registros visibles del tenant actual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 md:hidden">
            {filteredCustomers.map((customer) => (
              <div key={customer.id} className="rounded-md border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{customer.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {translateDocumentType(customer.documentType)}
                      {customer.documentNumber ? ` ${customer.documentNumber}` : ''}
                    </p>
                  </div>
                  <Badge variant={getStatusVariant(customer.status)}>
                    {translateStatus(customer.status)}
                  </Badge>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  <p>{customer.email ?? 'Sin correo'}</p>
                  <p>{customer.phone ?? 'Sin telefono'}</p>
                </div>
                <div className="mt-3 rounded-md bg-zinc-50 p-2 text-xs">
                  <p className="font-medium">
                    Crédito:{' '}
                    {customer.creditEnabled
                      ? customer.creditStatus === 'ACTIVE'
                        ? 'Activo'
                        : 'Bloqueado'
                      : 'No habilitado'}
                  </p>
                  <p className="text-muted-foreground">
                    Límite RD$
                    {Number(customer.creditLimit ?? 0).toLocaleString('es-DO', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    · Balance RD$
                    {Number(customer.creditBalance ?? 0).toLocaleString('es-DO', {
                      minimumFractionDigits: 2,
                    })}
                  </p>
                </div>
                {!readOnly ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEditForm(customer)}>
                      <Pencil className="h-4 w-4" />
                      Editar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => openCreditForm(customer)}>
                      <CreditCard className="h-4 w-4" />
                      Crédito
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(customer.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Desactivar
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Crédito</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Creado</TableHead>
                  {!readOnly ? <TableHead className="text-right">Acciones</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell>
                      {translateDocumentType(customer.documentType)}
                      {customer.documentNumber ? ` ${customer.documentNumber}` : ''}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{customer.email ?? 'Sin correo'}</div>
                      <div className="text-xs text-muted-foreground">
                        {customer.phone ?? 'Sin telefono'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">
                        {customer.creditEnabled
                          ? customer.creditStatus === 'ACTIVE'
                            ? 'Activo'
                            : 'Bloqueado'
                          : 'No habilitado'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        <span
                          className={
                            Number(customer.creditBalance ?? 0) > 0 ? 'text-danger' : undefined
                          }
                        >
                          RD$
                          {Number(customer.creditBalance ?? 0).toLocaleString('es-DO', {
                            minimumFractionDigits: 2,
                          })}
                        </span>{' '}
                        / RD$
                        {Number(customer.creditLimit ?? 0).toLocaleString('es-DO', {
                          minimumFractionDigits: 2,
                        })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(customer.status)}>
                        {translateStatus(customer.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(customer.createdAt)}</TableCell>
                    {!readOnly ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => openEditForm(customer)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Configurar crédito"
                            onClick={() => openCreditForm(customer)}
                          >
                            <CreditCard className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteMutation.mutate(customer.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
