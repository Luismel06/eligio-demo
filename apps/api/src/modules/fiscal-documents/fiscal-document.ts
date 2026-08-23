import { BadRequestException } from '@nestjs/common';
import {
  DocumentType,
  FiscalDocumentPurpose,
  FiscalIssuanceMode,
  InvoiceDocumentType,
} from '@qorvex/database';
import {
  normalizeDominicanDocument,
  validateDominicanDocument,
} from '../../common/utils/dominican-documents';

export const SALES_FISCAL_DOCUMENT_TYPES = [
  InvoiceDocumentType.CONSUMER_02,
  InvoiceDocumentType.FISCAL_CREDIT_01,
  InvoiceDocumentType.CONSUMER_ELECTRONIC_32,
  InvoiceDocumentType.FISCAL_CREDIT_ELECTRONIC_31,
] as const;

export type SalesFiscalDocumentType = (typeof SALES_FISCAL_DOCUMENT_TYPES)[number];

export type FiscalCustomerSnapshot = {
  /** Null identifies a one-time POS identity that is not a Customer row. */
  id: string | null;
  /** Canonical fiscal name used on the issued invoice. */
  name: string;
  /** Free-form name captured by Order Taking; never replaces the fiscal name. */
  operationalName?: string;
  documentType: Extract<DocumentType, 'RNC' | 'CEDULA' | 'PASSPORT'>;
  documentNumber: string;
  verification?: FiscalCustomerVerification;
};

export type FiscalCustomerVerification = {
  outcome: 'VERIFIED' | 'MANUAL_OVERRIDE';
  source: string;
  sourceUpdatedAt: string | null;
  verifiedAt: string;
  registryStatus: string | null;
  overrideId?: string;
};

export type UsableFiscalIdentity = {
  outcome: 'VERIFIED' | 'MANUAL_OVERRIDE';
  documentType: Extract<DocumentType, 'RNC' | 'CEDULA'>;
  documentNumber: string;
  fiscalName: string;
  registryStatus: string | null;
  source: string;
  sourceUpdatedAt: Date | string | null;
  verifiedAt: Date | string;
  overrideId?: string | null;
};

type FiscalCustomerSource = {
  id: string;
  name: string;
  documentType: DocumentType;
  documentNumber: string | null;
};

export function mapFiscalDocumentType(
  purpose: FiscalDocumentPurpose,
  issuanceMode: FiscalIssuanceMode,
): SalesFiscalDocumentType {
  if (issuanceMode === FiscalIssuanceMode.ELECTRONIC_ECF) {
    return purpose === FiscalDocumentPurpose.FISCAL_CREDIT
      ? InvoiceDocumentType.FISCAL_CREDIT_ELECTRONIC_31
      : InvoiceDocumentType.CONSUMER_ELECTRONIC_32;
  }

  return purpose === FiscalDocumentPurpose.FISCAL_CREDIT
    ? InvoiceDocumentType.FISCAL_CREDIT_01
    : InvoiceDocumentType.CONSUMER_02;
}

export function resolveFiscalDocumentType(
  purpose: FiscalDocumentPurpose,
  issuanceMode: FiscalIssuanceMode,
): SalesFiscalDocumentType {
  if (issuanceMode === FiscalIssuanceMode.ELECTRONIC_ECF) {
    throw new BadRequestException(
      'Electronic E31/E32 issuance cannot be enabled until the certified XML signing and DGII submission pipeline is installed.',
    );
  }

  return mapFiscalDocumentType(purpose, issuanceMode);
}

export function isSalesFiscalDocumentType(
  documentType: InvoiceDocumentType,
): documentType is SalesFiscalDocumentType {
  return SALES_FISCAL_DOCUMENT_TYPES.includes(documentType as SalesFiscalDocumentType);
}

export function isFiscalCreditDocumentType(documentType: InvoiceDocumentType) {
  return (
    documentType === InvoiceDocumentType.FISCAL_CREDIT_01 ||
    documentType === InvoiceDocumentType.FISCAL_CREDIT_ELECTRONIC_31
  );
}

export function isElectronicFiscalDocumentType(documentType: InvoiceDocumentType) {
  return (
    documentType === InvoiceDocumentType.CONSUMER_ELECTRONIC_32 ||
    documentType === InvoiceDocumentType.FISCAL_CREDIT_ELECTRONIC_31
  );
}

export function fiscalDocumentTypeMatchesPurpose(
  purpose: FiscalDocumentPurpose,
  documentType: InvoiceDocumentType,
) {
  return isFiscalCreditDocumentType(documentType)
    ? purpose === FiscalDocumentPurpose.FISCAL_CREDIT
    : isSalesFiscalDocumentType(documentType) && purpose === FiscalDocumentPurpose.CONSUMER;
}

