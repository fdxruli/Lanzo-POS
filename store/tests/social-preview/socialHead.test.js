import { describe, expect, it } from 'vitest';
import { renderSocialHead } from '../../api/_socialHead.js';
import {
  buildGenericStoreSocialMetadata,
  buildStoreSocialMetadata,
} from '../../api/_socialMetadata.js';

const buildMetadata = (portal = {}) => buildStoreSocialMetadata({
  publicOrigin: 'https://store.example.test',
  slug: 'mi-tienda',
  portal: {
    name: 'Mi Tienda',
    headline: 'Compra en línea',
    description: 'Catálogo público',
    ...portal,
  },
  siteVersionNumber: 9,
});

const count = (source, pattern) => (source.match(pattern) || []).length;

describe('renderSocialHead', () => {
  it('serializa title, description, canonical, Open Graph y Twitter una sola vez', () => {
    const head = renderSocialHead(buildMetadata());
    expect(count(head, /<title>/gu)).toBe(1);
    expect(count(head, /name="description"/gu)).toBe(1);
    expect(count(head, /rel="canonical"/gu)).toBe(1);
    [
      'og:type', 'og:title', 'og:description', 'og:url', 'og:image',
      'og:image:type', 'og:image:width', 'og:image:height', 'og:image:alt',
      'og:locale', 'og:site_name',
    ].forEach((property) => {
      expect(count(head, new RegExp(`property="${property}"`, 'gu'))).toBe(1);
    });
    [
      'twitter:card', 'twitter:title', 'twitter:description',
      'twitter:image', 'twitter:image:alt',
    ].forEach((name) => {
      expect(count(head, new RegExp(`name="${name}"`, 'gu'))).toBe(1);
    });
    expect(head).toContain('content="1200"');
    expect(head).toContain('content="630"');
    expect(head).toContain('content="image/png"');
  });

  it('escapa texto y atributos exclusivamente al serializar', () => {
    const head = renderSocialHead(buildMetadata({
      name: `A & B <C> "D" 'E' </title><script>alert(1)</script>`,
      headline: `Compra & <ahora> "sí" 'ya'"><img src=x>`,
    }));
    expect(head).toContain('A &amp; B &lt;C&gt; &quot;D&quot; &#39;E&#39;');
    expect(head).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(head).toContain('&quot;&gt;&lt;img src=x&gt;');
    expect(head).not.toContain('<script');
    expect(head).not.toContain('&amp;amp;');
  });

  it('no acepta objetos ni etiquetas preconstruidas por el cliente', () => {
    expect(() => renderSocialHead({
      title: '<script>privado</script>',
      openGraph: {},
      twitter: {},
    })).toThrow(/approved constructor/u);
  });

  it('omite canonical e imagen en fallbacks genéricos sin crear URLs falsas', () => {
    const notFound = renderSocialHead(buildGenericStoreSocialMetadata({ status: 'not_found' }));
    expect(notFound).toContain('<title>Tienda no disponible | Lanzo</title>');
    expect(notFound).toContain('Esta tienda no está disponible.');
    expect(notFound).not.toMatch(/canonical|og:url|og:image|twitter:image/iu);

    const unavailable = renderSocialHead(
      buildGenericStoreSocialMetadata({ status: 'unavailable' }),
    );
    expect(unavailable).toContain('<title>Tienda en línea | Lanzo</title>');
    expect(unavailable).toContain('Consulta productos y realiza tu pedido en línea.');
  });

  it('no serializa datos privados ajenos al contrato social', () => {
    const metadata = buildMetadata({
      phone: '+52 999 000 0000',
      email: 'private@example.test',
      address: 'Calle Privada',
      license: 'LANZO-PRIVATE',
      trackingToken: 'tracking-secret',
    });
    const head = renderSocialHead(metadata);
    expect(head).not.toMatch(/999 000|private@example|Calle Privada|LANZO-PRIVATE|tracking-secret/u);
  });
});
