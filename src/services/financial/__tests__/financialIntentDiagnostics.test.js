import { describe, expect, it } from 'vitest';
import {
  FINANCIAL_DIAGNOSTIC_HEALTH,
  FINANCIAL_DIAGNOSTIC_PENDING_THRESHOLD_MS,
  FINANCIAL_OPERATION_LABELS,
  buildFinancialDiagnosticText,
  classifyFinancialIntentHealth,
  maskFinancialFingerprint,
  toFinancialIntentDiagnostic
} from '../financialIntentDiagnostics';

const NOW = Date.parse('2026-08-22T20:00:00.000Z');
const row = (changes = {}) => ({
  id: 'intent-1', ledgerVersion: 1, operationType: 'cash.open',
  idempotencyKey: 'financial:v1:0123456789abcdef0123456789abcdef01234567',
  requestHash: 'a'.repeat(64), requestContractVersion: 1,
  status: 'COMPLETED', projectionStatus: 'APPLIED', dispatchAttemptCount: 1,
  recoveryAttemptCount: 0, createdAt: '2026-08-22T19:00:00.000Z', updatedAt: '2026-08-22T19:10:00.000Z',
  originActorType: 'admin', originActorKey: 'admin:a', originDeviceRef: 'device-a',
  requestPayload: { licenseKey: 'secret', customer: { phone: 'sensitive' } },
  responsePayload: { authorization: 'secret-response' }, canonicalRequest: { accessToken: 'secret-token' },
  ...changes
});

const recursivelyHas = (value, forbidden) => {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => (
    forbidden.has(key.toLowerCase()) || recursivelyHas(nested, forbidden)
  ));
};

describe('financial intent diagnostics', () => {
  it.each([
    ['COMPLETED', 'APPLIED', FINANCIAL_DIAGNOSTIC_HEALTH.HEALTHY],
    ['COMPLETED', 'NOT_REQUIRED', FINANCIAL_DIAGNOSTIC_HEALTH.HEALTHY],
    ['COMPLETED', 'PENDING', FINANCIAL_DIAGNOSTIC_HEALTH.PROJECTION_ATTENTION],
    ['COMPLETED', 'FAILED', FINANCIAL_DIAGNOSTIC_HEALTH.PROJECTION_ATTENTION],
    ['DISPATCHING', 'PENDING', FINANCIAL_DIAGNOSTIC_HEALTH.RECEIPT_PENDING],
    ['PENDING_RECEIPT', 'PENDING', FINANCIAL_DIAGNOSTIC_HEALTH.RECEIPT_PENDING],
    ['CONFLICT', 'PENDING', FINANCIAL_DIAGNOSTIC_HEALTH.CONFLICT],
    ['BLOCKED', 'PENDING', FINANCIAL_DIAGNOSTIC_HEALTH.BLOCKED]
  ])('classifies %s / %s as %s without mutation', (status, projectionStatus, expected) => {
    const source = row({
      status,
      projectionStatus,
      ...(['DISPATCHING', 'PENDING_RECEIPT'].includes(status) ? { lastDispatchAt: new Date(NOW - 1).toISOString() } : {})
    });
    const before = structuredClone(source);
    expect(classifyFinancialIntentHealth(source, { currentTime: NOW })).toBe(expected);
    expect(source).toEqual(before);
  });

  it('distinguishes zero-attempt PREPARED and only makes pending prolonged observationally', () => {
    const prepared = row({ status: 'PREPARED', projectionStatus: 'PENDING', dispatchAttemptCount: 0 });
    expect(classifyFinancialIntentHealth(prepared, { currentTime: NOW })).toBe(FINANCIAL_DIAGNOSTIC_HEALTH.PREPARED_NOT_DISPATCHED);

    const pending = row({ status: 'PENDING_RECEIPT', createdAt: new Date(NOW - FINANCIAL_DIAGNOSTIC_PENDING_THRESHOLD_MS - 1).toISOString() });
    expect(classifyFinancialIntentHealth(pending, { currentTime: NOW })).toBe(FINANCIAL_DIAGNOSTIC_HEALTH.RECEIPT_PENDING_PROLONGED);
    expect(pending.status).toBe('PENDING_RECEIPT');
  });

  it('only exposes its allowlisted DTO and masks K/H without changing durable values', () => {
    const source = row();
    const diagnostic = toFinancialIntentDiagnostic(source, { currentTime: NOW });
    const serialized = JSON.stringify(diagnostic);
    const forbidden = new Set(['requestpayload', 'responsepayload', 'canonicalrequest', 'licensekey', 'securitytoken', 'staffsessiontoken', 'accesstoken', 'refreshtoken', 'authorization', 'jwt']);
    expect(recursivelyHas(diagnostic, forbidden)).toBe(false);
    expect(serialized).not.toContain(source.idempotencyKey);
    expect(serialized).not.toContain(source.requestHash);
    expect(diagnostic.idempotencyKeyFingerprint).toBe(maskFinancialFingerprint(source.idempotencyKey));
    expect(diagnostic.requestHashFingerprint).toBe(maskFinancialFingerprint(source.requestHash));
    expect(source.idempotencyKey).toContain('financial:v1:');
    expect(source.requestHash).toBe('a'.repeat(64));
  });

  it('renders active and expired leases strictly as non-mutating overlays', () => {
    const active = toFinancialIntentDiagnostic(row({ recoveryLeaseId: 'lease', recoveryLeaseUntil: new Date(NOW + 1000).toISOString() }), { currentTime: NOW });
    const expired = toFinancialIntentDiagnostic(row({ recoveryLeaseId: 'lease', recoveryLeaseUntil: new Date(NOW - 1000).toISOString() }), { currentTime: NOW });
    expect(active.recoveryLeaseState).toBe('ACTIVE');
    expect(active.actionCandidates.refreshReceipt).toBe(false);
    expect(expired.recoveryLeaseState).toBe('EXPIRED');
  });

  it('provides stable Spanish labels for exactly the nine supported operations', () => {
    expect(Object.keys(FINANCIAL_OPERATION_LABELS)).toHaveLength(9);
    expect(FINANCIAL_OPERATION_LABELS['customer.payment']).toBeUndefined();
    expect(Object.values(FINANCIAL_OPERATION_LABELS).every((label) => typeof label === 'string' && label.length > 0)).toBe(true);
  });

  it('builds a useful sanitized copy text without raw payload or secrets', () => {
    const source = row();
    const text = buildFinancialDiagnosticText(toFinancialIntentDiagnostic(source, { currentTime: NOW }), {
      tenantOpaqueId: 'tenant-opaque', viewerActorKey: 'admin:a', appVersion: '1.2.3'
    });
    expect(text).toContain('Estado financiero: COMPLETED');
    expect(text).toContain('tenant-opaque');
    expect(text).not.toContain('secret-response');
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain(source.idempotencyKey);
    expect(text).not.toContain(source.requestHash);
  });
});
