import { supabaseClient } from '../supabase';
import { invalidateCloudCacheAfterCustomerMutation } from '../cloud';
import { buildPosSyncAuthContext } from '../sync/posSyncClient';
import { SYNC_LIMITS } from '../sync/syncConstants';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import {
  callCloudSnapshotRpc,
  callCloudSyncRpc,
  negotiateCloudSnapshotContract,
  requireCloudSnapshotContract
} from '../sync/cloudSyncProtocolV2';

const assertSupabase = () => {
  if (!supabaseClient) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
};

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

const normalizeLimit = (limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT) => Math.min(
  Math.max(Number(limit) || SYNC_LIMITS.DEFAULT_PULL_LIMIT, 1),
  SYNC_LIMITS.MAX_PULL_LIMIT
);

const invalidateAfterCustomerSuccess = (licenseKey, response) => {
  if (response?.success !== false) {
    invalidateCloudCacheAfterCustomerMutation(licenseKey);
  }
  return response;
};

export const customerCloudRepository = {
  async negotiateSnapshotProtocol({ licenseKey, actorHandle = actorRuntimeController.capture('customers'), force = false } = {}) {
    assertSupabase();
    const authArgs = await buildBaseRpcArgs(licenseKey);
    actorHandle.assertCurrent();
    const result = await negotiateCloudSnapshotContract({
      client: supabaseClient, authArgs, actorHandle, force
    });
    actorHandle.assertCurrent();
    return result;
  },
  // IMPORTANTE: las mutaciones/migraciones de clientes son críticas y NO deben pasar por CloudRequestManager.
  async upsertCustomer({ licenseKey, customer, expectedVersion = null, idempotencyKey, actorHandle = actorRuntimeController.capture('customers') }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    actorHandle.assertCurrent();

    const response = await callCloudSyncRpc({
      client: supabaseClient,
      rpcName: 'pos_upsert_customer_v2',
      authArgs: baseArgs,
      params: {
        p_customer: customer,
        p_expected_version: expectedVersion,
        p_idempotency_key: idempotencyKey
      },
      family: 'customer_directory',
      expectedCustomerId: customer?.id || null,
      expectedIdempotencyKey: idempotencyKey,
      actorHandle
    });
    actorHandle.assertCurrent();
    return invalidateAfterCustomerSuccess(licenseKey, response);
  },

  async deleteCustomer({ licenseKey, customerId, expectedVersion = null, idempotencyKey, actorHandle = actorRuntimeController.capture('customers') }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    actorHandle.assertCurrent();

    const response = await callCloudSyncRpc({
      client: supabaseClient,
      rpcName: 'pos_delete_customer_v2',
      authArgs: baseArgs,
      params: {
        p_customer_id: customerId,
        p_expected_version: expectedVersion,
        p_idempotency_key: idempotencyKey
      },
      family: 'customer_directory',
      expectedCustomerId: customerId,
      expectedIdempotencyKey: idempotencyKey,
      actorHandle
    });
    actorHandle.assertCurrent();
    return invalidateAfterCustomerSuccess(licenseKey, response);
  },

  async pullCustomerSnapshot({
    licenseKey,
    limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT,
    snapshotProtocol = null,
    snapshotReferenceChangeSeq = null,
    pageCursor = null,
    force = false,
    actorHandle = actorRuntimeController.capture('customers')
  }) {
    assertSupabase();
    actorHandle.assertCurrent('customers');
    const protocol = requireCloudSnapshotContract(snapshotProtocol
      || await this.negotiateSnapshotProtocol({ licenseKey, actorHandle, force }));
    actorHandle.assertCurrent('customers');
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    actorHandle.assertCurrent('customers');
    const response = await callCloudSnapshotRpc({
      client: supabaseClient,
      rpcName: 'pos_pull_customers_snapshot_v3',
      family: 'customer_directory',
      authArgs: baseArgs,
      params: {
        p_limit: Math.min(normalizeLimit(limit), 500),
        p_snapshot_reference_change_seq: snapshotReferenceChangeSeq,
        p_page_cursor: pageCursor
      },
      snapshotContract: protocol,
      usesV2Envelope: true,
      actorHandle
    });
    actorHandle.assertCurrent('customers');
    return response;
  },

  async pullCustomerChanges({ licenseKey, sinceChangeSeq = 0, limit = SYNC_LIMITS.DEFAULT_PULL_LIMIT, actorHandle = actorRuntimeController.capture('customers') }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    actorHandle.assertCurrent();

    const response = await callCloudSyncRpc({
      client: supabaseClient,
      rpcName: 'pos_pull_customer_changes_v2',
      authArgs: baseArgs,
      params: {
        p_since_change_seq: Math.max(Number(sinceChangeSeq) || 0, 0),
        p_limit: normalizeLimit(limit)
      },
      family: 'customer_directory',
      requireCursor: true,
      expectedChangeSeq: Math.max(Number(sinceChangeSeq) || 0, 0),
      actorHandle
    });
    actorHandle.assertCurrent();
    return response;
  },

  async migrateLocalCustomers({ licenseKey, customers = [], batchId, actorHandle = actorRuntimeController.capture('customers') }) {
    assertSupabase();
    const baseArgs = await buildBaseRpcArgs(licenseKey);
    actorHandle.assertCurrent();

    const response = await callCloudSyncRpc({
      client: supabaseClient,
      rpcName: 'pos_migrate_local_customers_v2',
      authArgs: baseArgs,
      params: { p_customers: customers, p_batch_id: batchId },
      family: 'customer_directory',
      expectedBatchId: batchId,
      actorHandle
    });
    actorHandle.assertCurrent();
    return invalidateAfterCustomerSuccess(licenseKey, response);
  }
};

export default customerCloudRepository;
