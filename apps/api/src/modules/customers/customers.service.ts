import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CustomerStatus, DocumentType, Prisma } from '@qorvex/database';
import {
  normalizeDominicanDocument,
  validateDominicanDocument,
} from '../../common/utils/dominican-documents';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { ConfigureCustomerCreditDto } from './dto/configure-customer-credit.dto';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll(tenantId: string) {
    return this.prisma.customer.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(tenantId: string, userId: string, dto: CreateCustomerDto) {
    const documentNumber = this.normalizeAndValidateDocument(
      dto.documentType,
      dto.documentNumber,
    );

    await this.ensureUniqueDocument(tenantId, dto.documentType, documentNumber);

    try {
      const customer = await this.prisma.customer.create({
        data: {
          ...dto,
          documentNumber,
          tenantId,
        },
      });

      await this.audit.log({
        tenantId,
        userId,
        action: 'CUSTOMER_CREATED',
        entity: 'Customer',
        entityId: customer.id,
        metadata: { name: customer.name, documentNumber: customer.documentNumber },
      });

      return customer;
    } catch (error) {
      this.rethrowDocumentConflict(error);
    }
  }

  async findOne(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found for tenant.');
    }

    return customer;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateCustomerDto) {
    const current = await this.findOne(tenantId, id);
    const documentChanged =
      dto.documentType !== undefined || dto.documentNumber !== undefined;
    const nextDocumentType = dto.documentType ?? current.documentType;
    const nextDocumentValue =
      dto.documentNumber !== undefined
        ? dto.documentNumber
        : dto.documentType !== undefined &&
            dto.documentType !== DocumentType.RNC &&
            dto.documentType !== DocumentType.CEDULA
          ? null
          : current.documentNumber;
    const documentNumber = documentChanged
      ? this.normalizeAndValidateDocument(nextDocumentType, nextDocumentValue)
      : undefined;

    if (documentChanged) {
      await this.ensureUniqueDocument(tenantId, nextDocumentType, documentNumber, id);
    }

    try {
      const customer = await this.prisma.customer.update({
        where: { id },
        data: {
          ...dto,
          ...(documentChanged ? { documentNumber } : {}),
        },
      });

      await this.audit.log({
        tenantId,
        userId,
        action: 'CUSTOMER_UPDATED',
        entity: 'Customer',
        entityId: id,
        metadata: { fields: Object.keys(dto) },
      });

      return customer;
    } catch (error) {
      this.rethrowDocumentConflict(error);
    }
  }

  private normalizeAndValidateDocument(
    documentType: DocumentType,
    value: string | null | undefined,
  ) {
    const trimmedValue = value?.trim();

    if (documentType !== DocumentType.RNC && documentType !== DocumentType.CEDULA) {
      return trimmedValue || null;
    }

    if (!trimmedValue) {
      throw new BadRequestException(
        documentType === DocumentType.RNC
          ? 'El RNC del cliente es obligatorio.'
          : 'La cédula del cliente es obligatoria.',
      );
    }

    if (!validateDominicanDocument(documentType, trimmedValue)) {
      throw new BadRequestException(
        documentType === DocumentType.RNC
          ? 'El RNC indicado no es válido.'
          : 'La cédula indicada no es válida.',
      );
    }

    return normalizeDominicanDocument(trimmedValue);
  }

  private async ensureUniqueDocument(
    tenantId: string,
    documentType: DocumentType,
    documentNumber: string | null | undefined,
    customerId?: string,
  ) {
    if (!documentNumber) {
      return;
    }

    const existing = await this.prisma.customer.findFirst({
      where: {
        tenantId,
        documentType,
        documentNumber,
        ...(customerId ? { id: { not: customerId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'Ya existe un cliente con este tipo y número de documento en la empresa.',
      );
    }
  }

  private rethrowDocumentConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Ya existe un cliente con este tipo y número de documento en la empresa.',
      );
    }

    throw error;
  }

  async configureCredit(
    tenantId: string,
    userId: string,
    id: string,
    dto: ConfigureCustomerCreditDto,
  ) {
    await this.findOne(tenantId, id);

    const customer = await this.prisma.customer.update({
      where: { id },
      data: {
        creditEnabled: dto.creditEnabled,
        creditStatus: dto.creditStatus,
        creditLimit: new Prisma.Decimal(dto.creditLimit).toDecimalPlaces(2),
        creditTermDays: dto.creditTermDays,
        creditEnabledAt: dto.creditEnabled ? new Date() : null,
        creditEnabledById: dto.creditEnabled ? userId : null,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'CUSTOMER_CREDIT_CONFIGURED',
      entity: 'Customer',
      entityId: id,
      metadata: {
        enabled: customer.creditEnabled,
        status: customer.creditStatus,
        limit: customer.creditLimit.toString(),
        termDays: customer.creditTermDays,
      },
    });

    return customer;
  }

  async remove(tenantId: string, userId: string, id: string) {
    await this.findOne(tenantId, id);

    const customer = await this.prisma.customer.update({
      where: { id },
      data: {
        status: CustomerStatus.INACTIVE,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'CUSTOMER_DEACTIVATED',
      entity: 'Customer',
      entityId: id,
    });

    return customer;
  }
}
