import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/tenant-id.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMembershipGuard } from '../../common/guards/tenant-membership.guard';
import { AuthenticatedUser } from '../../common/types/authenticated-request';
import {
  CancelReceivablePaymentDto,
  CreateReceivablePaymentDto,
} from './dto/receivable-payment.dto';
import { ReceivablesService } from './receivables.service';

@Controller('receivables')
@UseGuards(JwtAuthGuard, TenantMembershipGuard)
export class ReceivablesController {
  constructor(private readonly receivablesService: ReceivablesService) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
    @Query('bucket') bucket?: string,
  ) {
    return this.receivablesService.findAll(tenantId, user, { q, bucket });
  }

  @Get('customers')
  customerSummary(@TenantId() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.receivablesService.customerSummary(tenantId, user);
  }

  @Get('customers/:customerId/statement')
  customerStatement(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('customerId') customerId: string,
  ) {
    return this.receivablesService.customerStatement(tenantId, user, customerId);
  }

  @Get('payments/:paymentId')
  findPaymentReceipt(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
  ) {
    return this.receivablesService.findPaymentReceipt(tenantId, user, paymentId);
  }

  @Post('invoices/:invoiceId/payments')
  createPayment(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: CreateReceivablePaymentDto,
  ) {
    return this.receivablesService.createPayment(tenantId, user, invoiceId, dto);
  }

  @Post('payments/:paymentId/cancel')
  cancelPayment(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('paymentId') paymentId: string,
    @Body() dto: CancelReceivablePaymentDto,
  ) {
    return this.receivablesService.cancelPayment(tenantId, user, paymentId, dto);
  }
}
