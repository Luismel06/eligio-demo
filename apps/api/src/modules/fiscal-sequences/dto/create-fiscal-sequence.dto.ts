import { InvoiceDocumentType } from '@qorvex/database';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { LOCAL_NCF_DOCUMENT_TYPES } from '../fiscal-number';

export class CreateFiscalSequenceDto {
  @IsIn(LOCAL_NCF_DOCUMENT_TYPES)
  documentType: InvoiceDocumentType;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99_999_999)
  startNumber: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99_999_999)
  endNumber: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99_999_999)
  nextNumber: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  authorizationNumber?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validUntil?: string;
}
