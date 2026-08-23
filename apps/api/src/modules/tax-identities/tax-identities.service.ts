import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CashSessionStatus,
  DgiiRegistryDatasetStatus,
  DgiiRegistrySource,
  DgiiTaxpayerStatus,
  DocumentType,
  MembershipStatus,
  Prisma,
  Role,
  SalesOrderStatus,
  TaxIdentityApprovalRequestStatus,
  TaxIdentityContextType,
} from '@qorvex/database';
import { createHmac } from 'node:crypto';
import {
  normalizeDominicanDocument,
  validateDominicanDocument,
} from '../../common/utils/dominican-documents';
import type { AuthenticatedUser } from '../../common/types/authenticated-request';
import { PrismaService } from '../../prisma/prisma.service';
import { getTaxIdentityHmacSecret } from '../../common/security/tax-identity-hmac-secret';
import { CreateTaxIdentityApprovalRequestDto } from './dto/create-tax-identity-approval-request.dto';
import {
  ApproveTaxIdentityApprovalRequestDto,
  RejectTaxIdentityApprovalRequestDto,
} from './dto/decide-tax-identity-approval-request.dto';
import { ListTaxIdentityApprovalRequestsDto } from './dto/list-tax-identity-approval-requests.dto';
import type { LookupTaxIdentityDto } from './dto/lookup-tax-identity.dto';
import type {
  ManagedTaxIdentityEvidence,
  RequireUsableTaxIdentityInput,
  TaxIdentityLookupResult,
  TaxIdentityTransactionClient,
  TaxIdentityVerificationSnapshot,
} from './tax-identity.types';

const administratorRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];

const approvalRequestInclude = {
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  override: { select: { id: true, expiresAt: true, usedAt: true } },
} satisfies Prisma.TaxIdentityApprovalRequestInclude;

type TaxIdentityApprovalRequestWithRelations = Prisma.TaxIdentityApprovalRequestGetPayload<{
  include: typeof approvalRequestInclude;
}>;

type LookupInput = LookupTaxIdentityDto & { tenantId: string };

