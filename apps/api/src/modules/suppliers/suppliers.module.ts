import { Module } from '@nestjs/common';
import { TaxIdentitiesModule } from '../tax-identities/tax-identities.module';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [TaxIdentitiesModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
