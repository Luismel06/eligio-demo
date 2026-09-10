import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod, SupplierInvoiceStatus } from '@qorvex/database';
import { ReceiptItemDto } from '../../receipts/dto/receipt.dto';

export class SupplierInvoiceItemDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  purchaseOrderItemId?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  unitCostNet: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1)
  taxRate: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountTotal?: number;
}

/**
 * Metadatos mínimos de una revisión OCR local. Nunca contiene la imagen ni el
 * texto íntegro reconocido: solo permite auditar que la persona revisó una
 * sugerencia antes de confirmar una factura.
 */
export class SupplierInvoiceOcrReviewDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  pageCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  detectedTotal?: number;

  @IsOptional()
  @IsBoolean()
  totalMismatchAccepted?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(250, { each: true })
  warnings?: string[];
}

export class CreateSupplierInvoiceDto {
  @IsString()
  supplierId: string;

  @IsOptional()
  @IsString()
  purchaseOrderId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  invoiceNumber: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  ncf?: string;

  @IsDateString()
  issueDate: string;

  @IsDateString()
  dueDate: string;

  /**
   * Fecha de vigencia fiscal del NCF/e-NCF del suplidor. No sustituye el
   * vencimiento comercial que se usa para cuentas por pagar.
   */
  @IsOptional()
  @IsDateString()
  ncfValidUntil?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentCondition?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SupplierInvoiceOcrReviewDto)
  ocrReview?: SupplierInvoiceOcrReviewDto;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SupplierInvoiceItemDto)
  items: SupplierInvoiceItemDto[];
}

export class UpdateSupplierInvoiceDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  purchaseOrderId?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  invoiceNumber?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(50)
  ncf?: string | null;

  @IsOptional()
  @IsDateString()
  issueDate?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsDateString()
  ncfValidUntil?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(120)
  paymentCondition?: string | null;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => SupplierInvoiceOcrReviewDto)
  ocrReview?: SupplierInvoiceOcrReviewDto;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SupplierInvoiceItemDto)
  items?: SupplierInvoiceItemDto[];
}

/**
 * Datos de la entrada fisica que se confirma junto con una factura de suplidor.
 * La factura ya aporta su identificador; por eso cada linea referencia solamente
 * la linea facturada que se esta recibiendo.
 */
export class ConfirmSupplierInvoiceEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * Una factura ligada a una orden puede reflejar lo que realmente entregó el
   * suplidor: cantidades distintas, líneas faltantes o costos diferentes. No
   * se permite confirmar silenciosamente esas diferencias; la interfaz debe
   * mostrarlas y el usuario debe aceptarlas de forma expresa.
   */
  @IsOptional()
  @IsBoolean()
  orderReconciliationAccepted?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  orderReconciliationNote?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items: ReceiptItemDto[];
}

export class ListSupplierInvoicesQueryDto {
  @IsOptional()
  @IsEnum(SupplierInvoiceStatus)
  status?: SupplierInvoiceStatus;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @IsOptional()
  @IsDateString()
  dueTo?: string;

  @IsOptional()
  @Transform(({ value }) => parseBooleanQueryValue(value))
  @IsBoolean()
  overdue?: boolean;
}

export class PayablesSummaryQueryDto {
  @IsOptional()
  @IsString()
  supplierId?: string;
}

export class RegisterSupplierPaymentDto {
  @IsIn([PaymentMethod.CASH, PaymentMethod.TRANSFER, PaymentMethod.CHECK])
  method: PaymentMethod;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  /**
   * Efectivo entregado por el pagador. Para pagos en efectivo puede ser
   * mayor que el saldo: el servidor aplica solamente el saldo y registra el
   * cambio. Para transferencia y cheque, si se incluye, debe coincidir con
   * `amount`.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  tenderedAmount?: number;

  @IsOptional()
  @IsString()
  /**
   * @deprecated Se acepta temporalmente para no romper clientes anteriores,
   * pero los pagos de suplidores ya no se vinculan ni modifican caja.
   */
  cashSessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

export class CancelSupplierInvoiceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}

export class CancelSupplierPaymentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;

  @IsOptional()
  @IsString()
  /** @deprecated Campo legado ignorado al anular pagos de suplidores. */
  cashSessionId?: string;
}

function parseBooleanQueryValue(value: unknown) {
  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return value;
}
