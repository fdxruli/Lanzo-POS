import { supabaseClient } from '../supabase';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { SYNC_LIMITS } from '../sync/syncConstants';

const parseRpcPayload = (data) => {
  if (typeof data === 'string') return JSON.parse(data);
  return data || {};
};

const assertSupabase = () => {
  if (!supabaseClient) throw new Error('SUPABASE_NOT_CONFIGURED');
};

const normalizeLimit = (limit = 100) => Math.min(
  Math.max(Number(limit) || 100, 1),
  SYNC_LIMITS.MAX_PULL_LIMIT
);

const buildBaseRpcArgs = async (licenseKey) => {
  const context = await buildPosSyncAuthContext({ licenseKey });

  if (!context.licenseKey || !context.deviceFingerprint || !context.securityToken) {
    throw new Error('POS_SYNC_AUTH_CONTEXT_INCOMPLETE');
  }

  return {
    p_license_key: context.licenseKey,
    p_device_fingerprint: context.deviceFingerprint,
    p_security_token: context.securityToken,
    p_staff_session_token: context.staffSessionToken || null
  };
};

export const reportsCloudRepository = {
  async getOverviewReport({ licenseKey, dateFrom = null, dateTo = null, scope = 'mine' } = {}) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_get_reports_overview', {
      ...baseArgs,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_scope: scope || 'mine'
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async getCashReport({ licenseKey, dateFrom = null, dateTo = null, staffUserId = null, status = null, limit = 100, offset = 0 } = {}) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_get_cash_report', {
      ...baseArgs,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_staff_user_id: staffUserId,
      p_status: status,
      p_limit: normalizeLimit(limit),
      p_offset: Math.max(Number(offset) || 0, 0)
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async getCustomerCreditReport({ licenseKey, dateFrom = null, dateTo = null, customerId = null, limit = 100, offset = 0 } = {}) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_get_customer_credit_report', {
      ...baseArgs,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_customer_id: customerId,
      p_limit: normalizeLimit(limit),
      p_offset: Math.max(Number(offset) || 0, 0)
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async getProductCatalogReport({ licenseKey, dateFrom = null, dateTo = null, limit = 100, offset = 0 } = {}) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_get_product_catalog_report', {
      ...baseArgs,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_limit: normalizeLimit(limit),
      p_offset: Math.max(Number(offset) || 0, 0)
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async getTimeseriesReport({ licenseKey, metric = 'cash_entries', granularity = 'day', dateFrom = null, dateTo = null } = {}) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_get_report_timeseries', {
      ...baseArgs,
      p_metric: metric,
      p_granularity: granularity,
      p_date_from: dateFrom,
      p_date_to: dateTo
    });
    if (error) throw error;
    return parseRpcPayload(data);
  },

  async exportReportData({ licenseKey, reportType = 'cash_movements', dateFrom = null, dateTo = null, limit = 1000, offset = 0 } = {}) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    const { data, error } = await supabaseClient.rpc('pos_export_report_data', {
      ...baseArgs,
      p_report_type: reportType,
      p_date_from: dateFrom,
      p_date_to: dateTo,
      p_limit: Math.min(Math.max(Number(limit) || 1000, 1), 5000),
      p_offset: Math.max(Number(offset) || 0, 0)
    });
    if (error) throw error;
    return parseRpcPayload(data);
  }
};

export default reportsCloudRepository;
