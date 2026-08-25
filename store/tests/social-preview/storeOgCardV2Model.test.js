import { describe, expect, it } from 'vitest';
import { buildStoreOgCardV2Model } from '../../api/_storeOgCardV2Model.js';

const baseInput = (overrides = {}) => ({
  name: 'Café del Centro',
  headline: 'Productos elegidos para disfrutar en casa',
  description: 'Descripción secundaria',
  templateCode: 'classic',
  theme: {
    primaryColor: '#112233',
    secondaryColor: '#aabbcc',
    cornerStyle: 'soft',
    fontStyle: 'editorial',
  },
  logoUrl: 'https://public-project.supabase.test/storage/v1/object/public/logos/logo.png',
  coverImageUrl: 'https://public-project.supabase.test/storage/v1/object/public/covers/cover.png',
  ...overrides,
});

const CSS_COLOR = /^(?:#[0-9a-f]{6}|rgba\(\d{1,3},\d{1,3},\d{1,3},(?:0(?:\.\d+)?|1(?:\.0+)?)\))$/iu;
const VISUAL_COLOR_KEYS = Object.freeze([
  'backgroundColor',
  'surfaceColor',
  'accentColor',
  'accentSoftColor',
  'textOnBackground',
  'textOnSurface',
  'textOnAccent',
  'mutedTextColor',
  'overlayColor',
]);

describe('buildStoreOgCardV2Model', () => {
  it('produce un modelo V2 determinista con concerns separados', () => {
    const input = baseInput();
    const first = buildStoreOgCardV2Model(input);
    const second = buildStoreOgCardV2Model(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      version: 2,
      content: {
        name: 'Café del Centro',
        shortDescription: 'Productos elegidos para disfrutar en casa',
        label: 'Tienda en línea',
      },
      branding: {
        poweredBy: 'Impulsado por Lanzo',
      },
      layout: {
        templateCode: 'classic',
        variant: 'classic',
      },
    });
  });

  it('devuelve el modelo profundamente congelado', () => {
    const model = buildStoreOgCardV2Model(baseInput());
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.content)).toBe(true);
    expect(Object.isFrozen(model.branding)).toBe(true);
    expect(Object.isFrozen(model.layout)).toBe(true);
    expect(Object.isFrozen(model.visual)).toBe(true);
  });

  it.each(['compact', 'classic', 'showcase'])('normaliza el template %s', (templateCode) => {
    const model = buildStoreOgCardV2Model(baseInput({ templateCode }));
    expect(model.layout).toEqual({ templateCode, variant: templateCode });
  });

  it('usa classic como fallback de template inválido', () => {
    const model = buildStoreOgCardV2Model(baseInput({ templateCode: 'experimental' }));
    expect(model.layout).toEqual({ templateCode: 'classic', variant: 'classic' });
  });

  it('genera contraste legible para un tema claro', () => {
    const model = buildStoreOgCardV2Model(baseInput({
      theme: {
        primaryColor: '#ffffff',
        secondaryColor: '#f8fafc',
        cornerStyle: 'rounded',
      },
    }));
    expect(model.visual.textOnBackground).toBe('#0f172a');
    expect(model.visual.textOnSurface).toBe('#0f172a');
    expect(model.visual.textOnAccent).toBe('#0f172a');
  });

  it('genera contraste legible para un tema oscuro', () => {
    const model = buildStoreOgCardV2Model(baseInput({
      theme: {
        primaryColor: '#0f172a',
        secondaryColor: '#020617',
        cornerStyle: 'square',
      },
    }));
    expect(model.visual.textOnBackground).toBe('#ffffff');
    expect(model.visual.textOnSurface).toBe('#ffffff');
    expect(model.visual.textOnAccent).toBe('#ffffff');
  });

  it('separa de forma determinista la superficie cuando los colores son casi iguales', () => {
    const model = buildStoreOgCardV2Model(baseInput({
      theme: {
        primaryColor: '#334155',
        secondaryColor: '#334154',
        cornerStyle: 'soft',
      },
    }));
    expect(model.visual.backgroundColor).toBe('#334154');
    expect(model.visual.accentColor).toBe('#334155');
    expect(model.visual.surfaceColor).not.toBe(model.visual.backgroundColor);
  });

  it('cae al tema canónico cuando los colores son inválidos', () => {
    const model = buildStoreOgCardV2Model(baseInput({
      theme: {
        primaryColor: 'red',
        secondaryColor: 'private-color',
        cornerStyle: 'circle',
      },
    }));
    expect(model.visual).toMatchObject({
      backgroundColor: '#0369a1',
      accentColor: '#0284c7',
      cornerStyle: 'rounded',
    });
  });

  it('cae al tema canónico cuando theme no existe', () => {
    const model = buildStoreOgCardV2Model(baseInput({ theme: undefined }));
    expect(model.visual).toMatchObject({
      backgroundColor: '#0369a1',
      accentColor: '#0284c7',
      cornerStyle: 'rounded',
    });
  });

  it.each([
    ['Café Uno', 76, 'short'],
    ['M'.repeat(30), 68, 'medium'],
    ['L'.repeat(50), 60, 'long'],
    ['V'.repeat(120), 52, 'very long'],
  ])('clasifica un nombre %s con tamaño estable', (name, expectedSize) => {
    const model = buildStoreOgCardV2Model(baseInput({ name }));
    expect(model.visual.titleSize).toBe(expectedSize);
    expect(Array.from(model.content.name).length).toBeLessThanOrEqual(80);
  });

  it('conserva branding público cuando existen logo y portada', () => {
    const model = buildStoreOgCardV2Model(baseInput());
    expect(model.branding.logoUrl).toContain('/logos/logo.png');
    expect(model.branding.coverImageUrl).toContain('/covers/cover.png');
  });

  it('conserva logo sin portada', () => {
    const model = buildStoreOgCardV2Model(baseInput({ coverImageUrl: '' }));
    expect(model.branding.logoUrl).not.toBeNull();
    expect(model.branding.coverImageUrl).toBeNull();
  });

  it('conserva portada sin logo', () => {
    const model = buildStoreOgCardV2Model(baseInput({ logoUrl: '' }));
    expect(model.branding.logoUrl).toBeNull();
    expect(model.branding.coverImageUrl).not.toBeNull();
  });

  it('mantiene branding Lanzo sin imágenes', () => {
    const model = buildStoreOgCardV2Model(baseInput({ logoUrl: null, coverImageUrl: null }));
    expect(model.branding).toEqual({
      logoUrl: null,
      coverImageUrl: null,
      poweredBy: 'Impulsado por Lanzo',
    });
  });

  it('rechaza candidatos de imagen no HTTPS o con credenciales', () => {
    const model = buildStoreOgCardV2Model(baseInput({
      logoUrl: 'http://example.test/logo.png',
      coverImageUrl: 'https://user:pass@example.test/cover.png',
    }));
    expect(model.branding.logoUrl).toBeNull();
    expect(model.branding.coverImageUrl).toBeNull();
  });

  it('excluye profundamente campos privados, operativos y de identidad', () => {
    const privateValues = [
      '+52 999 000 0000',
      'privado@example.test',
      'Calle privada',
      '19.4326,-99.1332',
      '09:00-18:00',
      'stock-secreto',
      'inventario-secreto',
      'pedido-secreto',
      'cliente-secreto',
      'admin-secreto',
      'staff-secreto',
      'licencia-secreta',
      'device-secreto',
      'session-secreto',
      'token-secreto',
      'credential-secreto',
      'service-role-secreto',
    ];
    const model = buildStoreOgCardV2Model(baseInput({
      whatsapp_phone: privateValues[0],
      phone: privateValues[0],
      email: privateValues[1],
      address: privateValues[2],
      address_text: privateValues[2],
      coordinates: privateValues[3],
      openingHours: privateValues[4],
      availability: privateValues[4],
      stock: privateValues[5],
      productInventory: privateValues[6],
      orders: [privateValues[7]],
      customers: [privateValues[8]],
      admin_user_id: privateValues[9],
      staff_user_id: privateValues[10],
      license_id: privateValues[11],
      device_id: privateValues[12],
      session_id: privateValues[13],
      token: privateValues[14],
      credentials: privateValues[15],
      service_role: privateValues[16],
    }));
    const serialized = JSON.stringify(model);
    privateValues.forEach((value) => expect(serialized).not.toContain(value));
  });

  it('excluye businessType del contrato visual V2', () => {
    const serialized = JSON.stringify(buildStoreOgCardV2Model(baseInput({
      businessType: ['apparel', 'pharmacy'],
    })));
    expect(serialized).not.toMatch(/businessType|apparel|pharmacy/u);
  });

  it('no introduce dependencias de fuentes externas ni activa fontStyle', () => {
    const serialized = JSON.stringify(buildStoreOgCardV2Model(baseInput()));
    expect(serialized).not.toMatch(/fontStyle|fontFamily|fontUrl|fonts\.googleapis|fonts\.gstatic|data:font/iu);
  });

  it('produce únicamente colores CSS compatibles y deterministas', () => {
    const first = buildStoreOgCardV2Model(baseInput());
    const second = buildStoreOgCardV2Model(baseInput());
    VISUAL_COLOR_KEYS.forEach((key) => {
      expect(first.visual[key]).toMatch(CSS_COLOR);
      expect(first.visual[key]).toBe(second.visual[key]);
    });
  });

  it('no muta el objeto de entrada ni su theme', () => {
    const input = baseInput({
      businessType: ['apparel'],
      unrelated: { nested: 'keep-me' },
    });
    const before = JSON.parse(JSON.stringify(input));
    buildStoreOgCardV2Model(input);
    expect(input).toEqual(before);
  });

  it('preserva normalización y truncado seguro del texto para contenido visual', () => {
    const model = buildStoreOgCardV2Model(baseInput({
      name: `  ${'N'.repeat(100)}  `,
      headline: `  ${'D'.repeat(220)}  `,
    }));
    expect(Array.from(model.content.name).length).toBe(80);
    expect(Array.from(model.content.shortDescription).length).toBe(180);
  });
});
