import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_ALT_LENGTH,
  MAX_SOCIAL_DESCRIPTION_LENGTH,
  MAX_SOCIAL_TITLE_LENGTH,
  MAX_STORE_NAME_LENGTH,
  SocialMetadataValidationError,
  buildCanonicalUrl,
  buildOpenGraphImageUrl,
  buildSocialDescription,
  buildSocialTitle,
  buildStoreSocialMetadata,
  escapeHtmlAttribute,
  escapeHtmlText,
  normalizePublicOrigin,
  normalizeSocialText,
  truncateSocialText,
  validateStoreSlug,
} from '../../api/_socialMetadata.js';

const PUBLIC_ORIGIN = 'https://tienda.lanzo.test';

const expectInvalidSlug = (slug) => {
  expect(() => validateStoreSlug(slug)).toThrowError(
    expect.objectContaining({
      name: 'SocialMetadataValidationError',
      code: 'INVALID_STORE_SLUG',
      message: 'El identificador de la tienda no es válido.',
    }),
  );
};

describe('validateStoreSlug', () => {
  it.each([
    ['abc', 'slug mínimo válido'],
    ['tienda123', 'slug válido con números'],
    ['mi--tienda-online', 'slug válido con varios guiones internos'],
    [`a${'b'.repeat(62)}c`, 'longitud de 64 válida'],
  ])('acepta %s (%s)', (slug) => {
    expect(validateStoreSlug(slug)).toBe(slug);
  });

  it.each([
    ['ab', 'longitud menor a 3'],
    [`a${'b'.repeat(63)}c`, 'longitud mayor a 64'],
    ['Mi-tienda', 'mayúsculas'],
    ['-tienda', 'guion inicial'],
    ['tienda-', 'guion final'],
    ['mi tienda', 'espacios'],
    ['mi//tienda', 'doble slash'],
    ['mi.tienda', 'punto'],
    ['tienda?x=1', 'query'],
    ['tienda#uno', 'hash'],
    ['tienda-ñ', 'Unicode'],
    ['../tienda', 'path traversal'],
  ])('rechaza %s (%s)', (slug) => {
    expectInvalidSlug(slug);
  });

  it('no transforma silenciosamente mayúsculas ni espacios exteriores', () => {
    expectInvalidSlug(' TIENDA ');
  });

  it('no incluye el valor inválido en el error', () => {
    const unsafeSlug = '../secreto?token=privado';

    try {
      validateStoreSlug(unsafeSlug);
    } catch (error) {
      expect(error).toBeInstanceOf(SocialMetadataValidationError);
      expect(error.message).not.toContain(unsafeSlug);
    }
  });
});

describe('normalización y truncado de texto', () => {
  it('conserva strings normales y caracteres válidos en español', () => {
    expect(normalizeSocialText('Catálogo de Pequeña Ñandú')).toBe('Catálogo de Pequeña Ñandú');
  });

  it.each([
    ['  uno   dos  ', 'uno dos', 'espacios repetidos'],
    ['uno\t\tdos', 'uno dos', 'tabs'],
    ['uno\n\rdos', 'uno dos', 'saltos de línea'],
    ['uno\u0000\u0007dos', 'unodos', 'caracteres de control'],
    ['Tienda 🚀 feliz', 'Tienda 🚀 feliz', 'emoji'],
  ])('normaliza %s como %s (%s)', (input, output) => {
    expect(normalizeSocialText(input)).toBe(output);
  });

  it.each([null, undefined, 123, {}, ['texto'], new String('texto')])(
    'devuelve fallback vacío para un valor no string',
    (value) => {
      expect(normalizeSocialText(value)).toBe('');
    },
  );

  it('trunca con una sola elipsis sin exceder el límite', () => {
    expect(truncateSocialText('abcdef', 5)).toBe('abcd…');
    expect(Array.from(truncateSocialText('abcdef', 5))).toHaveLength(5);
  });

  it('respeta el límite exacto y no agrega elipsis', () => {
    expect(truncateSocialText('abcde', 5)).toBe('abcde');
  });

  it('no separa pares sustitutos de emoji', () => {
    expect(truncateSocialText('😀😀😀', 2)).toBe('😀…');
  });

  it('no deja espacio antes de la elipsis', () => {
    expect(truncateSocialText('abc def', 5)).toBe('abc…');
  });

  it('limita el nombre antes de construir título y alt', () => {
    const longName = 'N'.repeat(MAX_STORE_NAME_LENGTH + 20);
    const metadata = buildStoreSocialMetadata({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'mi-tienda',
      portal: { name: longName },
    });

    expect(Array.from(metadata.title).length).toBeLessThanOrEqual(MAX_SOCIAL_TITLE_LENGTH);
    expect(Array.from(metadata.imageAlt).length).toBeLessThanOrEqual(MAX_IMAGE_ALT_LENGTH);
  });

  it('limita headline y description largas', () => {
    const headline = 'H'.repeat(MAX_SOCIAL_DESCRIPTION_LENGTH + 50);
    const description = 'D'.repeat(MAX_SOCIAL_DESCRIPTION_LENGTH + 50);

    expect(Array.from(buildSocialDescription({ headline })).length)
      .toBe(MAX_SOCIAL_DESCRIPTION_LENGTH);
    expect(buildSocialDescription({ headline }).endsWith('…')).toBe(true);
    expect(Array.from(buildSocialDescription({ description })).length)
      .toBe(MAX_SOCIAL_DESCRIPTION_LENGTH);
  });
});

