import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CashMovementType,
  CashSessionStatus,
  EmployeeLogAction,
  EmployeeStatus,
  InventoryMovementType,
  InvoiceFiscalStatus,
  InvoiceStatus,
  PaymentMethod,
  Prisma,
  ProductUnit,
  ReturnRequestStatus,
  Role,
  SalePaymentMode,
} from '@qorvex/database';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApproveReturnRequestDto,
  CreateReturnRequestDto,
  RejectReturnRequestDto,
} from './dto/create-return-request.dto';

const adminRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];
const requestRoles: Role[] = [Role.CASHIER, ...adminRoles];
const requestBlockingStatuses: ReturnRequestStatus[] = [
  ReturnRequestStatus.REQUESTED,
  ReturnRequestStatus.APPROVED,
  ReturnRequestStatus.COMPLETED,
];
const returnableInvoiceStatuses: InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PAID,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.ACCEPTED,
  InvoiceStatus.PENDING_ECF,
];
const transactionOptions = {
  maxWait: 10_000,
  timeout: 20_000,
};

@Injectable()
export class ReturnsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, user: AuthenticatedUser, status?: string) {
    const membership = this.getMembership(tenantId, user);
    this.ensureCanRequestReturn(membership);
    const parsedStatus = this.parseStatus(status);
    const admin = this.isAdmin(membership);

