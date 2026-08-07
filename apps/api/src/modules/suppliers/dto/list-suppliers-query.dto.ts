import { SupplierStatus } from '@qorvex/database';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class ListSuppliersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  q?: string;

  @IsOptional()
  @IsEnum(SupplierStatus)
  status?: SupplierStatus;
}
