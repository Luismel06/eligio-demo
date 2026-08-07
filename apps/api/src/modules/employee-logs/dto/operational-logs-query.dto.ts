import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum OperationalLogCategory {
  ORDER_TAKING = 'ORDER_TAKING',
  QUOTATION = 'QUOTATION',
  POS_SALE = 'POS_SALE',
}

export class OperationalLogsQueryDto {
  @IsOptional()
  @IsEnum(OperationalLogCategory)
  section?: OperationalLogCategory;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
