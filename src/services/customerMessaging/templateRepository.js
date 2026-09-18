import { supabaseClient, getActorSessionToken, getDeviceSecurityToken, getStableDeviceId } from '../supabase';
import { useAppStore } from '../../store/useAppStore';
import { CUSTOMER_MESSAGE_TEMPLATE_SCHEMA_VERSION, getDefaultCustomerMessageTemplate } from './defaultTemplates';
import { validateCustomerMessageTemplate } from './templateValidator';

const featureEnabled = (licenseDetails = {}) => Boolean(
  licenseDetails?.features?.customerMessageTemplates
  || licenseDetails?.effective_features?.customerMessageTemplates
  || licenseDetails?.details?.features?.customerMessageTemplates
);

export const canManageCustomerMessageTemplates = ({ licenseDetails, actorType } = {}) => (
  featureEnabled(licenseDetails) && actorType === 'admin'
);

const resultError = (code, message = code) => ({ ok: false, code, message });

const getContext = async ({ licenseDetails = useAppStore.getState().licenseDetails, actorHandle = null } = {}) => {
  const state = useAppStore.getState();
  const actorType = actorHandle?.actorType || state.currentDeviceRole;
  if (!featureEnabled(licenseDetails)) return resultError('TEMPLATE_FEATURE_UNAVAILABLE');
  if (!supabaseClient) return resultError('SUPABASE_UNAVAILABLE');
  if (!licenseDetails?.license_key) return resultError('LICENSE_MISSING');
  actorHandle?.assertCurrent?.('settings');
  const [deviceFingerprint, securityToken, actorSessionToken] = await Promise.all([
    getStableDeviceId(),
    getDeviceSecurityToken(),
    getActorSessionToken(actorType)
  ]);
  if (!deviceFingerprint || !securityToken || !actorSessionToken) return resultError('TEMPLATE_AUTH_CONTEXT_MISSING');
  actorHandle?.assertCurrent?.('settings');
  return {
    ok: true,
    actorType,
    actorHandle,
    args: {
      p_license_key: licenseDetails.license_key,
      p_device_fingerprint: deviceFingerprint,
      p_security_token: securityToken,
      p_actor_session_token: actorSessionToken
    }
  };
};

const rpc = async (name, args, actorHandle) => {
  try {
    actorHandle?.assertCurrent?.('settings');
    const { data, error } = await supabaseClient.rpc(name, args);
    actorHandle?.assertCurrent?.('settings');
    if (error) return resultError(error.code || 'TEMPLATE_RPC_FAILED', error.message);
    if (!data?.success) return resultError(data?.code || data?.error || 'TEMPLATE_RPC_FAILED', data?.message);
    return { ok: true, ...data };
  } catch (error) {
    return resultError(error?.code || 'TEMPLATE_RPC_FAILED', error?.message);
  }
};

export const listCustomerMessageTemplates = async (options = {}) => {
  const context = await getContext(options);
  if (!context.ok) return { ...context, templates: [] };
  return rpc('list_customer_message_templates', context.args, context.actorHandle);
};

export const saveCustomerMessageTemplate = async ({ eventType, template, revision = 0, ...options } = {}) => {
  const validation = validateCustomerMessageTemplate(eventType, template);
  if (!validation.ok) return { ...resultError('TEMPLATE_VALIDATION_FAILED'), validation };
  const context = await getContext(options);
  if (!context.ok) return context;
  if (context.actorType !== 'admin') return resultError('TEMPLATE_ADMIN_REQUIRED');
  return rpc('save_customer_message_template', {
    ...context.args, p_event_type: eventType, p_template_json: template, p_expected_revision: revision
  }, context.actorHandle);
};

export const resetCustomerMessageTemplate = async ({ eventType, revision = 0, ...options } = {}) => {
  const context = await getContext(options);
  if (!context.ok) return context;
  if (context.actorType !== 'admin') return resultError('TEMPLATE_ADMIN_REQUIRED');
  return rpc('reset_customer_message_template', {
    ...context.args, p_event_type: eventType, p_expected_revision: revision
  }, context.actorHandle);
};

export const resolveCustomerMessageTemplate = async ({ eventType, ...options } = {}) => {
  const fallback = { template: null, defaultTemplate: getDefaultCustomerMessageTemplate(eventType), source: 'default', revision: 0 };
  const actorType = options.actorHandle?.actorType || useAppStore.getState().currentDeviceRole;
  // Staff and Free/Local never even request customized copy. The RPC repeats
  // this boundary so a forged client call cannot read another presentation.
  if (!featureEnabled(options.licenseDetails) || actorType !== 'admin') return fallback;
  const listed = await listCustomerMessageTemplates(options);
  if (!listed.ok) return { ...fallback, warning: listed.code };
  const row = (listed.templates || []).find((template) => template.event_type === eventType && template.channel === 'image');
  if (!row || row.schema_version !== CUSTOMER_MESSAGE_TEMPLATE_SCHEMA_VERSION) return fallback;
  const validation = validateCustomerMessageTemplate(eventType, row.template_json);
  return validation.ok
    ? { template: row.template_json, defaultTemplate: fallback.defaultTemplate, source: 'custom', revision: row.revision }
    : { ...fallback, warning: 'TEMPLATE_INCOMPATIBLE' };
};
