import { createClient } from '@supabase/supabase-js';
import { classifySessionVerificationResponse } from '../sessionVerification';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_OFFLINE_AUTHORIZATION_REASON as REASON,
  ADMIN_OFFLINE_CONTINUITY_WINDOW_MS,
  evaluateAdminOfflineAuthorization,
  isSafeAdminOfflineVerificationFailure,
  resolveAdminOfflineTime
} from '../adminOfflineAuthorization';

const DAY = 24 * 60 * 60 * 1000;
const verifiedAt = Date.parse('2026-10-01T12:00:00.000Z');
const ids = {
  license: 'license-a',
  admin: 'admin-a',
  device: 'device-a',
  deviceRef: 'device-ref-a',
  tenant: 'tenant-a',
  session: 'session-a'
};

const fixture = (overrides = {}) => {
  const evidence = {
    version: 2,
    validatedAt: verifiedAt,
    expiresAt: new Date(verifiedAt + 30 * DAY).toISOString(),
    sessionId: ids.session,
    sessionTokenDigest: 'admin-token-digest',
    adminUserId: ids.admin,
    licenseId: ids.license,
    deviceId: ids.device,
    deviceRef: ids.deviceRef,
    deviceTokenDigest: 'device-token-digest',
    tenantOpaqueId: ids.tenant
  };
  const license = {
    license_id: ids.license,
    device_id: ids.device,
    admin_user: { id: ids.admin },
    device_role: 'admin',
    status: 'active',
    localExpiry: new Date(verifiedAt + 30 * DAY).toISOString(),
    expires_at: null
  };
  const credentials = {
    adminToken: 'admin-token',
    adminSessionId: ids.session,
    adminTokenDigest: 'admin-token-digest',
    staffToken: null,
    staffSessionId: null
  };
  const args = {
    now: verifiedAt,
    evidence,
    credentials,
    license,
    adminUser: { id: ids.admin },
    deviceRef: ids.deviceRef,
    deviceTokenDigest: 'device-token-digest',
    tenantOpaqueId: ids.tenant,
    tenantBinding: {
      tenantIdentity: `license-id:${ids.license}`,
      tenantAliases: [`license-id:${ids.license}`, 'license-key-sha256:abc']
    },
    ...overrides
  };
  return args;
};

