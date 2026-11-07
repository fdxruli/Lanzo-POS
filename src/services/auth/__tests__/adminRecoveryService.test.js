// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), capture: vi.fn(), current: vi.fn(), report: vi.fn() }));
vi.mock('../../supabase', () => ({ supabaseClient: { rpc: mocks.rpc } }));
vi.mock('../../sync/posSyncClient', () => ({ buildPosSyncAuthContext: mocks.auth }));
vi.mock('../actorRuntimeController', () => ({ actorRuntimeController: { capture: mocks.capture } }));
vi.mock('../actorAuthorityRecovery', () => ({ reportActorAuthorityError: mocks.report }));
import { confirmRecoveryContact, getRecoveryContact, redeemPasswordRecovery, requestRecoveryContact, requestRecoveryContactChange, validRecoveryPassword } from '../adminRecoveryService';

const respond = (response) => mocks.rpc.mockReturnValue({ abortSignal: vi.fn().mockResolvedValue(response) });
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  mocks.capture.mockReturnValue({ actorType: 'admin', assertCurrent: mocks.current });
  mocks.auth.mockResolvedValue({ deviceFingerprint: 'device', securityToken: 'device-token', staffSessionToken: 'admin-token' });
  respond({ data: { success: true }, error: null });
});
afterEach(() => vi.useRealTimers());

describe('admin recovery transport and authority', () => {
  it('requests a contact with the current Admin session and a fresh password', async () => {
    await requestRecoveryContact('FREE', ' owner@example.com ', 'Current123');
    expect(mocks.auth).toHaveBeenCalledWith({ licenseKey: 'FREE', deviceRole: 'admin' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_request_recovery_contact', {
      p_license_key: 'FREE', p_device_fingerprint: 'device', p_device_security_token: 'device-token',
      p_admin_session_token: 'admin-token', p_email: 'owner@example.com', p_current_password: 'Current123'
    });
    expect(mocks.current).toHaveBeenCalledTimes(2);
  });
  it('does not call the backend for Staff', async () => {
    mocks.capture.mockReturnValue({ actorType: 'staff', assertCurrent: mocks.current });
    expect(await getRecoveryContact('PRO')).toMatchObject({ success: false, code: 'ADMIN_SESSION_REQUIRED' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects actor changes before transmitting a secret', async () => {
    mocks.current.mockImplementationOnce(() => { throw new Error('stale'); });
    await expect(requestRecoveryContact('PRO', 'owner@example.com', 'Current123')).rejects.toThrow('stale');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('discards a response after an actor transition', async () => {
    mocks.current.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('stale'); });
    await expect(confirmRecoveryContact('PRO', 'temporary')).rejects.toThrow('stale');
  });
  it.each(['FREE', 'PRO'])('redeems without requesting actor/device credentials for %s', async (license) => {
    respond({ data: { success: true, username: 'owner' } });
    expect(await redeemPasswordRecovery(license, 'temporary', 'Newpass123')).toEqual({ success: true, username: 'owner' });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith('admin_redeem_password_recovery', {
      p_license_key: license, p_code: 'temporary', p_new_password: 'Newpass123'
    });
  });
  it('requires connection without making a request', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect(await redeemPasswordRecovery('PRO', 'code', 'Password123')).toMatchObject({ code: 'ONLINE_REQUIRED' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not claim success after a lost response or expose server messages', async () => {
    respond({ error: { message: 'secret diagnostic', code: 'NETWORK_ERROR' } });
    expect(await redeemPasswordRecovery('PRO', 'code', 'Password123')).toEqual({ success: false, code: 'RECOVERY_UNCONFIRMED' });
  });
  it('rejects malformed success without a recovered username', async () => {
    expect(await redeemPasswordRecovery('PRO', 'code', 'Password123')).toMatchObject({ code: 'RECOVERY_UNCONFIRMED' });
  });
  it('clearly reports an uninstalled RPC', async () => {
    respond({ error: { code: 'PGRST202' } });
    expect(await redeemPasswordRecovery('PRO', 'code', 'Password123')).toMatchObject({ code: 'RECOVERY_UNAVAILABLE' });
  });
  it('routes authoritative session denial through the existing recovery boundary', async () => {
    respond({ data: { success: false, code: 'ADMIN_SESSION_INVALID' } });
    await getRecoveryContact('PRO');
    expect(mocks.report).toHaveBeenCalledWith({ success: false, code: 'ADMIN_SESSION_INVALID' }, { operation: 'admin_recovery_contact_status' });
  });
  it('enforces bcrypt byte limits, including multibyte passwords', () => {
    expect(validRecoveryPassword('Password123')).toBe(true);
    expect(validRecoveryPassword('onlyletters')).toBe(false);
    expect(validRecoveryPassword('a1' + 'á'.repeat(36))).toBe(false);
    expect(validRecoveryPassword('a1' + 'á'.repeat(35))).toBe(true);
  });
});

it('uses the existing Admin authority and reauthentication transport for replacement, rejects Staff', async () => {
  await requestRecoveryContactChange('PRO',' new@example.com ','Current123');
  expect(mocks.rpc).toHaveBeenCalledWith('admin_request_recovery_contact_change', expect.objectContaining({ p_current_password:'Current123',p_email:'new@example.com',p_admin_session_token:'admin-token' }));
  mocks.rpc.mockClear();
  mocks.capture.mockReturnValue({ actorType:'staff',assertCurrent:mocks.current });
  expect(await requestRecoveryContactChange('PRO','new@example.com','Current123')).toMatchObject({ success:false,code:'ADMIN_SESSION_REQUIRED' });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
