'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, PackagePlus, Pencil, Plus, Search, UserRoundCheck } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ActionDialog } from '@/components/ui/action-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  addSupplierProduct,
  createSupplier,
  deactivateSupplier,
  getProducts,
  getSupplier,
  getSuppliers,
  removeSupplierProduct,
  updateSupplier,
  updateSupplierProduct,
  type Supplier,
  type SupplierPayload,
  type SupplierStatus,
} from '@/lib/api';
import { isAdminSession } from '@/lib/authorization';
import {
  formatDominicanDocument,
  normalizeDominicanDocument,
  validateDominicanDocument,
} from '@/lib/dominican-documents';
import { formatCurrency } from '@/lib/utils';
import { ModuleHeader } from './module-header';
import {
  FormField,
  ProcurementStatusBadge,
  QueryState,
  selectClassName,
  textareaClassName,
} from './procurement-ui';
import { SessionRequired, useCurrentSession } from './session-required';

type SupplierForm = {
  commercialName: string;
  legalName: string;
  documentType: 'RNC' | 'CEDULA';
  documentNumber: string;
  phone: string;
  email: string;
  address: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  paymentTerms: string;
  creditDays: string;
  notes: string;
};

type SupplierRelationEditor = {
  productId: string;
  productName: string;
  lastCostNet: string;
  lastCostWithTax: string;
  leadTimeDays: string;
};

type SupplierRelationStatusAction = {
  productId: string;
  productName: string;
  action: 'deactivate' | 'reactivate';
};

type SupplierStatusAction = {
  supplier: Supplier;
  next: SupplierStatus;
};

const emptySupplierForm: SupplierForm = {
  commercialName: '',
  legalName: '',
  documentType: 'RNC',
  documentNumber: '',
  phone: '',
  email: '',
  address: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  paymentTerms: '',
  creditDays: '0',
  notes: '',
};

