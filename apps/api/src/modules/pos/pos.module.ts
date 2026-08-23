import { Module } from '@nestjs/common';
import { FiscalSequencesModule } from '../fiscal-sequences/fiscal-sequences.module';
import { TaxIdentitiesModule } from '../tax-identities/tax-identities.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';

@Module({
  imports: [FiscalSequencesModule, TaxIdentitiesModule],
  controllers: [PosController],
  providers: [PosService],
})
export class PosModule {}
