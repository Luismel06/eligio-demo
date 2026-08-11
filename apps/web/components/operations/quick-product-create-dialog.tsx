'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Link2, LoaderCircle, PackagePlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  addSupplierProduct,
  createProduct,
  type Product,
  type ProductTaxCategory,
  type ProductUnit,
} from '@/lib/api';
import type { AuthSession } from '@/lib/auth-session';
import { selectClassName } from './procurement-ui';
import { SupplierInvoiceDialog } from './supplier-invoice-dialog';

export type QuickProductCreatePrefill = {
  /** Nombre leído de la factura o escrito por la persona. */
  name?: string;
  /** Código que usa el suplidor. No se reutiliza como SKU interno automáticamente. */
  supplierSku?: string;
  /** Costo unitario antes de ITBIS. */
  costNet?: number;
  /** Tasa decimal, por ejemplo 0.18 para 18 %. */
  taxRate?: number;
};

type QuickProductCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Alternativa conveniente para pantallas que ya tienen la sesión. */
  session?: Pick<AuthSession, 'tenantId' | 'accessToken' | 'role'> | null;
  /** También puede utilizarse sin pasar la sesión completa. */
  tenantId?: string;
  accessToken?: string;
  existingProducts: Product[];
  prefill?: QuickProductCreatePrefill;
  /** Si se provee, el producto puede vincularse al suplidor al finalizar. */
  supplierId?: string;
  supplierName?: string;
  linkSupplierByDefault?: boolean;
  onCreated: (product: Product) => void | Promise<void>;
  /** Permite a la pantalla que invoca reutilizar una coincidencia en vez de duplicarla. */
  onSelectExisting?: (product: Product) => void | Promise<void>;
};

type ProductForm = {
  name: string;
  sku: string;
  barcode: string;
  supplierSku: string;
  unit: ProductUnit;
  cost: string;
  salePrice: string;
  taxPercent: string;
  linkToSupplier: boolean;
};

type DuplicateMatch = {
  product: Product;
  reasons: Array<'name' | 'sku' | 'barcode'>;
};

const productUnits = [
  ['UNIT', 'Unidad'],
  ['BOX', 'Caja'],
  ['PACK', 'Paquete'],
  ['BAG', 'Saco'],
  ['ROLL', 'Rollo'],
  ['METER', 'Metro'],
  ['FOOT', 'Pie'],
  ['YARD', 'Yarda'],
  ['POUND', 'Libra'],
  ['GALLON', 'Galón'],
  ['LITER', 'Litro'],
  ['KILOGRAM', 'Kilogramo'],
] as const;

/**
 * Alta breve y deliberada de un producto que no existe al registrar una factura.
 *
 * El stock inicia en cero: el único paso que lo aumenta es la confirmación de la
 * entrada de la factura. Así no se duplica inventario al corregir el OCR.
 */
