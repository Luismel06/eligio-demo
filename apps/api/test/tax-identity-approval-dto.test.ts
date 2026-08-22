import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentType, TaxIdentityContextType } from '@qorvex/database';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
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
