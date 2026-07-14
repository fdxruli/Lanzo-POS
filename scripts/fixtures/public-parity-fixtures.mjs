/**
 * Deterministic, synthetic fixtures for the local-only ARCH.2 browser audit.
 * Every person, phone, address, order, token and URL in this file is fictitious.
 */

export const PARITY_FIXTURE_SLUGS = Object.freeze({
  pro: 'fixture-pro',
  free: 'fixture-free',
  missing: 'fixture-missing',
  inactive: 'fixture-inactive',
  unpublished: 'fixture-unpublished',
  invalid: 'fixture-invalid',
  rateLimited: 'fixture-rate-limited',
  offlineEmpty: 'fixture-offline-empty'
});

export const PARITY_FIXTURE_REVISIONS = Object.freeze({
  A: 2026071301,
  B: 2026071302,
  FREE: 2026071310
});

export const PARITY_FIXTURE_TOKENS = Object.freeze({
  valid: `trk1_${'A'.repeat(43)}`,
  notFound: `trk1_${'B'.repeat(43)}`,
  networkError: `trk1_${'C'.repeat(43)}`,
  malformed: `trk1_${'D'.repeat(43)}`
});

export const PARITY_TRACKING_STATUSES = Object.freeze([
  'received',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
  'attention',
  'rejected'
]);

export const PARITY_CHECKOUT_ERROR_CODES = Object.freeze([
  'ECOMMERCE_MIN_ORDER_NOT_REACHED',
  'ECOMMERCE_CATALOG_REVISION_CHANGED',
  'ECOMMERCE_PRODUCT_NOT_AVAILABLE',
  'ECOMMERCE_RATE_LIMITED',
  'ECOMMERCE_PUBLIC_NETWORK_ERROR',
  'ECOMMERCE_ORDER_CREATE_FAILED'
]);

const CACHE_POLICY = Object.freeze({
  schemaVersion: 1,
  freshSeconds: 300,
  maxStaleSeconds: 86_400
});

const basePortal = ({ slug, name, revision }) => ({
  success: true,
  portal: {
    slug,
    name,
    headline: 'Cat\u00e1logo determinista de prueba ARCH.2',
    description: 'Datos sint\u00e9ticos para una auditor\u00eda local sin escrituras remotas.',
    templateCode: 'classic',
    customizationLevel: 'advanced',
    theme: { primaryColor: '#6750A4', accentColor: '#FFB000' },
    logoUrl: 'https://fixtures.lanzo.invalid/logo.png',
    coverImageUrl: 'https://fixtures.lanzo.invalid/cover.png',
    whatsappPhone: '525500000000',
    address: 'Avenida Fixture 100, Local de Prueba',
    businessType: ['restaurant'],
    orderingEnabled: true,
    pickupEnabled: true,
    deliveryEnabled: true,
    scheduledOrdersEnabled: false,
    minOrderTotal: 50,
    maxOrderItems: 12,
    maxItemQuantity: 4,
    stockMode: 'exact',
    settings: { currency: 'MXN', timezone: 'America/Mexico_City', orderLeadMinutes: 20 }
  },
  hours: {
    weekly: [
      { weekday: 0, isOpen: true, opensAt: '09:00', closesAt: '20:00' },
      { weekday: 1, isOpen: true, opensAt: '09:00', closesAt: '20:00' },
      { weekday: 2, isOpen: true, opensAt: '09:00', closesAt: '20:00' },
      { weekday: 3, isOpen: true, opensAt: '09:00', closesAt: '20:00' },
      { weekday: 4, isOpen: true, opensAt: '09:00', closesAt: '20:00' },
      { weekday: 5, isOpen: true, opensAt: '09:00', closesAt: '20:00' },
      { weekday: 6, isOpen: true, opensAt: '09:00', closesAt: '20:00' }
    ],
    exceptions: []
  },
  features: {
    whatsappCheckout: true,
    orderInbox: true,
    customSlug: true,
    brandingCustomization: 'advanced',
    layoutCustomization: 'full',
    businessHours: true,
    deliveryPickupSettings: 'advanced',
    stockVisibility: true,
    realtimeOrders: false
  },
  catalogRevision: revision,
  cachePolicy: CACHE_POLICY
});

export const createProPortalFixture = (revision = PARITY_FIXTURE_REVISIONS.A) => (
  basePortal({
    slug: PARITY_FIXTURE_SLUGS.pro,
    name: 'Tienda Fixture PRO',
    revision
  })
);

export const createFreePortalFixture = () => {
  const result = basePortal({
    slug: PARITY_FIXTURE_SLUGS.free,
    name: 'Tienda Fixture FREE',
    revision: PARITY_FIXTURE_REVISIONS.FREE
  });
  return {
    ...result,
    portal: {
      ...result.portal,
      customizationLevel: 'basic',
      pickupEnabled: true,
      deliveryEnabled: false,
      minOrderTotal: 0,
      maxOrderItems: 10,
      maxItemQuantity: 3,
      stockMode: 'hidden'
    },
    features: {
      ...result.features,
      whatsappCheckout: false,
      customSlug: false,
      brandingCustomization: 'basic',
      layoutCustomization: 'template_only',
      deliveryPickupSettings: 'basic',
      stockVisibility: false
    }
  };
};

const product = (id, overrides = {}) => ({
  id,
  name: `Producto Fixture ${id}`,
  description: 'Producto sint\u00e9tico para pruebas locales.',
  categoryName: 'General',
  price: 25,
  currency: 'MXN',
  imageUrl: '',
  isAvailable: true,
  displayOrder: 0,
  stock: { mode: 'exact', status: 'available', quantity: 4 },
  options: {},
  ...overrides
});

