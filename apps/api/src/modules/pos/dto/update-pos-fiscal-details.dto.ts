import { DocumentType, FiscalDocumentPurpose } from '@qorvex/database';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePosFiscalDetailsDto {
  @IsEnum(FiscalDocumentPurpose)
  fiscalPurpose: FiscalDocumentPurpose;

  /**
   * Backward-compatible assertion only. POS never changes the Customer link;
   * when supplied this value must equal the order's current customerId.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  customerId?: string | null;

  /**
   * One-time fiscal identity captured at checkout. It is persisted only in
   * the order/invoice snapshot and never creates a Customer record.
   */
  @IsOptional()
  @IsIn([DocumentType.RNC, DocumentType.CEDULA])
  documentType?: DocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  documentNumber?: string;

  /**
   * Short-lived, context-bound supervisor authorization used only when a
   * fresh DGII registry cannot verify the document. The browser never sends a
   * fiscal name: the backend resolves it from DGII or this authorization.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxIdentityOverrideId?: string;
}