describe('OFFLINE-AUTH-P2: Admin offline continuity', () => {
  it.each(['valid', 'expired', 'device', 'tenant', 'identity', 'staff', 'actor', 'local'])('applies v2 evidence restrictions to real wrapped transport: %s', async (variant) => {
    const client = createClient('https://transport-fixture.invalid', 'fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async () => { throw new TypeError('Failed to fetch'); } }
    });
    const verificationResult = classifySessionVerificationResponse('admin', await client.rpc('verify_admin_session', {}));
    expect(isSafeAdminOfflineVerificationFailure(verificationResult)).toBe(true);
    const args = fixture({ verificationResult });
    if (variant === 'expired') args.now = verifiedAt + ADMIN_OFFLINE_CONTINUITY_WINDOW_MS;
    if (variant === 'device') args.deviceRef = 'device-b';
    if (variant === 'tenant') args.tenantOpaqueId = 'tenant-b';
    if (variant === 'identity') args.adminUser = { id: 'admin-b' };
    if (variant === 'staff') args.credentials = { adminToken: null, adminSessionId: null, staffToken: 'staff-token', staffSessionId: 'staff-session' };
    if (variant === 'actor') args.actorRuntimeRestoreError = new Error('fixture restore failed');
    if (variant === 'local') args.storageUnavailable = true;
    const before = structuredClone({ evidence: args.evidence, credentials: args.credentials, license: args.license });
    expect(evaluateAdminOfflineAuthorization(args).eligible).toBe(variant === 'valid');
    expect({ evidence: args.evidence, credentials: args.credentials, license: args.license }).toEqual(before);
  });

  it.each([
    ['23 hours', 23 * 60 * 60 * 1000, true],
    ['24 hours', DAY, true],
    ['25 hours', DAY + 60 * 60 * 1000, true],
    ['48 hours', 2 * DAY, true],
    ['72 hours', 3 * DAY, true],
    ['5 days', 5 * DAY, true],
    ['6 days and 23 hours', 6 * DAY + 23 * 60 * 60 * 1000, true],
    ['exactly 7 days', ADMIN_OFFLINE_CONTINUITY_WINDOW_MS, false],
    ['one millisecond after 7 days', ADMIN_OFFLINE_CONTINUITY_WINDOW_MS + 1, false]
  ])('checks the %s boundary', (_name, elapsed, expected) => {
    const result = evaluateAdminOfflineAuthorization({
      ...fixture(),
      now: verifiedAt + elapsed,
      lastSeen: null
    });
    expect(result.eligible).toBe(expected);
    if (!expected) expect(result.reason).toBe(REASON.EVIDENCE_EXPIRED);
  });

  it('caps authority at the exact server session expiry', () => {
    const result = evaluateAdminOfflineAuthorization({
      ...fixture({ evidence: { ...fixture().evidence, expiresAt: new Date(verifiedAt + 48 * 60 * 60 * 1000).toISOString() } }),
      now: verifiedAt + 48 * 60 * 60 * 1000,
      lastSeen: null
    });
    expect(result).toMatchObject({ eligible: false, reason: REASON.SERVER_SESSION_EXPIRED });
  });

  it('AUTH-P2-REC-06: accepts a sticky historical key-hash binding only when verified evidence links it to the license ID', () => {
    const args = fixture({
      evidence: { ...fixture().evidence, tenantLicenseKeyDigest: 'a'.repeat(64) },
      tenantBinding: {
        tenantIdentity: `license-key-sha256:${'a'.repeat(64)}`,
        tenantAliases: [`license-key-sha256:${'a'.repeat(64)}`]
      }
    });
    expect(evaluateAdminOfflineAuthorization(args)).toMatchObject({ eligible: true, reason: REASON.AUTHORIZED });
  });

  it.each([
    ['missing server-linked digest', null, 'a'.repeat(64)],
    ['digest points at a different historical tenant', 'b'.repeat(64), 'a'.repeat(64)]
  ])('AUTH-P2-REC-08: blocks %s', (_label, evidenceDigest, bindingDigest) => {
    const args = fixture({
      evidence: { ...fixture().evidence, tenantLicenseKeyDigest: evidenceDigest },
      tenantBinding: {
        tenantIdentity: `license-key-sha256:${bindingDigest}`,
        tenantAliases: [`license-key-sha256:${bindingDigest}`]
      }
    });
    expect(evaluateAdminOfflineAuthorization(args))
      .toMatchObject({ eligible: false, reason: REASON.DEVICE_OR_TENANT_INCOMPATIBLE });
  });

  it('caps authority at local license expiry without extending it', () => {
    const args = fixture();
    const licenseExpiry = verifiedAt + 2 * DAY;
    const result = evaluateAdminOfflineAuthorization({
      ...args,
      license: { ...args.license, localExpiry: new Date(licenseExpiry).toISOString() },
      now: licenseExpiry,
      lastSeen: null
    });
    expect(result).toMatchObject({ eligible: false, reason: REASON.LICENSE_NOT_ELIGIBLE });
  });

  it('caps authority at commercial expiry or its active grace end', () => {
    const args = fixture();
    const commercialExpiry = verifiedAt + 2 * DAY;
    const atCommercialExpiry = evaluateAdminOfflineAuthorization({
      ...args,
      license: { ...args.license, expires_at: new Date(commercialExpiry).toISOString() },
      now: commercialExpiry,
      lastSeen: null
    });
    expect(atCommercialExpiry.eligible).toBe(false);

    const graceEnd = verifiedAt + 4 * DAY;
    const inGrace = evaluateAdminOfflineAuthorization({
      ...args,
      license: {
        ...args.license,
        status: 'expired',
        expires_at: new Date(commercialExpiry).toISOString(),
        grace_period_ends: new Date(graceEnd).toISOString()
      },
      now: commercialExpiry + 1,
      lastSeen: null
    });
    expect(inGrace.eligible).toBe(true);
    expect(inGrace.effectiveExpiresAt).toBe(new Date(graceEnd).toISOString());
  });

  it.each([
    ['Free', { plan_code: 'free_trial', max_devices: 1 }],
    ['PRO', { plan_code: 'pro_monthly', max_devices: 5 }]
  ])('permits an active %s license within all session limits', (_name, plan) => {
    const args = fixture();
    expect(evaluateAdminOfflineAuthorization({
      ...args,
      license: { ...args.license, ...plan },
      lastSeen: null
    }).eligible).toBe(true);
  });

  it.each([
    ['missing proof', { evidence: null }, REASON.EVIDENCE_MISSING],
    ['future validation timestamp', { evidence: { ...fixture().evidence, validatedAt: verifiedAt + 1 } }, REASON.TIME_INVALID_OR_SUSPICIOUS],
    ['malformed validation timestamp', { evidence: { ...fixture().evidence, validatedAt: 'not-a-date' } }, REASON.TIME_INVALID_OR_SUSPICIOUS],
    ['malformed session expiry', { evidence: { ...fixture().evidence, expiresAt: 'bad' } }, REASON.TIME_INVALID_OR_SUSPICIOUS],
    ['missing session credentials', { credentials: { ...fixture().credentials, adminToken: null, adminSessionId: null } }, REASON.EVIDENCE_MISSING],
    ['changed session id', { credentials: { ...fixture().credentials, adminSessionId: 'session-b' } }, REASON.ADMIN_IDENTITY_INCONSISTENT],
    ['changed token', { credentials: { ...fixture().credentials, adminTokenDigest: 'changed' } }, REASON.ADMIN_IDENTITY_INCONSISTENT],
    ['changed administrator', { adminUser: { id: 'admin-b' } }, REASON.ADMIN_IDENTITY_INCONSISTENT],
    ['changed device', { deviceRef: 'device-ref-b' }, REASON.DEVICE_OR_TENANT_INCOMPATIBLE],
    ['changed device security token', { deviceTokenDigest: 'changed' }, REASON.DEVICE_OR_TENANT_INCOMPATIBLE],
    ['changed tenant', { tenantOpaqueId: 'tenant-b' }, REASON.DEVICE_OR_TENANT_INCOMPATIBLE],
    ['tenant alias mismatch', { tenantBinding: { tenantIdentity: 'license-id:license-b', tenantAliases: ['license-id:license-b'] } }, REASON.DEVICE_OR_TENANT_INCOMPATIBLE],
    ['ambiguous Admin and Staff credentials', { credentials: { ...fixture().credentials, staffToken: 'staff-token' } }, REASON.CREDENTIALS_AMBIGUOUS],
    ['Staff-only credentials', { credentials: { ...fixture().credentials, adminToken: null, adminSessionId: null, staffToken: 'staff-token', staffSessionId: 'staff-session' } }, REASON.STAFF_OFFLINE_DENIED],
    ['known revoked license', { license: { ...fixture().license, is_revoked: true } }, REASON.LICENSE_NOT_ELIGIBLE],
    ['known released device', { license: { ...fixture().license, device_released: true } }, REASON.LICENSE_NOT_ELIGIBLE],
    ['known device limit block after downgrade', { license: { ...fixture().license, plan_code: 'free_trial', max_devices_exceeded: true } }, REASON.LICENSE_NOT_ELIGIBLE],
    ['local storage failure', { storageUnavailable: true }, REASON.LOCAL_STORAGE_UNAVAILABLE],
    ['failed Actor Runtime restore', { actorRuntimeRestoreError: new Error('restore failed') }, REASON.ACTOR_RUNTIME_RESTORE_FAILED],
    ['authoritative server denial', { verificationResult: { verificationStatus: 'authoritative_denial', code: 'ADMIN_SESSION_EXPIRED' } }, REASON.AUTHORITATIVE_DENIAL]
  ])('denies %s', (_name, overrides, reason) => {
    const result = evaluateAdminOfflineAuthorization({ ...fixture(), ...overrides });
    expect(result).toMatchObject({ eligible: false, reason });
  });

  it('requires a restored Admin Actor Runtime to match the same identity and tenant', () => {
    const args = fixture();
    const baseRuntime = {
      status: 'granted', actorType: 'admin', actorId: ids.admin,
      sessionId: ids.session, deviceRef: ids.deviceRef,
      tenant: { opaqueId: ids.tenant }
    };
    expect(evaluateAdminOfflineAuthorization({ ...args, actorRuntime: baseRuntime }).eligible).toBe(true);
    expect(evaluateAdminOfflineAuthorization({ ...args, actorRuntime: { ...baseRuntime, actorId: 'admin-b' } }))
      .toMatchObject({ eligible: false, reason: REASON.ADMIN_IDENTITY_INCONSISTENT });
    expect(evaluateAdminOfflineAuthorization({ ...args, actorRuntime: { ...baseRuntime, tenant: { opaqueId: 'tenant-b' } } }))
      .toMatchObject({ eligible: false, reason: REASON.DEVICE_OR_TENANT_INCOMPATIBLE });
    expect(evaluateAdminOfflineAuthorization({ ...args, actorRuntime: { ...baseRuntime, status: 'locked' } }))
      .toMatchObject({ eligible: false, reason: REASON.ACTOR_RUNTIME_RESTORE_FAILED });
  });

  it('treats UTC timestamps consistently across timezone offsets', () => {
    const args = fixture();
    args.evidence.validatedAt = '2026-10-01T14:00:00+02:00';
    const result = evaluateAdminOfflineAuthorization({ ...args, now: verifiedAt + DAY, lastSeen: null });
    expect(result.eligible).toBe(true);
    expect(result.validatedAt).toBe(verifiedAt);
  });

  it('rejects any wall-clock rollback after a browser restart', () => {
    expect(resolveAdminOfflineTime({ now: verifiedAt - 1, lastSeen: verifiedAt }))
      .toMatchObject({ valid: false, reason: REASON.TIME_INVALID_OR_SUSPICIOUS });
    expect(resolveAdminOfflineTime({ now: verifiedAt - 60 * 60 * 1000, lastSeen: verifiedAt }))
      .toMatchObject({ valid: false, reason: REASON.TIME_INVALID_OR_SUSPICIOUS });
    expect(resolveAdminOfflineTime({ now: verifiedAt - 25 * 60 * 60 * 1000, lastSeen: verifiedAt }))
      .toMatchObject({ valid: false, reason: REASON.TIME_INVALID_OR_SUSPICIOUS });
    expect(resolveAdminOfflineTime({ now: verifiedAt + 8 * DAY, lastSeen: verifiedAt }))
      .toMatchObject({ valid: true, effectiveNow: verifiedAt + 8 * DAY });
  });

  it.each([
    [{ verificationStatus: 'transport_unavailable' }, true],
    [{ verificationStatus: 'server_error', code: 'SESSION_SERVER_HTTP_503' }, true],
    [{ verificationStatus: 'server_error', code: 'SESSION_RATE_LIMITED' }, true],
    [{ verificationStatus: 'server_error', code: 'SESSION_GATEWAY_HTTP_401' }, false],
    [{ verificationStatus: 'server_error', code: 'SESSION_GATEWAY_HTTP_403' }, false],
    [{ verificationStatus: 'server_error', code: 'SESSION_SERVER_ERROR' }, false],
    [{ verificationStatus: 'invalid_response' }, false],
    [{ verificationStatus: 'authoritative_denial' }, false]
  ])('classifies only safe verification failures for offline continuity: %o', (failure, safe) => {
    expect(isSafeAdminOfflineVerificationFailure(failure)).toBe(safe);
  });
});