describe('construcción semántica de título y descripción', () => {
  it('construye el título principal', () => {
    expect(buildSocialTitle('  Mi   Tienda  ')).toBe('Mi Tienda | Tienda en línea');
  });

  it('evita separadores finales duplicados', () => {
    expect(buildSocialTitle('Mi Tienda ||')).toBe('Mi Tienda | Tienda en línea');
  });

  it('usa el fallback global para nombre vacío o inválido', () => {
    expect(buildSocialTitle('  ')).toBe('Tienda en línea | Lanzo');
    expect(buildSocialTitle({ name: 'privado' })).toBe('Tienda en línea | Lanzo');
  });

  it('prioriza headline sobre description', () => {
    expect(buildSocialDescription({
      name: 'Mi Tienda',
      headline: '  El mejor catálogo  ',
      description: 'Descripción secundaria',
    })).toBe('El mejor catálogo');
  });

  it('usa description como segundo fallback', () => {
    expect(buildSocialDescription({
      name: 'Mi Tienda',
      headline: null,
      description: '  Compra con nosotros  ',
    })).toBe('Compra con nosotros');
  });

  it('genera fallback con nombre válido', () => {
    expect(buildSocialDescription({ name: 'Mi Tienda' }))
      .toBe('Consulta el catálogo de Mi Tienda y realiza tu pedido en línea.');
  });

  it('usa fallback global sin nombre válido', () => {
    expect(buildSocialDescription({ name: '' }))
      .toBe('Consulta productos y realiza tu pedido en línea.');
  });
});

describe('escape explícito para serialización HTML', () => {
  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
    ['</title><script>alert(1)</script>', '&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['"><img src=x onerror=alert(1)>', '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'],
    ['&<>"\'', '&amp;&lt;&gt;&quot;&#39;'],
  ])('escapa %s de forma segura', (input, output) => {
    expect(escapeHtmlText(input)).toBe(output);
    expect(escapeHtmlAttribute(input)).toBe(output);
  });

  it('mantiene texto semántico sin preescape y evita doble escape', () => {
    const metadata = buildStoreSocialMetadata({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'mi-tienda',
      portal: { name: 'Pan & Café', headline: 'Sabor <real>' },
    });

    expect(metadata.title).toBe('Pan & Café | Tienda en línea');
    expect(metadata.description).toBe('Sabor <real>');
    expect(escapeHtmlText(metadata.title)).toContain('Pan &amp; Café');
    expect(escapeHtmlText(metadata.title)).not.toContain('&amp;amp;');
  });
});

describe('origen, canonical e imagen controlada', () => {
  it('normaliza el origen sin diagonal final redundante', () => {
    expect(normalizePublicOrigin(`${PUBLIC_ORIGIN}///`)).toBe(PUBLIC_ORIGIN);
  });

  it.each([
    ['http://tienda.lanzo.test', 'HTTP'],
    ['https://user:pass@tienda.lanzo.test', 'credenciales'],
    ['https://tienda.lanzo.test?x=1', 'query'],
    ['https://tienda.lanzo.test#x', 'hash'],
    ['https://tienda.lanzo.test/base', 'pathname no origin'],
  ])('rechaza origen con %s', (origin) => {
    expect(() => normalizePublicOrigin(origin)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PUBLIC_ORIGIN' }),
    );
  });

  it('construye canonical exacta sin query, hash ni doble slash', () => {
    const canonical = buildCanonicalUrl({
      publicOrigin: `${PUBLIC_ORIGIN}/`,
      slug: 'mi-tienda-2',
    });
    const url = new URL(canonical);

    expect(canonical).toBe(`${PUBLIC_ORIGIN}/tienda/mi-tienda-2`);
    expect(url.pathname).toBe('/tienda/mi-tienda-2');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(url.pathname).not.toContain('//');
  });

  it('construye siempre una imagen en la ruta controlada', () => {
    expect(buildOpenGraphImageUrl({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'mi-tienda',
    })).toEqual({
      imageUrl: `${PUBLIC_ORIGIN}/api/og/store?slug=mi-tienda`,
      imageVersioned: false,
    });
  });

  it('agrega versión cuando es un entero positivo seguro', () => {
    expect(buildOpenGraphImageUrl({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'mi-tienda',
      siteVersionNumber: 12,
    })).toEqual({
      imageUrl: `${PUBLIC_ORIGIN}/api/og/store?slug=mi-tienda&v=12`,
      imageVersioned: true,
    });
  });

  it.each([
    [undefined, 'ausente'],
    [0, 'cero'],
    [-1, 'negativa'],
    [1.5, 'decimal'],
    [Number.MAX_SAFE_INTEGER + 1, 'fuera de Number.MAX_SAFE_INTEGER'],
    ['12', 'string'],
  ])('omite versión %s (%s)', (siteVersionNumber) => {
    const result = buildOpenGraphImageUrl({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'mi-tienda',
      siteVersionNumber,
    });

    expect(result.imageVersioned).toBe(false);
    expect(new URL(result.imageUrl).search).toBe('?slug=mi-tienda');
  });
});

