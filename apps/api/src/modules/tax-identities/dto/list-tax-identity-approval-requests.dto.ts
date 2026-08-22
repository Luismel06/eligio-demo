import { TaxIdentityApprovalRequestStatus, TaxIdentityContextType } from '@qorvex/database';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class ListTaxIdentityApprovalRequestsDto {
  @IsOptional()
  @IsEnum(TaxIdentityApprovalRequestStatus)
  status?: TaxIdentityApprovalRequestStatus;

  @IsOptional()
  @IsEnum(TaxIdentityContextType)
  contextType?: TaxIdentityContextType;

  @ValidateIf((dto: ListTaxIdentityApprovalRequestsDto) => dto.contextType !== undefined)
  @IsString()
  @MaxLength(80)
  contextId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
