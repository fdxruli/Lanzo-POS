// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import EcommerceSiteRenderer from '../EcommerceSiteRenderer';
import { createDefaultEcommerceSiteDocument } from '../../../../utils/ecommerceSiteDocument';

const portal = { name: 'Tienda', templateCode: 'classic', pickupEnabled: true, deliveryEnabled: false, minOrderTotal: 0 };
const catalogProps = { products: [{ id: 'p1', name: 'Producto', price: 10, currency: 'MXN' }], filteredProducts: [{ id: 'p1', name: 'Producto', price: 10, currency: 'MXN' }], categories: ['General'], searchTerm: '', selectedCategory: 'all', onSearchChange: () => {}, onCategoryChange: () => {}, onAdd: () => {}, isLoading: false, error: null, onRetry: () => {}, hasMore: false, onLoadMore: () => {}, isLoadingMore: false, catalogRevision: 1 };

describe('EcommerceSiteRenderer', () => {
  afterEach(cleanup);
  it('renders the default sections in canonical order and supports preview', () => {
    render(<EcommerceSiteRenderer siteDocument={createDefaultEcommerceSiteDocument()} siteDocumentMode="custom" portal={portal} hours={{ weekly: [], exceptions: [] }} availability={{ legacy: true }} slug="tienda" mode="preview" catalogProps={catalogProps} />);
    const sections = document.querySelectorAll('[data-site-section]');
    expect([...sections].map((node) => node.dataset.siteSection)).toEqual(['header', 'catalog', 'footer']);
    expect(document.querySelector('[data-site-mode="preview"]')).toBeTruthy();
  });
  it('uses the portal preset for default documents and applies catalog props', () => {
    const compact = { ...portal, templateCode: 'compact' };
    render(<EcommerceSiteRenderer siteDocument={createDefaultEcommerceSiteDocument()} portal={compact} hours={{ weekly: [], exceptions: [] }} availability={{ legacy: true }} slug="tienda" catalogProps={catalogProps} />);
    expect(document.querySelector('[data-site-density="compact"]')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeTruthy();
  });
  it('does not expose catalog controls when their allowlisted props disable them', () => {
    const siteDocument = createDefaultEcommerceSiteDocument();
    siteDocument.sections[1].props = { showSearch: false, showCategories: false };
    render(<EcommerceSiteRenderer siteDocument={siteDocument} siteDocumentMode="custom" portal={portal} hours={{ weekly: [], exceptions: [] }} availability={{ legacy: true }} slug="tienda" catalogProps={catalogProps} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
