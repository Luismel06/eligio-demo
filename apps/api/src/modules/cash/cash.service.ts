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
  PaymentMethod,
  Prisma,
  Role,
  SalesOrderStatus,
} from '@qorvex/database';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { PrismaService } from '../../prisma/prisma.service';
import { CloseCashSessionDto } from './dto/close-cash-session.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { OpenCashSessionDto } from './dto/open-cash-session.dto';

@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  findRegisters(tenantId: string) {
    return this.prisma.cashRegister.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findSessions(tenantId: string, user: AuthenticatedUser) {
    this.requireCashLogAccess(tenantId, user);

    return this.prisma.cashSession.findMany({
      where: { tenantId },
      include: this.cashSessionReportInclude(),
      orderBy: { openedAt: 'desc' },
      take: 100,
    });
  }

  findCurrentSession(tenantId: string, user: AuthenticatedUser) {
    return this.prisma.cashSession.findFirst({
      where: {
        tenantId,
        openedById: user.id,
        status: CashSessionStatus.OPEN,
      },
      include: {
        cashRegister: true,
        openedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { openedAt: 'desc' },
    });
  }

  findMovements(tenantId: string, user: AuthenticatedUser) {
    this.requireCashLogAccess(tenantId, user);

    return this.prisma.cashMovement.findMany({
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

  async openSession(tenantId: string, user: AuthenticatedUser, dto: OpenCashSessionDto) {
    this.requireOpenCashSessionPermission(tenantId, user);

    if (dto.openingAmount <= 0) {
      throw new BadRequestException('Opening amount must be greater than zero.');
    }

    const register = await this.prisma.cashRegister.findFirst({
      where: {
        id: dto.cashRegisterId,
        tenantId,
      },
    });

    if (!register) {
      throw new NotFoundException('Cash register not found for tenant.');
    }

    const openSession = await this.prisma.cashSession.findFirst({
      where: {
        tenantId,
        status: CashSessionStatus.OPEN,
        cashRegisterId: dto.cashRegisterId,
      },
    });

    if (openSession) {
      throw new BadRequestException('This cash register already has an open session.');
    }

    return this.prisma.$transaction(async (tx) => {
      const session = await tx.cashSession.create({
        data: {
          tenantId,
          cashRegisterId: dto.cashRegisterId,
          openedById: user.id,
          openingAmount: new Prisma.Decimal(dto.openingAmount),
        },
        include: {
          cashRegister: true,
          openedBy: { select: { id: true, name: true, email: true } },
        },
      });

      await tx.cashMovement.create({
        data: {
          tenantId,
          cashSessionId: session.id,
          userId: user.id,
          type: CashMovementType.OPENING,
          amount: new Prisma.Decimal(dto.openingAmount),
          method: PaymentMethod.CASH,
          reason: 'Apertura de caja',
          reference: session.id,
        },
      });

      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId: user.id,
          cashSessionId: session.id,
          action: EmployeeLogAction.OPEN_CASH_SESSION,
          entity: 'CashSession',
          entityId: session.id,
          amount: new Prisma.Decimal(dto.openingAmount),
          metadata: { register: register.name },
        },
      });

      return session;
    });
  }

  async closeSession(
    tenantId: string,
    user: AuthenticatedUser,
    cashSessionId: string,
    dto: CloseCashSessionDto,
  ) {
    this.requirePermission(tenantId, user, 'canCloseCashSession');

    const session = await this.prisma.cashSession.findFirst({
      where: {
        id: cashSessionId,
        tenantId,
        status: CashSessionStatus.OPEN,
      },
    });

    if (!session) {
      throw new NotFoundException('Open cash session not found for tenant.');
    }

    const claimedOrders = await this.prisma.salesOrder.count({
      where: {
        tenantId,
        claimedCashSessionId: cashSessionId,
        status: SalesOrderStatus.IN_CASHIER,
      },
    });

    if (claimedOrders > 0) {
      throw new BadRequestException(
        'Close pending claimed sales orders before closing cash session.',
      );
    }

    const movements = await this.prisma.cashMovement.findMany({
      where: {
        tenantId,
        cashSessionId,
      },
      select: {
        type: true,
        amount: true,
        method: true,
      },
    });
    const negativeMovementTypes: CashMovementType[] = [
      CashMovementType.CASH_OUT,
      CashMovementType.REFUND,
      CashMovementType.SUPPLIER_PAYMENT,
    ];
    const expectedAmount = movements
      .reduce((sum, movement) => {
        if (movement.type === CashMovementType.CLOSING) {
          return sum;
        }

        if (movement.method && movement.method !== PaymentMethod.CASH) {
          return sum;
        }

        if (negativeMovementTypes.includes(movement.type)) {
          return sum.sub(movement.amount);
        }

        return sum.add(movement.amount);
      }, new Prisma.Decimal(0))
      .toDecimalPlaces(2);
    const closingAmount = new Prisma.Decimal(dto.closingAmount);
    const difference = closingAmount.sub(expectedAmount).toDecimalPlaces(2);

    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.cashSession.update({
        where: { id: cashSessionId },
        data: {
          status: CashSessionStatus.CLOSED,
          closedById: user.id,
          closingAmount,
          expectedAmount,
          difference,
          closedAt: new Date(),
        },
      });

      await tx.cashMovement.create({
        data: {
          tenantId,
          cashSessionId,
          userId: user.id,
          type: CashMovementType.CLOSING,
          amount: closingAmount,
          method: PaymentMethod.CASH,
          reason: dto.notes ?? 'Cierre de caja',
          reference: cashSessionId,
        },
      });

      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId: user.id,
          cashSessionId,
          action: EmployeeLogAction.CLOSE_CASH_SESSION,
          entity: 'CashSession',
          entityId: cashSessionId,
          amount: closingAmount,
          metadata: {
            expectedAmount: expectedAmount.toString(),
            difference: difference.toString(),
          },
        },
      });

      return tx.cashSession.findUniqueOrThrow({
        where: { id: closed.id },
        include: this.cashSessionReportInclude(),
      });
    });
  }

  async createMovement(tenantId: string, user: AuthenticatedUser, dto: CreateCashMovementDto) {
    const membership = user.memberships.find((candidate) => candidate.tenantId === tenantId);

    if (membership?.role === Role.ACCOUNTANT) {
      throw new ForbiddenException('Accountants have read-only access to cash operations.');
    }

    this.requirePermission(tenantId, user, 'canViewCashLogs');

    const session = await this.prisma.cashSession.findFirst({
      where: {
        id: dto.cashSessionId,
        tenantId,
        status: CashSessionStatus.OPEN,
      },
    });

    if (!session) {
      throw new NotFoundException('Open cash session not found for tenant.');
    }

    const manualMovementTypes: CashMovementType[] = [
      CashMovementType.CASH_IN,
      CashMovementType.CASH_OUT,
      CashMovementType.ADJUSTMENT,
    ];

    if (!manualMovementTypes.includes(dto.type)) {
      throw new BadRequestException(
        'Manual cash movements must be cash in, cash out, or adjustment.',
      );
    }

    const movement = await this.prisma.cashMovement.create({
      data: {
        tenantId,
        cashSessionId: dto.cashSessionId,
        userId: user.id,
        type: dto.type,
        amount: new Prisma.Decimal(dto.amount),
        method: dto.method ?? PaymentMethod.CASH,
        reason: dto.reason,
        reference: dto.reference,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    await this.prisma.employeeActivityLog.create({
      data: {
        tenantId,
        userId: user.id,
        cashSessionId: dto.cashSessionId,
        action:
          dto.type === CashMovementType.CASH_OUT
            ? EmployeeLogAction.CASH_OUT
            : EmployeeLogAction.CASH_IN,
        entity: 'CashMovement',
        entityId: movement.id,
        amount: movement.amount,
        metadata: {
          type: dto.type,
          reason: dto.reason,
          reference: dto.reference,
        },
      },
    });

    return movement;
  }

  private requirePermission(
    tenantId: string,
    user: AuthenticatedUser,
    permission: 'canOpenCashSession' | 'canCloseCashSession' | 'canViewCashLogs',
  ) {
    const membership = user.memberships.find((candidate) => candidate.tenantId === tenantId);

    if (
      !membership ||
      (!membership[permission] &&
        !([Role.ADMIN, Role.SUPER_ADMIN] as Role[]).includes(membership.role))
    ) {
      throw new ForbiddenException('Employee does not have permission for this cash operation.');
    }
  }

  private requireOpenCashSessionPermission(tenantId: string, user: AuthenticatedUser) {
    const membership = user.memberships.find((candidate) => candidate.tenantId === tenantId);
    const adminRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];

    if (!membership || !membership.canOpenCashSession || adminRoles.includes(membership.role)) {
      throw new ForbiddenException('Admins cannot open cash sessions.');
    }
  }

  private requireCashLogAccess(tenantId: string, user: AuthenticatedUser) {
    const membership = user.memberships.find((candidate) => candidate.tenantId === tenantId);
    const adminRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];

    if (
      !membership ||
      (!adminRoles.includes(membership.role) &&
        membership.role !== Role.ACCOUNTANT &&
        !(membership.canViewCashLogs && membership.role !== Role.CASHIER))
    ) {
      throw new ForbiddenException('Employee does not have permission to view cash logs.');
    }
  }

  private cashSessionReportInclude() {
    return {
      cashRegister: true,
      openedBy: { select: { id: true, name: true, email: true } },
      closedBy: { select: { id: true, name: true, email: true } },
      movements: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          invoice: { select: { id: true, invoiceNumber: true, total: true } },
        },
        orderBy: { createdAt: 'asc' as const },
      },
      invoices: {
        include: {
          customer: true,
          issuedBy: { select: { id: true, name: true, email: true } },
          items: true,
          payments: {
            select: {
              id: true,
              method: true,
              amount: true,
              status: true,
              paidAt: true,
              createdAt: true,
            },
          },
          salesOrder: { select: { id: true, orderNumber: true, status: true } },
        },
        orderBy: { issuedAt: 'asc' as const },
      },
      claimedSalesOrders: {
        include: {
          customer: true,
          createdBy: { select: { id: true, name: true, email: true } },
          completedBy: { select: { id: true, name: true, email: true } },
          invoice: { select: { id: true, invoiceNumber: true, total: true } },
          items: true,
        },
        orderBy: { createdAt: 'asc' as const },
      },
    };
  }
}
