import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@qorvex/database';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import {
  CancelSupplierInvoiceDto,
  CancelSupplierPaymentDto,
  ConfirmSupplierInvoiceEntryDto,
  CreateSupplierInvoiceDto,
  ListSupplierInvoicesQueryDto,
  PayablesSummaryQueryDto,
  RegisterSupplierPaymentDto,
  UpdateSupplierInvoiceDto,
} from './dto/supplier-invoice.dto';
import { SupplierInvoicesService } from './supplier-invoices.service';

const accountingRoles: Role[] = [
  Role.ACCOUNTANT,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.QORVEX_SUPER_ADMIN,
];
const adminRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];

@Controller('supplier-invoices')
@UseGuards(JwtAuthGuard, TenantMembershipGuard, RolesGuard)
@Roles(...accountingRoles)
export class SupplierInvoicesController {
  constructor(private readonly supplierInvoicesService: SupplierInvoicesService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query() query: ListSupplierInvoicesQueryDto) {
    return this.supplierInvoicesService.findAll(tenantId, query);
  }

  @Get('payables/summary')
  getPayablesSummary(@TenantId() tenantId: string, @Query() query: PayablesSummaryQueryDto) {
    return this.supplierInvoicesService.getPayablesSummary(tenantId, query);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSupplierInvoiceDto,
  ) {
    return this.supplierInvoicesService.create(tenantId, user.id, dto);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.supplierInvoicesService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierInvoiceDto,
  ) {
    return this.supplierInvoicesService.update(tenantId, user.id, id, dto);
  }

  @Post(':id/confirm-entry')
  confirmEntry(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ConfirmSupplierInvoiceEntryDto,
  ) {
    return this.supplierInvoicesService.confirmEntry(tenantId, user.id, id, dto);
  }

  @Post(':id/cancel')
  @Roles(...adminRoles)
  cancel(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelSupplierInvoiceDto,
  ) {
    return this.supplierInvoicesService.cancel(tenantId, user.id, id, dto.reason);
  }

  @Post(':id/payments')
  registerPayment(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RegisterSupplierPaymentDto,
  ) {
    return this.supplierInvoicesService.registerPayment(tenantId, user.id, id, dto);
  }

  @Post(':id/payments/:paymentId/cancel')
  @Roles(...adminRoles)
  cancelPayment(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: CancelSupplierPaymentDto,
  ) {
    return this.supplierInvoicesService.cancelPayment(tenantId, user.id, id, paymentId, dto);
  }
}
