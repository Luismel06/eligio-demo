import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductStatus,
  PurchaseOrderStatus,
  Role,
  SupplierInvoiceStatus,
  SupplierStatus,
} from '@qorvex/database';
import { randomUUID } from 'crypto';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderItemDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';

const adminRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];
const purchasingRoles: Role[] = [...adminRoles, Role.ACCOUNTANT];

const purchaseOrderInclude = {
  supplier: true,
  items: {
    include: {
      product: true,
      supplierProduct: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  events: {
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  createdBy: { select: { id: true, name: true, email: true } },
  requestedBy: { select: { id: true, name: true, email: true } },
  reviewedBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
  issuedBy: { select: { id: true, name: true, email: true } },
  supplierInvoice: { select: { id: true, invoiceNumber: true, status: true } },
  goodsReceipts: { select: { id: true, receiptNumber: true, status: true } },
} satisfies Prisma.PurchaseOrderInclude;

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(
    tenantId: string,
    user: AuthenticatedUser,
    filters: { status?: string; q?: string },
  ) {
    this.requirePurchasingAccess(tenantId, user);
    const overdueOnly = filters.status === 'OVERDUE';
    const status = overdueOnly ? undefined : this.parseStatus(filters.status);
    const query = filters.q?.trim();
    const orders = await this.prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        ...(status ? { status } : {}),
        ...(query
          ? {
              OR: [
                { orderNumber: { contains: query, mode: 'insensitive' } },
                { supplierNameSnapshot: { contains: query, mode: 'insensitive' } },
                { supplierDocumentNumberSnapshot: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: purchaseOrderInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const decorated = orders.map((order) => this.withDerivedStatus(order));
    return overdueOnly ? decorated.filter((order) => order.isOverdue) : decorated;
  }

  async findOne(tenantId: string, user: AuthenticatedUser, id: string) {
    this.requirePurchasingAccess(tenantId, user);
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: purchaseOrderInclude,
    });

    if (!order) {
      throw new NotFoundException('Purchase order not found for tenant.');
    }

    return this.withDerivedStatus(order);
  }

  async create(tenantId: string, user: AuthenticatedUser, dto: CreatePurchaseOrderDto) {
    this.requirePurchasingWrite(tenantId, user);
    const supplier = await this.getActiveSupplier(tenantId, dto.supplierId);
    const computed = await this.computeItems(tenantId, supplier.id, dto.items);
    const orderNumber = this.generateOrderNumber();

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          tenantId,
          supplierId: supplier.id,
          orderNumber,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? this.parseBusinessDate(dto.expectedDeliveryDate)
            : undefined,
          notes: dto.notes?.trim() || undefined,
          subtotal: computed.subtotal,
          taxTotal: computed.taxTotal,
          discountTotal: computed.discountTotal,
          total: computed.total,
          supplierNameSnapshot: supplier.commercialName,
          supplierDocumentTypeSnapshot: supplier.documentType,
          supplierDocumentNumberSnapshot: supplier.documentNumber,
          supplierContactSnapshot: supplier.contactName,
          supplierAddressSnapshot: supplier.address,
          createdById: user.id,
          items: {
            create: computed.items,
          },
          events: {
            create: {
              tenantId,
              toStatus: PurchaseOrderStatus.DRAFT,
              note: 'Orden de compra creada',
              createdById: user.id,
            },
          },
        },
        include: purchaseOrderInclude,
      });

      return created;
    });

    await this.audit.log({
      tenantId,
      userId: user.id,
      action: 'PURCHASE_ORDER_CREATED',
      entity: 'PurchaseOrder',
      entityId: order.id,
      metadata: { orderNumber, supplierId: supplier.id, total: order.total.toString() },
    });

    return this.withDerivedStatus(order);
  }

  async update(tenantId: string, user: AuthenticatedUser, id: string, dto: UpdatePurchaseOrderDto) {
    this.requirePurchasingWrite(tenantId, user);
    const current = await this.getOrder(tenantId, id);

    if (current.status !== PurchaseOrderStatus.DRAFT) {
      throw new ConflictException('Only draft purchase orders can be edited.');
    }
    if (dto.supplierId && dto.supplierId !== current.supplierId && !dto.items) {
      throw new BadRequestException(
        'Changing the supplier requires resubmitting all purchase order items.',
      );
    }

    const supplier = await this.getActiveSupplier(tenantId, dto.supplierId ?? current.supplierId);
    const computed = dto.items
      ? await this.computeItems(tenantId, supplier.id, dto.items)
      : undefined;

    const order = await this.prisma.$transaction(async (tx) => {
      if (computed) {
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: current.id, tenantId },
        });
      }

      return tx.purchaseOrder.update({
        where: { id: current.id },
        data: {
          supplierId: supplier.id,
          expectedDeliveryDate:
            dto.expectedDeliveryDate === undefined
              ? undefined
              : this.parseBusinessDate(dto.expectedDeliveryDate),
          notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
          supplierNameSnapshot: supplier.commercialName,
          supplierDocumentTypeSnapshot: supplier.documentType,
          supplierDocumentNumberSnapshot: supplier.documentNumber,
          supplierContactSnapshot: supplier.contactName,
          supplierAddressSnapshot: supplier.address,
          ...(computed
            ? {
                subtotal: computed.subtotal,
                taxTotal: computed.taxTotal,
                discountTotal: computed.discountTotal,
                total: computed.total,
                items: { create: computed.items },
              }
            : {}),
        },
        include: purchaseOrderInclude,
      });
    });

    await this.audit.log({
      tenantId,
      userId: user.id,
      action: 'PURCHASE_ORDER_UPDATED',
      entity: 'PurchaseOrder',
      entityId: id,
      metadata: { fields: Object.keys(dto) },
    });

    return this.withDerivedStatus(order);
  }

  request(tenantId: string, user: AuthenticatedUser, id: string, note?: string) {
    this.requirePurchasingWrite(tenantId, user);
    return this.transition(tenantId, user, id, {
      allowed: [PurchaseOrderStatus.DRAFT],
      next: PurchaseOrderStatus.REQUESTED,
      note,
      fields: { requestDate: new Date(), requestedAt: new Date(), requestedById: user.id },
      action: 'PURCHASE_ORDER_REQUESTED',
    });
  }

  /**
   * Kept while clients move from the old "submit" vocabulary to the clearer
   * "request" action. Both actions intentionally follow the same transition.
   */
  submit(tenantId: string, user: AuthenticatedUser, id: string, note?: string) {
    return this.request(tenantId, user, id, note);
  }

  review(tenantId: string, user: AuthenticatedUser, id: string, note?: string) {
    this.requireAdmin(tenantId, user);
    return this.transition(tenantId, user, id, {
      allowed: [PurchaseOrderStatus.REQUESTED],
      next: PurchaseOrderStatus.UNDER_REVIEW,
      note,
      fields: { reviewedAt: new Date(), reviewedById: user.id },
      action: 'PURCHASE_ORDER_REVIEW_STARTED',
    });
  }

  approve(tenantId: string, user: AuthenticatedUser, id: string, note?: string) {
    this.requireAdmin(tenantId, user);
    return this.transition(tenantId, user, id, {
      allowed: [PurchaseOrderStatus.UNDER_REVIEW],
      next: PurchaseOrderStatus.APPROVED,
      note,
      fields: { approvedAt: new Date(), approvedById: user.id },
      action: 'PURCHASE_ORDER_APPROVED',
    });
  }

  issue(tenantId: string, user: AuthenticatedUser, id: string, note?: string) {
    this.requireAdmin(tenantId, user);
    return this.transition(tenantId, user, id, {
      // New orders are validated by the administrator at the moment of issuance:
      // DRAFT -> REQUESTED -> ISSUED. UNDER_REVIEW and APPROVED remain valid here
      // solely so historical orders can continue their previous lifecycle.
      allowed: [
        PurchaseOrderStatus.REQUESTED,
        PurchaseOrderStatus.UNDER_REVIEW,
        PurchaseOrderStatus.APPROVED,
      ],
      next: PurchaseOrderStatus.ISSUED,
      note,
      fields: { issuedAt: new Date(), issuedById: user.id },
      action: 'PURCHASE_ORDER_ISSUED',
    });
  }

  pause(tenantId: string, user: AuthenticatedUser, id: string, note?: string) {
    this.requireAdmin(tenantId, user);
    if (!note?.trim()) {
      throw new BadRequestException('A reason is required to pause a purchase order.');
    }

    return this.transition(tenantId, user, id, {
      allowed: [
        PurchaseOrderStatus.REQUESTED,
        PurchaseOrderStatus.UNDER_REVIEW,
        PurchaseOrderStatus.APPROVED,
        PurchaseOrderStatus.ISSUED,
      ],
      next: PurchaseOrderStatus.PAUSED,
      note,
      fields: { pausedAt: new Date(), pausedById: user.id, pauseReason: note.trim() },
      action: 'PURCHASE_ORDER_PAUSED',
    });
  }

  async resume(tenantId: string, user: AuthenticatedUser, id: string, note?: string) {
    this.requireAdmin(tenantId, user);
    const order = await this.getOrder(tenantId, id);
    if (order.status !== PurchaseOrderStatus.PAUSED) {
      throw new ConflictException('Only paused purchase orders can be resumed.');
    }

    const next = order.issuedAt
      ? PurchaseOrderStatus.ISSUED
      : order.approvedAt
        ? PurchaseOrderStatus.APPROVED
        : order.reviewedAt
          ? PurchaseOrderStatus.UNDER_REVIEW
          : PurchaseOrderStatus.REQUESTED;

    return this.transition(tenantId, user, id, {
      allowed: [PurchaseOrderStatus.PAUSED],
      next,
      note,
      fields: { pausedAt: null, pausedById: null, pauseReason: null },
      action: 'PURCHASE_ORDER_RESUMED',
    });
  }

  async cancel(tenantId: string, user: AuthenticatedUser, id: string, note?: string) {
    this.requireAdmin(tenantId, user);
    if (!note?.trim()) {
      throw new BadRequestException('A reason is required to cancel a purchase order.');
    }
    const order = await this.getOrder(tenantId, id);
    if (
      order.status === PurchaseOrderStatus.PARTIALLY_RECEIVED ||
      order.status === PurchaseOrderStatus.RECEIVED
    ) {
      throw new ConflictException('A received purchase order cannot be cancelled.');
    }

    if (order.supplierInvoice && order.supplierInvoice.status !== SupplierInvoiceStatus.CANCELLED) {
      throw new ConflictException(
        'Primero debes cancelar la factura de proveedor vinculada antes de cancelar la orden.',
      );
    }

    return this.transition(tenantId, user, id, {
      allowed: [
        PurchaseOrderStatus.DRAFT,
        PurchaseOrderStatus.REQUESTED,
        PurchaseOrderStatus.UNDER_REVIEW,
        PurchaseOrderStatus.APPROVED,
        PurchaseOrderStatus.ISSUED,
        PurchaseOrderStatus.PAUSED,
      ],
      next: PurchaseOrderStatus.CANCELLED,
      note,
      fields: {
        cancelledAt: new Date(),
        cancelledById: user.id,
        cancelReason: note.trim(),
      },
      action: 'PURCHASE_ORDER_CANCELLED',
      requireNoActiveSupplierInvoice: true,
    });
  }

  private async transition(
    tenantId: string,
    user: AuthenticatedUser,
    id: string,
    config: {
      allowed: PurchaseOrderStatus[];
      next: PurchaseOrderStatus;
      note?: string;
      fields: Prisma.PurchaseOrderUncheckedUpdateManyInput;
      action: string;
      requireNoActiveSupplierInvoice?: boolean;
    },
  ) {
    const current = await this.getOrder(tenantId, id);
    if (!config.allowed.includes(current.status)) {
      throw new ConflictException(
        `Purchase order cannot move from ${current.status} to ${config.next}.`,
      );
    }

    const order = await this.prisma.$transaction(async (tx) => {
      if (config.requireNoActiveSupplierInvoice) {
        const activeInvoice = await tx.supplierInvoice.findFirst({
          where: {
            tenantId,
            purchaseOrderId: id,
            status: { not: SupplierInvoiceStatus.CANCELLED },
          },
          select: { id: true },
        });
        if (activeInvoice) {
          throw new ConflictException(
            'La orden tiene una factura de proveedor activa. Cancela primero ese documento.',
          );
        }
      }

      const changed = await tx.purchaseOrder.updateMany({
        where: { id, tenantId, status: current.status },
        data: { status: config.next, ...config.fields },
      });
      if (changed.count !== 1) {
        throw new ConflictException(
          'Purchase order changed while this transition was being processed.',
        );
      }
      await tx.purchaseOrderEvent.create({
        data: {
          tenantId,
          purchaseOrderId: id,
          fromStatus: current.status,
          toStatus: config.next,
          note: config.note?.trim() || undefined,
          createdById: user.id,
        },
      });
      return tx.purchaseOrder.findUniqueOrThrow({
        where: { id },
        include: purchaseOrderInclude,
      });
    });

    await this.audit.log({
      tenantId,
      userId: user.id,
      action: config.action,
      entity: 'PurchaseOrder',
      entityId: id,
      metadata: { from: current.status, to: config.next, note: config.note },
    });

    return this.withDerivedStatus(order);
  }

  private async computeItems(
    tenantId: string,
    supplierId: string,
    dtoItems: PurchaseOrderItemDto[],
  ) {
    const productIds = [...new Set(dtoItems.map((item) => item.productId))];
    if (productIds.length !== dtoItems.length) {
      throw new BadRequestException('A product can only appear once in a purchase order.');
    }

    const [products, supplierProducts] = await Promise.all([
      this.prisma.product.findMany({
        where: { tenantId, id: { in: productIds }, status: ProductStatus.ACTIVE },
      }),
      this.prisma.supplierProduct.findMany({
        where: { tenantId, supplierId, productId: { in: productIds }, active: true },
      }),
    ]);
    if (products.length !== productIds.length) {
      throw new NotFoundException('One or more products are unavailable for this tenant.');
    }

    const productsById = new Map(products.map((product) => [product.id, product]));
    const supplierProductsByProduct = new Map(
      supplierProducts.map((link) => [link.productId, link]),
    );
    const items = dtoItems.map((dto) => {
      const product = productsById.get(dto.productId)!;
      const supplierProduct = supplierProductsByProduct.get(dto.productId);
      const quantity = new Prisma.Decimal(dto.quantity).toDecimalPlaces(3);
      const quotedUnitCostNet = new Prisma.Decimal(dto.unitCostNet).toDecimalPlaces(2);
      const gross = quantity.mul(quotedUnitCostNet).toDecimalPlaces(2);
      const discountTotal = new Prisma.Decimal(dto.discountTotal ?? 0).toDecimalPlaces(2);
      if (discountTotal.gt(gross)) {
        throw new BadRequestException(`Discount exceeds subtotal for ${product.name}.`);
      }
      const subtotal = gross.sub(discountTotal).toDecimalPlaces(2);
      const taxRate = new Prisma.Decimal(dto.taxRate ?? product.taxRate).toDecimalPlaces(4);
      const taxTotal = subtotal.mul(taxRate).toDecimalPlaces(2);
      const total = subtotal.add(taxTotal).toDecimalPlaces(2);
      const unitCostNet = subtotal.div(quantity).toDecimalPlaces(2);
      const unitCostWithTax = total.div(quantity).toDecimalPlaces(2);

      return {
        tenantId,
        productId: product.id,
        supplierProductId: supplierProduct?.id,
        skuSnapshot: product.sku,
        barcodeSnapshot: product.barcode,
        descriptionSnapshot: product.name,
        unitSnapshot: product.unit,
        supplierSkuSnapshot: supplierProduct?.supplierSku,
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
      subtotal: items
        .reduce((sum, item) => sum.add(item.subtotal), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
      taxTotal: items
        .reduce((sum, item) => sum.add(item.taxTotal), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
      discountTotal: items
        .reduce((sum, item) => sum.add(item.discountTotal), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
      total: items
        .reduce((sum, item) => sum.add(item.total), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
    };
  }

  private getActiveSupplier(tenantId: string, supplierId: string) {
    return this.prisma.supplier
      .findFirst({
        where: { id: supplierId, tenantId, status: SupplierStatus.ACTIVE },
      })
      .then((supplier) => {
        if (!supplier) {
          throw new NotFoundException('Active supplier not found for tenant.');
        }
        return supplier;
      });
  }

  private getOrder(tenantId: string, id: string) {
    return this.prisma.purchaseOrder
      .findFirst({
        where: { id, tenantId },
        include: {
          supplierInvoice: { select: { id: true, status: true } },
        },
      })
      .then((order) => {
        if (!order) {
          throw new NotFoundException('Purchase order not found for tenant.');
        }
        return order;
      });
  }

  private requirePurchasingAccess(tenantId: string, user: AuthenticatedUser) {
    const role = this.getRole(tenantId, user);
    if (!role || !purchasingRoles.includes(role)) {
      throw new ForbiddenException('Purchase order access is required.');
    }
  }

  private requirePurchasingWrite(tenantId: string, user: AuthenticatedUser) {
    this.requirePurchasingAccess(tenantId, user);
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

  private parseStatus(value?: string) {
    if (!value) {
      return undefined;
    }
    if (!Object.values(PurchaseOrderStatus).includes(value as PurchaseOrderStatus)) {
      throw new BadRequestException('Invalid purchase order status.');
    }
    return value as PurchaseOrderStatus;
  }

  private generateOrderNumber() {
    const today = this.businessDateKey(new Date()).replace(/-/g, '');
    return `OC-${today}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private withDerivedStatus<
    T extends { status: PurchaseOrderStatus; expectedDeliveryDate: Date | null },
  >(order: T) {
    const terminalStatuses: PurchaseOrderStatus[] = [
      PurchaseOrderStatus.RECEIVED,
      PurchaseOrderStatus.CANCELLED,
    ];
    const isOverdue = Boolean(
      order.expectedDeliveryDate &&
      this.businessDateKey(order.expectedDeliveryDate) < this.businessDateKey(new Date()) &&
      !terminalStatuses.includes(order.status),
    );
    return { ...order, isOverdue, displayStatus: isOverdue ? 'OVERDUE' : order.status };
  }

  private parseBusinessDate(value: string) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T12:00:00-04:00`);
    }
    return new Date(value);
  }

  private businessDateKey(value: Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santo_Domingo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
  }
}
