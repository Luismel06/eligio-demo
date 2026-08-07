import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateReceivablePaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsString()
  cashSessionId: string;

  @IsOptional()
  @IsUUID('4')
  idempotencyKey?: string;
}

export class CancelReceivablePaymentDto {
  @IsString()
  cashSessionId: string;

  @IsString()
  @MaxLength(500)
  reason: string;
}
