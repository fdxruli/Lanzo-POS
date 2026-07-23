// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  buildDefaultEcommerceAdminAuthContext,
  createEcommerceAdminService,
  getEcommerceAdminAuthorizationContext,
  normalizeEcommerceAdminFailure
} from '../ecommerceAdminService';
import {
  ECOMMERCE_CONFIGURATION_SYNC_KEYS,
  ECOMMERCE_OPTION_GROUP_SYNC_KEYS,
  ECOMMERCE_OPTION_SYNC_KEYS,
  ECOMMERCE_VARIANT_SYNC_KEYS
} from '../../../utils/ecommerceProductConfigurationSync';

const syncMocks = vi.hoisted(() => ({ buildPosSyncAuthContext: vi.fn() }));
vi.mock('../../sync/posSyncClient', () => ({ buildPosSyncAuthContext: syncMocks.buildPosSyncAuthContext }));

const createService = ({
  staffSessionToken = null,
  deviceRole = 'admin',
  rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null })
} = {}) => ({
  rpc,
  buildAuthContext: vi.fn().mockResolvedValue({
    licenseKey: 'license-fixture',
    deviceFingerprint: 'device-fixture',
    securityToken: 'security-fixture',
    staffSessionToken
  }),
  service: createEcommerceAdminService({
    rpc,
    isConfigured: () => true,
    getLicenseDetails: () => ({ license_key: 'license-fixture', device_role: deviceRole }),
    buildAuthContext: vi.fn().mockResolvedValue({
      licenseKey: 'license-fixture',
      deviceFingerprint: 'device-fixture',
      securityToken: 'security-fixture',
      staffSessionToken
    }),
    isOnline: () => true
  })
});

const sortedKeys = (value) => Object.keys(value).sort();

const configurableProduct = {
  id: 'local-configurable',
  name: 'Tenis Urban',
  serverVersion: 12,
  variants: [{
    id: 'local-variant-id',
    sourceVariantRef: 'urban-black-26',
    sourceProductId: 'sku-urban-black-26',
    sku: 'urban-black-26',
    publicName: 'Negro / 26',
    optionValues: { color: 'Negro', talla: '26' },
    priceMode: 'delta',
    priceValue: 50,
    stockMode: 'exact',
    stockSnapshot: 3,
    sourceAvailable: true
  }],
  modifiers: [{
    id: 'local-group-id',
    sourceGroupRef: 'extras',
    name: 'Extras',
    selectionType: 'multiple',
    required: true,
    minSelect: 1,
    maxSelect: 2,
    options: [{
      id: 'local-option-cheese',
      sourceOptionRef: 'cheese',
      name: 'Queso extra',
      priceDelta: 15,
      sourceIngredientId: 'ingredient-cheese',
      ingredientQuantity: 1,
      ingredientUnit: 'pza',
      tracksInventory: true
    }, {
      id: 'local-option-onion',
      sourceOptionRef: 'without-onion',
      name: 'Sin cebolla',
      priceDelta: 0,
      tracksInventory: false
    }]
  }]
};

const completeProjection = {
  publishedProductId: 'published-fixture',
  localProductRef: configurableProduct.id,
  sourceRevision: 'version:12',
  sourceState: 'in_stock',
  sourceAvailable: true,
  stockSnapshot: 3,
  fields: {
    name: 'Tenis Urban',
    description: null,
    category: 'Calzado',
    price: 900,
    image: null
  },
  configuration: {
    type: 'variant_parent',
    version: 1,
    hasRecipe: false,
    variants: [{
      sourceVariantRef: 'urban-black-26',
      sourceProductId: 'sku-urban-black-26',
      localProductRef: 'sku-urban-black-26',
      sku: 'URBAN-BLACK-26',
      publicName: 'Negro / 26',
      optionValues: { color: 'Negro', talla: '26' },
      priceMode: 'delta',
      priceValue: 50,
      imageUrl: null,
      imageRef: null,
      trackStock: true,
      stockMode: 'exact',
      stockSnapshot: 3,
      sourceAvailable: true,
      manualAvailable: true,
      displayOrder: 0,
      sourceRevision: null,
      metadata: {}
    }],
    optionGroups: [],
    availabilitySource: 'variant_aggregate',
    availabilityReasonCode: 'SOURCE_STOCK_AVAILABLE',
    limitingSource: { productId: null, name: null }
  },
  configurationSourceRevision: 'version:12'
};

