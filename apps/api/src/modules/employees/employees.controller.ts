import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Role } from '@qorvex/database';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto/employee.dto';
import { EmployeesService } from './employees.service';

@Controller('employees')
@UseGuards(JwtAuthGuard, TenantMembershipGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN, Role.ADMIN)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  findAll(@TenantId() tenantId: string) {
    return this.employeesService.findAll(tenantId);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEmployeeDto,
  ) {
    return this.employeesService.create(tenantId, user, dto);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.employeesService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(tenantId, user, id, dto);
  }

  @Get(':id/activity')
  activity(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.employeesService.activity(tenantId, id);
  }

  @Get(':id/invoices')
  invoices(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.employeesService.invoices(tenantId, id);
  }

  @Get(':id/sales')
  sales(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.employeesService.invoices(tenantId, id);
  }

  @Get(':id/cash-movements')
  cashMovements(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.employeesService.cashMovements(tenantId, id);
  }

  @Patch(':id/state')
  updateState(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employeesService.update(tenantId, user, id, dto);
  }
}
