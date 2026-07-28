import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PUBLIC_PORTAL_TIMEOUT_MS,
  MAX_PUBLIC_PORTAL_RESPONSE_BYTES,
  PublicPortalClientConfigurationError,
  createPublicPortalSocialClient,
} from '../../api/_publicPortal.js';

const SUPABASE_URL = 'https://public-project.supabase.test';
const PUBLISHABLE_KEY = 'sb_publishable_public_test_only';
const SLUG = 'tienda-segura';

const validPayload = (overrides = {}) => ({
  success: true,
  portal: {
    slug: SLUG,
    name: ' Tienda   Segura ',
    headline: ' Compra \n en línea ',
    description: ' Descripción pública ',
    templateCode: 'showcase',
    theme: {
      primaryColor: '#AABBCC',
      secondaryColor: '#112233',
      cornerStyle: 'soft',
      fontStyle: 'editorial',
    },
    logoUrl: 'https://images.example.test/logo.png',
    coverImageUrl: 'https://images.example.test/cover.png',
    businessType: [' retail ', 'retail', '', 7, 'abarrotes'],
  },
  site: { versionNumber: 12 },
  ...overrides,
});

const mockResponse = (body, { status = 200, contentLength } = {}) => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: vi.fn((name) => {
        if (name.toLowerCase() !== 'content-length') return null;
        if (contentLength === null) return null;
        return contentLength ?? String(new TextEncoder().encode(text).byteLength);
      }),
    },
    text: vi.fn(async () => text),
  };
};

