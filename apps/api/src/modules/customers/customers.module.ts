import { Module } from '@nestjs/common';
import { TaxIdentitiesModule } from '../tax-identities/tax-identities.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [TaxIdentitiesModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
