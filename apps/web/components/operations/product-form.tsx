'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  createProduct,
  getProduct,
  type ProductTaxCategory,
  type ProductUnit,
  updateProduct,
  uploadProductImage,
} from '@/lib/api';
import { ModuleHeader } from './module-header';
import { BarcodeCameraScanner } from './barcode-camera-scanner';
import {
  clearCurrencyInput,
  formatCurrencyInput,
  formatCurrencyInputFromNumber,
  parseCurrencyInput,
  sanitizeCurrencyInput,
} from './pos/currency-input';
import { SessionRequired, useCurrentSession } from './session-required';

type ProductFormState = {
  name: string;
  sku: string;
  barcode: string;
  imageUrl: string;
  brand: string;
  unit: ProductUnit;
  price: string;
  cost: string;
  taxCategory: ProductTaxCategory;
  stock: string;
  minStock: string;
  status: string;
  trackInventory: boolean;
};

const defaultState: ProductFormState = {
  name: '',
  sku: '',
  barcode: '',
  imageUrl: '',
  brand: '',
  unit: 'UNIT',
  price: clearCurrencyInput(),
  cost: clearCurrencyInput(),
  taxCategory: 'ITBIS_18',
  stock: '0',
  minStock: '0',
  status: 'ACTIVE',
  trackInventory: true,
};