export function buildFiscalCustomerSnapshot(
  customer: FiscalCustomerSource | null,
  allowPassport: boolean,
): FiscalCustomerSnapshot | null {
  if (!customer?.id.trim() || !customer.name.trim() || !customer.documentNumber?.trim()) {
    return null;
  }

  if (customer.documentType === DocumentType.RNC || customer.documentType === DocumentType.CEDULA) {
    if (!validateDominicanDocument(customer.documentType, customer.documentNumber)) {
      return null;
    }

    return {
      id: customer.id,
      name: customer.name.trim(),
      documentType: customer.documentType,
      documentNumber: normalizeDominicanDocument(customer.documentNumber),
    };
  }

  if (allowPassport && customer.documentType === DocumentType.PASSPORT) {
    return {
      id: customer.id,
      name: customer.name.trim(),
      documentType: DocumentType.PASSPORT,
      documentNumber: customer.documentNumber.trim(),
    };
  }

  return null;
}

export function buildInlineFiscalCustomerSnapshot(
  operationalName: string | null | undefined,
  identity: UsableFiscalIdentity,
): FiscalCustomerSnapshot | null {
  if (
    !operationalName?.trim() ||
    !identity.fiscalName?.trim() ||
    (identity.documentType !== DocumentType.RNC && identity.documentType !== DocumentType.CEDULA) ||
    !identity.documentNumber?.trim() ||
    !validateDominicanDocument(identity.documentType, identity.documentNumber)
  ) {
    return null;
  }

  return {
    id: null,
    name: identity.fiscalName.trim(),
    operationalName: operationalName.trim(),
    documentType: identity.documentType,
    documentNumber: normalizeDominicanDocument(identity.documentNumber),
    verification: {
      outcome: identity.outcome,
      source: identity.source,
      sourceUpdatedAt: toIsoString(identity.sourceUpdatedAt),
      verifiedAt: toIsoString(identity.verifiedAt)!,
      registryStatus: identity.registryStatus,
      ...(identity.overrideId ? { overrideId: identity.overrideId } : {}),
    },
  };
}

export function readFiscalCustomerSnapshot(value: unknown): FiscalCustomerSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const snapshot = value as Record<string, unknown>;
  const rawId = snapshot.id;
  if (
    (rawId !== undefined && rawId !== null && (typeof rawId !== 'string' || !rawId.trim())) ||
    typeof snapshot.name !== 'string' ||
    typeof snapshot.documentNumber !== 'string' ||
    !snapshot.name.trim() ||
    !snapshot.documentNumber.trim()
  ) {
    return null;
  }

  const documentType = snapshot.documentType;
  if (documentType !== DocumentType.PASSPORT) {
    if (documentType !== DocumentType.RNC && documentType !== DocumentType.CEDULA) {
      return null;
    }
    if (!validateDominicanDocument(documentType, snapshot.documentNumber)) {
      return null;
    }
  }

  const verification = readFiscalCustomerVerification(snapshot.verification);
  const operationalName =
    typeof snapshot.operationalName === 'string' && snapshot.operationalName.trim()
      ? snapshot.operationalName.trim()
      : undefined;

  return {
    id: typeof rawId === 'string' ? rawId.trim() : null,
    name: snapshot.name.trim(),
    ...(operationalName ? { operationalName } : {}),
    documentType,
    documentNumber:
      documentType === DocumentType.RNC || documentType === DocumentType.CEDULA
        ? normalizeDominicanDocument(snapshot.documentNumber)
        : snapshot.documentNumber.trim(),
    ...(verification ? { verification } : {}),
  };
}

function readFiscalCustomerVerification(value: unknown): FiscalCustomerVerification | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const verification = value as Record<string, unknown>;
  if (
    (verification.outcome !== 'VERIFIED' && verification.outcome !== 'MANUAL_OVERRIDE') ||
    typeof verification.source !== 'string' ||
    !verification.source.trim() ||
    typeof verification.verifiedAt !== 'string' ||
    !isIsoDate(verification.verifiedAt) ||
    (verification.sourceUpdatedAt !== null &&
      verification.sourceUpdatedAt !== undefined &&
      (typeof verification.sourceUpdatedAt !== 'string' ||
        !isIsoDate(verification.sourceUpdatedAt))) ||
    (verification.registryStatus !== null &&
      verification.registryStatus !== undefined &&
      typeof verification.registryStatus !== 'string') ||
    (verification.overrideId !== undefined &&
      (typeof verification.overrideId !== 'string' || !verification.overrideId.trim()))
  ) {
    return undefined;
  }

  return {
    outcome: verification.outcome,
    source: verification.source.trim(),
    sourceUpdatedAt:
      typeof verification.sourceUpdatedAt === 'string'
        ? new Date(verification.sourceUpdatedAt).toISOString()
        : null,
    verifiedAt: new Date(verification.verifiedAt).toISOString(),
    registryStatus:
      typeof verification.registryStatus === 'string'
        ? verification.registryStatus.trim() || null
        : null,
    ...(typeof verification.overrideId === 'string'
      ? { overrideId: verification.overrideId.trim() }
      : {}),
  };
}

function toIsoString(value: Date | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isIsoDate(value: string) {
  return !Number.isNaN(new Date(value).getTime());
}
