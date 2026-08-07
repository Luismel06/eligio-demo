import { Module } from '@nestjs/common';
import { ReceiptsModule } from '../receipts/receipts.module';
import { SupplierInvoicesController } from './supplier-invoices.controller';
import { SupplierInvoicesService } from './supplier-invoices.service';

@Module({
  imports: [ReceiptsModule],
  controllers: [SupplierInvoicesController],
  providers: [SupplierInvoicesService],
  exports: [SupplierInvoicesService],
})
export class SupplierInvoicesModule {}
