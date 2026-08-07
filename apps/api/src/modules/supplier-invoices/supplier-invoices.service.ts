import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GoodsReceiptStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PurchaseOrderStatus,
  SupplierInvoiceStatus,
} from '@qorvex/database';
import { randomUUID } from 'crypto';
import {
  addBusinessDays,
  businessDateKey,
  parseBusinessDate,
} from '../../common/utils/business-date';
import { PrismaService } from '../../prisma/prisma.service';
import { ReceiptsService } from '../receipts/receipts.service';
import {
  CancelSupplierPaymentDto,
  ConfirmSupplierInvoiceEntryDto,
  CreateSupplierInvoiceDto,
  ListSupplierInvoicesQueryDto,
  PayablesSummaryQueryDto,
  RegisterSupplierPaymentDto,
  SupplierInvoiceItemDto,
  SupplierInvoiceOcrReviewDto,
  UpdateSupplierInvoiceDto,
} from './dto/supplier-invoice.dto';

const payableStatuses: SupplierInvoiceStatus[] = [
  SupplierInvoiceStatus.PENDING,
  SupplierInvoiceStatus.PARTIALLY_PAID,
];
const receiptEligibleInvoiceStatuses: SupplierInvoiceStatus[] = [
  ...payableStatuses,
  SupplierInvoiceStatus.PAID,
];

const allowedPurchaseOrderStatuses: PurchaseOrderStatus[] = [PurchaseOrderStatus.ISSUED];
const supplierInvoiceListInclude = {
  supplier: {
    select: {
      id: true,
      commercialName: true,
      legalName: true,
      documentType: true,
      documentNumber: true,
      status: true,
    },
  },
  purchaseOrder: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
    },
  },
  createdBy: { select: { id: true, name: true, email: true } },
  _count: {
    select: {
      items: true,
      payments: true,
      goodsReceipts: true,
    },
  },
} satisfies Prisma.SupplierInvoiceInclude;