export function ProductForm({ productId }: { productId?: string }) {
  const session = useCurrentSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<ProductFormState>(defaultState);
  const [loadedProductId, setLoadedProductId] = useState<string | null>(null);
  const [imagePreviewFailed, setImagePreviewFailed] = useState(false);
  const basePrice = parseCurrencyInput(form.price);
  const discountPrice = formatCurrencyInputFromNumber(basePrice * 0.95);
  const preferredPrice = formatCurrencyInputFromNumber(basePrice * 0.9);

  const productQuery = useQuery({
    queryKey: ['product', productId, session?.tenantId],
    queryFn: () => getProduct(session?.tenantId ?? '', session?.accessToken ?? '', productId ?? ''),
    enabled: Boolean(session && productId),
  });

  useEffect(() => {
    if (productQuery.data && loadedProductId !== productQuery.data.id) {
      setLoadedProductId(productQuery.data.id);
      setForm({
        name: productQuery.data.name,
        sku: productQuery.data.sku ?? '',
        barcode: productQuery.data.barcode ?? '',
        imageUrl: productQuery.data.imageUrl ?? '',
        brand: productQuery.data.brand ?? '',
        unit: productQuery.data.unit,
        price: formatCurrencyInputFromNumber(
          Number(productQuery.data.salePrice ?? productQuery.data.price ?? 0),
        ),
        cost: formatCurrencyInputFromNumber(Number(productQuery.data.cost ?? 0)),
        taxCategory: productQuery.data.taxCategory,
        stock: String(productQuery.data.stock),
        minStock: String(productQuery.data.minStock),
        status: productQuery.data.status,
        trackInventory: productQuery.data.trackInventory,
      });
    }
  }, [loadedProductId, productQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      const payload = {
        name: form.name,
        sku: form.sku || undefined,
        barcode: form.barcode || undefined,
        imageUrl: form.imageUrl || undefined,
        brand: form.brand || undefined,
        unit: form.unit,
        price: parseCurrencyInput(form.price),
        cost: parseCurrencyInput(form.cost),
        taxCategory: form.taxCategory,
        taxRate: getTaxRate(form.taxCategory),
        stock: Number(form.stock),
        minStock: Number(form.minStock),
        status: form.status,
        trackInventory: form.trackInventory,
      };

      if (productId) {
        return updateProduct(session.tenantId, session.accessToken, productId, payload);
      }

      return createProduct(session.tenantId, session.accessToken, payload);
    },
    onSuccess: async (product) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Producto guardado', { description: product.name });
      router.push('/products');
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el producto.');
    },
  });

  const imageUploadMutation = useMutation({
    mutationFn: (file: File) => {
      if (!session) {
        throw new Error('Sesion requerida.');
      }

      return uploadProductImage(session.tenantId, session.accessToken, file);
    },
    onSuccess: async (result) => {
      updateField('imageUrl', result.imageUrl);

      if (productId && session) {
        try {
          await updateProduct(session.tenantId, session.accessToken, productId, {
            imageUrl: result.imageUrl,
          });
          await queryClient.invalidateQueries({
            queryKey: ['product', productId, session.tenantId],
          });
          await queryClient.invalidateQueries({ queryKey: ['products'] });
        } catch (error) {
          toast.error(
            error instanceof Error
              ? error.message
              : 'La imagen subio, pero no se pudo guardar en el producto.',
          );
          return;
        }
      }

      toast.success('Imagen cargada', {
        description: productId
          ? 'La imagen del producto se guardo correctamente.'
          : 'La imagen quedo lista para guardar el producto.',
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'No se pudo subir la imagen.');
    },
  });

  if (!session) {
    return <SessionRequired session={session} />;
  }

  function updateField<K extends keyof ProductFormState>(key: K, value: ProductFormState[K]) {
    if (key === 'imageUrl') {
      setImagePreviewFailed(false);
    }

    setForm((current) => ({ ...current, [key]: value }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (form.minStock.trim() === '') {
      toast.error('El stock minimo es requerido.');
      return;
    }

    const parsedStock = Number(form.stock);
    if (Number.isNaN(parsedStock) || parsedStock < 0) {
      toast.error('El stock actual debe ser un numero valido.');
      return;
    }

    const parsedMinStock = Number(form.minStock);
    if (Number.isNaN(parsedMinStock) || parsedMinStock < 0) {
      toast.error('El stock minimo debe ser un numero valido.');
      return;
    }

    saveMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title={productId ? 'Editar producto' : 'Nuevo producto'}
        description="Datos persistidos en PostgreSQL para el catalogo operativo de Ferreteria RIVNU."
      />

      <Card>
        <CardHeader>
          <CardTitle>Ficha del producto</CardTitle>
          <CardDescription>
            CoreStack valida duplicados de SKU y codigo de barras dentro del tenant RIVNU.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
            <Field label="Nombre" required>
              <Input
                value={form.name}
                onChange={(event) => updateField('name', event.target.value)}
                required
              />
            </Field>
            <Field label="Codigo de producto">
              <Input
                value={form.sku}
                onChange={(event) => updateField('sku', event.target.value)}
                placeholder="Automatico"
              />
            </Field>
            <Field label="Codigo de barras">
              <div className="space-y-2">
                <Input
                  value={form.barcode}
                  onChange={(event) => updateField('barcode', event.target.value)}
                  placeholder="Automatico"
                  autoComplete="off"
                />
                <BarcodeCameraScanner onDetected={(value) => updateField('barcode', value)} />
              </div>
            </Field>
            <Field label="Imagen del producto">
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Input
                    value={form.imageUrl}
                    onChange={(event) => updateField('imageUrl', event.target.value)}
                    placeholder="URL o imagen cargada"
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];

                      if (file) {
                        imageUploadMutation.mutate(file);
                      }

                      event.currentTarget.value = '';
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={imageUploadMutation.isPending}
                  >
                    <Upload className="h-4 w-4" />
                    {imageUploadMutation.isPending ? 'Subiendo...' : 'Subir imagen'}
                  </Button>
                </div>
                {form.imageUrl ? (
                  <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-border bg-zinc-50 p-3">
                    {imagePreviewFailed ? (
                      <div className="max-w-sm text-center text-sm text-muted-foreground">
                        <p>No se pudo cargar la imagen.</p>
                        <p className="mt-1 text-xs">
                          Usa un enlace directo a una imagen JPG, PNG, WEBP o GIF, o sube el archivo
                          desde tu equipo.
                        </p>
                      </div>
                    ) : (
                      <img
                        src={form.imageUrl}
                        alt="Vista previa del producto"
                        className="max-h-full max-w-full object-contain"
                        referrerPolicy="no-referrer"
                        onLoad={() => setImagePreviewFailed(false)}
                        onError={() => setImagePreviewFailed(true)}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            </Field>
            <Field label="Marca">
              <Input
                value={form.brand}
                onChange={(event) => updateField('brand', event.target.value)}
              />
            </Field>
            <Field label="Unidad">
              <select
                value={form.unit}
                onChange={(event) => updateField('unit', event.target.value as ProductUnit)}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="UNIT">Unidad</option>
                <option value="BOX">Caja</option>
                <option value="BAG">Saco</option>
                <option value="METER">Metro (MT)</option>
                <option value="FOOT">Pie (FT)</option>
                <option value="YARD">Yarda (YD)</option>
                <option value="ROLL">Rollo</option>
                <option value="POUND">Libra (LB/POUND)</option>
                <option value="GALLON">Galon</option>
                <option value="LITER">Litro</option>
                <option value="KILOGRAM">Kilogramo</option>
                <option value="PACK">Paquete</option>
                <option value="SERVICE">Servicio</option>
              </select>
            </Field>
            <Field label="Estado">
              <select
                value={form.status}
                onChange={(event) => updateField('status', event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="ACTIVE">Activo</option>
                <option value="INACTIVE">Inactivo</option>
                <option value="DISCONTINUED">Descontinuado</option>
              </select>
            </Field>
            <Field label="Precio (RD$)" required>
              <div className="space-y-3">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={form.price}
                  onChange={(event) =>
                    updateField('price', sanitizeCurrencyInput(event.target.value))
                  }
                  onBlur={(event) => updateField('price', formatCurrencyInput(event.target.value))}
                  onFocus={(event) => event.currentTarget.select()}
                  required
                />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Precio descuento (5%)</Label>
                    <Input
                      value={discountPrice}
                      readOnly
                      tabIndex={-1}
                      className="bg-zinc-100 text-zinc-600"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Cliente preferencial (10%)
                    </Label>
                    <Input
                      value={preferredPrice}
                      readOnly
                      tabIndex={-1}
                      className="bg-zinc-100 text-zinc-600"
                    />
                  </div>
                </div>
              </div>
            </Field>
            <Field label="Costo (RD$)">
              <Input
                type="text"
                inputMode="decimal"
                value={form.cost}
                onChange={(event) => updateField('cost', sanitizeCurrencyInput(event.target.value))}
                onBlur={(event) => updateField('cost', formatCurrencyInput(event.target.value))}
                onFocus={(event) => event.currentTarget.select()}
              />
            </Field>
            <Field label="Tratamiento de ITBIS" required>
              <select
                value={form.taxCategory}
                onChange={(event) =>
                  updateField('taxCategory', event.target.value as ProductTaxCategory)
                }
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="ITBIS_18">Gravado con ITBIS 18%</option>
                <option value="ITBIS_16">Gravado con ITBIS 16%</option>
                <option value="EXEMPT">Exento de ITBIS</option>
              </select>
            </Field>
            <Field label="Stock actual" required>
              <Input
                type="number"
                min="0"
                step="0.001"
                inputMode="decimal"
                value={form.stock}
                onChange={(event) => updateField('stock', event.target.value)}
                required
              />
            </Field>
            <Field label="Stock minimo" required>
              <Input
                type="number"
                min="0"
                step="0.001"
                inputMode="decimal"
                value={form.minStock}
                onChange={(event) => updateField('minStock', event.target.value)}
                required
              />
            </Field>
            <label className="flex items-center gap-2 pt-7 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.trackInventory}
                onChange={(event) => updateField('trackInventory', event.target.checked)}
              />
              Controlar inventario
            </label>
            <div className="md:col-span-2">
              <Button type="submit" disabled={saveMutation.isPending}>
                <Save className="h-4 w-4" />
                Guardar
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function getTaxRate(taxCategory: ProductTaxCategory) {
  const rates: Record<ProductTaxCategory, number> = {
    ITBIS_18: 0.18,
    ITBIS_16: 0.16,
    EXEMPT: 0,
  };

  return rates[taxCategory];
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>
        {label}
        {required ? <span className="ml-1 text-danger">*</span> : null}
      </Label>
      {children}
    </div>
  );
}
