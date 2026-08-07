import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CreditApprovalStatus,
  CustomerCreditStatus,
  CustomerStatus,
  InvoiceStatus,
  Prisma,
  Role,
  SalePaymentMode,
  SalesOrderStatus,
} from '@qorvex/database';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { PrismaService } from '../../prisma/prisma.service';
import { ApproveCreditSaleDto, RejectCreditSaleDto } from './dto/credit-approval.dto';

const accountingRoles: Role[] = [
  Role.ACCOUNTANT,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.QORVEX_SUPER_ADMIN,
];
const adminRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];

const approvalInclude = {
  customer: true,
  requestedBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
  rejectedBy: { select: { id: true, name: true, email: true } },
  salesOrder: {
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      items: {
        include: { product: true },
        orderBy: { description: 'asc' as const },
      },
    },
  },
} satisfies Prisma.CreditSaleApprovalInclude;

type CreditApprovalDetail = Prisma.CreditSaleApprovalGetPayload<{
  include: typeof approvalInclude;
}>;

@Injectable()
export class CreditApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, user: AuthenticatedUser, status?: string) {
    this.requireAccountingAccess(tenantId, user);
    const parsedStatus = status ? this.parseStatus(status) : undefined;
    return this.prisma.creditSaleApproval.findMany({
      where: { tenantId, ...(parsedStatus ? { status: parsedStatus } : {}) },
      include: approvalInclude,
      orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
    });
  }

  async approve(tenantId: string, user: AuthenticatedUser, id: string, dto: ApproveCreditSaleDto) {
    this.requireAdmin(tenantId, user);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const approval = await tx.creditSaleApproval.findFirst({
          where: { id, tenantId, status: CreditApprovalStatus.PENDING },
          include: approvalInclude,
        });
        if (!approval) {
          throw new NotFoundException('Pending credit approval not found.');
        }
        this.ensureApprovalIntegrity(approval);
        if (
          approval.salesOrder.status !== SalesOrderStatus.CREATED ||
          approval.salesOrder.paymentMode !== SalePaymentMode.CREDIT
        ) {
          throw new BadRequestException('Sales order is not waiting for credit approval.');
        }
        if (
          approval.customer.status !== CustomerStatus.ACTIVE ||
          !approval.customer.creditEnabled ||
          approval.customer.creditStatus !== CustomerCreditStatus.ACTIVE
        ) {
          throw new BadRequestException('Customer credit is disabled, blocked, or inactive.');
        }

        const now = new Date();
        if (approval.expiresAt && approval.expiresAt <= now) {
          await this.lockPendingCreditOrder(tx, tenantId, approval.salesOrderId);
          const expired = await tx.creditSaleApproval.updateMany({
            where: {
              id: approval.id,
              tenantId,
              status: CreditApprovalStatus.PENDING,
            },
            data: {
              status: CreditApprovalStatus.EXPIRED,
              decisionNote: 'Solicitud expirada antes de la aprobación',
            },
          });
          if (expired.count !== 1) {
            throw new ConflictException('Credit approval changed concurrently.');
          }
          const cancelledOrder = await tx.salesOrder.updateMany({
            where: {
              id: approval.salesOrderId,
              tenantId,
              status: SalesOrderStatus.CREATED,
              paymentMode: SalePaymentMode.CREDIT,
            },
            data: {
              status: SalesOrderStatus.CANCELLED,
              cancelledAt: now,
              cancelReason: 'Solicitud de crédito expirada',
            },
          });
          if (cancelledOrder.count !== 1) {
            throw new ConflictException(
              'Expired credit approval could not cancel its pending sales order.',
            );
          }
          await tx.auditLog.create({
            data: {
              tenantId,
              userId: user.id,
              action: 'CREDIT_SALE_EXPIRED',
              entity: 'CreditSaleApproval',
              entityId: approval.id,
              metadata: {
                salesOrderId: approval.salesOrderId,
                orderNumber: approval.salesOrder.orderNumber,
                expiresAt: approval.expiresAt.toISOString(),
              },
            },
          });
          return { expired: true as const };
        }

        const balanceAggregate = await tx.invoice.aggregate({
          where: {
            tenantId,
            customerId: approval.customerId,
            paymentMode: SalePaymentMode.CREDIT,
            status: {
              notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.VOID, InvoiceStatus.VOIDED],
            },
          },
          _sum: { balance: true },
        });
        const currentBalance = (
          balanceAggregate._sum.balance ?? new Prisma.Decimal(0)
        ).toDecimalPlaces(2);
        const projectedBalance = currentBalance.add(approval.financedAmount).toDecimalPlaces(2);
        const exceedsLimit = projectedBalance.gt(approval.customer.creditLimit);
        if (exceedsLimit && !dto.authorizeLimitExcess) {
          throw new BadRequestException(
            'Projected debt exceeds the customer credit limit. Explicit authorization is required.',
          );
        }
        if (exceedsLimit && !dto.decisionNote?.trim()) {
          throw new BadRequestException(
            'A decision note is required when authorizing a credit limit excess.',
          );
        }

        const sentToCashier = await tx.salesOrder.updateMany({
          where: {
            id: approval.salesOrderId,
            tenantId,
            status: SalesOrderStatus.CREATED,
            paymentMode: SalePaymentMode.CREDIT,
          },
          data: {
            status: SalesOrderStatus.SENT_TO_CASHIER,
            sentToCashierAt: now,
          },
        });
        if (sentToCashier.count !== 1) {
          throw new ConflictException('Credit sales order changed concurrently.');
        }

        const orderedItems = [...approval.salesOrder.items].sort((left, right) =>
          (left.productId ?? '').localeCompare(right.productId ?? ''),
        );
        for (const item of orderedItems) {
          if (!item.productId || !item.product?.trackInventory) {
            continue;
          }
          const quantity = Number(item.quantity);
          const changed = await tx.$executeRaw`
            UPDATE "Product"
            SET "reservedStock" = "reservedStock" + ${quantity}
            WHERE "id" = ${item.productId}
              AND "tenantId" = ${tenantId}
              AND ("stock" - "reservedStock") >= ${quantity}
          `;
          if (changed !== 1) {
            throw new BadRequestException(`Insufficient available stock for ${item.description}.`);
          }
          await tx.salesOrderItem.update({
            where: { id: item.id },
            data: { reservedQuantity: quantity },
          });
        }

        const approved = await tx.creditSaleApproval.updateMany({
          where: {
            id,
            tenantId,
            status: CreditApprovalStatus.PENDING,
          },
          data: {
            status: CreditApprovalStatus.APPROVED,
            approvedById: user.id,
            approvedAt: now,
            decisionNote: dto.decisionNote?.trim() || null,
            customerBalanceSnapshot: currentBalance,
            creditLimitSnapshot: approval.customer.creditLimit,
            exceedsCreditLimit: exceedsLimit,
          },
        });
        if (approved.count !== 1) {
          throw new ConflictException('Credit approval changed concurrently.');
        }

        const approvedResult = await tx.creditSaleApproval.findUniqueOrThrow({
          where: { id },
          include: approvalInclude,
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: user.id,
            action: 'CREDIT_SALE_APPROVED',
            entity: 'CreditSaleApproval',
            entityId: id,
            metadata: {
              salesOrderId: approvedResult.salesOrderId,
              orderNumber: approvedResult.salesOrder.orderNumber,
              customerId: approvedResult.customerId,
              financedAmount: approvedResult.financedAmount.toString(),
              exceedsCreditLimit: approvedResult.exceedsCreditLimit,
            },
          },
        });

        return { expired: false as const, approval: approvedResult };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (result.expired) {
      throw new ConflictException(
        'Credit approval expired and its pending sales order was cancelled.',
      );
    }

    return result.approval;
  }

  async reject(tenantId: string, user: AuthenticatedUser, id: string, dto: RejectCreditSaleDto) {
    this.requireAdmin(tenantId, user);
    if (!dto.reason.trim()) {
      throw new BadRequestException('A rejection reason is required.');
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const approval = await tx.creditSaleApproval.findFirst({
          where: { id, tenantId, status: CreditApprovalStatus.PENDING },
          include: approvalInclude,
        });
        if (!approval) {
          throw new NotFoundException('Pending credit approval not found.');
        }
        this.ensureApprovalIntegrity(approval);
        if (
          approval.salesOrder.status !== SalesOrderStatus.CREATED ||
          approval.salesOrder.paymentMode !== SalePaymentMode.CREDIT
        ) {
          throw new BadRequestException('Sales order is not waiting for credit approval.');
        }
        const now = new Date();
        await this.lockPendingCreditOrder(tx, tenantId, approval.salesOrderId);
        if (approval.expiresAt && approval.expiresAt <= now) {
          const expired = await tx.creditSaleApproval.updateMany({
            where: {
              id: approval.id,
              tenantId,
              status: CreditApprovalStatus.PENDING,
            },
            data: {
              status: CreditApprovalStatus.EXPIRED,
              decisionNote: 'Solicitud expirada antes de la decisión',
            },
          });
          if (expired.count !== 1) {
            throw new ConflictException('Credit approval changed concurrently.');
          }
          const expiredOrder = await tx.salesOrder.updateMany({
            where: {
              id: approval.salesOrderId,
              tenantId,
              status: SalesOrderStatus.CREATED,
              paymentMode: SalePaymentMode.CREDIT,
            },
            data: {
              status: SalesOrderStatus.CANCELLED,
              cancelledAt: now,
              cancelReason: 'Solicitud de crédito expirada',
            },
          });
          if (expiredOrder.count !== 1) {
            throw new ConflictException(
              'Expired credit approval could not cancel its pending sales order.',
            );
          }
          await tx.auditLog.create({
            data: {
              tenantId,
              userId: user.id,
              action: 'CREDIT_SALE_EXPIRED',
              entity: 'CreditSaleApproval',
              entityId: approval.id,
              metadata: {
                salesOrderId: approval.salesOrderId,
                orderNumber: approval.salesOrder.orderNumber,
                expiresAt: approval.expiresAt.toISOString(),
              },
            },
          });
          return { expired: true as const };
        }

        const rejected = await tx.creditSaleApproval.updateMany({
          where: {
            id,
            tenantId,
            status: CreditApprovalStatus.PENDING,
          },
          data: {
            status: CreditApprovalStatus.REJECTED,
            rejectedById: user.id,
            rejectedAt: now,
            decisionNote: dto.reason.trim(),
          },
        });
        if (rejected.count !== 1) {
          throw new ConflictException('Credit approval changed concurrently.');
        }
        const cancelledOrder = await tx.salesOrder.updateMany({
          where: {
            id: approval.salesOrderId,
            tenantId,
            status: SalesOrderStatus.CREATED,
            paymentMode: SalePaymentMode.CREDIT,
          },
          data: {
            status: SalesOrderStatus.CANCELLED,
            cancelledAt: now,
            cancelReason: `Crédito rechazado: ${dto.reason.trim()}`,
          },
        });
        if (cancelledOrder.count !== 1) {
          throw new ConflictException('Credit sales order changed concurrently.');
        }
        const rejectedResult = await tx.creditSaleApproval.findUniqueOrThrow({
          where: { id },
          include: approvalInclude,
        });
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: user.id,
            action: 'CREDIT_SALE_REJECTED',
            entity: 'CreditSaleApproval',
            entityId: id,
            metadata: {
              salesOrderId: rejectedResult.salesOrderId,
              orderNumber: rejectedResult.salesOrder.orderNumber,
              reason: dto.reason.trim(),
            },
          },
        });
        return { expired: false as const, approval: rejectedResult };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    if (result.expired) {
      throw new ConflictException(
        'Credit approval expired and its pending sales order was cancelled.',
      );
    }
    return result.approval;
  }

  private async lockPendingCreditOrder(
    tx: Prisma.TransactionClient,
    tenantId: string,
    salesOrderId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "SalesOrder"
      WHERE "id" = ${salesOrderId}
        AND "tenantId" = ${tenantId}
        AND "status" = CAST(${SalesOrderStatus.CREATED} AS "SalesOrderStatus")
        AND "paymentMode" = CAST(${SalePaymentMode.CREDIT} AS "SalePaymentMode")
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new ConflictException('Credit sales order changed concurrently.');
    }
  }

  private ensureApprovalIntegrity(approval: CreditApprovalDetail) {
    const order = approval.salesOrder;
    const dueDatesMatch =
      order.dueDate !== null && order.dueDate.getTime() === approval.dueDate.getTime();
    const financedAmount = approval.requestedTotal
      .sub(approval.initialPaymentAmount)
      .toDecimalPlaces(2);

    if (
      order.customerId !== approval.customerId ||
      order.paymentMode !== SalePaymentMode.CREDIT ||
      order.initialPaymentOption !== approval.initialPaymentOption ||
      order.creditTermOption !== approval.creditTermOption ||
      !order.total.eq(approval.requestedTotal) ||
      !order.initialPaymentAmount.eq(approval.initialPaymentAmount) ||
      !approval.financedAmount.eq(financedAmount) ||
      !dueDatesMatch
    ) {
      throw new ConflictException(
        'Credit approval no longer matches its sales order and must not be processed.',
      );
    }
  }

  private requireAccountingAccess(tenantId: string, user: AuthenticatedUser) {
    const role = this.getRole(tenantId, user);
    if (!role || !accountingRoles.includes(role)) {
      throw new ForbiddenException('Credit approval access is required.');
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

  private parseStatus(value: string) {
    if (!Object.values(CreditApprovalStatus).includes(value as CreditApprovalStatus)) {
      throw new BadRequestException('Invalid credit approval status.');
    }
    return value as CreditApprovalStatus;
  }
}
