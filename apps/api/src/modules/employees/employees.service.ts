import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmployeeLogAction,
  EmployeeStatus,
  MembershipStatus,
  Role,
  UserStatus,
} from '@qorvex/database';
import * as bcrypt from 'bcryptjs';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';

const permissionKeys = [
  'canUsePos',
  'canOpenCashSession',
  'canCloseCashSession',
  'canApplyDiscount',
  'canCancelInvoice',
  'canVoidInvoice',
  'canAdjustInventory',
  'canManageProducts',
  'canManageEmployees',
  'canViewReports',
  'canManageFiscalSequences',
  'canViewCashLogs',
  'canReprintReceipt',
  'canTakeOrders',
] as const;
const maxTenantUsers = 5;
const tenantAssignableRoles: Role[] = [Role.ADMIN, Role.ACCOUNTANT, Role.CASHIER, Role.ORDER_TAKER];

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.employeeProfile.findMany({
      where: { tenantId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            memberships: {
              where: { tenantId },
              select: this.membershipSelect(),
            },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(tenantId: string, actor: AuthenticatedUser, dto: CreateEmployeeDto) {
    this.requireEmployeeManagement(tenantId, actor);
    this.ensureTenantRole(dto.role);
    await this.ensureTenantUserLimit(tenantId);

    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: true },
    });

    if (existing?.memberships.some((membership) => membership.tenantId === tenantId)) {
      throw new ConflictException('This user already belongs to this tenant.');
    }

    const passwordHash = await bcrypt.hash(dto.password ?? 'DemoPassword123!', 12);

    const employee = await this.prisma.$transaction(async (tx) => {
      const profileStatus = dto.status ?? EmployeeStatus.ACTIVE;

      const mapUserStatus = (status: EmployeeStatus | undefined) =>
        status === EmployeeStatus.BLOCKED
          ? UserStatus.BLOCKED
          : status === EmployeeStatus.INACTIVE || status === EmployeeStatus.TERMINATED
            ? UserStatus.INACTIVE
            : status === EmployeeStatus.ACTIVE
              ? UserStatus.ACTIVE
              : undefined;

      const mapMembershipStatus = (status: EmployeeStatus | undefined) =>
        status === EmployeeStatus.ACTIVE
          ? MembershipStatus.ACTIVE
          : status
            ? MembershipStatus.INACTIVE
            : undefined;

      const user =
        existing ??
        (await tx.user.create({
          data: {
            email,
            name: dto.name,
            phone: dto.phone,
            passwordHash,
            status: mapUserStatus(profileStatus) ?? UserStatus.ACTIVE,
          },
        }));

      if (existing) {
        await tx.user.update({
          where: { id: existing.id },
          data: {
            name: dto.name,
            phone: dto.phone,
            ...(dto.password ? { passwordHash } : {}),
            status: mapUserStatus(profileStatus) ?? UserStatus.ACTIVE,
          },
        });
      }

      const membership = await tx.membership.create({
        data: {
          tenantId,
          userId: user.id,
          role: dto.role,
          status: mapMembershipStatus(profileStatus) ?? MembershipStatus.ACTIVE,
          ...this.pickPermissions(dto, dto.role),
        },
      });

      const profile = await tx.employeeProfile.create({
        data: {
          tenantId,
          userId: user.id,
          employeeCode: dto.employeeCode,
          jobTitle: dto.jobTitle,
          hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
          documentType: dto.documentType,
          documentNumber: dto.documentNumber,
          address: dto.address,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          notes: dto.notes,
          status: profileStatus,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              status: true,
              memberships: {
                where: { tenantId },
                select: this.membershipSelect(),
              },
            },
          },
        },
      });

      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId: actor.id,
          action: EmployeeLogAction.UPDATE_PRODUCT,
          entity: 'EmployeeProfile',
          entityId: profile.id,
          metadata: {
            action: 'EMPLOYEE_CREATED',
            employeeUserId: user.id,
            role: dto.role,
            permissions: this.permissionSnapshot(membership),
          },
        },
      });

      return profile;
    });

    return employee;
  }

  async findOne(tenantId: string, id: string) {
    const employee = await this.prisma.employeeProfile.findFirst({
      where: { id, tenantId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            status: true,
            memberships: {
              where: { tenantId },
              select: this.membershipSelect(),
            },
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found for tenant.');
    }

    return employee;
  }

  async update(tenantId: string, actor: AuthenticatedUser, id: string, dto: UpdateEmployeeDto) {
    this.requireEmployeeManagement(tenantId, actor);
    if (dto.role) {
      this.ensureTenantRole(dto.role);
    }

    const employee = await this.findOne(tenantId, id);
    const membership = employee.user.memberships[0];

    if (!membership) {
      throw new NotFoundException('Employee membership not found.');
    }

    if (dto.status && dto.status !== EmployeeStatus.ACTIVE) {
      await this.ensureAnotherActiveAdmin(tenantId, employee.user.id);
    }

    const nextMembershipStatus =
      dto.status === EmployeeStatus.ACTIVE
        ? MembershipStatus.ACTIVE
        : dto.status
          ? MembershipStatus.INACTIVE
          : membership.status;
    const nextRole = dto.role ?? membership.role;
    const currentlyCountsAsTenantUser =
      membership.status === MembershipStatus.ACTIVE &&
      tenantAssignableRoles.includes(membership.role);
    const willCountAsTenantUser =
      nextMembershipStatus === MembershipStatus.ACTIVE && tenantAssignableRoles.includes(nextRole);

    if (willCountAsTenantUser && !currentlyCountsAsTenantUser) {
      await this.ensureTenantUserLimit(tenantId, membership.id);
    }

    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 12) : undefined;

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: employee.userId },
        data: {
          email: dto.email?.toLowerCase().trim(),
          name: dto.name,
          phone: dto.phone,
          passwordHash,
          status:
            dto.status === EmployeeStatus.BLOCKED
              ? UserStatus.BLOCKED
              : dto.status === EmployeeStatus.INACTIVE || dto.status === EmployeeStatus.TERMINATED
                ? UserStatus.INACTIVE
                : dto.status === EmployeeStatus.ACTIVE
                  ? UserStatus.ACTIVE
                  : undefined,
        },
      });

      const updatedMembership = await tx.membership.update({
        where: { id: membership.id },
        data: {
          role: dto.role,
          status:
            dto.status === EmployeeStatus.ACTIVE
              ? MembershipStatus.ACTIVE
              : dto.status
                ? MembershipStatus.INACTIVE
                : undefined,
          ...this.pickPermissions(dto, dto.role ?? membership.role),
        },
        select: this.membershipSelect(),
      });

      const updated = await tx.employeeProfile.update({
        where: { id },
        data: {
          employeeCode: dto.employeeCode,
          jobTitle: dto.jobTitle,
          hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
          documentType: dto.documentType,
          documentNumber: dto.documentNumber,
          address: dto.address,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          notes: dto.notes,
          status: dto.status,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              status: true,
              memberships: {
                where: { tenantId },
                select: this.membershipSelect(),
              },
            },
          },
        },
      });

      await tx.employeeActivityLog.create({
        data: {
          tenantId,
          userId: actor.id,
          action: EmployeeLogAction.UPDATE_PRODUCT,
          entity: 'EmployeeProfile',
          entityId: id,
          metadata: {
            action: 'EMPLOYEE_UPDATED',
            fields: Object.keys(dto),
            previousRole: membership.role,
            newRole: updatedMembership.role,
            previousPermissions: this.permissionSnapshot(membership),
            newPermissions: this.permissionSnapshot(updatedMembership),
            changedPermissionKeys: this.changedPermissionKeys(membership, updatedMembership),
          },
        },
      });

      return updated;
    });
  }

  async activity(tenantId: string, employeeId: string) {
    const userId = await this.getEmployeeUserId(tenantId, employeeId);

    return this.prisma.employeeActivityLog.findMany({
      where: {
        tenantId,
        userId,
      },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, total: true } },
        cashSession: { include: { cashRegister: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async invoices(tenantId: string, employeeId: string) {
    const userId = await this.getEmployeeUserId(tenantId, employeeId);

    return this.prisma.invoice.findMany({
      where: {
        tenantId,
        issuedById: userId,
      },
      include: {
        customer: true,
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async cashMovements(tenantId: string, employeeId: string) {
    const userId = await this.getEmployeeUserId(tenantId, employeeId);

    return this.prisma.cashMovement.findMany({
      where: {
        tenantId,
        userId,
      },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, total: true } },
        cashSession: { include: { cashRegister: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  private requireEmployeeManagement(tenantId: string, actor: AuthenticatedUser) {
    const membership = actor.memberships.find((candidate) => candidate.tenantId === tenantId);
    const platformMembership = actor.memberships.find((candidate) =>
      ([Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN] as Role[]).includes(candidate.role),
    );

    if (platformMembership) {
      return;
    }

    if (!membership || !([Role.ADMIN] as Role[]).includes(membership.role)) {
      throw new ForbiddenException('Employee management permission is required.');
    }
  }

  private async getEmployeeUserId(tenantId: string, employeeId: string) {
    const employee = await this.prisma.employeeProfile.findFirst({
      where: {
        id: employeeId,
        tenantId,
      },
      select: { userId: true },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found for tenant.');
    }

    return employee.userId;
  }

  private ensureTenantRole(role: Role) {
    if (!tenantAssignableRoles.includes(role)) {
      throw new BadRequestException('This role cannot be assigned to a tenant employee.');
    }
  }

  private async ensureTenantUserLimit(tenantId: string, excludeMembershipId?: string) {
    const activeTenantUsers = await this.prisma.membership.count({
      where: {
        tenantId,
        ...(excludeMembershipId ? { id: { not: excludeMembershipId } } : {}),
        status: MembershipStatus.ACTIVE,
        role: { in: tenantAssignableRoles },
      },
    });

    if (activeTenantUsers >= maxTenantUsers) {
      throw new BadRequestException('Tenant user limit reached.');
    }
  }

  private async ensureAnotherActiveAdmin(tenantId: string, userId: string) {
    const adminCount = await this.prisma.membership.count({
      where: {
        tenantId,
        role: Role.ADMIN,
        status: MembershipStatus.ACTIVE,
        userId: { not: userId },
      },
    });

    if (adminCount < 1) {
      throw new BadRequestException('At least one active admin must remain for the tenant.');
    }
  }

  private pickPermissions(dto: CreateEmployeeDto | UpdateEmployeeDto, role?: Role) {
    const data = permissionKeys.reduce<Partial<Record<(typeof permissionKeys)[number], boolean>>>(
      (permissions, key) => {
        if (dto[key] !== undefined) {
          permissions[key] = dto[key];
        }

        return permissions;
      },
      {},
    );

    if (role === Role.ORDER_TAKER) {
      return {
        ...this.blankPermissions(),
        canTakeOrders: true,
      };
    }

    if (role === Role.ACCOUNTANT) {
      return {
        ...this.blankPermissions(),
        canViewReports: true,
        canViewCashLogs: true,
        canReprintReceipt: true,
      };
    }

    if (role === Role.CASHIER) {
      return {
        ...data,
        canTakeOrders: false,
      };
    }

    if (role === Role.ADMIN) {
      return {
        ...data,
        canUsePos: false,
        canOpenCashSession: false,
        canTakeOrders: true,
      };
    }

    return data;
  }

  private blankPermissions() {
    return permissionKeys.reduce<Record<(typeof permissionKeys)[number], boolean>>(
      (data, key) => {
        data[key] = false;
        return data;
      },
      {} as Record<(typeof permissionKeys)[number], boolean>,
    );
  }

  private permissionSnapshot(value: Record<(typeof permissionKeys)[number], boolean>) {
    return permissionKeys.reduce<Record<(typeof permissionKeys)[number], boolean>>(
      (permissions, key) => {
        permissions[key] = value[key];
        return permissions;
      },
      {} as Record<(typeof permissionKeys)[number], boolean>,
    );
  }

  private changedPermissionKeys(
    previous: Record<(typeof permissionKeys)[number], boolean>,
    next: Record<(typeof permissionKeys)[number], boolean>,
  ) {
    return permissionKeys.filter((key) => previous[key] !== next[key]);
  }

  private membershipSelect() {
    return {
      id: true,
      role: true,
      status: true,
      canUsePos: true,
      canOpenCashSession: true,
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
      canTakeOrders: true,
    };
  }
}
