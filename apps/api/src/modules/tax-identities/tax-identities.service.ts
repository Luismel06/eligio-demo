import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DgiiRegistryDatasetStatus,
  DgiiRegistrySource,
  DgiiTaxpayerStatus,
  DocumentType,
  MembershipStatus,
  Role,
  TaxIdentityContextType,
  UserStatus,
} from '@qorvex/database';
import * as bcrypt from 'bcryptjs';
import { createHmac } from 'node:crypto';
import {
  normalizeDominicanDocument,
  validateDominicanDocument,
} from '../../common/utils/dominican-documents';
import type { AuthenticatedUser } from '../../common/types/authenticated-request';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { getTaxIdentityHmacSecret } from '../../common/security/tax-identity-hmac-secret';
import { AuthorizeTaxIdentityOverrideDto } from './dto/authorize-tax-identity-override.dto';
import type { LookupTaxIdentityDto } from './dto/lookup-tax-identity.dto';
import type {
  RequireUsableTaxIdentityInput,
  TaxIdentityLookupResult,
  TaxIdentityTransactionClient,
  TaxIdentityVerificationSnapshot,
} from './tax-identity.types';

const supervisorRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];
const dummyPasswordHash = '$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';

type LookupInput = LookupTaxIdentityDto & { tenantId: string };

@Injectable()
export class TaxIdentitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async lookup(input: LookupInput): Promise<TaxIdentityLookupResult> {
    const identity = this.normalizeAndValidate(input.documentType, input.documentNumber);
    this.assertOverrideLookupShape(input);

    const official = await this.lookupRegistry(identity.documentType, identity.documentNumber);
    if (official.outcome === 'VERIFIED' || !input.overrideId) {
      return official;
    }

    const manual = await this.findUsableOverride(
      this.prisma,
      input.tenantId,
      input.overrideId,
      input.contextType!,
      input.contextId!,
      identity.documentType,
      identity.documentNumber,
    );

