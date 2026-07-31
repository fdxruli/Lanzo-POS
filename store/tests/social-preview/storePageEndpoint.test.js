import { describe, expect, it, vi } from 'vitest';
import {
  NOT_FOUND_HTML_CACHE,
  REVALIDATED_HTML_CACHE,
  TEMPORARY_HTML_CACHE,
  createStorePageHandler,
} from '../../api/store-page.js';
import { STORE_HTML_FIXTURE } from './fixtures/storeHtmlFixture.js';

const ENDPOINT = 'https://store.example.test/api/store-page?slug=mi-tienda';
const okResult = Object.freeze({
  status: 'ok',
  portal: Object.freeze({
    slug: 'mi-tienda',
    name: 'Mi Tienda',
    headline: 'Compra en línea',
    description: 'Catálogo público',
  }),
  siteVersionNumber: 7,
});

const createHandler = ({
  result = okResult,
  portalClient,
  template = STORE_HTML_FIXTURE,
  environment = {},
  ...dependencies
} = {}) => {
  const client = portalClient || {
    getPortalBySlug: vi.fn(async () => result),
  };
  return {
    client,
    handler: createStorePageHandler({
      portalClient: client,
      templateLoader: vi.fn(async () => template),
      environment,
      ...dependencies,
    }),
  };
};

const count = (source, pattern) => (source.match(pattern) || []).length;

