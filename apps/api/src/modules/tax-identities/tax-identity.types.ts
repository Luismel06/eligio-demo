import type { DocumentType, Prisma, TaxIdentityContextType } from '@qorvex/database';

export type TaxIdentityOutcome =
  | 'VERIFIED'
  | 'NOT_FOUND'
  | 'NON_ACTIVE'
  | 'REGISTRY_STALE'
  | 'UNAVAILABLE';

export type TaxIdentitySource =
  | 'DGII_OFFICIAL'
  | 'TEST_FIXTURE'
  | 'MANUAL_OVERRIDE'
  | 'MANUAL_ENTRY'
  | null;

export type TaxIdentityLookupResult = {
  outcome: TaxIdentityOutcome;
  documentType: DocumentType;
  documentNumber: string;
  fiscalName: string | null;
  registryStatus: string | null;
  source: TaxIdentitySource;
  sourceUpdatedAt: Date | null;
  checkedAt: Date;
  overrideId?: string;
};

export type RequireUsableTaxIdentityInput = {
  tenantId: string;
  documentType: DocumentType;
  documentNumber: string;
  contextType: TaxIdentityContextType;
  contextId: string;
  overrideId?: string | null;
};

export type TaxIdentityTransactionClient = Pick<
  Prisma.TransactionClient,
  'dgiiRegistryDataset' | 'taxIdentityOverride'
>;

export type TaxIdentityVerificationSnapshot = {
  outcome: 'VERIFIED' | 'MANUAL_OVERRIDE';
  documentType: 'RNC' | 'CEDULA';
  documentNumber: string;
  fiscalName: string;
  registryStatus: string;
  source: 'DGII_OFFICIAL' | 'TEST_FIXTURE' | 'MANUAL_OVERRIDE';
  sourceUpdatedAt: string;
  verifiedAt: string;
  overrideId?: string;
};

export type ManagedTaxIdentityEvidence = {
  outcome: 'UNVERIFIED_MANUAL';
  documentType: 'RNC' | 'CEDULA';
  documentNumber: string;
  fiscalName: string;
  registryOutcome: 'NOT_FOUND';
  registryStatus: string;
  source: 'MANUAL_ENTRY';
  sourceUpdatedAt: string | null;
  registryCheckedAt: string;
  recordedAt: string;
};
