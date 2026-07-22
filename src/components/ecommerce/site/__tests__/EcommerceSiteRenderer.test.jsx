// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import EcommerceSiteRenderer from '../EcommerceSiteRenderer';
import { createDefaultEcommerceSiteDocument } from '../../../../utils/ecommerceSiteDocument';

const portal = {
  name: 'Tienda',
  templateCode: 'classic',
  pickupEnabled: true,
  deliveryEnabled: false,
  minOrderTotal: 0
};
const catalogProps = {
  products: [{ id: 'p1', name: 'Producto', price: 10, currency: 'MXN' }],
  filteredProducts: [{ id: 'p1', name: 'Producto', price: 10, currency: 'MXN' }],
  categories: ['General'],
  searchTerm: '',
  selectedCategory: 'all',
  onSearchChange: () => {},
  onCategoryChange: () => {},
  onAdd: () => {},
  isLoading: false,
  error: null,
  onRetry: () => {},
  hasMore: false,
  onLoadMore: () => {},
  isLoadingMore: false,
  catalogRevision: 1
};
const commonProps = {
  portal,
  hours: { weekly: [], exceptions: [] },
  availability: { legacy: true },
  slug: 'tienda',
  catalogProps
};

const renderSite = (props = {}) => render(
  <EcommerceSiteRenderer {...commonProps} {...props} />
);

describe('EcommerceSiteRenderer', () => {
  afterEach(cleanup);

  it('uses the delivered document in public mode and keeps canonical section order', () => {
    const siteDocument = createDefaultEcommerceSiteDocument();
    siteDocument.global.density = 'compact';
    renderSite({ siteDocument, siteDocumentMode: 'custom', mode: 'public' });

    const sections = document.querySelectorAll('[data-site-section]');
    expect([...sections].map((node) => node.dataset.siteSection)).toEqual(['header', 'catalog', 'footer']);
    expect(document.querySelector('[data-site-mode="public"]')).toHaveClass(
      'ecommerce-site-renderer',
      'ecommerce-site-renderer--density-compact'
    );
    expect(document.querySelector('[data-site-density="compact"]')).toBeTruthy();
  });

  it('treats documentMode as metadata and does not replace a published default document', () => {
    const publishedClassic = createDefaultEcommerceSiteDocument({ templateCode: 'classic' });
    publishedClassic.sections[1].props = { showSearch: false, showCategories: false };

    renderSite({
      siteDocument: publishedClassic,
      siteDocumentMode: 'default',
      portal: { ...portal, templateCode: 'compact' }
    });

    expect(document.querySelector('[data-site-document-mode="default"]')).toBeTruthy();
    expect(document.querySelector('[data-site-density="comfortable"]')).toBeTruthy();
    expect(document.querySelector('[data-site-section="header"][data-site-layout="default"]')).toHaveClass(
      'ecommerce-site-section--layout-default'
    );
    expect(document.querySelector('[data-site-section="catalog"][data-site-layout="grid"]')).toHaveClass(
      'ecommerce-site-section--layout-grid'
    );
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('does not alter a versioned document when templateCode changes', () => {
    const publishedClassic = createDefaultEcommerceSiteDocument({ templateCode: 'classic' });
    const { rerender } = renderSite({
      siteDocument: publishedClassic,
      siteDocumentMode: 'default',
      portal
    });

    rerender(
      <EcommerceSiteRenderer
        {...commonProps}
        siteDocument={publishedClassic}
        siteDocumentMode="default"
        portal={{ ...portal, templateCode: 'compact' }}
      />
    );

    expect(document.querySelector('[data-site-density="comfortable"]')).toBeTruthy();
    expect(document.querySelector('[data-site-section="header"][data-site-layout="default"]')).toBeTruthy();
    expect(document.querySelector('[data-site-section="catalog"][data-site-layout="grid"]')).toBeTruthy();
  });

  it('exposes distinct structural classes for showcase and compact document layouts', () => {
    const siteDocument = createDefaultEcommerceSiteDocument();
    siteDocument.sections[0].layout = 'showcase';
    siteDocument.sections[1].layout = 'compact';

    renderSite({
      siteDocument,
      portal: { ...portal, templateCode: 'classic' }
    });

    expect(document.querySelector('[data-site-section="header"]')).toHaveClass(
      'ecommerce-site-section--layout-showcase'
    );
    expect(document.querySelector('[data-site-section="catalog"]')).toHaveClass(
      'ecommerce-site-section--layout-compact'
    );
  });

  it('uses the current portal preset only when the document is absent or invalid', () => {
    const compactPortal = { ...portal, templateCode: 'compact' };
    const { rerender } = renderSite({ siteDocument: null, portal: compactPortal });
    expect(document.querySelector('[data-site-density="compact"]')).toBeTruthy();
    expect(document.querySelector('[data-site-section="catalog"][data-site-layout="compact"]')).toBeTruthy();

    rerender(
      <EcommerceSiteRenderer
        {...commonProps}
        siteDocument={{ schemaVersion: 1 }}
        portal={compactPortal}
      />
    );
    expect(document.querySelector('[data-site-density="compact"]')).toBeTruthy();
    expect(document.querySelector('[data-site-section="catalog"][data-site-layout="compact"]')).toBeTruthy();
  });

  it('applies showSearch and showCategories from the delivered document', () => {
    const hiddenControls = createDefaultEcommerceSiteDocument();
    hiddenControls.sections[1].props = { showSearch: false, showCategories: false };
    const { rerender } = renderSite({ siteDocument: hiddenControls, siteDocumentMode: 'custom' });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();

    const visibleControls = createDefaultEcommerceSiteDocument();
    rerender(
      <EcommerceSiteRenderer
        {...commonProps}
        siteDocument={visibleControls}
        siteDocumentMode="custom"
      />
    );
    expect(screen.getByRole('searchbox')).toBeTruthy();
    expect(screen.getByRole('combobox')).toBeTruthy();
  });
});
