import { DocumentType, TaxIdentityContextType } from '@qorvex/database';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class AuthorizeTaxIdentityOverrideDto {
  @IsEnum(TaxIdentityContextType)
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

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason: string;

  @IsEmail()
  @MaxLength(254)
  supervisorEmail: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  supervisorPassword: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInMinutes?: number;
}
