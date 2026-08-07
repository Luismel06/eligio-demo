import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentType, Prisma, SupplierStatus } from '@qorvex/database';
import {
  normalizeDominicanDocument,
  validateDominicanDocument,
} from '../../common/utils/dominican-documents';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto';
import { AddSupplierProductDto, UpdateSupplierProductDto } from './dto/supplier-product.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

const supplierProductInclude = {
  product: {
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      status: true,
      cost: true,
      price: true,
      salePrice: true,
      taxRate: true,
    },
  },
} satisfies Prisma.SupplierProductInclude;

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(tenantId: string, query: ListSuppliersQueryDto) {
    const search = query.q?.trim();
    const documentSearch = search ? normalizeDominicanDocument(search) : '';
    const searchConditions: Prisma.SupplierWhereInput[] = search
      ? [
          { commercialName: { contains: search, mode: 'insensitive' } },
          { legalName: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { contactName: { contains: search, mode: 'insensitive' } },
        ]
      : [];

    if (documentSearch) {
      searchConditions.push({ documentNumber: { contains: documentSearch } });
    }

    return this.prisma.supplier.findMany({
      where: {
        tenantId,
        status: query.status,
        ...(search
          ? {
              OR: searchConditions,
            }
          : {}),
      },
      include: {
        _count: {
          select: {
            products: {
              where: { active: true },
            },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { commercialName: 'asc' }],
    });
  }

  async create(tenantId: string, userId: string, dto: CreateSupplierDto) {
    const commercialName = this.normalizeRequiredName(dto.commercialName);
    const documentNumber = this.normalizeAndValidateDocument(dto.documentType, dto.documentNumber);

    await this.ensureUniqueDocument(tenantId, dto.documentType, documentNumber);

    const status = dto.status ?? SupplierStatus.ACTIVE;

    try {
      const supplier = await this.prisma.supplier.create({
        data: {
          tenantId,
          commercialName,
          legalName: normalizeOptionalText(dto.legalName),
          documentType: dto.documentType,
          documentNumber,
          phone: normalizeOptionalText(dto.phone),
          email: normalizeOptionalEmail(dto.email),
          address: normalizeOptionalText(dto.address),
          contactName: normalizeOptionalText(dto.contactName),
          contactPhone: normalizeOptionalText(dto.contactPhone),
          contactEmail: normalizeOptionalEmail(dto.contactEmail),
          paymentTerms: normalizeOptionalText(dto.paymentTerms),
          creditDays: dto.creditDays ?? 0,
          notes: normalizeOptionalText(dto.notes),
          status,
          createdById: userId,
          ...(status === SupplierStatus.INACTIVE
            ? {
                deactivatedById: userId,
                deactivatedAt: new Date(),
              }
            : {}),
        },
      });

      await this.audit.log({
        tenantId,
        userId,
        action: 'SUPPLIER_CREATED',
        entity: 'Supplier',
        entityId: supplier.id,
        metadata: {
          commercialName: supplier.commercialName,
          documentType: supplier.documentType,
        },
      });

      return supplier;
    } catch (error) {
      this.rethrowSupplierConflict(error);
    }
  }

  async findOne(tenantId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
      include: {
        products: {
          include: supplierProductInclude,
          orderBy: [{ active: 'desc' }, { isPrimary: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });

    if (!supplier) {
      throw new NotFoundException('Proveedor no encontrado para esta empresa.');
    }

    return supplier;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateSupplierDto) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('Debes indicar al menos un campo para actualizar.');
    }

    const current = await this.getSupplierRecord(tenantId, id);
    const documentType = dto.documentType ?? current.documentType;
    const documentValue =
      dto.documentNumber === undefined ? current.documentNumber : dto.documentNumber;
    const documentNumber = normalizeDominicanDocument(documentValue);

    this.validateDocument(documentType, documentValue);

    if (documentType !== current.documentType || documentNumber !== current.documentNumber) {
      await this.ensureUniqueDocument(tenantId, documentType, documentNumber, id);
    }

    const status = dto.status;
    const shouldDeactivateProducts =
      status === SupplierStatus.INACTIVE && current.status !== SupplierStatus.INACTIVE;

    try {
      const supplier = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.supplier.update({
          where: { id },
          data: {
            commercialName:
              dto.commercialName === undefined
                ? undefined
                : this.normalizeRequiredName(dto.commercialName),
            legalName:
              dto.legalName === undefined ? undefined : normalizeOptionalText(dto.legalName),
            documentType: dto.documentType,
            documentNumber: dto.documentNumber === undefined ? undefined : documentNumber,
            phone: dto.phone === undefined ? undefined : normalizeOptionalText(dto.phone),
            email: dto.email === undefined ? undefined : normalizeOptionalEmail(dto.email),
            address: dto.address === undefined ? undefined : normalizeOptionalText(dto.address),
            contactName:
              dto.contactName === undefined ? undefined : normalizeOptionalText(dto.contactName),
            contactPhone:
              dto.contactPhone === undefined ? undefined : normalizeOptionalText(dto.contactPhone),
            contactEmail:
              dto.contactEmail === undefined ? undefined : normalizeOptionalEmail(dto.contactEmail),
            paymentTerms:
              dto.paymentTerms === undefined ? undefined : normalizeOptionalText(dto.paymentTerms),
            creditDays: dto.creditDays,
            notes: dto.notes === undefined ? undefined : normalizeOptionalText(dto.notes),
            status,
            updatedById: userId,
            ...(status === SupplierStatus.INACTIVE
              ? {
                  deactivatedById: userId,
                  deactivatedAt: new Date(),
                }
              : status === SupplierStatus.ACTIVE
                ? {
                    deactivatedById: null,
                    deactivatedAt: null,
                  }
                : {}),
          },
          include: {
            products: {
              include: supplierProductInclude,
              orderBy: [{ active: 'desc' }, { isPrimary: 'desc' }, { createdAt: 'desc' }],
            },
          },
        });

        if (shouldDeactivateProducts) {
          await tx.supplierProduct.updateMany({
            where: {
              tenantId,
              supplierId: id,
              active: true,
            },
            data: {
              active: false,
              isPrimary: false,
              updatedById: userId,
            },
          });
        }

        return updated;
      });

      await this.audit.log({
        tenantId,
        userId,
        action:
          status === SupplierStatus.INACTIVE && current.status !== SupplierStatus.INACTIVE
            ? 'SUPPLIER_DEACTIVATED'
            : status === SupplierStatus.ACTIVE && current.status === SupplierStatus.INACTIVE
              ? 'SUPPLIER_REACTIVATED'
              : 'SUPPLIER_UPDATED',
        entity: 'Supplier',
        entityId: id,
        metadata: { fields: Object.keys(dto) },
      });

      return status === SupplierStatus.INACTIVE ? this.findOne(tenantId, id) : supplier;
    } catch (error) {
      this.rethrowSupplierConflict(error);
    }
  }

  async deactivate(tenantId: string, userId: string, id: string) {
    const current = await this.getSupplierRecord(tenantId, id);

    if (current.status === SupplierStatus.INACTIVE) {
      return this.findOne(tenantId, id);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.supplier.update({
        where: { id },
        data: {
          status: SupplierStatus.INACTIVE,
          updatedById: userId,
          deactivatedById: userId,
          deactivatedAt: new Date(),
        },
      });

      await tx.supplierProduct.updateMany({
        where: {
          tenantId,
          supplierId: id,
          active: true,
        },
        data: {
          active: false,
          isPrimary: false,
          updatedById: userId,
        },
      });
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'SUPPLIER_DEACTIVATED',
      entity: 'Supplier',
      entityId: id,
    });

    return this.findOne(tenantId, id);
  }

  async addProduct(
    tenantId: string,
    userId: string,
    supplierId: string,
    dto: AddSupplierProductDto,
  ) {
    await this.ensureActiveSupplier(tenantId, supplierId);
    await this.ensureTenantProduct(tenantId, dto.productId);

    const existing = await this.prisma.supplierProduct.findFirst({
      where: {
        tenantId,
        supplierId,
        productId: dto.productId,
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'Este producto ya está relacionado con el proveedor. Actualiza la relación existente.',
      );
    }

    const active = dto.active ?? true;
    const isPrimary = dto.isPrimary ?? false;

    this.ensurePrimaryIsActive(isPrimary, active);
    this.ensureCosts(dto.lastCostNet, dto.lastCostWithTax);

    try {
      const supplierProduct = await this.prisma.$transaction(async (tx) => {
        if (isPrimary) {
          await tx.supplierProduct.updateMany({
            where: {
              tenantId,
              productId: dto.productId,
              active: true,
              isPrimary: true,
            },
            data: {
              isPrimary: false,
              updatedById: userId,
            },
          });
        }

        return tx.supplierProduct.create({
          data: {
            tenantId,
            supplierId,
            productId: dto.productId,
            supplierSku: normalizeOptionalText(dto.supplierSku),
            lastCostNet: toOptionalDecimal(dto.lastCostNet),
            lastCostWithTax: toOptionalDecimal(dto.lastCostWithTax),
            leadTimeDays: dto.leadTimeDays,
            isPrimary,
            active,
            createdById: userId,
          },
          include: supplierProductInclude,
        });
      });

      await this.audit.log({
        tenantId,
        userId,
        action: 'SUPPLIER_PRODUCT_ADDED',
        entity: 'SupplierProduct',
        entityId: supplierProduct.id,
        metadata: {
          supplierId,
          productId: dto.productId,
          isPrimary: supplierProduct.isPrimary,
        },
      });

      return supplierProduct;
    } catch (error) {
      this.rethrowSupplierProductConflict(error);
    }
  }

  async updateProduct(
    tenantId: string,
    userId: string,
    supplierId: string,
    productId: string,
    dto: UpdateSupplierProductDto,
  ) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('Debes indicar al menos un campo para actualizar.');
    }

    const supplier = await this.getSupplierRecord(tenantId, supplierId);
    await this.ensureTenantProduct(tenantId, productId);
    const current = await this.getSupplierProduct(tenantId, supplierId, productId);
    const nextActive = dto.active ?? current.active;
    const nextIsPrimary = dto.active === false ? false : (dto.isPrimary ?? current.isPrimary);

    if (nextActive && supplier.status !== SupplierStatus.ACTIVE) {
      throw new BadRequestException(
        'Debes reactivar el proveedor antes de activar o modificar sus productos.',
      );
    }

    this.ensurePrimaryIsActive(nextIsPrimary, nextActive);
    this.ensureCosts(
      dto.lastCostNet ?? decimalToNumber(current.lastCostNet),
      dto.lastCostWithTax ?? decimalToNumber(current.lastCostWithTax),
    );

    try {
      const supplierProduct = await this.prisma.$transaction(async (tx) => {
        if (nextIsPrimary) {
          await tx.supplierProduct.updateMany({
            where: {
              tenantId,
              productId,
              active: true,
              isPrimary: true,
              id: { not: current.id },
            },
            data: {
              isPrimary: false,
              updatedById: userId,
            },
          });
        }

        return tx.supplierProduct.update({
          where: { id: current.id },
          data: {
            supplierSku:
              dto.supplierSku === undefined ? undefined : normalizeOptionalText(dto.supplierSku),
            lastCostNet:
              dto.lastCostNet === undefined ? undefined : toOptionalDecimal(dto.lastCostNet),
            lastCostWithTax:
              dto.lastCostWithTax === undefined
                ? undefined
                : toOptionalDecimal(dto.lastCostWithTax),
            leadTimeDays: dto.leadTimeDays,
            isPrimary: nextIsPrimary,
            active: nextActive,
            updatedById: userId,
          },
          include: supplierProductInclude,
        });
      });

      await this.audit.log({
        tenantId,
        userId,
        action: 'SUPPLIER_PRODUCT_UPDATED',
        entity: 'SupplierProduct',
        entityId: supplierProduct.id,
        metadata: {
          supplierId,
          productId,
          fields: Object.keys(dto),
        },
      });

      return supplierProduct;
    } catch (error) {
      this.rethrowSupplierProductConflict(error);
    }
  }

  async deactivateProduct(tenantId: string, userId: string, supplierId: string, productId: string) {
    await this.getSupplierRecord(tenantId, supplierId);
    await this.ensureTenantProduct(tenantId, productId);
    const current = await this.getSupplierProduct(tenantId, supplierId, productId);

    if (!current.active) {
      return this.prisma.supplierProduct.findUniqueOrThrow({
        where: { id: current.id },
        include: supplierProductInclude,
      });
    }

    const supplierProduct = await this.prisma.supplierProduct.update({
      where: { id: current.id },
      data: {
        active: false,
        isPrimary: false,
        updatedById: userId,
      },
      include: supplierProductInclude,
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'SUPPLIER_PRODUCT_DEACTIVATED',
      entity: 'SupplierProduct',
      entityId: supplierProduct.id,
      metadata: { supplierId, productId },
    });

    return supplierProduct;
  }

  private async getSupplierRecord(tenantId: string, id: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, tenantId },
    });

    if (!supplier) {
      throw new NotFoundException('Proveedor no encontrado para esta empresa.');
    }

    return supplier;
  }

  private async ensureActiveSupplier(tenantId: string, id: string) {
    const supplier = await this.getSupplierRecord(tenantId, id);

    if (supplier.status !== SupplierStatus.ACTIVE) {
      throw new BadRequestException(
        'El proveedor está inactivo. Debes reactivarlo antes de relacionar productos.',
      );
    }

    return supplier;
  }

  private async ensureTenantProduct(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId,
      },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado para esta empresa.');
    }
  }

  private async getSupplierProduct(tenantId: string, supplierId: string, productId: string) {
    const supplierProduct = await this.prisma.supplierProduct.findFirst({
      where: {
        tenantId,
        supplierId,
        productId,
      },
    });

    if (!supplierProduct) {
      throw new NotFoundException('El producto no está relacionado con este proveedor.');
    }

    return supplierProduct;
  }

  private normalizeRequiredName(value: string) {
    const normalized = value.trim();

    if (!normalized) {
      throw new BadRequestException('El nombre comercial del proveedor es obligatorio.');
    }

    return normalized;
  }

  private normalizeAndValidateDocument(type: DocumentType, value: string) {
    this.validateDocument(type, value);
    return normalizeDominicanDocument(value);
  }

  private validateDocument(type: DocumentType, documentNumber: string) {
    if (type !== DocumentType.RNC && type !== DocumentType.CEDULA) {
      throw new BadRequestException(
        'El documento del proveedor debe ser un RNC o una cédula dominicana.',
      );
    }

    if (!validateDominicanDocument(type, documentNumber)) {
      throw new BadRequestException(
        type === DocumentType.RNC
          ? 'El RNC indicado no es válido.'
          : 'La cédula indicada no es válida.',
      );
    }
  }

  private async ensureUniqueDocument(
    tenantId: string,
    documentType: DocumentType,
    documentNumber: string,
    supplierId?: string,
  ) {
    const existing = await this.prisma.supplier.findFirst({
      where: {
        tenantId,
        documentType,
        documentNumber,
        ...(supplierId ? { id: { not: supplierId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Ya existe un proveedor con este RNC o cédula en la empresa.');
    }
  }

  private ensurePrimaryIsActive(isPrimary: boolean, active: boolean) {
    if (isPrimary && !active) {
      throw new BadRequestException('El proveedor principal de un producto debe estar activo.');
    }
  }

  private ensureCosts(lastCostNet?: number, lastCostWithTax?: number) {
    if (
      lastCostNet !== undefined &&
      lastCostWithTax !== undefined &&
      lastCostWithTax < lastCostNet
    ) {
      throw new BadRequestException('El costo con impuesto no puede ser menor que el costo neto.');
    }
  }

  private rethrowSupplierConflict(error: unknown): never {
    if (isUniqueConstraintError(error)) {
      throw new ConflictException('Ya existe un proveedor con este RNC o cédula en la empresa.');
    }

    throw error;
  }

  private rethrowSupplierProductConflict(error: unknown): never {
    if (isUniqueConstraintError(error)) {
      throw new ConflictException(
        'No se pudo guardar la relación: el producto ya pertenece al proveedor o ya tiene otro proveedor principal.',
      );
    }

    throw error;
  }
}

function normalizeOptionalText(value?: string) {
  if (value === undefined) {
    return undefined;
  }

  return value.trim() || null;
}

function normalizeOptionalEmail(value?: string) {
  if (value === undefined) {
    return undefined;
  }

  return value.trim().toLowerCase() || null;
}

function toOptionalDecimal(value?: number) {
  return value === undefined ? undefined : new Prisma.Decimal(value).toDecimalPlaces(2);
}

function decimalToNumber(value: Prisma.Decimal | null) {
  return value === null ? undefined : value.toNumber();
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
