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
  CreateReceiptDto,
  ListReceiptsQueryDto,
  ReceiptReasonDto,
  UpdateReceiptDto,
} from './dto/receipt.dto';
import { ReceiptsService } from './receipts.service';

const receiptRoles: Role[] = [
  Role.ACCOUNTANT,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.QORVEX_SUPER_ADMIN,
];
const receiptAdminRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];

@Controller('receipts')
@UseGuards(JwtAuthGuard, TenantMembershipGuard, RolesGuard)
@Roles(...receiptRoles)
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query() query: ListReceiptsQueryDto) {
    return this.receiptsService.findAll(tenantId, query);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReceiptDto,
  ) {
    return this.receiptsService.create(tenantId, user.id, dto);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.receiptsService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateReceiptDto,
  ) {
    return this.receiptsService.update(tenantId, user.id, id, dto);
  }

  @Post(':id/confirm')
  confirm(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.receiptsService.confirm(tenantId, user.id, id);
  }

  @Post(':id/cancel')
  @Roles(...receiptAdminRoles)
  cancel(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReceiptReasonDto,
  ) {
    return this.receiptsService.cancel(tenantId, user.id, id, dto.reason);
  }

  @Post(':id/reverse')
  @Roles(...receiptAdminRoles)
  reverse(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReceiptReasonDto,
  ) {
    return this.receiptsService.reverse(tenantId, user.id, id, dto.reason);
  }
}
