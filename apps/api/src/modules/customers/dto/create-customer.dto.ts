import { DocumentType } from '@qorvex/database';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  @MaxLength(160)
  name: string;

  @IsEnum(DocumentType)
  documentType: DocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  documentNumber?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string;

  @IsOptional()
  @IsBoolean()
  manualTaxIdentityConfirmed?: boolean;
}
