import { describe, expect, it } from 'vitest';
import { cloudRequestManager } from './cloudRequestManager';
import { isCriticalCloudRpcName } from './cloudCriticalRpcGuards';

describe('cloud critical RPC guardrails', () => {
  it('identifica RPCs críticas y permite lecturas cacheables', () => {
    expect(isCriticalCloudRpcName('pos_create_cloud_sale_cashier')).toBe(true);
    expect(isCriticalCloudRpcName('pos_record_customer_payment')).toBe(true);
    expect(isCriticalCloudRpcName('pos_migrate_local_customer_credit')).toBe(true);
    expect(isCriticalCloudRpcName('pos_pull_sales_snapshot')).toBe(false);
    expect(isCriticalCloudRpcName('pos_get_sales_final_overview')).toBe(false);
  });

  it('bloquea RPCs críticas en CloudRequestManager', async () => {
    await expect(cloudRequestManager.request({
      key: 'test-critical-cloud-rpc',
      rpcName: 'pos_create_cloud_sale_cashier',
      fn: () => Promise.resolve({ success: true })
    })).rejects.toMatchObject({
      code: 'CRITICAL_RPC_MUST_NOT_USE_CLOUD_REQUEST_MANAGER',
      rpcName: 'pos_create_cloud_sale_cashier'
    });
  });
});
