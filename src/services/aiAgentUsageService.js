import { loadData, STORES } from './database';
import { getDeviceSecurityToken, getStableDeviceId, supabaseClient } from './supabase';

const EDGE_FUNCTION_NAME = import.meta.env.VITE_AI_EDGE_FUNCTION || 'lanzo-ai-agent';

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

const normalizeUsage = (data = {}) => {
  const limit = Number(data.limit || 0);
  const used = Number(data.used || 0);
  const remaining = Number(data.remaining ?? Math.max(limit - used, 0));

  return {
    success: data.success === true,
    limit: Number.isFinite(limit) ? limit : 0,
    used: Number.isFinite(used) ? used : 0,
    remaining: Number.isFinite(remaining) ? Math.max(remaining, 0) : 0,
    planCode: data.plan_code || data.planCode || null,
    planName: data.plan_name || data.planName || null,
    code: data.code || null,
    message: data.message || null,
    aiAgents: data.ai_agents === true || data.aiAgents === true
  };
};

export const getAIAgentUsage = async () => {
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

  const { data, error } = await supabaseClient.functions.invoke(EDGE_FUNCTION_NAME, {
    body: {
      action: 'usage',
      auth
    }
  });

  if (error) {
    return normalizeUsage({
      success: false,
      code: error.code || 'EDGE_FUNCTION_ERROR',
      message: error.message || 'No se pudo consultar el uso de IA.'
    });
  }

  return normalizeUsage(data);
};

export default { getAIAgentUsage };
