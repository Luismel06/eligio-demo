import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@qorvex/database';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import { OperationalLogsQueryDto } from './dto/operational-logs-query.dto';
import { EmployeeLogsService } from './employee-logs.service';

@Controller('employee-logs')
@UseGuards(JwtAuthGuard, TenantMembershipGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN, Role.ADMIN, Role.ACCOUNTANT)
export class EmployeeLogsController {
  constructor(private readonly employeeLogsService: EmployeeLogsService) {}

  @Get('operational')
  findOperational(@TenantId() tenantId: string, @Query() query: OperationalLogsQueryDto) {
    return this.employeeLogsService.findOperational(tenantId, query);
  }

  @Get()
  findRecent(@TenantId() tenantId: string) {
    return this.employeeLogsService.findRecent(tenantId);
  }
}
