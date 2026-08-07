import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveCreditSaleDto {
  @IsOptional()
  @IsBoolean()
  authorizeLimitExcess?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  decisionNote?: string;
}

export class RejectCreditSaleDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}