const revisionAProducts = Object.freeze([
  product('taco-fixture', {
    name: 'Taco Fixture',
    description: 'Producto decimal con imagen localmente interceptada.',
    categoryName: 'Comida',
    price: 39.9,
    imageUrl: 'https://fixtures.lanzo.invalid/product.png',
    displayOrder: 1,
    stock: { mode: 'exact', status: 'available', quantity: 2 }
  }),
  product('agua-fixture', {
    name: 'Agua Fixture',
    categoryName: 'Bebidas',
    price: 20,
    displayOrder: 2,
    stock: { mode: 'exact', status: 'available', quantity: 4 }
  }),
  product('agotado-fixture', {
    name: 'Agotado Fixture',
    categoryName: 'Comida',
    price: 18,
    displayOrder: 3,
    isAvailable: false,
    stock: { mode: 'exact', status: 'out_of_stock', quantity: 0 }
  }),
  product('reconciliar-fixture', {
    name: 'Reconciliar Fixture',
    categoryName: 'Especiales',
    price: 55.5,
    displayOrder: 4,
    stock: { mode: 'exact', status: 'available', quantity: 3 }
  })
]);

const revisionBProducts = Object.freeze(revisionAProducts.map((item) => (
  item.id === 'reconciliar-fixture'
    ? {
        ...item,
        price: 59.5,
        isAvailable: false,
        stock: { mode: 'exact', status: 'out_of_stock', quantity: 0 }
      }
    : item
)));

const secondPage = Object.freeze([
  product('postre-fixture', {
    name: 'Postre Fixture',
    categoryName: 'Postres',
    price: 60,
    displayOrder: 5,
    stock: { mode: 'exact', status: 'available', quantity: 2 }
  })
]);

export function createCatalogFixture({
  revision = PARITY_FIXTURE_REVISIONS.A,
  offset = 0,
  slug = PARITY_FIXTURE_SLUGS.pro
} = {}) {
  if (slug === PARITY_FIXTURE_SLUGS.free) {
    return {
      success: true,
      catalogRevision: PARITY_FIXTURE_REVISIONS.FREE,
      items: [
        product('free-fixture', {
          name: 'Producto Fixture FREE',
          price: 30,
          stock: { mode: 'hidden', status: null, quantity: null }
        })
      ],
      pagination: { limit: 100, offset: 0, hasMore: false }
    };
  }

  const activeProducts = revision === PARITY_FIXTURE_REVISIONS.B
    ? revisionBProducts
    : revisionAProducts;
  return {
    success: true,
    catalogRevision: revision,
    items: offset >= 100 ? secondPage : activeProducts,
    pagination: { limit: 100, offset: offset >= 100 ? 100 : 0, hasMore: offset < 100 }
  };
}

export function createOrderSuccessFixture({ idempotent = false } = {}) {
  return {
    success: true,
    idempotent,
    order: {
      id: 'order-fixture-arch2',
      code: 'FIX-ARCH2-001',
      status: 'received',
      total: 79.8,
      currency: 'MXN',
      fulfillmentMethod: 'pickup',
      createdAt: '2026-07-13T18:00:00.000Z',
      trackingToken: PARITY_FIXTURE_TOKENS.valid,
      trackingPath: `/tienda/${PARITY_FIXTURE_SLUGS.pro}/pedido/${PARITY_FIXTURE_TOKENS.valid}`,
      trackingVersion: 1
    },
    whatsapp: {
      phone: '525500000000',
      message: 'Pedido fixture ARCH.2',
      url: 'https://wa.me/525500000000?text=Pedido%20fixture%20ARCH.2'
    }
  };
}

export const createOrderErrorFixture = (code) => ({
  success: false,
  error: { code, message: 'Detalle interno ficticio que no debe mostrarse.' }
});

export function createTrackingFixture(status = 'received') {
  const safeStatus = PARITY_TRACKING_STATUSES.includes(status) ? status : 'received';
  return {
    success: true,
    tracking: {
      orderCode: 'FIX-ARCH2-001',
      status: safeStatus,
      fulfillmentMethod: safeStatus === 'out_for_delivery' ? 'delivery' : 'pickup',
      createdAt: '2026-07-13T18:00:00.000Z',
      updatedAt: '2026-07-13T18:05:00.000Z',
      total: 79.8,
      currency: 'MXN',
      items: [
        { name: 'Taco Fixture', quantity: 2 }
      ],
      publicMessage: safeStatus === 'rejected'
        ? 'Pedido fixture rechazado por disponibilidad.'
        : `Estado fixture: ${safeStatus}`,
      version: PARITY_TRACKING_STATUSES.indexOf(safeStatus) + 1,
      paymentRegistered: safeStatus !== 'received',
      storefrontAvailable: true,
      realtime: { enabled: false, topic: '' }
    }
  };
}

export const PUBLIC_PARITY_FIXTURE_SUMMARY = Object.freeze({
  fixtureOnly: true,
  containsProductionData: false,
  proSlug: PARITY_FIXTURE_SLUGS.pro,
  freeSlug: PARITY_FIXTURE_SLUGS.free,
  catalogPages: 2,
  catalogRevisions: 2,
  trackingStatuses: PARITY_TRACKING_STATUSES.length,
  checkoutErrorModes: PARITY_CHECKOUT_ERROR_CODES.length
});