@Injectable()
export class TaxIdentitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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
   * Server-side enforcement used by POS. An override
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
      const alreadyUsed = await db.taxIdentityOverride.findFirst({
        where: {
          id: input.overrideId,
          tenantId: input.tenantId,
          contextType: input.contextType,
          contextId: input.contextId,
          documentType: identity.documentType,
          documentHash: this.hashDocument(identity.documentType, identity.documentNumber),
          usedAt: { not: null },
        },
        select: { id: true },
      });
      if (alreadyUsed) {
        throw new ConflictException('La validación manual fiscal ya fue utilizada.');
      }
      throw new ForbiddenException('La validación manual administrativa no es válida o ya expiró.');
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

  /**
   * Resolves identities for Customer and Supplier records maintained by an
   * already-authorized back-office role. A DGII match always wins. When the
   * document is specifically NOT_FOUND, the supplied fiscal name may be
   * stored as a clearly-labelled manual entry;
   * this never creates a POS override or masquerades as DGII verification.
   */
  async resolveManagedRecordIdentity(
    input: {
      documentType: DocumentType;
      documentNumber: string;
      manualFiscalName: string;
      manualEntryConfirmed: boolean;
    },
    options: {
      db?: TaxIdentityTransactionClient;
      fallbackVerification?: unknown;
    } = {},
  ): Promise<TaxIdentityVerificationSnapshot | ManagedTaxIdentityEvidence> {
    const identity = this.normalizeAndValidate(input.documentType, input.documentNumber);
    const official = await this.lookupRegistry(
      identity.documentType,
      identity.documentNumber,
      options.db,
    );

    if (official.outcome === 'VERIFIED') {
      return this.toVerificationSnapshot(official);
    }

    if (official.outcome === 'REGISTRY_STALE' || official.outcome === 'UNAVAILABLE') {
      const fallback = this.readStoredVerification(
        options.fallbackVerification,
        identity.documentType,
        identity.documentNumber,
      );
      if (fallback) {
        return fallback;
      }

      const manualFallback = this.readStoredManualEntry(
        options.fallbackVerification,
        identity.documentType,
        identity.documentNumber,
      );
      if (manualFallback) {
        return manualFallback;
      }

      throw new UnprocessableEntityException({
        message: this.failureMessage(official.outcome),
        taxIdentity: official,
      });
    }

    if (official.outcome !== 'NOT_FOUND') {
      throw new UnprocessableEntityException({
        message: this.failureMessage(official.outcome),
        taxIdentity: official,
      });
    }

    if (!input.manualEntryConfirmed) {
      throw new UnprocessableEntityException({
        message:
          'Confirma explícitamente que registrarás manualmente una identidad no encontrada en DGII.',
        taxIdentity: official,
      });
    }

    const fiscalName = this.normalizeFiscalName(input.manualFiscalName);
    const recordedAt = new Date();
    return {
      outcome: 'UNVERIFIED_MANUAL',
      documentType: identity.documentType as ManagedTaxIdentityEvidence['documentType'],
      documentNumber: identity.documentNumber,
      fiscalName,
      registryOutcome: 'NOT_FOUND',
      registryStatus: 'NO ENCONTRADO EN EL PADRÓN DGII',
      source: 'MANUAL_ENTRY',
      sourceUpdatedAt: official.sourceUpdatedAt?.toISOString() ?? null,
      registryCheckedAt: official.checkedAt.toISOString(),
      recordedAt: recordedAt.toISOString(),
    };
  }

  async createApprovalRequest(
    tenantId: string,
    requester: AuthenticatedUser,
    dto: CreateTaxIdentityApprovalRequestDto,
  ) {
    if (dto.contextType !== TaxIdentityContextType.POS_ORDER) {
      throw new ForbiddenException(
        'Las solicitudes de validación fiscal solo pueden originarse en Caja.',
      );
    }
    const identity = this.normalizeAndValidate(dto.documentType, dto.documentNumber);
    const contextId = dto.contextId.trim();
    await this.assertCanCreateApprovalRequest(tenantId, requester, dto.contextType, contextId);

    const registryResult = await this.lookupRegistry(
      identity.documentType,
      identity.documentNumber,
    );
    if (registryResult.outcome === 'VERIFIED') {
      throw new ConflictException(
        'La identidad ya está verificada por DGII y no requiere autorización manual.',
      );
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.approvalRequestTtlMinutes() * 60_000);
    const documentHash = this.hashDocument(identity.documentType, identity.documentNumber);
    const fiscalName = this.normalizeLabel(dto.fiscalName, 200);
    const reason = dto.reason ? this.normalizeLabel(dto.reason, 500) : null;

    const request: TaxIdentityApprovalRequestWithRelations = await this.prisma.$transaction(
      async (tx) => {
        await this.lockApprovalContext(tx, tenantId, dto.contextType, contextId);
        if (
          !(await this.isApprovalContextStillValid(tx, tenantId, {
            contextType: dto.contextType,
            contextId,
            requestedById: requester.id,
          }))
        ) {
          throw new ConflictException(
            'La orden o el contexto cambió antes de crear la solicitud fiscal.',
          );
        }

        const pending = await tx.taxIdentityApprovalRequest.findFirst({
          where: {
            tenantId,
            contextType: dto.contextType,
            contextId,
            status: TaxIdentityApprovalRequestStatus.PENDING,
          },
          include: approvalRequestInclude,
        });

        if (pending?.expiresAt && pending.expiresAt <= now) {
          const expired = await tx.taxIdentityApprovalRequest.updateMany({
            where: {
              id: pending.id,
              tenantId,
              status: TaxIdentityApprovalRequestStatus.PENDING,
            },
            data: {
              status: TaxIdentityApprovalRequestStatus.EXPIRED,
              decidedAt: now,
              decisionNote: 'La solicitud expiró antes de recibir una decisión.',
            },
          });
          if (expired.count === 1) {
            await this.createApprovalAudit(tx, {
              tenantId,
              userId: null,
              action: 'TAX_IDENTITY_APPROVAL_REQUEST_EXPIRED',
              requestId: pending.id,
              contextType: pending.contextType,
              contextId: pending.contextId,
              documentType: pending.documentType,
              documentLast4: pending.documentLast4,
            });
          }
        } else if (
          pending &&
          pending.documentType === identity.documentType &&
          pending.documentHash === documentHash &&
          pending.fiscalName === fiscalName &&
          pending.requestedById === requester.id
        ) {
          return pending;
        } else if (pending) {
          const cancelled = await tx.taxIdentityApprovalRequest.updateMany({
            where: {
              id: pending.id,
              tenantId,
              status: TaxIdentityApprovalRequestStatus.PENDING,
            },
            data: {
              status: TaxIdentityApprovalRequestStatus.CANCELLED,
              decidedById: requester.id,
              decidedAt: now,
              decisionNote: 'Reemplazada por una solicitud fiscal más reciente para este contexto.',
            },
          });
          if (cancelled.count === 1) {
            await this.createApprovalAudit(tx, {
              tenantId,
              userId: requester.id,
              action: 'TAX_IDENTITY_APPROVAL_REQUEST_CANCELLED',
              requestId: pending.id,
              contextType: pending.contextType,
              contextId: pending.contextId,
              documentType: pending.documentType,
              documentLast4: pending.documentLast4,
            });
          }
        }

        const reusableApproved = await tx.taxIdentityApprovalRequest.findFirst({
          where: {
            tenantId,
            contextType: dto.contextType,
            contextId,
            documentType: identity.documentType,
            documentHash,
            fiscalName,
            requestedById: requester.id,
            status: TaxIdentityApprovalRequestStatus.APPROVED,
            override: {
              usedAt: null,
              revokedAt: null,
              expiresAt: { gt: now },
            },
          },
          include: approvalRequestInclude,
          orderBy: { requestedAt: 'desc' },
        });
        if (reusableApproved) {
          return reusableApproved;
        }

        const revokedPriorOverrides = await tx.taxIdentityOverride.updateMany({
          where: {
            tenantId,
            contextType: dto.contextType,
            contextId,
            usedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });

        const created = await tx.taxIdentityApprovalRequest.create({
          data: {
            tenantId,
            contextType: dto.contextType,
            contextId,
            documentType: identity.documentType,
            documentNumber: identity.documentNumber,
            documentHash,
            documentLast4: identity.documentNumber.slice(-4),
            fiscalName,
            reason,
            registryOutcome: registryResult.outcome,
            registrySource:
              registryResult.source === 'DGII_OFFICIAL'
                ? DgiiRegistrySource.DGII_OFFICIAL
                : registryResult.source === 'TEST_FIXTURE'
                  ? DgiiRegistrySource.TEST_FIXTURE
                  : null,
            registryCheckedAt: registryResult.checkedAt,
            registrySourceUpdatedAt: registryResult.sourceUpdatedAt,
            requestedById: requester.id,
            expiresAt,
          },
          include: approvalRequestInclude,
        });

        await this.createApprovalAudit(tx, {
          tenantId,
          userId: requester.id,
          action: 'TAX_IDENTITY_APPROVAL_REQUESTED',
          requestId: created.id,
          contextType: created.contextType,
          contextId: created.contextId,
          documentType: created.documentType,
          documentLast4: created.documentLast4,
          metadata: {
            registryOutcome: created.registryOutcome,
            revokedPriorOverrides: revokedPriorOverrides.count,
          },
        });

        return created;
      },
    );

    return this.toPublicApprovalRequest(request);
  }

  async listApprovalRequests(
    tenantId: string,
    requester: AuthenticatedUser,
    query: ListTaxIdentityApprovalRequestsDto,
  ) {
    const contextId = query.contextId?.trim();
    if (query.contextType && query.contextType !== TaxIdentityContextType.POS_ORDER) {
      throw new BadRequestException('Las solicitudes fiscales consultables pertenecen a Caja.');
    }
    const hasContextType = Boolean(query.contextType);
    const hasContextId = Boolean(contextId);
    if (hasContextType !== hasContextId) {
      throw new BadRequestException('contextType y contextId deben enviarse juntos.');
    }

    const isAdministrator = this.hasAdministratorAccess(tenantId, requester);
    if (!isAdministrator && (!query.contextType || !contextId)) {
      throw new ForbiddenException(
        'Solo un administrador puede consultar solicitudes fuera de su contexto.',
      );
    }
    if (query.contextType && contextId) {
      await this.assertContextBelongsToTenant(tenantId, query.contextType, contextId);
    }

    await this.expirePendingApprovalRequests(tenantId, isAdministrator ? undefined : requester.id);

    const requests = await this.prisma.taxIdentityApprovalRequest.findMany({
      where: {
        tenantId,
        contextType: TaxIdentityContextType.POS_ORDER,
        ...(query.status ? { status: query.status } : {}),
        ...(query.contextType && contextId ? { contextType: query.contextType, contextId } : {}),
        ...(!isAdministrator ? { requestedById: requester.id } : {}),
      },
      include: approvalRequestInclude,
      orderBy: { requestedAt: 'desc' },
      take: query.limit ?? 100,
    });

    return requests.map((request) => this.toPublicApprovalRequest(request));
  }

  async getApprovalRequest(tenantId: string, requester: AuthenticatedUser, requestId: string) {
    let request = await this.prisma.taxIdentityApprovalRequest.findFirst({
      where: { id: requestId, tenantId, contextType: TaxIdentityContextType.POS_ORDER },
      include: approvalRequestInclude,
    });
    if (!request) {
      throw new NotFoundException('La solicitud de validación fiscal no existe.');
    }
    if (
      request.requestedById !== requester.id &&
      !this.hasAdministratorAccess(tenantId, requester)
    ) {
      throw new ForbiddenException('No puedes consultar esta solicitud de validación fiscal.');
    }

    if (
      request.status === TaxIdentityApprovalRequestStatus.PENDING &&
      request.expiresAt <= new Date()
    ) {
      await this.expireApprovalRequest(tenantId, requestId);
      request = await this.prisma.taxIdentityApprovalRequest.findFirstOrThrow({
        where: { id: requestId, tenantId, contextType: TaxIdentityContextType.POS_ORDER },
        include: approvalRequestInclude,
      });
    }

    return this.toPublicApprovalRequest(request);
  }

  async approveApprovalRequest(
    tenantId: string,
    administrator: AuthenticatedUser,
    requestId: string,
    dto: ApproveTaxIdentityApprovalRequestDto,
  ) {
    this.assertAdministratorAccess(tenantId, administrator);
    const current = await this.prisma.taxIdentityApprovalRequest.findFirst({
      where: { id: requestId, tenantId, contextType: TaxIdentityContextType.POS_ORDER },
      select: { id: true },
    });
    if (!current) {
      throw new NotFoundException('La solicitud de validación fiscal no existe.');
    }
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lockApprovalRequest(tx, tenantId, requestId);
      const request = await tx.taxIdentityApprovalRequest.findFirst({
        where: { id: requestId, tenantId, contextType: TaxIdentityContextType.POS_ORDER },
        include: approvalRequestInclude,
      });
      if (!request) {
        throw new NotFoundException('La solicitud de validación fiscal no existe.');
      }
      if (request.status === TaxIdentityApprovalRequestStatus.APPROVED) {
        return { kind: 'approved' as const, request };
      }
      if (request.status !== TaxIdentityApprovalRequestStatus.PENDING) {
        throw new ConflictException('La solicitud fiscal ya recibió una decisión.');
      }

      const now = new Date();
      if (request.expiresAt <= now) {
        await tx.taxIdentityApprovalRequest.update({
          where: { id: request.id },
          data: {
            status: TaxIdentityApprovalRequestStatus.EXPIRED,
            decidedAt: now,
            decisionNote: 'La solicitud expiró antes de recibir una decisión.',
          },
        });
        await this.createApprovalAudit(tx, {
          tenantId,
          userId: null,
          action: 'TAX_IDENTITY_APPROVAL_REQUEST_EXPIRED',
          requestId: request.id,
          contextType: request.contextType,
          contextId: request.contextId,
          documentType: request.documentType,
          documentLast4: request.documentLast4,
        });
        return { kind: 'expired' as const };
      }

      if (!(await this.isApprovalContextStillValid(tx, tenantId, request))) {
        await tx.taxIdentityApprovalRequest.update({
          where: { id: request.id },
          data: {
            status: TaxIdentityApprovalRequestStatus.CANCELLED,
            decidedById: administrator.id,
            decidedAt: now,
            decisionNote: 'El contexto cambió o dejó de estar disponible antes de la aprobación.',
          },
        });
        await this.createApprovalAudit(tx, {
          tenantId,
          userId: administrator.id,
          action: 'TAX_IDENTITY_APPROVAL_REQUEST_CANCELLED',
          requestId: request.id,
          contextType: request.contextType,
          contextId: request.contextId,
          documentType: request.documentType,
          documentLast4: request.documentLast4,
          metadata: { reason: 'CONTEXT_NO_LONGER_VALID' },
        });
        return { kind: 'invalid-context' as const };
      }

      const registryResult = await this.lookupRegistry(
        request.documentType,
        request.documentNumber,
        tx,
      );
      if (registryResult.outcome === 'VERIFIED') {
        await tx.taxIdentityApprovalRequest.update({
          where: { id: request.id },
          data: {
            status: TaxIdentityApprovalRequestStatus.CANCELLED,
            decidedById: administrator.id,
            decidedAt: now,
            decisionNote: 'La identidad ya fue verificada por el padrón DGII vigente.',
          },
        });
        await this.createApprovalAudit(tx, {
          tenantId,
          userId: administrator.id,
          action: 'TAX_IDENTITY_APPROVAL_REQUEST_CANCELLED',
          requestId: request.id,
          contextType: request.contextType,
          contextId: request.contextId,
          documentType: request.documentType,
          documentLast4: request.documentLast4,
          metadata: { registryOutcome: registryResult.outcome },
        });
        return { kind: 'verified-by-dgii' as const };
      }

      const fiscalName = this.normalizeLabel(dto.fiscalName ?? request.fiscalName, 200);
      const decisionNote = dto.decisionNote ? this.normalizeLabel(dto.decisionNote, 500) : null;
      const reason =
        decisionNote ??
        request.reason ??
        'Identidad fiscal revisada y autorizada manualmente por un administrador.';
      const overrideExpiresAt = new Date(now.getTime() + (dto.expiresInMinutes ?? 10) * 60_000);

      let override = await tx.taxIdentityOverride.findFirst({
        where: {
          tenantId,
          contextType: request.contextType,
          contextId: request.contextId,
          documentType: request.documentType,
          documentHash: request.documentHash,
          fiscalName,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true, expiresAt: true, usedAt: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!override) {
        await tx.taxIdentityOverride.updateMany({
          where: {
            tenantId,
            contextType: request.contextType,
            contextId: request.contextId,
            documentHash: request.documentHash,
            usedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });
        override = await tx.taxIdentityOverride.create({
          data: {
            tenantId,
            contextType: request.contextType,
            contextId: request.contextId,
            documentType: request.documentType,
            documentHash: request.documentHash,
            documentLast4: request.documentLast4,
            fiscalName,
            reason,
            requestedById: request.requestedById,
            approvedById: administrator.id,
            expiresAt: overrideExpiresAt,
          },
          select: { id: true, expiresAt: true, usedAt: true },
        });
      }

      const approved = await tx.taxIdentityApprovalRequest.updateMany({
        where: {
          id: request.id,
          tenantId,
          status: TaxIdentityApprovalRequestStatus.PENDING,
        },
        data: {
          status: TaxIdentityApprovalRequestStatus.APPROVED,
          fiscalName,
          decidedById: administrator.id,
          decidedAt: now,
          decisionNote,
          overrideId: override.id,
        },
      });
      if (approved.count !== 1) {
        throw new ConflictException('La solicitud fiscal cambió mientras se aprobaba.');
      }

      await this.createApprovalAudit(tx, {
        tenantId,
        userId: administrator.id,
        action: 'TAX_IDENTITY_APPROVAL_REQUEST_APPROVED',
        requestId: request.id,
        contextType: request.contextType,
        contextId: request.contextId,
        documentType: request.documentType,
        documentLast4: request.documentLast4,
        metadata: {
          overrideId: override.id,
          overrideExpiresAt: override.expiresAt.toISOString(),
          registryOutcome: registryResult.outcome,
        },
      });

      const result = await tx.taxIdentityApprovalRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: approvalRequestInclude,
      });
      return { kind: 'approved' as const, request: result };
    });

    if (outcome.kind === 'expired') {
      throw new ConflictException('La solicitud fiscal expiró antes de ser aprobada.');
    }
    if (outcome.kind === 'verified-by-dgii') {
      throw new ConflictException(
        'La identidad ahora está verificada por DGII; no se generó autorización manual.',
      );
    }
    if (outcome.kind === 'invalid-context') {
      throw new ConflictException(
        'La orden o el contexto cambió; se canceló la solicitud sin generar autorización.',
      );
    }
    return this.toPublicApprovalRequest(outcome.request);
  }

  async rejectApprovalRequest(
    tenantId: string,
    administrator: AuthenticatedUser,
    requestId: string,
    dto: RejectTaxIdentityApprovalRequestDto,
  ) {
    this.assertAdministratorAccess(tenantId, administrator);
    const decisionNote = this.normalizeLabel(dto.decisionNote, 500);
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lockApprovalRequest(tx, tenantId, requestId);
      const request = await tx.taxIdentityApprovalRequest.findFirst({
        where: { id: requestId, tenantId, contextType: TaxIdentityContextType.POS_ORDER },
        include: approvalRequestInclude,
      });
      if (!request) {
        throw new NotFoundException('La solicitud de validación fiscal no existe.');
      }
      if (request.status === TaxIdentityApprovalRequestStatus.REJECTED) {
        return { kind: 'rejected' as const, request };
      }
      if (request.status !== TaxIdentityApprovalRequestStatus.PENDING) {
        throw new ConflictException('La solicitud fiscal ya recibió una decisión.');
      }

      const now = new Date();
      if (request.expiresAt <= now) {
        await tx.taxIdentityApprovalRequest.update({
          where: { id: request.id },
          data: {
            status: TaxIdentityApprovalRequestStatus.EXPIRED,
            decidedAt: now,
            decisionNote: 'La solicitud expiró antes de recibir una decisión.',
          },
        });
        await this.createApprovalAudit(tx, {
          tenantId,
          userId: null,
          action: 'TAX_IDENTITY_APPROVAL_REQUEST_EXPIRED',
          requestId: request.id,
          contextType: request.contextType,
          contextId: request.contextId,
          documentType: request.documentType,
          documentLast4: request.documentLast4,
        });
        return { kind: 'expired' as const };
      }

      const rejected = await tx.taxIdentityApprovalRequest.updateMany({
        where: {
          id: request.id,
          tenantId,
          status: TaxIdentityApprovalRequestStatus.PENDING,
        },
        data: {
          status: TaxIdentityApprovalRequestStatus.REJECTED,
          decidedById: administrator.id,
          decidedAt: now,
          decisionNote,
        },
      });
      if (rejected.count !== 1) {
        throw new ConflictException('La solicitud fiscal cambió mientras se rechazaba.');
      }
      await this.createApprovalAudit(tx, {
        tenantId,
        userId: administrator.id,
        action: 'TAX_IDENTITY_APPROVAL_REQUEST_REJECTED',
        requestId: request.id,
        contextType: request.contextType,
        contextId: request.contextId,
        documentType: request.documentType,
        documentLast4: request.documentLast4,
      });
      const result = await tx.taxIdentityApprovalRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: approvalRequestInclude,
      });
      return { kind: 'rejected' as const, request: result };
    });

    if (outcome.kind === 'expired') {
      throw new ConflictException('La solicitud fiscal expiró antes de ser rechazada.');
    }
    return this.toPublicApprovalRequest(outcome.request);
  }

  async cancelApprovalRequest(tenantId: string, requester: AuthenticatedUser, requestId: string) {
    const outcome = await this.prisma.$transaction(async (tx) => {
      await this.lockApprovalRequest(tx, tenantId, requestId);
      const request = await tx.taxIdentityApprovalRequest.findFirst({
        where: { id: requestId, tenantId, contextType: TaxIdentityContextType.POS_ORDER },
        include: approvalRequestInclude,
      });
      if (!request) {
        throw new NotFoundException('La solicitud de validación fiscal no existe.');
      }
      if (
        request.requestedById !== requester.id &&
        !this.hasAdministratorAccess(tenantId, requester)
      ) {
        throw new ForbiddenException('No puedes cancelar esta solicitud de validación fiscal.');
      }
      if (request.status === TaxIdentityApprovalRequestStatus.CANCELLED) {
        return request;
      }
      if (request.status !== TaxIdentityApprovalRequestStatus.PENDING) {
        throw new ConflictException('La solicitud fiscal ya recibió una decisión.');
      }

      const now = new Date();
      const status =
        request.expiresAt <= now
          ? TaxIdentityApprovalRequestStatus.EXPIRED
          : TaxIdentityApprovalRequestStatus.CANCELLED;
      await tx.taxIdentityApprovalRequest.update({
        where: { id: request.id },
        data: {
          status,
          decidedById: status === TaxIdentityApprovalRequestStatus.CANCELLED ? requester.id : null,
          decidedAt: now,
          decisionNote:
            status === TaxIdentityApprovalRequestStatus.CANCELLED
              ? 'Cancelada por el solicitante.'
              : 'La solicitud expiró antes de ser cancelada.',
        },
      });
      await this.createApprovalAudit(tx, {
        tenantId,
        userId: status === TaxIdentityApprovalRequestStatus.CANCELLED ? requester.id : null,
        action:
          status === TaxIdentityApprovalRequestStatus.CANCELLED
            ? 'TAX_IDENTITY_APPROVAL_REQUEST_CANCELLED'
            : 'TAX_IDENTITY_APPROVAL_REQUEST_EXPIRED',
        requestId: request.id,
        contextType: request.contextType,
        contextId: request.contextId,
        documentType: request.documentType,
        documentLast4: request.documentLast4,
      });
      return tx.taxIdentityApprovalRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: approvalRequestInclude,
      });
    });

    return this.toPublicApprovalRequest(outcome);
  }

  toVerificationSnapshot(result: TaxIdentityLookupResult): TaxIdentityVerificationSnapshot {
    if (
      result.outcome !== 'VERIFIED' ||
      !result.fiscalName ||
      !result.registryStatus ||
      !result.source ||
      (result.source !== 'DGII_OFFICIAL' &&
        result.source !== 'TEST_FIXTURE' &&
        result.source !== 'MANUAL_OVERRIDE') ||
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
      registryStatus: 'VALIDACIÓN MANUAL ADMINISTRATIVA',
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

  private readStoredManualEntry(
    value: unknown,
    documentType: DocumentType,
    documentNumber: string,
  ): ManagedTaxIdentityEvidence | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const evidence = value as Record<string, unknown>;
    const storedDocumentNumber =
      typeof evidence.documentNumber === 'string'
        ? normalizeDominicanDocument(evidence.documentNumber)
        : '';
    const fiscalName = typeof evidence.fiscalName === 'string' ? evidence.fiscalName.trim() : '';
    const registryStatus =
      typeof evidence.registryStatus === 'string' ? evidence.registryStatus.trim() : '';
    const registryCheckedAt =
      typeof evidence.registryCheckedAt === 'string' ? new Date(evidence.registryCheckedAt) : null;
    const recordedAt = typeof evidence.recordedAt === 'string' ? new Date(evidence.recordedAt) : null;
    const sourceUpdatedAt =
      typeof evidence.sourceUpdatedAt === 'string' ? new Date(evidence.sourceUpdatedAt) : null;

    if (
      evidence.outcome !== 'UNVERIFIED_MANUAL' ||
      evidence.source !== 'MANUAL_ENTRY' ||
      evidence.registryOutcome !== 'NOT_FOUND' ||
      evidence.documentType !== documentType ||
      storedDocumentNumber !== documentNumber ||
      !fiscalName ||
      !registryStatus ||
      !registryCheckedAt ||
      Number.isNaN(registryCheckedAt.getTime()) ||
      !recordedAt ||
      Number.isNaN(recordedAt.getTime()) ||
      (sourceUpdatedAt && Number.isNaN(sourceUpdatedAt.getTime()))
    ) {
      return null;
    }

    return {
      outcome: 'UNVERIFIED_MANUAL',
      documentType: documentType as ManagedTaxIdentityEvidence['documentType'],
      documentNumber,
      fiscalName,
      registryOutcome: 'NOT_FOUND',
      registryStatus,
      source: 'MANUAL_ENTRY',
      sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
      registryCheckedAt: registryCheckedAt.toISOString(),
      recordedAt: recordedAt.toISOString(),
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

  private async assertCanCreateApprovalRequest(
    tenantId: string,
    requester: AuthenticatedUser,
    contextType: TaxIdentityContextType,
    rawContextId: string,
  ) {
    const contextId = rawContextId.trim();
    if (!contextId) {
      throw new BadRequestException('El contexto de la solicitud es obligatorio.');
    }

    if (contextType !== TaxIdentityContextType.POS_ORDER) {
      throw new ForbiddenException(
        'Las solicitudes de validación fiscal solo pueden originarse en Caja.',
      );
    }

    const membership = requester.memberships.find(
      (candidate) =>
        candidate.tenantId === tenantId && candidate.status === MembershipStatus.ACTIVE,
    );
    if (!membership?.canUsePos || membership.role !== Role.CASHIER) {
      throw new ForbiddenException(
        'Solo el cajero asignado puede solicitar validación fiscal para una orden.',
      );
    }

    const order = await this.prisma.salesOrder.findFirst({
      where: {
        id: contextId,
        tenantId,
        status: SalesOrderStatus.IN_CASHIER,
        invoiceId: null,
        claimedById: requester.id,
        claimExpiresAt: { gt: new Date() },
        claimedCashSession: {
          is: {
            tenantId,
            openedById: requester.id,
            status: CashSessionStatus.OPEN,
          },
        },
      },
      select: { id: true },
    });
    if (!order) {
      throw new ConflictException(
        'La orden debe estar reclamada por este cajero en una sesión de caja abierta.',
      );
    }
  }

  private async isApprovalContextStillValid(
    tx: Prisma.TransactionClient,
    tenantId: string,
    request: Pick<
      TaxIdentityApprovalRequestWithRelations,
      'contextType' | 'contextId' | 'requestedById'
    >,
  ) {
    if (request.contextType !== TaxIdentityContextType.POS_ORDER) {
      return false;
    }
    return Boolean(
      await tx.salesOrder.findFirst({
        where: {
          id: request.contextId,
          tenantId,
          status: SalesOrderStatus.IN_CASHIER,
          invoiceId: null,
          claimedById: request.requestedById,
          claimExpiresAt: { gt: new Date() },
          claimedCashSession: {
            is: {
              tenantId,
              openedById: request.requestedById,
              status: CashSessionStatus.OPEN,
            },
          },
        },
        select: { id: true },
      }),
    );
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
      return 'El documento no aparece en el padrón DGII. Requiere validación manual administrativa.';
    }
    if (outcome === 'NON_ACTIVE') {
      return 'El contribuyente no figura activo en DGII. Requiere validación manual administrativa.';
    }
    if (outcome === 'REGISTRY_STALE') {
      return 'El padrón DGII local está desactualizado. Requiere sincronización o validación manual administrativa.';
    }
    return 'El padrón DGII no está disponible. Requiere validación manual administrativa.';
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

  private normalizeFiscalName(value: string) {
    const normalized = value
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) {
      throw new BadRequestException(
        'Digita el nombre o la razón social para registrar esta identidad manualmente.',
      );
    }
    return normalized.slice(0, 200);
  }

  private approvalRequestTtlMinutes() {
    const configured = Number(
      this.config.get<string>('TAX_IDENTITY_APPROVAL_REQUEST_TTL_MINUTES') ?? '30',
    );
    return Number.isInteger(configured) && configured >= 5 && configured <= 240 ? configured : 30;
  }

  private hasAdministratorAccess(tenantId: string, user: AuthenticatedUser) {
    return user.memberships.some(
      (membership) =>
        membership.status === MembershipStatus.ACTIVE &&
        administratorRoles.includes(membership.role) &&
        (membership.tenantId === tenantId ||
          membership.role === Role.SUPER_ADMIN ||
          membership.role === Role.QORVEX_SUPER_ADMIN),
    );
  }

  private assertAdministratorAccess(tenantId: string, user: AuthenticatedUser) {
    if (!this.hasAdministratorAccess(tenantId, user)) {
      throw new ForbiddenException('Solo un administrador puede decidir esta solicitud fiscal.');
    }
  }

  private async lockApprovalContext(
    tx: Prisma.TransactionClient,
    tenantId: string,
    contextType: TaxIdentityContextType,
    contextId: string,
  ) {
    const lockKey = [
      'corestack:tax-identity-approval-context',
      tenantId,
      contextType,
      contextId,
    ].join(':');
    await tx.$queryRaw`
      SELECT 1::int AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) AS acquired
    `;
  }

  private async lockApprovalRequest(
    tx: Prisma.TransactionClient,
    tenantId: string,
    requestId: string,
  ) {
    const lockKey = ['corestack:tax-identity-approval-request', tenantId, requestId].join(':');
    await tx.$queryRaw`
      SELECT 1::int AS "locked"
      FROM (SELECT pg_advisory_xact_lock(hashtext(${lockKey}))) AS acquired
    `;
  }

  private async expirePendingApprovalRequests(tenantId: string, requestedById?: string) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const expiredRequests = await tx.taxIdentityApprovalRequest.findMany({
        where: {
          tenantId,
          contextType: TaxIdentityContextType.POS_ORDER,
          status: TaxIdentityApprovalRequestStatus.PENDING,
          expiresAt: { lte: now },
          ...(requestedById ? { requestedById } : {}),
        },
        select: {
          id: true,
          contextType: true,
          contextId: true,
          documentType: true,
          documentLast4: true,
        },
        take: 500,
      });

      for (const request of expiredRequests) {
        const expired = await tx.taxIdentityApprovalRequest.updateMany({
          where: {
            id: request.id,
            tenantId,
            status: TaxIdentityApprovalRequestStatus.PENDING,
            expiresAt: { lte: now },
          },
          data: {
            status: TaxIdentityApprovalRequestStatus.EXPIRED,
            decidedAt: now,
            decisionNote: 'La solicitud expiró antes de recibir una decisión.',
          },
        });
        if (expired.count === 1) {
          await this.createApprovalAudit(tx, {
            tenantId,
            userId: null,
            action: 'TAX_IDENTITY_APPROVAL_REQUEST_EXPIRED',
            requestId: request.id,
            contextType: request.contextType,
            contextId: request.contextId,
            documentType: request.documentType,
            documentLast4: request.documentLast4,
          });
        }
      }
    });
  }

  private async expireApprovalRequest(tenantId: string, requestId: string) {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const request = await tx.taxIdentityApprovalRequest.findFirst({
        where: {
          id: requestId,
          tenantId,
          contextType: TaxIdentityContextType.POS_ORDER,
          status: TaxIdentityApprovalRequestStatus.PENDING,
          expiresAt: { lte: now },
        },
        select: {
          id: true,
          contextType: true,
          contextId: true,
          documentType: true,
          documentLast4: true,
        },
      });
      if (!request) {
        return;
      }
      const expired = await tx.taxIdentityApprovalRequest.updateMany({
        where: {
          id: request.id,
          tenantId,
          status: TaxIdentityApprovalRequestStatus.PENDING,
          expiresAt: { lte: now },
        },
        data: {
          status: TaxIdentityApprovalRequestStatus.EXPIRED,
          decidedAt: now,
          decisionNote: 'La solicitud expiró antes de recibir una decisión.',
        },
      });
      if (expired.count === 1) {
        await this.createApprovalAudit(tx, {
          tenantId,
          userId: null,
          action: 'TAX_IDENTITY_APPROVAL_REQUEST_EXPIRED',
          requestId: request.id,
          contextType: request.contextType,
          contextId: request.contextId,
          documentType: request.documentType,
          documentLast4: request.documentLast4,
        });
      }
    });
  }

  private async createApprovalAudit(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      userId: string | null;
      action: string;
      requestId: string;
      contextType: TaxIdentityContextType;
      contextId: string;
      documentType: DocumentType;
      documentLast4: string;
      metadata?: Prisma.InputJsonObject;
    },
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        action: input.action,
        entity: 'TaxIdentityApprovalRequest',
        entityId: input.requestId,
        metadata: {
          contextType: input.contextType,
          contextId: input.contextId,
          documentType: input.documentType,
          documentLast4: input.documentLast4,
          ...(input.metadata ?? {}),
        },
      },
    });
  }

  private toPublicApprovalRequest(request: TaxIdentityApprovalRequestWithRelations) {
    return {
      id: request.id,
      status: request.status,
      contextType: request.contextType,
      contextId: request.contextId,
      documentType: request.documentType,
      documentNumber: request.documentNumber,
      documentLast4: request.documentLast4,
      fiscalName: request.fiscalName,
      reason: request.reason,
      registryOutcome: request.registryOutcome,
      registrySource: request.registrySource,
      registryCheckedAt: request.registryCheckedAt,
      registrySourceUpdatedAt: request.registrySourceUpdatedAt,
      requestedAt: request.requestedAt,
      expiresAt: request.expiresAt,
      decidedAt: request.decidedAt,
      decisionNote: request.decisionNote,
      requestedBy: request.requestedBy,
      decidedBy: request.decidedBy,
      override: request.override
        ? {
            overrideId: request.override.id,
            expiresAt: request.override.expiresAt,
            usedAt: request.override.usedAt,
          }
        : null,
    };
  }
}
