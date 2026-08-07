import { Module } from '@nestjs/common';
import { CreditApprovalsController } from './credit-approvals.controller';
import { CreditApprovalsService } from './credit-approvals.service';

@Module({
  controllers: [CreditApprovalsController],
  providers: [CreditApprovalsService],
})
export class CreditApprovalsModule {}