export function SuppliersView() {
  const session = useCurrentSession();
  const queryClient = useQueryClient();
  const admin = isAdminSession(session);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | SupplierStatus>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SupplierForm>(emptySupplierForm);
  const [productId, setProductId] = useState('');
  const [supplierSku, setSupplierSku] = useState('');
  const [lastCostNet, setLastCostNet] = useState('');
  const [lastCostWithTax, setLastCostWithTax] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);
  const [relationEditor, setRelationEditor] = useState<SupplierRelationEditor | null>(null);
  const [relationStatusAction, setRelationStatusAction] =
    useState<SupplierRelationStatusAction | null>(null);
  const [supplierStatusAction, setSupplierStatusAction] = useState<SupplierStatusAction | null>(
    null,
  );

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('q');
    if (query) setSearch(query);
  }, []);

  const suppliersQuery = useQuery({
    queryKey: ['suppliers', session?.tenantId, search, status],
    queryFn: () =>
      getSuppliers(session?.tenantId ?? '', session?.accessToken ?? '', {
        q: search,
        status: status === 'ALL' ? undefined : status,
      }),
    enabled: Boolean(session),
  });
  const detailQuery = useQuery({
    queryKey: ['supplier', session?.tenantId, selectedId],
    queryFn: () =>
      getSupplier(session?.tenantId ?? '', session?.accessToken ?? '', selectedId ?? ''),
    enabled: Boolean(session && selectedId),
  });
  const productsQuery = useQuery({
    queryKey: ['products', session?.tenantId, 'supplier-relation'],
    queryFn: () => getProducts(session?.tenantId ?? '', session?.accessToken ?? ''),
    enabled: Boolean(session && admin),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: SupplierPayload) => {
      if (!session) throw new Error('Sesión requerida.');
      return editingId
        ? updateSupplier(session.tenantId, session.accessToken, editingId, payload)
        : createSupplier(session.tenantId, session.accessToken, payload);
    },
    onSuccess: async (supplier) => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      await queryClient.invalidateQueries({
        queryKey: ['supplier', session?.tenantId, supplier.id],
      });
      setSelectedId(supplier.id);
      setEditingId(null);
      setForm(emptySupplierForm);
      setShowForm(false);
      toast.success('Suplidor guardado correctamente.');
    },
    onError: showError,
  });
  const statusMutation = useMutation({
    mutationFn: ({ supplier, next }: { supplier: Supplier; next: SupplierStatus }) => {
      if (!session) throw new Error('Sesión requerida.');
      return next === 'INACTIVE'
        ? deactivateSupplier(session.tenantId, session.accessToken, supplier.id)
        : updateSupplier(session.tenantId, session.accessToken, supplier.id, { status: 'ACTIVE' });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      await queryClient.invalidateQueries({ queryKey: ['supplier'] });
      toast.success('Estado del suplidor actualizado.');
    },
    onError: showError,
  });
  const addProductMutation = useMutation({
    mutationFn: () => {
      if (!session || !selectedId || !productId) {
        throw new Error('Selecciona un suplidor y un producto.');
      }
      return addSupplierProduct(session.tenantId, session.accessToken, selectedId, {
        productId,
        supplierSku: optional(supplierSku),
        lastCostNet: optionalNumber(lastCostNet),
        lastCostWithTax: optionalNumber(lastCostWithTax),
        leadTimeDays: optionalNumber(leadTimeDays),
        isPrimary,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['supplier', session?.tenantId, selectedId],
      });
      setProductId('');
      setSupplierSku('');
      setLastCostNet('');
      setLastCostWithTax('');
      setLeadTimeDays('');
      setIsPrimary(false);
      toast.success('Producto vinculado al suplidor.');
    },
    onError: showError,
  });
  const updateProductMutation = useMutation({
    mutationFn: ({
      productId: relationProductId,
      payload,
    }: {
      productId: string;
      payload: {
        supplierSku?: string;
        lastCostNet?: number;
        lastCostWithTax?: number;
        leadTimeDays?: number;
        isPrimary?: boolean;
        active?: boolean;
      };
    }) => {
      if (!session || !selectedId) throw new Error('Selecciona un suplidor.');
      return updateSupplierProduct(
        session.tenantId,
        session.accessToken,
        selectedId,
        relationProductId,
        payload,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['supplier', session?.tenantId, selectedId],
      });
      toast.success('Relación de producto actualizada.');
    },
    onError: showError,
  });
  const removeProductMutation = useMutation({
    mutationFn: (relationProductId: string) => {
      if (!session || !selectedId) throw new Error('Selecciona un suplidor.');
      return removeSupplierProduct(
        session.tenantId,
        session.accessToken,
        selectedId,
        relationProductId,
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['supplier', session?.tenantId, selectedId],
      });
      toast.success('Relación desactivada; el historial se conserva.');
    },
    onError: showError,
  });

  const availableProducts = useMemo(() => {
    const related = new Set(detailQuery.data?.products?.map((item) => item.productId) ?? []);
    return (productsQuery.data ?? []).filter(
      (product) => product.status === 'ACTIVE' && !related.has(product.id),
    );
  }, [detailQuery.data?.products, productsQuery.data]);

  const relationEditorInvalid =
    relationEditor !== null &&
    (!isOptionalNonNegativeDecimal(relationEditor.lastCostNet) ||
      !isOptionalNonNegativeDecimal(relationEditor.lastCostWithTax) ||
      !isOptionalNonNegativeInteger(relationEditor.leadTimeDays));
  const relationStatusPending =
    relationStatusAction?.action === 'deactivate'
      ? removeProductMutation.isPending
      : updateProductMutation.isPending;

  if (!session) return <SessionRequired session={session} />;

  function submitSupplier(event: FormEvent) {
    event.preventDefault();
    const documentNumber = normalizeDominicanDocument(form.documentNumber);
    if (!validateDominicanDocument(form.documentType, form.documentNumber)) {
      toast.error(`El ${form.documentType === 'RNC' ? 'RNC' : 'número de cédula'} no es válido.`);
      return;
    }
    saveMutation.mutate({
      commercialName: form.commercialName.trim(),
      legalName: optional(form.legalName),
      documentType: form.documentType,
      documentNumber,
      phone: optional(form.phone),
      email: optional(form.email),
      address: optional(form.address),
      contactName: optional(form.contactName),
      contactPhone: optional(form.contactPhone),
      contactEmail: optional(form.contactEmail),
      paymentTerms: optional(form.paymentTerms),
      creditDays: Number(form.creditDays || 0),
      notes: optional(form.notes),
    });
  }

  function editSupplier(supplier: Supplier) {
    setEditingId(supplier.id);
    setForm({
      commercialName: supplier.commercialName,
      legalName: supplier.legalName ?? '',
      documentType: supplier.documentType,
      documentNumber: supplier.documentNumber,
      phone: supplier.phone ?? '',
      email: supplier.email ?? '',
      address: supplier.address ?? '',
      contactName: supplier.contactName ?? '',
      contactPhone: supplier.contactPhone ?? '',
      contactEmail: supplier.contactEmail ?? '',
      paymentTerms: supplier.paymentTerms ?? '',
      creditDays: String(supplier.creditDays),
      notes: supplier.notes ?? '',
    });
    setShowForm(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <ModuleHeader
          title="Suplidores"
          description="Directorio, condiciones de compra y productos vinculados a cada suplidor."
        />
        {admin ? (
          <Button
            onClick={() => {
              setEditingId(null);
              setForm(emptySupplierForm);
              setShowForm((value) => !value);
            }}
          >
            <Plus className="h-4 w-4" />
            Nuevo suplidor
          </Button>
        ) : (
          <Badge variant="outline">Consulta contable</Badge>
        )}
      </div>
      {showForm && admin ? (
        <Card>
          <CardHeader>
            <CardTitle>{editingId ? 'Editar suplidor' : 'Registrar suplidor'}</CardTitle>
            <CardDescription>
              El RNC o la cédula se validará con el dígito verificador dominicano.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitSupplier} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <FormField label="Nombre comercial" htmlFor="supplier-commercial">
                  <Input
                    id="supplier-commercial"
                    required
                    maxLength={160}
                    value={form.commercialName}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, commercialName: event.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Razón social" htmlFor="supplier-legal">
                  <Input
                    id="supplier-legal"
                    maxLength={200}
                    value={form.legalName}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, legalName: event.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Tipo de documento" htmlFor="supplier-document-type">
                  <select
                    id="supplier-document-type"
                    className={selectClassName}
                    value={form.documentType}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        documentType: event.target.value as 'RNC' | 'CEDULA',
                        documentNumber: '',
                      }))
                    }
                  >
                    <option value="RNC">RNC</option>
                    <option value="CEDULA">Cédula</option>
                  </select>
                </FormField>
                <FormField label={form.documentType === 'RNC' ? 'RNC' : 'Cédula'}>
                  <Input
                    required
                    inputMode="numeric"
                    value={form.documentNumber}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        documentNumber: event.target.value,
                      }))
                    }
                    placeholder={form.documentType === 'RNC' ? '1-01-00000-1' : '001-0000000-1'}
                  />
                </FormField>
                <FormField label="Teléfono">
                  <Input
                    value={form.phone}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, phone: event.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Correo">
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, email: event.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Persona de contacto">
                  <Input
                    value={form.contactName}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, contactName: event.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Teléfono del contacto">
                  <Input
                    value={form.contactPhone}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, contactPhone: event.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Correo del contacto">
                  <Input
                    type="email"
                    value={form.contactEmail}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, contactEmail: event.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Días de crédito">
                  <Input
                    type="number"
                    min={0}
                    max={3650}
                    value={form.creditDays}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, creditDays: event.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Condiciones de pago" className="md:col-span-2">
                  <Input
                    value={form.paymentTerms}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, paymentTerms: event.target.value }))
                    }
                    placeholder="Ej.: crédito a 30 días"
                  />
                </FormField>
                <FormField label="Dirección" className="md:col-span-2">
                  <Input
                    value={form.address}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, address: event.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Notas" className="md:col-span-2">
                  <textarea
                    className={textareaClassName}
                    value={form.notes}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </FormField>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cerrar
                </Button>
                <Button disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? 'Guardando...' : 'Guardar suplidor'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre, documento, teléfono o contacto"
            />
          </div>
          <select
            className={selectClassName}
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="ALL">Todos los estados</option>
            <option value="ACTIVE">Activos</option>
            <option value="INACTIVE">Inactivos</option>
          </select>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Directorio de suplidores</CardTitle>
          <CardDescription>
            {suppliersQuery.data?.length ?? 0} suplidor(es) en el filtro actual.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState
            loading={suppliersQuery.isLoading}
            error={suppliersQuery.error}
            empty={!suppliersQuery.isLoading && !suppliersQuery.data?.length}
            emptyMessage="Aún no hay suplidores registrados."
          />
          {suppliersQuery.data?.length ? (
            <>
              <div className="space-y-3 md:hidden">
                {suppliersQuery.data.map((supplier) => (
                  <button
                    key={supplier.id}
                    type="button"
                    onClick={() => setSelectedId(supplier.id)}
                    className="w-full rounded-md border p-4 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="flex justify-between gap-3">
                      <div>
                        <p className="font-semibold">{supplier.commercialName}</p>
                        <p className="text-xs text-muted-foreground">
                          {supplier.documentType}{' '}
                          {formatDominicanDocument(supplier.documentType, supplier.documentNumber)}
                        </p>
                      </div>
                      <ProcurementStatusBadge status={supplier.status} />
                    </div>
                    <p className="mt-3 text-sm">
                      {supplier._count?.products ?? 0} producto(s) · {supplier.creditDays} días
                    </p>
                  </button>
                ))}
              </div>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Suplidor</TableHead>
                      <TableHead>Documento</TableHead>
                      <TableHead>Contacto</TableHead>
                      <TableHead>Crédito</TableHead>
                      <TableHead>Productos</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suppliersQuery.data.map((supplier) => (
                      <TableRow key={supplier.id}>
                        <TableCell>
                          <p className="font-medium">{supplier.commercialName}</p>
                          <p className="text-xs text-muted-foreground">
                            {supplier.legalName ?? 'Sin razón social'}
                          </p>
                        </TableCell>
                        <TableCell>
                          {supplier.documentType}{' '}
                          {formatDominicanDocument(supplier.documentType, supplier.documentNumber)}
                        </TableCell>
                        <TableCell>
                          <p>{supplier.contactName ?? supplier.phone ?? 'Sin contacto'}</p>
                          <p className="text-xs text-muted-foreground">{supplier.email}</p>
                        </TableCell>
                        <TableCell>{supplier.creditDays} días</TableCell>
                        <TableCell>{supplier._count?.products ?? 0}</TableCell>
                        <TableCell>
                          <ProcurementStatusBadge status={supplier.status} />
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setSelectedId(supplier.id)}
                            >
                              Ver
                            </Button>
                            {admin ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label="Editar suplidor"
                                onClick={() => editSupplier(supplier)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
      {selectedId ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Detalle del suplidor</CardTitle>
                <CardDescription>
                  Información de contacto y relación de productos suministrados.
                </CardDescription>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
                Cerrar detalle
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <QueryState loading={detailQuery.isLoading} error={detailQuery.error} />
            {detailQuery.data ? (
              <>
                <div className="grid gap-3 rounded-md border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Summary
                    icon={<Building2 />}
                    label="Suplidor"
                    value={detailQuery.data.commercialName}
                  />
                  <Summary
                    icon={<UserRoundCheck />}
                    label="Contacto"
                    value={detailQuery.data.contactName ?? 'No indicado'}
                  />
                  <Summary
                    label="Teléfono"
                    value={detailQuery.data.contactPhone ?? detailQuery.data.phone ?? 'No indicado'}
                  />
                  <Summary
                    label="Condición"
                    value={
                      detailQuery.data.paymentTerms ??
                      `${detailQuery.data.creditDays} días de crédito`
                    }
                  />
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold">Productos suministrados</h3>
                      <p className="text-sm text-muted-foreground">
                        Código propio, último costo y tiempo estimado de entrega.
                      </p>
                    </div>
                  </div>
                  <QueryState
                    empty={!detailQuery.data.products?.length}
                    emptyMessage="Este suplidor todavía no tiene productos vinculados."
                  />
                  {detailQuery.data.products?.length ? (
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Producto</TableHead>
                            <TableHead>SKU suplidor</TableHead>
                            <TableHead>Costo neto</TableHead>
                            <TableHead>Costo con ITBIS</TableHead>
                            <TableHead>Entrega</TableHead>
                            <TableHead>Relación</TableHead>
                            {admin ? <TableHead className="text-right">Acciones</TableHead> : null}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {detailQuery.data.products.map((relation) => (
                            <TableRow key={relation.id}>
                              <TableCell>
                                <p className="font-medium">{relation.product.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {relation.product.sku ?? 'Sin SKU'}
                                </p>
                              </TableCell>
                              <TableCell>{relation.supplierSku ?? '—'}</TableCell>
                              <TableCell>
                                {relation.lastCostNet
                                  ? formatCurrency(Number(relation.lastCostNet))
                                  : '—'}
                              </TableCell>
                              <TableCell>
                                {relation.lastCostWithTax
                                  ? formatCurrency(Number(relation.lastCostWithTax))
                                  : '—'}
                              </TableCell>
                              <TableCell>
                                {relation.leadTimeDays === null
                                  ? '—'
                                  : `${relation.leadTimeDays} días`}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-2">
                                  {relation.isPrimary ? (
                                    <Badge variant="success">Principal</Badge>
                                  ) : null}
                                  {!relation.active ? (
                                    <Badge variant="danger">Inactiva</Badge>
                                  ) : null}
                                </div>
                              </TableCell>
                              {admin ? (
                                <TableCell>
                                  <div className="flex justify-end gap-2">
                                    {relation.active && !relation.isPrimary ? (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() =>
                                          updateProductMutation.mutate({
                                            productId: relation.productId,
                                            payload: { isPrimary: true },
                                          })
                                        }
                                      >
                                        Hacer principal
                                      </Button>
                                    ) : null}
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        setRelationEditor({
                                          productId: relation.productId,
                                          productName: relation.product.name,
                                          lastCostNet: relation.lastCostNet ?? '',
                                          lastCostWithTax: relation.lastCostWithTax ?? '',
                                          leadTimeDays: relation.leadTimeDays?.toString() ?? '',
                                        })
                                      }
                                    >
                                      Editar
                                    </Button>
                                    {relation.active ? (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          setRelationStatusAction({
                                            productId: relation.productId,
                                            productName: relation.product.name,
                                            action: 'deactivate',
                                          })
                                        }
                                      >
                                        Desactivar
                                      </Button>
                                    ) : (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        onClick={() =>
                                          setRelationStatusAction({
                                            productId: relation.productId,
                                            productName: relation.product.name,
                                            action: 'reactivate',
                                          })
                                        }
                                      >
                                        Reactivar
                                      </Button>
                                    )}
                                  </div>
                                </TableCell>
                              ) : null}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null}
                </div>

                {admin && detailQuery.data.status === 'ACTIVE' ? (
                  <div className="rounded-md border border-dashed p-4">
                    <div className="mb-4 flex items-center gap-2">
                      <PackagePlus className="h-4 w-4 text-accent" />
                      <h3 className="font-semibold">Vincular producto</h3>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                      <FormField label="Producto" className="xl:col-span-2">
                        <select
                          className={selectClassName}
                          value={productId}
                          onChange={(event) => setProductId(event.target.value)}
                        >
                          <option value="">Selecciona...</option>
                          {availableProducts.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name} {product.sku ? `· ${product.sku}` : ''}
                            </option>
                          ))}
                        </select>
                      </FormField>
                      <FormField label="SKU suplidor">
                        <Input
                          value={supplierSku}
                          onChange={(event) => setSupplierSku(event.target.value)}
                        />
                      </FormField>
                      <FormField label="Costo neto">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={lastCostNet}
                          onChange={(event) => setLastCostNet(event.target.value)}
                        />
                      </FormField>
                      <FormField label="Costo con ITBIS">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={lastCostWithTax}
                          onChange={(event) => setLastCostWithTax(event.target.value)}
                        />
                      </FormField>
                      <FormField label="Entrega (días)">
                        <Input
                          type="number"
                          min={0}
                          value={leadTimeDays}
                          onChange={(event) => setLeadTimeDays(event.target.value)}
                        />
                      </FormField>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={isPrimary}
                          onChange={(event) => setIsPrimary(event.target.checked)}
                        />
                        Marcar como suplidor principal
                      </label>
                      <Button
                        type="button"
                        onClick={() => addProductMutation.mutate()}
                        disabled={!productId || addProductMutation.isPending}
                      >
                        Vincular producto
                      </Button>
                    </div>
                  </div>
                ) : null}

                {admin ? (
                  <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => editSupplier(detailQuery.data!)}
                    >
                      <Pencil className="h-4 w-4" />
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={statusMutation.isPending}
                      onClick={() => {
                        const next = detailQuery.data!.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
                        setSupplierStatusAction({ supplier: detailQuery.data!, next });
                      }}
                    >
                      {detailQuery.data.status === 'ACTIVE' ? 'Desactivar' : 'Reactivar'}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <ActionDialog
        open={Boolean(relationEditor)}
        onClose={() => {
          if (!updateProductMutation.isPending) setRelationEditor(null);
        }}
        title={
          relationEditor ? `Editar relación con ${relationEditor.productName}` : 'Editar relación'
        }
        description="Actualiza los costos y el tiempo de entrega de referencia para este suplidor."
        tone="default"
        size="lg"
        confirmLabel="Guardar cambios"
        cancelLabel="Cancelar"
        isPending={updateProductMutation.isPending}
        confirmDisabled={relationEditorInvalid}
        onConfirm={() => {
          const relation = relationEditor;
          if (!relation) return;
          updateProductMutation.mutate(
            {
              productId: relation.productId,
              payload: {
                lastCostNet: optionalNumber(relation.lastCostNet),
                lastCostWithTax: optionalNumber(relation.lastCostWithTax),
                leadTimeDays: optionalNumber(relation.leadTimeDays),
              },
            },
            { onSuccess: () => setRelationEditor(null) },
          );
        }}
        summary={
          relationEditor ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Producto vinculado
                </p>
                <p className="mt-0.5 font-semibold text-foreground">{relationEditor.productName}</p>
              </div>
              <Badge variant="outline">Datos de compra</Badge>
            </div>
          ) : null
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Último costo neto" htmlFor="relation-last-cost-net">
            <Input
              id="relation-last-cost-net"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={relationEditor?.lastCostNet ?? ''}
              onChange={(event) =>
                setRelationEditor((current) =>
                  current ? { ...current, lastCostNet: event.target.value } : current,
                )
              }
              placeholder="Ej.: 125.50"
              data-dialog-autofocus
            />
          </FormField>
          <FormField label="Último costo con ITBIS" htmlFor="relation-last-cost-with-tax">
            <Input
              id="relation-last-cost-with-tax"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={relationEditor?.lastCostWithTax ?? ''}
              onChange={(event) =>
                setRelationEditor((current) =>
                  current ? { ...current, lastCostWithTax: event.target.value } : current,
                )
              }
              placeholder="Ej.: 148.09"
            />
          </FormField>
          <FormField
            label="Tiempo de entrega (días)"
            htmlFor="relation-lead-time"
            className="sm:col-span-2"
          >
            <Input
              id="relation-lead-time"
              type="number"
              inputMode="numeric"
              min={0}
              step="1"
              value={relationEditor?.leadTimeDays ?? ''}
              onChange={(event) =>
                setRelationEditor((current) =>
                  current ? { ...current, leadTimeDays: event.target.value } : current,
                )
              }
              placeholder="Ej.: 3"
            />
          </FormField>
        </div>
      </ActionDialog>
      <ActionDialog
        open={Boolean(relationStatusAction)}
        onClose={() => {
          if (!relationStatusPending) setRelationStatusAction(null);
        }}
        title={
          relationStatusAction?.action === 'reactivate'
            ? 'Reactivar relación de producto'
            : 'Desactivar relación de producto'
        }
        description={
          relationStatusAction?.action === 'reactivate'
            ? 'El producto volverá a estar disponible para nuevas compras a este suplidor.'
            : 'La relación dejará de usarse en nuevas compras; el historial se conservará.'
        }
        tone={relationStatusAction?.action === 'reactivate' ? 'success' : 'danger'}
        size="sm"
        confirmLabel={
          relationStatusAction?.action === 'reactivate'
            ? 'Reactivar relación'
            : 'Desactivar relación'
        }
        cancelLabel="Cancelar"
        isPending={relationStatusPending}
        onConfirm={() => {
          const action = relationStatusAction;
          if (!action) return;
          if (action.action === 'deactivate') {
            removeProductMutation.mutate(action.productId, {
              onSuccess: () => setRelationStatusAction(null),
            });
            return;
          }
          updateProductMutation.mutate(
            { productId: action.productId, payload: { active: true } },
            { onSuccess: () => setRelationStatusAction(null) },
          );
        }}
        summary={
          relationStatusAction ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Producto
              </p>
              <p className="mt-0.5 font-semibold text-foreground">
                {relationStatusAction.productName}
              </p>
            </div>
          ) : null
        }
      />
      <ActionDialog
        open={Boolean(supplierStatusAction)}
        onClose={() => {
          if (!statusMutation.isPending) setSupplierStatusAction(null);
        }}
        title={
          supplierStatusAction?.next === 'ACTIVE' ? 'Reactivar suplidor' : 'Desactivar suplidor'
        }
        description={
          supplierStatusAction?.next === 'ACTIVE'
            ? 'El suplidor volverá a estar disponible para nuevas operaciones de compra.'
            : 'El suplidor dejará de estar disponible para nuevas operaciones. Su historial se conservará.'
        }
        tone={supplierStatusAction?.next === 'ACTIVE' ? 'success' : 'danger'}
        size="sm"
        confirmLabel={
          supplierStatusAction?.next === 'ACTIVE' ? 'Reactivar suplidor' : 'Desactivar suplidor'
        }
        cancelLabel="Cancelar"
        isPending={statusMutation.isPending}
        onConfirm={() => {
          const action = supplierStatusAction;
          if (!action) return;
          statusMutation.mutate(action, { onSuccess: () => setSupplierStatusAction(null) });
        }}
        summary={
          supplierStatusAction ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Suplidor
              </p>
              <p className="mt-0.5 font-semibold text-foreground">
                {supplierStatusAction.supplier.commercialName}
              </p>
            </div>
          ) : null
        }
      />
    </div>
  );
}

function Summary({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex gap-3">
      {icon ? <span className="mt-0.5 [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function optional(value: string) {
  return value.trim() || undefined;
}

function optionalNumber(value: string) {
  return value.trim() ? Number(value) : undefined;
}

function isOptionalNonNegativeDecimal(value: string) {
  return !value.trim() || (Number.isFinite(Number(value)) && Number(value) >= 0);
}
function isOptionalNonNegativeInteger(value: string) {
  return (
    !value.trim() ||
    (Number.isFinite(Number(value)) && Number.isInteger(Number(value)) && Number(value) >= 0)
  );
}
function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : 'No se pudo completar la operación.');
}
