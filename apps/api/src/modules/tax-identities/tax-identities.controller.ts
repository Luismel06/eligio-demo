import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@qorvex/database';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import type { AuthenticatedUser } from '../../common/types/authenticated-request';
import { CreateTaxIdentityApprovalRequestDto } from './dto/create-tax-identity-approval-request.dto';
import {
  ApproveTaxIdentityApprovalRequestDto,
  RejectTaxIdentityApprovalRequestDto,
} from './dto/decide-tax-identity-approval-request.dto';
import { ListTaxIdentityApprovalRequestsDto } from './dto/list-tax-identity-approval-requests.dto';
import { LookupTaxIdentityDto } from './dto/lookup-tax-identity.dto';
import { TaxIdentitiesService } from './tax-identities.service';

const administratorRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];

@Controller('tax-identities')
@UseGuards(JwtAuthGuard, TenantMembershipGuard)
export class TaxIdentitiesController {
  constructor(private readonly taxIdentitiesService: TaxIdentitiesService) {}

  @Post('lookup')
  @Header('Cache-Control', 'no-store')
  lookup(@TenantId() tenantId: string, @Body() dto: LookupTaxIdentityDto) {
    return this.taxIdentitiesService.lookup({ tenantId, ...dto });
  }

  @Post('approval-requests')
  @Header('Cache-Control', 'no-store')
  createApprovalRequest(
    @TenantId() tenantId: string,
    @CurrentUser() requester: AuthenticatedUser,
    @Body() dto: CreateTaxIdentityApprovalRequestDto,
  ) {
    return this.taxIdentitiesService.createApprovalRequest(tenantId, requester, dto);
  }

  @Get('approval-requests')
  @Header('Cache-Control', 'no-store')
  listApprovalRequests(
    @TenantId() tenantId: string,
    @CurrentUser() requester: AuthenticatedUser,
    @Query() query: ListTaxIdentityApprovalRequestsDto,
  ) {
    return this.taxIdentitiesService.listApprovalRequests(tenantId, requester, query);
  }

  @Get('approval-requests/:id')
  @Header('Cache-Control', 'no-store')
  getApprovalRequest(
    @TenantId() tenantId: string,
    @CurrentUser() requester: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.taxIdentitiesService.getApprovalRequest(tenantId, requester, id);
  }

  @Post('approval-requests/:id/approve')
  @UseGuards(RolesGuard)
  @Roles(...administratorRoles)
  @Header('Cache-Control', 'no-store')
  approveApprovalRequest(
    @TenantId() tenantId: string,
    @CurrentUser() administrator: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveTaxIdentityApprovalRequestDto,
  ) {
    return this.taxIdentitiesService.approveApprovalRequest(tenantId, administrator, id, dto);
  }

  @Post('approval-requests/:id/reject')
  @UseGuards(RolesGuard)
  @Roles(...administratorRoles)
  @Header('Cache-Control', 'no-store')
  rejectApprovalRequest(
    @TenantId() tenantId: string,
    @CurrentUser() administrator: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectTaxIdentityApprovalRequestDto,
  ) {
    return this.taxIdentitiesService.rejectApprovalRequest(tenantId, administrator, id, dto);
  }

  @Post('approval-requests/:id/cancel')
  @Header('Cache-Control', 'no-store')
  cancelApprovalRequest(
    @TenantId() tenantId: string,
    @CurrentUser() requester: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.taxIdentitiesService.cancelApprovalRequest(tenantId, requester, id);
  }
}
