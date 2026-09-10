type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'outline';

const statusLabels: Record<string, string> = {
  ACTIVE: 'Activo',
  INACTIVE: 'Inactivo',
  SUSPENDED: 'Suspendido',
  INVITED: 'Invitado',
  DISABLED: 'Deshabilitado',
  BLOCKED: 'Bloqueado',
  TERMINATED: 'Terminado',
  DISCONTINUED: 'Descontinuado',
  OPEN: 'Abierta',
  CLOSED: 'Cerrada',
  CREATED: 'Creada',
  REQUESTED: 'Solicitada',
  UNDER_REVIEW: 'En revisión',
  APPROVED: 'Aprobada',
  PAUSED: 'Pausada',
  PARTIALLY_RECEIVED: 'Recepción parcial',
  RECEIVED: 'Recibida',
  CONFIRMED: 'Confirmada',
  REVERSED: 'Revertida',
  OVERDUE: 'Vencida',
  SENT_TO_CASHIER: 'En caja',
  IN_CASHIER: 'Tomada en caja',
  QUOTATION: 'Cotizacion',
  CASH_SALE: 'Venta de caja',
  QUOTATION_DESTINATION: 'Cotizacion',
  DRAFT: 'Borrador',
  VALIDATING: 'Validando',
  READY: 'Listo',
  IMPORTED: 'Importado',
  ISSUED: 'Emitida',
  PAID: 'Pagada',
  PARTIALLY_PAID: 'Pago parcial',
  CANCELLED: 'Cancelada',
  VOID: 'Anulada',
  VOIDED: 'Anulada',
  CREDITED: 'Acreditada',
  PENDING: 'Pendiente',
  PROCESSING: 'Procesando',
  COMPLETED: 'Completado',
  FAILED: 'Fallido',
  PENDING_ECF: 'Pendiente e-CF',
  NOT_APPLICABLE: 'No aplica',
  PENDING_SEQUENCE: 'Pendiente de secuencia',
  LOCAL_ISSUED: 'NCF emitido',
  LEGACY_UNVERIFIED: 'Legado no verificado',
  READY_TO_SEND: 'Lista para enviar',
  PENDING_SIGNATURE: 'Pendiente de firma',
  SIGNED: 'Firmada',
  SENT: 'Enviada',
  ACCEPTED: 'Aceptada',
  REJECTED: 'Rechazada',
  EXPIRED: 'Vencida',
  EXHAUSTED: 'Agotada',
};

const statusVariants: Record<string, BadgeVariant> = {
  ACTIVE: 'success',
  OPEN: 'success',
  READY: 'success',
  IMPORTED: 'success',
  COMPLETED: 'success',
  APPROVED: 'success',
  RECEIVED: 'success',
  CONFIRMED: 'success',
  PAID: 'success',
  ACCEPTED: 'success',
  INACTIVE: 'outline',
  INVITED: 'outline',
  DRAFT: 'outline',
  CLOSED: 'outline',
  NOT_APPLICABLE: 'outline',
  SENT_TO_CASHIER: 'warning',
  IN_CASHIER: 'warning',
  QUOTATION: 'outline',
  VALIDATING: 'warning',
  ISSUED: 'warning',
  REQUESTED: 'warning',
  UNDER_REVIEW: 'warning',
  PAUSED: 'warning',
  PARTIALLY_RECEIVED: 'warning',
  OVERDUE: 'danger',
  REVERSED: 'danger',
  PARTIALLY_PAID: 'warning',
  PENDING: 'warning',
  PROCESSING: 'warning',
  PENDING_ECF: 'warning',
  PENDING_SEQUENCE: 'warning',
  LOCAL_ISSUED: 'success',
  LEGACY_UNVERIFIED: 'warning',
  READY_TO_SEND: 'warning',
  PENDING_SIGNATURE: 'warning',
  SIGNED: 'warning',
  SENT: 'warning',
  SUSPENDED: 'danger',
  DISABLED: 'danger',
  BLOCKED: 'danger',
  TERMINATED: 'danger',
  DISCONTINUED: 'danger',
  CANCELLED: 'danger',
  VOID: 'danger',
  VOIDED: 'danger',
  CREDITED: 'danger',
  FAILED: 'danger',
  REJECTED: 'danger',
  EXPIRED: 'danger',
  EXHAUSTED: 'danger',
};

