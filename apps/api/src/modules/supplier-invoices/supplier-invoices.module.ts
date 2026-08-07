import { Module } from '@nestjs/common';
import { ReceiptsModule } from '../receipts/receipts.module';
import { MobileOcrCapturesController } from './mobile-ocr-captures.controller';
import { MobileOcrCapturesService } from './mobile-ocr-captures.service';
import { SupplierInvoicesController } from './supplier-invoices.controller';
import { SupplierInvoicesService } from './supplier-invoices.service';

@Module({
  imports: [ReceiptsModule],
  controllers: [SupplierInvoicesController, MobileOcrCapturesController],
  providers: [SupplierInvoicesService, MobileOcrCapturesService],
  exports: [SupplierInvoicesService],
})
export class SupplierInvoicesModule {}
