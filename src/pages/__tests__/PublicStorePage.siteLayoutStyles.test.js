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
const sharedRendererSelectors = publicStyles.match(/^[^\n{]*\.ecommerce-site-renderer[^\n{]*\{/gm) || [];

describe('public ecommerce site layout styles', () => {
  it('defines visibly different comfortable and compact density tokens', () => {
    expect(normalizedPublicStyles).toContain(
      '.ecommerce-site-renderer[data-site-density="comfortable"] {'
    );
    expect(normalizedPublicStyles).toContain(
      '.ecommerce-site-renderer[data-site-density="compact"] {'
    );
    expect(normalizedPublicStyles).toContain('--site-content-padding-start: var(--store-page-padding)');
    expect(normalizedPublicStyles).toContain('--site-card-padding: var(--store-card-padding)');
    expect(normalizedPublicStyles).toContain('--site-catalog-gap: var(--store-grid-gap)');
  });

  it('defines distinct public header layouts from the versioned section attribute', () => {
    expect(normalizedPublicStyles).toContain(
      '[data-site-section="header"][data-site-layout="default"] .public-store-header__cover-wrap'
    );
    expect(normalizedPublicStyles).toContain('height: var(--store-header-cover-height)');
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

  it('defines a visual treatment for every supported template', () => {
    ['classic', 'showcase', 'compact'].forEach((template) => {
      expect(normalizedPublicStyles).toContain(`[data-site-template="${template}"]`);
    });
    expect(normalizedPublicStyles).toContain('box-shadow: var(--store-shadow-elevated)');
    expect(normalizedPublicStyles).toContain('height: var(--store-header-cover-height)');
    expect(normalizedPublicStyles).toContain('outline: 3px solid var(--store-focus-ring, #7dd3fc)');
  });

  it('scopes every shared renderer rule to the neutral site surface', () => {
    expect(sharedRendererSelectors.length).toBeGreaterThan(20);
    sharedRendererSelectors.forEach((selector) => {
      expect(selector.trim()).toMatch(/^\.ecommerce-site-surface \.ecommerce-site-renderer/);
      expect(selector).not.toContain('.public-store-shell');
    });
  });

  it('keeps document-level escape rules exclusive to the public shell', () => {
    const documentRules = normalizedPublicStyles.slice(0, normalizedPublicStyles.indexOf('.ecommerce-site-surface'));
    expect(documentRules).toMatch(/html:has\(\.public-store-shell\)/);
    expect(documentRules).toMatch(/body:has\(\.public-store-shell\)/);
    expect(documentRules).toMatch(/#root:has\(\.public-store-shell\)/);
    expect(documentRules).toMatch(/html\.public-store-document/);
    expect(documentRules).toMatch(/body\.public-store-body/);
    expect(documentRules).toMatch(/#root\.public-store-root/);
    expect(normalizedPublicStyles).not.toMatch(
      /(?:html|body|#root):has\(\.ecommerce-site-surface\)/
    );
    expect(normalizedPublicStyles).not.toMatch(
      /(?:html|body|#root)\.ecommerce-site-surface/
    );
    expect(normalizedPreviewStyles).not.toMatch(
      /public-store-(?:document|body|root)|:has\(\.public-store-shell\)/
    );
    expect(normalizedPreviewStyles).not.toMatch(
      /(?:html|body|#root).*?(?:overflow|min-height|height)/
    );
  });

  it('preserves viewport height and cart clearance on the public page shell only', () => {
    const publicShellRule = normalizedPublicStyles.match(/\.public-store-shell \{(.*?)\}/)?.[1] || '';
    expect(publicShellRule).toContain('min-height: 100vh');
    expect(publicShellRule).toContain('min-height: 100dvh');
    expect(publicShellRule).toContain(
      'padding-bottom: calc(6.5rem + env(safe-area-inset-bottom))'
    );
    expect(normalizedPreviewStyles).not.toContain('min-height: 100vh');
    expect(normalizedPreviewStyles).not.toContain('min-height: 100dvh');
  });

  it('bridges token aliases through the scoped renderer authority', () => {
    const rendererRule = normalizedPublicStyles.match(/\.ecommerce-site-surface \.ecommerce-site-renderer \{(.*?)\}/)?.[1] || '';
    expect(rendererRule).toContain('--ui-color-primary: var(--store-primary)');
    expect(rendererRule).toContain('--ui-color-primary-hover: var(--store-primary-hover)');
    expect(rendererRule).toContain('--ui-color-secondary: var(--store-secondary)');
    expect(rendererRule).toContain('--ui-bg-surface: var(--store-surface)');
    expect(rendererRule).toContain('font-family: var(--store-font-body)');
    expect(rendererRule).toContain('background: radial-gradient');
    expect(rendererRule).toContain('color: var(--store-text)');
    expect(normalizedPublicStyles).not.toMatch(/:root\s*\{[^}]*--store-/);
  });

  it('shares themed product, cart and checkout visuals', () => {
    expect(normalizedPublicStyles).toContain(
      '.ecommerce-site-surface .ui-button--primary, .ecommerce-site-surface .public-product-card__add'
    );
    expect(normalizedPublicStyles).toContain(
      'border-radius: var(--store-radius-button, 0.75rem)'
    );
    expect(normalizedPublicStyles).toContain(
      'background-color: var(--store-primary, #0284c7)'
    );
    expect(normalizedPublicStyles).toContain(
      'color: var(--store-on-primary, #fff)'
    );
    expect(normalizedPublicStyles).toContain('.public-store-shell .public-cart-drawer');
    expect(normalizedPublicStyles).toContain('.public-store-shell .public-checkout-dialog');
    expect(normalizedPublicStyles).toContain('background: var(--ui-bg-surface)');
  });

  it('shares box sizing and inherited control fonts without preview-only theme rules', () => {
    expect(normalizedPublicStyles).toContain(
      '.ecommerce-site-surface *, .ecommerce-site-surface *::before, .ecommerce-site-surface *::after'
    );
    expect(normalizedPublicStyles).toContain(
      '.ecommerce-site-surface button, .ecommerce-site-surface input, .ecommerce-site-surface select'
    );
    expect(normalizedPreviewStyles).not.toMatch(/ecom-builder-preview-inert.*--store-/);
    expect(normalizedPreviewStyles).not.toMatch(/ecom-builder-preview-inert.*--ui-color-/);
  });
});
