import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentType, TaxIdentityContextType } from '@qorvex/database';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCustomerDto } from '../src/modules/customers/dto/create-customer.dto';
import { CreateSupplierDto } from '../src/modules/suppliers/dto/create-supplier.dto';
import { CreateTaxIdentityApprovalRequestDto } from '../src/modules/tax-identities/dto/create-tax-identity-approval-request.dto';
import {
  ApproveTaxIdentityApprovalRequestDto,
  RejectTaxIdentityApprovalRequestDto,
} from '../src/modules/tax-identities/dto/decide-tax-identity-approval-request.dto';

const strictValidation = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

test('manual identity request accepts only the cashier-provided minimum fields', async () => {
  const dto = plainToInstance(CreateTaxIdentityApprovalRequestDto, {
    contextType: TaxIdentityContextType.POS_ORDER,
    contextId: 'order-preview-1',
    documentType: DocumentType.RNC,
    documentNumber: '101850043',
    fiscalName: 'Empresa validada manualmente',
    reason: 'No aparece en el padrón local.',
  });

  assert.deepEqual(await validate(dto, strictValidation), []);
});

test('manual identity request rejects every non-POS context', async () => {
  const nonPosContexts = [
    TaxIdentityContextType.CUSTOMER,
    TaxIdentityContextType.SUPPLIER,
    TaxIdentityContextType.CUSTOMER_CREATE,
    TaxIdentityContextType.SUPPLIER_CREATE,
  ];

  for (const contextType of nonPosContexts) {
    const dto = plainToInstance(CreateTaxIdentityApprovalRequestDto, {
      contextType,
      contextId: 'managed-record-preview-1',
      documentType: DocumentType.RNC,
      documentNumber: '101850043',
      fiscalName: 'Identidad administrada directamente',
    });

    const errors = await validate(dto, strictValidation);
    assert.equal(
      errors.some((error) => error.property === 'contextType'),
      true,
      `${contextType} must not be accepted by the asynchronous approval DTO`,
    );
  }
});

test('manual identity request rejects client-supplied registry evidence and credentials', async () => {
  const dto = plainToInstance(CreateTaxIdentityApprovalRequestDto, {
    contextType: TaxIdentityContextType.POS_ORDER,
    contextId: 'order-preview-1',
    documentType: DocumentType.RNC,
    documentNumber: '101850043',
    fiscalName: 'Empresa no verificada',
    registryOutcome: 'NOT_FOUND',
    supervisorEmail: 'admin@rivnu.local',
    supervisorPassword: 'not-accepted',
  });

  const errors = await validate(dto, strictValidation);
  assert.equal(
    errors.some((error) => error.property === 'registryOutcome'),
    true,
  );
  assert.equal(
    errors.some((error) => error.property === 'supervisorEmail'),
    true,
  );
  assert.equal(
    errors.some((error) => error.property === 'supervisorPassword'),
    true,
  );
});

test('managed Customer and Supplier DTOs accept an explicit boolean manual confirmation', async () => {
  const customer = plainToInstance(CreateCustomerDto, {
    name: 'Cliente no encontrado',
    documentType: DocumentType.CEDULA,
    documentNumber: '40220429126',
    manualTaxIdentityConfirmed: true,
  });
  const supplier = plainToInstance(CreateSupplierDto, {
    commercialName: 'Suplidor no encontrado',
    legalName: 'Suplidor no encontrado SRL',
    documentType: DocumentType.RNC,
    documentNumber: '131880681',
    manualTaxIdentityConfirmed: true,
  });

  assert.deepEqual(await validate(customer, strictValidation), []);
  assert.deepEqual(await validate(supplier, strictValidation), []);
});

test('managed Customer and Supplier DTOs reject legacy override fields', async () => {
  const legacyFields = {
    taxIdentityOverrideId: 'override-from-old-flow',
    taxIdentityContextId: 'managed-record-old-context',
  };
  const customer = plainToInstance(CreateCustomerDto, {
    name: 'Cliente no encontrado',
    documentType: DocumentType.CEDULA,
    documentNumber: '40220429126',
    manualTaxIdentityConfirmed: true,
    ...legacyFields,
  });
  const supplier = plainToInstance(CreateSupplierDto, {
    commercialName: 'Suplidor no encontrado',
    legalName: 'Suplidor no encontrado SRL',
    documentType: DocumentType.RNC,
    documentNumber: '131880681',
    manualTaxIdentityConfirmed: true,
    ...legacyFields,
  });

  for (const errors of [
    await validate(customer, strictValidation),
    await validate(supplier, strictValidation),
  ]) {
    assert.equal(
      errors.some((error) => error.property === 'taxIdentityOverrideId'),
      true,
    );
    assert.equal(
      errors.some((error) => error.property === 'taxIdentityContextId'),
      true,
    );
  }
});

test('administrator may correct the fiscal name and choose a short override lifetime', async () => {
  const dto = plainToInstance(ApproveTaxIdentityApprovalRequestDto, {
    fiscalName: 'Razón social corregida por administración',
    decisionNote: 'Documento físico revisado.',
    expiresInMinutes: 10,
  });

  assert.deepEqual(await validate(dto, strictValidation), []);
});

test('rejection requires an explanatory decision note', async () => {
  const dto = plainToInstance(RejectTaxIdentityApprovalRequestDto, {
    decisionNote: '',
  });

  const errors = await validate(dto, strictValidation);
  assert.equal(
    errors.some((error) => error.property === 'decisionNote'),
    true,
  );
});
