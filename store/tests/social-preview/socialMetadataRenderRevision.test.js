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

  it('produce URLs distintas para rv=3 y rv=4 con el mismo slug y versión', () => {
    const rv3 = buildOpenGraphImageUrl({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'mi-tienda',
      siteVersionNumber: 7,
      renderRevision: 3,
    });
    const rv4 = buildOpenGraphImageUrl({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'mi-tienda',
      siteVersionNumber: 7,
      renderRevision: 4,
    });

    expect(rv3.imageUrl).toBe(
      `${PUBLIC_ORIGIN}/api/og/store?slug=mi-tienda&v=7&rv=3`,
    );
    expect(rv4.imageUrl).toBe(
      `${PUBLIC_ORIGIN}/api/og/store?slug=mi-tienda&v=7&rv=4`,
    );
    expect(rv4.imageUrl).not.toBe(rv3.imageUrl);
  });

  it('propaga exactamente la misma URL rv=4 a Open Graph y Twitter', () => {
    const metadata = buildStoreSocialMetadata({
      publicOrigin: PUBLIC_ORIGIN,
      slug: 'mi-tienda',
      portal: {
        name: 'Mi Tienda',
        headline: 'Compra en línea',
      },
      siteVersionNumber: 7,
      renderRevision: 4,
    });

    expect(metadata.imageUrl).toBe(
      `${PUBLIC_ORIGIN}/api/og/store?slug=mi-tienda&v=7&rv=4`,
    );
    expect(metadata.openGraph.image).toBe(metadata.imageUrl);
    expect(metadata.twitter.image).toBe(metadata.imageUrl);
  });
});
