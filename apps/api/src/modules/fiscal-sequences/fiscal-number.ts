import { BadRequestException } from '@nestjs/common';
import { InvoiceDocumentType } from '@qorvex/database';
import { businessDateKey } from '../../common/utils/business-date';

export const LOCAL_NCF_DOCUMENT_TYPES = [
  InvoiceDocumentType.CONSUMER_02,
  InvoiceDocumentType.FISCAL_CREDIT_01,
] as const;

export function isLocalNcfDocumentType(
  documentType: InvoiceDocumentType,
): documentType is (typeof LOCAL_NCF_DOCUMENT_TYPES)[number] {
  return LOCAL_NCF_DOCUMENT_TYPES.includes(
    documentType as (typeof LOCAL_NCF_DOCUMENT_TYPES)[number],
  );
}

export function isFiscalCreditNcf(documentType: InvoiceDocumentType) {
  return documentType === InvoiceDocumentType.FISCAL_CREDIT_01;
}

export function expectedLocalNcfPrefix(documentType: InvoiceDocumentType) {
  if (documentType === InvoiceDocumentType.CONSUMER_02) {
    return 'B02';
  }

  if (documentType === InvoiceDocumentType.FISCAL_CREDIT_01) {
    return 'B01';
  }

  throw new BadRequestException('Only local B01 and B02 fiscal documents are enabled.');
}

export function formatLocalNcf(documentType: InvoiceDocumentType, prefix: string, number: number) {
  const expectedPrefix = expectedLocalNcfPrefix(documentType);

  if (prefix !== expectedPrefix) {
    throw new BadRequestException(
      `Fiscal sequence prefix ${prefix} does not match ${expectedPrefix}.`,
    );
  }

  if (!Number.isInteger(number) || number < 1 || number > 99_999_999) {
    throw new BadRequestException('Fiscal sequence number must be between 1 and 99,999,999.');
  }

  return `${prefix}${String(number).padStart(8, '0')}`;
}

export function parseNcfExpirationDate(value?: string) {
  if (!value) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Fiscal expiration must use YYYY-MM-DD.');
  }

  const [year, month, day] = value.split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) {
    throw new BadRequestException('Fiscal expiration date is invalid.');
  }

  return new Date(Date.UTC(year, month - 1, day));
}

export function currentBusinessDate(now = new Date()) {
  return new Date(`${businessDateKey(now)}T00:00:00.000Z`);
}

export function isNcfExpirationPast(validUntil: Date, now = new Date()) {
  return validUntil.toISOString().slice(0, 10) < businessDateKey(now);
}
