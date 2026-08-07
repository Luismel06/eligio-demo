import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@qorvex/database';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { ListSuppliersQueryDto } from './dto/list-suppliers-query.dto';
import { AddSupplierProductDto, UpdateSupplierProductDto } from './dto/supplier-product.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SuppliersService } from './suppliers.service';

const supplierReadRoles: Role[] = [
  Role.ACCOUNTANT,
  Role.ADMIN,
  Role.SUPER_ADMIN,
  Role.QORVEX_SUPER_ADMIN,
];
const supplierWriteRoles: Role[] = [Role.ADMIN, Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN];

@Controller('suppliers')
@UseGuards(JwtAuthGuard, TenantMembershipGuard, RolesGuard)
@Roles(...supplierReadRoles)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  findAll(@TenantId() tenantId: string, @Query() query: ListSuppliersQueryDto) {
    return this.suppliersService.findAll(tenantId, query);
  }

  @Post()
  @Roles(...supplierWriteRoles)
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSupplierDto,
  ) {
    return this.suppliersService.create(tenantId, user.id, dto);
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.suppliersService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(...supplierWriteRoles)
  update(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(tenantId, user.id, id, dto);
  }

  @Patch(':id/deactivate')
  @Roles(...supplierWriteRoles)
  deactivate(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.suppliersService.deactivate(tenantId, user.id, id);
  }

  @Post(':id/products')
  @Roles(...supplierWriteRoles)
  addProduct(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddSupplierProductDto,
  ) {
    return this.suppliersService.addProduct(tenantId, user.id, id, dto);
  }

  @Patch(':id/products/:productId')
  @Roles(...supplierWriteRoles)
  updateProduct(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('productId') productId: string,
    @Body() dto: UpdateSupplierProductDto,
  ) {
    return this.suppliersService.updateProduct(tenantId, user.id, id, productId, dto);
  }

  @Delete(':id/products/:productId')
  @Roles(...supplierWriteRoles)
  deactivateProduct(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('productId') productId: string,
  ) {
    return this.suppliersService.deactivateProduct(tenantId, user.id, id, productId);
  }
}
