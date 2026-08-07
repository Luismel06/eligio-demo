import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@qorvex/database';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, TenantMembershipGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  summary(@TenantId() tenantId: string) {
    return this.dashboardService.getSummary(tenantId);
  }

  @Get('product-sales')
  productSales(@TenantId() tenantId: string) {
    return this.dashboardService.getProductSales(tenantId);
  }
}
