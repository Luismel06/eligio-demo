import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const OCR_CONFIDENCE_VALUES = ['high', 'medium', 'low'] as const;

export class MobileOcrCaptureConfidenceDto {
  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  supplierName?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  supplierDocument?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  invoiceNumber?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  ncf?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  issueDate?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  paymentDueDate?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  ncfValidUntil?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  subtotal?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  discountTotal?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  taxTotal?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  total?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  purchaseOrderNumber?: (typeof OCR_CONFIDENCE_VALUES)[number];
}

export class MobileOcrCaptureItemConfidenceDto {
  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  code?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  description?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  quantity?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  unitCostNet?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  discountTotal?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  taxRate?: (typeof OCR_CONFIDENCE_VALUES)[number];

  @IsOptional()
  @IsIn(OCR_CONFIDENCE_VALUES)
  total?: (typeof OCR_CONFIDENCE_VALUES)[number];
}

export class MobileOcrCaptureItemDto {
  /**
   * Accepted so the current browser OCR result can be submitted unchanged.
   * The service deliberately does not persist it: it rebuilds a short label
   * from code/description instead of retaining raw OCR text.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rawText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 3 })
  @Min(0)
  @Max(1_000_000)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  unitCostNet?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  discountTotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  taxRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  taxTotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  subtotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  total?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => MobileOcrCaptureItemConfidenceDto)
  confidence?: MobileOcrCaptureItemConfidenceDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(250, { each: true })
  warnings?: string[];
}

/**
 * Structured output from the browser OCR. No image/file payload is accepted;
 * any compatibility raw text field is discarded before persistence.
 */
export class MobileOcrCaptureResultDto {
  /**
   * Accepted for compatibility with the local browser result, then discarded
   * by the service. It is never written to the capture session.
   */
  @IsOptional()
  @IsString()
  @MaxLength(80_000)
  rawText?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  pageCount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  supplierDocument?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  supplierTemplate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  ncf?: string;

  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @IsOptional()
  @IsDateString()
  paymentDueDate?: string;

  @IsOptional()
  @IsDateString()
  ncfValidUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentCondition?: string;

  @IsOptional()
  @IsIn(['DOP'])
  currency?: 'DOP';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  subtotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  discountTotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  taxTotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100_000_000)
  total?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  purchaseOrderNumber?: string;

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MobileOcrCaptureItemDto)
  items: MobileOcrCaptureItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MobileOcrCaptureConfidenceDto)
  confidence?: MobileOcrCaptureConfidenceDto;

  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(250, { each: true })
  warnings: string[];
}

export class SubmitMobileOcrCaptureResultDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => MobileOcrCaptureResultDto)
  result: MobileOcrCaptureResultDto;
}
