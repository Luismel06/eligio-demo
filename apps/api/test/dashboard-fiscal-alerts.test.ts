import assert from 'node:assert/strict';
import test from 'node:test';
import { FiscalSequenceStatus, InvoiceDocumentType } from '@qorvex/database';
import { DashboardService } from '../src/modules/dashboard/dashboard.service';

type FiscalSequenceInput = {
  id: string;
  documentType: InvoiceDocumentType;
  prefix: string;
  startNumber: number;
  endNumber: number;
  nextNumber: number;
  validUntil: Date | null;
  status: FiscalSequenceStatus;
  createdAt: Date;
};

type FiscalSequenceAlert = {
  id: string;
  documentType: InvoiceDocumentType;
  status: FiscalSequenceStatus | 'MISSING';
  remaining: number;
  authorizedCount: number;
  alertThreshold: number;
  severity: 'WARNING' | 'CRITICAL';
};

const service = new DashboardService({} as never);
const buildFiscalSequenceAlerts = (sequences: FiscalSequenceInput[]): FiscalSequenceAlert[] =>
  (
    service as unknown as {
      buildFiscalSequenceAlerts: (
        source: FiscalSequenceInput[],
        currentFiscalDate: Date,
      ) => FiscalSequenceAlert[];
    }
  ).buildFiscalSequenceAlerts(sequences, new Date('2026-08-20T00:00:00.000Z'));

function activeSequence(
  authorizedCount: number,
  remaining: number,
  id = `b02-${authorizedCount}-${remaining}`,
): FiscalSequenceInput {
  return {
    id,
    documentType: InvoiceDocumentType.CONSUMER_02,
    prefix: 'B02',
    startNumber: 1,
    endNumber: authorizedCount,
    nextNumber: authorizedCount - remaining + 1,
    validUntil: new Date('2027-12-31T00:00:00.000Z'),
    status: FiscalSequenceStatus.ACTIVE,
    createdAt: new Date('2026-08-20T00:00:00.000Z'),
  };
}

for (const authorizedCount of [30, 31, 60, 100, 200]) {
  test(`alerts at the first whole NCF count at or after 80% consumed for a block of ${authorizedCount}`, () => {
    const alertThreshold = Math.floor(authorizedCount * 0.2);
    const sequence = activeSequence(authorizedCount, alertThreshold);
    const alerts = buildFiscalSequenceAlerts([sequence]);
    const alert = alerts.find((candidate) => candidate.id === sequence.id);

    assert.ok(alert);
    assert.equal(alert.authorizedCount, authorizedCount);
    assert.equal(alert.remaining, alertThreshold);
    assert.equal(alert.alertThreshold, alertThreshold);
    assert.equal(alert.severity, 'WARNING');
  });

  test(`does not alert before 80% consumed for a block of ${authorizedCount}`, () => {
    const alertThreshold = Math.floor(authorizedCount * 0.2);
    const sequence = activeSequence(authorizedCount, alertThreshold + 1);
    const alerts = buildFiscalSequenceAlerts([sequence]);

    assert.equal(
      alerts.some((candidate) => candidate.id === sequence.id),
      false,
    );
  });
}

test('marks an active sequence critical at 5% remaining', () => {
  const sequence = activeSequence(100, 5);
  const alert = buildFiscalSequenceAlerts([sequence]).find(
    (candidate) => candidate.id === sequence.id,
  );

  assert.ok(alert);
  assert.equal(alert.alertThreshold, 20);
  assert.equal(alert.severity, 'CRITICAL');
});

test('marks an exhausted sequence critical with no remaining numbers', () => {
  const sequence: FiscalSequenceInput = {
    ...activeSequence(30, 0, 'b02-exhausted'),
    nextNumber: 31,
    status: FiscalSequenceStatus.EXHAUSTED,
  };
  const alert = buildFiscalSequenceAlerts([sequence]).find(
    (candidate) => candidate.id === sequence.id,
  );

  assert.ok(alert);
  assert.equal(alert.status, FiscalSequenceStatus.EXHAUSTED);
  assert.equal(alert.remaining, 0);
  assert.equal(alert.alertThreshold, 6);
  assert.equal(alert.severity, 'CRITICAL');
});

test('reports missing B01 and B02 sequences as critical', () => {
  const alerts = buildFiscalSequenceAlerts([]);

  assert.equal(alerts.length, 2);
  for (const alert of alerts) {
    assert.equal(alert.status, 'MISSING');
    assert.equal(alert.authorizedCount, 0);
    assert.equal(alert.remaining, 0);
    assert.equal(alert.alertThreshold, 0);
    assert.equal(alert.severity, 'CRITICAL');
  }
});
