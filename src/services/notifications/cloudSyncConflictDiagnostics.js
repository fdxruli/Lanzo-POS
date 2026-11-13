import { supabaseClient } from '../supabase';
import { buildRpcAuthArgs } from './cloudNotificationService';

export const isSyncDiagnosticsRpcMissing = (error) => (
  error?.code === 'PGRST202' || error?.code === '42883'
);

const asGroups = (value) => {
  if (!Array.isArray(value)) throw new Error('INVALID_SYNC_DIAGNOSTIC_RESPONSE');
  return value.map(({ type, count }) => {
    if (typeof type !== 'string' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('INVALID_SYNC_DIAGNOSTIC_RESPONSE');
    }
    return { type, count };
  });
};

export async function fetchCloudSyncConflictDiagnostics(licenseDetails) {
  if (!supabaseClient) throw new Error('SUPABASE_NOT_CONFIGURED');

  const args = await buildRpcAuthArgs(licenseDetails);
  const { data, error } = await supabaseClient.rpc('pos_get_sync_conflict_diagnostics_v1', args);
  if (error) {
    if (isSyncDiagnosticsRpcMissing(error)) return { available: false, summary: null };
    throw error;
  }

  const payload = typeof data === 'string' ? JSON.parse(data) : data;
  if (payload?.success !== true || !Number.isSafeInteger(payload.pending_count) || payload.pending_count < 0) {
    throw new Error('INVALID_SYNC_DIAGNOSTIC_RESPONSE');
  }

  return {
    available: true,
    summary: {
      pendingCount: payload.pending_count,
      entities: asGroups(payload.entities),
      conflictTypes: asGroups(payload.conflict_types),
      lastIncidentAt: typeof payload.last_incident_at === 'string' ? payload.last_incident_at : null,
      checkedAt: typeof payload.checked_at === 'string' ? payload.checked_at : null
    }
  };
}
