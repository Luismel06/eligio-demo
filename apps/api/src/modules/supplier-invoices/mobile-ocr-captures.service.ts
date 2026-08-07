import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { MobileOcrCaptureStatus, Prisma } from '@qorvex/database';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MobileOcrCaptureConfidenceDto,
  MobileOcrCaptureItemConfidenceDto,
  MobileOcrCaptureItemDto,
  MobileOcrCaptureResultDto,
} from './dto/mobile-ocr-capture.dto';

const CAPTURE_TTL_MS = 10 * 60 * 1000;
const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 128;

type OcrConfidence = 'high' | 'medium' | 'low';

type StoredOcrConfidence = Partial<
  Record<
    | 'supplierName'
    | 'supplierDocument'
    | 'invoiceNumber'
    | 'ncf'
    | 'issueDate'
    | 'paymentDueDate'
    | 'ncfValidUntil'
    | 'subtotal'
    | 'discountTotal'
    | 'taxTotal'
    | 'total'
    | 'purchaseOrderNumber',
    OcrConfidence
  >
>;

type StoredOcrItemConfidence = Partial<
  Record<
    'code' | 'description' | 'quantity' | 'unitCostNet' | 'discountTotal' | 'taxRate' | 'total',
    OcrConfidence
  >
>;

type StoredOcrItem = {
  rawText: string;
  code?: string;
  description?: string;
  unit?: string;
  quantity?: number;
  unitCostNet?: number;
  discountTotal?: number;
  taxRate?: number;
  taxTotal?: number;
  subtotal?: number;
  total?: number;
  confidence: StoredOcrItemConfidence;
  warnings: string[];
};

/**
 * This is the only OCR payload stored temporarily. It does not include the
 * original photo, file metadata, QR payload, or full raw OCR text.
 */
type StoredOcrResult = {
  pageCount?: number;
  supplierName?: string;
  supplierDocument?: string;
  supplierTemplate?: string;
  invoiceNumber?: string;
  ncf?: string;
  issueDate?: string;
  paymentDueDate?: string;
  ncfValidUntil?: string;
  paymentCondition?: string;
  currency?: 'DOP';
  subtotal?: number;
  discountTotal?: number;
  taxTotal?: number;
  total?: number;
  purchaseOrderNumber?: string;
  items: StoredOcrItem[];
  confidence: StoredOcrConfidence;
  warnings: string[];
};

