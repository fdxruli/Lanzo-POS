// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    expect(document.querySelector('[data-site-template="classic"]')).toBeTruthy();
    expect(document.querySelector('[data-site-content-width="standard"]')).toBeTruthy();
    expect(document.querySelector('[data-site-mode="public"]')).toHaveStyle({ '--store-primary': '#0284c7' });
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

  it('shows the configured business type beside the online store label', () => {
    renderSite({
      portal: { ...portal, businessType: ['abarrotes'] }
    });

    expect(screen.getByText('Tienda online')).toBeTruthy();
    expect(screen.getByText('Abarrotes / Tienda')).toBeTruthy();
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

  it.each(['classic', 'showcase', 'compact'])('keeps the shared header available in the %s template and preview', (templateCode) => {
    const siteDocument = createDefaultEcommerceSiteDocument({ templateCode });
    renderSite({
      siteDocument,
      portal: { ...portal, templateCode },
      mode: 'preview'
    });

    expect(document.querySelector(`[data-site-template="${templateCode}"]`)).toBeTruthy();
    expect(document.querySelector('[data-site-section="header"] [data-cover-orientation="landscape"]')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Tienda' })).toBeTruthy();
    expect(screen.getByText('Información')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('uses the same derived profile for preview and public render modes without global styles', () => {
    const siteDocument = createDefaultEcommerceSiteDocument({
      templateCode: 'showcase',
      theme: { primaryColor: '#111827', secondaryColor: '#facc15', cornerStyle: 'soft', fontStyle: 'rounded' }
    });
    const { rerender } = renderSite({ siteDocument, mode: 'public' });
    const publicRenderer = document.querySelector('.ecommerce-site-renderer');
    const publicTokens = publicRenderer.getAttribute('style');
    rerender(<EcommerceSiteRenderer {...commonProps} siteDocument={siteDocument} mode="preview" />);
    const previewRenderer = document.querySelector('.ecommerce-site-renderer');
    expect(previewRenderer.getAttribute('style')).toBe(publicTokens);
    expect(document.documentElement.style.getPropertyValue('--store-primary')).toBe('');
  });

  it('keeps product actions inert in preview mode even for configurable products', () => {
    const configuredProduct = {
      id: 'shirt', name: 'Playera', price: 100, isAvailable: true,
      configuration: { requiresConfiguration: true, hasVariants: true }
    };
    const onAdd = vi.fn();
    renderSite({
      mode: 'preview',
      catalogProps: {
        ...catalogProps,
        products: [configuredProduct],
        filteredProducts: [configuredProduct],
        onAdd
      }
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de Playera' }));
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar opciones Playera' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
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
