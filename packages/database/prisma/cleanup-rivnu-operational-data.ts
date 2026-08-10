import { PrismaClient } from '../generated/client';

const prisma = new PrismaClient();

const RIVNU_TENANT_SLUG = 'ferreteria-rivnu';
const execute = process.argv.includes('--execute');
const requestedTenantSlug = getArgumentValue('--tenant');
const confirmation = getArgumentValue('--confirm');
const backupMarker = getArgumentValue('--backup-marker');

type CleanupCounts = {
  returnRequestItems: number;
  returnRequests: number;
  creditSaleApprovals: number;
  salesOrderItems: number;
  salesOrders: number;
  invoiceItems: number;
  invoices: number;
  payments: number;
  electronicDocuments: number;
  inventoryMovements: number;
  supplierInvoiceAttachments: number;
  mobileOcrCaptureSessions: number;
  goodsReceiptItems: number;
  goodsReceipts: number;
  supplierPayments: number;
  supplierInvoiceItems: number;
  supplierInvoices: number;
  purchaseOrderEvents: number;
  purchaseOrderItems: number;
  purchaseOrders: number;
  supplierProducts: number;
  suppliers: number;
  importRowErrors: number;
  importBatchRows: number;
  importBatches: number;
  cashMovements: number;
  cashSessions: number;
  employeeActivityLogs: number;
  auditLogs: number;
  customers: number;
  products: number;
  productCategories: number;
};

type PreservedCounts = {
  tenant: number;
  companyBranding: number;
  cashRegisters: number;
  fiscalSequences: number;
  memberships: number;
  employeeProfiles: number;
  tenantUsers: number;
};

function getArgumentValue(name: string) {
  const inlineArgument = process.argv.find((argument) => argument.startsWith(`${name}=`));
  if (inlineArgument) {
    return inlineArgument.slice(name.length + 1);
  }

  const argumentIndex = process.argv.indexOf(name);
  if (argumentIndex >= 0) {
    return process.argv[argumentIndex + 1];
  }

  return undefined;
}

function printUsage() {
  console.log('Usage:');
  console.log('  corepack pnpm db:cleanup:rivnu:operational -- --tenant=ferreteria-rivnu');
  console.log('');
  console.log('Execute only after reviewing the dry-run:');
  console.log(
    '  corepack pnpm db:cleanup:rivnu:operational -- --tenant=ferreteria-rivnu --confirm=ferreteria-rivnu --backup-marker="backup-verificado" --execute',
  );
}

function assertTargetTenant() {
  if (!requestedTenantSlug) {
    throw new Error('Missing required --tenant=ferreteria-rivnu argument.');
  }

  if (requestedTenantSlug !== RIVNU_TENANT_SLUG) {
    throw new Error(`This launch cleanup is permanently restricted to ${RIVNU_TENANT_SLUG}.`);
  }
}

async function getCleanupCounts(tenantId: string): Promise<CleanupCounts> {
  const [
    returnRequestItems,
    returnRequests,
    creditSaleApprovals,
    salesOrderItems,
    salesOrders,
    invoiceItems,
    invoices,
    payments,
    electronicDocuments,
    inventoryMovements,
    supplierInvoiceAttachments,
    mobileOcrCaptureSessions,
    goodsReceiptItems,
    goodsReceipts,
    supplierPayments,
    supplierInvoiceItems,
    supplierInvoices,
    purchaseOrderEvents,
    purchaseOrderItems,
    purchaseOrders,
    supplierProducts,
    suppliers,
    importRowErrors,
    importBatchRows,
    importBatches,
    cashMovements,
    cashSessions,
    employeeActivityLogs,
    auditLogs,
    customers,
    products,
    productCategories,
  ] = await Promise.all([
    prisma.returnRequestItem.count({ where: { returnRequest: { tenantId } } }),
    prisma.returnRequest.count({ where: { tenantId } }),
    prisma.creditSaleApproval.count({ where: { tenantId } }),
    prisma.salesOrderItem.count({ where: { salesOrder: { tenantId } } }),
    prisma.salesOrder.count({ where: { tenantId } }),
    prisma.invoiceItem.count({ where: { invoice: { tenantId } } }),
    prisma.invoice.count({ where: { tenantId } }),
    prisma.payment.count({ where: { tenantId } }),
    prisma.electronicDocument.count({ where: { tenantId } }),
    prisma.inventoryMovement.count({ where: { tenantId } }),
    prisma.supplierInvoiceAttachment.count({ where: { tenantId } }),
    prisma.mobileOcrCaptureSession.count({ where: { tenantId } }),
    prisma.goodsReceiptItem.count({ where: { tenantId } }),
    prisma.goodsReceipt.count({ where: { tenantId } }),
    prisma.supplierPayment.count({ where: { tenantId } }),
    prisma.supplierInvoiceItem.count({ where: { tenantId } }),
    prisma.supplierInvoice.count({ where: { tenantId } }),
    prisma.purchaseOrderEvent.count({ where: { tenantId } }),
    prisma.purchaseOrderItem.count({ where: { tenantId } }),
    prisma.purchaseOrder.count({ where: { tenantId } }),
    prisma.supplierProduct.count({ where: { tenantId } }),
    prisma.supplier.count({ where: { tenantId } }),
    prisma.importRowError.count({ where: { importBatch: { tenantId } } }),
    prisma.importBatchRow.count({ where: { importBatch: { tenantId } } }),
    prisma.importBatch.count({ where: { tenantId } }),
    prisma.cashMovement.count({ where: { tenantId } }),
    prisma.cashSession.count({ where: { tenantId } }),
    prisma.employeeActivityLog.count({ where: { tenantId } }),
    prisma.auditLog.count({ where: { tenantId } }),
    prisma.customer.count({ where: { tenantId } }),
    prisma.product.count({ where: { tenantId } }),
    prisma.productCategory.count({ where: { tenantId } }),
  ]);

  return {
    returnRequestItems,
    returnRequests,
    creditSaleApprovals,
    salesOrderItems,
    salesOrders,
    invoiceItems,
    invoices,
    payments,
    electronicDocuments,
    inventoryMovements,
    supplierInvoiceAttachments,
    mobileOcrCaptureSessions,
    goodsReceiptItems,
    goodsReceipts,
    supplierPayments,
    supplierInvoiceItems,
    supplierInvoices,
    purchaseOrderEvents,
    purchaseOrderItems,
    purchaseOrders,
    supplierProducts,
    suppliers,
    importRowErrors,
    importBatchRows,
    importBatches,
    cashMovements,
    cashSessions,
    employeeActivityLogs,
    auditLogs,
    customers,
    products,
    productCategories,
  };
}