describe('buildStoreSocialMetadata', () => {
  it('construye metadatos completos, consistentes e inmutables', () => {
    const metadata = buildStoreSocialMetadata({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'cafe-lanzo',
      portal: {
        name: 'Café Lanzo',
        headline: 'Compra café mexicano en línea',
        description: 'Descripción secundaria',
      },
      siteVersionNumber: 7,
    });

    expect(metadata).toMatchObject({
      title: 'Café Lanzo | Tienda en línea',
      description: 'Compra café mexicano en línea',
      canonicalUrl: `${PUBLIC_ORIGIN}/tienda/cafe-lanzo`,
      imageUrl: `${PUBLIC_ORIGIN}/api/og/store?slug=cafe-lanzo&v=7`,
      imageAlt: 'Vista previa de Café Lanzo',
      locale: 'es_MX',
      siteName: 'Lanzo Tienda',
      imageVersioned: true,
      openGraph: {
        type: 'website',
        imageWidth: 1200,
        imageHeight: 630,
        imageType: 'image/png',
        locale: 'es_MX',
        siteName: 'Lanzo Tienda',
      },
      twitter: {
        card: 'summary_large_image',
      },
    });
    expect(metadata.openGraph.title).toBe(metadata.title);
    expect(metadata.twitter.title).toBe(metadata.title);
    expect(metadata.openGraph.description).toBe(metadata.description);
    expect(metadata.twitter.description).toBe(metadata.description);
    expect(metadata.openGraph.url).toBe(metadata.canonicalUrl);
    expect(metadata.openGraph.image).toBe(metadata.imageUrl);
    expect(metadata.twitter.image).toBe(metadata.imageUrl);
    expect(metadata.openGraph.imageAlt).toBe(metadata.imageAlt);
    expect(metadata.twitter.imageAlt).toBe(metadata.imageAlt);
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.openGraph)).toBe(true);
    expect(Object.isFrozen(metadata.twitter)).toBe(true);
  });

  it('usa fallbacks globales cuando portal está ausente', () => {
    expect(buildStoreSocialMetadata({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'sin-datos',
      portal: null,
    })).toMatchObject({
      title: 'Tienda en línea | Lanzo',
      description: 'Consulta productos y realiza tu pedido en línea.',
      imageAlt: 'Vista previa de Lanzo Tienda',
    });
  });

  it('ignora y no serializa campos privados u operativos del portal', () => {
    const privateValues = [
      '+52 999 111 2233',
      'privado@example.test',
      'Calle Privada 123',
      'Centro',
      'Mérida',
      'Yucatán',
      '97000',
      'lunes-a-domingo',
      'stock-privado',
      'settings-secretos',
      'feature-interna',
      'revision-privada',
      'licencia-privada',
      'pedido-privado',
      'tracking-token-privado',
      'https://externo.test/logo.png',
      'https://externo.test/cover.png',
      'theme-privado',
    ];
    const portal = {
      name: 'Tienda Pública',
      headline: 'Catálogo en línea',
      description: 'Descripción pública',
      whatsappPhone: privateValues[0],
      contactEmail: privateValues[1],
      address: privateValues[2],
      addressStreet: privateValues[2],
      addressNeighborhood: privateValues[3],
      addressMunicipality: privateValues[4],
      addressState: privateValues[5],
      addressPostalCode: privateValues[6],
      hours: privateValues[7],
      availability: privateValues[8],
      stockMode: privateValues[8],
      settings: { secret: privateValues[9] },
      features: [privateValues[10]],
      catalogRevision: privateValues[11],
      license: privateValues[12],
      orders: [privateValues[13]],
      trackingToken: privateValues[14],
      logoUrl: privateValues[15],
      coverImageUrl: privateValues[16],
      theme: privateValues[17],
    };
    const metadata = buildStoreSocialMetadata({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'tienda-publica',
      portal,
    });
    const serialized = JSON.stringify(metadata);

    privateValues.forEach((privateValue) => {
      expect(serialized).not.toContain(privateValue);
    });
    expect(Object.keys(metadata)).toEqual([
      'title',
      'description',
      'canonicalUrl',
      'imageUrl',
      'imageAlt',
      'locale',
      'siteName',
      'imageVersioned',
      'openGraph',
      'twitter',
    ]);
  });
});