describe('ecommerceAdminService', () => {
  it('builds direct authorization context with the canonical admin role and historical actor field', async () => {
    const buildAuthContext = vi.fn().mockResolvedValue({
      licenseKey: 'license-fixture', deviceFingerprint: 'device-fixture', securityToken: 'security-fixture', staffSessionToken: 'admin-token'
    });
    await expect(getEcommerceAdminAuthorizationContext({
      isConfigured: () => true,
      isOnline: () => true,
      getLicenseDetails: () => ({ license_key: 'license-fixture', device_role: 'admin' }),
      buildAuthContext
    })).resolves.toMatchObject({ p_staff_session_token: 'admin-token' });
    expect(buildAuthContext).toHaveBeenCalledWith({ licenseKey: 'license-fixture', deviceRole: 'admin' });
  });

  it('normalizes the distinct actor-session errors without exposing RPC details', () => {
    expect(normalizeEcommerceAdminFailure({ code: 'ECOMMERCE_STAFF_SESSION_INVALID', message: 'internal' })).toMatchObject({
      code: 'ECOMMERCE_STAFF_SESSION_INVALID',
      message: 'Tu sesion de personal no es valida. Inicia sesion nuevamente.'
    });
  });

  it('delegates default auth construction with the canonical actor role', async () => {
    syncMocks.buildPosSyncAuthContext.mockResolvedValue({ deviceFingerprint: 'device-fixture', securityToken: 'security-fixture', staffSessionToken: 'actor-token' });
    await buildDefaultEcommerceAdminAuthContext({ licenseKey: 'license-fixture', deviceRole: 'admin' });
    expect(syncMocks.buildPosSyncAuthContext).toHaveBeenCalledWith({ licenseKey: 'license-fixture', deviceRole: 'admin' });
  });

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

  it('keeps the canonical role when building the actor authorization context', async () => {
    const buildAuthContext = vi.fn().mockResolvedValue({
      licenseKey: 'license-fixture', deviceFingerprint: 'device-fixture', securityToken: 'security-fixture', staffSessionToken: 'actor-token'
    });
    const rpc = vi.fn().mockResolvedValue({ data: { success: true }, error: null });
    const service = createEcommerceAdminService({
      rpc,
      isConfigured: () => true,
      getLicenseDetails: () => ({ license_key: 'license-fixture', device_role: 'staff' }),
      buildAuthContext,
      isOnline: () => true
    });
    await service.getEcommercePortal();
    expect(buildAuthContext).toHaveBeenCalledWith({ licenseKey: 'license-fixture', deviceRole: 'staff' });
    expect(rpc).toHaveBeenCalledWith('ecommerce_admin_get_portal', expect.objectContaining({
      p_staff_session_token: 'actor-token'
    }));
  });

  it('preserves the staff token in legacy and configuration RPCs', async () => {
    const { rpc, service } = createService({ staffSessionToken: 'staff-token-fixture' });

    await service.getEcommercePortal();
    await service.saveEcommercePortal({ name: 'Portal' });
    await service.listPublishedProducts();
    await service.savePublishedProduct({ publicName: 'Producto' });
    await service.setProductPublished('product-fixture', true);
    await service.syncProductConfiguration({
      publishedProductId: 'published-fixture',
      configuration: {
        type: 'recipe',
        version: 1,
        hasRecipe: true,
        variants: [],
        optionGroups: []
      },
      sourceRevision: 'version:1'
    });

    expect(rpc).toHaveBeenNthCalledWith(1, 'ecommerce_admin_get_portal', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture'
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, 'ecommerce_admin_upsert_portal', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture'
    }));
    expect(rpc).toHaveBeenNthCalledWith(3, 'ecommerce_admin_list_published_products', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture'
    }));
    expect(rpc).toHaveBeenNthCalledWith(4, 'ecommerce_admin_upsert_published_product', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture'
    }));
    expect(rpc).toHaveBeenNthCalledWith(5, 'ecommerce_admin_set_product_published', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture'
    }));
    expect(rpc).toHaveBeenNthCalledWith(6, 'ecommerce_admin_sync_product_configuration', expect.objectContaining({
      p_staff_session_token: 'staff-token-fixture',
      p_published_product_id: 'published-fixture',
      p_source_revision: 'version:1'
    }));
  });

  it('uses the atomic v2 RPC for manual publication and sends the exact transport contract', async () => {
    const { rpc, service } = createService();

    await service.savePublishedProduct({
      id: 'published-fixture',
      localProductRef: configurableProduct.id,
      publicName: 'Tenis Urban',
      price: 900,
      localProduct: configurableProduct
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [rpcName, params] = rpc.mock.calls[0];
    expect(rpcName).toBe('ecommerce_admin_upsert_published_product_v2');
    expect(params.p_payload.localProduct).toBeUndefined();
    expect(params.p_payload.configurationSourceRevision).toBe('version:12');
    expect(sortedKeys(params.p_payload.configuration)).toEqual(
      [...ECOMMERCE_CONFIGURATION_SYNC_KEYS].sort()
    );
    expect(sortedKeys(params.p_payload.configuration.variants[0])).toEqual(
      [...ECOMMERCE_VARIANT_SYNC_KEYS].sort()
    );
    expect(sortedKeys(params.p_payload.configuration.optionGroups[0])).toEqual(
      [...ECOMMERCE_OPTION_GROUP_SYNC_KEYS].sort()
    );
    expect(sortedKeys(params.p_payload.configuration.optionGroups[0].options[0])).toEqual(
      [...ECOMMERCE_OPTION_SYNC_KEYS].sort()
    );
    expect(JSON.stringify(params.p_payload.configuration)).not.toMatch(
      /local-variant-id|local-group-id|local-option-cheese/
    );
  });

  it('transports complete automatic PRO projections without reading or enriching them again', async () => {
    const { rpc, service } = createService();
    const projections = [structuredClone(completeProjection)];

    await service.syncPublishedCatalog({
      projections,
      idempotencyKey: 'catalog-fixture',
      expectedCatalogRevision: 8
    });

    const [rpcName, params] = rpc.mock.calls[0];
    expect(rpcName).toBe('ecommerce_admin_sync_published_catalog_v2');
    expect(params.p_idempotency_key).toBe('catalog-fixture');
    expect(params.p_expected_catalog_revision).toBe(8);
    expect(params.p_projections).toBe(projections);
    expect(params.p_projections[0]).toEqual(completeProjection);
  });

  it('forwards a missing-local snapshot explicitly without inventing configuration', async () => {
    const { rpc, service } = createService();
    const projection = {
      publishedProductId: 'published-missing',
      localProductRef: 'missing-local',
      sourceRevision: null,
      sourceState: 'unverified',
      sourceAvailable: null,
      stockSnapshot: null,
      fields: {},
      configuration: null,
      configurationSourceRevision: null
    };

    await service.syncPublishedCatalog({
      projections: [projection],
      idempotencyKey: 'missing-fixture'
    });

    const params = rpc.mock.calls[0][1];
    expect(params.p_projections[0]).toBe(projection);
    expect(params.p_projections[0]).toMatchObject({
      configuration: null,
      configurationSourceRevision: null,
      sourceAvailable: null
    });
  });

  it('rejects invalid automatic projection containers before calling the RPC', async () => {
    const { rpc, service } = createService();

    const result = await service.syncPublishedCatalog({
      projections: [null],
      idempotencyKey: 'invalid-fixture'
    });

    expect(result).toMatchObject({
      success: false,
      code: 'ECOMMERCE_CATALOG_SYNC_INVALID_PAYLOAD'
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('serializes direct configuration calls instead of forwarding internal IDs', async () => {
    const { rpc, service } = createService();

    await service.syncProductConfiguration({
      publishedProductId: 'published-fixture',
      configuration: {
        type: 'variant_parent',
        version: 1,
        hasRecipe: false,
        variants: configurableProduct.variants,
        optionGroups: []
      },
      sourceRevision: 'version:12'
    });

    const params = rpc.mock.calls[0][1];
    expect(params.p_configuration.variants[0].sourceVariantRef).toBe('urban-black-26');
    expect(params.p_configuration.variants[0].id).toBeUndefined();
    expect(params.p_source_revision).toBe('version:12');
  });

  it('normalizes remote configuration errors to safe messages', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        success: false,
        code: 'ECOMMERCE_CONFIGURATION_CROSS_LICENSE_REFERENCE',
        message: 'internal detail'
      },
      error: null
    });
    const { service } = createService({ rpc });

    const result = await service.syncProductConfiguration({
      publishedProductId: 'published-fixture',
      configuration: {
        type: 'variant_parent',
        version: 1,
        hasRecipe: false,
        variants: configurableProduct.variants,
        optionGroups: []
      }
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
        message: 'untrusted detail'
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

  it('maps an admin session requirement without falling back to a staff message', async () => {
    const { service } = createService({
      rpc: vi.fn().mockResolvedValue({ data: { success: false, code: 'ECOMMERCE_ADMIN_SESSION_REQUIRED' }, error: null })
    });
    await expect(service.getEcommercePortal()).resolves.toMatchObject({
      code: 'ECOMMERCE_ADMIN_SESSION_REQUIRED',
      message: 'Inicia sesion como administrador para continuar.'
    });
  });
});
