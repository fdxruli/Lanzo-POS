import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const imageStyles = readFileSync(
  new URL('../../components/ecommerce/public/PublicProductImageSizing.css', import.meta.url),
  'utf8'
);
const safeImageSource = readFileSync(
  new URL('../../components/ecommerce/public/PublicSafeImage.jsx', import.meta.url),
  'utf8'
);

const compactWhitespace = (value) => value.replace(/\s+/g, ' ');
const normalizedStyles = compactWhitespace(imageStyles);

describe('public ecommerce product image sizing', () => {
  it('loads the sizing contract with the shared safe image component', () => {
    expect(safeImageSource).toContain("import './PublicProductImageSizing.css';");
  });

  it('keeps grid images inside a stable responsive media box', () => {
    expect(normalizedStyles).toContain(
      '.public-catalog.public-catalog--view-grid .public-product-card__image.public-safe-image {'
    );
    expect(normalizedStyles).toContain('aspect-ratio: 4 / 3');
    expect(normalizedStyles).toContain('object-fit: contain');
  });

  it('prevents portrait images from increasing list card height', () => {
    const listRule = normalizedStyles.match(
      /\.public-catalog\.public-catalog--view-list \.public-product-card__image\.public-safe-image \{(.*?)\}/
    )?.[1] || '';

    expect(listRule).toContain('align-self: center');
    expect(listRule).toContain('height: 7.5rem');
    expect(listRule).toContain('min-height: 7.5rem');
    expect(listRule).toContain('max-height: 7.5rem');
    expect(listRule).toContain('object-fit: contain');
    expect(listRule).not.toContain('height: 100%');
  });

  it('scopes the overrides to the neutral ecommerce site surface', () => {
    const selectors = imageStyles.match(/^[^\n{]+\{/gm) || [];
    expect(selectors.length).toBe(3);
    selectors.forEach((selector) => {
      expect(selector.trim()).toMatch(/^\.ecommerce-site-surface/);
    });
  });
});
