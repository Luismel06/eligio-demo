import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderTransitionDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';
import { PurchasingService } from './purchasing.service';

@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, TenantMembershipGuard)
export class PurchasingController {
  constructor(private readonly purchasingService: PurchasingService) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('q') q?: string,
  ) {
    return this.purchasingService.findAll(tenantId, user, { status, q });
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.purchasingService.create(tenantId, user, dto);
  }

  @Get(':id')
  findOne(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.purchasingService.findOne(tenantId, user, id);
  }

  @Patch(':id')
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.purchasingService.update(tenantId, user, id, dto);
  }

  @Post(':id/submit')
  submit(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PurchaseOrderTransitionDto,
  ) {
    return this.purchasingService.submit(tenantId, user, id, dto.note);
  }

  /**
   * Preferred endpoint for the simplified lifecycle. The legacy /submit
   * endpoint remains available so older clients do not lose access to drafts.
   */
  @Post(':id/request')
  request(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PurchaseOrderTransitionDto,
  ) {
    return this.purchasingService.request(tenantId, user, id, dto.note);
  }

  @Post(':id/review')
  review(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PurchaseOrderTransitionDto,
  ) {
    return this.purchasingService.review(tenantId, user, id, dto.note);
  }

  @Post(':id/approve')
  approve(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PurchaseOrderTransitionDto,
  ) {
    return this.purchasingService.approve(tenantId, user, id, dto.note);
  }

  @Post(':id/issue')
  issue(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PurchaseOrderTransitionDto,
  ) {
    return this.purchasingService.issue(tenantId, user, id, dto.note);
  }

  @Post(':id/pause')
  pause(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PurchaseOrderTransitionDto,
  ) {
    return this.purchasingService.pause(tenantId, user, id, dto.note);
  }

  @Post(':id/resume')
  resume(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PurchaseOrderTransitionDto,
  ) {
    return this.purchasingService.resume(tenantId, user, id, dto.note);
  }

  @Post(':id/cancel')
  cancel(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PurchaseOrderTransitionDto,
  ) {
    return this.purchasingService.cancel(tenantId, user, id, dto.note);
  }
}
