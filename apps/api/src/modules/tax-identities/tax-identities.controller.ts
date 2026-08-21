import { Body, Controller, Header, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import type { AuthenticatedUser } from '../../common/types/authenticated-request';
import { AuthorizeTaxIdentityOverrideDto } from './dto/authorize-tax-identity-override.dto';
import { LookupTaxIdentityDto } from './dto/lookup-tax-identity.dto';
import { TaxIdentitiesService } from './tax-identities.service';

@Controller('tax-identities')
@UseGuards(JwtAuthGuard, TenantMembershipGuard)
export class TaxIdentitiesController {
  constructor(private readonly taxIdentitiesService: TaxIdentitiesService) {}

  @Post('lookup')
  @Header('Cache-Control', 'no-store')
  lookup(@TenantId() tenantId: string, @Body() dto: LookupTaxIdentityDto) {
    return this.taxIdentitiesService.lookup({ tenantId, ...dto });
  }

  @Post('overrides')
  @Header('Cache-Control', 'no-store')
  authorizeOverride(
    @TenantId() tenantId: string,
    @CurrentUser() requester: AuthenticatedUser,
    @Body() dto: AuthorizeTaxIdentityOverrideDto,
  ) {
    return this.taxIdentitiesService.authorizeOverride(tenantId, requester, dto);
  }
}
