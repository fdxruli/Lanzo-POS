import { describe, expect, it } from 'vitest';
import {
  StoreOgFallbackCard,
  buildStoreOgFallbackCardModel,
} from '../../api/_storeOgFallbackCard.js';

function collectTypes(node, result = []) {
  if (!node || typeof node !== 'object') return result;
  result.push(node.type);
  const children = node.props?.children;
  const childList = Array.isArray(children) ? children : [children];
  childList.forEach((child) => collectTypes(child, result));
  return result;
}

describe('buildStoreOgFallbackCardModel', () => {
  it('construye el fallback específico para tienda inexistente', () => {
    expect(buildStoreOgFallbackCardModel({ status: 'not_found' })).toEqual({
      renderer: 'fallback',
      status: 'not_found',
      name: 'Tienda no disponible',
      description: 'Consulta otras tiendas creadas con Lanzo.',
      visual: {
        primaryColor: '#0284c7',
        darkPrimary: '#022e4f',
        lightAccent: '#b8d5e5',
        radius: 38,
        nameSize: 76,
      },
    });
  });

  it('construye unavailable y normaliza estados inesperados al fallback seguro', () => {
    const expected = {
      renderer: 'fallback',
      status: 'unavailable',
      name: 'Tienda en línea',
      description: 'Consulta productos y realiza tu pedido con Lanzo.',
    };
    expect(buildStoreOgFallbackCardModel({ status: 'unavailable' })).toMatchObject(expected);
    expect(buildStoreOgFallbackCardModel({ status: 'unexpected' })).toMatchObject(expected);
    expect(buildStoreOgFallbackCardModel()).toMatchObject(expected);
  });

  it('es determinista y profundamente inmutable', () => {
    const first = buildStoreOgFallbackCardModel({ status: 'not_found' });
    const second = buildStoreOgFallbackCardModel({ status: 'not_found' });
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.visual)).toBe(true);
  });

  it('no incorpora imágenes, URLs, datos de portal ni campos privados u operativos', () => {
    const model = buildStoreOgFallbackCardModel({
      status: 'unavailable',
      logoUrl: 'https://private.test/logo.png',
      coverImageUrl: 'https://private.test/cover.png',
      businessType: 'private-business-type',
      whatsapp: '+52 999 000 0000',
      email: 'private@example.test',
      address: 'Calle privada',
      hours: 'private-hours',
      availability: 'private-availability',
      orders: 'private-orders',
      stock: 'private-stock',
      products: 'private-products',
      license: 'private-license',
      tenant: 'private-tenant',
      admin: 'private-admin',
      staff: 'private-staff',
      device: 'private-device',
      session: 'private-session',
      tokens: 'private-tokens',
      credentials: 'private-credentials',
    });
    const serialized = JSON.stringify(model);
    expect(serialized).not.toMatch(/https?:\/\/|logo|cover|businessType/iu);
    expect(serialized).not.toMatch(/whatsapp|email|address|hours|availability|orders|stock|products|license|tenant|admin|staff|device|session|tokens|credentials/iu);
    expect(Object.keys(model).sort()).toEqual([
      'description',
      'name',
      'renderer',
      'status',
      'visual',
    ]);
  });
});

describe('StoreOgFallbackCard', () => {
  it.each(['not_found', 'unavailable'])(
    'renderiza %s sin imágenes, URLs remotas ni dependencia de branding personalizado',
    (status) => {
      const model = buildStoreOgFallbackCardModel({ status });
      const tree = StoreOgFallbackCard({ model });
      const serialized = JSON.stringify(tree);
      expect(collectTypes(tree)).not.toContain('img');
      expect(serialized).not.toMatch(/https?:\/\/|data:image|businessType/iu);
      expect(serialized).toContain(status === 'not_found' ? 'Tienda no disponible' : 'Tienda en línea');
      expect(serialized).toContain('Impulsado por Lanzo');
      expect(serialized).toContain('backgroundImage');
      expect(serialized).toContain('boxShadow');
      expect(serialized).toContain('inset');
      expect(serialized).not.toContain('"background":"linear-gradient');
      expect(serialized).not.toMatch(/#[0-9a-f]{8}/iu);
      expect(serialized).toContain('rgba(');
    },
  );
});
