import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const publicStyles = readFileSync(new URL('../PublicStorePage.css', import.meta.url), 'utf8');
const previewStyles = readFileSync(
  new URL('../../components/ecommerce/EcommercePortalSettings.css', import.meta.url),
  'utf8'
);

const compactWhitespace = (value) => value.replace(/\s+/g, ' ');
const normalizedPublicStyles = compactWhitespace(publicStyles);
const normalizedPreviewStyles = compactWhitespace(previewStyles);

describe('public ecommerce site layout styles', () => {
  it('defines visibly different comfortable and compact density tokens', () => {
    expect(normalizedPublicStyles).toContain(
      '.ecommerce-site-renderer[data-site-density="comfortable"] {'
    );
    expect(normalizedPublicStyles).toContain(
      '.ecommerce-site-renderer[data-site-density="compact"] {'
    );
    expect(normalizedPublicStyles).toContain('--site-content-padding-start: 1.25rem');
    expect(normalizedPublicStyles).toContain('--site-content-padding-start: 0.75rem');
    expect(normalizedPublicStyles).toContain('--site-card-padding: 1rem');
    expect(normalizedPublicStyles).toContain('--site-card-padding: 0.7rem');
  });

  it('defines distinct public header layouts from the versioned section attribute', () => {
    expect(normalizedPublicStyles).toContain(
      '[data-site-section="header"][data-site-layout="default"] .public-store-header__cover-wrap'
    );
    expect(normalizedPublicStyles).toContain('height: clamp(12rem, 36cqi, 23rem)');
    expect(normalizedPublicStyles).toContain(
      '[data-site-section="header"][data-site-layout="showcase"] .public-store-header__cover-wrap'
    );
    expect(normalizedPublicStyles).toContain('height: clamp(17rem, 48cqi, 31rem)');
  });

  it('defines vertical grid and horizontal compact catalog cards publicly', () => {
    expect(normalizedPublicStyles).toContain(
      '[data-site-section="catalog"][data-site-layout="grid"] .public-catalog__grid'
    );
    expect(normalizedPublicStyles).toContain(
      'grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr))'
    );
    expect(normalizedPublicStyles).toContain(
      '[data-site-section="catalog"][data-site-layout="compact"] .public-product-card'
    );
    expect(normalizedPublicStyles).toContain('grid-template-columns: 7rem minmax(0, 1fr)');
  });

  it('uses the shared renderer container to collapse grid to one column on mobile', () => {
    expect(normalizedPublicStyles).toContain('container-name: ecommerce-site');
    expect(normalizedPublicStyles).toContain('@container ecommerce-site (max-width: 34rem)');
    expect(normalizedPublicStyles).toMatch(
      /@container ecommerce-site \(max-width: 34rem\).*?catalog.*?grid-template-columns: minmax\(0, 1fr\)/
    );
  });

  it('keeps functional layout rules out of preview-only and template preset selectors', () => {
    expect(normalizedPreviewStyles).not.toMatch(/ecom-builder-preview-inert.*data-site-layout/);
    expect(normalizedPreviewStyles).not.toMatch(/is-mobile.*public-catalog__grid/);
    expect(normalizedPublicStyles).not.toMatch(/data-template-code=.*public-catalog__grid/);
    expect(normalizedPublicStyles).not.toMatch(/data-template-code=.*public-store-header/);
  });
});