const roleLabels: Record<string, string> = {
  QORVEX_SUPER_ADMIN: 'Super admin de plataforma',
  SUPER_ADMIN: 'Super admin',
  ADMIN: 'Administrador',
  ACCOUNTANT: 'Contador',
  CASHIER: 'Cajero',
  ORDER_TAKER: 'Ordenanza',
};

const documentTypeLabels: Record<string, string> = {
  RNC: 'RNC',
  CEDULA: 'Cedula',
  PASSPORT: 'Pasaporte',
  CONSUMER_FINAL: 'Consumidor final',
  OTHER: 'Otro',
};

const invoiceDocumentTypeLabels: Record<string, string> = {
  CONSUMER_02: 'Factura de consumo B02',
  FISCAL_CREDIT_01: 'Factura de credito fiscal B01',
  CONSUMER_ELECTRONIC_32: 'Factura de consumo e-CF 32',
  FISCAL_CREDIT_ELECTRONIC_31: 'Credito fiscal e-CF 31',
  DEBIT_NOTE_ELECTRONIC_33: 'Nota de debito e-CF 33',
  CREDIT_NOTE_ELECTRONIC_34: 'Nota de credito e-CF 34',
};

const paymentMethodLabels: Record<string, string> = {
  CASH: 'Efectivo',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  CHECK: 'Cheque',
  OTHER: 'Otro',
};

const productUnitLabels: Record<string, string> = {
  UNIT: 'Unidad',
  BOX: 'Caja',
  PACK: 'Paquete',
  BAG: 'Saco',
  ROLL: 'Rollo',
  METER: 'Metro (MT)',
  FOOT: 'Pie (FT)',
  YARD: 'Yarda (YD)',
  POUND: 'Libra (LB)',
  GALLON: 'Galon',
  LITER: 'Litro',
  KILOGRAM: 'Kilogramo',
  QUINTAL: 'Quintal',
  SERVICE: 'Servicio',
};

const barcodeTypeLabels: Record<string, string> = {
  EAN13: 'EAN-13',
  UPC_A: 'UPC-A',
  CODE128: 'Code 128',
  INTERNAL_CODE128: 'Codigo interno',
  QR: 'QR',
  UNKNOWN: 'Desconocido',
};

const cashMovementTypeLabels: Record<string, string> = {
  OPENING: 'Apertura de caja',
  SALE_PAYMENT: 'Pago de venta',
  CREDIT_PAYMENT: 'Abono de cuenta por cobrar',
  SUPPLIER_PAYMENT: 'Pago a suplidor',
  CASH_IN: 'Entrada de efectivo',
  CASH_OUT: 'Salida de efectivo',
  REFUND: 'Devolucion',
  CLOSING: 'Cierre de caja',
  ADJUSTMENT: 'Ajuste',
};

const inventoryMovementTypeLabels: Record<string, string> = {
  INITIAL_STOCK: 'Stock inicial',
  PURCHASE: 'Compra',
  INBOUND: 'Entrada',
  OUTBOUND: 'Salida',
  ADJUSTMENT: 'Ajuste',
  ADJUSTMENT_IN: 'Ajuste de entrada',
  ADJUSTMENT_OUT: 'Ajuste de salida',
  SALE: 'Venta',
  RETURN: 'Devolucion',
  DAMAGE: 'Merma',
  TRANSFER_IN: 'Transferencia recibida',
  TRANSFER_OUT: 'Transferencia enviada',
};

