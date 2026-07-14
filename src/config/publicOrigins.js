const DEFAULT_ADMIN_APP_ORIGIN = 'https://lanzo-pos.vercel.app';
const DEFAULT_PUBLIC_STORE_ORIGIN = 'https://lanzo-store.vercel.app';

const isLoopbackHostname = (hostname) => (
  hostname === 'localhost'
  || hostname === '127.0.0.1'
  || hostname === '[::1]'
);

export function normalizePublicOrigin(
  value,
  { production = import.meta.env?.PROD === true } = {}
) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('El origen debe ser una URL no vacia.');
  }

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new TypeError('El origen debe ser una URL valida.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new TypeError('El origen debe usar HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new TypeError('El origen no puede incluir credenciales.');
  }
  if (parsed.search) {
    throw new TypeError('El origen no puede incluir query.');
  }
  if (parsed.hash) {
    throw new TypeError('El origen no puede incluir hash.');
  }
  if (parsed.pathname !== '/') {
    throw new TypeError('El origen no puede incluir una ruta.');
  }
  if (
    parsed.protocol === 'http:'
    && (production || !isLoopbackHostname(parsed.hostname.toLowerCase()))
  ) {
    throw new TypeError('HTTP solo se permite en loopback durante desarrollo.');
  }

  return parsed.origin;
}

const configuredOrigin = (value, fallback) => normalizePublicOrigin(value || fallback, {
  production: import.meta.env?.PROD === true && import.meta.env?.MODE === 'production'
});

export const ADMIN_APP_ORIGIN = configuredOrigin(
  import.meta.env?.VITE_ADMIN_APP_ORIGIN,
  DEFAULT_ADMIN_APP_ORIGIN
);

export const PUBLIC_STORE_ORIGIN = configuredOrigin(
  import.meta.env?.VITE_PUBLIC_STORE_ORIGIN,
  DEFAULT_PUBLIC_STORE_ORIGIN
);

const encodePathSegment = (value, label) => {
  if (value === null || value === undefined || String(value) === '') {
    throw new TypeError(`${label} es obligatorio.`);
  }
  return encodeURIComponent(String(value));
};

export function buildPublicStoreUrl(slug) {
  return new URL(
    `/tienda/${encodePathSegment(slug, 'slug')}`,
    PUBLIC_STORE_ORIGIN
  ).toString();
}

export function buildPublicTrackingUrl(slug, trackingToken) {
  return new URL(
    `/tienda/${encodePathSegment(slug, 'slug')}/pedido/${encodePathSegment(trackingToken, 'trackingToken')}`,
    PUBLIC_STORE_ORIGIN
  ).toString();
}

export function buildPublicLandingUrl(slug) {
  const url = new URL('/conoce-lanzo', PUBLIC_STORE_ORIGIN);
  if (slug !== null && slug !== undefined && String(slug) !== '') {
    url.searchParams.set('tienda', String(slug));
  }
  return url.toString();
}

export function buildAdminWelcomeUrl() {
  const url = new URL('/', ADMIN_APP_ORIGIN);
  url.searchParams.set('welcome', '1');
  return url.toString();
}

export function isPublicStoreOrigin(value) {
  try {
    const parsed = value instanceof URL ? value : new URL(String(value));
    return parsed.origin === PUBLIC_STORE_ORIGIN;
  } catch {
    return false;
  }
}

export function appendPublicTrackingToWhatsappUrl(value, trackingUrl) {
  try {
    const whatsappUrl = new URL(String(value));
    const parsedTrackingUrl = new URL(String(trackingUrl));
    if (
      whatsappUrl.protocol !== 'https:'
      || whatsappUrl.hostname !== 'wa.me'
      || whatsappUrl.username
      || whatsappUrl.password
      || whatsappUrl.hash
      || !isPublicStoreOrigin(parsedTrackingUrl)
    ) {
      return '';
    }

    const currentMessage = whatsappUrl.searchParams.get('text')?.trim() || '';
    if (!currentMessage.includes(parsedTrackingUrl.toString())) {
      whatsappUrl.searchParams.set(
        'text',
        [currentMessage, `Seguimiento: ${parsedTrackingUrl.toString()}`]
          .filter(Boolean)
          .join('\n')
      );
    }
    return whatsappUrl.toString();
  } catch {
    return '';
  }
}
