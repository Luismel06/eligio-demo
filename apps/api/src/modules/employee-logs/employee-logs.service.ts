import { BadRequestException, Injectable } from '@nestjs/common';
import { EmployeeLogAction, Prisma, SalesOrderDestination } from '@qorvex/database';
import { PrismaService } from '../../prisma/prisma.service';
import { readFiscalCustomerSnapshot } from '../fiscal-documents/fiscal-document';
import { OperationalLogCategory, OperationalLogsQueryDto } from './dto/operational-logs-query.dto';
import {
  OperationalLog,
  OperationalLogMetadata,
  OperationalLogMetadataValue,
} from './operational-log.types';

const orderActions: EmployeeLogAction[] = [
  EmployeeLogAction.CREATE_SALES_ORDER,
  EmployeeLogAction.SEND_SALES_ORDER_TO_CASHIER,
  EmployeeLogAction.CLAIM_SALES_ORDER,
  EmployeeLogAction.RELEASE_SALES_ORDER,
  EmployeeLogAction.COMPLETE_SALES_ORDER,
  EmployeeLogAction.CANCEL_SALES_ORDER,
  EmployeeLogAction.EXPIRE_SALES_ORDER,
];

const posSaleActions: EmployeeLogAction[] = [
  EmployeeLogAction.CREATE_SALE,
  EmployeeLogAction.ISSUE_INVOICE,
  EmployeeLogAction.CANCEL_SALE,
  EmployeeLogAction.CANCEL_INVOICE,
];

const operationalActions: EmployeeLogAction[] = [...orderActions, ...posSaleActions];

const safeMetadataKeys = [
  'orderNumber',
  'invoiceNumber',
  'itemCount',
  'quantityTotal',
  'isUpdate',
  'reason',
  'cashRegister',
  'paymentMethod',
  'paymentMode',
  'amountReceived',
  'changeAmount',
  'documentType',
  'ncf',
  'eNcf',
  'sourceDestination',
  'sourceStatus',
  'destination',
  'status',
  'action',
  'clientName',
] as const;

const operationalLogSelect = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  amount: true,
  metadata: true,
  invoiceId: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  cashSession: {
    select: {
      cashRegister: {
        select: {
          name: true,
        },
      },
    },
  },
} satisfies Prisma.EmployeeActivityLogSelect;