const employeeActionLabels: Record<string, string> = {
  OPEN_CASH_SESSION: 'abrio caja',
  CLOSE_CASH_SESSION: 'cerro caja',
  CREATE_SALES_ORDER: 'creo una orden',
  SEND_SALES_ORDER_TO_CASHIER: 'envio una orden a caja',
  CLAIM_SALES_ORDER: 'tomo una orden en caja',
  RELEASE_SALES_ORDER: 'libero una orden',
  COMPLETE_SALES_ORDER: 'completo una orden',
  CANCEL_SALES_ORDER: 'cancelo una orden',
  EXPIRE_SALES_ORDER: 'vencio una orden',
  CREATE_SALE: 'creo una venta',
  CANCEL_SALE: 'cancelo una venta',
  ISSUE_INVOICE: 'emitio factura',
  CANCEL_INVOICE: 'cancelo factura',
  APPLY_DISCOUNT: 'aplico descuento',
  CHANGE_PRODUCT_PRICE: 'cambio precio de producto',
  ADD_PRODUCT: 'agrego producto',
  UPDATE_PRODUCT: 'actualizo producto',
  DELETE_PRODUCT: 'desactivo producto',
  CHANGE_BARCODE: 'cambio codigo de barras',
  PRINT_RECEIPT: 'imprimio recibo',
  REPRINT_RECEIPT: 'reimprimio recibo',
  CASH_IN: 'registro entrada de efectivo',
  CASH_OUT: 'registro salida de efectivo',
  INVENTORY_ADJUSTMENT: 'ajusto inventario',
  REQUEST_RETURN: 'solicito una devolucion',
  APPROVE_RETURN: 'aprobo una devolucion',
  REJECT_RETURN: 'rechazo una devolucion',
  COMPLETE_RETURN: 'completo una devolucion',
};

const entityLabels: Record<string, string> = {
  Tenant: 'Empresa',
  User: 'Usuario',
  Membership: 'Membresia',
  Customer: 'Cliente',
  Product: 'Producto',
  ProductCategory: 'Categoria de producto',
  ProductBarcodeLabel: 'Etiqueta de producto',
  InventoryMovement: 'Movimiento de inventario',
  Invoice: 'Factura',
  InvoiceItem: 'Linea de factura',
  SalesOrder: 'Orden',
  SalesOrderItem: 'Linea de orden',
  Payment: 'Pago',
  CashRegister: 'Caja fisica',
  CashSession: 'Sesion de caja',
  CashMovement: 'Movimiento de caja',
  ReturnRequest: 'Devolucion',
  ReturnRequestItem: 'Linea de devolucion',
  EmployeeProfile: 'Empleado',
  FiscalSequence: 'Secuencia fiscal',
  ImportBatch: 'Lote de importacion',
};

const importTypeLabels: Record<string, string> = {
  PRODUCTS: 'Productos',
  CATEGORIES: 'Categorias',
  CUSTOMERS: 'Clientes',
  INITIAL_INVENTORY: 'Inventario inicial',
  FISCAL_SEQUENCES: 'Secuencias fiscales',
  HISTORICAL_INVOICES: 'Facturas historicas',
  INVOICE_ITEMS: 'Lineas de factura',
  PAYMENTS: 'Pagos',
};

export function translateStatus(status: string | null | undefined) {
  return translateFrom(statusLabels, status);
}

export function getStatusVariant(status: string | null | undefined): BadgeVariant {
  if (!status) {
    return 'default';
  }

  return statusVariants[status] ?? 'default';
}

export function translateRole(role: string | null | undefined) {
  if (!role) {
    return 'Sin rol';
  }

  return translateFrom(roleLabels, role);
}

export function translateDocumentType(type: string | null | undefined) {
  return translateFrom(documentTypeLabels, type);
}

export function translateInvoiceDocumentType(type: string | null | undefined) {
  return translateFrom(invoiceDocumentTypeLabels, type);
}

export function translatePaymentMethod(method: string | null | undefined) {
  return translateFrom(paymentMethodLabels, method);
}

export function translateProductUnit(unit: string | null | undefined) {
  return translateFrom(productUnitLabels, unit);
}

export function translateBarcodeType(type: string | null | undefined) {
  return translateFrom(barcodeTypeLabels, type);
}

export function translateCashMovementType(type: string | null | undefined) {
  return translateFrom(cashMovementTypeLabels, type);
}

export function translateInventoryMovementType(type: string | null | undefined) {
  return translateFrom(inventoryMovementTypeLabels, type);
}

export function translateEmployeeAction(action: string | null | undefined) {
  return translateFrom(employeeActionLabels, action);
}

export function translateEntity(entity: string | null | undefined) {
  return translateFrom(entityLabels, entity);
}

export function translateImportType(type: string | null | undefined) {
  return translateFrom(importTypeLabels, type);
}

function translateFrom(labels: Record<string, string>, value: string | null | undefined) {
  if (!value) {
    return '-';
  }

  return labels[value] ?? humanizeTechnicalValue(value);
}

function humanizeTechnicalValue(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