async function getPreservedCounts(tenantId: string): Promise<PreservedCounts> {
  const [
    tenant,
    companyBranding,
    cashRegisters,
    fiscalSequences,
    memberships,
    employeeProfiles,
    tenantUsers,
  ] = await Promise.all([
    prisma.tenant.count({ where: { id: tenantId } }),
    prisma.companyBranding.count({ where: { tenantId } }),
    prisma.cashRegister.count({ where: { tenantId } }),
    prisma.fiscalSequence.count({ where: { tenantId } }),
    prisma.membership.count({ where: { tenantId } }),
    prisma.employeeProfile.count({ where: { tenantId } }),
    prisma.user.count({ where: { memberships: { some: { tenantId } } } }),
  ]);

  return {
    tenant,
    companyBranding,
    cashRegisters,
    fiscalSequences,
    memberships,
    employeeProfiles,
    tenantUsers,
  };
}

async function getFiscalSequenceSnapshot(tenantId: string) {
  return prisma.fiscalSequence.findMany({
    where: { tenantId },
    select: {
      id: true,
      documentType: true,
      prefix: true,
      startNumber: true,
      endNumber: true,
      nextNumber: true,
      validUntil: true,
      status: true,
    },
    orderBy: { id: 'asc' },
  });
}

function printCounts(title: string, counts: Record<string, number>) {
  console.log('');
  console.log(title);
  for (const [name, count] of Object.entries(counts)) {
    console.log(`- ${name}: ${count}`);
  }
}

function hasExpectedPostCleanupData(counts: CleanupCounts) {
  const { auditLogs, ...operationalCounts } = counts;

  return auditLogs === 1 && Object.values(operationalCounts).every((count) => count === 0);
}

