import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { FiscalSequenceStatus, InvoiceDocumentType, Prisma } from '@qorvex/database';
import { PrismaService } from '../../prisma/prisma.service';
import {
  normalizeDominicanDocument,
  validateDominicanCedula,
  validateDominicanRnc,
} from '../../common/utils/dominican-documents';
import { CreateFiscalSequenceDto } from './dto/create-fiscal-sequence.dto';
import {
  currentBusinessDate,
  expectedLocalNcfPrefix,
  formatLocalNcf,
  isNcfExpirationPast,
  isFiscalCreditNcf,
  isLocalNcfDocumentType,
  parseNcfExpirationDate,
} from './fiscal-number';

@Injectable()
export class FiscalSequencesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    await this.refreshStatuses(tenantId);

    return this.prisma.fiscalSequence.findMany({
      where: { tenantId },
      orderBy: [{ status: 'asc' }, { documentType: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(tenantId: string, userId: string, dto: CreateFiscalSequenceDto) {
    if (!isLocalNcfDocumentType(dto.documentType)) {
      throw new BadRequestException('Only local B01 and B02 sequences can be configured.');
    }

    if (dto.startNumber > dto.endNumber) {
      throw new BadRequestException('Fiscal sequence start cannot exceed its end.');
    }

    if (dto.nextNumber < dto.startNumber || dto.nextNumber > dto.endNumber) {
      throw new BadRequestException('Next fiscal number must be inside the authorized range.');
    }

    const authorizationNumber = dto.authorizationNumber?.trim() || null;
    const validUntil = parseNcfExpirationDate(dto.validUntil);

    if (!authorizationNumber) {
      throw new BadRequestException('B01 and B02 require the DGII authorization number.');
    }

    if (isFiscalCreditNcf(dto.documentType) && !validUntil) {
      throw new BadRequestException('B01 requires its DGII expiration date.');
    }

    if (validUntil && isNcfExpirationPast(validUntil)) {
      throw new BadRequestException('The fiscal sequence authorization is already expired.');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { rnc: true },
    });
    if (
      !tenant?.rnc?.trim() ||
      (!validateDominicanRnc(tenant.rnc) && !validateDominicanCedula(tenant.rnc))
    ) {
      throw new BadRequestException(
        'Configure a valid issuer RNC or Dominican ID before registering fiscal sequences.',
      );
    }
    const issuerTaxId = normalizeDominicanDocument(tenant.rnc);

    const prefix = expectedLocalNcfPrefix(dto.documentType);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockSequenceLane(tx, tenantId, dto.documentType);
        await this.refreshSequenceStatuses(tx, tenantId, dto.documentType);

        const overlap = await tx.fiscalSequence.findFirst({
          where: {
            tenantId,
            documentType: dto.documentType,
            startNumber: { lte: dto.endNumber },
            endNumber: { gte: dto.startNumber },
          },
          select: { id: true },
        });

        if (overlap) {
          throw new ConflictException(
            'The authorized range overlaps a sequence already registered.',
          );
        }

        let active = await tx.fiscalSequence.findFirst({
          where: {
            tenantId,
            documentType: dto.documentType,
            status: FiscalSequenceStatus.ACTIVE,
          },
          select: { id: true, issuerTaxId: true, prefix: true },
        });

        if (active && (active.issuerTaxId !== issuerTaxId || active.prefix !== prefix)) {
          throw new ConflictException(
            'The active fiscal sequence belongs to a different issuer or prefix. Review it before adding another range.',
          );
        }

        if (!active) {
          active = await this.promoteNextInactive(tx, tenantId, dto.documentType, issuerTaxId);
        }

        const status = active ? FiscalSequenceStatus.INACTIVE : FiscalSequenceStatus.ACTIVE;
        const sequence = await tx.fiscalSequence.create({
          data: {
            tenantId,
            documentType: dto.documentType,
            prefix,
            startNumber: dto.startNumber,
            endNumber: dto.endNumber,
            nextNumber: dto.nextNumber,
            authorizationNumber,
            issuerTaxId,
            validUntil,
            status,
          },
        });

        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'FISCAL_SEQUENCE_CREATED',
            entity: 'FiscalSequence',
            entityId: sequence.id,
            metadata: {
              documentType: sequence.documentType,
              prefix: sequence.prefix,
              startNumber: sequence.startNumber,
              endNumber: sequence.endNumber,
              nextNumber: sequence.nextNumber,
              authorizationNumber: sequence.authorizationNumber,
              issuerTaxId: sequence.issuerTaxId,
              validUntil: sequence.validUntil?.toISOString().slice(0, 10) ?? null,
              status: sequence.status,
            },
          },
        });

        return sequence;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(
          'An active or overlapping fiscal sequence was created concurrently.',
        );
      }

      throw error;
    }
  }

  async reserve(tx: Prisma.TransactionClient, tenantId: string, documentType: InvoiceDocumentType) {
    if (!isLocalNcfDocumentType(documentType)) {
      throw new BadRequestException('Only local B01 and B02 invoices are enabled.');
    }

    await this.lockSequenceLane(tx, tenantId, documentType);
    await this.refreshSequenceStatuses(tx, tenantId, documentType);

    const issuer = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { rnc: true },
    });
    const currentIssuerTaxId = issuer?.rnc ? normalizeDominicanDocument(issuer.rnc) : '';
    let sequence = await tx.fiscalSequence.findFirst({
      where: {
        tenantId,
        documentType,
        status: FiscalSequenceStatus.ACTIVE,
      },
      orderBy: [{ startNumber: 'asc' }, { createdAt: 'asc' }],
    });

    if (sequence && (!sequence.issuerTaxId || sequence.issuerTaxId !== currentIssuerTaxId)) {
      throw new BadRequestException(
        `The active ${expectedLocalNcfPrefix(documentType)} sequence belongs to a different issuer tax identity.`,
      );
    }

    if (!sequence) {
      sequence = await this.promoteNextInactive(tx, tenantId, documentType, currentIssuerTaxId);
    }

    if (!sequence) {
      throw new BadRequestException(
        `No active or queued ${expectedLocalNcfPrefix(documentType)} sequence is configured.`,
      );
    }

    if (sequence.validUntil && isNcfExpirationPast(sequence.validUntil)) {
      throw new BadRequestException(
        `The active ${expectedLocalNcfPrefix(documentType)} sequence is expired.`,
      );
    }

    if (sequence.nextNumber > sequence.endNumber) {
      throw new BadRequestException(
        `The active ${expectedLocalNcfPrefix(documentType)} sequence is exhausted.`,
      );
    }

    const number = sequence.nextNumber;
    const ncf = formatLocalNcf(documentType, sequence.prefix, number);
    const exhausted = number >= sequence.endNumber;

    await tx.fiscalSequence.update({
      where: { id: sequence.id },
      data: {
        nextNumber: number + 1,
        ...(exhausted ? { status: FiscalSequenceStatus.EXHAUSTED } : {}),
      },
    });

    if (exhausted) {
      await this.promoteNextInactive(tx, tenantId, documentType, currentIssuerTaxId);
    }

    return {
      id: sequence.id,
      ncf,
      number,
      prefix: sequence.prefix,
      authorizationNumber: sequence.authorizationNumber,
      issuerTaxId: sequence.issuerTaxId,
      validUntil: sequence.validUntil,
    };
  }

  /**
   * Preflight only: verifies that checkout can later reserve this local NCF.
   * It intentionally does not consume a number; reserve() remains the sole
   * allocation point inside the final invoice transaction.
   */
  async assertAvailable(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentType: InvoiceDocumentType,
  ) {
    if (!isLocalNcfDocumentType(documentType)) {
      throw new BadRequestException('Only local B01 and B02 invoices are enabled.');
    }

    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { rnc: true },
    });
    if (
      !tenant?.rnc?.trim() ||
      (!validateDominicanRnc(tenant.rnc) && !validateDominicanCedula(tenant.rnc))
    ) {
      throw new BadRequestException(
        'Configure a valid issuer RNC or Dominican ID before confirming fiscal details.',
      );
    }

    const prefix = expectedLocalNcfPrefix(documentType);
    const issuerTaxId = normalizeDominicanDocument(tenant.rnc);
    const sequence = await tx.fiscalSequence.findFirst({
      where: {
        tenantId,
        documentType,
        prefix,
        issuerTaxId,
        status: {
          in: [FiscalSequenceStatus.ACTIVE, FiscalSequenceStatus.INACTIVE],
        },
        nextNumber: { lte: tx.fiscalSequence.fields.endNumber },
        OR: [{ validUntil: null }, { validUntil: { gte: currentBusinessDate() } }],
      },
      select: { id: true },
    });

    if (!sequence) {
      throw new BadRequestException(
        `No usable ${prefix} sequence is configured. Register the DGII-authorized range before confirming this invoice type.`,
      );
    }
  }

  async refreshStatuses(tenantId: string) {
    await this.prisma.$transaction([
      this.prisma.fiscalSequence.updateMany({
        where: {
          tenantId,
          status: {
            in: [FiscalSequenceStatus.ACTIVE, FiscalSequenceStatus.INACTIVE],
          },
          validUntil: { lt: currentBusinessDate() },
        },
        data: { status: FiscalSequenceStatus.EXPIRED },
      }),
      this.prisma.fiscalSequence.updateMany({
        where: {
          tenantId,
          status: {
            in: [FiscalSequenceStatus.ACTIVE, FiscalSequenceStatus.INACTIVE],
          },
          nextNumber: { gt: this.prisma.fiscalSequence.fields.endNumber },
        },
        data: { status: FiscalSequenceStatus.EXHAUSTED },
      }),
    ]);
  }

  private async lockSequenceLane(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentType: InvoiceDocumentType,
  ) {
    await tx.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`${tenantId}:${documentType}`}, 0::bigint)
      ) IS NULL AS "locked"
    `;
  }

  private async refreshSequenceStatuses(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentType: InvoiceDocumentType,
  ) {
    await tx.fiscalSequence.updateMany({
      where: {
        tenantId,
        documentType,
        status: {
          in: [FiscalSequenceStatus.ACTIVE, FiscalSequenceStatus.INACTIVE],
        },
        validUntil: { lt: currentBusinessDate() },
      },
      data: { status: FiscalSequenceStatus.EXPIRED },
    });
    await tx.fiscalSequence.updateMany({
      where: {
        tenantId,
        documentType,
        status: {
          in: [FiscalSequenceStatus.ACTIVE, FiscalSequenceStatus.INACTIVE],
        },
        nextNumber: { gt: tx.fiscalSequence.fields.endNumber },
      },
      data: { status: FiscalSequenceStatus.EXHAUSTED },
    });
  }

  private async promoteNextInactive(
    tx: Prisma.TransactionClient,
    tenantId: string,
    documentType: InvoiceDocumentType,
    issuerTaxId: string,
  ) {
    if (!issuerTaxId) {
      return null;
    }

    const sequence = await tx.fiscalSequence.findFirst({
      where: {
        tenantId,
        documentType,
        prefix: expectedLocalNcfPrefix(documentType),
        issuerTaxId,
        status: FiscalSequenceStatus.INACTIVE,
        nextNumber: { lte: tx.fiscalSequence.fields.endNumber },
        OR: [{ validUntil: null }, { validUntil: { gte: currentBusinessDate() } }],
      },
      orderBy: [{ startNumber: 'asc' }, { createdAt: 'asc' }],
    });

    if (!sequence) {
      return null;
    }

    return tx.fiscalSequence.update({
      where: { id: sequence.id },
      data: { status: FiscalSequenceStatus.ACTIVE },
    });
  }
}
