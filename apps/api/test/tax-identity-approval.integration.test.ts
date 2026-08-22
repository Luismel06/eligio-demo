import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CashSessionStatus,
  DgiiRegistryDatasetStatus,
  DgiiRegistrySource,
  DocumentType,
  Role,
  SalesOrderStatus,
  TaxIdentityContextType,
} from '@qorvex/database';
import type { AuthenticatedUser } from '../src/common/types/authenticated-request';
import { PrismaService } from '../src/prisma/prisma.service';
import { TaxIdentitiesService } from '../src/modules/tax-identities/tax-identities.service';

const databaseUrl = process.env.TAX_IDENTITY_INTEGRATION_DATABASE_URL;

function assertIsolatedIntegrationDatabase(rawUrl: string) {
  assert.equal(
    process.env.NODE_ENV,
    'test',
    'NODE_ENV=test must be set before starting this integration test.',
  );
  assert.equal(
    process.env.TAX_IDENTITY_INTEGRATION_CONFIRM,
    'isolated-tax-identity-test',
    'The isolated integration-test confirmation marker is required.',
  );
  const parsed = new URL(rawUrl);
  assert.equal(parsed.protocol, 'postgresql:');
  assert.ok(
    parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost',
    'Only a loopback PostgreSQL test database is allowed.',
  );
  assert.equal(parsed.pathname, '/rivnu_tax_identity_test');
}

