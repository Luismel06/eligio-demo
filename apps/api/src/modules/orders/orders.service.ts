import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CashSessionStatus,
  CreditApprovalStatus,
  CreditTermOption,
  CustomerCreditStatus,
  CustomerStatus,
  DocumentType,
  EmployeeLogAction,
  EmployeeStatus,
  FiscalDocumentPurpose,
  InitialPaymentOption,
  InvoiceDocumentType,
  InvoiceStatus,
  Prisma,
  ProductStatus,
  ProductUnit,
  Role,
  SalePaymentMode,
  SalesOrderDestination,
  SalesOrderPriceLevel,
  SalesOrderStatus,
} from '@qorvex/database';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import {
  normalizeDominicanDocument,
  validateDominicanCedula,
  validateDominicanRnc,
} from '../../common/utils/dominican-documents';
import { getBarcodeLookupCandidates } from '../../common/utils/barcode';
import {
  addBusinessDays,
  businessDateKey,
  parseBusinessDate,
} from '../../common/utils/business-date';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CancelSalesOrderDto,
  ClaimSalesOrderDto,
  CreateSalesOrderDto,
  SalesOrderItemDto,
} from './dto/create-sales-order.dto';

const adminRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];
const openOrderStatuses: SalesOrderStatus[] = [
  SalesOrderStatus.CREATED,
  SalesOrderStatus.SENT_TO_CASHIER,
  SalesOrderStatus.IN_CASHIER,
];
const claimTtlMs = 30 * 60 * 1000;
// Order taking never decides the fiscal document. Every order reaches Caja as
// provisional B02; only POS may confirm B02 or replace it with B01.
const provisionalFiscalDetails = {
  fiscalPurpose: FiscalDocumentPurpose.CONSUMER,
  fiscalDocumentTypeSnapshot: InvoiceDocumentType.CONSUMER_02,
  fiscalCustomerSnapshot: Prisma.JsonNull,
} as const;

