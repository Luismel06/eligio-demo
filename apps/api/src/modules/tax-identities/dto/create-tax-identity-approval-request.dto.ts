import { DocumentType, TaxIdentityContextType } from '@qorvex/database';
import {
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTaxIdentityApprovalRequestDto {
  @IsEnum(TaxIdentityContextType)
  @IsIn([TaxIdentityContextType.POS_ORDER])
  contextType: TaxIdentityContextType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  contextId: string;

  @IsEnum(DocumentType)
  @IsIn([DocumentType.RNC, DocumentType.CEDULA])
  documentType: DocumentType;

  @IsString()
  @MaxLength(20)
  documentNumber: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fiscalName: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
