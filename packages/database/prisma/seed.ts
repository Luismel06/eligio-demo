import {
  BarcodeType,
  CashMovementType,
  CashSessionStatus,
  CustomerStatus,
  DocumentType,
  EmployeeLogAction,
  EmployeeStatus,
  FiscalSequenceStatus,
  ImportStatus,
  ImportType,
  InventoryMovementType,
  InvoiceDocumentType,
  InvoiceFiscalStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  PrismaClient,
  ProductStatus,
  ProductUnit,
  Role,
  SalesOrderStatus,
  TaxCategory,
} from '../generated/client';
import * as bcrypt from 'bcryptjs';

function assertSeedAllowed() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    throw new Error(
      [
        'Refusing to run the development seed in production.',
        'This seed deletes existing data before recreating the EligioValdez Comercial demo dataset.',
        'Set ALLOW_PRODUCTION_SEED=true only for an intentional staging/demo reseed.',
      ].join(' '),
    );
  }
}

assertSeedAllowed();

const prisma = new PrismaClient();

const demoPassword = 'DemoPassword123!';
const money = (value: number | string) => new Prisma.Decimal(value);
const itbisRate = new Prisma.Decimal('0.18');
const zero = money('0.00');

type SeedLine = {
  productId: string;
  sku?: string | null;
  barcode?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: Prisma.Decimal;
};

function getInvoiceAmounts(lines: SeedLine[]) {
  const invoiceLines = lines.map((line) => {
    const quantity = money(line.quantity);
    const unitPrice = money(line.unitPrice);
    const taxRate = line.taxRate ?? itbisRate;
    const subtotal = quantity.mul(unitPrice).toDecimalPlaces(2);
    const taxTotal = subtotal.mul(taxRate).toDecimalPlaces(2);

    return {
      ...line,
      quantity,
      unitPrice,
      taxRate,
      subtotal,
      taxTotal,
      total: subtotal.add(taxTotal).toDecimalPlaces(2),
    };
  });

  return {
    lines: invoiceLines,
    subtotal: invoiceLines.reduce((sum, line) => sum.add(line.subtotal), zero).toDecimalPlaces(2),
    taxTotal: invoiceLines.reduce((sum, line) => sum.add(line.taxTotal), zero).toDecimalPlaces(2),
    total: invoiceLines.reduce((sum, line) => sum.add(line.total), zero).toDecimalPlaces(2),
  };
}

