import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@qorvex/database';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import { ImportsService } from './imports.service';

const allowedImportFileExtensions = ['.xlsx'];
const allowedImportMimeTypes = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
];
const maxImportFileSizeBytes = 10 * 1024 * 1024;

@Controller('imports')
@UseGuards(JwtAuthGuard, TenantMembershipGuard, RolesGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN, Role.ADMIN)
  findAll(@TenantId() tenantId: string) {
    return this.importsService.findAll(tenantId);
  }

  @Get(':id/rows')
  @Roles(Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN, Role.ADMIN)
  findRows(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.importsService.findRows(tenantId, id, { status, page, limit });
  }

  @Post('products')
  @Roles(Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN, Role.ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: maxImportFileSizeBytes,
        files: 1,
      },
      fileFilter: (_request, file, callback) => {
        const filename = file.originalname.toLowerCase();
        const hasAllowedExtension = allowedImportFileExtensions.some((extension) =>
          filename.endsWith(extension),
        );
        const hasAllowedMimeType = allowedImportMimeTypes.includes(file.mimetype);

        if (hasAllowedExtension && hasAllowedMimeType) {
          callback(null, true);
          return;
        }

        callback(
          new BadRequestException('Solo se permiten archivos de importacion Excel .xlsx.'),
          false,
        );
      },
    }),
  )
  importProducts(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: { originalname: string; buffer: Buffer; size: number },
  ) {
    return this.importsService.importProducts(tenantId, user.id, file);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.QORVEX_SUPER_ADMIN, Role.ADMIN)
  remove(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.importsService.remove(tenantId, user.id, id);
  }
}
