import { CashSessionStatus, PrismaClient, SalesOrderStatus } from '@qorvex/database';

const previewGuard = 'RIVNU_DGII_PREVIEW_ONLY';
const previewDatabase = {
  username: 'rivnu_preview',
  hostname: 'rivnu-dgii-preview-db',
  port: '5432',
  pathname: '/rivnu_dgii_preview',
};
const rivnuTenantSlug = 'ferreteria-rivnu';
const rivnuIssuerTaxId = '40220429126';

function getPreviewSequenceValidUntil() {
  const nextCalendarYear = new Date().getUTCFullYear() + 1;
  return new Date(Date.UTC(nextCalendarYear, 11, 31));
}

function assertPreviewEnvironment() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Preview configuration refused: NODE_ENV must be development.');
  }

  if (process.env.RIVNU_PREVIEW_GUARD !== previewGuard) {
    throw new Error('Preview configuration refused: preview-only marker is missing.');
  }

  for (const key of ['DATABASE_URL', 'DIRECT_URL'] as const) {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Preview configuration refused: ${key} is missing.`);
    }

    const parsed = new URL(value);
    if (
      parsed.protocol !== 'postgresql:' ||
      parsed.username !== previewDatabase.username ||
      parsed.hostname !== previewDatabase.hostname ||
      parsed.port !== previewDatabase.port ||
      parsed.pathname !== previewDatabase.pathname ||
      parsed.searchParams.size !== 1 ||
      parsed.searchParams.get('schema') !== 'public'
    ) {
      throw new Error(
        `Preview configuration refused: ${key} does not target the isolated preview database.`,
      );
    }
  }
}

async function run() {
  assertPreviewEnvironment();
  const prisma = new PrismaClient();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { slug: rivnuTenantSlug },
        select: { id: true, slug: true },
      });
      if (!tenant) {
        throw new Error('The RIVNU preview tenant does not exist. Run the preview seed first.');
      }

      const [openCashSessions, cashierOrders] = await Promise.all([
        tx.cashSession.count({
          where: { tenantId: tenant.id, status: CashSessionStatus.OPEN },
        }),
        tx.salesOrder.count({
          where: {
            tenantId: tenant.id,
            status: {
              in: [SalesOrderStatus.SENT_TO_CASHIER, SalesOrderStatus.IN_CASHIER],
            },
          },
        }),
      ]);

      if (openCashSessions < 1 || cashierOrders < 1) {
        throw new Error(
          'The preview seed is incomplete: an open cash session and a cashier-ready order are required.',
        );
      }

      await tx.tenant.update({
        where: { id: tenant.id },
        data: { rnc: rivnuIssuerTaxId },
      });
      const sequenceValidUntil = getPreviewSequenceValidUntil();
      const sequences = await tx.fiscalSequence.updateMany({
        where: { tenantId: tenant.id },
        data: {
          issuerTaxId: rivnuIssuerTaxId,
          validUntil: sequenceValidUntil,
        },
      });

      return {
        tenant: tenant.slug,
        issuerTaxId: rivnuIssuerTaxId,
        alignedFiscalSequences: sequences.count,
        sequenceValidUntil: sequenceValidUntil.toISOString().slice(0, 10),
        openCashSessions,
        cashierReadyOrders: cashierOrders,
      };
    });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown preview configuration error.';
  process.stderr.write(`DGII preview configuration failed: ${message}\n`);
  process.exitCode = 1;
});
