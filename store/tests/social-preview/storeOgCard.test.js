import { describe, expect, it } from 'vitest';
import {
  StoreOgCard,
  buildStoreOgCardModel,
  colorLuminance,
  mixOgColor,
  readableTextColor,
} from '../../api/_storeOgCard.js';

const okResult = (portal = {}, siteVersionNumber = 3) => ({
  status: 'ok',
  portal: {
    slug: 'tienda-prueba',
    name: 'Café del Centro',
    headline: 'Productos elegidos para disfrutar en casa',
    description: 'Descripción secundaria',
    theme: {
      primaryColor: '#112233',
      secondaryColor: '#aabbcc',
      cornerStyle: 'soft',
      fontStyle: 'editorial',
    },
    logoUrl: 'https://public-project.supabase.test/storage/v1/object/public/logos/logo.png',
    coverImageUrl: 'https://public-project.supabase.test/storage/v1/object/public/covers/cover.png',
    ...portal,
  },
  siteVersionNumber,
});

describe('buildStoreOgCardModel', () => {
  it('construye una tienda PRO con logo y portada ya descargados', () => {
    const model = buildStoreOgCardModel({
      result: okResult(),
      logoImage: 'data:image/png;base64,bG9nbw==',
      coverImage: 'data:image/jpeg;base64,Y292ZXI=',
    });

    expect(model).toMatchObject({
      label: 'Tienda en línea',
      name: 'Café del Centro',
      description: 'Productos elegidos para disfrutar en casa',
      initial: 'C',
      logoImage: 'data:image/png;base64,bG9nbw==',
      coverImage: 'data:image/jpeg;base64,Y292ZXI=',
      poweredBy: 'Impulsado por Lanzo',
    });
  });

  it('conserva logo sin portada y cae a inicial sin logo', () => {
    expect(buildStoreOgCardModel({
      result: okResult(),
      logoImage: 'data:image/png;base64,bG9nbw==',
    })).toMatchObject({
      logoImage: 'data:image/png;base64,bG9nbw==',
      coverImage: null,
    });
    expect(buildStoreOgCardModel({ result: okResult() })).toMatchObject({
      initial: 'C',
      logoImage: null,
      coverImage: null,
    });
  });

  it('no entrega una URL remota directamente al motor de imagen', () => {
    const model = buildStoreOgCardModel({
      result: okResult(),
      logoImage: okResult().portal.logoUrl,
      coverImage: 'https://evil.test/cover.png',
    });
    expect(model.logoImage).toBeNull();
    expect(model.coverImage).toBeNull();
  });

  it('usa fallback Lanzo sin branding y L cuando no hay letra visible', () => {
    const model = buildStoreOgCardModel({
      result: okResult({ name: '   ', headline: '', description: '', theme: null }),
    });
    expect(model.name).toBe('Tienda en línea');
    expect(model.description).toBe('Consulta productos y realiza tu pedido con Lanzo.');
    expect(model.initial).toBe('L');

    const unavailable = buildStoreOgCardModel({
      result: { status: 'unavailable', reason: 'timeout' },
    });
    expect(unavailable.name).toBe('Tienda en línea');
    expect(unavailable.initial).toBe('L');
  });

  it('usa el fallback específico para tienda inexistente', () => {
    expect(buildStoreOgCardModel({ result: { status: 'not_found' } })).toMatchObject({
      name: 'Tienda no disponible',
      description: 'Consulta otras tiendas creadas con Lanzo.',
    });
  });

  it('adapta el nombre largo, limita nombre y descripción a dos líneas visuales', () => {
    const model = buildStoreOgCardModel({
      result: okResult({
        name: 'N'.repeat(140),
        headline: 'D'.repeat(300),
      }),
    });
    expect(Array.from(model.name).length).toBe(80);
    expect(Array.from(model.description).length).toBe(180);
    expect(model.visual.nameSize).toBe(54);
  });

  it.each([
    ['#ffffff', '#0f172a', 'tema claro'],
    ['#000000', '#ffffff', 'tema oscuro'],
  ])('elige contraste para %s (%s)', (color, expected) => {
    expect(readableTextColor(color)).toBe(expected);
  });

  it('normaliza color y opciones inválidas mediante el tema canónico', () => {
    const model = buildStoreOgCardModel({
      result: okResult({
        theme: {
          primaryColor: 'red',
          secondaryColor: 'private-color',
          cornerStyle: 'circle',
          fontStyle: 'proprietary',
        },
      }),
    });
    expect(model.visual).toMatchObject({
      primaryColor: '#0284c7',
      secondaryColor: '#0369a1',
      radius: 38,
    });
  });

  it('usa la fuente incorporada predeterminada sin familias ni URLs externas', () => {
    const model = buildStoreOgCardModel({
      result: okResult({
        theme: {
          primaryColor: '#112233',
          secondaryColor: '#aabbcc',
          cornerStyle: 'rounded',
          fontStyle: 'editorial',
        },
      }),
    });
    const serialized = JSON.stringify(model);
    const tree = JSON.stringify(StoreOgCard({ model }));
    expect(serialized).not.toMatch(/Arial|Georgia/iu);
    expect(serialized).not.toMatch(/https?:\/\/|data:font|fontFamily/iu);
    expect(tree).not.toMatch(/Arial|Georgia|https?:\/\/|data:font|fontFamily/iu);
  });

  it('usa gradientes compatibles con Satori sin colores hexadecimales de ocho dígitos', () => {
    const tree = JSON.stringify(StoreOgCard({ model: buildStoreOgCardModel({ result: okResult() }) }));
    expect(tree).toContain('backgroundImage');
    expect(tree).toContain('boxShadow');
    expect(tree).toContain('inset');
    expect(tree).not.toContain('"background":"linear-gradient');
    expect(tree).not.toMatch(/#[0-9a-f]{8}/iu);
    expect(tree).toContain('rgba(');
  });

  it('expone utilidades puras y deterministas de luminancia y mezcla', () => {
    expect(colorLuminance('#ffffff')).toBeCloseTo(1);
    expect(colorLuminance('#000000')).toBe(0);
    expect(mixOgColor('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('no conserva contenido privado u operativo', () => {
    const privateValues = [
      '+52 999 000 0000',
      'privado@example.test',
      'Calle privada',
      'stock-secreto',
      'pedido-secreto',
      'licencia-secreta',
    ];
    const result = okResult({
      phone: privateValues[0],
      email: privateValues[1],
      address: privateValues[2],
      stock: privateValues[3],
      order: privateValues[4],
      license: privateValues[5],
    });
    const serialized = JSON.stringify(buildStoreOgCardModel({ result }));
    privateValues.forEach((value) => expect(serialized).not.toContain(value));
  });

  it('devuelve un modelo profundamente inmutable', () => {
    const model = buildStoreOgCardModel({ result: okResult() });
    expect(Object.isFrozen(model)).toBe(true);
    expect(Object.isFrozen(model.visual)).toBe(true);
  });
});
