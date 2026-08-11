import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BarcodeType,
  EmployeeLogAction,
  InventoryMovementType,
  Prisma,
  ProductStatus,
  ProductUnit,
  TaxCategory,
} from '@qorvex/database';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { getBarcodeLookupCandidates, normalizeBarcodeInput } from '../../common/utils/barcode';
import { AuditService } from '../audit/audit.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

const internalBarcodePrefix = 'QV';
const defaultProductImageBucket = 'product-images';
const maxProductImageSize = 5 * 1024 * 1024;
const allowedProductImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const expectedTaxRateByCategory: Record<TaxCategory, string> = {
  [TaxCategory.ITBIS_18]: '0.18',
  [TaxCategory.ITBIS_16]: '0.16',
  [TaxCategory.EXEMPT]: '0',
};

export type UploadedProductImageFile = {
  originalname: string;
  mimetype?: string;
  buffer: Buffer;
  size: number;
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  findAll(tenantId: string, q?: string) {
    return this.prisma.product.findMany({
      where: {
        tenantId,
        ...(q ? { OR: this.searchConditions(q) } : {}),
      },
      include: {
        category: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  search(tenantId: string, q: string) {
    const query = q.trim();

    if (!query) {
      return [];
    }

    return this.prisma.product.findMany({
      where: {
        tenantId,
        status: ProductStatus.ACTIVE,
        OR: this.searchConditions(query),
      },
      include: {
        category: true,
      },
      orderBy: [{ stock: 'asc' }, { name: 'asc' }],
      take: 25,
    });
  }

  async findByBarcode(tenantId: string, barcode: string) {
    const lookupCandidates = getBarcodeLookupCandidates(barcode);

    const product = await this.prisma.product.findFirst({
      where: {
        tenantId,
        status: ProductStatus.ACTIVE,
        OR: [{ barcode: { in: lookupCandidates } }, { sku: { in: lookupCandidates } }],
      },
      include: {
        category: true,
      },
    });

    if (!product) {
      throw new NotFoundException('No active product found for barcode.');
    }

    await this.prisma.product.update({
      where: { id: product.id },
      data: {
        barcodeLastScannedAt: new Date(),
      },
    });

    return product;
  }

  async create(tenantId: string, userId: string, dto: CreateProductDto) {
    if (dto.categoryId) {
      await this.ensureCategory(tenantId, dto.categoryId);
    }

    const sku = dto.sku?.trim()
      ? await this.normalizeSku(tenantId, dto.sku)
      : await this.generateSku(tenantId, dto.name);
    const barcode = dto.barcode?.trim()
      ? this.normalizeBarcode(dto.barcode)
      : await this.generateInternalBarcode(tenantId);

    await this.ensureUniqueSku(tenantId, sku);
    await this.ensureUniqueBarcode(tenantId, barcode);

    const stock = dto.stock;
    const price = new Prisma.Decimal(dto.price);
    const cost = dto.cost === undefined ? undefined : new Prisma.Decimal(dto.cost);
    const barcodeWasGenerated = !dto.barcode?.trim();
    const unit = dto.unit ?? ProductUnit.UNIT;
    const taxCategory =
      dto.taxCategory ?? this.inferTaxCategory(dto.taxRate) ?? TaxCategory.ITBIS_18;
    const taxRate = this.resolveTaxRate(taxCategory, dto.taxRate);

    this.ensureQuantityMatchesUnit(unit, stock, 'stock');
    this.ensureQuantityMatchesUnit(unit, dto.minStock ?? 0, 'stock minimo');

    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          tenantId,
          categoryId: dto.categoryId,
          name: dto.name,
          sku,
          barcode,
          barcodeType:
            dto.barcodeType ??
            (barcodeWasGenerated ? BarcodeType.INTERNAL_CODE128 : BarcodeType.CODE128),
          generatedBarcode: barcodeWasGenerated,
          barcodeCreatedById: barcodeWasGenerated ? userId : undefined,
          description: dto.description,
          imageUrl: dto.imageUrl,
          brand: dto.brand,
          unit,
          price,
          salePrice: price,
          cost,
          margin: cost ? price.sub(cost).div(price).toDecimalPlaces(4) : undefined,
          taxCategory,
          taxRate,
          trackInventory: dto.trackInventory ?? true,
          stock,
          minStock: dto.minStock ?? 0,
          status: dto.status,
        },
        include: {
          category: true,
        },
      });

      if ((dto.trackInventory ?? true) && stock > 0) {
        await tx.inventoryMovement.create({
          data: {
            tenantId,
            productId: created.id,
            type: InventoryMovementType.INITIAL_STOCK,
            quantity: stock,
            previousStock: 0,
            newStock: stock,
            unitCost: cost,
            reason: 'Inventario inicial del producto',
            reference: `PRODUCT-${created.sku ?? created.id}`,
            createdById: userId,
          },
        });
      }

      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId,
          action: EmployeeLogAction.ADD_PRODUCT,
          entity: 'Product',
          entityId: created.id,
          metadata: {
            name: created.name,
            sku: created.sku,
            barcode: created.barcode,
          },
        },
      });

      return created;
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'PRODUCT_CREATED',
      entity: 'Product',
      entityId: product.id,
      metadata: { name: product.name, sku: product.sku, barcode: product.barcode },
    });

    return product;
  }

  async findOne(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: {
        category: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found for tenant.');
    }

    return product;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateProductDto) {
    const currentProduct = await this.findOne(tenantId, id);

    if (dto.categoryId) {
      await this.ensureCategory(tenantId, dto.categoryId);
    }

    const sku = dto.sku?.trim() ? await this.normalizeSku(tenantId, dto.sku) : dto.sku;
    const barcode = dto.barcode ? this.normalizeBarcode(dto.barcode) : dto.barcode;

    if (sku && sku !== currentProduct.sku) {
      await this.ensureUniqueSku(tenantId, sku, id);
    }

    if (barcode && barcode !== currentProduct.barcode) {
      await this.ensureUniqueBarcode(tenantId, barcode, id);
    }

    const nextPrice =
      dto.price === undefined ? undefined : new Prisma.Decimal(dto.price).toDecimalPlaces(2);
    const nextCost =
      dto.cost === undefined ? undefined : new Prisma.Decimal(dto.cost).toDecimalPlaces(2);
    const nextUnit = dto.unit ?? currentProduct.unit;
    const nextStock = dto.stock ?? currentProduct.stock;
    const nextMinStock = dto.minStock ?? currentProduct.minStock;
    const shouldTrackInventory = dto.trackInventory ?? currentProduct.trackInventory;
    const nextTaxCategory =
      dto.taxCategory ?? this.inferTaxCategory(dto.taxRate) ?? currentProduct.taxCategory;
    const nextTaxRate = this.resolveTaxRate(
      nextTaxCategory,
      dto.taxRate ?? (dto.taxCategory === undefined ? currentProduct.taxRate : undefined),
    );
    const shouldCreateStockMovement =
      dto.stock !== undefined && dto.stock !== currentProduct.stock && shouldTrackInventory;

    this.ensureQuantityMatchesUnit(nextUnit, nextStock, 'stock');
    this.ensureQuantityMatchesUnit(nextUnit, nextMinStock, 'stock minimo');

    const product = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: {
          categoryId: dto.categoryId,
          name: dto.name,
          sku,
          barcode,
          barcodeType: dto.barcodeType,
          description: dto.description,
          imageUrl: dto.imageUrl,
          brand: dto.brand,
          unit: nextUnit,
          price: nextPrice,
          salePrice: nextPrice,
          cost: nextCost,
          margin:
            nextPrice && nextCost && !nextPrice.isZero()
              ? nextPrice.sub(nextCost).div(nextPrice).toDecimalPlaces(4)
              : undefined,
          taxCategory: nextTaxCategory,
          taxRate: nextTaxRate,
          trackInventory: dto.trackInventory,
          stock: dto.stock,
          minStock: dto.minStock,
          status: dto.status,
        },
        include: {
          category: true,
        },
      });

      if (shouldCreateStockMovement) {
        const difference = dto.stock! - currentProduct.stock;
        await tx.inventoryMovement.create({
          data: {
            tenantId,
            productId: id,
            type:
              difference >= 0
                ? InventoryMovementType.ADJUSTMENT_IN
                : InventoryMovementType.ADJUSTMENT_OUT,
            quantity: Math.abs(difference),
            previousStock: currentProduct.stock,
            newStock: dto.stock,
            unitCost: nextCost ?? currentProduct.cost,
            reason: 'Ajuste administrativo de stock',
            reference: `PRODUCT-${updated.sku ?? updated.id}`,
            createdById: userId,
          },
        });
      }

      if (barcode && barcode !== currentProduct.barcode) {
        await tx.employeeActivityLog.create({
          data: {
            tenantId,
            userId,
            action: EmployeeLogAction.CHANGE_BARCODE,
            entity: 'Product',
            entityId: id,
            metadata: {
              previousBarcode: currentProduct.barcode,
              barcode,
            },
          },
        });
      }

      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId,
          action: EmployeeLogAction.UPDATE_PRODUCT,
          entity: 'Product',
          entityId: id,
          metadata: { fields: Object.keys(dto) },
        },
      });

      return updated;
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'PRODUCT_UPDATED',
      entity: 'Product',
      entityId: id,
      metadata: { fields: Object.keys(dto) },
    });

    return product;
  }

  async generateBarcode(tenantId: string, userId: string, id: string) {
    const product = await this.findOne(tenantId, id);

    if (product.barcode) {
      return product;
    }

    const candidate = await this.generateInternalBarcode(tenantId);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: {
          barcode: candidate,
          barcodeType: BarcodeType.INTERNAL_CODE128,
          generatedBarcode: true,
          barcodeCreatedById: userId,
        },
        include: { category: true },
      });

      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId,
          action: EmployeeLogAction.CHANGE_BARCODE,
          entity: 'Product',
          entityId: id,
          metadata: {
            generatedBarcode: candidate,
            productName: product.name,
          },
        },
      });

      return updated;
    });
  }

  async getLabel(tenantId: string, userId: string, id: string) {
    const product = await this.findOne(tenantId, id);

    if (!product.barcode) {
      throw new BadRequestException('Product must have a barcode before printing labels.');
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        barcodeLabelPrintedAt: new Date(),
        barcodeLabelPrintCount: {
          increment: 1,
        },
      },
      include: { category: true },
    });

    await this.prisma.employeeActivityLog.create({
      data: {
        tenantId,
        userId,
        action: EmployeeLogAction.PRINT_RECEIPT,
        entity: 'ProductBarcodeLabel',
        entityId: id,
        metadata: {
          barcode: product.barcode,
          productName: product.name,
        },
      },
    });

    return {
      productId: updated.id,
      name: updated.name,
      sku: updated.sku,
      barcode: updated.barcode,
      barcodeType: updated.barcodeType,
      price: updated.salePrice.toNumber() || updated.price.toNumber(),
      printedAt: updated.barcodeLabelPrintedAt,
      printCount: updated.barcodeLabelPrintCount,
    };
  }

  async uploadImage(tenantId: string, userId: string, file?: UploadedProductImageFile) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Product image file is required.');
    }

    const mimetype = resolveProductImageMimeType(file);

    if (!allowedProductImageTypes.has(mimetype)) {
      throw new BadRequestException('Product image must be JPG, PNG, WEBP, or GIF.');
    }

    if (file.size > maxProductImageSize) {
      throw new BadRequestException('Product image cannot be larger than 5 MB.');
    }

    const supabaseUrl = this.config.get<string>('SUPABASE_URL')?.replace(/\/+$/, '');
    const supabaseKey =
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ??
      this.config.get<string>('SUPABASE_SECRET_KEY');
    const bucket =
      this.config.get<string>('SUPABASE_PRODUCT_IMAGE_BUCKET') || defaultProductImageBucket;

    const uploadResult =
      supabaseUrl && supabaseKey
        ? await this.uploadImageToSupabase({
            tenantId,
            file: { ...file, mimetype },
            supabaseUrl,
            supabaseKey,
            bucket,
          })
        : await this.uploadImageToLocalPublic(tenantId, { ...file, mimetype });

    await this.audit.log({
      tenantId,
      userId,
      action: 'PRODUCT_IMAGE_UPLOADED',
      entity: 'ProductImage',
      entityId: uploadResult.path,
      metadata: {
        filename: file.originalname,
        imageUrl: uploadResult.imageUrl,
        storage: uploadResult.bucket,
      },
    });

    return uploadResult;
  }

  private async uploadImageToSupabase(input: {
    tenantId: string;
    file: UploadedProductImageFile;
    supabaseUrl: string;
    supabaseKey: string;
    bucket: string;
  }) {
    const { tenantId, file, supabaseUrl, supabaseKey, bucket } = input;
    const extension = getImageExtension(file.originalname, file.mimetype);
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const objectPath = `${tenantId}/${filename}`;
    const uploadUrl = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeStoragePath(objectPath)}`;
    await ensurePublicStorageBucket(supabaseUrl, supabaseKey, bucket);

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
        'Content-Type': file.mimetype ?? 'application/octet-stream',
        'x-upsert': 'false',
      },
      body: new Blob([new Uint8Array(file.buffer)], {
        type: file.mimetype ?? 'application/octet-stream',
      }),
    });

    if (!response.ok) {
      throw new BadRequestException('Product image could not be uploaded.');
    }

    return {
      imageUrl: `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeStoragePath(objectPath)}`,
      path: objectPath,
      bucket,
    };
  }

  private async uploadImageToLocalPublic(tenantId: string, file: UploadedProductImageFile) {
    const uploadsRoot = resolveLocalProductUploadsRoot();
    const extension = getImageExtension(file.originalname, file.mimetype);
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    const tenantDir = path.join(uploadsRoot, tenantId);
    await mkdir(tenantDir, { recursive: true });
    await writeFile(path.join(tenantDir, filename), file.buffer);

    return {
      imageUrl: `/product-uploads/${tenantId}/${filename}`,
      path: `${tenantId}/${filename}`,
      bucket: 'local-public',
    };
  }

  async remove(tenantId: string, userId: string, id: string) {
    await this.findOne(tenantId, id);

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        status: ProductStatus.INACTIVE,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'PRODUCT_DEACTIVATED',
      entity: 'Product',
      entityId: id,
    });

    await this.prisma.employeeActivityLog.create({
      data: {
        tenantId,
        userId,
        action: EmployeeLogAction.DELETE_PRODUCT,
        entity: 'Product',
        entityId: id,
        metadata: { name: product.name, sku: product.sku },
      },
    });

    return product;
  }

  private searchConditions(query: string): Prisma.ProductWhereInput[] {
    return [
      { name: { contains: query, mode: 'insensitive' } },
      { sku: { contains: query, mode: 'insensitive' } },
      { barcode: { contains: query, mode: 'insensitive' } },
      { brand: { contains: query, mode: 'insensitive' } },
    ];
  }

  private normalizeBarcode(barcode: string) {
    return normalizeBarcodeInput(barcode);
  }

  private async normalizeSku(tenantId: string, sku: string) {
    const normalized = normalizeCodeSegment(sku).slice(0, 80);

    if (!normalized) {
      return this.generateSku(tenantId, 'PRODUCTO');
    }

    return normalized;
  }

  private async generateSku(tenantId: string, productName: string) {
    const tenantCode = await this.getTenantCode(tenantId);
    const productCode =
      normalizeCodeSegment(productName)
        .replace(/^(DE|DEL|LA|EL|LOS|LAS|UN|UNA)-/g, '')
        .split('-')
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part.slice(0, 4))
        .join('-') || 'PROD';
    const count = await this.prisma.product.count({ where: { tenantId } });

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate =
        `${tenantCode}-${productCode}-${String(count + attempt + 1).padStart(4, '0')}`.slice(0, 80);
      const exists = await this.prisma.product.findFirst({
        where: { tenantId, sku: candidate },
        select: { id: true },
      });

      if (!exists) {
        return candidate;
      }
    }

    throw new ConflictException('Could not generate a unique product code.');
  }

  private async generateInternalBarcode(tenantId: string) {
    const tenantCode = await this.getTenantCode(tenantId);
    const count = await this.prisma.product.count({ where: { tenantId } });

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = `${internalBarcodePrefix}-${tenantCode}-${String(count + attempt + 1).padStart(6, '0')}`;
      const existing = await this.prisma.product.findFirst({
        where: { tenantId, barcode: candidate },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }
    }

    throw new ConflictException('Could not generate a unique barcode.');
  }

  private async getTenantCode(tenantId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { slug: true, commercialName: true, name: true },
    });
    const slugParts = tenant.slug.split('-').filter(Boolean);
    const lastSlugPart = slugParts.at(-1) ?? tenant.slug;
    const source = lastSlugPart.length >= 3 ? lastSlugPart : (tenant.commercialName ?? tenant.name);
    const normalized = normalizeCodeSegment(source).replace(/-/g, '');

    return (normalized || 'TEN').slice(0, 3);
  }

  private async ensureUniqueSku(tenantId: string, sku: string, productId?: string) {
    const existing = await this.prisma.product.findFirst({
      where: {
        tenantId,
        sku,
        ...(productId ? { id: { not: productId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Product code already exists for this tenant.');
    }
  }

  private async ensureUniqueBarcode(tenantId: string, barcode: string, productId?: string) {
    const existing = await this.prisma.product.findFirst({
      where: {
        tenantId,
        barcode,
        ...(productId ? { id: { not: productId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Barcode already exists for this tenant.');
    }
  }

  private async ensureCategory(tenantId: string, categoryId: string) {
    const category = await this.prisma.productCategory.findFirst({
      where: {
        id: categoryId,
        tenantId,
      },
    });

    if (!category) {
      throw new NotFoundException('Product category not found for tenant.');
    }
  }

  private ensureQuantityMatchesUnit(unit: ProductUnit, quantity: number, field: string) {
    if (requiresWholeQuantity(unit) && !Number.isInteger(quantity)) {
      throw new BadRequestException(`Product unit ${unit} requires whole quantities for ${field}.`);
    }
  }

  private resolveTaxRate(taxCategory: TaxCategory, taxRate: number | Prisma.Decimal | undefined) {
    const expectedRate = new Prisma.Decimal(expectedTaxRateByCategory[taxCategory]);
    const resolvedRate = taxRate === undefined ? expectedRate : new Prisma.Decimal(taxRate);

    if (!resolvedRate.eq(expectedRate)) {
      throw new BadRequestException(
        `Tax category ${taxCategory} requires tax rate ${expectedRate.toFixed(2)}.`,
      );
    }

    return expectedRate;
  }

  private inferTaxCategory(taxRate: number | Prisma.Decimal | undefined) {
    if (taxRate === undefined) {
      return undefined;
    }

    const rate = new Prisma.Decimal(taxRate);

    return (Object.entries(expectedTaxRateByCategory) as Array<[TaxCategory, string]>).find(
      ([, expectedRate]) => rate.eq(expectedRate),
    )?.[0];
  }
}

function normalizeCodeSegment(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .toUpperCase();
}

function resolveProductImageMimeType(file: UploadedProductImageFile) {
  if (file.mimetype && allowedProductImageTypes.has(file.mimetype)) {
    return file.mimetype;
  }

  const extension = file.originalname
    .split('.')
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const mimeByExtension: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
  };

  return extension && mimeByExtension[extension] ? mimeByExtension[extension] : 'image/jpeg';
}

function resolveLocalProductUploadsRoot() {
  const candidates = [
    path.resolve(process.cwd(), '../web/public/product-uploads'),
    path.resolve(process.cwd(), 'apps/web/public/product-uploads'),
    path.resolve(process.cwd(), '../../apps/web/public/product-uploads'),
  ];

  return candidates[0];
}

function getImageExtension(filename: string, mimetype?: string) {
  const extension = filename
    .split('.')
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (extension && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)) {
    return extension === 'jpeg' ? 'jpg' : extension;
  }

  if (mimetype === 'image/png') {
    return 'png';
  }

  if (mimetype === 'image/webp') {
    return 'webp';
  }

  if (mimetype === 'image/gif') {
    return 'gif';
  }

  return 'jpg';
}

function encodeStoragePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function ensurePublicStorageBucket(supabaseUrl: string, supabaseKey: string, bucket: string) {
  const bucketUrl = `${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`;
  const headers = {
    Authorization: `Bearer ${supabaseKey}`,
    apikey: supabaseKey,
  };
  const existing = await fetch(bucketUrl, { headers });
  const existingBody = await existing.text();
  const bucketMissing =
    existing.status === 404 ||
    (existing.status === 400 &&
      /bucket not found|\"statusCode\"\\s*:\\s*\"?404\"?/i.test(existingBody));

  if (bucketMissing) {
    const created = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: bucket,
        name: bucket,
        public: true,
      }),
    });

    if (!created.ok && created.status !== 409) {
      const createdBody = await created.text();
      if (/already exists/i.test(createdBody)) {
        return;
      }

      throw new BadRequestException('Product image storage is not configured.');
    }

    return;
  }

  if (!existing.ok) {
    throw new BadRequestException('Product image storage is not configured.');
  }

  await fetch(bucketUrl, {
    method: 'PUT',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      public: true,
    }),
  });
}

function requiresWholeQuantity(unit: ProductUnit) {
  const fractionalUnits: ProductUnit[] = [
    ProductUnit.METER,
    ProductUnit.FOOT,
    ProductUnit.YARD,
    ProductUnit.POUND,
  ];
  return !fractionalUnits.includes(unit);
}
