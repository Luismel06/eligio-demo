import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CashMovementType,
  CashSessionStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  ReturnRequestStatus,
  Role,
  SalePaymentMode,
} from '@qorvex/database';
import { randomUUID } from 'crypto';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { addBusinessDays, businessDateKey } from '../../common/utils/business-date';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CancelReceivablePaymentDto,
  CreateReceivablePaymentDto,
} from './dto/receivable-payment.dto';

const receivableRoles: Role[] = [
  Role.ACCOUNTANT,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.QORVEX_SUPER_ADMIN,
];
const adminRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];
const dueSoonDays = 7;
const excludedReceivableStatuses: InvoiceStatus[] = [
  InvoiceStatus.CANCELLED,
  InvoiceStatus.VOID,
  InvoiceStatus.VOIDED,
];

const receivableInclude = {
  customer: true,
  issuedBy: { select: { id: true, name: true, email: true } },
  items: true,
  payments: {
    include: {
      user: { select: { id: true, name: true, email: true } },
      cashSession: { include: { cashRegister: true } },
      cancelledBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  returnRequests: {
    where: { status: ReturnRequestStatus.COMPLETED },
    select: {
      id: true,
      reason: true,
      status: true,
      refundAmount: true,
      creditAppliedAmount: true,
      cashRefundAmount: true,
      completedAt: true,
    },
    orderBy: { completedAt: 'asc' as const },
  },
  salesOrder: {
    select: {
      id: true,
      orderNumber: true,
      initialPaymentOption: true,
      creditTermOption: true,
    },
  },
} satisfies Prisma.InvoiceInclude;

@Injectable()
export class ReceivablesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    tenantId: string,
    user: AuthenticatedUser,
    filters: { q?: string; bucket?: string },
  ) {
    this.requireAccess(tenantId, user);
    const query = filters.q?.trim();
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        paymentMode: SalePaymentMode.CREDIT,
        status: { notIn: excludedReceivableStatuses },
        ...(query
          ? {
              OR: [
                { invoiceNumber: { contains: query, mode: 'insensitive' } },
                { customer: { name: { contains: query, mode: 'insensitive' } } },
                { customer: { documentNumber: { contains: query, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: receivableInclude,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    });
    const decorated = invoices.map((invoice) => this.decorateInvoice(invoice));
    const filtered =
      filters.bucket && filters.bucket !== 'ALL'
        ? decorated.filter((invoice) => invoice.dueBucket === filters.bucket)
        : decorated;

    return filtered.sort((a, b) => {
      const rank = { OVERDUE: 0, TODAY: 1, DUE_SOON: 2, CURRENT: 3, PAID: 4 };
      const rankDifference =
        rank[a.dueBucket as keyof typeof rank] - rank[b.dueBucket as keyof typeof rank];
      if (rankDifference) {
        return rankDifference;
      }
      return (
        new Date(a.dueDate ?? a.createdAt).getTime() - new Date(b.dueDate ?? b.createdAt).getTime()
      );
    });
  }

  async customerSummary(tenantId: string, user: AuthenticatedUser) {
    this.requireAccess(tenantId, user);
    const customers = await this.prisma.customer.findMany({
      where: { tenantId },
      include: {
        invoices: {
          where: {
            paymentMode: SalePaymentMode.CREDIT,
            status: { notIn: excludedReceivableStatuses },
          },
          select: {
            id: true,
            total: true,
            paidAmount: true,
            balance: true,
            dueDate: true,
            status: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return customers
      .map((customer) => {
        const outstanding = customer.invoices
          .reduce((sum, invoice) => sum.add(invoice.balance), new Prisma.Decimal(0))
          .toDecimalPlaces(2);
        const overdue = customer.invoices
          .filter(
            (invoice) =>
              invoice.balance.gt(0) &&
              invoice.dueDate &&
              businessDateKey(invoice.dueDate) < businessDateKey(new Date()),
          )
          .reduce((sum, invoice) => sum.add(invoice.balance), new Prisma.Decimal(0))
          .toDecimalPlaces(2);
        return {
          id: customer.id,
          name: customer.name,
          documentType: customer.documentType,
          documentNumber: customer.documentNumber,
          creditEnabled: customer.creditEnabled,
          creditStatus: customer.creditStatus,
          creditLimit: customer.creditLimit,
          creditTermDays: customer.creditTermDays,
          outstanding,
          overdue,
          invoiceCount: customer.invoices.length,
        };
      })
      .filter((customer) => customer.creditEnabled || customer.invoiceCount > 0)
      .sort((a, b) => b.outstanding.comparedTo(a.outstanding));
  }

  async customerStatement(tenantId: string, user: AuthenticatedUser, customerId: string) {
    this.requireAccess(tenantId, user);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found for tenant.');
    }
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenantId,
        customerId,
        paymentMode: SalePaymentMode.CREDIT,
        status: { notIn: excludedReceivableStatuses },
      },
      include: receivableInclude,
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    const originalTotal = invoices
      .reduce((sum, invoice) => sum.add(invoice.total), new Prisma.Decimal(0))
      .toDecimalPlaces(2);
    const paid = invoices
      .reduce((sum, invoice) => sum.add(invoice.paidAmount), new Prisma.Decimal(0))
      .toDecimalPlaces(2);
    const balance = invoices
      .reduce((sum, invoice) => sum.add(invoice.balance), new Prisma.Decimal(0))
      .toDecimalPlaces(2);
    const total = paid.add(balance).toDecimalPlaces(2);

    return {
      customer,
      generatedAt: new Date(),
      totals: { total, originalTotal, paid, balance },
      invoices: invoices.map((invoice) => this.decorateInvoice(invoice)),
    };
  }

  async findPaymentReceipt(tenantId: string, user: AuthenticatedUser, paymentId: string) {
    this.requireAccess(tenantId, user);
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        tenantId,
        receiptNumber: { not: null },
        invoice: { paymentMode: SalePaymentMode.CREDIT },
      },
      include: {
        invoice: {
          include: {
            customer: true,
            salesOrder: {
              select: {
                id: true,
                orderNumber: true,
                initialPaymentOption: true,
                creditTermOption: true,
              },
            },
          },
        },
        user: { select: { id: true, name: true, email: true } },
        cashSession: {
          include: {
            cashRegister: true,
          },
        },
        cancelledBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!payment) {
      throw new NotFoundException('Receivable payment receipt not found for tenant.');
    }
    return payment;
  }

  async createPayment(
    tenantId: string,
    user: AuthenticatedUser,
    invoiceId: string,
    dto: CreateReceivablePaymentDto,
  ) {
    this.requireAccess(tenantId, user);
    const amount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
    const receiptNumber = this.generateReceiptNumber(dto.idempotencyKey);
    if (dto.idempotencyKey) {
      const existing = await this.findIdempotentPayment(tenantId, receiptNumber);
      if (existing) {
        this.validateIdempotentPayment(existing, invoiceId, user.id, dto.cashSessionId, amount);
        return this.getPayment(tenantId, existing.id);
      }
    }

    let result: {
      payment: { id: string };
      invoiceNumber: string;
    };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        await this.lockInvoice(tx, tenantId, invoiceId);
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, tenantId, paymentMode: SalePaymentMode.CREDIT },
          include: { customer: true },
        });
        if (!invoice) {
          throw new NotFoundException('Credit invoice not found for tenant.');
        }
        if (!invoice.customerId || !invoice.customer) {
          throw new ConflictException('Credit invoice must have a registered customer.');
        }
        if (excludedReceivableStatuses.includes(invoice.status)) {
          throw new ConflictException('Invoice status does not allow receivable payments.');
        }
        if (
          invoice.balance.lte(0) ||
          invoice.status === InvoiceStatus.PAID ||
          invoice.status === InvoiceStatus.CREDITED
        ) {
          throw new ConflictException('Invoice has no outstanding balance.');
        }
        if (amount.gt(invoice.balance)) {
          throw new BadRequestException('Payment cannot exceed invoice balance.');
        }
        await this.lockCustomer(tx, tenantId, invoice.customerId);
        await this.lockCashSession(tx, tenantId, dto.cashSessionId);
        const cashSession = await tx.cashSession.findFirst({
          where: {
            id: dto.cashSessionId,
            tenantId,
            status: CashSessionStatus.OPEN,
          },
        });
        if (!cashSession) {
          throw new NotFoundException('Selected open cash session was not found.');
        }
        const paidAt = new Date();
        const nextPaid = invoice.paidAmount.add(amount).toDecimalPlaces(2);
        const nextBalance = invoice.balance.sub(amount).toDecimalPlaces(2);
        const nextStatus = nextBalance.isZero() ? InvoiceStatus.PAID : InvoiceStatus.PARTIALLY_PAID;
        const payment = await tx.payment.create({
          data: {
            tenantId,
            invoiceId,
            method: PaymentMethod.CASH,
            amount,
            status: PaymentStatus.COMPLETED,
            receiptNumber,
            userId: user.id,
            cashSessionId: cashSession.id,
            paidAt,
          },
        });
        await tx.cashMovement.create({
          data: {
            tenantId,
            cashSessionId: cashSession.id,
            userId: user.id,
            type: CashMovementType.CREDIT_PAYMENT,
            amount,
            method: PaymentMethod.CASH,
            reason: 'Abono de cuenta por cobrar',
            reference: receiptNumber,
            invoiceId,
          },
        });
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { paidAmount: nextPaid, balance: nextBalance, status: nextStatus },
        });
        await this.reconcileCustomerBalance(tx, tenantId, invoice.customerId);
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: user.id,
            action: 'RECEIVABLE_PAYMENT_CREATED',
            entity: 'Payment',
            entityId: payment.id,
            metadata: {
              invoiceId,
              invoiceNumber: invoice.invoiceNumber,
              receiptNumber,
              amount: amount.toString(),
              cashSessionId: dto.cashSessionId,
            },
          },
        });
        return { payment, invoiceNumber: invoice.invoiceNumber };
      });
    } catch (error) {
      if (dto.idempotencyKey) {
        const existing = await this.findIdempotentPayment(tenantId, receiptNumber);
        if (existing) {
          this.validateIdempotentPayment(existing, invoiceId, user.id, dto.cashSessionId, amount);
          return this.getPayment(tenantId, existing.id);
        }
      }
      throw error;
    }

    return this.getPayment(tenantId, result.payment.id);
  }

  async cancelPayment(
    tenantId: string,
    user: AuthenticatedUser,
    paymentId: string,
    dto: CancelReceivablePaymentDto,
  ) {
    this.requireAdmin(tenantId, user);
    if (!dto.reason.trim()) {
      throw new BadRequestException('A cancellation reason is required.');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockPayment(tx, tenantId, paymentId);
      const paymentHeader = await tx.payment.findFirst({
        where: {
          id: paymentId,
          tenantId,
          receiptNumber: { not: null },
          invoice: { paymentMode: SalePaymentMode.CREDIT },
        },
        select: { invoiceId: true, status: true },
      });
      if (!paymentHeader) {
        throw new NotFoundException('Receivable payment not found.');
      }
      if (paymentHeader.status === PaymentStatus.CANCELLED) {
        return;
      }
      if (paymentHeader.status !== PaymentStatus.COMPLETED) {
        throw new ConflictException('Only completed receivable payments can be cancelled.');
      }
      await this.lockInvoice(tx, tenantId, paymentHeader.invoiceId);
      const payment = await tx.payment.findFirst({
        where: {
          id: paymentId,
          tenantId,
          receiptNumber: { not: null },
          invoice: { paymentMode: SalePaymentMode.CREDIT },
        },
        include: { invoice: true },
      });
      if (!payment) {
        throw new NotFoundException('Active receivable payment not found.');
      }
      if (!payment.invoice.customerId) {
        throw new ConflictException('Credit invoice has no registered customer.');
      }
      if (payment.status === PaymentStatus.CANCELLED) {
        return;
      }
      if (payment.status !== PaymentStatus.COMPLETED) {
        throw new ConflictException('Only completed receivable payments can be cancelled.');
      }
      await this.lockCustomer(tx, tenantId, payment.invoice.customerId);
      await this.lockCashSession(tx, tenantId, dto.cashSessionId);
      const cashSession = await tx.cashSession.findFirst({
        where: { id: dto.cashSessionId, tenantId, status: CashSessionStatus.OPEN },
      });
      if (!cashSession) {
        throw new NotFoundException('Selected open cash session was not found.');
      }
      const nextPaid = payment.invoice.paidAmount.sub(payment.amount).toDecimalPlaces(2);
      if (nextPaid.lt(0)) {
        throw new ConflictException('Payment cancellation would make paid amount negative.');
      }
      const nextBalance = payment.invoice.balance.add(payment.amount).toDecimalPlaces(2);
      const nextStatus = nextBalance.isZero()
        ? InvoiceStatus.PAID
        : nextPaid.isZero()
          ? InvoiceStatus.ISSUED
          : InvoiceStatus.PARTIALLY_PAID;

      const cancelled = await tx.payment.updateMany({
        where: { id: payment.id, tenantId, status: PaymentStatus.COMPLETED },
        data: {
          status: PaymentStatus.CANCELLED,
          cancelledById: user.id,
          cancelledAt: new Date(),
          cancelReason: dto.reason.trim(),
        },
      });
      if (cancelled.count !== 1) {
        throw new ConflictException('Receivable payment was already cancelled.');
      }
      await tx.cashMovement.create({
        data: {
          tenantId,
          cashSessionId: cashSession.id,
          userId: user.id,
          type: CashMovementType.CASH_OUT,
          amount: payment.amount,
          method: PaymentMethod.CASH,
          reason: 'Anulación de abono de cuenta por cobrar',
          reference: payment.receiptNumber,
          invoiceId: payment.invoiceId,
        },
      });
      await tx.invoice.update({
        where: { id: payment.invoiceId },
        data: { paidAmount: nextPaid, balance: nextBalance, status: nextStatus },
      });
      await this.reconcileCustomerBalance(tx, tenantId, payment.invoice.customerId);
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: user.id,
          action: 'RECEIVABLE_PAYMENT_CANCELLED',
          entity: 'Payment',
          entityId: paymentId,
          metadata: {
            invoiceId: payment.invoiceId,
            amount: payment.amount.toString(),
            reason: dto.reason.trim(),
            cashSessionId: dto.cashSessionId,
          },
        },
      });
    });

    return this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: {
        invoice: { include: { customer: true } },
        cancelledBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  private async findIdempotentPayment(tenantId: string, receiptNumber: string) {
    return this.prisma.payment.findFirst({
      where: { tenantId, receiptNumber },
    });
  }

  private validateIdempotentPayment(
    payment: {
      invoiceId: string;
      userId: string | null;
      cashSessionId: string | null;
      method: PaymentMethod;
      amount: Prisma.Decimal;
    },
    invoiceId: string,
    userId: string,
    cashSessionId: string,
    amount: Prisma.Decimal,
  ) {
    if (
      payment.invoiceId !== invoiceId ||
      payment.userId !== userId ||
      payment.cashSessionId !== cashSessionId ||
      payment.method !== PaymentMethod.CASH ||
      !payment.amount.eq(amount)
    ) {
      throw new ConflictException('Idempotency key was already used for a different payment.');
    }
  }

  private getPayment(tenantId: string, paymentId: string) {
    return this.prisma.payment.findFirstOrThrow({
      where: { id: paymentId, tenantId },
      include: {
        invoice: { include: { customer: true } },
        user: { select: { id: true, name: true, email: true } },
        cashSession: { include: { cashRegister: true } },
        cancelledBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  private async lockPayment(tx: Prisma.TransactionClient, tenantId: string, paymentId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Payment"
      WHERE "id" = ${paymentId}
        AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new NotFoundException('Receivable payment not found.');
    }
  }

  private async lockInvoice(tx: Prisma.TransactionClient, tenantId: string, invoiceId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Invoice"
      WHERE "id" = ${invoiceId}
        AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new NotFoundException('Credit invoice not found for tenant.');
    }
  }

  private async lockCustomer(tx: Prisma.TransactionClient, tenantId: string, customerId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "Customer"
      WHERE "id" = ${customerId}
        AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new NotFoundException('Customer not found for tenant.');
    }
  }

  private async lockCashSession(
    tx: Prisma.TransactionClient,
    tenantId: string,
    cashSessionId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "CashSession"
      WHERE "id" = ${cashSessionId}
        AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new NotFoundException('Selected cash session was not found.');
    }
  }

  private async reconcileCustomerBalance(
    tx: Prisma.TransactionClient,
    tenantId: string,
    customerId: string,
  ) {
    const aggregate = await tx.invoice.aggregate({
      where: {
        tenantId,
        customerId,
        paymentMode: SalePaymentMode.CREDIT,
        status: { notIn: excludedReceivableStatuses },
      },
      _sum: { balance: true },
    });
    await tx.customer.update({
      where: { id: customerId },
      data: { creditBalance: aggregate._sum.balance ?? new Prisma.Decimal(0) },
    });
  }

  private decorateInvoice<
    T extends {
      dueDate: Date | null;
      createdAt: Date;
      balance: Prisma.Decimal;
      status: InvoiceStatus;
    },
  >(invoice: T) {
    return { ...invoice, dueBucket: this.getDueBucket(invoice) };
  }

  private getDueBucket(invoice: {
    dueDate: Date | null;
    balance: Prisma.Decimal;
    status: InvoiceStatus;
  }) {
    if (invoice.balance.lte(0) || invoice.status === InvoiceStatus.PAID) {
      return 'PAID';
    }
    if (!invoice.dueDate) {
      return 'CURRENT';
    }
    const today = businessDateKey(new Date());
    const due = businessDateKey(invoice.dueDate);
    if (due < today) {
      return 'OVERDUE';
    }
    if (due === today) {
      return 'TODAY';
    }
    const dueSoonLimit = businessDateKey(addBusinessDays(dueSoonDays));
    return due <= dueSoonLimit ? 'DUE_SOON' : 'CURRENT';
  }

  private requireAccess(tenantId: string, user: AuthenticatedUser) {
    const role = this.getRole(tenantId, user);
    if (!role || !receivableRoles.includes(role)) {
      throw new ForbiddenException('Accounts receivable access is required.');
    }
  }

  private requireAdmin(tenantId: string, user: AuthenticatedUser) {
    const role = this.getRole(tenantId, user);
    if (!role || !adminRoles.includes(role)) {
      throw new ForbiddenException('Administrator approval is required.');
    }
  }

  private getRole(tenantId: string, user: AuthenticatedUser) {
    return (
      user.memberships.find((membership) =>
        ([Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN] as Role[]).includes(membership.role),
      )?.role ?? user.memberships.find((membership) => membership.tenantId === tenantId)?.role
    );
  }

  private generateReceiptNumber(idempotencyKey?: string) {
    if (idempotencyKey) {
      return `AB-${idempotencyKey.toUpperCase()}`;
    }
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    return `AB-${stamp}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }
}
