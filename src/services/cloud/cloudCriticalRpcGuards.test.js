import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudRequestManager } from './cloudRequestManager';
import { isCriticalCloudRpcName } from './cloudCriticalRpcGuards';

beforeEach(() => {
  cloudRequestManager.clear();
});

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

  it('no cachea payload RATE_LIMITED y activa backoff temporal', async () => {
    const key = `rate-limited-${Date.now()}`;

    await expect(cloudRequestManager.request({
      key,
      rpcName: 'pos_get_sales_final_overview',
      ttlMs: 60_000,
      fn: () => Promise.resolve({
        success: false,
        code: 'RATE_LIMITED',
        message: 'Demasiadas solicitudes. Intenta nuevamente en unos segundos.',
        retry_after_seconds: 12
      })
    })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 12,
      retryAfterMs: 12_000
    });

    expect(cloudRequestManager.getStats()).toMatchObject({
      cacheSize: 0,
      backoffSize: 1
    });

    const fn = vi.fn(() => Promise.resolve({ success: true }));

    await expect(cloudRequestManager.request({
      key,
      rpcName: 'pos_get_sales_final_overview',
      ttlMs: 60_000,
      fn
    })).rejects.toMatchObject({
      code: 'CLOUD_REQUEST_BACKOFF_ACTIVE'
    });

    expect(fn).not.toHaveBeenCalled();
  });
});
