import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
let runtimeState;

vi.mock('../../supabase', () => ({
  supabaseClient: { rpc },
  getActorSessionToken: vi.fn(async () => 'actor-token'),
  getDeviceSecurityToken: vi.fn(async () => 'device-token'),
  getStableDeviceId: vi.fn(async () => 'device-fingerprint')
}));
vi.mock('../../../store/useAppStore', () => ({ useAppStore: { getState: () => runtimeState } }));

import {
  canManageCustomerMessageTemplates,
  resetCustomerMessageTemplate,
  resolveCustomerMessageTemplate,
  saveCustomerMessageTemplate
} from '../templateRepository';
import { getDefaultCustomerMessageTemplate } from '../defaultTemplates';

const pro = { license_key: 'LANZO-PRO', features: { customerMessageTemplates: true } };
const free = { license_key: 'LANZO-FREE', features: { customerMessageTemplates: false } };
const adminHandle = { actorType: 'admin', assertCurrent: vi.fn() };

describe('customer message template repository', () => {
  beforeEach(() => {
    runtimeState = { currentDeviceRole: 'admin', licenseDetails: pro };
    rpc.mockReset();
    adminHandle.assertCurrent.mockClear();
  });

  it('allows only Pro/Admin to manage templates', () => {
    expect(canManageCustomerMessageTemplates({ licenseDetails: pro, actorType: 'admin' })).toBe(true);
    expect(canManageCustomerMessageTemplates({ licenseDetails: pro, actorType: 'staff' })).toBe(false);
    expect(canManageCustomerMessageTemplates({ licenseDetails: free, actorType: 'admin' })).toBe(false);
  });

  it('keeps Staff and Free on the generic fallback without an RPC request', async () => {
    runtimeState.currentDeviceRole = 'staff';
    expect(await resolveCustomerMessageTemplate({ eventType: 'sale_paid', licenseDetails: pro })).toMatchObject({ source: 'default', template: null });
    expect(rpc).not.toHaveBeenCalled();
    runtimeState.currentDeviceRole = 'admin';
    expect(await resolveCustomerMessageTemplate({ eventType: 'sale_paid', licenseDetails: free })).toMatchObject({ source: 'default', template: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('resolves a valid custom template from the global Pro/Admin state', async () => {
    const template = { ...getDefaultCustomerMessageTemplate('sale_paid'), footer: 'Gracias por tu compra. Esto no es una factura.' };
    rpc.mockResolvedValueOnce({ data: { success: true, templates: [{ event_type: 'sale_paid', channel: 'image', schema_version: 1, revision: 2, template_json: template }] }, error: null });
    const result = await resolveCustomerMessageTemplate({ eventType: 'sale_paid' });
    expect(result.source).toBe('custom');
    expect(result.template).toBeTruthy();
    expect(result.template.footer).toBe('Gracias por tu compra. Esto no es una factura.');
    expect(rpc).toHaveBeenCalledWith('list_customer_message_templates', expect.objectContaining({ p_license_key: 'LANZO-PRO' }));
  });

  it('returns generic copy when an RPC fails and preserves revision conflicts', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'NETWORK', message: 'unavailable' } });
    expect(await resolveCustomerMessageTemplate({ eventType: 'sale_paid', licenseDetails: pro, actorHandle: adminHandle })).toMatchObject({ source: 'default', warning: 'NETWORK' });
    rpc.mockResolvedValueOnce({ data: { success: false, code: 'TEMPLATE_CONFLICT' }, error: null });
    const saved = await saveCustomerMessageTemplate({ eventType: 'sale_paid', template: getDefaultCustomerMessageTemplate('sale_paid'), revision: 4, licenseDetails: pro, actorHandle: adminHandle });
    expect(saved).toMatchObject({ ok: false, code: 'TEMPLATE_CONFLICT' });
  });

  it('sends the expected revision on reset and never sends a tenant id', async () => {
    rpc.mockResolvedValue({ data: { success: false, code: 'TEMPLATE_CONFLICT' }, error: null });
    const result = await resetCustomerMessageTemplate({ eventType: 'sale_paid', revision: 7, licenseDetails: pro, actorHandle: adminHandle });
    expect(result).toMatchObject({ ok: false, code: 'TEMPLATE_CONFLICT' });
    expect(rpc).toHaveBeenCalledWith('reset_customer_message_template', expect.objectContaining({ p_expected_revision: 7 }));
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('tenant_id');
  });
});