const createClient = (fetchImpl, overrides = {}) => createPublicPortalSocialClient({
  supabaseUrl: SUPABASE_URL,
  publishableKey: PUBLISHABLE_KEY,
  fetchImpl,
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('configuración pública', () => {
  it('acepta URL HTTPS de origen, publishable key y timeout predeterminado', () => {
    const client = createClient(vi.fn());
    expect(Object.isFrozen(client)).toBe(true);
    expect(typeof client.getPortalBySlug).toBe('function');
    expect(DEFAULT_PUBLIC_PORTAL_TIMEOUT_MS).toBe(4_000);
  });

  it('normaliza diagonales finales redundantes de la URL', async () => {
    const fetchImpl = vi.fn(async () => mockResponse(validPayload()));
    const client = createPublicPortalSocialClient({
      supabaseUrl: `${SUPABASE_URL}///`,
      publishableKey: PUBLISHABLE_KEY,
      fetchImpl,
    });

    await client.getPortalBySlug(SLUG);
    expect(fetchImpl.mock.calls[0][0])
      .toBe(`${SUPABASE_URL}/rest/v1/rpc/ecommerce_get_portal_by_slug`);
  });

  it.each([
    ['http://public-project.supabase.test', 'HTTP'],
    ['https://user:pass@public-project.supabase.test', 'credenciales'],
    [`${SUPABASE_URL}?secret=value`, 'query'],
    [`${SUPABASE_URL}#fragment`, 'hash'],
    [`${SUPABASE_URL}/tenant`, 'pathname arbitrario'],
  ])('rechaza URL con %s', (supabaseUrl) => {
    expect(() => createPublicPortalSocialClient({
      supabaseUrl,
      publishableKey: PUBLISHABLE_KEY,
      fetchImpl: vi.fn(),
    })).toThrowError(expect.objectContaining({
      name: 'PublicPortalClientConfigurationError',
      code: 'INVALID_SUPABASE_URL',
    }));
  });

  it.each([
    ['anon-public-test-key', 'anon heredada'],
    [' sb_publishable_public_test_only ', 'publishable con trim'],
  ])('acepta clave pública %s', (publishableKey) => {
    expect(() => createPublicPortalSocialClient({
      supabaseUrl: SUPABASE_URL,
      publishableKey,
      fetchImpl: vi.fn(),
    })).not.toThrow();
  });

  it.each([
    ['', 'vacía'],
    ['   ', 'solo espacios'],
    [7, 'no string'],
  ])('rechaza clave %s', (publishableKey) => {
    expect(() => createPublicPortalSocialClient({
      supabaseUrl: SUPABASE_URL,
      publishableKey,
      fetchImpl: vi.fn(),
    })).toThrowError(expect.objectContaining({
      name: 'PublicPortalClientConfigurationError',
      code: 'INVALID_PUBLISHABLE_KEY',
      message: 'La configuración pública del portal no es válida.',
    }));
  });

  it.each([
    ['service_role', 'nombre directo'],
    ['SUPABASE_SERVICE_ROLE', 'variable administrativa'],
    ['sb_secret_private_test_only', 'clave secret nueva'],
    [
      `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`,
      'JWT heredado con rol privilegiado',
    ],
  ])('rechaza credencial privilegiada (%s)', (publishableKey) => {
    expect(() => createPublicPortalSocialClient({
      supabaseUrl: SUPABASE_URL,
      publishableKey,
      fetchImpl: vi.fn(),
    })).toThrowError(expect.objectContaining({
      code: 'PRIVILEGED_KEY_REJECTED',
      message: 'La configuración pública del portal no es válida.',
    }));
  });

  it('no incluye la credencial rechazada en el error', () => {
    const secret = 'sb_secret_private_value_never_expose';
    try {
      createPublicPortalSocialClient({
        supabaseUrl: SUPABASE_URL,
        publishableKey: secret,
        fetchImpl: vi.fn(),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(PublicPortalClientConfigurationError);
      expect(JSON.stringify(error)).not.toContain(secret);
      expect(error.message).not.toContain(secret);
    }
  });

  it.each([499, 10_001, 1.5, '4000'])('rechaza timeout fuera de contrato: %s', (timeoutMs) => {
    expect(() => createClient(vi.fn(), { timeoutMs }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_TIMEOUT' }));
  });

  it('devuelve configuration_missing sin intentar red cuando falta configuración', async () => {
    const fetchImpl = vi.fn();
    const client = createPublicPortalSocialClient({ fetchImpl });

    await expect(client.getPortalBySlug(SLUG)).resolves.toEqual({
      status: 'unavailable',
      reason: 'configuration_missing',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('solicitud RPC restringida', () => {
  it('usa URL, método, headers, body, redirect y señal exactos', async () => {
    const fetchImpl = vi.fn(async () => mockResponse(validPayload()));
    const client = createClient(fetchImpl);

    await expect(client.getPortalBySlug(SLUG)).resolves.toMatchObject({ status: 'ok' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${SUPABASE_URL}/rest/v1/rpc/ecommerce_get_portal_by_slug`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          apikey: PUBLISHABLE_KEY,
          Authorization: `Bearer ${PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ p_slug: SLUG }),
        redirect: 'error',
        signal: expect.any(AbortSignal),
      },
    );
  });

  it('no ejecuta red con slug inválido y usa el error seguro aprobado', async () => {
    const fetchImpl = vi.fn();
    const client = createClient(fetchImpl);
    const unsafeSlug = '../privado?token=secreto';

    await expect(client.getPortalBySlug(unsafeSlug)).rejects.toMatchObject({
      name: 'SocialMetadataValidationError',
      code: 'INVALID_STORE_SLUG',
      message: 'El identificador de la tienda no es válido.',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('libera el temporizador después de una respuesta', async () => {
    vi.useFakeTimers();
    const client = createClient(vi.fn(async () => mockResponse(validPayload())));
    const result = await client.getPortalBySlug(SLUG);

    expect(result.status).toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborta, clasifica timeout y resuelve aunque fetch ignore la señal', async () => {
    vi.useFakeTimers();
    let receivedSignal;
    const fetchImpl = vi.fn((url, options) => {
      receivedSignal = options.signal;
      return new Promise(() => {});
    });
    const client = createClient(fetchImpl, { timeoutMs: 500 });
    const pending = client.getPortalBySlug(SLUG);

    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toEqual({ status: 'unavailable', reason: 'timeout' });
    expect(receivedSignal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('respuesta válida y proyección estricta', () => {
  it('normaliza portal completo, plantilla, tema, rubros, imágenes y versión', async () => {
    const client = createClient(vi.fn(async () => mockResponse(validPayload())));

    await expect(client.getPortalBySlug(SLUG)).resolves.toEqual({
      status: 'ok',
      portal: {
        slug: SLUG,
        name: 'Tienda Segura',
        headline: 'Compra en línea',
        description: 'Descripción pública',
        templateCode: 'showcase',
        theme: {
          primaryColor: '#aabbcc',
          secondaryColor: '#112233',
          cornerStyle: 'soft',
          fontStyle: 'editorial',
        },
        logoUrl: 'https://images.example.test/logo.png',
        coverImageUrl: 'https://images.example.test/cover.png',
        businessType: ['retail', 'abarrotes'],
      },
      siteVersionNumber: 12,
    });
  });

  it('aplica fallbacks seguros a campos opcionales, plantilla, tema e imágenes', async () => {
    const payload = validPayload({
      portal: {
        slug: SLUG,
        templateCode: 'private-template',
        theme: {
          primaryColor: 'red',
          secondaryColor: {},
          cornerStyle: '__proto__-style',
          fontStyle: 'script',
          settings: { secret: true },
        },
        logoUrl: 'http://insecure.example.test/logo.png',
        coverImageUrl: 'data:image/png;base64,AAAA',
        businessType: 'retail',
      },
      site: {},
    });
    const client = createClient(vi.fn(async () => mockResponse(payload)));
    const result = await client.getPortalBySlug(SLUG);

    expect(result).toEqual({
      status: 'ok',
      portal: {
        slug: SLUG,
        name: 'Tienda online',
        headline: '',
        description: '',
        templateCode: 'classic',
        theme: {
          primaryColor: '#0284c7',
          secondaryColor: '#0369a1',
          cornerStyle: 'rounded',
          fontStyle: 'system',
        },
        logoUrl: '',
        coverImageUrl: '',
        businessType: [],
      },
      siteVersionNumber: null,
    });
  });

  it.each([0, -1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1])(
    'convierte versión inválida %s en null',
    async (versionNumber) => {
      const client = createClient(vi.fn(async () => mockResponse(validPayload({
        site: { versionNumber },
      }))));
      expect((await client.getPortalBySlug(SLUG)).siteVersionNumber).toBeNull();
    },
  );

  it('solo acepta candidatos de imagen HTTPS sin credenciales', async () => {
    const payload = validPayload();
    payload.portal.logoUrl = 'https://user:pass@images.example.test/logo.png';
    payload.portal.coverImageUrl = 'https://images.example.test/cover.png?size=large';
    const result = await createClient(
      vi.fn(async () => mockResponse(payload)),
    ).getPortalBySlug(SLUG);

    expect(result.portal.logoUrl).toBe('');
    expect(result.portal.coverImageUrl)
      .toBe('https://images.example.test/cover.png?size=large');
  });

  it.each([
    ['http://images.example.test/logo.png', 'HTTP'],
    ['data:image/png;base64,AAAA', 'data'],
    ['javascript:alert(1)', 'javascript'],
    ['blob:https://images.example.test/id', 'blob'],
    ['file:///tmp/logo.png', 'file'],
  ])('rechaza imagen candidata con esquema %s', async (logoUrl) => {
    const payload = validPayload();
    payload.portal.logoUrl = logoUrl;
    const result = await createClient(
      vi.fn(async () => mockResponse(payload)),
    ).getPortalBySlug(SLUG);
    expect(result.portal.logoUrl).toBe('');
  });

  it('devuelve resultado profundamente inmutable', async () => {
    const result = await createClient(
      vi.fn(async () => mockResponse(validPayload())),
    ).getPortalBySlug(SLUG);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.portal)).toBe(true);
    expect(Object.isFrozen(result.portal.theme)).toBe(true);
    expect(Object.isFrozen(result.portal.businessType)).toBe(true);
  });
});

describe('not_found y fallos seguros', () => {
  it('clasifica exclusivamente el código contractual como not_found', async () => {
    const client = createClient(vi.fn(async () => mockResponse({
      success: false,
      error: { code: 'ECOMMERCE_PORTAL_NOT_FOUND', message: 'detalle remoto' },
    })));

    await expect(client.getPortalBySlug(SLUG)).resolves.toEqual({ status: 'not_found' });
  });

  it.each([400, 401, 404, 500])('clasifica HTTP %s genérico como http_error', async (status) => {
    const client = createClient(vi.fn(async () => mockResponse({
      code: 'PGRST_UNKNOWN',
      message: 'detalle remoto',
    }, { status })));

    await expect(client.getPortalBySlug(SLUG)).resolves.toEqual({
      status: 'unavailable',
      reason: 'http_error',
    });
  });

  it('clasifica una excepción de fetch como network', async () => {
    const client = createClient(vi.fn(async () => {
      throw new Error('detalle privado de red');
    }));

    await expect(client.getPortalBySlug(SLUG)).resolves.toEqual({
      status: 'unavailable',
      reason: 'network',
    });
  });

  it('clasifica JSON inválido como invalid_response', async () => {
    const client = createClient(vi.fn(async () => mockResponse('{invalid-json')));
    await expect(client.getPortalBySlug(SLUG)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('rechaza Content-Length excesivo antes de parsear', async () => {
    const response = mockResponse(validPayload(), {
      contentLength: String(MAX_PUBLIC_PORTAL_RESPONSE_BYTES + 1),
    });
    const client = createClient(vi.fn(async () => response));

    await expect(client.getPortalBySlug(SLUG)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_response',
    });
    expect(response.text).not.toHaveBeenCalled();
  });

  it('rechaza cuerpo real excesivo aunque falte Content-Length confiable', async () => {
    const oversized = JSON.stringify({
      success: true,
      portal: { slug: SLUG, name: 'x'.repeat(MAX_PUBLIC_PORTAL_RESPONSE_BYTES) },
    });
    const response = mockResponse(oversized, { contentLength: null });
    const client = createClient(vi.fn(async () => response));

    await expect(client.getPortalBySlug(SLUG)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it.each([
    [{ success: false }, 'success !== true'],
    [{ success: false, error: { code: 'UNKNOWN_REMOTE_ERROR' } }, 'error remoto desconocido'],
  ])('clasifica %s como remote_error', async (payload) => {
    const client = createClient(vi.fn(async () => mockResponse(payload)));
    await expect(client.getPortalBySlug(SLUG)).resolves.toEqual({
      status: 'unavailable',
      reason: 'remote_error',
    });
  });

  it.each([
    [{ success: true }, 'portal ausente'],
    [{ success: true, portal: [] }, 'portal no objeto'],
    [{ success: true, portal: { name: 'Sin slug' } }, 'slug ausente'],
    [{ success: true, portal: { slug: 'otra-tienda', name: 'Discordante' } }, 'slug discordante'],
  ])('clasifica %s como invalid_response', async (payload) => {
    const client = createClient(vi.fn(async () => mockResponse(payload)));
    await expect(client.getPortalBySlug(SLUG)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_response',
    });
  });

  it('rechaza claves de prototipo propias en la respuesta', async () => {
    const dangerous = `{"success":true,"portal":{"slug":"${SLUG}","name":"Tienda","__proto__":{"polluted":true}}}`;
    const client = createClient(vi.fn(async () => mockResponse(dangerous)));

    await expect(client.getPortalBySlug(SLUG)).resolves.toEqual({
      status: 'unavailable',
      reason: 'invalid_response',
    });
    expect({}.polluted).toBeUndefined();
  });
});

describe('privacidad, credenciales y ausencia de logging', () => {
  it('descarta datos privados y operativos del payload completo', async () => {
    const privateValues = [
      '+52 999 111 2233',
      'private@example.test',
      'Calle Privada 123',
      'horario-privado',
      'stock-privado',
      'settings-secretos',
      'feature-interna',
      'catalogo-privado',
      'licencia-privada',
      'pedido-privado',
      'tracking-token-privado',
      'dispositivo-privado',
      'staff-privado',
    ];
    const payload = validPayload();
    Object.assign(payload.portal, {
      whatsappPhone: privateValues[0],
      contactEmail: privateValues[1],
      address: privateValues[2],
      addressStreet: privateValues[2],
      addressNeighborhood: privateValues[2],
      addressMunicipality: privateValues[2],
      addressState: privateValues[2],
      addressPostalCode: privateValues[2],
      hours: privateValues[3],
      stockMode: privateValues[4],
      settings: { secret: privateValues[5] },
      features: [privateValues[6]],
      catalogRevision: privateValues[7],
      license: privateValues[8],
      orders: [privateValues[9]],
      trackingToken: privateValues[10],
      device: privateValues[11],
      staff: privateValues[12],
      metadata: privateValues,
    });
    const fetchImpl = vi.fn(async () => mockResponse(payload));
    const result = await createClient(fetchImpl).getPortalBySlug(SLUG);
    const serialized = JSON.stringify(result);

    privateValues.forEach((privateValue) => expect(serialized).not.toContain(privateValue));
    expect(Object.keys(result.portal)).toEqual([
      'slug',
      'name',
      'headline',
      'description',
      'templateCode',
      'theme',
      'logoUrl',
      'coverImageUrl',
      'businessType',
    ]);
    expect(fetchImpl.mock.calls[0][0]).not.toContain(privateValues.join(''));
    expect(fetchImpl.mock.calls[0][1].body).toBe(JSON.stringify({ p_slug: SLUG }));
  });

  it('usa la clave solo en headers y nunca en resultado o errores', async () => {
    const uniqueKey = 'sb_publishable_unique_header_only_value';
    const fetchImpl = vi.fn(async () => mockResponse(validPayload()));
    const client = createPublicPortalSocialClient({
      supabaseUrl: SUPABASE_URL,
      publishableKey: uniqueKey,
      fetchImpl,
    });
    const result = await client.getPortalBySlug(SLUG);
    const [url, request] = fetchImpl.mock.calls[0];

    expect(request.headers.apikey).toBe(uniqueKey);
    expect(request.headers.Authorization).toBe(`Bearer ${uniqueKey}`);
    expect(url).not.toContain(uniqueKey);
    expect(request.body).not.toContain(uniqueKey);
    expect(JSON.stringify(result)).not.toContain(uniqueKey);
  });

  it('no invoca ningún método de console', async () => {
    const spies = ['log', 'info', 'warn', 'error'].map((method) => (
      vi.spyOn(console, method).mockImplementation(() => {})
    ));
    const client = createClient(vi.fn(async () => mockResponse({
      success: false,
      error: { code: 'UNKNOWN', message: 'payload privado' },
    })));

    await client.getPortalBySlug(SLUG);
    spies.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});
