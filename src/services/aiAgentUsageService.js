import { loadData, STORES } from './database';
import { getDeviceSecurityToken, getStableDeviceId, supabaseClient } from './supabase';
import {
  CLOUD_REQUEST_COOLDOWN,
  CLOUD_REQUEST_TAGS,
  CLOUD_REQUEST_TTL,
  buildCloudRequestKey,
  cloudRequestManager,
  cloudRequestTags
} from './cloud';

const EDGE_FUNCTION_NAME = import.meta.env.VITE_AI_EDGE_FUNCTION || 'lanzo-ai-agent';
const AI_AGENT_USAGE_RESOURCE = 'edge:lanzo-ai-agent:usage';

const readLocalLicense = () => {
  try {
    const stored = localStorage.getItem('lanzo_license');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return parsed?.data || null;
  } catch {
    return null;
  }
};

const readSyncCacheValue = async (key) => {
  try {
    const record = await loadData(STORES.SYNC_CACHE, key);
    return record?.value || null;
  } catch {
    return null;
  }
};

const buildAIAgentAuthContext = async () => {
  const localLicense = readLocalLicense();

  return {
    licenseKey: localLicense?.license_key || localLicense?.licenseKey || localLicense?.key || null,
    deviceFingerprint: await getStableDeviceId(),
    deviceSecurityToken: await getDeviceSecurityToken(),
    staffSessionToken: await readSyncCacheValue('staff_session_token')
  };
};

const safeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const safeText = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const normalizeUsage = (data = {}) => {
  const limit = Math.max(safeNumber(data.limit, 0), 0);
  const used = Math.max(safeNumber(data.used, 0), 0);
  const remaining = Math.max(safeNumber(data.remaining, limit - used), 0);
  const periodId = safeText(data.period_id || data.periodId);

  return {
    success: data.success === true,
    limit,
    used,
    remaining,
    planCode: data.plan_code || data.planCode || null,
    planName: data.plan_name || data.planName || null,
    code: data.code || null,
    message: data.message || null,
    aiAgents: data.ai_agents === true || data.aiAgents === true,
    periodId,
    periodType: data.period_type || data.periodType || null,
    periodStatus: data.period_status || data.periodStatus || null,
    periodStart: safeText(data.period_start || data.periodStart),
    periodEnd: safeText(data.period_end || data.periodEnd),
    isPeriodScoped: Boolean(periodId)
  };
};

const buildUsageRequestKey = (auth = {}) => buildCloudRequestKey({
  resource: AI_AGENT_USAGE_RESOURCE,
  context: {
    licenseKey: auth.licenseKey,
    deviceId: auth.deviceFingerprint,
    staffSessionToken: auth.staffSessionToken || null
  }
});

const normalizeUsageError = (error) => normalizeUsage({
  success: false,
  code: error?.code || 'EDGE_FUNCTION_ERROR',
  message: error?.message || 'No se pudo consultar el uso de IA.'
});

export const getAIAgentUsage = async ({ force = false } = {}) => {
  if (!supabaseClient) {
    return normalizeUsage({
      success: false,
      code: 'SUPABASE_NOT_CONFIGURED',
      message: 'Supabase no está configurado para consultar el uso de IA.'
    });
  }

  const auth = await buildAIAgentAuthContext();

  if (!auth.licenseKey || !auth.deviceFingerprint || !auth.deviceSecurityToken) {
    return normalizeUsage({
      success: false,
      code: 'AUTH_PAYLOAD_REQUIRED',
      message: 'Faltan datos locales para consultar el uso de IA.'
    });
  }

  try {
    return await cloudRequestManager.request({
      key: buildUsageRequestKey(auth),
      ttlMs: CLOUD_REQUEST_TTL.MEDIUM,
      cooldownMs: CLOUD_REQUEST_COOLDOWN.REPORTS,
      force,
      tags: [
        CLOUD_REQUEST_TAGS.LICENSE,
        cloudRequestTags.license(auth.licenseKey),
        cloudRequestTags.device(auth.deviceFingerprint),
        AI_AGENT_USAGE_RESOURCE
      ],
      fn: async () => {
        const { data, error } = await supabaseClient.functions.invoke(EDGE_FUNCTION_NAME, {
          body: {
            action: 'usage',
            auth
          }
        });

        if (error) {
          const edgeError = new Error(error.message || 'No se pudo consultar el uso de IA.');
          edgeError.code = error.code || 'EDGE_FUNCTION_ERROR';
          edgeError.cause = error;
          throw edgeError;
        }

        return normalizeUsage(data);
      }
    });
  } catch (error) {
    return normalizeUsageError(error);
  }
};

export default { getAIAgentUsage };
