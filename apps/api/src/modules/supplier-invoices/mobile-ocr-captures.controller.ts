import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@qorvex/database';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { SubmitMobileOcrCaptureResultDto } from './dto/mobile-ocr-capture.dto';
import { MobileOcrCapturesService } from './mobile-ocr-captures.service';

const accountingRoles: Role[] = [
  Role.ACCOUNTANT,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.QORVEX_SUPER_ADMIN,
];

/**
 * Desktop endpoints are authenticated and tenant-scoped. The two /mobile
 * endpoints are deliberately public because the phone does not need a login;
 * they require an unguessable, short-lived token sent only in a request header.
 */
@Controller('mobile-ocr-captures')
export class MobileOcrCapturesController {
  constructor(private readonly mobileOcrCapturesService: MobileOcrCapturesService) {}

  @Post()
  @UseGuards(JwtAuthGuard, TenantMembershipGuard, RolesGuard)
  @Roles(...accountingRoles)
  create(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.mobileOcrCapturesService.create(tenantId, user.id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, TenantMembershipGuard, RolesGuard)
  @Roles(...accountingRoles)
  getStatus(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.mobileOcrCapturesService.getStatus(tenantId, user.id, id);
  }

  @Post(':id/consume')
  @UseGuards(JwtAuthGuard, TenantMembershipGuard, RolesGuard)
  @Roles(...accountingRoles)
  consume(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.mobileOcrCapturesService.consume(tenantId, user.id, id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard, TenantMembershipGuard, RolesGuard)
  @Roles(...accountingRoles)
  cancel(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.mobileOcrCapturesService.cancel(tenantId, user.id, id);
  }

  @Get(':id/mobile')
  validateForMobile(@Param('id') id: string, @Headers('x-mobile-ocr-token') token?: string) {
    return this.mobileOcrCapturesService.validateForMobile(id, token);
  }

  @Post(':id/mobile/result')
  submitFromMobile(
    @Param('id') id: string,
    @Headers('x-mobile-ocr-token') token: string | undefined,
    @Body() dto: SubmitMobileOcrCaptureResultDto,
  ) {
    return this.mobileOcrCapturesService.submitFromMobile(id, token, dto.result);
  }
}
