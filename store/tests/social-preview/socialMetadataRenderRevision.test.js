import { describe, expect, it } from 'vitest';
import {
  buildOpenGraphImageUrl,
  buildStoreSocialMetadata,
} from '../../api/_socialMetadata.js';

const PUBLIC_ORIGIN = 'https://tienda.lanzo.test';

describe('revisión independiente del renderizador Open Graph', () => {
  it('conserva la versión del contenido y agrega una revisión separada', () => {
    const result = buildOpenGraphImageUrl({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'mi-tienda',
      siteVersionNumber: 7,
      renderRevision: 2,
    });

    expect(result).toEqual({
      imageUrl: `${PUBLIC_ORIGIN}/api/og/store?slug=mi-tienda&v=7&rv=2`,
      imageVersioned: true,
    });
  });

  it('agrega la revisión aunque todavía no exista una versión publicada', () => {
    const result = buildOpenGraphImageUrl({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'mi-tienda',
      renderRevision: 2,
    });

    expect(result).toEqual({
      imageUrl: `${PUBLIC_ORIGIN}/api/og/store?slug=mi-tienda&rv=2`,
      imageVersioned: false,
    });
  });

  it.each([
    [undefined],
    [0],
    [-1],
    [1.5],
    ['2'],
    [Number.MAX_SAFE_INTEGER + 1],
  ])('omite una revisión inválida: %s', (renderRevision) => {
    const result = buildOpenGraphImageUrl({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'mi-tienda',
      siteVersionNumber: 7,
      renderRevision,
    });

    expect(result.imageUrl).toBe(
      `${PUBLIC_ORIGIN}/api/og/store?slug=mi-tienda&v=7`,
    );
  });

  it('propaga exactamente la misma URL a Open Graph y Twitter', () => {
    const metadata = buildStoreSocialMetadata({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'mi-tienda',
      portal: {
        name: 'Mi Tienda',
        headline: 'Compra en línea',
      },
      siteVersionNumber: 7,
      renderRevision: 2,
    });

    expect(metadata.imageUrl).toBe(
      `${PUBLIC_ORIGIN}/api/og/store?slug=mi-tienda&v=7&rv=2`,
    );
    expect(metadata.openGraph.image).toBe(metadata.imageUrl);
    expect(metadata.twitter.image).toBe(metadata.imageUrl);
  });
});
