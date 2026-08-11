import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@qorvex/database';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import { DashboardService } from './dashboard.service';
import { ProductSalesQueryDto } from './dto/product-sales-query.dto';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, TenantMembershipGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  summary(@TenantId() tenantId: string) {
    return this.dashboardService.getSummary(tenantId);
  }

  @Get('alerts')
  alerts(@TenantId() tenantId: string) {
    return this.dashboardService.getOperationalAlerts(tenantId);
  }

  @Get('product-sales')
  productSales(@TenantId() tenantId: string, @Query() query: ProductSalesQueryDto) {
    return this.dashboardService.getProductSales(tenantId, query);
  }
}