    return this.prisma.returnRequest.findMany({
      where: {
        tenantId,
        ...(parsedStatus ? { status: parsedStatus } : {}),
        ...(admin ? {} : { requestedById: user.id }),
      },
      include: this.returnRequestInclude(),
      orderBy: { createdAt: 'desc' },
      take: 150,
    });
  }

  async lookupInvoice(tenantId: string, user: AuthenticatedUser, q: string) {
    const membership = this.getMembership(tenantId, user);
    this.ensureCanRequestReturn(membership);

    const query = q.trim();
    if (!query) {
      throw new BadRequestException('Invoice number is required for return lookup.');
    }

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        tenantId,
        OR: [
          { id: query },
          { invoiceNumber: { equals: query, mode: 'insensitive' } },
          { invoiceNumber: { contains: query, mode: 'insensitive' } },
          { ncf: { equals: query, mode: 'insensitive' } },
          { eNcf: { equals: query, mode: 'insensitive' } },
          { salesOrder: { is: { orderNumber: { equals: query, mode: 'insensitive' } } } },
          { salesOrder: { is: { orderNumber: { contains: query, mode: 'insensitive' } } } },
        ],
      },
      include: this.invoiceLookupInclude(),
      orderBy: { createdAt: 'desc' },
    });

    if (!invoice) {
      throw new NotFoundException('Invoice not found for return lookup.');
    }

    return this.attachReturnAvailability(tenantId, invoice);
  }

  async create(tenantId: string, user: AuthenticatedUser, dto: CreateReturnRequestDto) {
    const membership = this.getMembership(tenantId, user);
    this.ensureCanRequestReturn(membership);

    if (!this.isAdmin(membership)) {
      await this.ensureActiveEmployeeProfile(tenantId, user.id, 'request returns');
    }

    const reason = dto.reason.trim();
    if (!reason) {
      throw new BadRequestException('Return reason is required.');
    }

    if (!dto.items.length) {
      throw new BadRequestException('Return request must include at least one item.');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockInvoice(tx, tenantId, dto.invoiceId);
      const invoice = await tx.invoice.findFirst({
        where: { id: dto.invoiceId, tenantId },
        include: this.invoiceLookupInclude(),
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found for tenant.');
      }

      this.ensureFiscalReturnFlowIsAvailable(invoice.fiscalStatus);
      this.ensureInvoiceIsReturnable(invoice.status);

      const computedItems = await this.computeReturnItems(tx, tenantId, invoice, dto.items);
      const refundAmount = computedItems
        .reduce((sum, item) => sum.add(item.total), new Prisma.Decimal(0))
        .toDecimalPlaces(2);

      const request = await tx.returnRequest.create({
        data: {
          tenantId,
          invoiceId: invoice.id,
          requestedById: user.id,
          status: ReturnRequestStatus.REQUESTED,
          reason,
          refundMethod: dto.refundMethod ?? invoice.paymentMethod ?? PaymentMethod.CASH,
          refundAmount,
          items: {
            create: computedItems.map((item) => ({
              invoiceItemId: item.invoiceItemId,
              productId: item.productId,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountTotal: item.discountTotal,
              taxRate: item.taxRate,
              taxTotal: item.taxTotal,
              subtotal: item.subtotal,
              total: item.total,
              restock: item.restock,
            })),
          },
        },
        include: this.returnRequestInclude(),
      });

      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId: user.id,
          cashSessionId: invoice.cashSessionId,
          action: EmployeeLogAction.REQUEST_RETURN,
          entity: 'ReturnRequest',
          entityId: request.id,
          invoiceId: invoice.id,
          amount: refundAmount,
          metadata: {
            invoiceNumber: invoice.invoiceNumber,
            reason,
            itemCount: computedItems.length,
          },
        },
      });

      return request;
    }, transactionOptions);
  }

  async approve(
    tenantId: string,
    user: AuthenticatedUser,
    returnRequestId: string,
    dto: ApproveReturnRequestDto,
  ) {
    const membership = this.getMembership(tenantId, user);
    this.ensureCanApproveReturn(membership);

    return this.prisma.$transaction(async (tx) => {
      await this.lockReturnRequest(tx, tenantId, returnRequestId);
      const requestHeader = await tx.returnRequest.findFirst({
        where: {
          id: returnRequestId,
          tenantId,
        },
        select: { invoiceId: true },
      });

      if (!requestHeader) {
        throw new NotFoundException('Return request not found for tenant.');
      }
      await this.lockInvoice(tx, tenantId, requestHeader.invoiceId);
      const request = await tx.returnRequest.findFirst({
        where: {
          id: returnRequestId,
          tenantId,
        },
        include: this.returnRequestInclude(),
      });

      if (!request || request.status !== ReturnRequestStatus.REQUESTED) {
        throw new BadRequestException('Only requested returns can be approved.');
      }

      this.ensureFiscalReturnFlowIsAvailable(request.invoice.fiscalStatus);
      await this.ensureRequestCanStillBeCompleted(tx, tenantId, request);

      const refundMethod = dto.refundMethod ?? request.refundMethod ?? PaymentMethod.CASH;
      const isCreditReturn = request.invoice.paymentMode === SalePaymentMode.CREDIT;
      if (isCreditReturn && request.invoice.customerId) {
        await this.lockCustomer(tx, tenantId, request.invoice.customerId);
      }
      const creditAppliedAmount = isCreditReturn
        ? Prisma.Decimal.min(request.refundAmount, request.invoice.balance).toDecimalPlaces(2)
        : new Prisma.Decimal(0);
      const cashRefundAmount = request.refundAmount.sub(creditAppliedAmount).toDecimalPlaces(2);
      const cashSession = cashRefundAmount.gt(0)
        ? await this.resolveCashSessionForRefund(tx, tenantId, dto.cashSessionId)
        : null;
      if (
        isCreditReturn &&
        request.refundAmount.gt(request.invoice.balance.add(request.invoice.paidAmount))
      ) {
        throw new BadRequestException(
          'Return exceeds the remaining paid amount and receivable balance.',
        );
      }
      const approvedAt = new Date();
      const claimed = await tx.returnRequest.updateMany({
        where: {
          id: request.id,
          tenantId,
          status: ReturnRequestStatus.REQUESTED,
        },
        data: {
          status: ReturnRequestStatus.APPROVED,
          approvedById: user.id,
          approvedAt,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('Only requested returns can be approved.');
      }

      const restockItems = request.items
        .filter((item) => item.restock && item.productId)
        .sort((a, b) => a.productId!.localeCompare(b.productId!));
      for (const item of restockItems) {
        if (!item.restock || !item.productId) {
          continue;
        }

        const product = await tx.product.findFirst({
          where: { id: item.productId, tenantId },
        });

        if (!product || !product.trackInventory) {
          continue;
        }

        const quantity = item.quantity.toNumber();
        if (requiresWholeQuantity(product.unit) && !Number.isInteger(quantity)) {
          throw new BadRequestException(
            `Tracked product ${product.name} requires whole quantities.`,
          );
        }

        const updated = await tx.$queryRaw<Array<{ stock: number }>>`
          UPDATE "Product"
          SET "stock" = "stock" + ${quantity}
          WHERE "id" = ${product.id}
            AND "tenantId" = ${tenantId}
            AND "trackInventory" = TRUE
          RETURNING "stock"
        `;
        if (updated.length !== 1) {
          throw new BadRequestException(`Product ${product.name} is no longer returnable.`);
        }
        const newStock = updated[0].stock;
        const previousStock = newStock - quantity;

        await tx.inventoryMovement.create({
          data: {
            tenantId,
            productId: product.id,
            type: InventoryMovementType.RETURN,
            quantity,
            previousStock,
            newStock,
            unitCost: product.cost,
            reason: `Devolucion aprobada: ${request.reason}`,
            reference: request.invoice.invoiceNumber,
            invoiceId: request.invoiceId,
            createdById: user.id,
          },
        });
      }

      if (cashRefundAmount.gt(0) && cashSession) {
        await tx.cashMovement.create({
          data: {
            tenantId,
            cashSessionId: cashSession.id,
            userId: user.id,
            type: CashMovementType.REFUND,
            amount: cashRefundAmount,
            method: refundMethod,
            reason: dto.adminNote?.trim() || request.reason,
            reference: request.invoice.invoiceNumber,
            invoiceId: request.invoiceId,
          },
        });
      }

      const completedAt = new Date();
      const completed = await tx.returnRequest.updateMany({
        where: {
          id: request.id,
          tenantId,
          status: ReturnRequestStatus.APPROVED,
        },
        data: {
          status: ReturnRequestStatus.COMPLETED,
          cashSessionId: cashSession?.id,
          refundMethod,
          creditAppliedAmount,
          cashRefundAmount,
          adminNote: dto.adminNote?.trim() || undefined,
          completedAt,
        },
      });
      if (completed.count !== 1) {
        throw new BadRequestException('Return request could not be completed.');
      }

      if (isCreditReturn && request.invoice.customerId) {
        const nextBalance = request.invoice.balance.sub(creditAppliedAmount).toDecimalPlaces(2);
        const nextPaidAmount = request.invoice.paidAmount.sub(cashRefundAmount).toDecimalPlaces(2);
        if (nextPaidAmount.lt(0)) {
          throw new BadRequestException(
            'Return would refund more than the amount paid on the credit invoice.',
          );
        }
        const nextStatus = nextBalance.isZero()
          ? InvoiceStatus.PAID
          : nextPaidAmount.gt(0)
            ? InvoiceStatus.PARTIALLY_PAID
            : InvoiceStatus.ISSUED;
        await tx.invoice.update({
          where: { id: request.invoiceId },
          data: {
            paidAmount: nextPaidAmount,
            balance: nextBalance,
            status: nextStatus,
          },
        });
        const creditBalance = await tx.invoice.aggregate({
          where: {
            tenantId,
            customerId: request.invoice.customerId,
            paymentMode: SalePaymentMode.CREDIT,
            status: {
              notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.VOID, InvoiceStatus.VOIDED],
            },
          },
          _sum: { balance: true },
        });
        await tx.customer.update({
          where: { id: request.invoice.customerId },
          data: { creditBalance: creditBalance._sum.balance ?? new Prisma.Decimal(0) },
        });
      }

      await this.creditInvoiceIfFullyReturned(tx, tenantId, request.invoiceId);

      await tx.employeeActivityLog.createMany({
        data: [
          {
            tenantId,
            userId: user.id,
            cashSessionId: cashSession?.id,
            action: EmployeeLogAction.APPROVE_RETURN,
            entity: 'ReturnRequest',
            entityId: request.id,
            invoiceId: request.invoiceId,
            amount: request.refundAmount,
            metadata: {
              invoiceNumber: request.invoice.invoiceNumber,
              refundMethod,
              creditAppliedAmount: creditAppliedAmount.toString(),
              cashRefundAmount: cashRefundAmount.toString(),
              adminNote: dto.adminNote,
            },
          },
          {
            tenantId,
            userId: user.id,
            cashSessionId: cashSession?.id,
            action: EmployeeLogAction.COMPLETE_RETURN,
            entity: 'ReturnRequest',
            entityId: request.id,
            invoiceId: request.invoiceId,
            amount: request.refundAmount,
            metadata: {
              invoiceNumber: request.invoice.invoiceNumber,
              creditAppliedAmount: creditAppliedAmount.toString(),
              cashRefundAmount: cashRefundAmount.toString(),
              restockedItems: request.items.filter((item) => item.restock).length,
            },
          },
        ],
      });

      return tx.returnRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: this.returnRequestInclude(),
      });
    }, transactionOptions);
  }

  async reject(
    tenantId: string,
    user: AuthenticatedUser,
    returnRequestId: string,
    dto: RejectReturnRequestDto,
  ) {
    const membership = this.getMembership(tenantId, user);
    this.ensureCanApproveReturn(membership);
    const adminNote = dto.adminNote.trim();

    if (!adminNote) {
      throw new BadRequestException('Return rejection reason is required.');
    }

    return this.prisma.$transaction(async (tx) => {
      await this.lockReturnRequest(tx, tenantId, returnRequestId);
      const request = await tx.returnRequest.findFirst({
        where: {
          id: returnRequestId,
          tenantId,
        },
        include: this.returnRequestInclude(),
      });

      if (!request) {
        throw new NotFoundException('Return request not found for tenant.');
      }

      if (request.status !== ReturnRequestStatus.REQUESTED) {
        throw new BadRequestException('Only requested returns can be rejected.');
      }

      const rejectedRows = await tx.returnRequest.updateMany({
        where: {
          id: request.id,
          tenantId,
          status: ReturnRequestStatus.REQUESTED,
        },
        data: {
          status: ReturnRequestStatus.REJECTED,
          rejectedById: user.id,
          rejectedAt: new Date(),
          adminNote,
        },
      });
      if (rejectedRows.count !== 1) {
        throw new BadRequestException('Only requested returns can be rejected.');
      }
      const rejected = await tx.returnRequest.findUniqueOrThrow({
        where: { id: request.id },
        include: this.returnRequestInclude(),
      });

      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId: user.id,
          cashSessionId: request.invoice.cashSessionId,
          action: EmployeeLogAction.REJECT_RETURN,
          entity: 'ReturnRequest',
          entityId: request.id,
          invoiceId: request.invoiceId,
          amount: request.refundAmount,
          metadata: {
            invoiceNumber: request.invoice.invoiceNumber,
            reason: adminNote,
          },
        },
      });

      return rejected;
    }, transactionOptions);
  }

  private async attachReturnAvailability<
    TInvoice extends {
      items: Array<{
        id: string;
        quantity: Prisma.Decimal;
      }>;
    },
  >(tenantId: string, invoice: TInvoice) {
    const returnedByItem = await this.getReturnedQuantities(
      this.prisma,
      tenantId,
      invoice.items.map((item) => item.id),
      requestBlockingStatuses,
    );

    return {
      ...invoice,
      items: invoice.items.map((item) => {
        const returnedQuantity = returnedByItem.get(item.id) ?? new Prisma.Decimal(0);
        const rawRemainingQuantity = item.quantity.sub(returnedQuantity);
        const remainingQuantity = rawRemainingQuantity.gt(0)
          ? rawRemainingQuantity
          : new Prisma.Decimal(0);

        return {
          ...item,
          returnedQuantity: returnedQuantity.toDecimalPlaces(2).toString(),
          remainingQuantity: remainingQuantity.toDecimalPlaces(2).toString(),
          canReturn: remainingQuantity.gt(0),
        };
      }),
    };
  }

  private async computeReturnItems(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoice: ReturnInvoice,
    requestedItems: CreateReturnRequestDto['items'],
  ) {
    const itemsById = new Map(invoice.items.map((item) => [item.id, item]));
    const quantitiesByItem = new Map<string, { quantity: Prisma.Decimal; restock: boolean }>();

    for (const requestedItem of requestedItems) {
      const quantity = new Prisma.Decimal(requestedItem.quantity).toDecimalPlaces(2);
      if (quantity.lte(0)) {
        throw new BadRequestException('Return quantities must be greater than zero.');
      }

      const current = quantitiesByItem.get(requestedItem.invoiceItemId);
      quantitiesByItem.set(requestedItem.invoiceItemId, {
        quantity: current ? current.quantity.add(quantity).toDecimalPlaces(2) : quantity,
        restock: requestedItem.restock ?? current?.restock ?? true,
      });
    }

    const returnedByItem = await this.getReturnedQuantities(
      tx,
      tenantId,
      Array.from(quantitiesByItem.keys()),
      requestBlockingStatuses,
    );

    const computedItems = Array.from(quantitiesByItem.entries()).map(
      ([invoiceItemId, requested]) => {
        const invoiceItem = itemsById.get(invoiceItemId);

        if (!invoiceItem) {
          throw new BadRequestException('Return item does not belong to the selected invoice.');
        }

        const returnedQuantity = returnedByItem.get(invoiceItemId) ?? new Prisma.Decimal(0);
        const remainingQuantity = invoiceItem.quantity.sub(returnedQuantity).toDecimalPlaces(2);

        if (requested.quantity.gt(remainingQuantity)) {
          throw new BadRequestException('Return quantity exceeds invoice remaining quantity.');
        }

        const ratio = requested.quantity.div(invoiceItem.quantity);
        const discountTotal = invoiceItem.discountTotal.mul(ratio).toDecimalPlaces(2);
        const subtotal = invoiceItem.subtotal.mul(ratio).toDecimalPlaces(2);
        const taxTotal = invoiceItem.taxTotal.mul(ratio).toDecimalPlaces(2);
        const total = invoiceItem.total.mul(ratio).toDecimalPlaces(2);

        return {
          invoiceItemId,
          productId: invoiceItem.productId,
          description: invoiceItem.description,
          quantity: requested.quantity,
          unitPrice: invoiceItem.unitPrice,
          discountTotal,
          taxRate: invoiceItem.taxRate,
          taxTotal,
          subtotal,
          total,
          restock: requested.restock,
        };
      },
    );

    if (!computedItems.length) {
      throw new BadRequestException('Return request must include at least one item.');
    }

    return computedItems;
  }

  private async ensureRequestCanStillBeCompleted(
    tx: Prisma.TransactionClient,
    tenantId: string,
    request: ReturnRequestForApproval,
  ) {
    const completedByItem = await this.getReturnedQuantities(
      tx,
      tenantId,
      request.items.map((item) => item.invoiceItemId),
      [ReturnRequestStatus.COMPLETED],
      request.id,
    );

    for (const item of request.items) {
      const invoiceItem = request.invoice.items.find(
        (candidate) => candidate.id === item.invoiceItemId,
      );
      if (!invoiceItem) {
        throw new BadRequestException('Return item is no longer linked to the invoice.');
      }

      const completedQuantity = completedByItem.get(item.invoiceItemId) ?? new Prisma.Decimal(0);
      if (completedQuantity.add(item.quantity).gt(invoiceItem.quantity)) {
        throw new BadRequestException('Return quantity exceeds invoice remaining quantity.');
      }
    }
  }

  private async resolveCashSessionForRefund(
    tx: Prisma.TransactionClient,
    tenantId: string,
    cashSessionId?: string,
  ) {
    if (cashSessionId) {
      await this.lockCashSession(tx, tenantId, cashSessionId);
      const cashSession = await tx.cashSession.findFirst({
        where: {
          id: cashSessionId,
          tenantId,
          status: CashSessionStatus.OPEN,
        },
        include: { cashRegister: true },
      });

      if (!cashSession) {
        throw new NotFoundException('Open cash session not found for tenant.');
      }

      return cashSession;
    }

    const openSessions = await tx.cashSession.findMany({
      where: {
        tenantId,
        status: CashSessionStatus.OPEN,
      },
      include: { cashRegister: true },
      orderBy: { openedAt: 'desc' },
      take: 2,
    });

    if (!openSessions.length) {
      throw new BadRequestException('An open cash session is required to approve a return.');
    }

    if (openSessions.length > 1) {
      throw new BadRequestException('Select an open cash session for this refund.');
    }

    await this.lockCashSession(tx, tenantId, openSessions[0].id);
    const cashSession = await tx.cashSession.findFirst({
      where: {
        id: openSessions[0].id,
        tenantId,
        status: CashSessionStatus.OPEN,
      },
      include: { cashRegister: true },
    });
    if (!cashSession) {
      throw new BadRequestException('Selected cash session is no longer open.');
    }
    return cashSession;
  }

  private async lockReturnRequest(
    tx: Prisma.TransactionClient,
    tenantId: string,
    returnRequestId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "ReturnRequest"
      WHERE "id" = ${returnRequestId}
        AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    if (rows.length !== 1) {
      throw new NotFoundException('Return request not found for tenant.');
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
      throw new NotFoundException('Invoice not found for tenant.');
    }
  }

  private ensureFiscalReturnFlowIsAvailable(fiscalStatus: InvoiceFiscalStatus) {
    if (
      fiscalStatus === InvoiceFiscalStatus.LOCAL_ISSUED ||
      fiscalStatus === InvoiceFiscalStatus.LEGACY_UNVERIFIED
    ) {
      throw new BadRequestException(
        'Las devoluciones de facturas con NCF requieren una Nota de Crédito B04. Configura ese flujo fiscal antes de procesarlas.',
      );
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
      throw new NotFoundException('Cash session not found for tenant.');
    }
  }

  private async creditInvoiceIfFullyReturned(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
  ) {
    const invoice = await tx.invoice.findFirst({
      where: {
        id: invoiceId,
        tenantId,
      },
      include: { items: true },
    });

    if (!invoice) {
      return;
    }

    const returnedByItem = await this.getReturnedQuantities(
      tx,
      tenantId,
      invoice.items.map((item) => item.id),
      [ReturnRequestStatus.COMPLETED],
    );
    const fullyReturned = invoice.items.every((item) => {
      const returnedQuantity = returnedByItem.get(item.id) ?? new Prisma.Decimal(0);
      return returnedQuantity.gte(item.quantity);
    });

    if (fullyReturned) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.CREDITED },
      });
    }
  }

  private async getReturnedQuantities(
    client: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    invoiceItemIds: string[],
    statuses: ReturnRequestStatus[],
    excludeReturnRequestId?: string,
  ) {
    if (!invoiceItemIds.length) {
      return new Map<string, Prisma.Decimal>();
    }

    const rows = await client.returnRequestItem.groupBy({
      by: ['invoiceItemId'],
      where: {
        invoiceItemId: { in: invoiceItemIds },
        returnRequest: {
          is: {
            tenantId,
            status: { in: statuses },
            ...(excludeReturnRequestId ? { id: { not: excludeReturnRequestId } } : {}),
          },
        },
      },
      _sum: {
        quantity: true,
      },
    });

    return new Map(
      rows.map((row) => [
        row.invoiceItemId,
        row._sum.quantity ? new Prisma.Decimal(row._sum.quantity) : new Prisma.Decimal(0),
      ]),
    );
  }

  private parseStatus(status?: string) {
    if (!status || status === 'ALL') {
      return undefined;
    }

    if (!Object.values(ReturnRequestStatus).includes(status as ReturnRequestStatus)) {
      throw new BadRequestException('Invalid return request status.');
    }

    return status as ReturnRequestStatus;
  }

  private ensureInvoiceIsReturnable(status: InvoiceStatus) {
    if (!returnableInvoiceStatuses.includes(status)) {
      throw new BadRequestException('Invoice status does not allow returns.');
    }
  }

  private getMembership(tenantId: string, user: AuthenticatedUser) {
    const membership =
      user.memberships.find((candidate) =>
        ([Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN] as Role[]).includes(candidate.role),
      ) ?? user.memberships.find((candidate) => candidate.tenantId === tenantId);

    if (!membership) {
      throw new ForbiddenException('User does not belong to this tenant.');
    }

    return membership;
  }

  private ensureCanRequestReturn(membership: AuthenticatedUser['memberships'][number]) {
    if (
      !requestRoles.includes(membership.role) &&
      !(membership.canUsePos && membership.role === Role.CASHIER)
    ) {
      throw new ForbiddenException('Employee does not have permission to request returns.');
    }
  }

  private ensureCanApproveReturn(membership: AuthenticatedUser['memberships'][number]) {
    if (!this.isAdmin(membership)) {
      throw new ForbiddenException('Only admins can approve or reject returns.');
    }
  }

  private isAdmin(membership: AuthenticatedUser['memberships'][number]) {
    return adminRoles.includes(membership.role);
  }

  private async ensureActiveEmployeeProfile(tenantId: string, userId: string, operation: string) {
    const employee = await this.prisma.employeeProfile.findFirst({
      where: {
        tenantId,
        userId,
        status: EmployeeStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (!employee) {
      throw new ForbiddenException(`Employee profile must be active to ${operation}.`);
    }
  }

  private invoiceLookupInclude() {
    return {
      tenant: true,
      customer: true,
      issuedBy: { select: { id: true, name: true, email: true } },
      cashSession: {
        include: {
          cashRegister: true,
        },
      },
      salesOrder: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
        },
      },
      items: {
        include: {
          product: true,
        },
        orderBy: { description: 'asc' as const },
      },
    };
  }

  private returnRequestInclude() {
    return {
      invoice: {
        include: this.invoiceLookupInclude(),
      },
      requestedBy: { select: { id: true, name: true, email: true } },
      approvedBy: { select: { id: true, name: true, email: true } },
      rejectedBy: { select: { id: true, name: true, email: true } },
      cashSession: {
        include: {
          cashRegister: true,
          openedBy: { select: { id: true, name: true, email: true } },
        },
      },
      items: {
        include: {
          invoiceItem: true,
          product: true,
        },
        orderBy: { description: 'asc' as const },
      },
    };
  }
}

type ReturnInvoice = {
  status: InvoiceStatus;
  paymentMethod: PaymentMethod | null;
  cashSessionId: string | null;
  invoiceNumber: string;
  items: Array<{
    id: string;
    productId: string | null;
    description: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    discountTotal: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    taxTotal: Prisma.Decimal;
    subtotal: Prisma.Decimal;
    total: Prisma.Decimal;
  }>;
};

type ReturnRequestForApproval = {
  id: string;
  invoiceId: string;
  reason: string;
  refundAmount: Prisma.Decimal;
  refundMethod: PaymentMethod | null;
  invoice: {
    invoiceNumber: string;
    cashSessionId: string | null;
    items: Array<{
      id: string;
      quantity: Prisma.Decimal;
    }>;
  };
  items: Array<{
    invoiceItemId: string;
    productId: string | null;
    quantity: Prisma.Decimal;
    restock: boolean;
  }>;
};

function requiresWholeQuantity(unit: ProductUnit) {
  const fractionalUnits: ProductUnit[] = [
    ProductUnit.METER,
    ProductUnit.FOOT,
    ProductUnit.YARD,
    ProductUnit.POUND,
  ];

  return !fractionalUnits.includes(unit);
}