async function main() {
  // Approval requests and overrides reference users with RESTRICT because
  // their audit trail must survive normal user lifecycle operations. A
  // destructive demo reseed must explicitly clear them before users/tenants.
  await prisma.taxIdentityApprovalRequest.deleteMany();
  await prisma.taxIdentityOverride.deleteMany();
  await prisma.importRowError.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.employeeActivityLog.deleteMany();
  await prisma.salesOrderItem.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.cashMovement.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.electronicDocument.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.inventoryMovement.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.cashSession.deleteMany();
  await prisma.cashRegister.deleteMany();
  await prisma.fiscalSequence.deleteMany();
  await prisma.employeeProfile.deleteMany();
  await prisma.product.deleteMany();
  await prisma.productCategory.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.companyBranding.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  const passwordHash = await bcrypt.hash(demoPassword, 12);

  const coreStackTenant = await prisma.tenant.create({
    data: {
      name: 'CoreStack',
      commercialName: 'CoreStack',
      legalName: 'CoreStack SRL',
      slug: 'corestack',
      email: 'soporte@corestack.local',
      phone: '809-555-9000',
      address: 'Santo Domingo, Republica Dominicana',
      branding: {
        create: {
          logoUrl: null,
          primaryColor: '#111827',
          accentColor: '#f36c10',
          loginTitle: 'CoreStack Core',
          loginSubtitle: 'Administracion interna de la plataforma.',
        },
      },
    },
  });

  const eligiovaldezTenant = await prisma.tenant.create({
    data: {
      name: 'EligioValdez Comercial',
      commercialName: 'EligioValdez Comercial',
      legalName: 'EligioValdez Comercial SRL (Demo)',
      slug: 'eligiovaldez-comercial',
      rnc: '000000000',
      email: 'admin@eligiovaldez.local',
      phone: '000-000-0000',
      address: 'Direccion de demostracion, Santo Domingo, Republica Dominicana',
      branding: {
        create: {
          logoUrl: '/logo.png',
          primaryColor: '#111111',
          accentColor: '#f36c10',
          loginTitle: 'EligioValdez Comercial',
          loginSubtitle: 'Acceso de demostracion al POS, facturacion e inventario.',
        },
      },
    },
  });

  const superAdmin = await prisma.user.create({
    data: {
      email: 'plataforma@eligiovaldez.local',
      name: 'Soporte de plataforma',
      phone: '809-555-9001',
      passwordHash,
      memberships: {
        create: {
          tenantId: coreStackTenant.id,
          role: Role.SUPER_ADMIN,
          canViewReports: true,
          canManageFiscalSequences: true,
          canManageEmployees: true,
          canViewCashLogs: true,
        },
      },
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: 'admin@eligiovaldez.local',
      name: 'Administrador EligioValdez',
      phone: '000-000-0001',
      passwordHash,
      memberships: {
        create: {
          tenantId: eligiovaldezTenant.id,
          role: Role.ADMIN,
          canUsePos: false,
          canOpenCashSession: false,
          canCloseCashSession: true,
          canApplyDiscount: true,
          canCancelInvoice: true,
          canVoidInvoice: true,
          canAdjustInventory: true,
          canManageProducts: true,
          canManageEmployees: true,
          canViewReports: true,
          canManageFiscalSequences: true,
          canViewCashLogs: true,
          canReprintReceipt: true,
        },
      },
      employeeProfiles: {
        create: {
          tenantId: eligiovaldezTenant.id,
          employeeCode: 'RIV-ADM-001',
          jobTitle: 'Administrador general',
          hireDate: new Date('2025-02-01T00:00:00.000Z'),
          documentType: DocumentType.CEDULA,
          documentNumber: '00112345678',
          status: EmployeeStatus.ACTIVE,
        },
      },
    },
  });

  const cashier = await prisma.user.create({
    data: {
      email: 'cajero@eligiovaldez.local',
      name: 'Cajero EligioValdez',
      phone: '000-000-0002',
      passwordHash,
      memberships: {
        create: {
          tenantId: eligiovaldezTenant.id,
          role: Role.CASHIER,
          canUsePos: true,
          canOpenCashSession: true,
          canCloseCashSession: true,
          canViewCashLogs: true,
          canReprintReceipt: true,
        },
      },
      employeeProfiles: {
        create: {
          tenantId: eligiovaldezTenant.id,
          employeeCode: 'RIV-CAJ-001',
          jobTitle: 'Cajero principal',
          hireDate: new Date('2025-05-15T00:00:00.000Z'),
          documentType: DocumentType.CEDULA,
          documentNumber: '00187654321',
          status: EmployeeStatus.ACTIVE,
        },
      },
    },
  });

  const orderTaker = await prisma.user.create({
    data: {
      email: 'almacen@eligiovaldez.local',
      name: 'Almacen EligioValdez',
      phone: '000-000-0003',
      passwordHash,
      memberships: {
        create: {
          tenantId: eligiovaldezTenant.id,
          role: Role.ORDER_TAKER,
          canTakeOrders: true,
        },
      },
      employeeProfiles: {
        create: {
          tenantId: eligiovaldezTenant.id,
          employeeCode: 'RIV-ORD-001',
          jobTitle: 'Ordenanza / toma de ordenes',
          hireDate: new Date('2025-06-01T00:00:00.000Z'),
          documentType: DocumentType.CEDULA,
          documentNumber: '00111223344',
          status: EmployeeStatus.ACTIVE,
        },
      },
    },
  });

  const categories = await Promise.all(
    [
      'Herramientas manuales',
      'Herramientas electricas',
      'Materiales de construccion',
      'Plomeria',
      'Electricidad',
      'Pinturas',
      'Tornilleria',
      'Seguridad industrial',
      'Jardineria',
      'Ferreteria general',
    ].map((name) =>
      prisma.productCategory.create({
        data: {
          tenantId: eligiovaldezTenant.id,
          name,
          description: `Categoria operativa de ${name.toLowerCase()}.`,
        },
      }),
    ),
  );

  const categoryByName = new Map(categories.map((category) => [category.name, category.id]));
  const productImageByCategory = new Map([
    ['Herramientas manuales', '/products/tools.svg'],
    ['Herramientas electricas', '/products/power-tools.svg'],
    ['Materiales de construccion', '/products/construction.svg'],
    ['Plomeria', '/products/plumbing.svg'],
    ['Electricidad', '/products/electrical.svg'],
    ['Pinturas', '/products/paint.svg'],
    ['Tornilleria', '/products/fasteners.svg'],
    ['Seguridad industrial', '/products/safety.svg'],
    ['Jardineria', '/products/garden.svg'],
    ['Ferreteria general', '/products/hardware.svg'],
  ]);

  const productRows = [
    {
      category: 'Materiales de construccion',
      name: 'Cemento gris 42.5 kg',
      sku: 'RIV-CEM-425',
      barcode: '7461123450012',
      barcodeType: BarcodeType.EAN13,
      brand: 'Cibao',
      unit: ProductUnit.BAG,
      price: 465,
      cost: 390,
      stock: 42,
      minStock: 15,
    },
    {
      category: 'Plomeria',
      name: 'Tuberia PVC 1/2 pulg x 19 pies',
      sku: 'RIV-PVC-012',
      barcode: '7461123450029',
      barcodeType: BarcodeType.EAN13,
      brand: 'PlastiDom',
      unit: ProductUnit.UNIT,
      price: 95,
      cost: 62,
      stock: 8,
      minStock: 12,
    },
    {
      category: 'Electricidad',
      name: 'Cable THHN #12 rojo metro',
      sku: 'RIV-CBL-12R',
      barcode: 'QV-RIV-000003',
      barcodeType: BarcodeType.INTERNAL_CODE128,
      generatedBarcode: true,
      brand: 'EletroMax',
      unit: ProductUnit.METER,
      price: 38,
      cost: 24,
      stock: 260,
      minStock: 80,
    },
    {
      category: 'Pinturas',
      name: 'Pintura acrilica blanca galon',
      sku: 'RIV-PNT-BLA-G',
      barcode: '7461123450043',
      barcodeType: BarcodeType.EAN13,
      brand: 'Tropical',
      unit: ProductUnit.GALLON,
      price: 890,
      cost: 690,
      stock: 17,
      minStock: 10,
    },
    {
      category: 'Herramientas manuales',
      name: 'Martillo carpintero 16 oz',
      sku: 'RIV-HER-MAR16',
      barcode: '7461123450050',
      barcodeType: BarcodeType.EAN13,
      brand: 'Truper',
      unit: ProductUnit.UNIT,
      price: 420,
      cost: 280,
      stock: 22,
      minStock: 6,
    },
    {
      category: 'Herramientas electricas',
      name: 'Taladro percutor 1/2 pulg 650W',
      sku: 'RIV-TAL-650',
      barcode: 'QV-RIV-000006',
      barcodeType: BarcodeType.INTERNAL_CODE128,
      generatedBarcode: true,
      brand: 'Bosch',
      unit: ProductUnit.UNIT,
      price: 3850,
      cost: 3050,
      stock: 5,
      minStock: 3,
    },
    {
      category: 'Tornilleria',
      name: 'Tornillo drywall 1 pulg libra',
      sku: 'RIV-TOR-DW1',
      barcode: 'QV-RIV-000007',
      barcodeType: BarcodeType.INTERNAL_CODE128,
      generatedBarcode: true,
      brand: 'EligioValdez',
      unit: ProductUnit.POUND,
      price: 145,
      cost: 92,
      stock: 11,
      minStock: 15,
    },
    {
      category: 'Seguridad industrial',
      name: 'Guantes nitrilo trabajo pesado',
      sku: 'RIV-SEG-GUA-N',
      barcode: '7461123450081',
      barcodeType: BarcodeType.EAN13,
      brand: 'SafePro',
      unit: ProductUnit.PACK,
      price: 310,
      cost: 205,
      stock: 34,
      minStock: 12,
    },
    {
      category: 'Jardineria',
      name: 'Manguera reforzada 1/2 pulg 50 pies',
      sku: 'RIV-JAR-MAN50',
      barcode: '7461123450098',
      barcodeType: BarcodeType.EAN13,
      brand: 'GardenPro',
      unit: ProductUnit.ROLL,
      price: 1150,
      cost: 860,
      stock: 9,
      minStock: 5,
    },
    {
      category: 'Ferreteria general',
      name: 'Silicon transparente 10 oz',
      sku: 'RIV-SIL-TRA10',
      barcode: '7461123450104',
      barcodeType: BarcodeType.EAN13,
      brand: 'Pegaflex',
      unit: ProductUnit.UNIT,
      price: 260,
      cost: 170,
      stock: 31,
      minStock: 10,
    },
    {
      category: 'Electricidad',
      name: 'Breaker 20A 1 polo',
      sku: 'RIV-BRK-20A1',
      barcode: '7461123450111',
      barcodeType: BarcodeType.EAN13,
      brand: 'Square D',
      unit: ProductUnit.UNIT,
      price: 395,
      cost: 250,
      stock: 13,
      minStock: 8,
    },
    {
      category: 'Plomeria',
      name: 'Llave angular 1/2 pulg cromada',
      sku: 'RIV-LLA-ANG12',
      barcode: 'QV-RIV-000012',
      barcodeType: BarcodeType.INTERNAL_CODE128,
      generatedBarcode: true,
      brand: 'Helvex',
      unit: ProductUnit.UNIT,
      price: 285,
      cost: 185,
      stock: 19,
      minStock: 8,
    },
    {
      category: 'Materiales de construccion',
      name: 'Varilla 3/8 pulg x 20 pies',
      sku: 'RIV-VAR-38',
      barcode: 'QV-RIV-000013',
      barcodeType: BarcodeType.INTERNAL_CODE128,
      generatedBarcode: true,
      brand: 'Metaldom',
      unit: ProductUnit.UNIT,
      price: 365,
      cost: 285,
      stock: 72,
      minStock: 25,
    },
    {
      category: 'Pinturas',
      name: 'Brocha profesional 3 pulg',
      sku: 'RIV-BRO-3PRO',
      barcode: '7461123450142',
      barcodeType: BarcodeType.EAN13,
      brand: 'Atlas',
      unit: ProductUnit.UNIT,
      price: 185,
      cost: 118,
      stock: 44,
      minStock: 15,
    },
    {
      category: 'Herramientas manuales',
      name: 'Cinta metrica 5 metros',
      sku: 'RIV-CIN-5M',
      barcode: '7461123450159',
      barcodeType: BarcodeType.EAN13,
      brand: 'Stanley',
      unit: ProductUnit.UNIT,
      price: 235,
      cost: 155,
      stock: 4,
      minStock: 10,
    },
    {
      category: 'Seguridad industrial',
      name: 'Casco seguridad blanco',
      sku: 'RIV-CAS-BLA',
      barcode: '7461123450166',
      barcodeType: BarcodeType.EAN13,
      brand: 'SafePro',
      unit: ProductUnit.UNIT,
      price: 360,
      cost: 230,
      stock: 16,
      minStock: 8,
    },
    {
      category: 'Herramientas electricas',
      name: 'Disco corte metal 4 1/2 pulg',
      sku: 'RIV-DIS-MET45',
      barcode: '7461123450173',
      barcodeType: BarcodeType.EAN13,
      brand: 'Norton',
      unit: ProductUnit.UNIT,
      price: 75,
      cost: 42,
      stock: 90,
      minStock: 30,
    },
    {
      category: 'Ferreteria general',
      name: 'Cerradura pomo dormitorio',
      sku: 'RIV-CER-DOR',
      barcode: 'QV-RIV-000018',
      barcodeType: BarcodeType.INTERNAL_CODE128,
      generatedBarcode: true,
      brand: 'Yale',
      unit: ProductUnit.UNIT,
      price: 820,
      cost: 580,
      stock: 7,
      minStock: 6,
    },
  ];

  const products = await Promise.all(
    productRows.map((row) =>
      prisma.product.create({
        data: {
          tenantId: eligiovaldezTenant.id,
          categoryId: categoryByName.get(row.category),
          name: row.name,
          sku: row.sku,
          barcode: row.barcode,
          barcodeType: row.barcodeType,
          generatedBarcode: row.generatedBarcode ?? false,
          barcodeCreatedById: row.generatedBarcode ? admin.id : null,
          description: `${row.name} para ventas POS e inventario de EligioValdez Comercial.`,
          imageUrl: productImageByCategory.get(row.category),
          brand: row.brand,
          unit: row.unit,
          price: money(row.price),
          salePrice: money(row.price),
          cost: money(row.cost),
          margin: money(((row.price - row.cost) / row.price).toFixed(4)),
          taxCategory: TaxCategory.ITBIS_18,
          taxRate: itbisRate,
          trackInventory: true,
          stock: row.stock,
          minStock: row.minStock,
          status: ProductStatus.ACTIVE,
        },
      }),
    ),
  );

  await prisma.inventoryMovement.createMany({
    data: products.map((product) => ({
      tenantId: eligiovaldezTenant.id,
      productId: product.id,
      type: InventoryMovementType.INITIAL_STOCK,
      quantity: product.stock,
      previousStock: 0,
      newStock: product.stock,
      unitCost: product.cost,
      reason: 'Inventario inicial EligioValdez',
      reference: 'SEED-ELIGIOVALDEZ-INITIAL',
      createdById: admin.id,
      createdAt: new Date('2026-06-01T13:00:00.000Z'),
    })),
  });

  const customers = await Promise.all([
    prisma.customer.create({
      data: {
        tenantId: eligiovaldezTenant.id,
        name: 'Constructora Duarte SRL',
        documentType: DocumentType.RNC,
        documentNumber: '131123456',
        email: 'compras@constructoraduarte.local',
        phone: '809-555-0191',
        address: 'Av. Independencia 45, Santo Domingo',
      },
    }),
    prisma.customer.create({
      data: {
        tenantId: eligiovaldezTenant.id,
        name: 'Servicios Electricos del Norte',
        documentType: DocumentType.RNC,
        documentNumber: '131654321',
        email: 'admin@electricosnorte.local',
        phone: '829-555-0102',
        address: 'Calle El Sol 22, Santiago',
      },
    }),
    prisma.customer.create({
      data: {
        tenantId: eligiovaldezTenant.id,
        name: 'Cliente Consumidor Final',
        documentType: DocumentType.CONSUMER_FINAL,
        status: CustomerStatus.ACTIVE,
      },
    }),
  ]);

  const cashRegister = await prisma.cashRegister.create({
    data: {
      tenantId: eligiovaldezTenant.id,
      name: 'Caja Principal',
      location: 'Mostrador EligioValdez',
    },
  });

  const cashSession = await prisma.cashSession.create({
    data: {
      tenantId: eligiovaldezTenant.id,
      cashRegisterId: cashRegister.id,
      openedById: cashier.id,
      status: CashSessionStatus.OPEN,
      openingAmount: money(5000),
      openedAt: new Date('2026-06-17T12:00:00.000Z'),
    },
  });

  await prisma.cashMovement.create({
    data: {
      tenantId: eligiovaldezTenant.id,
      cashSessionId: cashSession.id,
      userId: cashier.id,
      type: CashMovementType.OPENING,
      amount: money(5000),
      method: PaymentMethod.CASH,
      reason: 'Apertura de caja',
      reference: 'CAJA-RIV-001',
      createdAt: new Date('2026-06-17T12:00:00.000Z'),
    },
  });

  const seedB02AuthorizationNumber = 'SEED-ONLY-B02-0001';
  const seedB01AuthorizationNumber = 'SEED-ONLY-B01-0001';
  const seedB01ValidUntil = new Date('2026-12-31T00:00:00.000Z');
  const fiscalIssuerSnapshot = {
    rnc: eligiovaldezTenant.rnc,
    legalName: eligiovaldezTenant.legalName,
    commercialName: eligiovaldezTenant.commercialName,
    address: eligiovaldezTenant.address,
    phone: eligiovaldezTenant.phone,
    email: eligiovaldezTenant.email,
    logoUrl: '/logo.png',
    pointOfSale: cashRegister.name,
    pointOfSaleLocation: cashRegister.location,
  };

  const [consumerSequence, fiscalCreditSequence] = await Promise.all([
    prisma.fiscalSequence.create({
      data: {
        tenantId: eligiovaldezTenant.id,
        documentType: InvoiceDocumentType.CONSUMER_02,
        prefix: 'B02',
        startNumber: 1,
        endNumber: 100,
        nextNumber: 3,
        authorizationNumber: seedB02AuthorizationNumber,
        issuerTaxId: eligiovaldezTenant.rnc,
        validUntil: null,
        status: FiscalSequenceStatus.ACTIVE,
      },
    }),
    prisma.fiscalSequence.create({
      data: {
        tenantId: eligiovaldezTenant.id,
        documentType: InvoiceDocumentType.FISCAL_CREDIT_01,
        prefix: 'B01',
        startNumber: 1,
        endNumber: 100,
        nextNumber: 2,
        authorizationNumber: seedB01AuthorizationNumber,
        issuerTaxId: eligiovaldezTenant.rnc,
        validUntil: seedB01ValidUntil,
        status: FiscalSequenceStatus.ACTIVE,
      },
    }),
  ]);

  const bySku = new Map(products.map((product) => [product.sku, product]));
  const productsById = new Map(products.map((product) => [product.id, product]));
  const now = new Date('2026-06-17T15:30:00.000Z');
  const yesterday = new Date('2026-06-16T16:45:00.000Z');
  const lastWeek = new Date('2026-06-10T14:20:00.000Z');

  const pendingOrderAmounts = getInvoiceAmounts([
    {
      productId: bySku.get('RIV-CIN-5M')!.id,
      sku: 'RIV-CIN-5M',
      barcode: bySku.get('RIV-CIN-5M')!.barcode,
      description: bySku.get('RIV-CIN-5M')!.name,
      quantity: 1,
      unitPrice: 235,
    },
    {
      productId: bySku.get('RIV-DIS-MET45')!.id,
      sku: 'RIV-DIS-MET45',
      barcode: bySku.get('RIV-DIS-MET45')!.barcode,
      description: bySku.get('RIV-DIS-MET45')!.name,
      quantity: 3,
      unitPrice: 75,
    },
  ]);

  const pendingSalesOrder = await prisma.salesOrder.create({
    data: {
      tenantId: eligiovaldezTenant.id,
      customerId: customers[2].id,
      orderNumber: 'ORD-20260617-0001',
      status: SalesOrderStatus.SENT_TO_CASHIER,
      subtotal: pendingOrderAmounts.subtotal,
      taxTotal: pendingOrderAmounts.taxTotal,
      total: pendingOrderAmounts.total,
      notes: 'Orden demo pendiente para recibir en caja.',
      createdById: orderTaker.id,
      sentToCashierAt: new Date('2026-06-17T14:45:00.000Z'),
      items: {
        create: pendingOrderAmounts.lines.map((line) => ({
          productId: line.productId,
          sku: line.sku,
          barcode: line.barcode,
          description: line.description,
          quantity: line.quantity,
          unit: bySku.get(line.sku!)?.unit ?? ProductUnit.UNIT,
          reservedQuantity: line.quantity,
          unitPrice: line.unitPrice,
          taxCategory: bySku.get(line.sku!)?.taxCategory ?? TaxCategory.ITBIS_18,
          taxRate: line.taxRate,
          taxTotal: line.taxTotal,
          subtotal: line.subtotal,
          total: line.total,
        })),
      },
    },
  });

  for (const line of pendingOrderAmounts.lines) {
    await prisma.product.update({
      where: { id: line.productId },
      data: {
        reservedStock: {
          increment: line.quantity,
        },
      },
    });
  }

  const paidAmounts = getInvoiceAmounts([
    {
      productId: bySku.get('RIV-CEM-425')!.id,
      sku: 'RIV-CEM-425',
      barcode: bySku.get('RIV-CEM-425')!.barcode,
      description: bySku.get('RIV-CEM-425')!.name,
      quantity: 4,
      unitPrice: 465,
    },
    {
      productId: bySku.get('RIV-TOR-DW1')!.id,
      sku: 'RIV-TOR-DW1',
      barcode: bySku.get('RIV-TOR-DW1')!.barcode,
      description: bySku.get('RIV-TOR-DW1')!.name,
      quantity: 2,
      unitPrice: 145,
    },
  ]);

  const paidInvoice = await prisma.invoice.create({
    data: {
      tenantId: eligiovaldezTenant.id,
      customerId: customers[2].id,
      documentType: InvoiceDocumentType.CONSUMER_02,
      invoiceNumber: 'RIV-B0200000001',
      ncf: 'B0200000001',
      eNcf: null,
      fiscalSequenceId: consumerSequence.id,
      fiscalAuthorizationNumber: seedB02AuthorizationNumber,
      fiscalValidUntil: null,
      fiscalIssuerSnapshot,
      fiscalCustomerSnapshot: Prisma.JsonNull,
      status: InvoiceStatus.PAID,
      fiscalStatus: InvoiceFiscalStatus.LOCAL_ISSUED,
      subtotal: paidAmounts.subtotal,
      taxTotal: paidAmounts.taxTotal,
      discountTotal: zero,
      total: paidAmounts.total,
      paidAmount: paidAmounts.total,
      balance: zero,
      paymentMethod: PaymentMethod.CASH,
      issuedById: cashier.id,
      cashSessionId: cashSession.id,
      issuedAt: now,
      dueDate: now,
      items: {
        create: paidAmounts.lines.map((line) => ({
          productId: line.productId,
          sku: line.sku,
          barcode: line.barcode,
          description: line.description,
          quantity: line.quantity,
          unit: productsById.get(line.productId)?.unit ?? ProductUnit.UNIT,
          unitPrice: line.unitPrice,
          taxCategory: productsById.get(line.productId)?.taxCategory ?? TaxCategory.ITBIS_18,
          taxRate: line.taxRate,
          taxTotal: line.taxTotal,
          discountTotal: zero,
          subtotal: line.subtotal,
          total: line.total,
        })),
      },
    },
  });

  await prisma.payment.create({
    data: {
      tenantId: eligiovaldezTenant.id,
      invoiceId: paidInvoice.id,
      method: PaymentMethod.CASH,
      amount: paidAmounts.total,
      status: PaymentStatus.COMPLETED,
      userId: cashier.id,
      cashSessionId: cashSession.id,
      paidAt: now,
    },
  });

  await prisma.cashMovement.create({
    data: {
      tenantId: eligiovaldezTenant.id,
      cashSessionId: cashSession.id,
      userId: cashier.id,
      type: CashMovementType.SALE_PAYMENT,
      amount: paidAmounts.total,
      method: PaymentMethod.CASH,
      reason: 'Venta POS',
      reference: paidInvoice.invoiceNumber,
      invoiceId: paidInvoice.id,
      createdAt: now,
    },
  });

  const pendingAmounts = getInvoiceAmounts([
    {
      productId: bySku.get('RIV-TAL-650')!.id,
      sku: 'RIV-TAL-650',
      barcode: bySku.get('RIV-TAL-650')!.barcode,
      description: bySku.get('RIV-TAL-650')!.name,
      quantity: 1,
      unitPrice: 3850,
    },
    {
      productId: bySku.get('RIV-BRK-20A1')!.id,
      sku: 'RIV-BRK-20A1',
      barcode: bySku.get('RIV-BRK-20A1')!.barcode,
      description: bySku.get('RIV-BRK-20A1')!.name,
      quantity: 3,
      unitPrice: 395,
    },
  ]);

  await prisma.invoice.create({
    data: {
      tenantId: eligiovaldezTenant.id,
      customerId: customers[1].id,
      documentType: InvoiceDocumentType.FISCAL_CREDIT_01,
      invoiceNumber: 'RIV-B0100000001',
      ncf: 'B0100000001',
      eNcf: null,
      fiscalSequenceId: fiscalCreditSequence.id,
      fiscalAuthorizationNumber: seedB01AuthorizationNumber,
      fiscalValidUntil: seedB01ValidUntil,
      fiscalIssuerSnapshot,
      fiscalCustomerSnapshot: {
        id: customers[1].id,
        name: customers[1].name,
        documentType: customers[1].documentType,
        documentNumber: customers[1].documentNumber,
      },
      status: InvoiceStatus.ISSUED,
      fiscalStatus: InvoiceFiscalStatus.LOCAL_ISSUED,
      subtotal: pendingAmounts.subtotal,
      taxTotal: pendingAmounts.taxTotal,
      discountTotal: zero,
      total: pendingAmounts.total,
      paidAmount: zero,
      balance: pendingAmounts.total,
      paymentMethod: PaymentMethod.TRANSFER,
      issuedById: admin.id,
      issuedAt: yesterday,
      dueDate: new Date('2026-06-30T00:00:00.000Z'),
      items: {
        create: pendingAmounts.lines.map((line) => ({
          productId: line.productId,
          sku: line.sku,
          barcode: line.barcode,
          description: line.description,
          quantity: line.quantity,
          unit: productsById.get(line.productId)?.unit ?? ProductUnit.UNIT,
          unitPrice: line.unitPrice,
          taxCategory: productsById.get(line.productId)?.taxCategory ?? TaxCategory.ITBIS_18,
          taxRate: line.taxRate,
          taxTotal: line.taxTotal,
          discountTotal: zero,
          subtotal: line.subtotal,
          total: line.total,
        })),
      },
    },
  });

  const cancelledAmounts = getInvoiceAmounts([
    {
      productId: bySku.get('RIV-PVC-012')!.id,
      sku: 'RIV-PVC-012',
      barcode: bySku.get('RIV-PVC-012')!.barcode,
      description: bySku.get('RIV-PVC-012')!.name,
      quantity: 6,
      unitPrice: 95,
    },
  ]);

  await prisma.invoice.create({
    data: {
      tenantId: eligiovaldezTenant.id,
      customerId: customers[0].id,
      documentType: InvoiceDocumentType.CONSUMER_02,
      invoiceNumber: 'RIV-B0200000002',
      ncf: 'B0200000002',
      eNcf: null,
      fiscalSequenceId: consumerSequence.id,
      fiscalAuthorizationNumber: seedB02AuthorizationNumber,
      fiscalValidUntil: null,
      fiscalIssuerSnapshot,
      fiscalCustomerSnapshot: Prisma.JsonNull,
      status: InvoiceStatus.CANCELLED,
      fiscalStatus: InvoiceFiscalStatus.CANCELLED,
      subtotal: cancelledAmounts.subtotal,
      taxTotal: cancelledAmounts.taxTotal,
      discountTotal: zero,
      total: cancelledAmounts.total,
      paidAmount: zero,
      balance: zero,
      issuedById: admin.id,
      issuedAt: lastWeek,
      dueDate: lastWeek,
      items: {
        create: cancelledAmounts.lines.map((line) => ({
          productId: line.productId,
          sku: line.sku,
          barcode: line.barcode,
          description: line.description,
          quantity: line.quantity,
          unit: productsById.get(line.productId)?.unit ?? ProductUnit.UNIT,
          unitPrice: line.unitPrice,
          taxCategory: productsById.get(line.productId)?.taxCategory ?? TaxCategory.ITBIS_18,
          taxRate: line.taxRate,
          taxTotal: line.taxTotal,
          discountTotal: zero,
          subtotal: line.subtotal,
          total: line.total,
        })),
      },
    },
  });

  await prisma.employeeActivityLog.createMany({
    data: [
      {
        tenantId: eligiovaldezTenant.id,
        userId: orderTaker.id,
        action: EmployeeLogAction.CREATE_SALES_ORDER,
        entity: 'SalesOrder',
        entityId: pendingSalesOrder.id,
        amount: pendingOrderAmounts.total,
        metadata: { orderNumber: pendingSalesOrder.orderNumber, source: 'development-seed' },
        createdAt: new Date('2026-06-17T14:45:00.000Z'),
      },
      {
        tenantId: eligiovaldezTenant.id,
        userId: orderTaker.id,
        action: EmployeeLogAction.SEND_SALES_ORDER_TO_CASHIER,
        entity: 'SalesOrder',
        entityId: pendingSalesOrder.id,
        amount: pendingOrderAmounts.total,
        metadata: { orderNumber: pendingSalesOrder.orderNumber, source: 'development-seed' },
        createdAt: new Date('2026-06-17T14:46:00.000Z'),
      },
      {
        tenantId: eligiovaldezTenant.id,
        userId: cashier.id,
        cashSessionId: cashSession.id,
        action: EmployeeLogAction.OPEN_CASH_SESSION,
        entity: 'CashSession',
        entityId: cashSession.id,
        amount: money(5000),
        metadata: { register: cashRegister.name },
        createdAt: new Date('2026-06-17T12:00:00.000Z'),
      },
      {
        tenantId: eligiovaldezTenant.id,
        userId: cashier.id,
        cashSessionId: cashSession.id,
        action: EmployeeLogAction.CREATE_SALE,
        entity: 'Invoice',
        entityId: paidInvoice.id,
        invoiceId: paidInvoice.id,
        amount: paidAmounts.total,
        metadata: { invoiceNumber: paidInvoice.invoiceNumber, source: 'POS' },
        createdAt: now,
      },
      {
        tenantId: eligiovaldezTenant.id,
        userId: cashier.id,
        cashSessionId: cashSession.id,
        action: EmployeeLogAction.ISSUE_INVOICE,
        entity: 'Invoice',
        entityId: paidInvoice.id,
        invoiceId: paidInvoice.id,
        amount: paidAmounts.total,
        metadata: { ncf: paidInvoice.ncf },
        createdAt: now,
      },
      {
        tenantId: eligiovaldezTenant.id,
        userId: admin.id,
        action: EmployeeLogAction.ADD_PRODUCT,
        entity: 'Product',
        entityId: bySku.get('RIV-TAL-650')!.id,
        metadata: { sku: 'RIV-TAL-650', generatedBarcode: true },
        createdAt: new Date('2026-06-14T13:30:00.000Z'),
      },
    ],
  });

  await prisma.importBatch.create({
    data: {
      tenantId: eligiovaldezTenant.id,
      type: ImportType.PRODUCTS,
      filename: 'plantilla-productos-eligiovaldez.xlsx',
      status: ImportStatus.DRAFT,
      totalRows: 0,
      createdById: admin.id,
    },
  });

  await prisma.auditLog.createMany({
    data: [
      {
        tenantId: eligiovaldezTenant.id,
        userId: admin.id,
        action: 'ELIGIOVALDEZ_SEED_CREATED',
        entity: 'Tenant',
        entityId: eligiovaldezTenant.id,
        metadata: {
          source: 'development-seed',
          tenant: 'EligioValdez Comercial',
          poweredBy: 'CoreStack',
        },
      },
      {
        tenantId: coreStackTenant.id,
        userId: superAdmin.id,
        action: 'CORESTACK_CORE_SEED_CREATED',
        entity: 'Tenant',
        entityId: coreStackTenant.id,
        metadata: {
          source: 'development-seed',
          note: 'El tenant de plataforma es interno; EligioValdez Comercial es el tenant operativo de demo.',
        },
      },
    ],
  });

  console.log(`Seed completed for tenant ${eligiovaldezTenant.name} (${eligiovaldezTenant.id})`);
  console.log(`EligioValdez admin login: admin@eligiovaldez.local / ${demoPassword}`);
  console.log(`EligioValdez cashier login: cajero@eligiovaldez.local / ${demoPassword}`);
  console.log(`EligioValdez almacen login: almacen@eligiovaldez.local / ${demoPassword}`);
  console.log(`Platform admin login: plataforma@eligiovaldez.local / ${demoPassword}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
