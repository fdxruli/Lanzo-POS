import { describe, expect, it } from 'vitest';
import {
  classifyAdminAccessDiscoveryFailure,
  classifySessionVerificationResponse,
  createLocalCredentialsMissingResult,
  createLocalStorageErrorResult,
  isAuthoritativeSessionDenial,
  isSessionVerificationInconclusive,
  SESSION_VERIFICATION_STATUS
} from '../sessionVerification';

describe('session verification result classification', () => {
  it('recognizes only a complete positive RPC result as verified', () => {
    expect(classifySessionVerificationResponse('admin', {
      data: { success: true, valid: true }
    })).toMatchObject({
      success: true,
      valid: true,
      verificationStatus: SESSION_VERIFICATION_STATUS.VERIFIED
    });
  });

  it.each([
    ['admin', 'ADMIN_SESSION_INVALID'],
    ['admin', 'ADMIN_SESSION_EXPIRED'],
    ['admin', 'ADMIN_DEVICE_REQUIRED'],
    ['admin', 'LICENSE_EXPIRED'],
    ['staff', 'SESSION_NOT_FOUND'],
    ['staff', 'SESSION_EXPIRED'],
    ['staff', 'STAFF_USER_INACTIVE']
  ])('recognizes an explicit %s denial for %s', (actorType, code) => {
    const result = classifySessionVerificationResponse(actorType, {
      data: { success: false, valid: false, code }
    });

    expect(isAuthoritativeSessionDenial(result)).toBe(true);
    expect(result.credentialDisposition).toBe('clear');
  });

  it.each([
    [{ name: 'TypeError', message: 'Failed to fetch' }, SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE],
    [{ name: 'AbortError', message: 'request aborted' }, SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE],
    [{ code: 'ETIMEDOUT', message: 'timed out' }, SESSION_VERIFICATION_STATUS.TRANSPORT_UNAVAILABLE],
    [{ status: 503, code: 'PGRST000' }, SESSION_VERIFICATION_STATUS.SERVER_ERROR],
    [{ status: 429, code: 'PGRST003' }, SESSION_VERIFICATION_STATUS.SERVER_ERROR],
    [{ status: 401, code: 'PGRST301' }, SESSION_VERIFICATION_STATUS.SERVER_ERROR],
    [{ status: 403, code: '42501' }, SESSION_VERIFICATION_STATUS.SERVER_ERROR]
  ])('keeps technical response %o separate from an authorization denial', (error, expectedStatus) => {
    const result = classifySessionVerificationResponse('admin', { error });

    expect(result.verificationStatus).toBe(expectedStatus);
    expect(isAuthoritativeSessionDenial(result)).toBe(false);
    expect(isSessionVerificationInconclusive(result)).toBe(true);
  });

  it.each(['RATE_LIMITED', 'AUTH_RATE_LIMITED'])('treats the SQL %s response as retryable server state', (code) => {
    const result = classifySessionVerificationResponse('admin', {
      data: { success: false, valid: false, code, retry_after_seconds: 30 }
    });

    expect(result).toMatchObject({
      verificationStatus: SESSION_VERIFICATION_STATUS.SERVER_ERROR,
      code,
      retryAfterSeconds: 30
    });
    expect(isAuthoritativeSessionDenial(result)).toBe(false);
    expect(isSessionVerificationInconclusive(result)).toBe(true);
  });

  it.each([
    null,
    [],
    { success: true },
    { success: false, valid: false, code: 'FUTURE_UNKNOWN_CODE' }
  ])('rejects malformed or unrecognized response %o without treating it as a revocation', (data) => {
    const result = classifySessionVerificationResponse('admin', { data });

    expect(result.verificationStatus).toBe(SESSION_VERIFICATION_STATUS.INVALID_RESPONSE);
    expect(isAuthoritativeSessionDenial(result)).toBe(false);
    expect(result.credentialDisposition).toBeUndefined();
  });

  it('does not accept contradictory positive results carrying an authoritative denial code', () => {
    const result = classifySessionVerificationResponse('admin', {
      data: { success: true, valid: true, code: 'ADMIN_SESSION_INVALID' }
    });

    expect(result.verificationStatus).toBe(SESSION_VERIFICATION_STATUS.INVALID_RESPONSE);
    expect(isAuthoritativeSessionDenial(result)).toBe(false);
  });

  it('reports missing local credentials and storage failures as separate categories', () => {
    expect(createLocalCredentialsMissingResult('admin', ['admin_session_token'])).toMatchObject({
      verificationStatus: SESSION_VERIFICATION_STATUS.LOCAL_CREDENTIALS_MISSING,
      missingCredentials: ['admin_session_token']
    });
    expect(createLocalStorageErrorResult('staff')).toMatchObject({
      verificationStatus: SESSION_VERIFICATION_STATUS.LOCAL_STORAGE_ERROR
    });
  });

  it('keeps unknown access-discovery outcomes inconclusive and recognizes listed business denials', () => {
    expect(classifyAdminAccessDiscoveryFailure({ valid: false, message: 'Failed to fetch' }))
      .toMatchObject({ verificationStatus: SESSION_VERIFICATION_STATUS.INVALID_RESPONSE });
    expect(classifyAdminAccessDiscoveryFailure({ valid: false, code: 'DEVICE_LIMIT_REACHED' }))
      .toMatchObject({ verificationStatus: SESSION_VERIFICATION_STATUS.AUTHORITATIVE_DENIAL });
  });
});
