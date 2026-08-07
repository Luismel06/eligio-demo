import { InvoiceDocumentType, PaymentMethod } from '@qorvex/database';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class PosSaleItemDto {
  @IsString()
  productId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  quantity: number;
}

export class CompleteSaleDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsEnum(InvoiceDocumentType)
  documentType?: InvoiceDocumentType;

  @IsIn([PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.TRANSFER])
  paymentMethod: PaymentMethod;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amountReceived?: number;

  @IsOptional()
  @IsString()
  cashSessionId?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PosSaleItemDto)
  items?: PosSaleItemDto[];
}