test(
  'manual identity requests are idempotent and produce one single-use override',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl);
    assertIsolatedIntegrationDatabase(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.DIRECT_URL = databaseUrl;

    const prisma = new PrismaService();
    const config = new ConfigService({
      TAX_IDENTITY_HMAC_SECRET: 'integration-test-tax-identity-key-32-bytes-minimum',
      DGII_REGISTRY_MAX_AGE_HOURS: '216',
      TAX_IDENTITY_APPROVAL_REQUEST_TTL_MINUTES: '30',
    });
    const service = new TaxIdentitiesService(prisma, config);
    let tenantId: string | undefined;
    let cashierId: string | undefined;
    let administratorId: string | undefined;
    let datasetId: string | undefined;

    try {
      const tenant = await prisma.tenant.create({
        data: { name: 'Tax approval test', slug: `tax-approval-${Date.now()}` },
      });
      tenantId = tenant.id;
      const cashier = await prisma.user.create({
        data: { email: `cashier-${Date.now()}@test.local`, name: 'Cajero de prueba' },
      });
      cashierId = cashier.id;
      const administrator = await prisma.user.create({
        data: { email: `admin-${Date.now()}@test.local`, name: 'Administrador de prueba' },
      });
      administratorId = administrator.id;
      const cashierMembership = await prisma.membership.create({
        data: {
          tenantId: tenant.id,
          userId: cashier.id,
          role: Role.CASHIER,
          canUsePos: true,
          canOpenCashSession: true,
        },
      });
      const administratorMembership = await prisma.membership.create({
        data: {
          tenantId: tenant.id,
          userId: administrator.id,
          role: Role.ADMIN,
        },
      });
      const cashRegister = await prisma.cashRegister.create({
        data: { tenantId: tenant.id, name: 'Caja de prueba' },
      });
      const cashSession = await prisma.cashSession.create({
        data: {
          tenantId: tenant.id,
          cashRegisterId: cashRegister.id,
          openedById: cashier.id,
          status: CashSessionStatus.OPEN,
        },
      });
      const order = await prisma.salesOrder.create({
        data: {
          tenantId: tenant.id,
          orderNumber: `TEST-${Date.now()}`,
          status: SalesOrderStatus.IN_CASHIER,
          clientName: 'Nombre operativo de prueba',
          createdById: cashier.id,
          claimedById: cashier.id,
          claimedCashSessionId: cashSession.id,
          claimedAt: new Date(),
          claimExpiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });
      const dataset = await prisma.dgiiRegistryDataset.create({
        data: {
          version: `test-${Date.now()}`,
          source: DgiiRegistrySource.TEST_FIXTURE,
          status: DgiiRegistryDatasetStatus.ACTIVE,
          sourceUpdatedAt: new Date(),
          importedAt: new Date(),
          activatedAt: new Date(),
        },
      });
      datasetId = dataset.id;

      const cashierUser = {
        id: cashier.id,
        email: cashier.email,
        name: cashier.name,
        status: cashier.status,
        memberships: [cashierMembership],
      } as AuthenticatedUser;
      const administratorUser = {
        id: administrator.id,
        email: administrator.email,
        name: administrator.name,
        status: administrator.status,
        memberships: [administratorMembership],
      } as AuthenticatedUser;
      const createInput = {
        contextType: TaxIdentityContextType.POS_ORDER,
        contextId: order.id,
        documentType: DocumentType.RNC,
        documentNumber: '101850043',
        fiscalName: 'Nombre fiscal introducido manualmente',
        reason: 'Documento no encontrado en el padrón de prueba.',
      };

      const [firstRequest, repeatedRequest] = await Promise.all([
        service.createApprovalRequest(tenant.id, cashierUser, createInput),
        service.createApprovalRequest(tenant.id, cashierUser, createInput),
      ]);
      assert.equal(repeatedRequest.id, firstRequest.id);
      assert.equal(firstRequest.status, 'PENDING');
      await assert.rejects(
        () =>
          service.approveApprovalRequest(tenant.id, cashierUser, firstRequest.id, {
            decisionNote: 'Un cajero no puede decidir su propia solicitud.',
          }),
        ForbiddenException,
      );

      const [firstApproval, repeatedApproval] = await Promise.all([
        service.approveApprovalRequest(tenant.id, administratorUser, firstRequest.id, {
          decisionNote: 'Documento físico revisado.',
          expiresInMinutes: 10,
        }),
        service.approveApprovalRequest(tenant.id, administratorUser, firstRequest.id, {
          decisionNote: 'Documento físico revisado.',
          expiresInMinutes: 10,
        }),
      ]);
      assert.equal(firstApproval.status, 'APPROVED');
      assert.equal(repeatedApproval.override?.overrideId, firstApproval.override?.overrideId);
      assert.equal(await prisma.taxIdentityOverride.count({ where: { tenantId: tenant.id } }), 1);

      const overrideId = firstApproval.override?.overrideId;
      assert.ok(overrideId);
      const verification = await prisma.$transaction((tx) =>
        service.requireUsableIdentity(
          {
            tenantId: tenant.id,
            contextType: TaxIdentityContextType.POS_ORDER,
            contextId: order.id,
            documentType: DocumentType.RNC,
            documentNumber: '101850043',
            overrideId,
          },
          { db: tx, consumeOverride: true },
        ),
      );
      assert.equal(verification.source, 'MANUAL_OVERRIDE');
      await assert.rejects(
        () =>
          prisma.$transaction((tx) =>
            service.requireUsableIdentity(
              {
                tenantId: tenant.id,
                contextType: TaxIdentityContextType.POS_ORDER,
                contextId: order.id,
                documentType: DocumentType.RNC,
                documentNumber: '101850043',
                overrideId,
              },
              { db: tx, consumeOverride: true },
            ),
          ),
        ConflictException,
      );

      await assert.rejects(
        () =>
          service.createApprovalRequest(tenant.id, cashierUser, {
            ...createInput,
            documentNumber: '101850044',
          }),
        BadRequestException,
      );

      const replacementRequest = await service.createApprovalRequest(
        tenant.id,
        cashierUser,
        createInput,
      );
      assert.equal(replacementRequest.status, 'PENDING');
      await prisma.salesOrder.update({
        where: { id: order.id },
        data: { claimExpiresAt: new Date(Date.now() - 60_000) },
      });
      await assert.rejects(
        () =>
          service.approveApprovalRequest(tenant.id, administratorUser, replacementRequest.id, {
            decisionNote: 'Esta aprobación no debe materializarse.',
          }),
        ConflictException,
      );
      const cancelledRequest = await service.getApprovalRequest(
        tenant.id,
        administratorUser,
        replacementRequest.id,
      );
      assert.equal(cancelledRequest.status, 'CANCELLED');
      assert.equal(await prisma.taxIdentityOverride.count({ where: { tenantId: tenant.id } }), 1);
    } finally {
      const cleanupErrors: unknown[] = [];
      try {
        if (tenantId) {
          await prisma.auditLog.deleteMany({ where: { tenantId } });
          await prisma.tenant.deleteMany({ where: { id: tenantId } });
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        if (cashierId || administratorId) {
          await prisma.user.deleteMany({
            where: { id: { in: [cashierId, administratorId].filter(Boolean) as string[] } },
          });
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
      try {
        if (datasetId) {
          await prisma.dgiiRegistryDataset.deleteMany({ where: { id: datasetId } });
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
      await prisma.$disconnect();
      if (cleanupErrors.length) {
        throw new AggregateError(cleanupErrors, 'The isolated integration test cleanup failed.');
      }
    }
  },
);
