import { Module } from '@nestjs/common';
import { TaxIdentitiesController } from './tax-identities.controller';
import { DgiiRegistryImporterService } from './dgii-registry-importer.service';
import { TaxIdentitiesService } from './tax-identities.service';

@Module({
  controllers: [TaxIdentitiesController],
  providers: [TaxIdentitiesService, DgiiRegistryImporterService],
  exports: [TaxIdentitiesService, DgiiRegistryImporterService],
})
export class TaxIdentitiesModule {}

export { DgiiRegistryImporterService } from './dgii-registry-importer.service';
export { TaxIdentitiesService } from './tax-identities.service';
export type {
  RequireUsableTaxIdentityInput,
  TaxIdentityLookupResult,
  TaxIdentityOutcome,
  TaxIdentitySource,
  TaxIdentityTransactionClient,
  TaxIdentityVerificationSnapshot,
} from './tax-identity.types';
