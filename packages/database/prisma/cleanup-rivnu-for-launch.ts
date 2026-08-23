import { PrismaClient } from '../generated/client';

const prisma = new PrismaClient();

const tenantSlug = process.env.CLEAN_TENANT_SLUG ?? 'ferreteria-rivnu';
const confirmation = process.env.CONFIRM_CLEAN_RIVNU;
const execute = process.argv.includes('--execute');
const resetFiscalSequences = !process.argv.includes('--keep-fiscal-next');

const preservedEmails = [
  'caja@rivnu.local',
  'facturacion2@rivnu.local',
  'ramon@rivnu.local',
  'starlin@rivnu.local',
];

const protectedModels = [
  'Tenant',
  'CompanyBranding',
  'CashRegister',
  'User',
  'Membership',
  'EmployeeProfile',
];

async function main() {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    include: {
      memberships: {
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      },
    },
  });

  if (!tenant) {
    throw new Error(`Tenant ${tenantSlug} was not found.`);
  }

  const preservedUsers = await prisma.user.findMany({
    where: { email: { in: preservedEmails } },
    include: {
      memberships: { where: { tenantId: tenant.id } },
      employeeProfiles: { where: { tenantId: tenant.id } },
    },
    orderBy: { email: 'asc' },
  });
  const foundEmails = new Set(preservedUsers.map((user) => user.email));
  const missingEmails = preservedEmails.filter((email) => !foundEmails.has(email));

  if (missingEmails.length) {
    throw new Error(`Missing preserved users: ${missingEmails.join(', ')}`);
  }

  const preservedUserIds = preservedUsers.map((user) => user.id);
  const counts = await getCleanupCounts(tenant.id, preservedUserIds);

  printPlan(counts);
  printPreservedUsers(preservedUsers);

  if (!execute) {
    console.log('');
    console.log('Dry-run only. No data was deleted.');
    console.log(
      "To execute in PowerShell: $env:CONFIRM_CLEAN_RIVNU='ferreteria-rivnu'; pnpm db:cleanup:rivnu -- --execute",
    );
    return;
  }

  if (confirmation !== tenantSlug) {
    throw new Error(
      `Refusing to clean data. Set CONFIRM_CLEAN_RIVNU=${tenantSlug} and pass --execute.`,
    );
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.taxIdentityApprovalRequest.deleteMany({ where: { tenantId: tenant.id } });
      await tx.taxIdentityOverride.deleteMany({ where: { tenantId: tenant.id } });
      await tx.returnRequest.deleteMany({ where: { tenantId: tenant.id } });
      await tx.employeeActivityLog.deleteMany({ where: { tenantId: tenant.id } });
      await tx.cashMovement.deleteMany({ where: { tenantId: tenant.id } });
      await tx.payment.deleteMany({ where: { tenantId: tenant.id } });
      await tx.electronicDocument.deleteMany({ where: { tenantId: tenant.id } });
      await tx.inventoryMovement.deleteMany({ where: { tenantId: tenant.id } });
      await tx.salesOrder.deleteMany({ where: { tenantId: tenant.id } });
      await tx.invoice.deleteMany({ where: { tenantId: tenant.id } });
      await tx.cashSession.deleteMany({ where: { tenantId: tenant.id } });
      await tx.importBatch.deleteMany({ where: { tenantId: tenant.id } });
      await tx.auditLog.deleteMany({ where: { tenantId: tenant.id } });
      await tx.customer.deleteMany({ where: { tenantId: tenant.id } });
      await tx.product.deleteMany({ where: { tenantId: tenant.id } });
      await tx.productCategory.deleteMany({ where: { tenantId: tenant.id } });

      if (resetFiscalSequences) {
        const sequences = await tx.fiscalSequence.findMany({
          where: { tenantId: tenant.id },
          select: { id: true, startNumber: true },
        });

        for (const sequence of sequences) {
          await tx.fiscalSequence.update({
            where: { id: sequence.id },
            data: { nextNumber: sequence.startNumber },
          });
        }
      }

      await tx.employeeProfile.deleteMany({
        where: {
          tenantId: tenant.id,
          userId: { notIn: preservedUserIds },
        },
      });
      await tx.membership.deleteMany({
        where: {
          tenantId: tenant.id,
          userId: { notIn: preservedUserIds },
        },
      });

      await tx.auditLog.deleteMany({
        where: {
          userId: { notIn: preservedUserIds },
          user: { memberships: { none: {} } },
        },
      });
      await tx.user.deleteMany({
        where: {
          id: { notIn: preservedUserIds },
          memberships: { none: {} },
        },
      });
    },
    { maxWait: 20_000, timeout: 120_000 },
  );

  const afterCounts = await getCleanupCounts(tenant.id, preservedUserIds);
  console.log('');
  console.log('Cleanup executed successfully.');
  printPlan(afterCounts);
}