type ComputedOrderItem = {
  product: Awaited<ReturnType<PrismaService['product']['findMany']>>[number];
  quantity: Prisma.Decimal;
  reservedQuantity: number;
  unitPrice: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
};

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, user: AuthenticatedUser, status?: string) {
    await this.releaseExpiredClaims(tenantId);

    const membership = this.getMembership(tenantId, user);
    this.ensureCanViewOrders(membership);

    const parsedStatuses = this.parseStatuses(status);
    const ownOrdersOnly =
      !adminRoles.includes(membership.role) && membership.role === Role.ORDER_TAKER;
    const destinationFilter =
      status === 'OPEN'
        ? SalesOrderDestination.CASH_SALE
        : status === 'QUOTATION'
          ? SalesOrderDestination.QUOTATION
          : undefined;

    return this.prisma.salesOrder.findMany({
      where: {
        tenantId,
        ...(destinationFilter ? { destination: destinationFilter } : {}),
        ...(parsedStatuses ? { status: { in: parsedStatuses } } : {}),
        ...(ownOrdersOnly ? { createdById: user.id } : {}),
      },
      include: this.orderInclude(),
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 150,
    });
  }

  async findOne(tenantId: string, user: AuthenticatedUser, id: string) {
    await this.releaseExpiredClaims(tenantId);

    const membership = this.getMembership(tenantId, user);
    this.ensureCanViewOrders(membership);

    const order = await this.prisma.salesOrder.findFirst({
      where: { id, tenantId },
      include: this.orderInclude(),
    });

    if (!order) {
      throw new NotFoundException('Sales order not found for tenant.');
    }

    if (
      !adminRoles.includes(membership.role) &&
      membership.role !== Role.CASHIER &&
      !membership.canUsePos &&
      order.createdById !== user.id
    ) {
      throw new ForbiddenException('Employee does not have permission to view this sales order.');
    }

    return order;
  }

  async searchProducts(tenantId: string, user: AuthenticatedUser, q: string) {
    await this.ensureCanTakeOrders(tenantId, user);
    const query = q.trim();

    if (!query) {
      return [];
    }

    return this.prisma.product.findMany({
      where: {
        tenantId,
        status: ProductStatus.ACTIVE,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { sku: { contains: query, mode: 'insensitive' } },
          { barcode: { contains: query, mode: 'insensitive' } },
          { brand: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: { category: true },
      orderBy: [{ stock: 'asc' }, { name: 'asc' }],
      take: 30,
    });
  }

  async findProductByBarcode(tenantId: string, user: AuthenticatedUser, barcode: string) {
    await this.ensureCanTakeOrders(tenantId, user);
    const lookupCandidates = getBarcodeLookupCandidates(barcode);
    const product = await this.prisma.product.findFirst({
      where: {
        tenantId,
        status: ProductStatus.ACTIVE,
        OR: [{ barcode: { in: lookupCandidates } }, { sku: { in: lookupCandidates } }],
      },
      include: { category: true },
    });

    if (!product) {
      throw new NotFoundException('No active product found for barcode.');
    }

    await this.prisma.product.update({
      where: { id: product.id },
      data: { barcodeLastScannedAt: new Date() },
    });

    return product;
  }

  async create(tenantId: string, user: AuthenticatedUser, dto: CreateSalesOrderDto) {
    const membership = await this.ensureCanTakeOrders(tenantId, user);

    if (!dto.items.length) {
      throw new BadRequestException('Sales order must include at least one item.');
    }

    const clientName = dto.clientName?.trim() || undefined;
    if (!clientName) {
      throw new BadRequestException('El nombre del cliente es obligatorio para crear la orden.');
    }
    const destination = dto.destination ?? SalesOrderDestination.CASH_SALE;
    const priceLevel = dto.priceLevel ?? SalesOrderPriceLevel.REGULAR;
    const discountRate = this.getDiscountRate(priceLevel);
    const paymentMode = dto.paymentMode ?? SalePaymentMode.CASH;

    if (destination === SalesOrderDestination.QUOTATION) {
      this.validateQuotationDetails(dto);
    }

    this.validatePaymentModeFields(paymentMode, dto);

    return this.prisma.$transaction(async (tx) => {
      const customer = dto.customerId
        ? await tx.customer.findFirst({
            where: {
              id: dto.customerId,
              tenantId,
            },
          })
        : null;

      if (dto.customerId && !customer) {
        throw new NotFoundException('Customer not found for tenant.');
      }

      if (paymentMode === SalePaymentMode.CREDIT) {
        this.validateCreditCustomer(customer);
      }

      const computed = await this.computeOrder(tenantId, dto.items, tx, priceLevel);
      const isQuotation = destination === SalesOrderDestination.QUOTATION;
      const isCredit = paymentMode === SalePaymentMode.CREDIT;

      const initialPaymentOption = isCredit ? dto.initialPaymentOption : undefined;
      const initialPaymentRate = isCredit
        ? this.getInitialPaymentRate(initialPaymentOption!)
        : new Prisma.Decimal(0);
      const initialPaymentAmount = computed.total.mul(initialPaymentRate).toDecimalPlaces(2);
      const creditTermOption = isCredit ? dto.creditTermOption : undefined;
      const creditTerms =
        isCredit && customer
          ? this.resolveCreditTerms(customer.creditTermDays, creditTermOption!, dto.customDueDate)
          : null;
      const waitsForCreditApproval = isCredit && !isQuotation;

      if (!isQuotation && !isCredit) {
        await this.reserveStockForOrder(tenantId, computed.items, tx);
      }

      const now = new Date();
      const currentBalance =
        waitsForCreditApproval && customer
          ? await this.getCustomerCreditBalance(tx, tenantId, customer.id)
          : new Prisma.Decimal(0);
      const financedAmount = computed.total.sub(initialPaymentAmount).toDecimalPlaces(2);
      const order = await tx.salesOrder.create({
        data: {
          tenantId,
          customerId: customer?.id,
          destination,
          ...provisionalFiscalDetails,
          clientName,
          quotationDocumentType: isQuotation ? dto.quotationDocumentType : undefined,
          quotationDocumentNumber:
            isQuotation && dto.quotationDocumentNumber?.trim()
              ? normalizeDominicanDocument(dto.quotationDocumentNumber)
              : undefined,
          orderNumber: this.generateOrderNumber(isQuotation),
          status: isQuotation
            ? SalesOrderStatus.QUOTATION
            : waitsForCreditApproval
              ? SalesOrderStatus.CREATED
              : SalesOrderStatus.SENT_TO_CASHIER,
          priceLevel,
          discountRate,
          subtotal: computed.subtotal,
          taxTotal: computed.taxTotal,
          discountTotal: computed.discountTotal,
          total: computed.total,
          paymentMode,
          initialPaymentOption,
          initialPaymentRate,
          initialPaymentAmount,
          creditTermOption,
          creditTermDays: creditTerms?.days,
          dueDate: creditTerms?.dueDate,
          creditRequestNote: isCredit ? dto.creditRequestNote?.trim() || null : null,
          notes: dto.notes?.trim() || undefined,
          createdById: user.id,
          sentToCashierAt: isQuotation || waitsForCreditApproval ? undefined : now,
          items: {
            create: computed.items.map((item) => ({
              productId: item.product.id,
              sku: item.product.sku,
              barcode: item.product.barcode,
              description: item.product.name,
              quantity: item.quantity,
              unit: item.product.unit,
              reservedQuantity: isQuotation || isCredit ? 0 : item.reservedQuantity,
              unitPrice: item.unitPrice,
              discountTotal: item.discountTotal,
              taxCategory: item.product.taxCategory,
              taxRate: item.product.taxRate,
              taxTotal: item.taxTotal,
              subtotal: item.subtotal,
              total: item.total,
            })),
          },
          ...(waitsForCreditApproval && customer && creditTerms && initialPaymentOption
            ? {
                creditApproval: {
                  create: {
                    tenantId,
                    customerId: customer.id,
                    initialPaymentOption,
                    creditTermOption: creditTermOption!,
                    requestedTotal: computed.total,
                    initialPaymentAmount,
                    financedAmount,
                    customerBalanceSnapshot: currentBalance,
                    creditLimitSnapshot: customer.creditLimit,
                    exceedsCreditLimit: currentBalance.add(financedAmount).gt(customer.creditLimit),
                    dueDate: creditTerms.dueDate,
                    requestNote: dto.creditRequestNote?.trim() || undefined,
                    requestedById: user.id,
                    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
                  },
                },
              }
            : {}),
        },
        include: this.orderInclude(),
      });

      const activityLogs: Prisma.EmployeeActivityLogCreateManyInput[] = [
        {
          tenantId,
          userId: user.id,
          action: EmployeeLogAction.CREATE_SALES_ORDER,
          entity: 'SalesOrder',
          entityId: order.id,
          amount: computed.total,
          metadata: this.buildOrderLogMetadata(order, computed.items, user.id),
        },
      ];

      if (!isQuotation && !waitsForCreditApproval) {
        activityLogs.push({
          tenantId,
          userId: user.id,
          action: EmployeeLogAction.SEND_SALES_ORDER_TO_CASHIER,
          entity: 'SalesOrder',
          entityId: order.id,
          amount: computed.total,
          metadata: this.buildOrderLogMetadata(order, computed.items, user.id),
        });
      }

      await tx.employeeActivityLog.createMany({ data: activityLogs });

      return order;
    });
  }

  async claim(tenantId: string, user: AuthenticatedUser, id: string, dto: ClaimSalesOrderDto) {
    const membership = await this.ensureCanUsePosForOrders(tenantId, user);

    if (adminRoles.includes(membership.role)) {
      throw new ForbiddenException('Admins cannot claim sales orders for charging.');
    }

    const cashSession = await this.findOpenCashSessionForUser(tenantId, user.id, dto.cashSessionId);
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + claimTtlMs);

    await this.releaseExpiredClaims(tenantId);

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.salesOrder.updateMany({
        where: {
          id,
          tenantId,
          destination: SalesOrderDestination.CASH_SALE,
          invoiceId: null,
          OR: [
            { status: SalesOrderStatus.SENT_TO_CASHIER },
            {
              status: SalesOrderStatus.IN_CASHIER,
              claimedById: user.id,
            },
            {
              status: SalesOrderStatus.IN_CASHIER,
              claimExpiresAt: { lt: now },
            },
          ],
        },
        data: {
          status: SalesOrderStatus.IN_CASHIER,
          claimedById: user.id,
          claimedCashSessionId: cashSession.id,
          claimedAt: now,
          claimExpiresAt,
          releasedAt: null,
        },
      });

      if (claimed.count !== 1) {
        const existing = await tx.salesOrder.findFirst({
          where: { id, tenantId },
          include: this.orderInclude(),
        });

        if (!existing) {
          throw new NotFoundException('Sales order not found for tenant.');
        }

        if (existing.status === SalesOrderStatus.COMPLETED) {
          throw new BadRequestException('Sales order has already been completed.');
        }

        if (existing.status === SalesOrderStatus.CANCELLED) {
          throw new BadRequestException('Sales order has already been cancelled.');
        }

        throw new BadRequestException('Sales order is already claimed by another cashier.');
      }

      await this.lockOpenCashSessionForUser(tx, tenantId, user.id, cashSession.id);
      const order = await tx.salesOrder.findUniqueOrThrow({
        where: { id },
        include: this.orderInclude(),
      });

      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId: user.id,
          cashSessionId: cashSession.id,
          action: EmployeeLogAction.CLAIM_SALES_ORDER,
          entity: 'SalesOrder',
          entityId: id,
          amount: order.total,
          metadata: {
            orderNumber: order.orderNumber,
            role: membership.role,
            cashRegister: cashSession.cashRegister.name,
            sourceDestination: order.destination,
            sourceStatus: order.status,
            clientName: order.clientName,
          },
        },
      });

      return order;
    });
  }

  async release(tenantId: string, user: AuthenticatedUser, id: string) {
    const membership = this.getMembership(tenantId, user);
    this.ensureCanViewOrders(membership);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id, tenantId },
        include: this.orderInclude(),
      });

      if (!order) {
        throw new NotFoundException('Sales order not found for tenant.');
      }

      if (order.status !== SalesOrderStatus.IN_CASHIER) {
        throw new BadRequestException('Only claimed sales orders can be released.');
      }

      if (!adminRoles.includes(membership.role) && order.claimedById !== user.id) {
        throw new ForbiddenException(
          'Employee does not have permission to release this sales order.',
        );
      }

      const released = await tx.salesOrder.update({
        where: { id },
        data: {
          status: SalesOrderStatus.SENT_TO_CASHIER,
          ...provisionalFiscalDetails,
          claimedById: null,
          claimedCashSessionId: null,
          claimedAt: null,
          claimExpiresAt: null,
          releasedAt: new Date(),
        },
        include: this.orderInclude(),
      });

      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId: user.id,
          cashSessionId: order.claimedCashSessionId,
          action: EmployeeLogAction.RELEASE_SALES_ORDER,
          entity: 'SalesOrder',
          entityId: id,
          amount: released.total,
          metadata: {
            orderNumber: released.orderNumber,
            sourceDestination: released.destination,
            sourceStatus: released.status,
            clientName: released.clientName,
          },
        },
      });

      return released;
    });
  }

  async cancel(tenantId: string, user: AuthenticatedUser, id: string, dto?: CancelSalesOrderDto) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findFirst({
        where: { id, tenantId },
        include: this.orderInclude(),
      });

      if (!order) {
        throw new NotFoundException('Sales order not found for tenant.');
      }

      const membership = this.getMembership(tenantId, user);
      const canCancel =
        adminRoles.includes(membership.role) ||
        (order.createdById === user.id &&
          (order.status === SalesOrderStatus.CREATED ||
            order.status === SalesOrderStatus.SENT_TO_CASHIER ||
            order.status === SalesOrderStatus.QUOTATION) &&
          (membership.role === Role.ORDER_TAKER || adminRoles.includes(membership.role))) ||
        (order.claimedById === user.id &&
          order.status === SalesOrderStatus.IN_CASHIER &&
          (membership.role === Role.CASHIER || membership.canUsePos));

      if (!canCancel) {
        throw new ForbiddenException(
          'Employee does not have permission to cancel this sales order.',
        );
      }

      if (
        !openOrderStatuses.includes(order.status) &&
        order.status !== SalesOrderStatus.QUOTATION
      ) {
        throw new BadRequestException('Only pending sales orders can be cancelled.');
      }

      const cancellableStatuses =
        order.status === SalesOrderStatus.QUOTATION
          ? [SalesOrderStatus.QUOTATION]
          : openOrderStatuses;

      const cancelledRows = await tx.salesOrder.updateMany({
        where: {
          id,
          tenantId,
          status: { in: cancellableStatuses },
        },
        data: {
          status: SalesOrderStatus.CANCELLED,
          claimedById: null,
          claimedCashSessionId: null,
          claimExpiresAt: null,
          cancelledAt: new Date(),
          cancelReason: dto?.reason?.trim() || undefined,
        },
      });

      if (cancelledRows.count !== 1) {
        throw new BadRequestException('Only pending sales orders can be cancelled.');
      }

      await this.releaseReservedStock(order.items, tx);
      if (
        order.creditApproval &&
        (order.creditApproval.status === CreditApprovalStatus.PENDING ||
          order.creditApproval.status === CreditApprovalStatus.APPROVED)
      ) {
        await tx.creditSaleApproval.update({
          where: { id: order.creditApproval.id },
          data: {
            status: CreditApprovalStatus.CANCELLED,
            cancelledById: user.id,
            cancelledAt: new Date(),
            decisionNote: dto?.reason?.trim() || 'Orden cancelada',
          },
        });
      }

      const cancelled = await tx.salesOrder.findUniqueOrThrow({
        where: { id },
        include: this.orderInclude(),
      });

      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId: user.id,
          cashSessionId: order.claimedCashSessionId,
          action: EmployeeLogAction.CANCEL_SALES_ORDER,
          entity: 'SalesOrder',
          entityId: id,
          amount: cancelled.total,
          metadata: {
            orderNumber: cancelled.orderNumber,
            reason: cancelled.cancelReason,
            sourceDestination: cancelled.destination,
            sourceStatus: cancelled.status,
            clientName: cancelled.clientName,
          },
        },
      });

      return cancelled;
    });
  }

  async accept(tenantId: string, user: AuthenticatedUser, id: string) {
    await this.ensureCanTakeOrders(tenantId, user);

    return this.prisma.$transaction(async (tx) => {
      await this.lockSalesOrder(tx, tenantId, id);
      const order = await tx.salesOrder.findFirst({
        where: { id, tenantId },
        include: {
          customer: true,
          creditApproval: true,
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      if (!order) {
        throw new NotFoundException('Sales order not found for tenant.');
      }

      if (order.status !== SalesOrderStatus.QUOTATION) {
        throw new BadRequestException('Only quotations can be accepted.');
      }

      if (order.paymentMode === SalePaymentMode.CREDIT) {
        this.validateCreditCustomer(order.customer);
        if (!order.customer || !order.initialPaymentOption || !order.creditTermOption) {
          throw new BadRequestException('Credit quotation is missing payment terms.');
        }
        if (order.creditApproval) {
          throw new BadRequestException('Credit quotation already has an approval request.');
        }
        const creditTerms = this.resolveCreditTerms(
          order.customer.creditTermDays,
          order.creditTermOption,
          order.creditTermOption === CreditTermOption.CUSTOM_DATE
            ? order.dueDate
              ? businessDateKey(order.dueDate)
              : undefined
            : undefined,
        );
        const currentBalance = await this.getCustomerCreditBalance(tx, tenantId, order.customer.id);
        const initialPaymentAmount = order.total.mul(order.initialPaymentRate).toDecimalPlaces(2);
        const financedAmount = order.total.sub(initialPaymentAmount).toDecimalPlaces(2);
        const now = new Date();

        await tx.creditSaleApproval.create({
          data: {
            tenantId,
            salesOrderId: order.id,
            customerId: order.customer.id,
            initialPaymentOption: order.initialPaymentOption,
            creditTermOption: order.creditTermOption,
            requestedTotal: order.total,
            initialPaymentAmount,
            financedAmount,
            customerBalanceSnapshot: currentBalance,
            creditLimitSnapshot: order.customer.creditLimit,
            exceedsCreditLimit: currentBalance.add(financedAmount).gt(order.customer.creditLimit),
            dueDate: creditTerms.dueDate,
            requestNote: order.creditRequestNote,
            requestedById: user.id,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        });
        const updated = await tx.salesOrder.update({
          where: { id },
          data: {
            destination: SalesOrderDestination.CASH_SALE,
            status: SalesOrderStatus.CREATED,
            ...provisionalFiscalDetails,
            initialPaymentAmount,
            creditTermDays: creditTerms.days,
            dueDate: creditTerms.dueDate,
          },
          include: this.orderInclude(),
        });
        await tx.employeeActivityLog.create({
          data: {
            tenantId,
            userId: user.id,
            action: EmployeeLogAction.CREATE_SALES_ORDER,
            entity: 'CreditSaleApproval',
            entityId: order.id,
            amount: order.total,
            metadata: {
              orderNumber: order.orderNumber,
              action: 'CREDIT_APPROVAL_REQUESTED',
              sourceDestination: SalesOrderDestination.QUOTATION,
              sourceStatus: order.status,
              destination: updated.destination,
              status: updated.status,
              clientName: order.clientName,
            },
          },
        });
        return updated;
      }

      // Convert order items to list format for stock reservation
      const orderItems = order.items.map((item) => ({
        productId: item.productId!,
        quantity: Number(item.quantity),
      }));

      // Compute order and validate stock
      const computed = await this.computeOrder(tenantId, orderItems, tx, order.priceLevel);

      // Reserve stock for the order
      await this.reserveStockForOrder(tenantId, computed.items, tx);

      // Update the reservedQuantity of each item
      for (const item of order.items) {
        const reservedQuantity = Number(item.quantity);
        await tx.salesOrderItem.update({
          where: { id: item.id },
          data: { reservedQuantity },
        });
      }

      const now = new Date();
      const updated = await tx.salesOrder.update({
        where: { id },
        data: {
          destination: SalesOrderDestination.CASH_SALE,
          status: SalesOrderStatus.SENT_TO_CASHIER,
          ...provisionalFiscalDetails,
          sentToCashierAt: now,
        },
        include: this.orderInclude(),
      });

      // Log activities
      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId: user.id,
          action: EmployeeLogAction.SEND_SALES_ORDER_TO_CASHIER,
          entity: 'SalesOrder',
          entityId: id,
          amount: updated.total,
          metadata: {
            orderNumber: updated.orderNumber,
            sourceDestination: SalesOrderDestination.QUOTATION,
            sourceStatus: order.status,
            destination: updated.destination,
            status: updated.status,
            clientName: order.clientName,
          },
        },
      });

      return updated;
    });
  }

  async update(tenantId: string, user: AuthenticatedUser, id: string, dto: CreateSalesOrderDto) {
    const membership = await this.ensureCanTakeOrders(tenantId, user);

    this.validateQuotationDetails(dto);

    return this.prisma.$transaction(async (tx) => {
      await this.lockSalesOrder(tx, tenantId, id);
      const order = await tx.salesOrder.findFirst({
        where: { id, tenantId },
        include: { items: true },
      });

      if (!order) {
        throw new NotFoundException('Sales order not found for tenant.');
      }

      if (order.status !== SalesOrderStatus.QUOTATION) {
        throw new BadRequestException('Only quotations can be modified.');
      }

      if (dto.paymentMode && dto.paymentMode !== order.paymentMode) {
        throw new BadRequestException('Quotation payment mode cannot be changed after creation.');
      }
      if (dto.initialPaymentOption && dto.initialPaymentOption !== order.initialPaymentOption) {
        throw new BadRequestException(
          'Credit initial payment option cannot be changed after creation.',
        );
      }
      if (dto.creditTermOption && dto.creditTermOption !== order.creditTermOption) {
        throw new BadRequestException('Credit term cannot be changed after creation.');
      }
      if (
        order.paymentMode === SalePaymentMode.CREDIT &&
        order.creditTermOption === CreditTermOption.CUSTOM_DATE &&
        dto.customDueDate &&
        order.dueDate &&
        dto.customDueDate !== businessDateKey(order.dueDate)
      ) {
        throw new BadRequestException('Custom credit due date cannot be changed after creation.');
      }
      this.validatePaymentModeFields(order.paymentMode, dto, false);

      const customer = dto.customerId
        ? await tx.customer.findFirst({ where: { id: dto.customerId, tenantId } })
        : null;
      if (dto.customerId && !customer) {
        throw new NotFoundException('Customer not found for tenant.');
      }
      if (order.paymentMode === SalePaymentMode.CREDIT) {
        // Financial credit eligibility is independent from fiscal purpose: a
        // cash sale can be B01 and a credit sale can be B02.
        this.validateCreditCustomer(customer);
      }

      // Delete existing items
      await tx.salesOrderItem.deleteMany({
        where: { salesOrderId: id },
      });

      const priceLevel = dto.priceLevel ?? SalesOrderPriceLevel.REGULAR;
      const discountRate = this.getDiscountRate(priceLevel);
      const computed = await this.computeOrder(tenantId, dto.items, tx, priceLevel);

      // Update order fields
      const updated = await tx.salesOrder.update({
        where: { id },
        data: {
          clientName: dto.clientName?.trim() || undefined,
          customerId: dto.customerId || null,
          ...provisionalFiscalDetails,
          priceLevel,
          discountRate,
          quotationDocumentType: dto.quotationDocumentType ?? null,
          quotationDocumentNumber: dto.quotationDocumentNumber?.trim()
            ? normalizeDominicanDocument(dto.quotationDocumentNumber)
            : null,
          subtotal: computed.subtotal,
          taxTotal: computed.taxTotal,
          discountTotal: computed.discountTotal,
          total: computed.total,
          initialPaymentAmount:
            order.paymentMode === SalePaymentMode.CREDIT
              ? computed.total.mul(order.initialPaymentRate).toDecimalPlaces(2)
              : undefined,
          creditRequestNote:
            order.paymentMode === SalePaymentMode.CREDIT
              ? dto.creditRequestNote?.trim() || null
              : null,
          notes: dto.notes?.trim() || null,
          items: {
            create: computed.items.map((item) => ({
              productId: item.product.id,
              sku: item.product.sku,
              barcode: item.product.barcode,
              description: item.product.name,
              quantity: item.quantity,
              unit: item.product.unit,
              reservedQuantity: 0,
              unitPrice: item.unitPrice,
              discountTotal: item.discountTotal,
              taxCategory: item.product.taxCategory,
              taxRate: item.product.taxRate,
              taxTotal: item.taxTotal,
              subtotal: item.subtotal,
              total: item.total,
            })),
          },
        },
        include: this.orderInclude(),
      });

      // Log activity
      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId: user.id,
          action: EmployeeLogAction.CREATE_SALES_ORDER,
          entity: 'SalesOrder',
          entityId: id,
          amount: computed.total,
          metadata: {
            orderNumber: updated.orderNumber,
            isUpdate: true,
            previousFiscalPurpose: order.fiscalPurpose,
            fiscalPurpose: updated.fiscalPurpose,
            previousFiscalDocumentType: order.fiscalDocumentTypeSnapshot,
            fiscalDocumentType: updated.fiscalDocumentTypeSnapshot,
            sourceDestination: updated.destination,
            sourceStatus: updated.status,
            clientName: updated.clientName,
          },
        },
      });

      return updated;
    });
  }

  private async computeOrder(
    tenantId: string,
    items: SalesOrderItemDto[],
    client: PrismaService | Prisma.TransactionClient = this.prisma,
    priceLevel: SalesOrderPriceLevel = SalesOrderPriceLevel.REGULAR,
  ) {
    if (!items.length) {
      throw new BadRequestException('Sales order must include at least one item.');
    }

    const quantitiesByProduct = new Map<string, number>();
    for (const item of items) {
      quantitiesByProduct.set(
        item.productId,
        (quantitiesByProduct.get(item.productId) ?? 0) + item.quantity,
      );
    }

    const products = await client.product.findMany({
      where: {
        tenantId,
        id: { in: Array.from(quantitiesByProduct.keys()) },
        status: ProductStatus.ACTIVE,
      },
    });

    if (products.length !== quantitiesByProduct.size) {
      throw new NotFoundException('One or more order products do not belong to tenant.');
    }

    const discountRate = this.getDiscountRate(priceLevel);
    const computedItems: ComputedOrderItem[] = products.map((product) => {
      const quantity = new Prisma.Decimal(quantitiesByProduct.get(product.id) ?? 0);
      const regularUnitPrice = product.salePrice.gt(0) ? product.salePrice : product.price;
      const unitPrice = regularUnitPrice
        .mul(new Prisma.Decimal(1).sub(discountRate))
        .toDecimalPlaces(2);
      const regularSubtotal = quantity.mul(regularUnitPrice).toDecimalPlaces(2);
      const subtotal = quantity.mul(unitPrice).toDecimalPlaces(2);
      const discountTotal = regularSubtotal.sub(subtotal).toDecimalPlaces(2);
      const taxTotal = subtotal.mul(product.taxRate).toDecimalPlaces(2);

      return {
        product,
        quantity,
        reservedQuantity: product.trackInventory ? quantity.toNumber() : 0,
        unitPrice,
        discountTotal,
        subtotal,
        taxTotal,
        total: subtotal.add(taxTotal).toDecimalPlaces(2),
      };
    });

    for (const item of computedItems) {
      const quantity = item.quantity.toNumber();
      const availableStock = item.product.stock - item.product.reservedStock;

      if (
        item.product.trackInventory &&
        requiresWholeQuantity(item.product.unit) &&
        !Number.isInteger(quantity)
      ) {
        throw new BadRequestException(
          `Tracked product ${item.product.name} requires whole quantities.`,
        );
      }

      if (item.product.trackInventory && availableStock < quantity) {
        throw new BadRequestException(`Insufficient available stock for ${item.product.name}.`);
      }
    }

    return {
      items: computedItems,
      subtotal: computedItems
        .reduce((sum, item) => sum.add(item.subtotal), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
      taxTotal: computedItems
        .reduce((sum, item) => sum.add(item.taxTotal), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
      discountTotal: computedItems
        .reduce((sum, item) => sum.add(item.discountTotal), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
      total: computedItems
        .reduce((sum, item) => sum.add(item.total), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
    };
  }

  private getDiscountRate(priceLevel: SalesOrderPriceLevel) {
    if (priceLevel === SalesOrderPriceLevel.DISCOUNT_10) {
      return new Prisma.Decimal('0.05');
    }

    if (priceLevel === SalesOrderPriceLevel.PREFERRED_18) {
      return new Prisma.Decimal('0.10');
    }

    return new Prisma.Decimal(0);
  }

  private validateCreditCustomer(
    customer: {
      status: CustomerStatus;
      creditEnabled: boolean;
      creditStatus: CustomerCreditStatus;
    } | null,
  ) {
    if (!customer) {
      throw new BadRequestException('Credit sales require a registered customer.');
    }
    if (customer.status !== CustomerStatus.ACTIVE) {
      throw new BadRequestException('Credit customer must be active.');
    }
    if (!customer.creditEnabled || customer.creditStatus !== CustomerCreditStatus.ACTIVE) {
      throw new BadRequestException('Customer credit is disabled or blocked.');
    }
  }

  private validatePaymentModeFields(
    paymentMode: SalePaymentMode,
    dto: CreateSalesOrderDto,
    requireCreditFields = true,
  ) {
    if (paymentMode === SalePaymentMode.CASH) {
      if (
        dto.initialPaymentOption !== undefined ||
        dto.creditTermOption !== undefined ||
        dto.customDueDate !== undefined ||
        dto.creditRequestNote !== undefined
      ) {
        throw new BadRequestException('Cash orders cannot include credit payment terms.');
      }
      return;
    }

    if (requireCreditFields && dto.initialPaymentOption === undefined) {
      throw new BadRequestException('Credit sales require an initial payment option.');
    }
    if (requireCreditFields && dto.creditTermOption === undefined) {
      throw new BadRequestException('Credit sales require a credit term option.');
    }
    if (
      requireCreditFields &&
      dto.creditTermOption === CreditTermOption.CUSTOM_DATE &&
      !dto.customDueDate
    ) {
      throw new BadRequestException('Custom credit term requires a due date.');
    }
    if (
      requireCreditFields &&
      dto.creditTermOption !== CreditTermOption.CUSTOM_DATE &&
      dto.customDueDate !== undefined
    ) {
      throw new BadRequestException('Custom due date is only valid for a custom credit term.');
    }
  }

  private getInitialPaymentRate(option: InitialPaymentOption) {
    const rates: Record<InitialPaymentOption, string> = {
      [InitialPaymentOption.NONE]: '0',
      [InitialPaymentOption.PERCENT_30]: '0.30',
      [InitialPaymentOption.PERCENT_50]: '0.50',
      [InitialPaymentOption.PERCENT_70]: '0.70',
    };
    return new Prisma.Decimal(rates[option]);
  }

  private resolveCreditTerms(
    customerDefaultDays: number,
    option: CreditTermOption,
    customDueDate?: string,
  ) {
    const now = new Date();
    if (option === CreditTermOption.CUSTOM_DATE) {
      if (!customDueDate) {
        throw new BadRequestException('Custom credit term requires a due date.');
      }
      const dueDate = parseBusinessDate(customDueDate);
      if (!dueDate || businessDateKey(dueDate) <= businessDateKey(now)) {
        throw new BadRequestException('Credit due date must be in the future.');
      }
      return { dueDate, days: null };
    }
    const days =
      option === CreditTermOption.DAYS_15
        ? 15
        : option === CreditTermOption.DAYS_30
          ? 30
          : option === CreditTermOption.DAYS_45
            ? 45
            : customerDefaultDays;
    if (!Number.isInteger(days) || days <= 0) {
      throw new BadRequestException('Customer credit days must be a positive whole number.');
    }
    const dueDate = addBusinessDays(days, now);
    return { dueDate, days };
  }

  private async getCustomerCreditBalance(
    client: Prisma.TransactionClient,
    tenantId: string,
    customerId: string,
  ) {
    const aggregate = await client.invoice.aggregate({
      where: {
        tenantId,
        customerId,
        paymentMode: SalePaymentMode.CREDIT,
        status: {
          notIn: [
            // Cancelled and voided documents do not consume the credit line.
            InvoiceStatus.CANCELLED,
            InvoiceStatus.VOID,
            InvoiceStatus.VOIDED,
          ],
        },
      },
      _sum: { balance: true },
    });
    return (aggregate._sum.balance ?? new Prisma.Decimal(0)).toDecimalPlaces(2);
  }

  private async reserveStockForOrder(
    tenantId: string,
    items: ComputedOrderItem[],
    tx: Prisma.TransactionClient,
  ) {
    for (const item of [...items].sort((a, b) => a.product.id.localeCompare(b.product.id))) {
      if (!item.product.trackInventory || item.reservedQuantity <= 0) {
        continue;
      }

      const updated = await tx.$executeRaw`
        UPDATE "Product"
        SET "reservedStock" = "reservedStock" + ${item.reservedQuantity}
        WHERE "id" = ${item.product.id}
          AND "tenantId" = ${tenantId}
          AND "trackInventory" = TRUE
          AND ("stock" - "reservedStock") >= ${item.reservedQuantity}
      `;

      if (updated !== 1) {
        throw new BadRequestException(`Insufficient available stock for ${item.product.name}.`);
      }
    }
  }

  private async lockSalesOrder(
    tx: Prisma.TransactionClient,
    tenantId: string,
    salesOrderId: string,
  ) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "SalesOrder"
      WHERE "id" = ${salesOrderId}
        AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;

    if (rows.length !== 1) {
      throw new NotFoundException('Sales order not found for tenant.');
    }
  }

  private async lockOpenCashSessionForUser(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
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
      throw new BadRequestException('Selected cash session was not found.');
    }
    const openSession = await tx.cashSession.findFirst({
      where: {
        id: cashSessionId,
        tenantId,
        openedById: userId,
        status: CashSessionStatus.OPEN,
      },
      select: { id: true },
    });
    if (!openSession) {
      throw new BadRequestException('Selected cash session is no longer open for this cashier.');
    }
  }

  private async releaseReservedStock(
    items: Array<{ productId: string | null; reservedQuantity: number }>,
    tx: Prisma.TransactionClient,
  ) {
    for (const item of [...items].sort((a, b) =>
      (a.productId ?? '').localeCompare(b.productId ?? ''),
    )) {
      if (!item.productId || item.reservedQuantity <= 0) {
        continue;
      }

      await tx.$executeRaw`
        UPDATE "Product"
        SET "reservedStock" = GREATEST("reservedStock" - ${item.reservedQuantity}, 0)
        WHERE "id" = ${item.productId}
      `;
    }
  }

  private parseStatuses(status?: string) {
    if (!status) {
      return undefined;
    }

    if (status === 'OPEN') {
      return openOrderStatuses;
    }

    if (status === 'QUOTATION') {
      return [SalesOrderStatus.QUOTATION];
    }

    if (!Object.values(SalesOrderStatus).includes(status as SalesOrderStatus)) {
      throw new BadRequestException('Invalid sales order status.');
    }

    return [status as SalesOrderStatus];
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

  private ensureCanViewOrders(membership: AuthenticatedUser['memberships'][number]) {
    if (
      !adminRoles.includes(membership.role) &&
      !membership.canUsePos &&
      membership.role !== Role.CASHIER &&
      membership.role !== Role.ORDER_TAKER
    ) {
      throw new ForbiddenException('Employee does not have permission to view sales orders.');
    }
  }

  private async ensureCanTakeOrders(tenantId: string, user: AuthenticatedUser) {
    const membership = this.getMembership(tenantId, user);

    if (!adminRoles.includes(membership.role) && membership.role !== Role.ORDER_TAKER) {
      throw new ForbiddenException('Employee does not have permission to take orders.');
    }

    if (!adminRoles.includes(membership.role)) {
      await this.ensureActiveEmployeeProfile(tenantId, user.id, 'take orders');
    }

    return membership;
  }

  private async ensureCanUsePosForOrders(tenantId: string, user: AuthenticatedUser) {
    const membership = this.getMembership(tenantId, user);

    if (
      !adminRoles.includes(membership.role) &&
      !membership.canUsePos &&
      membership.role !== Role.CASHIER
    ) {
      throw new ForbiddenException('Employee does not have POS access.');
    }

    if (!adminRoles.includes(membership.role)) {
      await this.ensureActiveEmployeeProfile(tenantId, user.id, 'use POS');
    }

    return membership;
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

  private async findOpenCashSessionForUser(
    tenantId: string,
    userId: string,
    cashSessionId?: string,
  ) {
    const session = await this.prisma.cashSession.findFirst({
      where: {
        tenantId,
        openedById: userId,
        status: CashSessionStatus.OPEN,
        ...(cashSessionId ? { id: cashSessionId } : {}),
      },
      include: { cashRegister: true },
      orderBy: { openedAt: 'desc' },
    });

    if (!session) {
      throw new BadRequestException(
        'An open cash session for this cashier is required to claim sales orders.',
      );
    }

    return session;
  }

  private async releaseExpiredClaims(tenantId: string) {
    const now = new Date();
    await this.prisma.salesOrder.updateMany({
      where: {
        tenantId,
        status: SalesOrderStatus.IN_CASHIER,
        claimExpiresAt: { lt: now },
      },
      data: {
        status: SalesOrderStatus.SENT_TO_CASHIER,
        ...provisionalFiscalDetails,
        claimedById: null,
        claimedCashSessionId: null,
        claimedAt: null,
        claimExpiresAt: null,
        releasedAt: now,
      },
    });
  }

  private orderInclude() {
    return {
      customer: true,
      createdBy: { select: { id: true, name: true, email: true } },
      completedBy: { select: { id: true, name: true, email: true } },
      claimedBy: { select: { id: true, name: true, email: true } },
      claimedCashSession: {
        include: {
          cashRegister: true,
        },
      },
      invoice: { select: { id: true, invoiceNumber: true, total: true } },
      creditApproval: {
        include: {
          requestedBy: { select: { id: true, name: true, email: true } },
          approvedBy: { select: { id: true, name: true, email: true } },
          rejectedBy: { select: { id: true, name: true, email: true } },
        },
      },
      items: {
        include: {
          product: { include: { category: true } },
        },
        orderBy: { description: 'asc' as const },
      },
    };
  }

  private generateOrderNumber(isQuotation = false) {
    const date = new Date();
    const stamp = date.toISOString().slice(0, 10).replace(/-/g, '');
    const time =
      String(date.getHours()).padStart(2, '0') +
      String(date.getMinutes()).padStart(2, '0') +
      String(date.getSeconds()).padStart(2, '0');
    const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();
    const prefix = isQuotation ? 'COT' : 'ORD';
    return `${prefix}-${stamp}-${time}-${suffix}`;
  }

  private validateQuotationDetails(dto: CreateSalesOrderDto) {
    if (!dto.clientName?.trim()) {
      throw new BadRequestException('Quotation requires client name.');
    }

    this.validateQuotationDocument(dto);
  }

  private validateQuotationDocument(dto: CreateSalesOrderDto) {
    const documentType = dto.quotationDocumentType;
    const documentNumber = dto.quotationDocumentNumber?.trim();

    if (!documentType && !documentNumber) {
      return;
    }

    if (!documentType || !documentNumber) {
      throw new BadRequestException(
        'Quotation document type and document number must be provided together.',
      );
    }

    if (documentType !== DocumentType.RNC && documentType !== DocumentType.CEDULA) {
      throw new BadRequestException('Quotation document type must be RNC or CEDULA.');
    }

    const normalized = normalizeDominicanDocument(documentNumber);

    if (documentType === DocumentType.RNC) {
      if (normalized.length !== 9) {
        throw new BadRequestException('El RNC debe tener 9 digitos.');
      }

      if (!validateDominicanRnc(documentNumber)) {
        throw new BadRequestException('El RNC no es valido.');
      }

      return;
    }

    if (normalized.length !== 11) {
      throw new BadRequestException('La cedula debe tener 11 digitos.');
    }

    if (!validateDominicanCedula(documentNumber)) {
      throw new BadRequestException('La cedula no es valida.');
    }
  }

  private buildOrderLogMetadata(
    order: {
      orderNumber: string;
      customerId: string | null;
      destination: SalesOrderDestination;
      fiscalPurpose: FiscalDocumentPurpose;
      fiscalDocumentTypeSnapshot: InvoiceDocumentType;
      status: SalesOrderStatus;
      clientName: string | null;
    },
    items: ComputedOrderItem[],
    userId: string,
  ) {
    return {
      orderNumber: order.orderNumber,
      customerId: order.customerId,
      fiscalPurpose: order.fiscalPurpose,
      fiscalDocumentType: order.fiscalDocumentTypeSnapshot,
      createdById: userId,
      sourceDestination: order.destination,
      sourceStatus: order.status,
      clientName: order.clientName,
      itemCount: items.length,
      quantityTotal: items.reduce((total, item) => total + item.quantity.toNumber(), 0),
      items: items.map((item) => ({
        productId: item.product.id,
        sku: item.product.sku,
        barcode: item.product.barcode,
        name: item.product.name,
        quantity: item.quantity.toNumber(),
        total: item.total.toNumber(),
      })),
    };
  }
}

function requiresWholeQuantity(unit: ProductUnit) {
  const fractionalUnits: ProductUnit[] = [
    ProductUnit.METER,
    ProductUnit.FOOT,
    ProductUnit.YARD,
    ProductUnit.POUND,
  ];
  return !fractionalUnits.includes(unit);
}
