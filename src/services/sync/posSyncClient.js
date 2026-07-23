import {
  supabaseClient,
  getStableDeviceId,
  getDeviceSecurityToken,
  getActorSessionToken
} from '../supabase';
import { SYNC_LIMITS } from './syncConstants';

export const buildPosSyncAuthContext = async ({ licenseKey }) => {
  const deviceFingerprint = await getStableDeviceId();
  const securityToken = await getDeviceSecurityToken();
  // El argumento historico p_staff_session_token transporta la sesion del actor:
  // admin para un dispositivo admin, staff para un dispositivo staff.
  const staffSessionToken = await getActorSessionToken();

  return {
    licenseKey,
    deviceFingerprint,
    securityToken,
    staffSessionToken
  };
};

const normalizePullResponse = (data, sinceChangeSeq = 0) => {
  const payload = typeof data === 'string' ? JSON.parse(data) : (data || {});
  const events = Array.isArray(payload.events) ? payload.events : [];

  return {
    success: payload.success !== false,
    code: payload.code || null,
    message: payload.message || null,
    events,
    latestChangeSeq: Number(payload.latest_change_seq ?? payload.latestChangeSeq ?? sinceChangeSeq) || 0,
    serverLatestChangeSeq: Number(payload.server_latest_change_seq ?? payload.serverLatestChangeSeq ?? payload.latest_change_seq ?? sinceChangeSeq) || 0,
    hasMore: Boolean(payload.has_more ?? payload.hasMore),
    syncContext: payload.sync_context || payload.syncContext || null,
    raw: payload
  };
};

export const posSyncClient = {
  async pullSyncEvents({
    licenseKey,
    sinceChangeSeq = 0,
    limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT
  }) {
    if (!supabaseClient) {
      throw new Error('SUPABASE_NOT_CONFIGURED');
    }

    if (!licenseKey) {
      throw new Error('LICENSE_KEY_REQUIRED');
    }

    const authContext = await buildPosSyncAuthContext({ licenseKey });

    if (!authContext.deviceFingerprint || !authContext.securityToken) {
      throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
    }

    const { data, error } = await supabaseClient.rpc('pos_pull_sync_events', {
      p_license_key: authContext.licenseKey,
      p_device_fingerprint: authContext.deviceFingerprint,
      p_security_token: authContext.securityToken,
      p_staff_session_token: authContext.staffSessionToken || null,
      p_since_change_seq: sinceChangeSeq,
      p_limit: Math.min(Math.max(Number(limit) || SYNC_LIMITS.DEFAULT_PULL_LIMIT, 1), SYNC_LIMITS.MAX_PULL_LIMIT)
    });

    if (error) {
      throw error;
    }

    return normalizePullResponse(data, sinceChangeSeq);
  }
};

export default posSyncClient;
