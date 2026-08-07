import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { CreditApprovalsService } from './credit-approvals.service';
import { ApproveCreditSaleDto, RejectCreditSaleDto } from './dto/credit-approval.dto';

@Controller('credit-approvals')
@UseGuards(JwtAuthGuard, TenantMembershipGuard)
export class CreditApprovalsController {
  constructor(private readonly creditApprovalsService: CreditApprovalsService) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ) {
    return this.creditApprovalsService.findAll(tenantId, user, status);
  }

  @Post(':id/approve')
  approve(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveCreditSaleDto,
  ) {
    return this.creditApprovalsService.approve(tenantId, user, id, dto);
  }

  @Post(':id/reject')
  reject(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectCreditSaleDto,
  ) {
    return this.creditApprovalsService.reject(tenantId, user, id, dto);
  }
}
