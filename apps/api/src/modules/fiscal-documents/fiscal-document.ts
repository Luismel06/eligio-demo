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
  name: string;
  documentType: Extract<DocumentType, 'RNC' | 'CEDULA' | 'PASSPORT'>;
  documentNumber: string;
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
  name: string | null | undefined,
  documentType: DocumentType,
  documentNumber: string | null | undefined,
): FiscalCustomerSnapshot | null {
  if (
    !name?.trim() ||
    (documentType !== DocumentType.RNC && documentType !== DocumentType.CEDULA) ||
    !documentNumber?.trim() ||
    !validateDominicanDocument(documentType, documentNumber)
  ) {
    return null;
  }

  return {
    id: null,
    name: name.trim(),
    documentType,
    documentNumber: normalizeDominicanDocument(documentNumber),
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

  return {
    id: typeof rawId === 'string' ? rawId.trim() : null,
    name: snapshot.name.trim(),
    documentType,
    documentNumber:
      documentType === DocumentType.RNC || documentType === DocumentType.CEDULA
        ? normalizeDominicanDocument(snapshot.documentNumber)
        : snapshot.documentNumber.trim(),
  };
}