async function getCleanupCounts(tenantId: string, preservedUserIds: string[]) {
  const [
    taxIdentityApprovalRequests,
    taxIdentityOverrides,
    returnRequests,
    employeeActivityLogs,
    cashMovements,
    payments,
    electronicDocuments,
    inventoryMovements,
    salesOrders,
    invoices,
    cashSessions,
    importBatches,
    auditLogs,
    customers,
    products,
    productCategories,
    fiscalSequences,
    cashRegisters,
    preservedMemberships,
    preservedEmployeeProfiles,
    removableMemberships,
    removableEmployeeProfiles,
    removableUsers,
  ] = await Promise.all([
    prisma.taxIdentityApprovalRequest.count({ where: { tenantId } }),
    prisma.taxIdentityOverride.count({ where: { tenantId } }),
    prisma.returnRequest.count({ where: { tenantId } }),
    prisma.employeeActivityLog.count({ where: { tenantId } }),
    prisma.cashMovement.count({ where: { tenantId } }),
    prisma.payment.count({ where: { tenantId } }),
    prisma.electronicDocument.count({ where: { tenantId } }),
    prisma.inventoryMovement.count({ where: { tenantId } }),
    prisma.salesOrder.count({ where: { tenantId } }),
    prisma.invoice.count({ where: { tenantId } }),
    prisma.cashSession.count({ where: { tenantId } }),
    prisma.importBatch.count({ where: { tenantId } }),
    prisma.auditLog.count({ where: { tenantId } }),
    prisma.customer.count({ where: { tenantId } }),
    prisma.product.count({ where: { tenantId } }),
    prisma.productCategory.count({ where: { tenantId } }),
    prisma.fiscalSequence.count({ where: { tenantId } }),
    prisma.cashRegister.count({ where: { tenantId } }),
    prisma.membership.count({
      where: { tenantId, userId: { in: preservedUserIds } },
    }),
    prisma.employeeProfile.count({
      where: { tenantId, userId: { in: preservedUserIds } },
    }),
    prisma.membership.count({
      where: { tenantId, userId: { notIn: preservedUserIds } },
    }),
    prisma.employeeProfile.count({
      where: { tenantId, userId: { notIn: preservedUserIds } },
    }),
    prisma.user.count({
      where: {
        id: { notIn: preservedUserIds },
        memberships: { every: { tenantId } },
      },
    }),
  ]);

  return {
    delete: {
      taxIdentityApprovalRequests,
      taxIdentityOverrides,
      returnRequests,
      employeeActivityLogs,
      cashMovements,
      payments,
      electronicDocuments,
      inventoryMovements,
      salesOrders,
      invoices,
      cashSessions,
      importBatches,
      auditLogs,
      customers,
      products,
      productCategories,
      removableMemberships,
      removableEmployeeProfiles,
      removableUsers,
    },
    preserve: {
      protectedModels,
      cashRegisters,
      fiscalSequences,
      preservedMemberships,
      preservedEmployeeProfiles,
      users: preservedEmails.length,
    },
  };
}

function printPlan(counts: Awaited<ReturnType<typeof getCleanupCounts>>) {
  console.log('');
  console.log(`RIVNU launch cleanup plan for tenant: ${tenantSlug}`);
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  console.log(
    `Fiscal sequences: ${resetFiscalSequences ? 'reset nextNumber to startNumber' : 'keep current nextNumber'}`,
  );
  console.log('');
  console.log('Will delete/reset tenant data:');
  for (const [key, value] of Object.entries(counts.delete)) {
    console.log(`- ${key}: ${value}`);
  }
  console.log('');
  console.log('Will preserve:');
  for (const [key, value] of Object.entries(counts.preserve)) {
    console.log(`- ${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
  }
}

function printPreservedUsers(users: Awaited<ReturnType<typeof prisma.user.findMany>>) {
  console.log('');
  console.log('Preserved user accounts:');
  for (const user of users) {
    const membership = user.memberships[0];
    const employeeProfile = user.employeeProfiles[0];
    console.log(
      `- ${user.email} | role=${membership?.role ?? 'NO_MEMBERSHIP'} | employeeProfile=${employeeProfile ? 'yes' : 'no'}`,
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