const supplierInvoiceDetailInclude = {
  supplier: true,
  purchaseOrder: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      expectedDeliveryDate: true,
    },
  },
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          barcode: true,
          unit: true,
          status: true,
        },
      },
      purchaseOrderItem: {
        select: {
          id: true,
          quantity: true,
          receivedQuantity: true,
          productId: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  payments: {
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      cancelledBy: { select: { id: true, name: true, email: true } },
      cashSession: {
        select: {
          id: true,
          status: true,
          openedAt: true,
          closedAt: true,
          cashRegister: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { paidAt: 'desc' as const },
  },
  goodsReceipts: {
    select: {
      id: true,
      receiptNumber: true,
      status: true,
      confirmedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
  },
  createdBy: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
  cancelledBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.SupplierInvoiceInclude;

@Injectable()
export class SupplierInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receiptsService: ReceiptsService,
  ) {}

  async findAll(tenantId: string, query: ListSupplierInvoicesQueryDto) {
    const conditions: Prisma.SupplierInvoiceWhereInput[] = [];
    const dueDate: Prisma.DateTimeNullableFilter = {};
    const dueFrom = query.dueFrom ? parseSupplierBusinessDate(query.dueFrom) : null;
    const dueTo = query.dueTo ? parseSupplierBusinessDate(query.dueTo) : null;

    if (dueFrom) {
      dueDate.gte = dueFrom;
    }

    if (dueTo) {
      dueDate.lt = addBusinessDays(1, dueTo);
    }

    if (dueFrom && dueTo && businessDateKey(dueFrom) > businessDateKey(dueTo)) {
      throw new BadRequestException('The initial due date cannot be after the final due date.');
    }

    if (Object.keys(dueDate).length) {
      conditions.push({ dueDate });
    }

    const overdueCondition = this.overdueWhere();
    if (query.overdue === true) {
      conditions.push(overdueCondition);
    } else if (query.overdue === false) {
      conditions.push({
        OR: [
          { status: { notIn: payableStatuses } },
          { balance: { lte: 0 } },
          { dueDate: null },
          { dueDate: { gte: currentBusinessDateAnchor() } },
        ],
      });
    }

    const search = query.q?.trim();
    const normalizedSearch = search ? normalizeNcf(search) : null;
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: {
        tenantId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        ...(search
          ? {
              OR: [
                { invoiceNumber: { contains: search, mode: 'insensitive' } },
                ...(normalizedSearch
                  ? [{ ncf: { contains: normalizedSearch, mode: 'insensitive' as const } }]
                  : []),
                { supplierNameSnapshot: { contains: search, mode: 'insensitive' } },
                {
                  supplierDocumentNumberSnapshot: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
        ...(conditions.length ? { AND: conditions } : {}),
      },
      include: supplierInvoiceListInclude,
      orderBy: [
        { dueDate: { sort: 'asc', nulls: 'last' } },
        { issueDate: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return invoices.map((invoice) => this.withDerivedStatus(invoice));
  }

  async findOne(tenantId: string, id: string) {
    const invoice = await this.getInvoiceDetail(tenantId, id);
    return this.withDerivedStatus(invoice);
  }

  async getPayablesSummary(tenantId: string, query: PayablesSummaryQueryDto) {
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: {
        tenantId,
        ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        status: {
          in: [
            SupplierInvoiceStatus.PENDING,
            SupplierInvoiceStatus.PARTIALLY_PAID,
            SupplierInvoiceStatus.PAID,
          ],
        },
      },
      select: {
        id: true,
        supplierId: true,
        supplierNameSnapshot: true,
        status: true,
        total: true,
        paidAmount: true,
        balance: true,
        dueDate: true,
      },
    });

    const today = businessDateKey(new Date());
    const tomorrow = businessDateKey(addBusinessDays(1));
    const dueSoonEnd = businessDateKey(addBusinessDays(8));
    const zero = () => new Prisma.Decimal(0);
    const summary = {
      invoiceCount: invoices.length,
      openInvoiceCount: 0,
      overdueCount: 0,
      dueTodayCount: 0,
      dueSoonCount: 0,
      paidInvoiceCount: 0,
      totalInvoiced: zero(),
      paidAmount: zero(),
      outstandingBalance: zero(),
      overdueBalance: zero(),
      dueTodayBalance: zero(),
      dueSoonBalance: zero(),
      laterOrNoDueBalance: zero(),
    };
    const supplierMap = new Map<
      string,
      {
        supplierId: string;
        supplierName: string;
        invoiceCount: number;
        overdueCount: number;
        outstandingBalance: Prisma.Decimal;
        overdueBalance: Prisma.Decimal;
      }
    >();

    for (const invoice of invoices) {
      summary.totalInvoiced = summary.totalInvoiced.add(invoice.total);
      summary.paidAmount = summary.paidAmount.add(invoice.paidAmount);

      if (invoice.status === SupplierInvoiceStatus.PAID) {
        summary.paidInvoiceCount += 1;
        continue;
      }

      summary.openInvoiceCount += 1;
      summary.outstandingBalance = summary.outstandingBalance.add(invoice.balance);
      const dueDateKey = invoice.dueDate ? businessDateKey(invoice.dueDate) : null;
      const isOverdue = Boolean(dueDateKey && dueDateKey < today);
      const isDueToday = Boolean(dueDateKey && dueDateKey === today);
      const isDueSoon = Boolean(dueDateKey && dueDateKey >= tomorrow && dueDateKey < dueSoonEnd);

      if (isOverdue) {
        summary.overdueCount += 1;
        summary.overdueBalance = summary.overdueBalance.add(invoice.balance);
      } else if (isDueToday) {
        summary.dueTodayCount += 1;
        summary.dueTodayBalance = summary.dueTodayBalance.add(invoice.balance);
      } else if (isDueSoon) {
        summary.dueSoonCount += 1;
        summary.dueSoonBalance = summary.dueSoonBalance.add(invoice.balance);
      } else {
        summary.laterOrNoDueBalance = summary.laterOrNoDueBalance.add(invoice.balance);
      }

      const supplierSummary = supplierMap.get(invoice.supplierId) ?? {
        supplierId: invoice.supplierId,
        supplierName: invoice.supplierNameSnapshot,
        invoiceCount: 0,
        overdueCount: 0,
        outstandingBalance: zero(),
        overdueBalance: zero(),
      };
      supplierSummary.invoiceCount += 1;
      supplierSummary.outstandingBalance = supplierSummary.outstandingBalance.add(invoice.balance);
      if (isOverdue) {
        supplierSummary.overdueCount += 1;
        supplierSummary.overdueBalance = supplierSummary.overdueBalance.add(invoice.balance);
      }
      supplierMap.set(invoice.supplierId, supplierSummary);
    }

    return {
      asOf: new Date().toISOString(),
      ...summary,
      bySupplier: [...supplierMap.values()].sort((left, right) =>
        right.outstandingBalance.comparedTo(left.outstandingBalance),
      ),
    };
  }

  async create(tenantId: string, userId: string, dto: CreateSupplierInvoiceDto) {
    const supplier = await this.getSupplier(tenantId, dto.supplierId);
    const purchaseOrder = dto.purchaseOrderId
      ? await this.getValidPurchaseOrder(tenantId, dto.purchaseOrderId, supplier.id)
      : null;
    const invoiceNumber = normalizeInvoiceNumber(dto.invoiceNumber);
    const ncf = normalizeNcf(dto.ncf);
    const issueDate = parseSupplierBusinessDate(dto.issueDate);
    const dueDate = dto.dueDate ? parseSupplierBusinessDate(dto.dueDate) : null;
    const ncfValidUntil = dto.ncfValidUntil
      ? parseSupplierBusinessDate(dto.ncfValidUntil)
      : null;
    const paymentCondition = normalizeOptionalText(dto.paymentCondition) ?? null;
    this.validateDates(issueDate, dueDate);
    this.validateNcfValidUntil(issueDate, ncfValidUntil);
    await this.ensureUniqueIdentifiers(tenantId, supplier.id, invoiceNumber, ncf);
    const computed = await this.computeItems(tenantId, dto.items, purchaseOrder);

    try {
      const invoice = await this.prisma.$transaction(async (tx) => {
        const created = await tx.supplierInvoice.create({
          data: {
            tenantId,
            supplierId: supplier.id,
            purchaseOrderId: purchaseOrder?.id,
            invoiceNumber,
            ncf,
            issueDate,
            dueDate,
            ncfValidUntil,
            paymentCondition,
            status: SupplierInvoiceStatus.DRAFT,
            subtotal: computed.subtotal,
            taxTotal: computed.taxTotal,
            discountTotal: computed.discountTotal,
            total: computed.total,
            paidAmount: 0,
            balance: computed.total,
            notes: normalizeOptionalText(dto.notes),
            supplierNameSnapshot: supplier.commercialName,
            supplierDocumentTypeSnapshot: supplier.documentType,
            supplierDocumentNumberSnapshot: supplier.documentNumber,
            supplierAddressSnapshot: supplier.address,
            createdById: userId,
            items: { create: computed.items },
          },
          include: supplierInvoiceDetailInclude,
        });

        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'SUPPLIER_INVOICE_CREATED',
            entity: 'SupplierInvoice',
            entityId: created.id,
            metadata: {
              invoiceNumber,
              supplierId: supplier.id,
              purchaseOrderId: purchaseOrder?.id ?? null,
              ncfValidUntil: ncfValidUntil?.toISOString() ?? null,
              paymentCondition,
              ocrReview: this.toOcrReviewMetadata(dto.ocrReview),
              total: created.total.toString(),
            },
          },
        });

        return created;
      });

      return this.withDerivedStatus(invoice);
    } catch (error) {
      this.rethrowWriteError(error);
    }
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateSupplierInvoiceDto) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('At least one field is required to update the invoice.');
    }

    const current = await this.prisma.supplierInvoice.findFirst({
      where: { id, tenantId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!current) {
      throw new NotFoundException('Supplier invoice not found for tenant.');
    }
    if (current.status !== SupplierInvoiceStatus.DRAFT) {
      throw new ConflictException('Only draft supplier invoices can be edited.');
    }

    const supplier = await this.getSupplier(tenantId, dto.supplierId ?? current.supplierId);
    const nextPurchaseOrderId =
      dto.purchaseOrderId === undefined ? current.purchaseOrderId : dto.purchaseOrderId;
    const purchaseOrder = nextPurchaseOrderId
      ? await this.getValidPurchaseOrder(tenantId, nextPurchaseOrderId, supplier.id, current.id)
      : null;
    const invoiceNumber =
      dto.invoiceNumber === undefined
        ? current.invoiceNumber
        : normalizeInvoiceNumber(dto.invoiceNumber);
    const ncf = dto.ncf === undefined ? current.ncf : normalizeNcf(dto.ncf);
    const issueDate =
      dto.issueDate === undefined ? current.issueDate : parseSupplierBusinessDate(dto.issueDate);
    const dueDate =
      dto.dueDate === undefined
        ? current.dueDate
        : dto.dueDate
          ? parseSupplierBusinessDate(dto.dueDate)
          : null;
    const ncfValidUntil =
      dto.ncfValidUntil === undefined
        ? current.ncfValidUntil
        : dto.ncfValidUntil
          ? parseSupplierBusinessDate(dto.ncfValidUntil)
          : null;
    const paymentCondition =
      dto.paymentCondition === undefined
        ? current.paymentCondition
        : normalizeOptionalText(dto.paymentCondition) ?? null;
    this.validateDates(issueDate, dueDate);
    this.validateNcfValidUntil(issueDate, ncfValidUntil);
    await this.ensureUniqueIdentifiers(tenantId, supplier.id, invoiceNumber, ncf, current.id);

    const shouldReplaceItems = dto.items !== undefined || dto.purchaseOrderId !== undefined;
    const itemInputs =
      dto.items ??
      current.items.map((item) => ({
        productId: item.productId,
        purchaseOrderItemId: item.purchaseOrderItemId ?? undefined,
        quantity: item.quantity.toNumber(),
        unitCostNet: item.unitCostNet.toNumber(),
        taxRate: item.taxRate.toNumber(),
        discountTotal: item.discountTotal.toNumber(),
      }));
    const computed = shouldReplaceItems
      ? await this.computeItems(tenantId, itemInputs, purchaseOrder)
      : null;

    try {
      const invoice = await this.prisma.$transaction(
        async (tx) => {
          const fresh = await tx.supplierInvoice.findFirst({
            where: { id, tenantId },
            select: { status: true },
          });
          if (!fresh) {
            throw new NotFoundException('Supplier invoice not found for tenant.');
          }
          if (fresh.status !== SupplierInvoiceStatus.DRAFT) {
            throw new ConflictException('Only draft supplier invoices can be edited.');
          }

          if (computed) {
            await tx.supplierInvoiceItem.deleteMany({
              where: { tenantId, supplierInvoiceId: id },
            });
          }

          const updated = await tx.supplierInvoice.update({
            where: { id },
            data: {
              supplierId: supplier.id,
              purchaseOrderId: nextPurchaseOrderId,
              invoiceNumber,
              ncf,
              issueDate,
              dueDate,
              ncfValidUntil,
              paymentCondition,
              notes: dto.notes === undefined ? undefined : normalizeOptionalText(dto.notes),
              supplierNameSnapshot: supplier.commercialName,
              supplierDocumentTypeSnapshot: supplier.documentType,
              supplierDocumentNumberSnapshot: supplier.documentNumber,
              supplierAddressSnapshot: supplier.address,
              updatedById: userId,
              ...(computed
                ? {
                    subtotal: computed.subtotal,
                    taxTotal: computed.taxTotal,
                    discountTotal: computed.discountTotal,
                    total: computed.total,
                    balance: computed.total,
                    items: { create: computed.items },
                  }
                : {}),
            },
            include: supplierInvoiceDetailInclude,
          });

          await tx.auditLog.create({
            data: {
              tenantId,
              userId,
              action: 'SUPPLIER_INVOICE_UPDATED',
              entity: 'SupplierInvoice',
              entityId: id,
              metadata: {
                fields: Object.keys(dto),
                invoiceNumber,
                supplierId: supplier.id,
                ncfValidUntil: ncfValidUntil?.toISOString() ?? null,
                paymentCondition,
                ocrReview: this.toOcrReviewMetadata(dto.ocrReview),
              },
            },
          });

          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return this.withDerivedStatus(invoice);
    } catch (error) {
      this.rethrowWriteError(error);
    }
  }

  /**
   * Registra la factura (si todavia es borrador) y confirma su entrada fisica
   * en una sola transaccion. GoodsReceipt permanece como comprobante interno para
   * auditoria y reversion, sin obligar a la interfaz a navegar a otra pantalla.
   */
  async confirmEntry(
    tenantId: string,
    userId: string,
    id: string,
    dto: ConfirmSupplierInvoiceEntryDto,
  ) {
    try {
      const { receiptId } = await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.supplierInvoice.findFirst({
            where: { id, tenantId },
            select: { status: true },
          });
          if (!current) {
            throw new NotFoundException('Supplier invoice not found for tenant.');
          }

          if (current.status === SupplierInvoiceStatus.DRAFT) {
            await this.registerInTransaction(tx, tenantId, userId, id);
          } else if (!receiptEligibleInvoiceStatuses.includes(current.status)) {
            throw new ConflictException(
              'Solo una factura pendiente, parcialmente pagada o pagada puede registrar una entrada.',
            );
          }

          const receiptId = await this.receiptsService.createAndConfirmInTransaction(
            tx,
            tenantId,
            userId,
            {
              supplierInvoiceId: id,
              notes: dto.notes,
              items: dto.items,
            },
          );

          return { receiptId };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 20_000,
        },
      );

      const [invoice, receipt] = await Promise.all([
        this.findOne(tenantId, id),
        this.receiptsService.findOne(tenantId, receiptId),
      ]);
      return { invoice, receipt };
    } catch (error) {
      this.rethrowTransactionError(error);
    }
  }

  private async registerInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    id: string,
  ) {
    const current = await tx.supplierInvoice.findFirst({
      where: { id, tenantId },
      include: {
        purchaseOrder: {
          select: {
            id: true,
            supplierId: true,
            status: true,
            items: { select: { id: true, productId: true } },
          },
        },
        items: { select: { purchaseOrderItemId: true, productId: true } },
        _count: { select: { items: true } },
      },
    });
    if (!current) {
      throw new NotFoundException('Supplier invoice not found for tenant.');
    }
    if (current.status !== SupplierInvoiceStatus.DRAFT) {
      throw new ConflictException('Only draft supplier invoices can be registered.');
    }
    if (!current._count.items) {
      throw new BadRequestException('A supplier invoice must contain at least one product.');
    }
    this.validateDates(current.issueDate, current.dueDate);
    if (
      current.purchaseOrder &&
      (current.purchaseOrder.supplierId !== current.supplierId ||
        !allowedPurchaseOrderStatuses.includes(current.purchaseOrder.status))
    ) {
      throw new ConflictException(
        'The linked purchase order is no longer valid for this supplier invoice.',
      );
    }

    let missingPurchaseOrderItemIds: string[] = [];
    if (current.purchaseOrder) {
      const linkedItemIds = current.items
        .map((item) => item.purchaseOrderItemId)
        .filter((itemId): itemId is string => Boolean(itemId));
      const linkedItemIdsSet = new Set(linkedItemIds);
      const orderItemsById = new Map(current.purchaseOrder.items.map((item) => [item.id, item]));
      if (
        linkedItemIds.length !== current.items.length ||
        linkedItemIdsSet.size !== linkedItemIds.length ||
        current.items.some((item) => {
          const orderItem = item.purchaseOrderItemId
            ? orderItemsById.get(item.purchaseOrderItemId)
            : undefined;
          return !orderItem || orderItem.productId !== item.productId;
        })
      ) {
        throw new ConflictException(
          'Cada línea facturada debe pertenecer una sola vez a la orden de compra y coincidir con su producto.',
        );
      }

      missingPurchaseOrderItemIds = current.purchaseOrder.items
        .filter((item) => !linkedItemIdsSet.has(item.id))
        .map((item) => item.id);
    } else if (current.items.some((item) => item.purchaseOrderItemId)) {
      throw new ConflictException(
        'A standalone supplier invoice cannot contain purchase order lines.',
      );
    }

    await tx.supplierInvoice.update({
      where: { id },
      data: {
        status: SupplierInvoiceStatus.PENDING,
        balance: current.total,
        updatedById: userId,
      },
    });

    const registered = await tx.supplierInvoice.findUniqueOrThrow({
      where: { id },
      include: supplierInvoiceDetailInclude,
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'SUPPLIER_INVOICE_REGISTERED',
        entity: 'SupplierInvoice',
        entityId: id,
        metadata: {
          invoiceNumber: registered.invoiceNumber,
          total: registered.total.toString(),
          purchaseOrderId: current.purchaseOrder?.id ?? null,
          invoicedPurchaseOrderLineCount: current.items.length,
          missingPurchaseOrderItemIds,
          missingPurchaseOrderLineCount: missingPurchaseOrderItemIds.length,
        },
      },
    });

    return registered;
  }

  async cancel(tenantId: string, userId: string, id: string, rawReason: string) {
    const reason = rawReason.trim();

    try {
      const invoice = await this.prisma.$transaction(
        async (tx) => {
          const current = await tx.supplierInvoice.findFirst({
            where: { id, tenantId },
            include: {
              goodsReceipts: {
                where: { status: GoodsReceiptStatus.CONFIRMED },
                select: { id: true },
              },
              payments: {
                where: { status: PaymentStatus.COMPLETED },
                select: { id: true },
              },
            },
          });
          if (!current) {
            throw new NotFoundException('Supplier invoice not found for tenant.');
          }
          if (current.status === SupplierInvoiceStatus.CANCELLED) {
            throw new ConflictException('Supplier invoice is already cancelled.');
          }
          if (current.goodsReceipts.length) {
            throw new ConflictException(
              'A supplier invoice with confirmed goods receipts cannot be cancelled.',
            );
          }
          if (current.payments.length) {
            throw new ConflictException(
              'Cancel completed supplier payments before cancelling the invoice.',
            );
          }

          const cancelled = await tx.supplierInvoice.update({
            where: { id },
            data: {
              status: SupplierInvoiceStatus.CANCELLED,
              paidAmount: 0,
              balance: 0,
              cancelledById: userId,
              cancelledAt: new Date(),
              cancelReason: reason,
              updatedById: userId,
            },
            include: supplierInvoiceDetailInclude,
          });

          await tx.auditLog.create({
            data: {
              tenantId,
              userId,
              action: 'SUPPLIER_INVOICE_CANCELLED',
              entity: 'SupplierInvoice',
              entityId: id,
              metadata: {
                reason,
                invoiceNumber: cancelled.invoiceNumber,
              },
            },
          });

          return cancelled;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return this.withDerivedStatus(invoice);
    } catch (error) {
      this.rethrowTransactionError(error);
    }
  }

  async registerPayment(
    tenantId: string,
    userId: string,
    invoiceId: string,
    dto: RegisterSupplierPaymentDto,
  ) {
    const requestedAmount = new Prisma.Decimal(dto.amount).toDecimalPlaces(2);
    const requestedTenderedAmount =
      dto.tenderedAmount === undefined
        ? requestedAmount
        : new Prisma.Decimal(dto.tenderedAmount).toDecimalPlaces(2);

    if (dto.method !== PaymentMethod.CASH && !requestedTenderedAmount.eq(requestedAmount)) {
      throw new BadRequestException(
        'Tendered amount must equal the applied amount for transfers and checks.',
      );
    }

    const paymentNumber = this.generatePaymentNumber();

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const eligibleInvoice = await tx.supplierInvoice.findFirst({
            where: {
              id: invoiceId,
              tenantId,
              status: { in: payableStatuses },
              goodsReceipts: {
                some: {
                  tenantId,
                  status: GoodsReceiptStatus.CONFIRMED,
                },
              },
            },
            select: { balance: true },
          });

          if (!eligibleInvoice) {
            await this.throwPaymentInvoiceError(
              tx,
              tenantId,
              invoiceId,
              requestedAmount,
              dto.method === PaymentMethod.CASH,
            );
          }

          // Un pago en efectivo puede ser mayor que el saldo. En ese caso se
          // registra el efectivo entregado y el cambio, pero solo se aplica el
          // saldo pendiente a la factura. No se crea ningún movimiento de caja.
          const tenderedAmount = requestedTenderedAmount;
          const eligibleBalance = eligibleInvoice!.balance;
          const amount =
            dto.method === PaymentMethod.CASH
              ? tenderedAmount.gt(eligibleBalance)
                ? eligibleBalance
                : tenderedAmount
              : requestedAmount;
          const changeAmount =
            dto.method === PaymentMethod.CASH
              ? tenderedAmount.minus(amount).toDecimalPlaces(2)
              : new Prisma.Decimal(0);

          if (amount.lte(0)) {
            throw new ConflictException('Supplier invoice has no pending balance to pay.');
          }

          // La factura tiene una restricción de base de datos que exige que el
          // estado y sus importes sean coherentes en cada escritura. Por eso el
          // nuevo estado debe guardarse en la misma sentencia que el abono; un
          // estado PENDING con un importe ya pagado sería inválido incluso
          // dentro de esta transacción.
          const nextBalance = eligibleBalance.minus(amount).toDecimalPlaces(2);
          const nextStatus = nextBalance.eq(0)
            ? SupplierInvoiceStatus.PAID
            : SupplierInvoiceStatus.PARTIALLY_PAID;

          const updateResult = await tx.supplierInvoice.updateMany({
            where: {
              id: invoiceId,
              tenantId,
              status: { in: payableStatuses },
              balance: { gte: amount },
              goodsReceipts: {
                some: {
                  tenantId,
                  status: GoodsReceiptStatus.CONFIRMED,
                },
              },
            },
            data: {
              paidAmount: { increment: amount },
              balance: { decrement: amount },
              status: nextStatus,
              updatedById: userId,
            },
          });

          if (!updateResult.count) {
            await this.throwPaymentInvoiceError(
              tx,
              tenantId,
              invoiceId,
              amount,
              dto.method === PaymentMethod.CASH,
            );
          }

          const payment = await tx.supplierPayment.create({
            data: {
              tenantId,
              supplierInvoiceId: invoiceId,
              paymentNumber,
              method: dto.method,
              amount,
              tenderedAmount,
              changeAmount,
              status: PaymentStatus.COMPLETED,
              // Los pagos a suplidores son contables: incluso en efectivo no impactan caja.
              // Se conserva el campo nullable solo para poder leer pagos historicos vinculados.
              cashSessionId: null,
              reference: normalizeOptionalText(dto.reference),
              notes: normalizeOptionalText(dto.notes),
              paidAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
              createdById: userId,
            },
            include: {
              createdBy: { select: { id: true, name: true, email: true } },
              cashSession: {
                select: {
                  id: true,
                  status: true,
                  cashRegister: { select: { id: true, name: true } },
                },
              },
            },
          });

          const invoice = await tx.supplierInvoice.findUniqueOrThrow({
            where: { id: invoiceId },
            include: supplierInvoiceDetailInclude,
          });

          await tx.auditLog.create({
            data: {
              tenantId,
              userId,
              action: 'SUPPLIER_PAYMENT_REGISTERED',
              entity: 'SupplierPayment',
              entityId: payment.id,
              metadata: {
                supplierInvoiceId: invoiceId,
                paymentNumber,
                method: dto.method,
                amount: amount.toString(),
                tenderedAmount: tenderedAmount.toString(),
                changeAmount: changeAmount.toString(),
                cashSessionId: null,
                cashImpact: 'NONE',
              },
            },
          });

          return { payment, invoice };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return {
        payment: result.payment,
        invoice: this.withDerivedStatus(result.invoice),
      };
    } catch (error) {
      this.rethrowWriteError(error);
    }
  }

  async cancelPayment(
    tenantId: string,
    userId: string,
    invoiceId: string,
    paymentId: string,
    dto: CancelSupplierPaymentDto,
  ) {
    const reason = dto.reason.trim();

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const payment = await tx.supplierPayment.findFirst({
            where: {
              id: paymentId,
              tenantId,
              supplierInvoiceId: invoiceId,
            },
            include: {
              supplierInvoice: true,
            },
          });
          if (!payment) {
            throw new NotFoundException('Supplier payment not found for this invoice and tenant.');
          }
          if (payment.status !== PaymentStatus.COMPLETED) {
            throw new ConflictException('Only completed supplier payments can be cancelled.');
          }
          if (payment.supplierInvoice.status === SupplierInvoiceStatus.CANCELLED) {
            throw new ConflictException('Payments on a cancelled invoice cannot be changed.');
          }
          if (payment.supplierInvoice.paidAmount.lt(payment.amount)) {
            throw new ConflictException('Invoice paid balance is inconsistent with this payment.');
          }
          const cancelled = await tx.supplierPayment.updateMany({
            where: {
              id: payment.id,
              tenantId,
              status: PaymentStatus.COMPLETED,
            },
            data: {
              status: PaymentStatus.CANCELLED,
              cancelledById: userId,
              cancelledAt: new Date(),
              cancelReason: reason,
            },
          });
          if (!cancelled.count) {
            throw new ConflictException('Supplier payment was already changed.');
          }

          // Igual que al registrar un pago, los importes y el estado deben
          // cambiar de forma atómica para respetar SupplierInvoice_amounts_check.
          const nextPaidAmount = payment.supplierInvoice.paidAmount
            .minus(payment.amount)
            .toDecimalPlaces(2);
          const nextStatus = nextPaidAmount.eq(0)
            ? SupplierInvoiceStatus.PENDING
            : SupplierInvoiceStatus.PARTIALLY_PAID;

          await tx.supplierInvoice.update({
            where: { id: invoiceId },
            data: {
              paidAmount: { decrement: payment.amount },
              balance: { increment: payment.amount },
              status: nextStatus,
              updatedById: userId,
            },
          });

          const invoice = await tx.supplierInvoice.findUniqueOrThrow({
            where: { id: invoiceId },
            include: supplierInvoiceDetailInclude,
          });
          const updatedPayment = invoice.payments.find((candidate) => candidate.id === payment.id)!;

          await tx.auditLog.create({
            data: {
              tenantId,
              userId,
              action: 'SUPPLIER_PAYMENT_CANCELLED',
              entity: 'SupplierPayment',
              entityId: paymentId,
              metadata: {
                supplierInvoiceId: invoiceId,
                paymentNumber: updatedPayment.paymentNumber,
                amount: updatedPayment.amount.toString(),
                tenderedAmount: updatedPayment.tenderedAmount.toString(),
                changeAmount: updatedPayment.changeAmount.toString(),
                reason,
                historicalCashSessionId: payment.cashSessionId ?? null,
                cashImpact: 'NONE',
              },
            },
          });

          return { payment: updatedPayment, invoice };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return {
        payment: result.payment,
        invoice: this.withDerivedStatus(result.invoice),
      };
    } catch (error) {
      this.rethrowTransactionError(error);
    }
  }

  private async computeItems(
    tenantId: string,
    dtoItems: SupplierInvoiceItemDto[],
    purchaseOrder: ValidPurchaseOrder | null,
  ) {
    const productIds = [...new Set(dtoItems.map((item) => item.productId))];
    const products = await this.prisma.product.findMany({
      where: { tenantId, id: { in: productIds } },
    });
    if (products.length !== productIds.length) {
      throw new NotFoundException(
        'One or more supplier invoice products do not belong to this tenant.',
      );
    }

    const orderItemIds = dtoItems
      .map((item) => item.purchaseOrderItemId)
      .filter((id): id is string => Boolean(id));
    if (new Set(orderItemIds).size !== orderItemIds.length) {
      throw new BadRequestException(
        'A purchase order item can only appear once in a supplier invoice.',
      );
    }
    if (!purchaseOrder && orderItemIds.length) {
      throw new BadRequestException(
        'Purchase order items cannot be linked without a purchase order.',
      );
    }
    if (purchaseOrder && orderItemIds.length !== dtoItems.length) {
      throw new BadRequestException(
        'Every item on an invoice linked to a purchase order must reference its order line.',
      );
    }

    const productsById = new Map(products.map((product) => [product.id, product]));
    const orderItemsById = new Map((purchaseOrder?.items ?? []).map((item) => [item.id, item]));
    const items = dtoItems.map((dto) => {
      const product = productsById.get(dto.productId)!;
      const purchaseOrderItem = dto.purchaseOrderItemId
        ? orderItemsById.get(dto.purchaseOrderItemId)
        : undefined;
      if (dto.purchaseOrderItemId && !purchaseOrderItem) {
        throw new BadRequestException(
          'A linked purchase order item does not belong to the selected order.',
        );
      }
      if (purchaseOrderItem && purchaseOrderItem.productId !== product.id) {
        throw new BadRequestException(`The purchase order product does not match ${product.name}.`);
      }

      const quantity = new Prisma.Decimal(dto.quantity).toDecimalPlaces(3);
      const quotedUnitCostNet = new Prisma.Decimal(dto.unitCostNet).toDecimalPlaces(2);
      const gross = quantity.mul(quotedUnitCostNet).toDecimalPlaces(2);
      const discountTotal = new Prisma.Decimal(dto.discountTotal ?? 0).toDecimalPlaces(2);
      if (discountTotal.gt(gross)) {
        throw new BadRequestException(`Discount exceeds the gross subtotal for ${product.name}.`);
      }
      const subtotal = gross.sub(discountTotal).toDecimalPlaces(2);
      const taxRate = new Prisma.Decimal(dto.taxRate).toDecimalPlaces(4);
      const taxTotal = subtotal.mul(taxRate).toDecimalPlaces(2);
      const total = subtotal.add(taxTotal).toDecimalPlaces(2);
      const unitCostNet = subtotal.div(quantity).toDecimalPlaces(2);
      const unitCostWithTax = total.div(quantity).toDecimalPlaces(2);

      return {
        tenantId,
        purchaseOrderItemId: purchaseOrderItem?.id,
        productId: product.id,
        skuSnapshot: product.sku,
        barcodeSnapshot: product.barcode,
        descriptionSnapshot: product.name,
        unitSnapshot: product.unit,
        quantity,
        unitCostNet,
        unitCostWithTax,
        discountTotal,
        taxRate,
        taxTotal,
        subtotal,
        total,
      };
    });

    return {
      items,
      subtotal: sumDecimals(items.map((item) => item.subtotal)),
      taxTotal: sumDecimals(items.map((item) => item.taxTotal)),
      discountTotal: sumDecimals(items.map((item) => item.discountTotal)),
      total: sumDecimals(items.map((item) => item.total)),
    };
  }

  private async getSupplier(tenantId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
    });
    if (!supplier) {
      throw new NotFoundException('Supplier not found for tenant.');
    }
    return supplier;
  }

  private async getValidPurchaseOrder(
    tenantId: string,
    purchaseOrderId: string,
    supplierId: string,
    currentInvoiceId?: string,
  ) {
    const purchaseOrder = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, tenantId },
      include: {
        items: { select: { id: true, productId: true } },
        supplierInvoice: { select: { id: true } },
      },
    });
    if (!purchaseOrder) {
      throw new NotFoundException('Purchase order not found for tenant.');
    }
    if (purchaseOrder.supplierId !== supplierId) {
      throw new BadRequestException(
        'Purchase order and supplier invoice must use the same supplier.',
      );
    }
    if (!allowedPurchaseOrderStatuses.includes(purchaseOrder.status)) {
      throw new ConflictException(
        'Una factura de proveedor solo se puede vincular a una orden emitida que aun no tenga recepcion.',
      );
    }
    if (purchaseOrder.supplierInvoice && purchaseOrder.supplierInvoice.id !== currentInvoiceId) {
      throw new ConflictException('This purchase order already has a supplier invoice.');
    }
    return purchaseOrder;
  }

  private async ensureUniqueIdentifiers(
    tenantId: string,
    supplierId: string,
    invoiceNumber: string,
    ncf: string | null,
    currentInvoiceId?: string,
  ) {
    const existing = await this.prisma.supplierInvoice.findFirst({
      where: {
        tenantId,
        supplierId,
        ...(currentInvoiceId ? { id: { not: currentInvoiceId } } : {}),
        OR: [{ invoiceNumber }, ...(ncf ? [{ ncf }] : [])],
      },
      select: { invoiceNumber: true, ncf: true },
    });
    if (!existing) {
      return;
    }
    if (existing.invoiceNumber === invoiceNumber) {
      throw new ConflictException('This supplier already has an invoice with the same number.');
    }
    throw new ConflictException('This supplier already has an invoice with the same NCF.');
  }

  private getInvoiceDetail(tenantId: string, id: string) {
    return this.prisma.supplierInvoice
      .findFirst({
        where: { id, tenantId },
        include: supplierInvoiceDetailInclude,
      })
      .then((invoice) => {
        if (!invoice) {
          throw new NotFoundException('Supplier invoice not found for tenant.');
        }
        return invoice;
      });
  }

  private async throwPaymentInvoiceError(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
    amount: Prisma.Decimal,
    allowCashChange = false,
  ): Promise<never> {
    const invoice = await tx.supplierInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      select: {
        status: true,
        balance: true,
        goodsReceipts: {
          where: { tenantId, status: GoodsReceiptStatus.CONFIRMED },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!invoice) {
      throw new NotFoundException('Supplier invoice not found for tenant.');
    }
    if (!payableStatuses.includes(invoice.status)) {
      throw new ConflictException(
        'Only pending or partially paid supplier invoices accept payments.',
      );
    }
    if (!allowCashChange && amount.gt(invoice.balance)) {
      throw new BadRequestException('Supplier payment cannot exceed invoice balance.');
    }
    if (!invoice.goodsReceipts.length) {
      throw new ConflictException(
        'Confirma la entrada de mercancía antes de registrar un pago a esta factura de suplidor.',
      );
    }
    throw new ConflictException(
      'Supplier invoice changed while registering the payment. Try again.',
    );
  }

  private validateDates(issueDate: Date, dueDate: Date | null) {
    if (!dueDate) {
      throw new BadRequestException('Supplier invoice due date is required.');
    }
    if (businessDateKey(dueDate) < businessDateKey(issueDate)) {
      throw new BadRequestException('Supplier invoice due date cannot be before its issue date.');
    }
  }

  private validateNcfValidUntil(issueDate: Date, ncfValidUntil: Date | null) {
    if (ncfValidUntil && businessDateKey(ncfValidUntil) < businessDateKey(issueDate)) {
      throw new BadRequestException(
        'Supplier invoice NCF validity cannot be before its issue date.',
      );
    }
  }

  private toOcrReviewMetadata(review?: SupplierInvoiceOcrReviewDto) {
    if (!review) return null;
    return {
      source: 'LOCAL_BROWSER',
      pageCount: review.pageCount ?? null,
      detectedTotal: review.detectedTotal ?? null,
      totalMismatchAccepted: review.totalMismatchAccepted ?? false,
      warnings: (review.warnings ?? []).slice(0, 12),
    };
  }

  private overdueWhere(): Prisma.SupplierInvoiceWhereInput {
    return {
      status: { in: payableStatuses },
      balance: { gt: 0 },
      dueDate: { lt: currentBusinessDateAnchor() },
    };
  }

  private withDerivedStatus<
    T extends {
      status: SupplierInvoiceStatus;
      balance: Prisma.Decimal;
      dueDate: Date | null;
    },
  >(invoice: T) {
    const isOverdue = Boolean(
      payableStatuses.includes(invoice.status) &&
      invoice.balance.gt(0) &&
      invoice.dueDate &&
      businessDateKey(invoice.dueDate) < businessDateKey(new Date()),
    );
    return {
      ...invoice,
      isOverdue,
      displayStatus: isOverdue ? 'OVERDUE' : invoice.status,
    };
  }

  private generatePaymentNumber() {
    const date = businessDateKey(new Date()).replace(/-/g, '');
    return `PP-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private rethrowWriteError(error: unknown): never {
    if (isUniqueConstraintError(error)) {
      throw new ConflictException(
        'Invoice number, NCF, purchase order, or payment number is already in use.',
      );
    }
    this.rethrowTransactionError(error);
  }

  private rethrowTransactionError(error: unknown): never {
    if (isTransactionConflict(error)) {
      throw new ConflictException(
        'The accounting record changed concurrently. Try the operation again.',
      );
    }
    throw error;
  }
}

type ValidPurchaseOrder = Prisma.PurchaseOrderGetPayload<{
  include: {
    items: { select: { id: true; productId: true } };
    supplierInvoice: { select: { id: true } };
  };
}>;

function normalizeInvoiceNumber(value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
  if (!normalized) {
    throw new BadRequestException('Supplier invoice number is required.');
  }
  return normalized;
}

function normalizeNcf(value?: string | null) {
  if (value === undefined || value === null) {
    return null;
  }
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
}

function normalizeOptionalText(value?: string | null) {
  if (value === undefined) {
    return undefined;
  }
  return value?.trim() || null;
}

function sumDecimals(values: Prisma.Decimal[]) {
  return values.reduce((sum, value) => sum.add(value), new Prisma.Decimal(0)).toDecimalPlaces(2);
}

function parseSupplierBusinessDate(value: string) {
  const parsed = parseBusinessDate(value);
  if (!parsed) {
    throw new BadRequestException('Invalid supplier invoice date.');
  }

  const normalized = parseBusinessDate(businessDateKey(parsed));
  if (!normalized) {
    throw new BadRequestException('Invalid supplier invoice date.');
  }
  return normalized;
}

function currentBusinessDateAnchor() {
  const parsed = parseBusinessDate(businessDateKey(new Date()));
  if (!parsed) {
    throw new Error('Unable to resolve the current business date.');
  }
  return parsed;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isTransactionConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}
