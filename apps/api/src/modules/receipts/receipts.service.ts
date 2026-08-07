import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EmployeeLogAction,
  GoodsReceiptStatus,
  InventoryMovementType,
  Prisma,
  ProductUnit,
  PurchaseOrderStatus,
  ReceiptPriceDecision,
  SupplierInvoiceStatus,
} from '@qorvex/database';
import { randomUUID } from 'crypto';
import { businessDateKey } from '../../common/utils/business-date';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateReceiptDto,
  ListReceiptsQueryDto,
  ReceiptItemDto,
  UpdateReceiptDto,
} from './dto/receipt.dto';

const receivableInvoiceStatuses: SupplierInvoiceStatus[] = [
  SupplierInvoiceStatus.PENDING,
  SupplierInvoiceStatus.PARTIALLY_PAID,
  SupplierInvoiceStatus.PAID,
];

const receivablePurchaseOrderStatuses: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.ISSUED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

const receiptDetailsInclude = {
  supplier: {
    select: {
      id: true,
      commercialName: true,
      legalName: true,
      documentType: true,
      documentNumber: true,
    },
  },
  supplierInvoice: {
    select: {
      id: true,
      invoiceNumber: true,
      ncf: true,
      issueDate: true,
      dueDate: true,
      status: true,
      total: true,
      currency: true,
    },
  },
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
          stock: true,
          cost: true,
          costWithTax: true,
          price: true,
          salePrice: true,
          margin: true,
        },
      },
      supplierInvoiceItem: {
        select: {
          id: true,
          descriptionSnapshot: true,
          quantity: true,
          unitCostNet: true,
          unitCostWithTax: true,
          taxRate: true,
          total: true,
        },
      },
      purchaseOrderItem: {
        select: {
          id: true,
          quantity: true,
          receivedQuantity: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  createdBy: { select: { id: true, name: true, email: true } },
  confirmedBy: { select: { id: true, name: true, email: true } },
  reversedBy: { select: { id: true, name: true, email: true } },
  cancelledBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.GoodsReceiptInclude;

const invoiceForReceiptInclude = {
  items: {
    include: {
      product: true,
      purchaseOrderItem: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  purchaseOrder: {
    select: {
      id: true,
      supplierId: true,
      status: true,
    },
  },
} satisfies Prisma.SupplierInvoiceInclude;

const receiptMutationInclude = {
  supplierInvoice: true,
  purchaseOrder: {
    include: {
      items: {
        orderBy: { createdAt: 'asc' as const },
      },
    },
  },
  items: {
    include: {
      product: true,
      supplierInvoiceItem: {
        include: {
          purchaseOrderItem: true,
        },
      },
      purchaseOrderItem: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.GoodsReceiptInclude;

type ReceiptDetails = Prisma.GoodsReceiptGetPayload<{
  include: typeof receiptDetailsInclude;
}>;

type InvoiceForReceipt = Prisma.SupplierInvoiceGetPayload<{
  include: typeof invoiceForReceiptInclude;
}>;

type ReceiptForMutation = Prisma.GoodsReceiptGetPayload<{
  include: typeof receiptMutationInclude;
}>;

@Injectable()
export class ReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: ListReceiptsQueryDto) {
    const search = query.q?.trim();
    const receipts = await this.prisma.goodsReceipt.findMany({
      where: {
        tenantId,
        status: query.status,
        supplierInvoiceId: query.supplierInvoiceId,
        purchaseOrderId: query.purchaseOrderId,
        supplierId: query.supplierId,
        ...(search
          ? {
              OR: [
                { receiptNumber: { contains: search, mode: 'insensitive' } },
                {
                  supplier: {
                    commercialName: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  supplierInvoice: {
                    invoiceNumber: { contains: search, mode: 'insensitive' },
                  },
                },
                {
                  purchaseOrder: {
                    orderNumber: { contains: search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
      },
      include: receiptDetailsInclude,
      orderBy: { createdAt: 'desc' },
    });

    const cumulative = await this.getCumulativeReceived(
      tenantId,
      receipts.flatMap((receipt) => receipt.items.map((item) => item.supplierInvoiceItemId)),
    );

    return receipts.map((receipt) => this.withQuantitySummary(receipt, cumulative));
  }

  async findOne(tenantId: string, id: string) {
    const receipt = await this.prisma.goodsReceipt.findFirst({
      where: { id, tenantId },
      include: receiptDetailsInclude,
    });

    if (!receipt) {
      throw new NotFoundException('Recepción no encontrada para esta empresa.');
    }

    const cumulative = await this.getCumulativeReceived(
      tenantId,
      receipt.items.map((item) => item.supplierInvoiceItemId),
    );

    return this.withQuantitySummary(receipt, cumulative);
  }

  async create(tenantId: string, userId: string, dto: CreateReceiptDto) {
    const receipt = await this.runSerializable((tx) =>
      this.createDraftInTransaction(tx, tenantId, userId, dto),
    );

    return this.withQuantitySummary(receipt);
  }

  /**
   * Crea y confirma una entrada dentro de una transaccion ya abierta.
   *
   * La factura debe encontrarse previamente registrada (PENDING, PARTIALLY_PAID o PAID).
   * Este punto de extension permite que la captura de factura y la entrada fisica se
   * confirmen de manera atomica, sin duplicar la logica de inventario de Recepciones.
   */
  async createAndConfirmInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    dto: CreateReceiptDto,
  ) {
    const created = await this.createDraftInTransaction(tx, tenantId, userId, dto);
    return this.confirmInTransaction(tx, tenantId, userId, created.id);
  }

  private async createDraftInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    dto: CreateReceiptDto,
  ) {
    const invoice = await this.getReceivableInvoice(tx, tenantId, dto.supplierInvoiceId);
    this.ensurePurchaseOrderCanReceive(invoice);

    const existingDraft = await tx.goodsReceipt.findFirst({
      where: {
        tenantId,
        supplierInvoiceId: invoice.id,
        status: GoodsReceiptStatus.DRAFT,
      },
      select: { receiptNumber: true },
    });
    if (existingDraft) {
      throw new ConflictException(
        `Ya existe el borrador de recepcion ${existingDraft.receiptNumber} para esta factura. Confirma o cancela ese borrador antes de crear otro.`,
      );
    }

    const items = this.prepareDraftItems(invoice, dto.items);
    const receiptNumber = this.generateReceiptNumber();

    const created = await tx.goodsReceipt.create({
      data: {
        tenantId,
        supplierId: invoice.supplierId,
        purchaseOrderId: invoice.purchaseOrderId,
        supplierInvoiceId: invoice.id,
        receiptNumber,
        notes: normalizeOptionalText(dto.notes),
        createdById: userId,
        items: {
          create: items,
        },
      },
      include: receiptDetailsInclude,
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'GOODS_RECEIPT_CREATED',
        entity: 'GoodsReceipt',
        entityId: created.id,
        metadata: {
          receiptNumber,
          supplierInvoiceId: invoice.id,
          purchaseOrderId: invoice.purchaseOrderId,
          itemCount: items.length,
        },
      },
    });

    return created;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateReceiptDto) {
    if (!Object.keys(dto).length) {
      throw new BadRequestException('Debes indicar al menos un campo para actualizar.');
    }

    const receipt = await this.runSerializable(async (tx) => {
      const current = await this.getReceiptForMutation(tx, tenantId, id);
      this.ensureDraft(current, 'editar');
      const invoice = await this.getReceivableInvoice(tx, tenantId, current.supplierInvoiceId);
      this.ensurePurchaseOrderCanReceive(invoice);
      const items = dto.items ? this.prepareDraftItems(invoice, dto.items) : undefined;

      if (items) {
        await tx.goodsReceiptItem.deleteMany({
          where: { tenantId, goodsReceiptId: current.id },
        });
      }

      const updated = await tx.goodsReceipt.update({
        where: { id: current.id },
        data: {
          notes: dto.notes === undefined ? undefined : (normalizeOptionalText(dto.notes) ?? null),
          ...(items
            ? {
                items: {
                  create: items,
                },
              }
            : {}),
        },
        include: receiptDetailsInclude,
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'GOODS_RECEIPT_UPDATED',
          entity: 'GoodsReceipt',
          entityId: current.id,
          metadata: {
            fields: Object.keys(dto),
            ...(items ? { itemCount: items.length } : {}),
          },
        },
      });

      return updated;
    });

    return this.withQuantitySummary(receipt);
  }

  async confirm(tenantId: string, userId: string, id: string) {
    const receiptId = await this.runSerializable((tx) =>
      this.confirmInTransaction(tx, tenantId, userId, id),
    );

    // Leer el resultado fuera de la transaccion reduce el tiempo que se mantienen
    // bloqueadas las filas de inventario, sin perder atomicidad en la confirmacion.
    return this.findOne(tenantId, receiptId);
  }

  private async confirmInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    id: string,
  ) {
    const current = await this.getReceiptForMutation(tx, tenantId, id);
    this.ensureDraft(current, 'confirmar');
    this.ensureInvoiceStatus(current.supplierInvoice.status);
    this.ensureReceiptPurchaseOrderCanReceive(current);

    if (!current.items.length) {
      throw new BadRequestException('La recepción debe contener al menos un producto.');
    }

    const cumulative = await this.getCumulativeReceived(
      tenantId,
      current.items.map((item) => item.supplierInvoiceItemId),
      tx,
    );

    for (const item of current.items) {
      this.ensureReceiptItemIntegrity(current, item);
      const quantity = this.normalizeQuantity(item.quantityReceived);
      this.ensureQuantityMatchesUnit(item.product.unit, quantity);

      const previouslyReceived =
        cumulative.get(item.supplierInvoiceItemId) ?? new Prisma.Decimal(0);
      const cumulativeAfter = previouslyReceived.add(quantity).toDecimalPlaces(3);
      const quantityInvoiced = item.supplierInvoiceItem.quantity.toDecimalPlaces(3);
      const quantityOrdered = item.purchaseOrderItem?.quantity.toDecimalPlaces(3) ?? null;
      const hasOrderInvoiceDifference = Boolean(
        quantityOrdered && !quantityOrdered.eq(quantityInvoiced),
      );
      const hasReceivingDifference = !cumulativeAfter.eq(quantityInvoiced);

      if (hasOrderInvoiceDifference || hasReceivingDifference) {
        this.ensureAcceptedDifference(item.differenceAccepted, item.differenceNote);
      }

      const product = await tx.product.findFirst({
        where: { id: item.productId, tenantId },
      });
      if (!product) {
        throw new NotFoundException('Uno de los productos de la recepción ya no existe.');
      }

      const previousStock = new Prisma.Decimal(product.stock);
      const newStock = previousStock.add(quantity).toDecimalPlaces(3);
      const currentSalePrice = effectiveSalePrice(product.salePrice, product.price);
      const pricing = this.computePricing({
        decision: item.priceDecision,
        currentMargin: product.margin,
        currentSalePrice,
        newCostNet: item.supplierInvoiceItem.unitCostNet,
        requestedFinalSalePrice: item.finalSalePrice,
        requireMatchingSuggestedPrice: true,
      });

      await tx.product.update({
        where: { id: product.id },
        data: {
          stock: newStock.toNumber(),
          cost: item.supplierInvoiceItem.unitCostNet,
          costWithTax: item.supplierInvoiceItem.unitCostWithTax,
          margin: pricing.nextMargin,
          ...(item.priceDecision === ReceiptPriceDecision.KEEP
            ? {}
            : {
                price: pricing.finalSalePrice,
                salePrice: pricing.finalSalePrice,
              }),
        },
      });

      await tx.goodsReceiptItem.update({
        where: { id: item.id },
        data: {
          quantityOrdered: item.purchaseOrderItem?.quantity,
          quantityInvoiced,
          quantityReceived: quantity,
          differenceNote: normalizeOptionalText(item.differenceNote),
          previousCostNet: product.cost,
          newCostNet: item.supplierInvoiceItem.unitCostNet,
          previousCostWithTax: product.costWithTax,
          newCostWithTax: item.supplierInvoiceItem.unitCostWithTax,
          previousSalePrice: currentSalePrice,
          suggestedSalePrice: pricing.suggestedSalePrice,
          finalSalePrice: pricing.finalSalePrice,
          previousStock: previousStock.toNumber(),
          newStock: newStock.toNumber(),
        },
      });

      const costChanged =
        !decimalEquals(product.cost, item.supplierInvoiceItem.unitCostNet) ||
        !decimalEquals(product.costWithTax, item.supplierInvoiceItem.unitCostWithTax);
      const salePriceChanged = !currentSalePrice.eq(pricing.finalSalePrice);
      if (costChanged || salePriceChanged || item.priceDecision !== ReceiptPriceDecision.KEEP) {
        const priceChangeMetadata = {
          reason: 'GOODS_RECEIPT_CONFIRMATION',
          goodsReceiptId: current.id,
          receiptNumber: current.receiptNumber,
          supplierInvoiceId: current.supplierInvoiceId,
          supplierInvoiceItemId: item.supplierInvoiceItemId,
          supplierId: current.supplierId,
          productId: product.id,
          productName: product.name,
          sku: product.sku,
          priceDecision: item.priceDecision,
          previousCostNet: decimalToString(product.cost),
          newCostNet: item.supplierInvoiceItem.unitCostNet.toFixed(2),
          previousCostWithTax: decimalToString(product.costWithTax),
          newCostWithTax: item.supplierInvoiceItem.unitCostWithTax.toFixed(2),
          previousSalePrice: currentSalePrice.toFixed(2),
          suggestedSalePrice: decimalToString(pricing.suggestedSalePrice),
          finalSalePrice: pricing.finalSalePrice.toFixed(2),
          previousMargin: decimalToString(product.margin),
          nextMargin: decimalToString(pricing.nextMargin),
          costChanged,
          salePriceChanged,
        };

        await tx.employeeActivityLog.create({
          data: {
            tenantId,
            userId,
            action: salePriceChanged
              ? EmployeeLogAction.CHANGE_PRODUCT_PRICE
              : EmployeeLogAction.UPDATE_PRODUCT,
            entity: 'Product',
            entityId: product.id,
            metadata: priceChangeMetadata,
          },
        });

        await tx.auditLog.create({
          data: {
            tenantId,
            userId,
            action: 'PRODUCT_COST_PRICE_DECISION_RECORDED',
            entity: 'Product',
            entityId: product.id,
            metadata: priceChangeMetadata,
          },
        });
      }

      await tx.inventoryMovement.create({
        data: {
          tenantId,
          productId: product.id,
          type: InventoryMovementType.PURCHASE,
          quantity: quantity.toNumber(),
          previousStock: previousStock.toNumber(),
          newStock: newStock.toNumber(),
          unitCost: item.supplierInvoiceItem.unitCostNet,
          reason: 'Recepción de mercancía confirmada',
          reference: current.receiptNumber,
          supplierInvoiceId: current.supplierInvoiceId,
          goodsReceiptId: current.id,
          createdById: userId,
        },
      });

      await tx.supplierProduct.updateMany({
        where: {
          tenantId,
          supplierId: current.supplierId,
          productId: product.id,
        },
        data: {
          lastCostNet: item.supplierInvoiceItem.unitCostNet,
          lastCostWithTax: item.supplierInvoiceItem.unitCostWithTax,
          updatedById: userId,
        },
      });

      if (item.purchaseOrderItemId) {
        await tx.purchaseOrderItem.update({
          where: { id: item.purchaseOrderItemId },
          data: {
            receivedQuantity: {
              increment: quantity,
            },
          },
        });
      }
    }

    if (current.purchaseOrderId) {
      await this.recalculatePurchaseOrderStatus(
        tx,
        tenantId,
        current.purchaseOrderId,
        userId,
        current,
      );
    }

    await tx.goodsReceipt.update({
      where: { id: current.id },
      data: {
        status: GoodsReceiptStatus.CONFIRMED,
        confirmedById: userId,
        confirmedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        userId,
        action: 'GOODS_RECEIPT_CONFIRMED',
        entity: 'GoodsReceipt',
        entityId: current.id,
        metadata: {
          receiptNumber: current.receiptNumber,
          supplierInvoiceId: current.supplierInvoiceId,
          purchaseOrderId: current.purchaseOrderId,
          quantities: current.items.map((item) => ({
            supplierInvoiceItemId: item.supplierInvoiceItemId,
            productId: item.productId,
            quantity: item.quantityReceived.toFixed(3),
          })),
        },
      },
    });

    return current.id;
  }

  async cancel(tenantId: string, userId: string, id: string, reason: string) {
    const normalizedReason = this.normalizeRequiredReason(reason);
    const receipt = await this.runSerializable(async (tx) => {
      const current = await this.getReceiptForMutation(tx, tenantId, id);
      this.ensureDraft(current, 'cancelar');

      const cancelled = await tx.goodsReceipt.update({
        where: { id: current.id },
        data: {
          status: GoodsReceiptStatus.CANCELLED,
          cancelledById: userId,
          cancelledAt: new Date(),
          cancelReason: normalizedReason,
        },
        include: receiptDetailsInclude,
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'GOODS_RECEIPT_CANCELLED',
          entity: 'GoodsReceipt',
          entityId: current.id,
          metadata: {
            receiptNumber: current.receiptNumber,
            reason: normalizedReason,
          },
        },
      });

      return cancelled;
    });

    return this.withQuantitySummary(receipt);
  }

  async reverse(tenantId: string, userId: string, id: string, reason: string) {
    const normalizedReason = this.normalizeRequiredReason(reason);
    const receipt = await this.runSerializable(async (tx) => {
      const current = await this.getReceiptForMutation(tx, tenantId, id);
      if (current.status !== GoodsReceiptStatus.CONFIRMED || !current.confirmedAt) {
        throw new ConflictException('Solo una recepción confirmada puede revertirse.');
      }

      for (const item of [...current.items].reverse()) {
        const quantity = this.normalizeQuantity(item.quantityReceived);
        const product = await tx.product.findFirst({
          where: { id: item.productId, tenantId },
        });
        if (!product) {
          throw new NotFoundException('Uno de los productos de la recepción ya no existe.');
        }

        const previousStock = new Prisma.Decimal(product.stock).toDecimalPlaces(3);
        if (previousStock.lt(quantity)) {
          throw new ConflictException(
            `No hay inventario suficiente de ${product.name} para revertir la recepción.`,
          );
        }
        const newStock = previousStock.sub(quantity).toDecimalPlaces(3);
        const hasLaterReceipt = await tx.goodsReceiptItem.findFirst({
          where: {
            tenantId,
            productId: product.id,
            goodsReceiptId: { not: current.id },
            goodsReceipt: {
              status: GoodsReceiptStatus.CONFIRMED,
              confirmedAt: { gt: current.confirmedAt },
            },
          },
          select: { id: true },
        });
        if (hasLaterReceipt) {
          throw new ConflictException(
            `No se puede revertir la recepción porque ${product.name} tiene una recepción confirmada posterior.`,
          );
        }

        const restoredSalePrice = item.previousSalePrice;
        await tx.product.update({
          where: { id: product.id },
          data: {
            stock: newStock.toNumber(),
            cost: item.previousCostNet,
            costWithTax: item.previousCostWithTax,
            price: restoredSalePrice,
            salePrice: restoredSalePrice,
            margin: calculateMargin(restoredSalePrice, item.previousCostNet),
          },
        });

        await tx.inventoryMovement.create({
          data: {
            tenantId,
            productId: product.id,
            type: InventoryMovementType.ADJUSTMENT_OUT,
            quantity: quantity.toNumber(),
            previousStock: previousStock.toNumber(),
            newStock: newStock.toNumber(),
            unitCost: product.cost,
            reason: `Reversión de recepción: ${normalizedReason}`,
            reference: current.receiptNumber,
            supplierInvoiceId: current.supplierInvoiceId,
            goodsReceiptId: current.id,
            createdById: userId,
          },
        });

        if (item.purchaseOrderItemId) {
          const purchaseOrderItem = await tx.purchaseOrderItem.findFirst({
            where: {
              id: item.purchaseOrderItemId,
              tenantId,
              purchaseOrderId: current.purchaseOrderId ?? undefined,
            },
          });
          if (!purchaseOrderItem || purchaseOrderItem.receivedQuantity.lt(quantity)) {
            throw new ConflictException(
              'Las cantidades recibidas de la orden no permiten revertir esta recepción.',
            );
          }
          await tx.purchaseOrderItem.update({
            where: { id: purchaseOrderItem.id },
            data: {
              receivedQuantity: {
                decrement: quantity,
              },
            },
          });
        }
      }

      if (current.purchaseOrderId) {
        await this.recalculatePurchaseOrderStatus(
          tx,
          tenantId,
          current.purchaseOrderId,
          userId,
          current,
        );
      }

      await tx.goodsReceipt.update({
        where: { id: current.id },
        data: {
          status: GoodsReceiptStatus.REVERSED,
          reversedById: userId,
          reversedAt: new Date(),
          reversalReason: normalizedReason,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'GOODS_RECEIPT_REVERSED',
          entity: 'GoodsReceipt',
          entityId: current.id,
          metadata: {
            receiptNumber: current.receiptNumber,
            reason: normalizedReason,
            quantities: current.items.map((item) => ({
              supplierInvoiceItemId: item.supplierInvoiceItemId,
              productId: item.productId,
              quantity: item.quantityReceived.toFixed(3),
            })),
          },
        },
      });

      return tx.goodsReceipt.findUniqueOrThrow({
        where: { id: current.id },
        include: receiptDetailsInclude,
      });
    });

    const cumulative = await this.getCumulativeReceived(
      tenantId,
      receipt.items.map((item) => item.supplierInvoiceItemId),
    );
    return this.withQuantitySummary(receipt, cumulative);
  }

  private async getReceivableInvoice(
    tx: Prisma.TransactionClient,
    tenantId: string,
    invoiceId: string,
  ) {
    const invoice = await tx.supplierInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: invoiceForReceiptInclude,
    });

    if (!invoice) {
      throw new NotFoundException('Factura de proveedor no encontrada para esta empresa.');
    }

    this.ensureInvoiceStatus(invoice.status);
    return invoice;
  }

  private ensureInvoiceStatus(status: SupplierInvoiceStatus) {
    if (!receivableInvoiceStatuses.includes(status)) {
      throw new ConflictException(
        'La factura debe estar pendiente, parcialmente pagada o pagada para recibir mercancía.',
      );
    }
  }

  private ensurePurchaseOrderCanReceive(invoice: InvoiceForReceipt) {
    if (invoice.purchaseOrder && invoice.purchaseOrder.supplierId !== invoice.supplierId) {
      throw new ConflictException(
        'La orden de compra y la factura deben pertenecer al mismo proveedor.',
      );
    }
    if (
      invoice.purchaseOrder &&
      !receivablePurchaseOrderStatuses.includes(invoice.purchaseOrder.status)
    ) {
      throw new ConflictException(
        'La orden de compra debe estar emitida y disponible para recepción.',
      );
    }
  }

  private ensureReceiptPurchaseOrderCanReceive(receipt: ReceiptForMutation) {
    if (
      receipt.supplierId !== receipt.supplierInvoice.supplierId ||
      receipt.purchaseOrderId !== receipt.supplierInvoice.purchaseOrderId
    ) {
      throw new ConflictException(
        'La recepciÃ³n ya no coincide con la factura de proveedor vinculada.',
      );
    }
    if (
      receipt.purchaseOrder &&
      !receivablePurchaseOrderStatuses.includes(receipt.purchaseOrder.status)
    ) {
      throw new ConflictException(
        'La orden de compra debe estar emitida y disponible para recepción.',
      );
    }
  }

  private prepareDraftItems(invoice: InvoiceForReceipt, dtoItems: ReceiptItemDto[]) {
    const requestedIds = dtoItems.map((item) => item.supplierInvoiceItemId);
    if (new Set(requestedIds).size !== requestedIds.length) {
      throw new BadRequestException(
        'Una línea de factura solo puede aparecer una vez en la recepción.',
      );
    }

    const invoiceItems = new Map(invoice.items.map((item) => [item.id, item]));
    const selectedProductIds = new Set<string>();

    return dtoItems.map((dtoItem) => {
      const invoiceItem = invoiceItems.get(dtoItem.supplierInvoiceItemId);
      if (!invoiceItem) {
        throw new NotFoundException(
          'Una o más líneas no pertenecen a la factura de proveedor seleccionada.',
        );
      }
      if (selectedProductIds.has(invoiceItem.productId)) {
        throw new BadRequestException(
          'Un producto solo puede aparecer una vez por recepción. Consolida sus líneas antes de continuar.',
        );
      }
      selectedProductIds.add(invoiceItem.productId);
      this.ensureInvoiceItemPurchaseOrderIntegrity(invoice, invoiceItem);

      const quantity = this.normalizeQuantity(dtoItem.quantityReceived);
      this.ensureQuantityMatchesUnit(invoiceItem.product.unit, quantity);
      const currentSalePrice = effectiveSalePrice(
        invoiceItem.product.salePrice,
        invoiceItem.product.price,
      );
      const state = {
        cost: invoiceItem.product.cost,
        costWithTax: invoiceItem.product.costWithTax,
        salePrice: currentSalePrice,
        margin: invoiceItem.product.margin,
        stock: new Prisma.Decimal(invoiceItem.product.stock),
      };
      const decision = dtoItem.priceDecision ?? ReceiptPriceDecision.KEEP;
      if (decision !== ReceiptPriceDecision.MANUAL && dtoItem.manualSalePrice !== undefined) {
        throw new BadRequestException(
          'El precio manual solo se admite cuando la decisión de precio es MANUAL.',
        );
      }

      const requestedFinalSalePrice =
        dtoItem.manualSalePrice === undefined
          ? undefined
          : new Prisma.Decimal(dtoItem.manualSalePrice).toDecimalPlaces(2);
      const pricing = this.computePricing({
        decision,
        currentMargin: state.margin,
        currentSalePrice: state.salePrice,
        newCostNet: invoiceItem.unitCostNet,
        requestedFinalSalePrice,
      });
      const newStock = state.stock.add(quantity).toDecimalPlaces(3);

      return {
        tenantId: invoice.tenantId,
        supplierInvoiceItemId: invoiceItem.id,
        purchaseOrderItemId: invoiceItem.purchaseOrderItemId,
        productId: invoiceItem.productId,
        quantityOrdered: invoiceItem.purchaseOrderItem?.quantity,
        quantityInvoiced: invoiceItem.quantity,
        quantityReceived: quantity,
        differenceAccepted: dtoItem.differenceAccepted ?? false,
        differenceNote: normalizeOptionalText(dtoItem.differenceNote),
        lotNumber: normalizeOptionalText(dtoItem.lotNumber),
        serialNumber: normalizeOptionalText(dtoItem.serialNumber),
        expirationDate: dtoItem.expirationDate ? new Date(dtoItem.expirationDate) : undefined,
        previousCostNet: state.cost,
        newCostNet: invoiceItem.unitCostNet,
        previousCostWithTax: state.costWithTax,
        newCostWithTax: invoiceItem.unitCostWithTax,
        priceDecision: decision,
        previousSalePrice: state.salePrice,
        suggestedSalePrice: pricing.suggestedSalePrice,
        finalSalePrice: pricing.finalSalePrice,
        previousStock: state.stock.toNumber(),
        newStock: newStock.toNumber(),
      };
    });
  }

  private ensureInvoiceItemPurchaseOrderIntegrity(
    invoice: InvoiceForReceipt,
    invoiceItem: InvoiceForReceipt['items'][number],
  ) {
    if (!invoice.purchaseOrderId) {
      if (invoiceItem.purchaseOrderItemId) {
        throw new ConflictException(
          'La línea de factura tiene una orden, pero la factura no está vinculada a ella.',
        );
      }
      return;
    }

    if (
      !invoiceItem.purchaseOrderItem ||
      invoiceItem.purchaseOrderItem.purchaseOrderId !== invoice.purchaseOrderId ||
      invoiceItem.purchaseOrderItem.productId !== invoiceItem.productId
    ) {
      throw new ConflictException(
        'Una línea de factura no coincide con los productos de su orden de compra.',
      );
    }
  }

  private ensureReceiptItemIntegrity(
    receipt: ReceiptForMutation,
    item: ReceiptForMutation['items'][number],
  ) {
    if (
      item.supplierInvoiceItem.supplierInvoiceId !== receipt.supplierInvoiceId ||
      item.supplierInvoiceItem.productId !== item.productId
    ) {
      throw new ConflictException(
        'Una línea de recepción ya no coincide con la factura de proveedor.',
      );
    }

    if (!receipt.purchaseOrderId) {
      if (item.purchaseOrderItemId) {
        throw new ConflictException(
          'La recepción tiene una línea de orden sin una orden de compra asociada.',
        );
      }
      return;
    }

    if (
      !item.purchaseOrderItem ||
      item.purchaseOrderItem.purchaseOrderId !== receipt.purchaseOrderId ||
      item.purchaseOrderItem.productId !== item.productId
    ) {
      throw new ConflictException('Una línea de recepción no coincide con su orden de compra.');
    }
  }

  private computePricing(input: {
    decision: ReceiptPriceDecision;
    currentMargin: Prisma.Decimal | null;
    currentSalePrice: Prisma.Decimal;
    newCostNet: Prisma.Decimal;
    requestedFinalSalePrice?: Prisma.Decimal | null;
    requireMatchingSuggestedPrice?: boolean;
  }) {
    const suggestedSalePrice = calculateSuggestedSalePrice(input.newCostNet, input.currentMargin);

    if (input.decision === ReceiptPriceDecision.RECALCULATE_MARGIN) {
      if (!suggestedSalePrice) {
        throw new BadRequestException(
          'El producto no tiene un margen válido para recalcular su precio.',
        );
      }
      if (
        input.requireMatchingSuggestedPrice &&
        (!input.requestedFinalSalePrice || !input.requestedFinalSalePrice.eq(suggestedSalePrice))
      ) {
        throw new ConflictException(
          'El precio sugerido cambió. Actualiza la recepción y confirma nuevamente el nuevo precio.',
        );
      }

      return {
        suggestedSalePrice,
        finalSalePrice: suggestedSalePrice,
        nextMargin: input.currentMargin?.toDecimalPlaces(4) ?? null,
      };
    }

    if (input.decision === ReceiptPriceDecision.MANUAL) {
      const manualPrice = input.requestedFinalSalePrice?.toDecimalPlaces(2);
      if (!manualPrice || manualPrice.lte(0)) {
        throw new BadRequestException(
          'Debes indicar un precio de venta válido para el ajuste manual.',
        );
      }
      return {
        suggestedSalePrice,
        finalSalePrice: manualPrice,
        nextMargin: calculateMargin(manualPrice, input.newCostNet),
      };
    }

    return {
      suggestedSalePrice,
      finalSalePrice: input.currentSalePrice.toDecimalPlaces(2),
      nextMargin: calculateMargin(input.currentSalePrice, input.newCostNet),
    };
  }

  private async recalculatePurchaseOrderStatus(
    tx: Prisma.TransactionClient,
    tenantId: string,
    purchaseOrderId: string,
    userId: string,
    receipt: Pick<ReceiptForMutation, 'id' | 'receiptNumber'>,
  ) {
    const purchaseOrder = await tx.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, tenantId },
      include: { items: true },
    });
    if (!purchaseOrder) {
      throw new NotFoundException('Orden de compra no encontrada para esta recepción.');
    }
    if (!purchaseOrder.items.length) {
      throw new ConflictException('La orden de compra no contiene productos.');
    }

    const allReceived = purchaseOrder.items.every((item) =>
      item.receivedQuantity.gte(item.quantity),
    );
    const anyReceived = purchaseOrder.items.some((item) => item.receivedQuantity.gt(0));
    const nextStatus = allReceived
      ? PurchaseOrderStatus.RECEIVED
      : anyReceived
        ? PurchaseOrderStatus.PARTIALLY_RECEIVED
        : PurchaseOrderStatus.ISSUED;

    if (purchaseOrder.status === nextStatus) {
      return;
    }

    await tx.purchaseOrder.update({
      where: { id: purchaseOrder.id },
      data: { status: nextStatus },
    });
    await tx.purchaseOrderEvent.create({
      data: {
        tenantId,
        purchaseOrderId: purchaseOrder.id,
        fromStatus: purchaseOrder.status,
        toStatus: nextStatus,
        note: `Actualización por recepción ${receipt.receiptNumber}`,
        metadata: {
          goodsReceiptId: receipt.id,
          receiptNumber: receipt.receiptNumber,
        },
        createdById: userId,
      },
    });
  }

  private async getReceiptForMutation(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const receipt = await tx.goodsReceipt.findFirst({
      where: { id, tenantId },
      include: receiptMutationInclude,
    });

    if (!receipt) {
      throw new NotFoundException('Recepción no encontrada para esta empresa.');
    }

    return receipt;
  }

  private ensureDraft(receipt: ReceiptForMutation, operation: string) {
    if (receipt.status !== GoodsReceiptStatus.DRAFT) {
      throw new ConflictException(`Solo una recepción en borrador se puede ${operation}.`);
    }
  }

  private normalizeQuantity(quantity: Prisma.Decimal | number) {
    const decimal = new Prisma.Decimal(quantity);
    if (!decimal.isFinite() || decimal.lte(0) || decimal.decimalPlaces() > 3) {
      throw new BadRequestException(
        'Las cantidades recibidas deben ser positivas y tener máximo tres decimales.',
      );
    }
    return decimal.toDecimalPlaces(3);
  }

  private ensureQuantityMatchesUnit(unit: ProductUnit, quantity: Prisma.Decimal) {
    if (requiresWholeQuantity(unit) && !quantity.isInteger()) {
      throw new BadRequestException(`La unidad ${unit} requiere cantidades enteras en inventario.`);
    }
  }

  private ensureAcceptedDifference(accepted: boolean, note: string | null) {
    if (!accepted || !note?.trim()) {
      throw new ConflictException(
        'Recibir más de lo facturado requiere aceptación explícita y una nota.',
      );
    }
  }

  private normalizeRequiredReason(reason: string) {
    const normalized = reason.trim();
    if (!normalized) {
      throw new BadRequestException('Debes indicar el motivo de la operación.');
    }
    return normalized;
  }

  private async getCumulativeReceived(
    tenantId: string,
    supplierInvoiceItemIds: string[],
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const uniqueIds = [...new Set(supplierInvoiceItemIds)];
    if (!uniqueIds.length) {
      return new Map<string, Prisma.Decimal>();
    }

    const rows = await tx.goodsReceiptItem.groupBy({
      by: ['supplierInvoiceItemId'],
      where: {
        tenantId,
        supplierInvoiceItemId: { in: uniqueIds },
        goodsReceipt: {
          status: GoodsReceiptStatus.CONFIRMED,
        },
      },
      _sum: {
        quantityReceived: true,
      },
    });

    return new Map(
      rows.map((row) => [
        row.supplierInvoiceItemId,
        row._sum.quantityReceived ?? new Prisma.Decimal(0),
      ]),
    );
  }

  private withQuantitySummary(
    receipt: ReceiptDetails,
    cumulative = new Map<string, Prisma.Decimal>(),
  ) {
    let totalQuantityReceived = new Prisma.Decimal(0);
    let itemsWithDifference = 0;
    const items = receipt.items.map((item) => {
      const quantityReceived = item.quantityReceived.toDecimalPlaces(3);
      const quantityInvoiced = item.quantityInvoiced.toDecimalPlaces(3);
      const quantityDifference = quantityReceived.sub(quantityInvoiced).toDecimalPlaces(3);
      const cumulativeReceived =
        cumulative.get(item.supplierInvoiceItemId) ??
        (receipt.status === GoodsReceiptStatus.CONFIRMED
          ? quantityReceived
          : new Prisma.Decimal(0));
      const cumulativeDifference = cumulativeReceived.sub(quantityInvoiced).toDecimalPlaces(3);
      const quantityRemaining = Prisma.Decimal.max(
        quantityInvoiced.sub(cumulativeReceived),
        0,
      ).toDecimalPlaces(3);
      const projectedCumulativeReceived =
        receipt.status === GoodsReceiptStatus.DRAFT
          ? cumulativeReceived.add(quantityReceived).toDecimalPlaces(3)
          : cumulativeReceived;
      const projectedDifference = projectedCumulativeReceived
        .sub(quantityInvoiced)
        .toDecimalPlaces(3);
      const projectedRemaining = Prisma.Decimal.max(
        quantityInvoiced.sub(projectedCumulativeReceived),
        0,
      ).toDecimalPlaces(3);

      totalQuantityReceived = totalQuantityReceived.add(quantityReceived);
      if (!quantityDifference.isZero()) {
        itemsWithDifference += 1;
      }

      return {
        ...item,
        quantityDifference: quantityDifference.toFixed(3),
        cumulativeReceived: cumulativeReceived.toFixed(3),
        cumulativeDifference: cumulativeDifference.toFixed(3),
        quantityRemaining: quantityRemaining.toFixed(3),
        projectedCumulativeReceived: projectedCumulativeReceived.toFixed(3),
        projectedDifference: projectedDifference.toFixed(3),
        projectedRemaining: projectedRemaining.toFixed(3),
      };
    });

    return {
      ...receipt,
      items,
      quantitySummary: {
        itemCount: items.length,
        totalQuantityReceived: totalQuantityReceived.toFixed(3),
        itemsWithDifference,
      },
    };
  }

  private generateReceiptNumber() {
    const today = businessDateKey(new Date()).replace(/-/g, '');
    return `REC-${today}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private async runSerializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const attempts = 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 20_000,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') {
          throw new ServiceUnavailableException(
            'La operacion tardo demasiado y se revirtio por seguridad. Intentalo nuevamente.',
          );
        }
        const canRetry =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < attempts;
        if (!canRetry) {
          throw error;
        }
      }
    }

    throw new ConflictException('No se pudo completar la operación por concurrencia.');
  }
}

function calculateSuggestedSalePrice(cost: Prisma.Decimal, margin: Prisma.Decimal | null) {
  if (!margin || margin.gte(1)) {
    return null;
  }
  const suggested = cost.div(new Prisma.Decimal(1).sub(margin)).toDecimalPlaces(2);
  return suggested.gt(0) ? suggested : null;
}

function decimalEquals(
  left: Prisma.Decimal | number | string | null | undefined,
  right: Prisma.Decimal | number | string | null | undefined,
) {
  if (left === null || left === undefined || right === null || right === undefined) {
    return left === right;
  }
  return new Prisma.Decimal(left).eq(new Prisma.Decimal(right));
}

function decimalToString(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  return new Prisma.Decimal(value).toFixed(2);
}

function calculateMargin(salePrice: Prisma.Decimal, cost: Prisma.Decimal | null) {
  if (!cost || salePrice.lte(0)) {
    return null;
  }
  return salePrice.sub(cost).div(salePrice).toDecimalPlaces(4);
}

function effectiveSalePrice(salePrice: Prisma.Decimal, price: Prisma.Decimal) {
  return (salePrice.gt(0) ? salePrice : price).toDecimalPlaces(2);
}

function normalizeOptionalText(value?: string | null) {
  const normalized = value?.trim();
  return normalized || undefined;
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