export function QuickProductCreateDialog({
  open,
  onOpenChange,
  session,
  tenantId: tenantIdProp,
  accessToken: accessTokenProp,
  existingProducts,
  prefill,
  supplierId,
  supplierName,
  linkSupplierByDefault = true,
  onCreated,
  onSelectExisting,
}: QuickProductCreateDialogProps) {
  const queryClient = useQueryClient();
  const tenantId = session?.tenantId ?? tenantIdProp ?? '';
  const accessToken = session?.accessToken ?? accessTokenProp ?? '';
  const wasOpen = useRef(false);
  const [selectingExistingId, setSelectingExistingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(() =>
    createInitialForm(prefill, supplierId, linkSupplierByDefault),
  );

  useEffect(() => {
    if (open && !wasOpen.current) {
      setForm(createInitialForm(prefill, supplierId, linkSupplierByDefault));
      setSelectingExistingId(null);
    }
    wasOpen.current = open;
  }, [linkSupplierByDefault, open, prefill, supplierId]);

  const duplicateMatches = useMemo(
    () => findDuplicateMatches(existingProducts, form),
    [existingProducts, form.barcode, form.name, form.sku],
  );
  const hasDuplicate = duplicateMatches.length > 0;
  const canCreate = hasSessionCredentials(tenantId, accessToken);

  const createMutation = useMutation({
    mutationFn: async () => {
      const validationError = validateForm(form);
      if (validationError) throw new Error(validationError);
      if (!tenantId || !accessToken)
        throw new Error('La sesión activa es requerida para crear el producto.');

      const cost = Number(form.cost);
      const taxRate = Number(form.taxPercent) / 100;
      const taxCategory = getTaxCategory(form.taxPercent);
      const product = await createProduct(tenantId, accessToken, {
        name: form.name.trim(),
        sku: optional(form.sku),
        barcode: optional(form.barcode),
        unit: form.unit,
        price: Number(form.salePrice),
        cost,
        taxCategory,
        taxRate,
        stock: 0,
        minStock: 0,
        trackInventory: true,
        status: 'ACTIVE',
      });

      let supplierLinkError: Error | null = null;
      if (supplierId && form.linkToSupplier) {
        try {
          await addSupplierProduct(tenantId, accessToken, supplierId, {
            productId: product.id,
            supplierSku: optional(form.supplierSku),
            lastCostNet: cost,
            lastCostWithTax: roundCurrency(cost * (1 + taxRate)),
          });
        } catch (error) {
          supplierLinkError = toError(error);
        }
      }

      return { product, supplierLinkError };
    },
    onSuccess: async ({ product, supplierLinkError }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['products'] }),
        queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
        queryClient.invalidateQueries({ queryKey: ['supplier'] }),
      ]);

      try {
        await onCreated(product);
      } catch (error) {
        toast.error('El producto fue creado, pero no se pudo aplicarlo automáticamente.', {
          description: toError(error).message,
        });
      }

      if (supplierLinkError) {
        toast.warning('El producto fue creado, pero no se pudo vincular al suplidor.', {
          description: `${supplierLinkError.message} Puedes vincularlo desde Suplidores sin crear otro producto.`,
        });
      } else {
        toast.success('Producto creado correctamente.', {
          description:
            supplierId && form.linkToSupplier ? 'También quedó vinculado al suplidor.' : undefined,
        });
      }
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error('No se pudo crear el producto.', { description: toError(error).message });
    },
  });

  function updateField<K extends keyof ProductForm>(field: K, value: ProductForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function selectExisting(product: Product) {
    if (!onSelectExisting) return;
    setSelectingExistingId(product.id);
    try {
      await onSelectExisting(product);
      onOpenChange(false);
    } catch (error) {
      toast.error('No se pudo seleccionar el producto existente.', {
        description: toError(error).message,
      });
    } finally {
      setSelectingExistingId(null);
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasDuplicate) {
      toast.error(
        'Ya existe una coincidencia exacta. Selecciónala o corrige los datos antes de crear otro producto.',
      );
      return;
    }
    createMutation.mutate();
  }

  return (
    <SupplierInvoiceDialog
      open={open}
      onClose={() => {
        if (!createMutation.isPending) onOpenChange(false);
      }}
      eyebrow="Catálogo de productos"
      title="Agregar producto faltante"
      description="Crea solamente el producto que no existe. Su inventario comenzará en cero y aumentará al confirmar esta factura."
      icon={<PackagePlus className="h-5 w-5" />}
      size="lg"
      layer="overlay"
    >
      {!canCreate ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          No hay una sesión válida para crear el producto. Cierra esta ventana e inicia sesión
          nuevamente.
        </div>
      ) : (
        <form className="space-y-5" onSubmit={submit}>
          <div className="rounded-xl border border-primary/15 bg-primary/[0.045] p-3 text-sm text-muted-foreground">
            Se verifican coincidencias exactas por nombre, SKU y código de barras antes de crear. El
            servidor vuelve a validar SKU y código de barras para evitar duplicados simultáneos.
          </div>

          {hasDuplicate ? (
            <div className="rounded-xl border border-warning/40 bg-warning/10 p-4" role="alert">
              <div className="flex gap-3">
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-warning"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground">
                    Ya existe un producto que coincide exactamente.
                  </p>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    Para conservar un catálogo limpio, reutiliza la coincidencia o modifica los
                    datos antes de crear uno nuevo.
                  </p>
                  <div className="mt-3 space-y-2">
                    {duplicateMatches.map(({ product, reasons }) => (
                      <div
                        key={product.id}
                        className="flex flex-col gap-3 rounded-lg border border-warning/25 bg-card/80 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{product.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {duplicateReasonLabel(reasons)} · SKU {product.sku ?? '—'} · Código{' '}
                            {product.barcode ?? '—'}
                          </p>
                        </div>
                        {onSelectExisting ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void selectExisting(product)}
                            disabled={Boolean(selectingExistingId)}
                          >
                            {selectingExistingId === product.id ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4" />
                            )}
                            Usar existente
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Descripción del producto" required className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                placeholder="Ej. Cemento Portland gris"
                maxLength={160}
                autoFocus
                required
              />
            </Field>
            <Field label="Código interno (SKU)" hint="Déjalo vacío para generarlo automáticamente.">
              <Input
                value={form.sku}
                onChange={(event) => updateField('sku', event.target.value)}
                placeholder="Automático"
                maxLength={80}
              />
            </Field>
            <Field label="Código de barras" hint="Déjalo vacío para generar uno interno.">
              <Input
                value={form.barcode}
                onChange={(event) => updateField('barcode', event.target.value)}
                placeholder="Automático"
                maxLength={80}
              />
            </Field>
            <Field label="Unidad" required>
              <select
                value={form.unit}
                onChange={(event) => updateField('unit', event.target.value as ProductUnit)}
                className={selectClassName}
              >
                {productUnits.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Costo unitario sin ITBIS (RD$)" required>
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={form.cost}
                onChange={(event) => updateField('cost', event.target.value)}
                placeholder="0.00"
                required
              />
            </Field>
            <Field label="Tratamiento de ITBIS" required>
              <select
                value={form.taxPercent}
                onChange={(event) => updateField('taxPercent', event.target.value)}
                className={selectClassName}
                required
              >
                <option value="18">Gravado con ITBIS 18%</option>
                <option value="16">Gravado con ITBIS 16%</option>
                <option value="0">Exento de ITBIS</option>
              </select>
            </Field>
            <Field
              label="Precio de venta (RD$)"
              required
              hint="Se solicita por separado para no asumir un margen de venta sin autorización."
            >
              <Input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={form.salePrice}
                onChange={(event) => updateField('salePrice', event.target.value)}
                placeholder="0.00"
                required
              />
            </Field>
          </div>

          {supplierId ? (
            <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-4">
              <div className="flex items-start gap-3">
                <Link2
                  className="mt-0.5 h-5 w-5 shrink-0 text-accent-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-foreground">
                    <input
                      type="checkbox"
                      checked={form.linkToSupplier}
                      onChange={(event) => updateField('linkToSupplier', event.target.checked)}
                    />
                    Vincular al suplidor{supplierName ? `: ${supplierName}` : ''}
                  </label>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Guarda el código y el último costo que aparecen en esta factura para que el
                    próximo OCR pueda reconocerlo mejor.
                  </p>
                  {form.linkToSupplier ? (
                    <div className="mt-3">
                      <Label htmlFor="quick-product-supplier-sku">Código del suplidor</Label>
                      <Input
                        id="quick-product-supplier-sku"
                        value={form.supplierSku}
                        onChange={(event) => updateField('supplierSku', event.target.value)}
                        placeholder="Código leído de la factura (opcional)"
                        maxLength={80}
                        className="mt-2"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createMutation.isPending || hasDuplicate}>
              {createMutation.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <PackagePlus className="h-4 w-4" />
              )}
              {createMutation.isPending ? 'Creando...' : 'Crear producto'}
            </Button>
          </div>
        </form>
      )}
    </SupplierInvoiceDialog>
  );
}

function Field({
  label,
  hint,
  required = false,
  className,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      <Label>
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function createInitialForm(
  prefill: QuickProductCreatePrefill | undefined,
  supplierId: string | undefined,
  linkSupplierByDefault: boolean,
): ProductForm {
  return {
    name: prefill?.name?.trim() ?? '',
    sku: '',
    barcode: '',
    supplierSku: prefill?.supplierSku?.trim() ?? '',
    unit: 'UNIT',
    cost: toDecimalInput(prefill?.costNet),
    salePrice: '',
    taxPercent: toTaxPercentInput(prefill?.taxRate),
    linkToSupplier: Boolean(supplierId && linkSupplierByDefault),
  };
}

function findDuplicateMatches(
  products: Product[],
  form: Pick<ProductForm, 'name' | 'sku' | 'barcode'>,
) {
  const name = normalizeText(form.name);
  const sku = normalizeCode(form.sku);
  const barcode = normalizeCode(form.barcode);
  const matches = new Map<string, DuplicateMatch>();

  for (const product of products) {
    const reasons: DuplicateMatch['reasons'] = [];
    if (name && normalizeText(product.name) === name) reasons.push('name');
    if (sku && normalizeCode(product.sku ?? '') === sku) reasons.push('sku');
    if (barcode && normalizeCode(product.barcode ?? '') === barcode) reasons.push('barcode');
    if (reasons.length) matches.set(product.id, { product, reasons });
  }

  return [...matches.values()];
}

function validateForm(form: ProductForm) {
  if (!form.name.trim()) return 'Indica la descripción del producto.';
  if (form.name.trim().length > 160) return 'La descripción no puede exceder 160 caracteres.';
  const cost = Number(form.cost);
  if (!Number.isFinite(cost) || cost < 0) return 'Indica un costo unitario válido.';
  const salePrice = Number(form.salePrice);
  if (!Number.isFinite(salePrice) || salePrice < 0.01) return 'Indica un precio de venta válido.';
  const taxPercent = Number(form.taxPercent);
  if (![0, 16, 18].includes(taxPercent)) {
    return 'Selecciona ITBIS 18%, ITBIS 16% o Exento.';
  }
  return null;
}

function hasSessionCredentials(tenantId: string, accessToken: string) {
  return Boolean(tenantId && accessToken);
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('es');
}

function normalizeCode(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

function duplicateReasonLabel(reasons: DuplicateMatch['reasons']) {
  const labels = {
    name: 'Mismo nombre',
    sku: 'Mismo SKU',
    barcode: 'Mismo código de barras',
  } as const;
  return reasons.map((reason) => labels[reason]).join(' · ');
}

function toDecimalInput(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) ? String(roundCurrency(value)) : '';
}

function toTaxPercentInput(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return '18';
  const percent = roundCurrency(value <= 1 ? value * 100 : value);
  return [0, 16, 18].includes(percent) ? String(percent) : '18';
}

function getTaxCategory(taxPercent: string): ProductTaxCategory {
  if (taxPercent === '0') return 'EXEMPT';
  if (taxPercent === '16') return 'ITBIS_16';
  return 'ITBIS_18';
}

function optional(value: string) {
  return value.trim() || undefined;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error('Ocurrió un error inesperado.');
}