async function cleanOperationalData(
  tenantId: string,
  cleanupCounts: CleanupCounts,
  confirmedBackupMarker: string,
) {
  await prisma.$transaction(
    async (tx) => {
      // Logs and cash movement references must be removed before their parents.
      await tx.employeeActivityLog.deleteMany({ where: { tenantId } });
      await tx.auditLog.deleteMany({ where: { tenantId } });
      await tx.cashMovement.deleteMany({ where: { tenantId } });

      // Sales and customer credit flow.
      await tx.returnRequestItem.deleteMany({
        where: { returnRequest: { tenantId } },
      });
      await tx.returnRequest.deleteMany({ where: { tenantId } });
      await tx.creditSaleApproval.deleteMany({ where: { tenantId } });
      await tx.salesOrderItem.deleteMany({
        where: { salesOrder: { tenantId } },
      });
      await tx.salesOrder.deleteMany({ where: { tenantId } });
      await tx.electronicDocument.deleteMany({ where: { tenantId } });
      await tx.payment.deleteMany({ where: { tenantId } });
      await tx.invoiceItem.deleteMany({ where: { invoice: { tenantId } } });
      await tx.invoice.deleteMany({ where: { tenantId } });

      // Purchasing, supplier invoices, receipt records and temporary OCR sessions.
      await tx.mobileOcrCaptureSession.deleteMany({ where: { tenantId } });
      await tx.goodsReceiptItem.deleteMany({ where: { tenantId } });
      await tx.goodsReceipt.deleteMany({ where: { tenantId } });
      await tx.supplierInvoiceAttachment.deleteMany({ where: { tenantId } });
      await tx.supplierPayment.deleteMany({ where: { tenantId } });
      await tx.supplierInvoiceItem.deleteMany({ where: { tenantId } });
      await tx.supplierInvoice.deleteMany({ where: { tenantId } });
      await tx.purchaseOrderEvent.deleteMany({ where: { tenantId } });
      await tx.purchaseOrderItem.deleteMany({ where: { tenantId } });
      await tx.purchaseOrder.deleteMany({ where: { tenantId } });
      await tx.supplierProduct.deleteMany({ where: { tenantId } });
      await tx.supplier.deleteMany({ where: { tenantId } });

      // Imported product staging data can point to products, so it goes first.
      await tx.importRowError.deleteMany({
        where: { importBatch: { tenantId } },
      });
      await tx.importBatchRow.deleteMany({
        where: { importBatch: { tenantId } },
      });
      await tx.importBatch.deleteMany({ where: { tenantId } });

      // Inventory movements precede products because some product relations are restrictive.
      await tx.inventoryMovement.deleteMany({ where: { tenantId } });
      await tx.customer.deleteMany({ where: { tenantId } });
      await tx.product.deleteMany({ where: { tenantId } });
      await tx.productCategory.deleteMany({ where: { tenantId } });

      // The physical cash register remains. Only its operational sessions are removed.
      await tx.cashSession.deleteMany({ where: { tenantId } });

      await tx.auditLog.create({
        data: {
          tenantId,
          action: 'OPERATIONAL_LAUNCH_RESET',
          entity: 'Tenant',
          entityId: tenantId,
          metadata: {
            cleanup: 'rivnu-operational-launch',
            backupMarker: confirmedBackupMarker,
            deletedRecords: cleanupCounts,
          },
        },
      });
    },
    { maxWait: 20_000, timeout: 180_000 },
  );
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage();
    return;
  }

  assertTargetTenant();

  const tenant = await prisma.tenant.findUnique({
    where: { slug: RIVNU_TENANT_SLUG },
    select: { id: true, name: true, slug: true },
  });

  if (!tenant) {
    throw new Error(`Tenant ${RIVNU_TENANT_SLUG} was not found.`);
  }

  const beforeCleanupCounts = await getCleanupCounts(tenant.id);
  const beforePreservedCounts = await getPreservedCounts(tenant.id);
  const beforeFiscalSequences = await getFiscalSequenceSnapshot(tenant.id);

  console.log(`Operational launch cleanup for ${tenant.name} (${tenant.slug})`);
  console.log(`Mode: ${execute ? 'EXECUTE' : 'DRY-RUN'}`);
  printCounts('Tenant-scoped data that will be deleted:', beforeCleanupCounts);
  printCounts('Records that will be preserved unchanged:', beforePreservedCounts);
  console.log('');
  console.log(
    'Preserved: company/branding/settings, the physical cash register, fiscal sequences, user accounts, memberships, roles and employee profiles.',
  );
  console.log(
    'Note: Prisma can delete supplier-invoice attachment records, but does not remove any external storage objects by itself.',
  );

  if (!execute) {
    console.log('');
    console.log('Dry-run only. No data was deleted.');
    printUsage();
    return;
  }

  if (confirmation !== RIVNU_TENANT_SLUG) {
    throw new Error(
      `Refusing to execute. Pass --confirm=${RIVNU_TENANT_SLUG} together with --execute.`,
    );
  }

  if (!backupMarker) {
    throw new Error(
      'Refusing to execute without --backup-marker=<path-or-identifier> for a verified backup.',
    );
  }

  await cleanOperationalData(tenant.id, beforeCleanupCounts, backupMarker);

  const afterCleanupCounts = await getCleanupCounts(tenant.id);
  const afterPreservedCounts = await getPreservedCounts(tenant.id);
  const afterFiscalSequences = await getFiscalSequenceSnapshot(tenant.id);

  if (!hasExpectedPostCleanupData(afterCleanupCounts)) {
    throw new Error(
      `Cleanup completed but the post-cleanup state is unexpected: ${JSON.stringify(afterCleanupCounts)}.`,
    );
  }

  if (JSON.stringify(beforePreservedCounts) !== JSON.stringify(afterPreservedCounts)) {
    throw new Error(
      'Cleanup completed but a protected record count changed. Review the database before continuing.',
    );
  }

  if (JSON.stringify(beforeFiscalSequences) !== JSON.stringify(afterFiscalSequences)) {
    throw new Error(
      'Cleanup completed but a fiscal sequence changed. Review the database before continuing.',
    );
  }

  console.log('');
  console.log('Operational launch cleanup completed successfully.');
  printCounts(
    'Post-cleanup data (the one audit log is the recorded reset event):',
    afterCleanupCounts,
  );
  printCounts('Verified preserved records:', afterPreservedCounts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