describe('métodos y validación de solicitud', () => {
  it('responde GET personalizado con headers seguros', async () => {
    const { handler, client } = createHandler();
    const response = await handler(new Request(ENDPOINT));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe(REVALIDATED_HTML_CACHE);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(client.getPortalBySlug).toHaveBeenCalledWith('mi-tienda');
    expect(html).toContain('<title>Mi Tienda | Tienda en línea</title>');
  });

  it('HEAD conserva status y headers sin renderizar ni copiar HTML', async () => {
    const socialHeadRenderer = vi.fn(() => {
      throw new Error('HEAD must not render');
    });
    const { handler } = createHandler({ socialHeadRenderer });
    const response = await handler(new Request(ENDPOINT, { method: 'HEAD' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe(REVALIDATED_HTML_CACHE);
    expect(await response.text()).toBe('');
    expect(socialHeadRenderer).not.toHaveBeenCalled();
  });

  it('POST devuelve 405 y Allow sin plantilla ni portal', async () => {
    const templateLoader = vi.fn();
    const portalClient = { getPortalBySlug: vi.fn() };
    const handler = createStorePageHandler({ templateLoader, portalClient });
    const response = await handler(new Request(ENDPOINT, { method: 'POST' }));
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(templateLoader).not.toHaveBeenCalled();
    expect(portalClient.getPortalBySlug).not.toHaveBeenCalled();
  });

  it.each([
    ['https://store.example.test/api/store-page', 'slug ausente'],
    [`${ENDPOINT}&slug=otra-tienda`, 'slug duplicado'],
    ['https://store.example.test/api/store-page?slug=Mi-Tienda', 'mayúsculas'],
    ['https://store.example.test/api/store-page?slug=..%2Fprivate', 'traversal'],
    ['https://store.example.test/api/store-page?slug%5Bnested%5D=mi-tienda', 'query anidada'],
  ])('devuelve HTML genérico 400 y no consulta red: %s', async (url) => {
    const { handler, client } = createHandler();
    const response = await handler(new Request(url));
    const html = await response.text();
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('<title>Tienda en línea | Lanzo</title>');
    expect(html).not.toMatch(/Mi-Tienda|\.\.\/private|nested/u);
    expect(html).not.toContain('rel="canonical"');
    expect(client.getPortalBySlug).not.toHaveBeenCalled();
  });

  it('rechaza body declarado sin consultar red', async () => {
    const { handler, client } = createHandler();
    const response = await handler({
      method: 'GET',
      url: ENDPOINT,
      headers: new Headers({ 'content-length': '10' }),
    });
    expect(response.status).toBe(400);
    expect(client.getPortalBySlug).not.toHaveBeenCalled();
  });
});

describe('metadatos, fallbacks y caché', () => {
  it('incluye un único conjunto personalizado y una imagen versionada', async () => {
    const { handler } = createHandler();
    const html = await (await handler(new Request(ENDPOINT))).text();
    expect(count(html, /<title>/gu)).toBe(1);
    expect(count(html, /name="description"/gu)).toBe(1);
    expect(count(html, /rel="canonical"/gu)).toBe(1);
    expect(count(html, /property="og:type"/gu)).toBe(1);
    expect(count(html, /name="twitter:card"/gu)).toBe(1);
    expect(html).toContain('https://store.example.test/tienda/mi-tienda');
    expect(html).toContain('https://store.example.test/api/og/store?slug=mi-tienda&amp;v=7');
  });

  it('not_found usa texto específico, omite URLs falsas y caché de 300 s', async () => {
    const { handler } = createHandler({ result: { status: 'not_found' } });
    const response = await handler(new Request(ENDPOINT));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(NOT_FOUND_HTML_CACHE);
    expect(html).toContain('<title>Tienda no disponible | Lanzo</title>');
    expect(html).toContain('Esta tienda no está disponible. Consulta otras tiendas creadas con Lanzo.');
    expect(html).not.toMatch(/canonical|og:url|og:image|twitter:image/iu);
  });

  it.each([
    [{ status: 'unavailable', reason: 'timeout' }, 'fallo temporal'],
    [undefined, 'configuración faltante'],
  ])('mantiene SPA y metadata genérica con caché corta: %s', async (result) => {
    const options = result === undefined
      ? {
          portalClient: null,
          environment: {},
          fetchImpl: undefined,
        }
      : { result };
    const handler = createStorePageHandler({
      ...(options.portalClient === null ? {} : {
        portalClient: { getPortalBySlug: vi.fn(async () => result) },
      }),
      environment: options.environment || {},
      fetchImpl: options.fetchImpl,
      templateLoader: async () => STORE_HTML_FIXTURE,
    });
    const response = await handler(new Request(ENDPOINT));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(TEMPORARY_HTML_CACHE);
    expect(html).toContain('<title>Tienda en línea | Lanzo</title>');
    expect(html).toContain('id="root"');
    expect(html).toContain('/assets/index-AbCd1234.js');
  });

  it('origen inválido no consulta el portal ni crea canonical externo', async () => {
    const { handler, client } = createHandler();
    const response = await handler(new Request(
      'http://external.example.test/api/store-page?slug=mi-tienda',
    ));
    const html = await response.text();
    expect(response.headers.get('cache-control')).toBe(TEMPORARY_HTML_CACHE);
    expect(client.getPortalBySlug).not.toHaveBeenCalled();
    expect(html).not.toContain('external.example.test');
    expect(html).not.toContain('rel="canonical"');
  });

  it('un fallo del constructor personalizado activa fallback genérico', async () => {
    const { handler } = createHandler({
      metadataBuilder: vi.fn(() => {
        throw new Error('private metadata failure');
      }),
    });
    const response = await handler(new Request(ENDPOINT));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(TEMPORARY_HTML_CACHE);
    expect(html).toContain('<title>Tienda en línea | Lanzo</title>');
    expect(html).not.toContain('private metadata failure');
  });
});

describe('integridad de la SPA y error final', () => {
  it('preserva root, módulos, stylesheet, modulepreload y hashes literalmente', async () => {
    const { handler } = createHandler();
    const html = await (await handler(new Request(ENDPOINT))).text();
    [
      'id="root"',
      'type="module"',
      'stylesheet',
      'modulepreload',
      '/assets/index-AbCd1234.js',
      '/assets/vendor-XyZ98765.js',
      '/assets/index-Css12345.css',
    ].forEach((value) => expect(html).toContain(value));
  });

  it('no expone datos privados, credenciales ni campos administrativos', async () => {
    const result = structuredClone(okResult);
    Object.assign(result.portal, {
      phone: '+52 999 000 0000',
      email: 'private@example.test',
      address: 'Calle Privada',
      license: 'LANZO-PRIVATE',
      trackingToken: 'tracking-secret',
    });
    const { handler } = createHandler({
      result,
      environment: {
        VITE_SUPABASE_URL: 'https://private-project.supabase.test',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'private-publishable-key',
      },
    });
    const html = await (await handler(new Request(ENDPOINT))).text();
    expect(html).not.toMatch(
      /999 000|private@example|Calle Privada|LANZO-PRIVATE|tracking-secret|private-project|private-publishable-key/u,
    );
  });

  it('plantilla inválida devuelve 500 textual seguro sin detalles', async () => {
    const { handler, client } = createHandler({ template: '<html>private path /tmp/a</html>' });
    const response = await handler(new Request(ENDPOINT));
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('Store page temporarily unavailable.');
    expect(client.getPortalBySlug).not.toHaveBeenCalled();
  });
});