const operationalOrderSelect = {
  id: true,
  orderNumber: true,
  status: true,
  destination: true,
  clientName: true,
  total: true,
  customerId: true,
  customer: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.SalesOrderSelect;

const operationalInvoiceSelect = {
  id: true,
  invoiceNumber: true,
  status: true,
  total: true,
  paymentMethod: true,
  fiscalCustomerSnapshot: true,
  customer: {
    select: {
      id: true,
      name: true,
    },
  },
  salesOrder: {
    select: operationalOrderSelect,
  },
} satisfies Prisma.InvoiceSelect;

type RawOperationalLog = Prisma.EmployeeActivityLogGetPayload<{
  select: typeof operationalLogSelect;
}>;
type OperationalOrder = Prisma.SalesOrderGetPayload<{
  select: typeof operationalOrderSelect;
}>;
type OperationalInvoice = Prisma.InvoiceGetPayload<{
  select: typeof operationalInvoiceSelect;
}>;

@Injectable()
export class EmployeeLogsService {
  constructor(private readonly prisma: PrismaService) {}

  findRecent(tenantId: string) {
    return this.prisma.employeeActivityLog.findMany({
      where: { tenantId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        invoice: { select: { id: true, invoiceNumber: true, total: true } },
        cashSession: { include: { cashRegister: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 150,
    });
  }

  async findOperational(
    tenantId: string,
    query: OperationalLogsQueryDto,
  ): Promise<OperationalLog[]> {
    const limit = query.limit ?? 250;
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;

    if (from && to && from > to) {
      throw new BadRequestException('"from" must be before or equal to "to".');
    }

    const actions =
      query.section === OperationalLogCategory.POS_SALE
        ? posSaleActions
        : query.section
          ? orderActions
          : operationalActions;
    const scanLimit = Math.min(
      query.section === OperationalLogCategory.ORDER_TAKING ||
        query.section === OperationalLogCategory.QUOTATION
        ? limit * 5
        : limit * 2,
      2500,
    );

    const logs = await this.prisma.employeeActivityLog.findMany({
      where: {
        tenantId,
        action: { in: actions },
        ...(query.userId ? { userId: query.userId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      select: operationalLogSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: scanLimit,
    });

    const references = this.collectReferences(logs);
    const [orders, invoices, customers] = await Promise.all([
      references.orderIds.size || references.orderNumbers.size
        ? this.prisma.salesOrder.findMany({
            where: {
              tenantId,
              OR: [
                ...(references.orderIds.size ? [{ id: { in: [...references.orderIds] } }] : []),
                ...(references.orderNumbers.size
                  ? [{ orderNumber: { in: [...references.orderNumbers] } }]
                  : []),
              ],
            },
            select: operationalOrderSelect,
          })
        : Promise.resolve([]),
      references.invoiceIds.size || references.invoiceNumbers.size
        ? this.prisma.invoice.findMany({
            where: {
              tenantId,
              OR: [
                ...(references.invoiceIds.size ? [{ id: { in: [...references.invoiceIds] } }] : []),
                ...(references.invoiceNumbers.size
                  ? [{ invoiceNumber: { in: [...references.invoiceNumbers] } }]
                  : []),
              ],
            },
            select: operationalInvoiceSelect,
          })
        : Promise.resolve([]),
      references.customerIds.size
        ? this.prisma.customer.findMany({
            where: {
              tenantId,
              id: { in: [...references.customerIds] },
            },
            select: {
              id: true,
              name: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const orderById = new Map<string, OperationalOrder>();
    const orderByNumber = new Map<string, OperationalOrder>();
    for (const order of orders) {
      orderById.set(order.id, order);
      orderByNumber.set(order.orderNumber, order);
    }

    const invoiceById = new Map<string, OperationalInvoice>();
    const invoiceByNumber = new Map<string, OperationalInvoice>();
    for (const invoice of invoices) {
      invoiceById.set(invoice.id, invoice);
      invoiceByNumber.set(invoice.invoiceNumber, invoice);
      if (invoice.salesOrder) {
        orderById.set(invoice.salesOrder.id, invoice.salesOrder);
        orderByNumber.set(invoice.salesOrder.orderNumber, invoice.salesOrder);
      }
    }

    const customerById = new Map(customers.map((customer) => [customer.id, customer.name]));
    const createSaleInvoiceKeys = new Set(
      logs
        .filter((log) => log.action === EmployeeLogAction.CREATE_SALE)
        .map((log) => this.getInvoiceReference(log))
        .filter((reference): reference is string => Boolean(reference)),
    );

    return logs
      .filter((log) => {
        if (log.action !== EmployeeLogAction.ISSUE_INVOICE) {
          return true;
        }

        const reference = this.getInvoiceReference(log);
        return !reference || !createSaleInvoiceKeys.has(reference);
      })
      .map((log) =>
        this.toOperationalLog(
          log,
          orderById,
          orderByNumber,
          invoiceById,
          invoiceByNumber,
          customerById,
        ),
      )
      .filter((log) => !query.section || log.category === query.section)
      .slice(0, limit);
  }

  private collectReferences(logs: RawOperationalLog[]) {
    const orderIds = new Set<string>();
    const orderNumbers = new Set<string>();
    const invoiceIds = new Set<string>();
    const invoiceNumbers = new Set<string>();
    const customerIds = new Set<string>();

    for (const log of logs) {
      const metadata = asMetadataRecord(log.metadata);
      const orderNumber = readString(metadata, 'orderNumber');
      const invoiceNumber = readString(metadata, 'invoiceNumber');
      const customerId = readString(metadata, 'customerId');

      if (orderNumber) {
        orderNumbers.add(orderNumber);
      }
      if (invoiceNumber) {
        invoiceNumbers.add(invoiceNumber);
      }
      if (customerId) {
        customerIds.add(customerId);
      }
      if (log.invoiceId) {
        invoiceIds.add(log.invoiceId);
      }
      if (log.entityId && orderActions.includes(log.action)) {
        orderIds.add(log.entityId);
      }
      if (log.entityId && posSaleActions.includes(log.action)) {
        invoiceIds.add(log.entityId);
      }
    }

    return {
      orderIds,
      orderNumbers,
      invoiceIds,
      invoiceNumbers,
      customerIds,
    };
  }

  private toOperationalLog(
    log: RawOperationalLog,
    orderById: Map<string, OperationalOrder>,
    orderByNumber: Map<string, OperationalOrder>,
    invoiceById: Map<string, OperationalInvoice>,
    invoiceByNumber: Map<string, OperationalInvoice>,
    customerById: Map<string, string>,
  ): OperationalLog {
    const rawMetadata = asMetadataRecord(log.metadata);
    const metadata = sanitizeMetadata(rawMetadata);
    const metadataOrderNumber = readString(rawMetadata, 'orderNumber');
    const metadataInvoiceNumber = readString(rawMetadata, 'invoiceNumber');
    const metadataCustomerId = readString(rawMetadata, 'customerId');

    const invoice =
      (log.invoiceId ? invoiceById.get(log.invoiceId) : undefined) ??
      (posSaleActions.includes(log.action) && log.entityId
        ? invoiceById.get(log.entityId)
        : undefined) ??
      (metadataInvoiceNumber ? invoiceByNumber.get(metadataInvoiceNumber) : undefined);
    const order =
      (orderActions.includes(log.action) && log.entityId
        ? orderById.get(log.entityId)
        : undefined) ??
      (metadataOrderNumber ? orderByNumber.get(metadataOrderNumber) : undefined) ??
      invoice?.salesOrder;
    const orderNumber = order?.orderNumber ?? metadataOrderNumber ?? null;
    const invoiceNumber = invoice?.invoiceNumber ?? metadataInvoiceNumber ?? null;
    const sourceDestination =
      readString(rawMetadata, 'sourceDestination') ??
      (orderNumber?.startsWith('COT-') ? SalesOrderDestination.QUOTATION : null);
    const category = posSaleActions.includes(log.action)
      ? OperationalLogCategory.POS_SALE
      : sourceDestination === SalesOrderDestination.QUOTATION ||
          order?.destination === SalesOrderDestination.QUOTATION ||
          orderNumber?.startsWith('COT-')
        ? OperationalLogCategory.QUOTATION
        : OperationalLogCategory.ORDER_TAKING;
    const customerName =
      readFiscalCustomerSnapshot(invoice?.fiscalCustomerSnapshot)?.name ??
      order?.clientName ??
      order?.customer?.name ??
      invoice?.customer?.name ??
      (metadataCustomerId ? customerById.get(metadataCustomerId) : undefined) ??
      readString(rawMetadata, 'clientName') ??
      null;
    const status =
      category === OperationalLogCategory.POS_SALE
        ? (invoice?.status ?? readString(rawMetadata, 'status') ?? null)
        : (readString(rawMetadata, 'sourceStatus') ?? order?.status ?? null);
    const destination =
      sourceDestination ??
      order?.destination ??
      (category === OperationalLogCategory.POS_SALE ? SalesOrderDestination.CASH_SALE : null);
    const paymentMethod =
      invoice?.paymentMethod ?? readString(rawMetadata, 'paymentMethod') ?? null;
    const cashRegisterName =
      log.cashSession?.cashRegister.name ?? readString(rawMetadata, 'cashRegister') ?? null;

    return {
      id: log.id,
      category,
      action: log.action,
      amount:
        log.amount?.toString() ?? invoice?.total.toString() ?? order?.total.toString() ?? null,
      createdAt: log.createdAt,
      user: log.user,
      entity: log.entity,
      entityId: log.entityId,
      orderId: order?.id ?? invoice?.salesOrder?.id ?? null,
      invoiceId: invoice?.id ?? log.invoiceId,
      documentNumber:
        category === OperationalLogCategory.POS_SALE
          ? (invoiceNumber ?? orderNumber)
          : (orderNumber ?? invoiceNumber),
      orderNumber,
      invoiceNumber,
      customerName,
      status,
      destination,
      paymentMethod,
      cashRegisterName,
      detail: buildDetail(log.action, {
        orderNumber,
        invoiceNumber,
        reason: readString(rawMetadata, 'reason'),
        cashRegisterName,
        paymentMethod,
        isUpdate: readBoolean(rawMetadata, 'isUpdate'),
      }),
      metadata,
    };
  }

  private getInvoiceReference(log: RawOperationalLog) {
    const metadata = asMetadataRecord(log.metadata);
    return (
      log.invoiceId ??
      (log.entity === 'Invoice' ? log.entityId : null) ??
      readString(metadata, 'invoiceNumber')
    );
  }
}

function asMetadataRecord(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, Prisma.JsonValue>;
}

function readString(metadata: Record<string, Prisma.JsonValue>, key: string) {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readBoolean(metadata: Record<string, Prisma.JsonValue>, key: string) {
  const value = metadata[key];
  return typeof value === 'boolean' ? value : null;
}

function sanitizeMetadata(metadata: Record<string, Prisma.JsonValue>): OperationalLogMetadata {
  const safe: OperationalLogMetadata = {};

  for (const key of safeMetadataKeys) {
    const value = metadata[key];
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      safe[key] = value as OperationalLogMetadataValue;
    }
  }

  return safe;
}

function buildDetail(
  action: EmployeeLogAction,
  data: {
    orderNumber: string | null;
    invoiceNumber: string | null;
    reason: string | null;
    cashRegisterName: string | null;
    paymentMethod: string | null;
    isUpdate: boolean | null;
  },
) {
  if (data.reason) {
    return data.reason;
  }

  if (action === EmployeeLogAction.CREATE_SALES_ORDER && data.isUpdate) {
    return `Documento ${data.orderNumber ?? 'sin número'} actualizado.`;
  }
  if (action === EmployeeLogAction.SEND_SALES_ORDER_TO_CASHIER) {
    return `Enviado a caja${data.cashRegisterName ? ` ${data.cashRegisterName}` : ''}.`;
  }
  if (action === EmployeeLogAction.CLAIM_SALES_ORDER) {
    return `Tomado por caja${data.cashRegisterName ? ` ${data.cashRegisterName}` : ''}.`;
  }
  if (action === EmployeeLogAction.RELEASE_SALES_ORDER) {
    return 'Liberado para que otra caja pueda procesarlo.';
  }
  if (action === EmployeeLogAction.COMPLETE_SALES_ORDER) {
    return data.invoiceNumber
      ? `Completado en la factura ${data.invoiceNumber}.`
      : 'Orden completada.';
  }
  if (action === EmployeeLogAction.CREATE_SALE) {
    return data.paymentMethod
      ? `Venta procesada mediante ${data.paymentMethod}.`
      : 'Venta procesada en caja.';
  }
  if (action === EmployeeLogAction.ISSUE_INVOICE) {
    return `Factura ${data.invoiceNumber ?? 'sin número'} emitida.`;
  }

  return null;
}
