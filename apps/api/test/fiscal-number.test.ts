import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { InvoiceDocumentType } from '@qorvex/database';
import {
  formatLocalNcf,
  isNcfExpirationPast,
  parseNcfExpirationDate,
} from '../src/modules/fiscal-sequences/fiscal-number';

test('formats the first and last valid local B01/B02 numbers', () => {
  assert.equal(formatLocalNcf(InvoiceDocumentType.FISCAL_CREDIT_01, 'B01', 1), 'B0100000001');
  assert.equal(formatLocalNcf(InvoiceDocumentType.CONSUMER_02, 'B02', 99_999_999), 'B0299999999');
});

test('rejects a prefix that does not belong to the document type', () => {
  assert.throws(
    () => formatLocalNcf(InvoiceDocumentType.FISCAL_CREDIT_01, 'B02', 1),
    BadRequestException,
  );
  assert.throws(
    () => formatLocalNcf(InvoiceDocumentType.CONSUMER_02, 'BA', 1),
    BadRequestException,
  );
});

test('rejects sequence numbers outside the eight-digit local NCF range', () => {
  for (const invalidNumber of [0, 1.5, 100_000_000]) {
    assert.throws(
      () => formatLocalNcf(InvoiceDocumentType.CONSUMER_02, 'B02', invalidNumber),
      BadRequestException,
    );
  }
});

test('rejects malformed and impossible expiration dates', () => {
  for (const invalidDate of ['15-04-2030', '2031-02-29', '2030-13-01']) {
    assert.throws(() => parseNcfExpirationDate(invalidDate), BadRequestException);
  }
});

test('parses a valid expiration as a date-only UTC value', () => {
  assert.equal(parseNcfExpirationDate('2030-04-15')?.toISOString(), '2030-04-15T00:00:00.000Z');
  assert.equal(parseNcfExpirationDate(), null);
});

test('expires only after the authorized Dominican business date ends', () => {
  const validUntil = parseNcfExpirationDate('2030-04-15');
  assert.ok(validUntil);

  assert.equal(isNcfExpirationPast(validUntil, new Date('2030-04-16T03:59:59.999Z')), false);
  assert.equal(isNcfExpirationPast(validUntil, new Date('2030-04-16T04:00:00.000Z')), true);
});
