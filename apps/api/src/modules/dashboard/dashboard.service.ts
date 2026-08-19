import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CashMovementType,
  CashSessionStatus,
  CreditApprovalStatus,
  CustomerStatus,
  EmployeeStatus,
  FiscalSequenceStatus,
  GoodsReceiptStatus,
  InvoiceDocumentType,
  InvoiceStatus,
  PaymentMethod,
  ProductStatus,
  PurchaseOrderStatus,
  ReturnRequestStatus,
  SalePaymentMode,
  SalesOrderDestination,
  SalesOrderStatus,
  SupplierInvoiceStatus,
} from '@qorvex/database';
import { addBusinessDays, businessDateKey } from '../../common/utils/business-date';
import { PrismaService } from '../../prisma/prisma.service';
import { readFiscalCustomerSnapshot } from '../fiscal-documents/fiscal-document';
import { ProductSalesQueryDto } from './dto/product-sales-query.dto';

const revenueStatuses = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PAID,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PENDING_ECF,
  InvoiceStatus.ACCEPTED,
  InvoiceStatus.CREDITED,
];
const pendingInvoiceStatuses = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PENDING_ECF,
];
const excludedReceivableStatuses = [
  InvoiceStatus.CANCELLED,
  InvoiceStatus.VOIDED,
  InvoiceStatus.VOID,
  InvoiceStatus.REJECTED,
];
const payableInvoiceStatuses = [
  SupplierInvoiceStatus.PENDING,
  SupplierInvoiceStatus.PARTIALLY_PAID,
  SupplierInvoiceStatus.PAID,
];
const terminalPurchaseOrderStatuses: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.RECEIVED,
  PurchaseOrderStatus.CANCELLED,
];
const localFiscalDocumentTypes = [
  InvoiceDocumentType.CONSUMER_02,
  InvoiceDocumentType.FISCAL_CREDIT_01,
] as const;

type FiscalSequenceAlertSource = {
  id: string;
  documentType: InvoiceDocumentType;
  prefix: string;
  startNumber: number;
  endNumber: number;
  nextNumber: number;
  validUntil: Date | null;
  status: FiscalSequenceStatus;
  createdAt: Date;
};

