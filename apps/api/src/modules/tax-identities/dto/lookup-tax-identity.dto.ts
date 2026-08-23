import { DocumentType, TaxIdentityContextType } from '@qorvex/database';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export class LookupTaxIdentityDto {
  @IsEnum(DocumentType)
  @IsIn([DocumentType.RNC, DocumentType.CEDULA])
  documentType: DocumentType;

  @IsString()
  @MaxLength(20)
  documentNumber: string;

  @IsOptional()
  @IsEnum(TaxIdentityContextType)
  contextType?: TaxIdentityContextType;

  @ValidateIf((dto: LookupTaxIdentityDto) => dto.contextType !== undefined)
  @IsString()
  @MaxLength(80)
  contextId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  overrideId?: string;
}
