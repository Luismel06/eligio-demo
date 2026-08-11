import { Body, Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { Role } from '@qorvex/database';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { CreateFiscalSequenceDto } from './dto/create-fiscal-sequence.dto';
import { FiscalSequencesService } from './fiscal-sequences.service';

@Controller('fiscal-sequences')
@UseGuards(JwtAuthGuard, TenantMembershipGuard)
export class FiscalSequencesController {
  constructor(private readonly fiscalSequencesService: FiscalSequencesService) {}

  @Get()
  findAll(@TenantId() tenantId: string) {
    return this.fiscalSequencesService.findAll(tenantId);
  }

  @Post()
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFiscalSequenceDto,
  ) {
    const membership = user.memberships.find(
      (candidate) =>
        candidate.tenantId === tenantId ||
        candidate.role === Role.SUPER_ADMIN ||
        candidate.role === Role.QORVEX_SUPER_ADMIN,
    );
    const administratorRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];

    if (
      !membership ||
      (!membership.canManageFiscalSequences && !administratorRoles.includes(membership.role))
    ) {
      throw new ForbiddenException('You cannot configure fiscal sequences for this tenant.');
    }

    return this.fiscalSequencesService.create(tenantId, user.id, dto);
  }
}