type FiscalSequenceAlert = {
  id: string;
  documentType: (typeof localFiscalDocumentTypes)[number];
  prefix: string;
  status: FiscalSequenceStatus | 'MISSING';
  startNumber: number;
  nextNumber: number;
  endNumber: number;
  remaining: number;
  authorizedCount: number;
  alertThreshold: number;
  severity: 'WARNING' | 'CRITICAL';
  validUntil: Date | null;
  hasQueuedReplacement: boolean;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(tenantId: string) {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const accountingTodayKey = businessDateKey(now);
    const currentFiscalDate = new Date(`${accountingTodayKey}T00:00:00.000Z`);
    const accountingTomorrowKey = businessDateKey(addBusinessDays(1, now));
    const accountingDueSoonEndKey = businessDateKey(addBusinessDays(8, now));

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const seriesStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [
      invoicesForMonth,
      invoicesForToday,
      returnsMonth,
      returnsToday,
      pendingReturnsAggregate,
      pendingInvoices,
      paidInvoices,
      draftInvoices,
      cancelledInvoices,
      activeCustomers,
      activeProducts,
      activeEmployees,
      openCashSessions,
      openCashSessionDetails,
      pendingOrders,
      claimedOrders,
      pendingQuotations,
      completedOrdersToday,
      completedReturns,
      pendingReturns,
      recentInvoices,
      recentReturns,
      recentCashMovements,
      recentEmployeeLogs,
      fiscalSequences,
      productsForStock,
      invoicesForSeries,
      returnsForSeries,
      quotationSalesInCashier,
      completedQuotationSalesToday,
      receivableInvoicesForAccounting,
      payableInvoicesForAccounting,
      purchaseOrdersForAccounting,
      awaitingReceiptCount,
      draftReceiptsCount,
      draftReceiptItemsForAccounting,
      pendingCreditApprovals,
      creditApprovalsExceedingLimit,
      recentAuditActivity,
    ] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          tenantId,
          status: { in: revenueStatuses },
          issuedAt: {
            gte: monthStart,
            lt: nextMonthStart,
          },
        },
        select: {
          paidAmount: true,
          total: true,
        },
      }),
      this.prisma.invoice.findMany({
        where: {
          tenantId,
          status: { in: revenueStatuses },
          issuedAt: {
            gte: todayStart,
          },
        },
        select: {
          paidAmount: true,
          total: true,
        },
      }),
      this.prisma.returnRequest.aggregate({
        where: {
          tenantId,
          status: ReturnRequestStatus.COMPLETED,
          completedAt: {
            gte: monthStart,
            lt: nextMonthStart,
          },
        },
        _sum: { refundAmount: true },
      }),
      this.prisma.returnRequest.aggregate({
        where: {
          tenantId,
          status: ReturnRequestStatus.COMPLETED,
          completedAt: {
            gte: todayStart,
          },
        },
        _sum: { refundAmount: true },
      }),
      this.prisma.returnRequest.aggregate({
        where: {
          tenantId,
          status: ReturnRequestStatus.REQUESTED,
        },
        _sum: { refundAmount: true },
      }),
      this.prisma.invoice.count({
        where: {
          tenantId,
          status: { in: pendingInvoiceStatuses },
        },
      }),
      this.prisma.invoice.count({
        where: {
          tenantId,
          status: { in: [InvoiceStatus.PAID, InvoiceStatus.ACCEPTED] },
        },
      }),
      this.prisma.invoice.count({
        where: {
          tenantId,
          status: InvoiceStatus.DRAFT,
        },
      }),
      this.prisma.invoice.count({
        where: {
          tenantId,
          status: { in: [InvoiceStatus.CANCELLED, InvoiceStatus.VOID, InvoiceStatus.VOIDED] },
        },
      }),
      this.prisma.customer.count({
        where: {
          tenantId,
          status: CustomerStatus.ACTIVE,
        },
      }),
      this.prisma.product.count({
        where: {
          tenantId,
          status: ProductStatus.ACTIVE,
        },
      }),
      this.prisma.employeeProfile.count({
        where: {
          tenantId,
          status: EmployeeStatus.ACTIVE,
        },
      }),
      this.prisma.cashSession.count({
        where: {
          tenantId,
          status: CashSessionStatus.OPEN,
        },
      }),
      this.prisma.cashSession.findMany({
        where: {
          tenantId,
          status: CashSessionStatus.OPEN,
        },
        include: {
          cashRegister: true,
          openedBy: { select: { id: true, name: true, email: true } },
          movements: {
            select: {
              type: true,
              amount: true,
              method: true,
            },
          },
        },
        orderBy: { openedAt: 'desc' },
      }),
      this.prisma.salesOrder.count({
        where: {
          tenantId,
          destination: SalesOrderDestination.CASH_SALE,
          status: SalesOrderStatus.SENT_TO_CASHIER,
        },
      }),
      this.prisma.salesOrder.count({
        where: {
          tenantId,
          destination: SalesOrderDestination.CASH_SALE,
          status: SalesOrderStatus.IN_CASHIER,
        },
      }),
      this.prisma.salesOrder.count({
        where: {
          tenantId,
          destination: SalesOrderDestination.QUOTATION,
          status: SalesOrderStatus.QUOTATION,
        },
      }),
      this.prisma.salesOrder.count({
        where: {
          tenantId,
          status: SalesOrderStatus.COMPLETED,
          completedAt: {
            gte: todayStart,
          },
        },
      }),
      this.prisma.returnRequest.count({
        where: {
          tenantId,
          status: ReturnRequestStatus.COMPLETED,
        },
      }),
      this.prisma.returnRequest.count({
        where: {
          tenantId,
          status: ReturnRequestStatus.REQUESTED,
        },
      }),
      this.prisma.invoice.findMany({
        where: { tenantId },
        include: {
          customer: true,
          issuedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.returnRequest.findMany({
        where: { tenantId },
        include: {
          invoice: { select: { id: true, invoiceNumber: true, total: true } },
          requestedBy: { select: { id: true, name: true, email: true } },
          approvedBy: { select: { id: true, name: true, email: true } },
          rejectedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
      this.prisma.cashMovement.findMany({
        where: { tenantId },
        include: {
          user: { select: { id: true, name: true, email: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
          cashSession: { include: { cashRegister: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.employeeActivityLog.findMany({
        where: { tenantId },
        include: {
          user: { select: { id: true, name: true, email: true } },
          invoice: { select: { id: true, invoiceNumber: true, total: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      this.prisma.fiscalSequence.findMany({
        where: {
          tenantId,
          documentType: {
            in: [...localFiscalDocumentTypes],
          },
        },
        orderBy: [{ documentType: 'asc' }, { createdAt: 'desc' }],
      }),
      this.prisma.product.findMany({
        where: {
          tenantId,
          status: ProductStatus.ACTIVE,
          trackInventory: true,
        },
        orderBy: {
          stock: 'asc',
        },
        select: {
          id: true,
          name: true,
          sku: true,
          stock: true,
          reservedStock: true,
          minStock: true,
        },
      }),
      this.prisma.invoice.findMany({
        where: {
          tenantId,
          status: { in: revenueStatuses },
          issuedAt: {
            gte: seriesStart,
          },
        },
        select: {
          issuedAt: true,
          paidAmount: true,
          total: true,
        },
      }),
      this.prisma.returnRequest.findMany({
        where: {
          tenantId,
          status: ReturnRequestStatus.COMPLETED,
          completedAt: {
            gte: seriesStart,
          },
        },
        select: {
          completedAt: true,
          refundAmount: true,
        },
      }),
      this.prisma.salesOrder.findMany({
        where: {
          tenantId,
          destination: SalesOrderDestination.CASH_SALE,
          orderNumber: { startsWith: 'COT-' },
          status: { in: [SalesOrderStatus.SENT_TO_CASHIER, SalesOrderStatus.IN_CASHIER] },
        },
        select: {
          total: true,
        },
      }),
      this.prisma.salesOrder.findMany({
        where: {
          tenantId,
          orderNumber: { startsWith: 'COT-' },
          status: SalesOrderStatus.COMPLETED,
          completedAt: {
            gte: todayStart,
          },
        },
        select: {
          total: true,
        },
      }),
      this.prisma.invoice.findMany({
        where: {
          tenantId,
          paymentMode: SalePaymentMode.CREDIT,
          status: { notIn: excludedReceivableStatuses },
          balance: { gt: 0 },
        },
        select: {
          balance: true,
          dueDate: true,
        },
      }),
      this.prisma.supplierInvoice.findMany({
        where: {
          tenantId,
          status: { in: payableInvoiceStatuses },
          balance: { gt: 0 },
        },
        select: {
          balance: true,
          dueDate: true,
        },
      }),
      this.prisma.purchaseOrder.findMany({
        where: { tenantId },
        select: {
          status: true,
          expectedDeliveryDate: true,
          supplierInvoice: { select: { id: true } },
        },
      }),
      this.prisma.supplierInvoice.count({
        where: {
          tenantId,
          status: { in: payableInvoiceStatuses },
          goodsReceipts: { none: { status: GoodsReceiptStatus.CONFIRMED } },
        },
      }),
      this.prisma.goodsReceipt.count({
        where: {
          tenantId,
          status: GoodsReceiptStatus.DRAFT,
        },
      }),
      this.prisma.goodsReceiptItem.findMany({
        where: {
          tenantId,
          differenceAccepted: false,
          goodsReceipt: { status: GoodsReceiptStatus.DRAFT },
        },
        select: {
          quantityInvoiced: true,
          quantityReceived: true,
        },
      }),
      this.prisma.creditSaleApproval.aggregate({
        where: {
          tenantId,
          status: CreditApprovalStatus.PENDING,
        },
        _count: { _all: true },
        _sum: { financedAmount: true },
      }),
      this.prisma.creditSaleApproval.count({
        where: {
          tenantId,
          status: CreditApprovalStatus.PENDING,
          exceedsCreditLimit: true,
        },
      }),
      this.prisma.auditLog.findMany({
        where: { tenantId },
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          createdAt: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    const lowStockProductsList = productsForStock.filter(
      (product) => product.stock - product.reservedStock <= product.minStock,
    );
    const recentInventoryAlerts = lowStockProductsList.slice(0, 5);
    const grossSalesMonth = this.sumInvoicePaidAmount(invoicesForMonth);
    const grossSalesToday = this.sumInvoicePaidAmount(invoicesForToday);
    const refundsMonth = this.decimalToNumber(returnsMonth._sum.refundAmount);
    const refundsToday = this.decimalToNumber(returnsToday._sum.refundAmount);
    const netSalesMonth = grossSalesMonth - refundsMonth;
    const netSalesToday = grossSalesToday - refundsToday;
    const pendingReturnAmount = this.decimalToNumber(pendingReturnsAggregate._sum.refundAmount);
    const quotationSalesInCashierAmount = this.sumOrderAmount(quotationSalesInCashier);
    const completedQuotationSalesTodayAmount = this.sumOrderAmount(completedQuotationSalesToday);
    const receivablesAccounting = this.buildAgingSummary(receivableInvoicesForAccounting, {
      todayKey: accountingTodayKey,
      tomorrowKey: accountingTomorrowKey,
      dueSoonEndKey: accountingDueSoonEndKey,
    });
    const payablesAccounting = this.buildAgingSummary(payableInvoicesForAccounting, {
      todayKey: accountingTodayKey,
      tomorrowKey: accountingTomorrowKey,
      dueSoonEndKey: accountingDueSoonEndKey,
    });
    const purchaseOrdersAccounting = {
      draftCount: purchaseOrdersForAccounting.filter(
        (order) => order.status === PurchaseOrderStatus.DRAFT,
      ).length,
      underReviewCount: purchaseOrdersForAccounting.filter(
        (order) =>
          order.status === PurchaseOrderStatus.REQUESTED ||
          order.status === PurchaseOrderStatus.UNDER_REVIEW,
      ).length,
      awaitingInvoiceCount: purchaseOrdersForAccounting.filter(
        (order) => order.status === PurchaseOrderStatus.ISSUED && !order.supplierInvoice,
      ).length,
      overdueCount: purchaseOrdersForAccounting.filter(
        (order) =>
          Boolean(order.expectedDeliveryDate) &&
          !terminalPurchaseOrderStatuses.includes(order.status) &&
          businessDateKey(order.expectedDeliveryDate!) < accountingTodayKey,
      ).length,
      partiallyReceivedCount: purchaseOrdersForAccounting.filter(
        (order) => order.status === PurchaseOrderStatus.PARTIALLY_RECEIVED,
      ).length,
      awaitingReceiptCount,
    };
    const itemsWithDifferenceCount = draftReceiptItemsForAccounting.filter(
      (item) =>
        Math.abs(
          this.decimalToNumber(item.quantityReceived) - this.decimalToNumber(item.quantityInvoiced),
        ) > 0.000001,
    ).length;

    return {
      totalBilledMonth: netSalesMonth,
      totalBilledToday: netSalesToday,
      grossSalesMonth,
      grossSalesToday,
      refundsMonth,
      refundsToday,
      netSalesMonth,
      netSalesToday,
      pendingReturnAmount,
      pendingInvoices,
      paidInvoices,
      draftInvoices,
      cancelledInvoices,
      activeCustomers,
      activeProducts,
      activeEmployees,
      openCashSessions,
      pendingOrders,
      claimedOrders,
      ordersInCashier: pendingOrders + claimedOrders,
      pendingQuotations,
      quotationSalesInCashier: quotationSalesInCashier.length,
      quotationSalesInCashierAmount,
      completedQuotationSalesToday: completedQuotationSalesToday.length,
      completedQuotationSalesTodayAmount,
      completedOrdersToday,
      pendingReturns,
      completedReturns,
      lowStockProducts: lowStockProductsList.length,
      openCashSessionDetails: openCashSessionDetails.map((session) => ({
        id: session.id,
        registerName: session.cashRegister.name,
        openedByName: session.openedBy.name,
        openingAmount: this.decimalToNumber(session.openingAmount),
        expectedCashAmount: this.calculateExpectedCashAmount(session),
        openedAt: session.openedAt,
      })),
      recentInvoices: recentInvoices.map((invoice) => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        customerName:
          readFiscalCustomerSnapshot(invoice.fiscalCustomerSnapshot)?.name ??
          invoice.customer?.name ??
          'Consumidor final',
        status: invoice.status,
        total: this.decimalToNumber(invoice.total),
        cashierName: invoice.issuedBy?.name ?? null,
        issuedAt: invoice.issuedAt,
        createdAt: invoice.createdAt,
      })),
      recentReturns: recentReturns.map((returnRequest) => ({
        id: returnRequest.id,
        status: returnRequest.status,
        reason: returnRequest.reason,
        refundAmount: this.decimalToNumber(returnRequest.refundAmount),
        invoiceId: returnRequest.invoice.id,
        invoiceNumber: returnRequest.invoice.invoiceNumber,
        requestedByName: returnRequest.requestedBy.name,
        resolvedByName: returnRequest.approvedBy?.name ?? returnRequest.rejectedBy?.name ?? null,
        createdAt: returnRequest.createdAt,
        completedAt: returnRequest.completedAt,
      })),
      recentCashMovements: recentCashMovements.map((movement) => ({
        id: movement.id,
        type: movement.type,
        amount: this.decimalToNumber(movement.amount),
        method: movement.method,
        reason: movement.reason,
        reference: movement.reference,
        cashierName: movement.user.name,
        registerName: movement.cashSession.cashRegister.name,
        invoiceNumber: movement.invoice?.invoiceNumber ?? null,
        createdAt: movement.createdAt,
      })),
      recentEmployeeLogs: recentEmployeeLogs.map((log) => ({
        id: log.id,
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        amount: this.decimalToNumber(log.amount),
        employeeName: log.user.name,
        invoiceNumber: log.invoice?.invoiceNumber ?? null,
        createdAt: log.createdAt,
      })),
      fiscalSequenceAlerts: this.buildFiscalSequenceAlerts(fiscalSequences, currentFiscalDate),
      employeeSummary: {
        activeEmployees,
        openCashSessions,
      },
      accounting: {
        receivables: receivablesAccounting,
        payables: payablesAccounting,
        purchaseOrders: purchaseOrdersAccounting,
        receipts: {
          draftCount: draftReceiptsCount,
          itemsWithDifferenceCount,
        },
        creditApprovals: {
          pendingCount: pendingCreditApprovals._count._all,
          pendingFinancedAmount: this.decimalToNumber(pendingCreditApprovals._sum.financedAmount),
          exceedsLimitCount: creditApprovalsExceedingLimit,
        },
      },
      recentAuditActivity: recentAuditActivity.map((activity) => ({
        id: activity.id,
        action: activity.action,
        entity: activity.entity,
        entityId: activity.entityId,
        userName: activity.user?.name ?? null,
        createdAt: activity.createdAt,
      })),
      recentInventoryAlerts,
      salesSeries: this.buildSalesSeries(invoicesForSeries, returnsForSeries, now),
    };
  }

  async getOperationalAlerts(tenantId: string) {
    const currentFiscalDate = new Date(`${businessDateKey(new Date())}T00:00:00.000Z`);
    const [pendingInvoices, openCashSessions, productsForStock, fiscalSequences] =
      await Promise.all([
        this.prisma.invoice.count({
          where: {
            tenantId,
            status: { in: pendingInvoiceStatuses },
          },
        }),
        this.prisma.cashSession.count({
          where: {
            tenantId,
            status: CashSessionStatus.OPEN,
          },
        }),
        this.prisma.product.findMany({
          where: {
            tenantId,
            status: ProductStatus.ACTIVE,
            trackInventory: true,
          },
          select: {
            stock: true,
            reservedStock: true,
            minStock: true,
          },
        }),
        this.prisma.fiscalSequence.findMany({
          where: {
            tenantId,
            documentType: { in: [...localFiscalDocumentTypes] },
          },
          orderBy: [{ documentType: 'asc' }, { createdAt: 'desc' }],
        }),
      ]);

    return {
      pendingInvoices,
      lowStockProducts: productsForStock.filter(
        (product) => product.stock - product.reservedStock <= product.minStock,
      ).length,
      openCashSessions,
      fiscalSequenceAlerts: this.buildFiscalSequenceAlerts(fiscalSequences, currentFiscalDate),
    };
  }

  async getProductSales(tenantId: string, query: ProductSalesQueryDto = {}) {
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    if (from && to && from >= to) {
      throw new BadRequestException('The product sales start date must precede its end date.');
    }

    const saleDateRange = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lt: to } : {}),
    };
    const hasDateRange = Boolean(from || to);

    const [products, invoiceItems] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          tenantId,
          status: ProductStatus.ACTIVE,
        },
        include: {
          category: { select: { id: true, name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.invoiceItem.findMany({
        where: {
          productId: { not: null },
          invoice: {
            tenantId,
            status: { in: revenueStatuses },
            ...(hasDateRange
              ? {
                  OR: [{ issuedAt: saleDateRange }, { issuedAt: null, createdAt: saleDateRange }],
                }
              : {}),
          },
        },
        select: {
          invoiceId: true,
          productId: true,
          quantity: true,
          total: true,
          invoice: {
            select: {
              issuedAt: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    const ranking = this.buildProductSalesRanking(products, invoiceItems);

    return {
      generatedAt: new Date(),
      range: {
        from: from?.toISOString() ?? null,
        to: to?.toISOString() ?? null,
      },
      productCount: products.length,
      productsWithSales: ranking.mostSold.filter((product) => product.quantitySold > 0).length,
      productsWithoutSales: ranking.leastSold.filter((product) => product.quantitySold === 0)
        .length,
      mostSold: ranking.mostSold,
      leastSold: ranking.leastSold,
    };
  }

  private buildFiscalSequenceAlerts(
    sequences: FiscalSequenceAlertSource[],
    currentFiscalDate: Date,
  ): FiscalSequenceAlert[] {
    return localFiscalDocumentTypes.flatMap<FiscalSequenceAlert>((documentType) => {
      const candidates = sequences
        .filter((sequence) => sequence.documentType === documentType)
        .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime());
      const isEligible = (sequence: FiscalSequenceAlertSource) =>
        sequence.nextNumber <= sequence.endNumber &&
        (!sequence.validUntil || sequence.validUntil >= currentFiscalDate);
      const queued = candidates.filter(
        (sequence) => sequence.status === FiscalSequenceStatus.INACTIVE && isEligible(sequence),
      );
      const active = candidates.find(
        (sequence) => sequence.status === FiscalSequenceStatus.ACTIVE && isEligible(sequence),
      );

      if (active) {
        const remaining = Math.max(active.endNumber - active.nextNumber + 1, 0);
        const authorizedCount = active.endNumber - active.startNumber + 1;
        const alertThreshold = this.fiscalSequenceAlertThreshold(authorizedCount);

        if (remaining > alertThreshold) {
          return [];
        }

        const criticalThreshold = Math.min(
          alertThreshold,
          Math.max(2, Math.ceil(authorizedCount * 0.05)),
        );

        return [
          {
            id: active.id,
            documentType,
            prefix: active.prefix,
            status: FiscalSequenceStatus.ACTIVE,
            startNumber: active.startNumber,
            nextNumber: active.nextNumber,
            endNumber: active.endNumber,
            remaining,
            authorizedCount,
            alertThreshold,
            severity: remaining <= criticalThreshold ? ('CRITICAL' as const) : ('WARNING' as const),
            validUntil: active.validUntil,
            hasQueuedReplacement: queued.length > 0,
          },
        ];
      }

      if (queued.length) {
        return [];
      }

      const latest = candidates[0];
      const prefix = documentType === InvoiceDocumentType.CONSUMER_02 ? 'B02' : 'B01';
      const status = !latest
        ? ('MISSING' as const)
        : latest.validUntil && latest.validUntil < currentFiscalDate
          ? FiscalSequenceStatus.EXPIRED
          : latest.nextNumber > latest.endNumber
            ? FiscalSequenceStatus.EXHAUSTED
            : latest.status;
      const authorizedCount = latest ? latest.endNumber - latest.startNumber + 1 : 0;

      return [
        {
          id: latest?.id ?? `missing-${documentType}`,
          documentType,
          prefix: latest?.prefix ?? prefix,
          status,
          startNumber: latest?.startNumber ?? 0,
          nextNumber: latest?.nextNumber ?? 0,
          endNumber: latest?.endNumber ?? 0,
          remaining: latest ? Math.max(latest.endNumber - latest.nextNumber + 1, 0) : 0,
          authorizedCount,
          alertThreshold: this.fiscalSequenceAlertThreshold(authorizedCount),
          severity: 'CRITICAL' as const,
          validUntil: latest?.validUntil ?? null,
          hasQueuedReplacement: false,
        },
      ];
    });
  }

  private fiscalSequenceAlertThreshold(authorizedCount: number) {
    return Math.min(25, Math.max(1, Math.ceil(Math.max(authorizedCount, 1) * 0.2)));
  }

  private buildSalesSeries(
    invoices: Array<{
      issuedAt: Date | null;
      paidAmount: { toNumber(): number };
      total: { toNumber(): number };
    }>,
    returns: Array<{
      completedAt: Date | null;
      refundAmount: { toNumber(): number };
    }>,
    now: Date,
  ) {
    const buckets = new Map<string, number>();

    for (let index = 5; index >= 0; index -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      buckets.set(this.monthKey(date), 0);
    }

    for (const invoice of invoices) {
      if (!invoice.issuedAt) {
        continue;
      }

      const key = this.monthKey(invoice.issuedAt);
      buckets.set(key, (buckets.get(key) ?? 0) + this.getInvoicePaidAmount(invoice));
    }

    for (const returnRequest of returns) {
      if (!returnRequest.completedAt) {
        continue;
      }

      const key = this.monthKey(returnRequest.completedAt);
      buckets.set(key, (buckets.get(key) ?? 0) - this.decimalToNumber(returnRequest.refundAmount));
    }

    return Array.from(buckets.entries()).map(([month, total]) => ({
      month,
      total,
    }));
  }

  private monthKey(date: Date) {
    return new Intl.DateTimeFormat('es-DO', {
      month: 'short',
    }).format(date);
  }

  private buildProductSalesRanking(
    products: Array<{
      id: string;
      name: string;
      sku: string | null;
      brand: string | null;
      unit: string;
      price: { toNumber(): number };
      category: { id: string; name: string } | null;
    }>,
    invoiceItems: Array<{
      invoiceId: string;
      productId: string | null;
      quantity: { toNumber(): number };
      total: { toNumber(): number };
      invoice: {
        issuedAt: Date | null;
        createdAt: Date;
      };
    }>,
  ) {
    const aggregates = new Map<
      string,
      {
        quantitySold: number;
        grossAmount: number;
        invoiceIds: Set<string>;
        lastSoldAt: Date | null;
      }
    >();

    for (const item of invoiceItems) {
      if (!item.productId) {
        continue;
      }

      const aggregate = aggregates.get(item.productId) ?? {
        quantitySold: 0,
        grossAmount: 0,
        invoiceIds: new Set<string>(),
        lastSoldAt: null,
      };
      const soldAt = item.invoice.issuedAt ?? item.invoice.createdAt;

      aggregate.quantitySold += this.decimalToNumber(item.quantity);
      aggregate.grossAmount += this.decimalToNumber(item.total);
      aggregate.invoiceIds.add(item.invoiceId);

      if (!aggregate.lastSoldAt || soldAt > aggregate.lastSoldAt) {
        aggregate.lastSoldAt = soldAt;
      }

      aggregates.set(item.productId, aggregate);
    }

    const ranking = products.map((product) => {
      const aggregate = aggregates.get(product.id);

      return {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        brand: product.brand,
        unit: product.unit,
        categoryId: product.category?.id ?? null,
        categoryName: product.category?.name ?? 'Sin categoria',
        currentPrice: this.decimalToNumber(product.price),
        quantitySold: aggregate?.quantitySold ?? 0,
        grossAmount: aggregate?.grossAmount ?? 0,
        invoiceCount: aggregate?.invoiceIds.size ?? 0,
        lastSoldAt: aggregate?.lastSoldAt ?? null,
      };
    });

    return {
      mostSold: [...ranking].sort((first, second) => {
        const quantityDiff = second.quantitySold - first.quantitySold;
        return (
          quantityDiff ||
          second.grossAmount - first.grossAmount ||
          first.name.localeCompare(second.name)
        );
      }),
      leastSold: [...ranking].sort((first, second) => {
        const quantityDiff = first.quantitySold - second.quantitySold;
        return (
          quantityDiff ||
          first.grossAmount - second.grossAmount ||
          first.name.localeCompare(second.name)
        );
      }),
    };
  }

  private decimalToNumber(value: { toNumber(): number } | null | undefined) {
    return value ? value.toNumber() : 0;
  }

  private buildAgingSummary(
    invoices: Array<{
      balance: { toNumber(): number };
      dueDate: Date | null;
    }>,
    boundaries: {
      todayKey: string;
      tomorrowKey: string;
      dueSoonEndKey: string;
    },
  ) {
    let outstandingBalance = 0;
    let overdueBalance = 0;
    let overdueCount = 0;
    let dueTodayCount = 0;
    let dueSoonCount = 0;

    for (const invoice of invoices) {
      const balance = Math.max(this.decimalToNumber(invoice.balance), 0);

      if (!balance) {
        continue;
      }

      outstandingBalance += balance;

      if (!invoice.dueDate) {
        continue;
      }

      const dueDateKey = businessDateKey(invoice.dueDate);
      if (dueDateKey < boundaries.todayKey) {
        overdueCount += 1;
        overdueBalance += balance;
      } else if (dueDateKey === boundaries.todayKey) {
        dueTodayCount += 1;
      } else if (dueDateKey >= boundaries.tomorrowKey && dueDateKey < boundaries.dueSoonEndKey) {
        dueSoonCount += 1;
      }
    }

    return {
      outstandingBalance,
      overdueBalance,
      overdueCount,
      dueTodayCount,
      dueSoonCount,
      openInvoiceCount: invoices.length,
    };
  }

  private sumInvoicePaidAmount(
    invoices: Array<{ paidAmount: { toNumber(): number }; total: { toNumber(): number } }>,
  ) {
    return invoices.reduce((sum, invoice) => sum + this.getInvoicePaidAmount(invoice), 0);
  }

  private sumOrderAmount(orders: Array<{ total: { toNumber(): number } }>) {
    return orders.reduce((sum, order) => sum + this.decimalToNumber(order.total), 0);
  }

  private getInvoicePaidAmount(invoice: {
    paidAmount: { toNumber(): number };
    total: { toNumber(): number };
  }) {
    const paidAmount = this.decimalToNumber(invoice.paidAmount);
    return paidAmount > 0 ? paidAmount : 0;
  }

  private calculateExpectedCashAmount(session: {
    openingAmount: { toNumber(): number };
    movements: Array<{
      type: CashMovementType;
      amount: { toNumber(): number };
      method: PaymentMethod | null;
    }>;
  }) {
    const negativeMovementTypes: CashMovementType[] = [
      CashMovementType.CASH_OUT,
      CashMovementType.REFUND,
      CashMovementType.SUPPLIER_PAYMENT,
    ];

    return session.movements.reduce((sum, movement) => {
      if (movement.type === CashMovementType.CLOSING) {
        return sum;
      }

      if (movement.method && movement.method !== PaymentMethod.CASH) {
        return sum;
      }

      const amount = this.decimalToNumber(movement.amount);
      return negativeMovementTypes.includes(movement.type) ? sum - amount : sum + amount;
    }, this.decimalToNumber(session.openingAmount));
  }
}