    return manual ?? official;
  }

  /**
   * Server-side enforcement used by POS, Customers and Suppliers. An override
   * is never trusted from its id alone: tenant, context and document HMAC must
   * all match. Pass consumeOverride=true and the caller's Prisma transaction
   * to make a manual approval single-use atomically with the business write.
   */
  async requireUsableIdentity(
    input: RequireUsableTaxIdentityInput,
    options: {
      db?: TaxIdentityTransactionClient;
      consumeOverride?: boolean;
      fallbackVerification?: unknown;
    } = {},
  ): Promise<TaxIdentityLookupResult> {
    const identity = this.normalizeAndValidate(input.documentType, input.documentNumber);
    const official = await this.lookupRegistry(
      identity.documentType,
      identity.documentNumber,
      options.db,
    );

    if (official.outcome === 'VERIFIED') {
      return official;
    }

    if (
      !input.overrideId &&
      (official.outcome === 'REGISTRY_STALE' || official.outcome === 'UNAVAILABLE')
    ) {
      const fallback = this.readStoredVerification(
        options.fallbackVerification,
        identity.documentType,
        identity.documentNumber,
      );
      if (fallback) {
        return this.result(
          'VERIFIED',
          identity.documentType,
          identity.documentNumber,
          new Date(fallback.verifiedAt),
          {
            fiscalName: fallback.fiscalName,
            registryStatus: fallback.registryStatus,
            source: fallback.source,
            sourceUpdatedAt: new Date(fallback.sourceUpdatedAt),
            overrideId: fallback.overrideId,
          },
        );
      }
    }

    if (!input.overrideId) {
      throw new UnprocessableEntityException({
        message: this.failureMessage(official.outcome),
        taxIdentity: official,
      });
    }

    await this.assertContextBelongsToTenant(input.tenantId, input.contextType, input.contextId);
    const db = options.db ?? this.prisma;
    const manual = await this.findUsableOverride(
      db,
      input.tenantId,
      input.overrideId,
      input.contextType,
      input.contextId,
      identity.documentType,
      identity.documentNumber,
    );

    if (!manual) {
      throw new ForbiddenException('La autorización del supervisor no es válida o ya expiró.');
    }

    if (options.consumeOverride) {
      const consumed = await db.taxIdentityOverride.updateMany({
        where: {
          id: input.overrideId,
          tenantId: input.tenantId,
          contextType: input.contextType,
          contextId: input.contextId,
          documentType: identity.documentType,
          documentHash: this.hashDocument(identity.documentType, identity.documentNumber),
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });

      if (consumed.count !== 1) {
        throw new ConflictException('La autorización fiscal ya fue utilizada o expiró.');
      }
    }

    return manual;
  }

  async authorizeOverride(
    tenantId: string,
    requester: AuthenticatedUser,
    dto: AuthorizeTaxIdentityOverrideDto,
  ) {
    const identity = this.normalizeAndValidate(dto.documentType, dto.documentNumber);
    const contextId = dto.contextId.trim();
    await this.assertContextBelongsToTenant(tenantId, dto.contextType, contextId);

    const registryResult = await this.lookupRegistry(
      identity.documentType,
      identity.documentNumber,
    );
    if (registryResult.outcome === 'VERIFIED') {
      throw new ConflictException(
        'La identidad ya está verificada por DGII y no requiere autorización manual.',
      );
    }

    const supervisor = await this.prisma.user.findUnique({
      where: { email: dto.supervisorEmail.trim().toLowerCase() },
      select: {
        id: true,
        passwordHash: true,
        status: true,
        memberships: {
          select: { tenantId: true, role: true, status: true },
        },
      },
    });
    const passwordMatches = await bcrypt.compare(
      dto.supervisorPassword,
      supervisor?.passwordHash ?? dummyPasswordHash,
    );
    const canApprove = Boolean(
      supervisor &&
      supervisor.status === UserStatus.ACTIVE &&
      passwordMatches &&
      supervisor.memberships.some(
        (membership) =>
          membership.status === MembershipStatus.ACTIVE &&
          supervisorRoles.includes(membership.role) &&
          (membership.tenantId === tenantId ||
            membership.role === Role.SUPER_ADMIN ||
            membership.role === Role.QORVEX_SUPER_ADMIN),
      ),
    );

    if (!canApprove || !supervisor) {
      await this.auditFailedApproval(tenantId, requester.id, dto, identity.documentNumber);
      throw new ForbiddenException('No se pudo validar la autorización del supervisor.');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + (dto.expiresInMinutes ?? 10) * 60_000);
    const documentHash = this.hashDocument(identity.documentType, identity.documentNumber);
    const fiscalName = this.normalizeLabel(registryResult.fiscalName ?? dto.fiscalName, 200);
    const reason = this.normalizeLabel(dto.reason, 500);

    const override = await this.prisma.$transaction(async (tx) => {
      const lockKey = [
        'corestack:tax-identity-override',
        tenantId,
        dto.contextType,
        contextId,
        identity.documentType,
        documentHash,
      ].join(':');
      await tx.$queryRaw`
        SELECT 1::int AS "locked"
        FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) AS acquired
      `;

      const existingApproval = await tx.taxIdentityOverride.findFirst({
        where: {
          tenantId,
          contextType: dto.contextType,
          contextId,
          documentType: identity.documentType,
          documentHash,
          fiscalName,
          reason,
          requestedById: requester.id,
          approvedById: supervisor.id,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true, expiresAt: true, createdAt: true },
      });
      if (existingApproval) {
        return existingApproval;
      }

      await tx.taxIdentityOverride.updateMany({
        where: {
          tenantId,
          contextType: dto.contextType,
          contextId,
          documentHash,
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });

      const created = await tx.taxIdentityOverride.create({
        data: {
          tenantId,
          contextType: dto.contextType,
          contextId,
          documentType: identity.documentType,
          documentHash,
          documentLast4: identity.documentNumber.slice(-4),
          fiscalName,
          reason,
          requestedById: requester.id,
          approvedById: supervisor.id,
          expiresAt,
        },
        select: { id: true, expiresAt: true, createdAt: true },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId: requester.id,
          action: 'TAX_IDENTITY_OVERRIDE_APPROVED',
          entity: 'TaxIdentityOverride',
          entityId: created.id,
          metadata: {
            contextType: dto.contextType,
            contextId,
            documentType: identity.documentType,
            documentLast4: identity.documentNumber.slice(-4),
            registryOutcome: registryResult.outcome,
            approvedById: supervisor.id,
            expiresAt: created.expiresAt.toISOString(),
          },
        },
      });

      return created;
    });

    return {
      overrideId: override.id,
      outcome: 'VERIFIED' as const,
      documentType: identity.documentType,
      documentNumber: identity.documentNumber,
      fiscalName,
      registryStatus: 'AUTORIZACIÓN MANUAL DE SUPERVISOR',
      source: 'MANUAL_OVERRIDE' as const,
      sourceUpdatedAt: override.createdAt,
      checkedAt: new Date(),
      expiresAt: override.expiresAt,
    };
  }

  toVerificationSnapshot(result: TaxIdentityLookupResult): TaxIdentityVerificationSnapshot {
    if (
      result.outcome !== 'VERIFIED' ||
      !result.fiscalName ||
      !result.registryStatus ||
      !result.source ||
      !result.sourceUpdatedAt ||
      (result.documentType !== DocumentType.RNC && result.documentType !== DocumentType.CEDULA)
    ) {
      throw new BadRequestException('La identidad fiscal todavía no está verificada.');
    }

    return {
      outcome: result.source === 'MANUAL_OVERRIDE' ? 'MANUAL_OVERRIDE' : 'VERIFIED',
      documentType: result.documentType,
      documentNumber: result.documentNumber,
      fiscalName: result.fiscalName,
      registryStatus: result.registryStatus,
      source: result.source,
      sourceUpdatedAt: result.sourceUpdatedAt.toISOString(),
      verifiedAt: result.checkedAt.toISOString(),
      ...(result.overrideId ? { overrideId: result.overrideId } : {}),
    };
  }

  private async lookupRegistry(
    documentType: DocumentType,
    documentNumber: string,
    db: Pick<TaxIdentityTransactionClient, 'dgiiRegistryDataset'> = this.prisma,
  ): Promise<TaxIdentityLookupResult> {
    const checkedAt = new Date();
    const dataset = await db.dgiiRegistryDataset.findFirst({
      where: { status: DgiiRegistryDatasetStatus.ACTIVE },
      orderBy: { activatedAt: 'desc' },
      select: {
        source: true,
        sourceUpdatedAt: true,
        records: {
          where: { documentType, documentNumber },
          select: { fiscalName: true, registryStatus: true, status: true },
          take: 1,
        },
      },
    });

    if (!dataset) {
      return this.result('UNAVAILABLE', documentType, documentNumber, checkedAt);
    }

    if (
      dataset.source === DgiiRegistrySource.TEST_FIXTURE &&
      process.env.NODE_ENV === 'production'
    ) {
      return this.result('UNAVAILABLE', documentType, documentNumber, checkedAt, {
        registryStatus: 'TEST_FIXTURE_DISABLED_IN_PRODUCTION',
        source: dataset.source,
        sourceUpdatedAt: dataset.sourceUpdatedAt,
      });
    }

    const record = dataset.records[0];
    const shared = {
      fiscalName: record?.fiscalName ?? null,
      registryStatus: record?.registryStatus ?? null,
      source: dataset.source,
      sourceUpdatedAt: dataset.sourceUpdatedAt,
    };

    if (this.isRegistryStale(dataset.sourceUpdatedAt, checkedAt)) {
      return this.result('REGISTRY_STALE', documentType, documentNumber, checkedAt, shared);
    }

    if (!record) {
      return this.result('NOT_FOUND', documentType, documentNumber, checkedAt, shared);
    }

    return this.result(
      record.status === DgiiTaxpayerStatus.ACTIVE ? 'VERIFIED' : 'NON_ACTIVE',
      documentType,
      documentNumber,
      checkedAt,
      shared,
    );
  }

  private async findUsableOverride(
    db: Pick<TaxIdentityTransactionClient, 'taxIdentityOverride'>,
    tenantId: string,
    overrideId: string,
    contextType: TaxIdentityContextType,
    contextId: string,
    documentType: DocumentType,
    documentNumber: string,
  ): Promise<TaxIdentityLookupResult | null> {
    const override = await db.taxIdentityOverride.findFirst({
      where: {
        id: overrideId,
        tenantId,
        contextType,
        contextId,
        documentType,
        documentHash: this.hashDocument(documentType, documentNumber),
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: {
        id: true,
        fiscalName: true,
        createdAt: true,
      },
    });

    if (!override) {
      return null;
    }

    return this.result('VERIFIED', documentType, documentNumber, new Date(), {
      fiscalName: override.fiscalName,
      registryStatus: 'AUTORIZACIÓN MANUAL DE SUPERVISOR',
      source: 'MANUAL_OVERRIDE',
      sourceUpdatedAt: override.createdAt,
      overrideId: override.id,
    });
  }

  private normalizeAndValidate(documentType: DocumentType, rawDocumentNumber: string) {
    if (documentType !== DocumentType.RNC && documentType !== DocumentType.CEDULA) {
      throw new BadRequestException('Solo se puede consultar RNC o cédula dominicana.');
    }

    const documentNumber = normalizeDominicanDocument(rawDocumentNumber);
    if (!validateDominicanDocument(documentType, rawDocumentNumber)) {
      throw new BadRequestException(
        documentType === DocumentType.RNC ? 'El RNC no es válido.' : 'La cédula no es válida.',
      );
    }

    return { documentType, documentNumber };
  }

  private readStoredVerification(
    value: unknown,
    documentType: DocumentType,
    documentNumber: string,
  ): TaxIdentityVerificationSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const verification = value as Record<string, unknown>;
    const source = verification.source;
    const outcome = verification.outcome;
    const verifiedAt =
      typeof verification.verifiedAt === 'string' ? new Date(verification.verifiedAt) : null;
    const sourceUpdatedAt =
      typeof verification.sourceUpdatedAt === 'string'
        ? new Date(verification.sourceUpdatedAt)
        : null;
    const storedDocumentNumber =
      typeof verification.documentNumber === 'string'
        ? normalizeDominicanDocument(verification.documentNumber)
        : '';
    const fiscalName =
      typeof verification.fiscalName === 'string' ? verification.fiscalName.trim() : '';
    const registryStatus =
      typeof verification.registryStatus === 'string' ? verification.registryStatus.trim() : '';
    const overrideId =
      typeof verification.overrideId === 'string' && verification.overrideId.trim()
        ? verification.overrideId.trim()
        : undefined;
    const normalizedSource =
      source === 'DGII_OFFICIAL' || source === 'TEST_FIXTURE' || source === 'MANUAL_OVERRIDE'
        ? source
        : null;
    const coherentRegistryEvidence =
      outcome === 'VERIFIED' &&
      (normalizedSource === 'DGII_OFFICIAL' || normalizedSource === 'TEST_FIXTURE') &&
      !overrideId;
    const coherentManualEvidence =
      outcome === 'MANUAL_OVERRIDE' &&
      normalizedSource === 'MANUAL_OVERRIDE' &&
      Boolean(overrideId);

    if (
      (!coherentRegistryEvidence && !coherentManualEvidence) ||
      verification.documentType !== documentType ||
      storedDocumentNumber !== documentNumber ||
      !fiscalName ||
      !registryStatus ||
      !normalizedSource ||
      !verifiedAt ||
      Number.isNaN(verifiedAt.getTime()) ||
      !sourceUpdatedAt ||
      Number.isNaN(sourceUpdatedAt.getTime()) ||
      verifiedAt.getTime() > Date.now() + 60 * 60 * 1000 ||
      (normalizedSource === 'TEST_FIXTURE' && process.env.NODE_ENV === 'production')
    ) {
      return null;
    }

    return {
      outcome: coherentManualEvidence ? 'MANUAL_OVERRIDE' : 'VERIFIED',
      documentType: documentType as TaxIdentityVerificationSnapshot['documentType'],
      documentNumber,
      fiscalName,
      registryStatus,
      source: normalizedSource,
      sourceUpdatedAt: sourceUpdatedAt.toISOString(),
      verifiedAt: verifiedAt.toISOString(),
      ...(overrideId ? { overrideId } : {}),
    };
  }

  private assertOverrideLookupShape(input: LookupInput) {
    const hasContextType = Boolean(input.contextType);
    const hasContextId = Boolean(input.contextId?.trim());

    if (input.overrideId && (!hasContextType || !hasContextId)) {
      throw new BadRequestException('Consultar una autorización requiere contextType y contextId.');
    }

    if (hasContextType !== hasContextId) {
      throw new BadRequestException('contextType y contextId deben enviarse juntos.');
    }
  }

  private async assertContextBelongsToTenant(
    tenantId: string,
    contextType: TaxIdentityContextType,
    rawContextId: string,
  ) {
    const contextId = rawContextId.trim();
    if (!contextId) {
      throw new BadRequestException('El contexto de la autorización es obligatorio.');
    }

    let exists = true;
    if (contextType === TaxIdentityContextType.POS_ORDER) {
      exists = Boolean(
        await this.prisma.salesOrder.findFirst({
          where: { id: contextId, tenantId },
          select: { id: true },
        }),
      );
    } else if (contextType === TaxIdentityContextType.CUSTOMER) {
      exists = Boolean(
        await this.prisma.customer.findFirst({
          where: { id: contextId, tenantId },
          select: { id: true },
        }),
      );
    } else if (contextType === TaxIdentityContextType.SUPPLIER) {
      exists = Boolean(
        await this.prisma.supplier.findFirst({
          where: { id: contextId, tenantId },
          select: { id: true },
        }),
      );
    } else if (!/^[A-Za-z0-9_-]{8,80}$/.test(contextId)) {
      exists = false;
    }

    if (!exists) {
      throw new BadRequestException(
        'El contexto de la autorización no es válido para esta empresa.',
      );
    }
  }

  private hashDocument(documentType: DocumentType, documentNumber: string) {
    const secret = getTaxIdentityHmacSecret(this.config);

    return createHmac('sha256', secret)
      .update(`tax-identity:v1:${documentType}:${documentNumber}`)
      .digest('hex');
  }

  private isRegistryStale(sourceUpdatedAt: Date, checkedAt: Date) {
    const configuredHours = Number(this.config.get<string>('DGII_REGISTRY_MAX_AGE_HOURS') ?? '216');
    const maxAgeHours =
      Number.isFinite(configuredHours) && configuredHours > 0 ? configuredHours : 216;
    return checkedAt.getTime() - sourceUpdatedAt.getTime() > maxAgeHours * 60 * 60 * 1000;
  }

  private result(
    outcome: TaxIdentityLookupResult['outcome'],
    documentType: DocumentType,
    documentNumber: string,
    checkedAt: Date,
    fields: Partial<
      Omit<TaxIdentityLookupResult, 'outcome' | 'documentType' | 'documentNumber' | 'checkedAt'>
    > = {},
  ): TaxIdentityLookupResult {
    return {
      outcome,
      documentType,
      documentNumber,
      fiscalName: fields.fiscalName ?? null,
      registryStatus: fields.registryStatus ?? null,
      source: fields.source ?? null,
      sourceUpdatedAt: fields.sourceUpdatedAt ?? null,
      checkedAt,
      ...(fields.overrideId ? { overrideId: fields.overrideId } : {}),
    };
  }

  private failureMessage(outcome: TaxIdentityLookupResult['outcome']) {
    if (outcome === 'NOT_FOUND') {
      return 'El documento no aparece en el padrón DGII. Requiere autorización de supervisor.';
    }
    if (outcome === 'NON_ACTIVE') {
      return 'El contribuyente no figura activo en DGII. Requiere autorización de supervisor.';
    }
    if (outcome === 'REGISTRY_STALE') {
      return 'El padrón DGII local está desactualizado. Requiere sincronización o autorización de supervisor.';
    }
    return 'El padrón DGII no está disponible. Requiere autorización de supervisor.';
  }

  private normalizeLabel(value: string, maxLength: number) {
    const normalized = value
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) {
      throw new BadRequestException('El nombre fiscal y la justificación son obligatorios.');
    }
    return normalized.slice(0, maxLength);
  }

  private async auditFailedApproval(
    tenantId: string,
    requesterId: string,
    dto: AuthorizeTaxIdentityOverrideDto,
    documentNumber: string,
  ) {
    try {
      await this.audit.log({
        tenantId,
        userId: requesterId,
        action: 'TAX_IDENTITY_OVERRIDE_DENIED',
        entity: 'TaxIdentityOverride',
        metadata: {
          contextType: dto.contextType,
          contextId: dto.contextId.trim(),
          documentType: dto.documentType,
          documentLast4: documentNumber.slice(-4),
        },
      });
    } catch {
      // Authentication must still fail closed if the audit store is temporarily unavailable.
    }
  }
}
