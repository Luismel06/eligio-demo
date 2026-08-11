import { Module } from '@nestjs/common';
import { FiscalSequencesController } from './fiscal-sequences.controller';
import { FiscalSequencesService } from './fiscal-sequences.service';

@Module({
  controllers: [FiscalSequencesController],
  providers: [FiscalSequencesService],
  exports: [FiscalSequencesService],
})
export class FiscalSequencesModule {}
