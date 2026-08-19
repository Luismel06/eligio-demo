import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentType, FiscalDocumentPurpose } from '@qorvex/database';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdatePosFiscalDetailsDto } from '../src/modules/pos/dto/update-pos-fiscal-details.dto';

const strictValidation = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

test('POS fiscal update accepts an explicit null customer for B02', async () => {
  const dto = plainToInstance(UpdatePosFiscalDetailsDto, {
    fiscalPurpose: FiscalDocumentPurpose.CONSUMER,
    customerId: null,
  });

  assert.deepEqual(await validate(dto, strictValidation), []);
  assert.equal(Object.prototype.hasOwnProperty.call(dto, 'customerId'), true);
});

test('POS fiscal update rejects client-selected invoice document types', async () => {
  const dto = plainToInstance(UpdatePosFiscalDetailsDto, {
    fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
    customerId: 'customer-1',
    documentType: 'FISCAL_CREDIT_01',
  });

  const errors = await validate(dto, strictValidation);

  assert.equal(
    errors.some((error) => error.property === 'documentType'),
    true,
  );
});

test('POS fiscal update rejects an unknown purpose enum', async () => {
  const dto = plainToInstance(UpdatePosFiscalDetailsDto, {
    fiscalPurpose: 'FISCAL_CREDIT_CUSTOM',
    customerId: 'customer-1',
  });

  const errors = await validate(dto, strictValidation);

  assert.equal(
    errors.some((error) => error.property === 'fiscalPurpose'),
    true,
  );
});

test('POS fiscal update accepts a one-time RNC without a Customer id', async () => {
  const dto = plainToInstance(UpdatePosFiscalDetailsDto, {
    fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
    customerId: null,
    documentType: DocumentType.RNC,
    documentNumber: '1-01-85004-3',
  });

  assert.deepEqual(await validate(dto, strictValidation), []);
});

test('POS fiscal update only accepts RNC or Dominican ID for inline identity', async () => {
  const dto = plainToInstance(UpdatePosFiscalDetailsDto, {
    fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
    customerId: null,
    documentType: DocumentType.PASSPORT,
    documentNumber: 'PA1234567',
  });

  const errors = await validate(dto, strictValidation);
  assert.equal(
    errors.some((error) => error.property === 'documentType'),
    true,
  );
});

test('POS fiscal update cannot override the client name captured by the order', async () => {
  const dto = plainToInstance(UpdatePosFiscalDetailsDto, {
    fiscalPurpose: FiscalDocumentPurpose.FISCAL_CREDIT,
    documentType: DocumentType.RNC,
    documentNumber: '101850043',
    name: 'Nombre inyectado desde Caja',
  });

  const errors = await validate(dto, strictValidation);
  assert.equal(
    errors.some((error) => error.property === 'name'),
    true,
  );
});
