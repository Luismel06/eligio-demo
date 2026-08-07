import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@qorvex/database';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedRequest } from '../types/authenticated-request';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    const tenantId = request.tenantId;

    if (!user || !tenantId) {
      throw new ForbiddenException('Role checks require authenticated tenant context.');
    }

    const platformRole = user.memberships.find(
      (membership) =>
        membership.role === Role.SUPER_ADMIN || membership.role === Role.QORVEX_SUPER_ADMIN,
    )?.role;
    const tenantRole = user.memberships.find(
      (membership) => membership.tenantId === tenantId,
    )?.role;
    const roleForTenant = platformRole ?? tenantRole;

    if (!roleForTenant || !roles.includes(roleForTenant)) {
      throw new ForbiddenException('Insufficient role for this operation.');
    }

    return true;
  }
}
