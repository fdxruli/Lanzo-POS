import { describe, expect, it, vi } from 'vitest';
import { createEcommerceSiteBuilderService } from '../ecommerceSiteBuilderService';
import { createDefaultEcommerceSiteDocument } from '../../../utils/ecommerceSiteDocument';

describe('ecommerceSiteBuilderService', () => {
  const context = { p_license_key: 'license', p_device_fingerprint: 'device', p_security_token: 'token', p_staff_session_token: 'staff' };
  it('uses the shared protected context and paginates version metadata', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true, limit: 99, offset: -5, versions: [{ id: 'v1', document: { secret: true } }] }, error: null });
    const service = createEcommerceSiteBuilderService({ rpc, getContext: vi.fn().mockResolvedValue(context) });
    await service.listSiteVersions({ limit: 99, offset: -1 });
    expect(rpc).toHaveBeenCalledWith('ecommerce_admin_list_site_versions', { ...context, p_limit: 50, p_offset: 0 });
    await expect(service.listSiteVersions()).resolves.toMatchObject({ limit: 50, offset: 0, versions: [{ id: 'v1' }] });
    await expect(service.listSiteVersions()).resolves.not.toMatchObject({ versions: [{ document: expect.anything() }] });
  });
  it('maps revision conflicts and refuses invalid drafts before transport', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: false, code: 'ECOMMERCE_SITE_DRAFT_CONFLICT', message: 'internal' }, error: null });
    const service = createEcommerceSiteBuilderService({ rpc, getContext: vi.fn().mockResolvedValue(context) });
    expect(await service.saveSiteDraft({ expectedRevision: 1, document: createDefaultEcommerceSiteDocument() })).toMatchObject({ code: 'ECOMMERCE_SITE_DRAFT_CONFLICT', message: expect.stringContaining('otro dispositivo') });
    expect(await service.saveSiteDraft({ expectedRevision: 1, document: {} })).toMatchObject({ success: false, code: 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED' });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('sends the exact revision and document and exposes only requested RPC flows', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
    const service = createEcommerceSiteBuilderService({ rpc, getContext: vi.fn().mockResolvedValue(context) });
    const document = createDefaultEcommerceSiteDocument();
    await service.saveSiteDraft({ expectedRevision: 7, document });
    expect(rpc).toHaveBeenLastCalledWith('ecommerce_admin_save_site_draft', { ...context, p_expected_revision: 7, p_document: document });
    await service.publishSiteDraft();
    expect(rpc).toHaveBeenLastCalledWith('ecommerce_admin_publish_site', context);
    await service.restoreSiteVersion('version-id');
    expect(rpc).toHaveBeenLastCalledWith('ecommerce_admin_restore_site_version', { ...context, p_version_id: 'version-id' });
    await service.getSiteBuilderState();
    expect(rpc).toHaveBeenLastCalledWith('ecommerce_admin_get_site_builder', context);
    expect(rpc).toHaveBeenCalledTimes(4);
  });
});
