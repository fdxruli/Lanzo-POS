// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createEcommerceAdminService } from '../ecommerceAdminService';

const createService = ({
  staffSessionToken = null,
  rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null })
} = {}) => ({
  rpc,
  service: createEcommerceAdminService({
    rpc,
    isConfigured: () => true,
    getLicenseDetails: () => ({ license_key: 'license-fixture' }),
    buildAuthContext: vi.fn().mockResolvedValue({
      licenseKey: 'license-fixture',
      deviceFingerprint: 'device-fixture',
      securityToken: 'security-fixture',
      staffSessionToken
    }),
    isOnline: () => true
  })
});

describe('ecommerceAdminService', () => {
  it('sends a null staff token for an admin context', async () => {
    const { rpc, service } = createService();

    await service.getEcommercePortal();

    expect(rpc).toHaveBeenCalledWith('ecommerce_admin_get_portal', {
      p_license_key: 'license-fixture',
      p_device_fingerprint: 'device-fixture',
      p_security_token: 'security-fixture',
      p_staff_session_token: null
    });
  });

  it('sends the current staff token to all administrative RPCs', async () => {
    const { rpc, service } = createService({
      staffSessionToken: 'staff-token-fixture'
    });

    await service.getEcommercePortal();
    await service.saveEcommercePortal({ name: 'Portal' });
    await service.listPublishedProducts();
    await service.savePublishedProduct({ publicName: 'Producto' });
    await service.setProductPublished('product-fixture', true);
    await service.syncProductConfiguration({
      publishedProductId: 'published-fixture',
      configuration: { type: 'recipe', version: 1 },
      sourceRevision: 'recipe:1'
    });

    expect(rpc).toHaveBeenNthCalledWith(1, 'ecommerce_admin_get_portal', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture'
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'ecommerce_admin_upsert_portal', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture',
      p_payload: { name: 'Portal' }
    }));
    expect(rpc).toHaveBeenNthCalledWith(3, 'ecommerce_admin_list_published_products', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture'
    }));
    expect(rpc).toHaveBeenNthCalledWith(4, 'ecommerce_admin_upsert_published_product', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture',
      p_payload: { publicName: 'Producto' }
    }));
    expect(rpc).toHaveBeenNthCalledWith(5, 'ecommerce_admin_set_product_published', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture',
      p_product_id: 'product-fixture',
      p_is_published: true
    }));
    expect(rpc).toHaveBeenNthCalledWith(6, 'ecommerce_admin_sync_product_configuration', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture',
      p_published_product_id: 'published-fixture',
      p_configuration: { type: 'recipe', version: 1 },
      p_source_revision: 'recipe:1'
    }));
  });

  it('normalizes configuration sync errors to safe messages', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        code: 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE',
        message: 'detalle interno'
      },
      error: null
    });
    const { service } = createService({ rpc });

    const result = await service.syncProductConfiguration({
      publishedProductId: 'published-fixture',
      configuration: { type: 'variant_parent', version: 1 }
    });

    expect(result).toMatchObject({
      success: false,
      code: 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE',
      message: 'La configuracion contiene una referencia que no pertenece a esta licencia.'
    });
  });

  it('does not retry without a staff token after a permission denial', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        code: 'ECOMMERCE_STAFF_PERMISSION_DENIED',
        message: 'detalle no confiable'
      },
      error: null
    });
    const { service } = createService({
      staffSessionToken: 'staff-token-fixture',
      rpc
    });

    const result = await service.saveEcommercePortal({ name: 'Portal' });

    expect(result).toMatchObject({
      success: false,
      code: 'ECOMMERCE_STAFF_PERMISSION_DENIED',
      message: 'No tienes permiso para administrar el portal online.'
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][1].p_staff_session_token).toBe('staff-token-fixture');
  });
});