@Injectable()
export class MobileOcrCapturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenantId: string, userId: string) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CAPTURE_TTL_MS);
    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);

    // No background worker is needed for this small, short-lived table. This
    // opportunistic cleanup also ensures completed but abandoned suggestions
    // do not remain after their expiry.
    await this.prisma.mobileOcrCaptureSession.deleteMany({
      where: { expiresAt: { lte: now } },
    });

    const session = await this.prisma.mobileOcrCaptureSession.create({
      data: {
        tenantId,
        createdById: userId,
        tokenHash,
        expiresAt,
      },
      select: {
        id: true,
        expiresAt: true,
      },
    });

    await this.audit.log({
      tenantId,
      userId,
      action: 'MOBILE_OCR_CAPTURE_CREATED',
      entity: 'MobileOcrCaptureSession',
      entityId: session.id,
      metadata: { expiresAt: session.expiresAt.toISOString() },
    });

    return {
      id: session.id,
      token,
      expiresAt: session.expiresAt,
    };
  }

  async getStatus(tenantId: string, userId: string, id: string) {
    const session = await this.findOwnedSession(tenantId, userId, id);
    await this.ensureNotExpired(session);
    return this.toStatusResponse(session);
  }

  async consume(tenantId: string, userId: string, id: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.mobileOcrCaptureSession.findFirst({
        where: { id, tenantId, createdById: userId },
        select: {
          id: true,
          status: true,
          result: true,
          expiresAt: true,
        },
      });

      if (!session) {
        throw new NotFoundException('Mobile OCR capture session was not found.');
      }

      if (session.expiresAt.getTime() <= Date.now()) {
        throw new GoneException('Mobile OCR capture session has expired.');
      }

      if (session.status !== MobileOcrCaptureStatus.READY || !session.result) {
        throw new ConflictException('The mobile OCR result is not ready yet.');
      }

      // The conditional deletion makes consumption one-use even if two desktop
      // requests race each other. The second request cannot return the result.
      const deleted = await tx.mobileOcrCaptureSession.deleteMany({
        where: {
          id,
          tenantId,
          createdById: userId,
          status: MobileOcrCaptureStatus.READY,
          expiresAt: { gt: new Date() },
        },
      });

      if (deleted.count !== 1) {
        throw new ConflictException('The mobile OCR result was already consumed or expired.');
      }

      const result = session.result as unknown as StoredOcrResult;

      // Keep the delete and audit record in the same transaction. If logging
      // fails, the handoff remains available instead of losing a one-use OCR
      // result after it was already removed from the table.
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'MOBILE_OCR_CAPTURE_CONSUMED',
          entity: 'MobileOcrCaptureSession',
          entityId: id,
          metadata: {
            pageCount: result.pageCount ?? null,
            itemCount: result.items.length,
          },
        },
      });

      return result;
    });

    return { result };
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const deleted = await this.prisma.mobileOcrCaptureSession.deleteMany({
      where: { id, tenantId, createdById: userId },
    });

    if (deleted.count !== 1) {
      throw new NotFoundException('Mobile OCR capture session was not found.');
    }

    await this.audit.log({
      tenantId,
      userId,
      action: 'MOBILE_OCR_CAPTURE_CANCELLED',
      entity: 'MobileOcrCaptureSession',
      entityId: id,
    });

    return { success: true };
  }

  async validateForMobile(id: string, token: string | undefined) {
    const session = await this.findPublicSession(id, token);
    await this.ensureNotExpired(session);
    return this.toStatusResponse(session);
  }

  async submitFromMobile(id: string, token: string | undefined, dto: MobileOcrCaptureResultDto) {
    const session = await this.findPublicSession(id, token);
    await this.ensureNotExpired(session);

    if (session.status !== MobileOcrCaptureStatus.PENDING) {
      throw new ConflictException('The mobile OCR result was already sent.');
    }

    const result = this.sanitizeResult(dto);
    const completedAt = new Date();
    const updated = await this.prisma.mobileOcrCaptureSession.updateMany({
      where: {
        id: session.id,
        tokenHash: session.tokenHash,
        status: MobileOcrCaptureStatus.PENDING,
        expiresAt: { gt: completedAt },
      },
      data: {
        status: MobileOcrCaptureStatus.READY,
        result: result as unknown as Prisma.InputJsonValue,
        completedAt,
      },
    });

    if (updated.count !== 1) {
      throw new ConflictException('The mobile OCR capture is no longer available.');
    }

    await this.audit.log({
      tenantId: session.tenantId,
      userId: session.createdById,
      action: 'MOBILE_OCR_CAPTURE_SUBMITTED',
      entity: 'MobileOcrCaptureSession',
      entityId: session.id,
      metadata: {
        pageCount: result.pageCount ?? null,
        itemCount: result.items.length,
      },
    });

    return {
      id: session.id,
      status: MobileOcrCaptureStatus.READY,
      expiresAt: session.expiresAt,
    };
  }

  private async findOwnedSession(tenantId: string, userId: string, id: string) {
    const session = await this.prisma.mobileOcrCaptureSession.findFirst({
      where: { id, tenantId, createdById: userId },
      select: {
        id: true,
        status: true,
        expiresAt: true,
      },
    });

    if (!session) {
      throw new NotFoundException('Mobile OCR capture session was not found.');
    }

    return session;
  }

  private async findPublicSession(id: string, token: string | undefined) {
    const session = await this.prisma.mobileOcrCaptureSession.findUnique({
      where: { id },
      select: {
        id: true,
        tenantId: true,
        createdById: true,
        tokenHash: true,
        status: true,
        expiresAt: true,
      },
    });

    // The public endpoints deliberately use the same response for an invalid
    // ID and an invalid token, so they cannot be used to enumerate sessions.
    if (!session || !this.tokenMatches(session.tokenHash, token)) {
      throw new NotFoundException('Mobile OCR capture session was not found.');
    }

    return session;
  }

  private async ensureNotExpired(session: { id: string; expiresAt: Date }) {
    if (session.expiresAt.getTime() > Date.now()) return;

    await this.prisma.mobileOcrCaptureSession.deleteMany({
      where: { id: session.id, expiresAt: { lte: new Date() } },
    });
    throw new GoneException('Mobile OCR capture session has expired.');
  }

  private toStatusResponse(session: {
    id: string;
    status: MobileOcrCaptureStatus;
    expiresAt: Date;
  }) {
    return {
      id: session.id,
      status: session.status,
      expiresAt: session.expiresAt,
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  private tokenMatches(expectedHash: string, token: string | undefined) {
    if (!token || token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) {
      return false;
    }

    const providedHash = this.hashToken(token);
    const expected = Buffer.from(expectedHash, 'hex');
    const provided = Buffer.from(providedHash, 'hex');
    return expected.length === provided.length && timingSafeEqual(expected, provided);
  }

  private sanitizeResult(dto: MobileOcrCaptureResultDto): StoredOcrResult {
    return compactObject({
      pageCount: dto.pageCount,
      supplierName: normalizeText(dto.supplierName, 200),
      supplierDocument: normalizeText(dto.supplierDocument, 32),
      supplierTemplate: normalizeText(dto.supplierTemplate, 80),
      invoiceNumber: normalizeText(dto.invoiceNumber, 100),
      ncf: normalizeText(dto.ncf, 50),
      issueDate: dto.issueDate,
      paymentDueDate: dto.paymentDueDate,
      ncfValidUntil: dto.ncfValidUntil,
      paymentCondition: normalizeText(dto.paymentCondition, 120),
      currency: dto.currency === 'DOP' ? 'DOP' : undefined,
      subtotal: safeNumber(dto.subtotal),
      discountTotal: safeNumber(dto.discountTotal),
      taxTotal: safeNumber(dto.taxTotal),
      total: safeNumber(dto.total),
      purchaseOrderNumber: normalizeText(dto.purchaseOrderNumber, 100),
      items: dto.items.slice(0, 100).map((item, index) => this.sanitizeItem(item, index)),
      confidence: this.sanitizeConfidence(dto.confidence),
      warnings: normalizeMessages(dto.warnings, 40),
    });
  }

  private sanitizeItem(dto: MobileOcrCaptureItemDto, index: number): StoredOcrItem {
    const code = normalizeText(dto.code, 100);
    const description = normalizeText(dto.description, 500);

    return compactObject({
      // Keeping a compact line label lets the desktop UI reuse its existing
      // item review component without retaining the complete OCR source text.
      rawText: description ?? code ?? `OCR item ${index + 1}`,
      code,
      description,
      unit: normalizeText(dto.unit, 80),
      quantity: safeNumber(dto.quantity),
      unitCostNet: safeNumber(dto.unitCostNet),
      discountTotal: safeNumber(dto.discountTotal),
      taxRate: safeNumber(dto.taxRate),
      taxTotal: safeNumber(dto.taxTotal),
      subtotal: safeNumber(dto.subtotal),
      total: safeNumber(dto.total),
      confidence: this.sanitizeItemConfidence(dto.confidence),
      warnings: normalizeMessages(dto.warnings ?? [], 12),
    });
  }

  private sanitizeConfidence(dto?: MobileOcrCaptureConfidenceDto): StoredOcrConfidence {
    if (!dto) return {};

    return compactObject({
      supplierName: toConfidence(dto.supplierName),
      supplierDocument: toConfidence(dto.supplierDocument),
      invoiceNumber: toConfidence(dto.invoiceNumber),
      ncf: toConfidence(dto.ncf),
      issueDate: toConfidence(dto.issueDate),
      paymentDueDate: toConfidence(dto.paymentDueDate),
      ncfValidUntil: toConfidence(dto.ncfValidUntil),
      subtotal: toConfidence(dto.subtotal),
      discountTotal: toConfidence(dto.discountTotal),
      taxTotal: toConfidence(dto.taxTotal),
      total: toConfidence(dto.total),
      purchaseOrderNumber: toConfidence(dto.purchaseOrderNumber),
    });
  }

  private sanitizeItemConfidence(dto?: MobileOcrCaptureItemConfidenceDto): StoredOcrItemConfidence {
    if (!dto) return {};

    return compactObject({
      code: toConfidence(dto.code),
      description: toConfidence(dto.description),
      quantity: toConfidence(dto.quantity),
      unitCostNet: toConfidence(dto.unitCostNet),
      discountTotal: toConfidence(dto.discountTotal),
      taxRate: toConfidence(dto.taxRate),
      total: toConfidence(dto.total),
    });
  }
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function normalizeText(value: string | undefined, maxLength: number) {
  if (!value) return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizeMessages(values: string[], maxItems: number) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value, 250))
        .filter((value): value is string => Boolean(value)),
    ),
  ).slice(0, maxItems);
}

function safeNumber(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toConfidence(value: string | undefined): OcrConfidence | undefined {
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined;
}
