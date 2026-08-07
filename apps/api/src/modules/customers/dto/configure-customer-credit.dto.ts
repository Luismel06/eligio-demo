import { CustomerCreditStatus } from '@qorvex/database';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNumber, Max, Min } from 'class-validator';

export class ConfigureCustomerCreditDto {
  @IsBoolean()
  creditEnabled: boolean;

  @IsEnum(CustomerCreditStatus)
  creditStatus: CustomerCreditStatus;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  creditLimit: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  creditTermDays: number;
}
