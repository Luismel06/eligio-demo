import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CashMovementType,
  CashSessionStatus,
  CreditApprovalStatus,
  CustomerCreditStatus,
  CustomerStatus,
  DocumentType,
  EmployeeLogAction,
  EmployeeStatus,
  InventoryMovementType,
  InvoiceDocumentType,
  InvoiceFiscalStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  Product,
  ProductStatus,
  ProductUnit,
  Role,
  SalePaymentMode,
  SalesOrderDestination,
  SalesOrderStatus,
  TaxCategory,
} from '@qorvex/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { getBarcodeLookupCandidates } from '../../common/utils/barcode';
import { businessDateKey } from '../../common/utils/business-date';
import {
  normalizeDominicanDocument,
  validateDominicanCedula,
  validateDominicanDocument,
  validateDominicanRnc,
} from '../../common/utils/dominican-documents';
import { isFiscalCreditNcf, isLocalNcfDocumentType } from '../fiscal-sequences/fiscal-number';
import { FiscalSequencesService } from '../fiscal-sequences/fiscal-sequences.service';
import { CompleteSaleDto, PosSaleItemDto } from './dto/complete-sale.dto';

const adminRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];
const claimTtlMs = 30 * 60 * 1000;

type ComputedSaleLine = {
  product: Product;
  productId: string;
  sku: string | null;
  barcode: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unit: ProductUnit;
  reservedQuantity: number;
  unitPrice: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxCategory: TaxCategory;
  taxRate: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  total: Prisma.Decimal;
};

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fiscalSequences: FiscalSequencesService,
  ) {}

  async searchProducts(tenantId: string, user: AuthenticatedUser, q: string) {
    await this.ensureCanCreateDirectSale(tenantId, user);
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

  async findByBarcode(tenantId: string, user: AuthenticatedUser, barcode: string) {
    await this.ensureCanCreateDirectSale(tenantId, user);
    const lookupCandidates = getBarcodeLookupCandidates(barcode);
    const product = await this.prisma.product.findFirst({
      where: {
        tenantId,
        status: ProductStatus.ACTIVE,
        OR: [{ barcode: { in: lookupCandidates } }, { sku: { in: lookupCandidates } }],
      },
      include: {
        category: true,
      },
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

  async previewSale(tenantId: string, user: AuthenticatedUser, dto: CompleteSaleDto) {
    await this.ensureCanCreateDirectSale(tenantId, user);
    const computed = await this.computeSale(tenantId, dto.items ?? []);

    return {
      documentType: dto.documentType ?? InvoiceDocumentType.CONSUMER_02,
      paymentMethod: dto.paymentMethod,
      subtotal: computed.subtotal.toNumber(),
      discountTotal: computed.discountTotal.toNumber(),
      taxTotal: computed.taxTotal.toNumber(),
      total: computed.total.toNumber(),
      items: computed.items.map((item) => ({
        productId: item.product.id,
        name: item.product.name,
        sku: item.product.sku,
        barcode: item.product.barcode,
        quantity: item.quantity.toNumber(),
        unitPrice: item.unitPrice.toNumber(),
        discountTotal: item.discountTotal.toNumber(),
        subtotal: item.subtotal.toNumber(),
        taxTotal: item.taxTotal.toNumber(),
        total: item.total.toNumber(),
      })),
    };
  }

  async completeSale(tenantId: string, user: AuthenticatedUser, dto: CompleteSaleDto) {
    const membership = await this.ensureCanUsePos(tenantId, user);

    if (this.isAdminMembership(membership)) {
      throw new ForbiddenException(
        'Admins cannot complete POS sales. Cashiers must charge orders.',
      );
    }

    if (!dto.orderId) {
      throw new ForbiddenException('Direct POS sales are disabled. Load an order to charge.');
    }
    this.ensureSupportedPaymentMethod(dto.paymentMethod);
    await this.fiscalSequences.refreshStatuses(tenantId);

    return this.runSerializable(async (tx) => {
      const cashSession = await this.findCashSessionForSale(
        tx,
        tenantId,
        user.id,
        dto.cashSessionId,
      );
      const order = dto.orderId
        ? await this.claimOrderForSale(tx, tenantId, user.id, cashSession.id, dto.orderId)
        : null;

      const computed = order
        ? await this.computeSaleFromOrder(order)
        : await this.computeSale(tenantId, dto.items ?? [], tx);

      if (!computed.items.length) {
        throw new BadRequestException('Sale must include at least one item.');
      }
      if (order && !computed.total.eq(order.total)) {
        throw new BadRequestException('Sales order totals are inconsistent and must be reviewed.');
      }

      const documentType = dto.documentType ?? InvoiceDocumentType.CONSUMER_02;
      if (!isLocalNcfDocumentType(documentType)) {
        throw new BadRequestException('Only local B01 and B02 invoices are enabled.');
      }
      if (order?.customerId && dto.customerId && dto.customerId !== order.customerId) {
        throw new BadRequestException('Order customer cannot be changed at checkout.');
      }
      const customerId = order?.customerId ?? dto.customerId ?? undefined;
      const isCreditSale = order?.paymentMode === SalePaymentMode.CREDIT;
      if (isCreditSale && customerId) {
        await this.lockCustomer(tx, tenantId, customerId);
      }
      const customer = customerId
        ? await tx.customer.findFirst({
            where: {
              id: customerId,
              tenantId,
            },
          })
        : null;

      if (customerId && !customer) {
        throw new NotFoundException('Customer not found for tenant.');
      }

      if (isCreditSale) {
        if (
          !customer ||
          !order.creditApproval ||
          order.creditApproval.status !== CreditApprovalStatus.APPROVED
        ) {
          throw new BadRequestException(
            'Credit sale requires a registered customer and administrator approval.',
          );
        }
        if (
          customer.status !== CustomerStatus.ACTIVE ||
          !customer.creditEnabled ||
          customer.creditStatus !== CustomerCreditStatus.ACTIVE
        ) {
          throw new BadRequestException('Customer credit is disabled, blocked, or inactive.');
        }
        if (!order.dueDate) {
          throw new BadRequestException('Approved credit sale is missing its due date.');
        }
        if (
          order.creditApproval.tenantId !== tenantId ||
          order.creditApproval.salesOrderId !== order.id ||
          order.creditApproval.customerId !== customer.id ||
          !order.creditApproval.approvedById ||
          !order.creditApproval.approvedAt
        ) {
          throw new BadRequestException('Credit approval is inconsistent with the sales order.');
        }
        const expectedInitialPayment = computed.total
          .mul(order.initialPaymentRate)
          .toDecimalPlaces(2);
        const expectedFinancedAmount = computed.total
          .sub(expectedInitialPayment)
          .toDecimalPlaces(2);
        if (
          !order.initialPaymentOption ||
          !order.creditTermOption ||
          !order.initialPaymentAmount.eq(expectedInitialPayment) ||
          !order.creditApproval.requestedTotal.eq(computed.total) ||
          !order.creditApproval.initialPaymentAmount.eq(expectedInitialPayment) ||
          !order.creditApproval.financedAmount.eq(expectedFinancedAmount) ||
          order.creditApproval.initialPaymentOption !== order.initialPaymentOption ||
          order.creditApproval.creditTermOption !== order.creditTermOption ||
          businessDateKey(order.creditApproval.dueDate) !== businessDateKey(order.dueDate)
        ) {
          throw new BadRequestException('Approved credit terms do not match the sales order.');
        }
        if (businessDateKey(order.dueDate) <= businessDateKey(new Date())) {
          throw new BadRequestException('Credit due date must still be in the future at checkout.');
        }

        const outstanding = await tx.invoice.aggregate({
          where: {
            tenantId,
            customerId: customer.id,
            paymentMode: SalePaymentMode.CREDIT,
            status: {
              notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.VOID, InvoiceStatus.VOIDED],
            },
          },
          _sum: { balance: true },
        });
        const currentBalance = outstanding._sum.balance ?? new Prisma.Decimal(0);
        if (
          currentBalance.add(expectedFinancedAmount).gt(customer.creditLimit) &&
          !order.creditApproval.exceedsCreditLimit
        ) {
          throw new BadRequestException(
            'Current customer debt now exceeds the approved credit limit. A new approval is required.',
          );
        }
      }

      const fiscalCreditCustomer =
        customer &&
        (customer.documentType === DocumentType.RNC ||
          customer.documentType === DocumentType.CEDULA) &&
        customer.documentNumber?.trim() &&
        validateDominicanDocument(customer.documentType, customer.documentNumber);
      if (isFiscalCreditNcf(documentType) && !fiscalCreditCustomer) {
        throw new BadRequestException('B01 requires a customer with a valid RNC or Dominican ID.');
      }

      // The persisted subtotal is already net of line discounts. DGII's
      // RD$250,000 B02 identification threshold is evaluated before ITBIS.
      const netAmountBeforeTaxes = computed.subtotal.toDecimalPlaces(2);
      const requiresConsumerIdentity =
        documentType === InvoiceDocumentType.CONSUMER_02 && netAmountBeforeTaxes.gte(250_000);
      const consumerHasReportableIdentity =
        customer &&
        customer.documentNumber?.trim() &&
        (customer.documentType === DocumentType.RNC || customer.documentType === DocumentType.CEDULA
          ? validateDominicanDocument(customer.documentType, customer.documentNumber)
          : customer.documentType === DocumentType.PASSPORT);
      if (requiresConsumerIdentity && !consumerHasReportableIdentity) {
        throw new BadRequestException(
          'B02 invoices of RD$250,000 or more before ITBIS require an identified customer.',
        );
      }

      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          rnc: true,
          legalName: true,
          commercialName: true,
          address: true,
          phone: true,
          email: true,
          branding: { select: { logoUrl: true } },
        },
      });
      if (
        !tenant?.rnc?.trim() ||
        (!validateDominicanRnc(tenant.rnc) && !validateDominicanCedula(tenant.rnc)) ||
        !tenant.legalName?.trim() ||
        !tenant.commercialName?.trim() ||
        !tenant.address?.trim() ||
        !tenant.phone?.trim() ||
        !tenant.email?.trim()
      ) {
        throw new BadRequestException(
          'Issuer tax identity, legal name, commercial name, address, phone, and email must be configured.',
        );
      }

      await this.lockOpenCashSessionForUser(tx, tenantId, user.id, cashSession.id);
      const sequence = await this.fiscalSequences.reserve(tx, tenantId, documentType);
      const requiredPayment = isCreditSale ? order.initialPaymentAmount : computed.total;
      const payment = this.getPaymentAmounts(
        dto.amountReceived,
        computed.total,
        dto.paymentMethod,
        requiredPayment,
      );
      const paidAmount = payment.paidAmount;
      const balance = computed.total.sub(paidAmount).toDecimalPlaces(2);
      const status = this.getInvoiceStatus(paidAmount, computed.total);
      const issuedAt = new Date();
      const invoiceNumber = `RIV-${sequence.ncf}`;
      const fiscalCustomerSnapshot =
        isFiscalCreditNcf(documentType) || requiresConsumerIdentity
          ? {
              id: customer!.id,
              name: customer!.name,
              documentType: customer!.documentType,
              documentNumber:
                customer!.documentType === DocumentType.RNC ||
                customer!.documentType === DocumentType.CEDULA
                  ? normalizeDominicanDocument(customer!.documentNumber!)
                  : customer!.documentNumber!.trim(),
            }
          : Prisma.JsonNull;

      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          customerId: customer?.id,
          documentType,
          invoiceNumber,
          ncf: sequence.ncf,
          eNcf: null,
          fiscalSequenceId: sequence.id,
          fiscalAuthorizationNumber: sequence.authorizationNumber,
          fiscalValidUntil: sequence.validUntil,
          fiscalIssuerSnapshot: {
            rnc: normalizeDominicanDocument(tenant.rnc),
            legalName: tenant.legalName.trim(),
            commercialName: tenant.commercialName.trim(),
            address: tenant.address.trim(),
            phone: tenant.phone.trim(),
            email: tenant.email.trim(),
            logoUrl: tenant.branding?.logoUrl ?? null,
            pointOfSale: cashSession.cashRegister.name,
            pointOfSaleLocation: cashSession.cashRegister.location,
          },
          fiscalCustomerSnapshot,
          status,
          fiscalStatus: InvoiceFiscalStatus.LOCAL_ISSUED,
          subtotal: computed.subtotal,
          taxTotal: computed.taxTotal,
          discountTotal: computed.discountTotal,
          total: computed.total,
          paidAmount,
          amountReceived: payment.amountReceived,
          changeAmount: payment.changeAmount,
          balance,
          paymentMode: isCreditSale ? SalePaymentMode.CREDIT : SalePaymentMode.CASH,
          paymentMethod: dto.paymentMethod,
          issuedById: user.id,
          cashSessionId: cashSession.id,
          issuedAt,
          dueDate: isCreditSale ? order.dueDate : issuedAt,
          items: {
            create: computed.items.map((item) => ({
              productId: item.productId,
              sku: item.sku,
              barcode: item.barcode,
              description: item.description,
              quantity: item.quantity,
              unit: item.unit,
              unitPrice: item.unitPrice,
              discountTotal: item.discountTotal,
              taxCategory: item.taxCategory,
              taxRate: item.taxRate,
              taxTotal: item.taxTotal,
              subtotal: item.subtotal,
              total: item.total,
            })),
          },
        },
        include: {
          customer: true,
          items: true,
          payments: true,
          electronicDocument: true,
        },
      });

      for (const item of [...computed.items].sort((a, b) =>
        a.productId.localeCompare(b.productId),
      )) {
        await this.applyInventoryForSale(tx, {
          tenantId,
          item,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          userId: user.id,
          fromOrder: Boolean(order),
        });
      }

      if (paidAmount.gt(0)) {
        await tx.payment.create({
          data: {
            tenantId,
            invoiceId: invoice.id,
            method: dto.paymentMethod,
            amount: paidAmount,
            status: PaymentStatus.COMPLETED,
            userId: user.id,
            cashSessionId: cashSession.id,
            paidAt: issuedAt,
          },
        });

        await tx.cashMovement.create({
          data: {
            tenantId,
            cashSessionId: cashSession.id,
            userId: user.id,
            type: CashMovementType.SALE_PAYMENT,
            amount: paidAmount,
            method: dto.paymentMethod,
            reason: 'Pago de venta POS',
            reference: invoice.invoiceNumber,
            invoiceId: invoice.id,
          },
        });
      }

      await tx.employeeActivityLog.createMany({
        data: [
          {
            tenantId,
            userId: user.id,
            cashSessionId: cashSession.id,
            action: EmployeeLogAction.CREATE_SALE,
            entity: 'Invoice',
            entityId: invoice.id,
            invoiceId: invoice.id,
            amount: computed.total,
            metadata: {
              invoiceNumber,
              ncf: sequence.ncf,
              paymentMethod: dto.paymentMethod,
              amountReceived: payment.amountReceived.toString(),
              changeAmount: payment.changeAmount.toString(),
              orderNumber: order?.orderNumber,
              status: invoice.status,
              destination: SalesOrderDestination.CASH_SALE,
              clientName: customer?.name,
            },
          },
          {
            tenantId,
            userId: user.id,
            cashSessionId: cashSession.id,
            action: EmployeeLogAction.ISSUE_INVOICE,
            entity: 'Invoice',
            entityId: invoice.id,
            invoiceId: invoice.id,
            amount: computed.total,
            metadata: {
              invoiceNumber,
              ncf: sequence.ncf,
              documentType,
              amountReceived: payment.amountReceived.toString(),
              changeAmount: payment.changeAmount.toString(),
              orderNumber: order?.orderNumber,
              status: invoice.status,
              destination: SalesOrderDestination.CASH_SALE,
              clientName: customer?.name,
            },
          },
          ...(order
            ? [
                {
                  tenantId,
                  userId: user.id,
                  cashSessionId: cashSession.id,
                  action: EmployeeLogAction.COMPLETE_SALES_ORDER,
                  entity: 'SalesOrder',
                  entityId: order.id,
                  invoiceId: invoice.id,
                  amount: computed.total,
                  metadata: {
                    orderNumber: order.orderNumber,
                    invoiceNumber,
                    sourceDestination: order.orderNumber.startsWith('COT-')
                      ? SalesOrderDestination.QUOTATION
                      : order.destination,
                    sourceStatus: SalesOrderStatus.COMPLETED,
                    clientName: order.clientName,
                  },
                },
              ]
            : []),
        ],
      });

      if (order) {
        await tx.salesOrder.update({
          where: { id: order.id },
          data: {
            status: SalesOrderStatus.COMPLETED,
            completedById: user.id,
            invoiceId: invoice.id,
            completedAt: issuedAt,
            claimExpiresAt: null,
          },
        });
      }

      if (isCreditSale && customer) {
        const aggregate = await tx.invoice.aggregate({
          where: {
            tenantId,
            customerId: customer.id,
            paymentMode: SalePaymentMode.CREDIT,
            status: {
              notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.VOID, InvoiceStatus.VOIDED],
            },
          },
          _sum: { balance: true },
        });
        await tx.customer.update({
          where: { id: customer.id },
          data: { creditBalance: aggregate._sum.balance ?? new Prisma.Decimal(0) },
        });
      }

      return tx.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
        include: {
          customer: true,
          items: true,
          payments: true,
          electronicDocument: true,
          issuedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          cashSession: {
            include: {
              cashRegister: true,
            },
          },
        },
      });
    });
  }

  private async claimOrderForSale(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    cashSessionId: string,
    orderId: string,
  ) {
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + claimTtlMs);

    const claimed = await tx.salesOrder.updateMany({
      where: {
        id: orderId,
        tenantId,
        destination: SalesOrderDestination.CASH_SALE,
        invoiceId: null,
        OR: [
          { status: SalesOrderStatus.SENT_TO_CASHIER },
          {
            status: SalesOrderStatus.IN_CASHIER,
            claimedById: userId,
          },
          {
            status: SalesOrderStatus.IN_CASHIER,
            claimExpiresAt: { lt: now },
          },
        ],
      },
      data: {
        status: SalesOrderStatus.IN_CASHIER,
        claimedById: userId,
        claimedCashSessionId: cashSessionId,
        claimedAt: now,
        claimExpiresAt,
        releasedAt: null,
      },
    });

    if (claimed.count !== 1) {
      const existing = await tx.salesOrder.findFirst({
        where: { id: orderId, tenantId },
        select: {
          id: true,
          status: true,
          claimedById: true,
          invoiceId: true,
        },
      });

      if (!existing) {
        throw new NotFoundException('Pending sales order not found for tenant.');
      }

      if (existing.status === SalesOrderStatus.COMPLETED || existing.invoiceId) {
        throw new BadRequestException('Sales order has already been completed.');
      }

      if (existing.status === SalesOrderStatus.CANCELLED) {
        throw new BadRequestException('Sales order has already been cancelled.');
      }

      throw new BadRequestException('Sales order is already claimed by another cashier.');
    }

    return tx.salesOrder.findUniqueOrThrow({
      where: { id: orderId },
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
  }

  private async computeSale(
    tenantId: string,
    items: PosSaleItemDto[],
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    if (!items.length) {
      throw new BadRequestException('Sale must include at least one item.');
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
        id: {
          in: Array.from(quantitiesByProduct.keys()),
        },
        status: ProductStatus.ACTIVE,
      },
    });

    if (products.length !== quantitiesByProduct.size) {
      throw new NotFoundException('One or more POS products do not belong to tenant.');
    }

    const computedItems: ComputedSaleLine[] = products.map((product) => {
      const quantity = new Prisma.Decimal(quantitiesByProduct.get(product.id) ?? 0);
      const unitPrice = product.salePrice.gt(0) ? product.salePrice : product.price;
      const subtotal = quantity.mul(unitPrice).toDecimalPlaces(2);
      const discountTotal = new Prisma.Decimal(0);
      const taxTotal = subtotal.mul(product.taxRate).toDecimalPlaces(2);

      return {
        product,
        productId: product.id,
        sku: product.sku,
        barcode: product.barcode,
        description: product.name,
        quantity,
        unit: product.unit,
        reservedQuantity: 0,
        unitPrice,
        discountTotal,
        taxCategory: product.taxCategory,
        taxRate: product.taxRate,
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
      discountTotal: computedItems
        .reduce((sum, item) => sum.add(item.discountTotal), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
      taxTotal: computedItems
        .reduce((sum, item) => sum.add(item.taxTotal), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
      total: computedItems
        .reduce((sum, item) => sum.add(item.total), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
    };
  }

  private async computeSaleFromOrder(order: {
    items: Array<{
      productId: string | null;
      sku: string | null;
      barcode: string | null;
      description: string;
      quantity: Prisma.Decimal;
      unit: ProductUnit;
      reservedQuantity: number;
      unitPrice: Prisma.Decimal;
      discountTotal: Prisma.Decimal;
      taxCategory: TaxCategory;
      taxRate: Prisma.Decimal;
      taxTotal: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      total: Prisma.Decimal;
      product: Product | null;
    }>;
  }) {
    const computedItems: ComputedSaleLine[] = order.items.map((item) => {
      if (!item.productId || !item.product) {
        throw new BadRequestException('Sales order contains an unavailable product.');
      }

      return {
        product: item.product,
        productId: item.productId,
        sku: item.sku,
        barcode: item.barcode,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        reservedQuantity: item.reservedQuantity,
        unitPrice: item.unitPrice,
        discountTotal: item.discountTotal,
        taxCategory: item.taxCategory,
        taxRate: item.taxRate,
        taxTotal: item.taxTotal,
        subtotal: item.subtotal,
        total: item.total,
      };
    });

    for (const item of computedItems) {
      const quantity = item.quantity.toNumber();

      if (
        item.product.trackInventory &&
        requiresWholeQuantity(item.unit) &&
        !Number.isInteger(quantity)
      ) {
        throw new BadRequestException(
          `Tracked product ${item.description} requires whole quantities.`,
        );
      }

      if (item.product.trackInventory && Math.abs(item.reservedQuantity - quantity) > 1e-9) {
        throw new BadRequestException(
          `Inventory reservation is incomplete for ${item.description}.`,
        );
      }

      if (item.product.trackInventory && item.product.stock < quantity) {
        throw new BadRequestException(`Insufficient stock for ${item.description}.`);
      }
    }

    return {
      items: computedItems,
      subtotal: computedItems
        .reduce((sum, item) => sum.add(item.subtotal), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
      discountTotal: computedItems
        .reduce((sum, item) => sum.add(item.discountTotal), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
      taxTotal: computedItems
        .reduce((sum, item) => sum.add(item.taxTotal), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
      total: computedItems
        .reduce((sum, item) => sum.add(item.total), new Prisma.Decimal(0))
        .toDecimalPlaces(2),
    };
  }

  private async applyInventoryForSale(
    tx: Prisma.TransactionClient,
    args: {
      tenantId: string;
      item: ComputedSaleLine;
      invoiceId: string;
      invoiceNumber: string;
      userId: string;
      fromOrder: boolean;
    },
  ) {
    const { tenantId, item, invoiceId, invoiceNumber, userId, fromOrder } = args;

    if (!item.product.trackInventory) {
      return;
    }

    const quantity = item.quantity.toNumber();
    if (requiresWholeQuantity(item.product.unit) && !Number.isInteger(quantity)) {
      throw new BadRequestException(
        `Tracked product ${item.description} requires whole quantities.`,
      );
    }

    const updated = fromOrder
      ? await tx.$queryRaw<Array<{ stock: number; reservedStock: number }>>`
          UPDATE "Product"
          SET
            "stock" = "stock" - ${quantity},
            "reservedStock" = GREATEST("reservedStock" - ${item.reservedQuantity}, 0)
          WHERE "id" = ${item.productId}
            AND "tenantId" = ${tenantId}
            AND "trackInventory" = TRUE
            AND "stock" >= ${quantity}
            AND "reservedStock" >= ${item.reservedQuantity}
          RETURNING "stock", "reservedStock"
        `
      : await tx.$queryRaw<Array<{ stock: number; reservedStock: number }>>`
          UPDATE "Product"
          SET "stock" = "stock" - ${quantity}
          WHERE "id" = ${item.productId}
            AND "tenantId" = ${tenantId}
            AND "trackInventory" = TRUE
            AND ("stock" - "reservedStock") >= ${quantity}
          RETURNING "stock", "reservedStock"
        `;

    if (updated.length !== 1) {
      const message = fromOrder
        ? `Insufficient stock for ${item.description}.`
        : `Insufficient available stock for ${item.description}.`;
      throw new BadRequestException(message);
    }

    const newStock = updated[0].stock;
    const previousStock = newStock + quantity;

    await tx.inventoryMovement.create({
      data: {
        tenantId,
        productId: item.productId,
        type: InventoryMovementType.SALE,
        quantity,
        previousStock,
        newStock,
        unitCost: item.product.cost,
        reason: fromOrder ? 'Venta POS facturada desde orden' : 'Venta POS facturada',
        reference: invoiceNumber,
        invoiceId,
        createdById: userId,
      },
    });
  }

  private async findCashSessionForSale(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    cashSessionId?: string,
  ) {
    const session = await tx.cashSession.findFirst({
      where: {
        tenantId,
        openedById: userId,
        status: CashSessionStatus.OPEN,
        ...(cashSessionId ? { id: cashSessionId } : {}),
      },
      orderBy: {
        openedAt: 'desc',
      },
      include: {
        cashRegister: true,
      },
    });

    if (!session) {
      throw new BadRequestException(
        'An open cash session for this cashier is required to complete POS sales.',
      );
    }

    return session;
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

  private async ensureCanCreateDirectSale(tenantId: string, user: AuthenticatedUser) {
    const membership = await this.ensureCanUsePos(tenantId, user);

    if (!this.isAdminMembership(membership)) {
      throw new ForbiddenException('Only admins can create direct POS sales.');
    }

    return membership;
  }

  private async ensureCanUsePos(tenantId: string, user: AuthenticatedUser) {
    const membership =
      user.memberships.find((candidate) =>
        ([Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN] as Role[]).includes(candidate.role),
      ) ?? user.memberships.find((candidate) => candidate.tenantId === tenantId);

    if (
      !membership ||
      (!membership.canUsePos && ![...adminRoles, Role.CASHIER].includes(membership.role))
    ) {
      throw new ForbiddenException('Employee does not have POS access.');
    }

    if (!this.isAdminMembership(membership)) {
      const employee = await this.prisma.employeeProfile.findFirst({
        where: {
          tenantId,
          userId: user.id,
          status: EmployeeStatus.ACTIVE,
        },
        select: { id: true },
      });

      if (!employee) {
        throw new ForbiddenException('Employee profile must be active to use POS.');
      }
    }

    return membership;
  }

  private isAdminMembership(membership: AuthenticatedUser['memberships'][number]) {
    return adminRoles.includes(membership.role);
  }

  private ensureSupportedPaymentMethod(paymentMethod: PaymentMethod) {
    const supportedMethods: PaymentMethod[] = [
      PaymentMethod.CASH,
      PaymentMethod.CARD,
      PaymentMethod.TRANSFER,
    ];
    if (!supportedMethods.includes(paymentMethod)) {
      throw new BadRequestException('POS payments only support cash, card, or transfer.');
    }
  }

  /**
   * A completed POS sale writes the invoice, payment, cash movement, inventory,
   * order state, customer balance, local NCF and audit trail together.
   * Remote database latency can make that safely exceed Prisma's 5 second default.
   */
  private async runSerializable<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const attempts = 3;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 30_000,
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') {
          throw new ServiceUnavailableException(
            'El cobro tardó demasiado y se revirtió por seguridad. Inténtalo nuevamente.',
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

    throw new ServiceUnavailableException(
      'No se pudo completar el cobro por concurrencia. Inténtalo nuevamente.',
    );
  }

  private getPaymentAmounts(
    amountReceived: number | undefined,
    total: Prisma.Decimal,
    paymentMethod: PaymentMethod,
    requiredPayment: Prisma.Decimal = total,
  ) {
    const required = requiredPayment.toDecimalPlaces(2);
    if (required.lt(0) || required.gt(total)) {
      throw new BadRequestException('Required payment amount is invalid.');
    }
    const tendered = new Prisma.Decimal(amountReceived ?? required).toDecimalPlaces(2);

    if (tendered.lt(0)) {
      throw new BadRequestException('Amount received cannot be negative.');
    }

    if (required.isZero() && !tendered.isZero()) {
      throw new BadRequestException('This credit sale has no initial payment to collect.');
    }

    if (paymentMethod === PaymentMethod.CASH && tendered.lt(required)) {
      throw new BadRequestException('Cash received must cover the required initial payment.');
    }

    if (paymentMethod !== PaymentMethod.CASH && !tendered.eq(required)) {
      throw new BadRequestException(
        'Card and transfer payments must equal the required initial payment.',
      );
    }

    return {
      paidAmount: required,
      amountReceived: tendered,
      changeAmount:
        paymentMethod === PaymentMethod.CASH && tendered.gt(required)
          ? tendered.sub(required).toDecimalPlaces(2)
          : new Prisma.Decimal(0),
    };
  }

  private getInvoiceStatus(paidAmount: Prisma.Decimal, total: Prisma.Decimal) {
    if (paidAmount.gte(total)) {
      return InvoiceStatus.PAID;
    }

    if (paidAmount.gt(0)) {
      return InvoiceStatus.PARTIALLY_PAID;
    }

    return InvoiceStatus.ISSUED;
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
