// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEcommerceSiteDocument } from '../../../../utils/ecommerceSiteDocument';
import { setCatalogVisibility, setSectionLayout } from '../../../../utils/ecommerceSiteBuilderDocument';
import EcommerceSiteBuilderPreview from '../EcommerceSiteBuilderPreview';

const portal = {
  name: 'Tienda preview', slug: 'preview', templateCode: 'classic', headline: 'Vista de prueba',
  description: 'Portal de prueba', pickupEnabled: true, deliveryEnabled: false,
  theme: { primaryColor: '#14532d', secondaryColor: '#166534', cornerStyle: 'square', fontStyle: 'editorial' }
};
const products = [{
  id: 'published-1', publicName: 'Café publicado', publicDescription: 'Producto real adaptado', categoryName: 'Bebidas',
  price: 45, currency: 'MXN', imageUrl: '', isPublished: true, isAvailable: true,
  metadata: { private: 'not rendered' }
}];

const renderPreview = (props = {}) => render(
  <MemoryRouter>
    <EcommerceSiteBuilderPreview document={createDefaultEcommerceSiteDocument()} viewport="desktop" onViewport={vi.fn()} portal={portal} previewProducts={products} {...props} />
  </MemoryRouter>
);

describe('EcommerceSiteBuilderPreview', () => {
  afterEach(cleanup);

  it('renders adapted product cards, search, categories, grid layout, and remains inert', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    const { container } = renderPreview();
    expect(screen.getByText('Café publicado')).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Buscar productos' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Filtrar por categoría' })).toBeTruthy();
    expect(container.querySelector('[data-site-section="catalog"][data-site-layout="grid"]')).toBeTruthy();
    expect(container.querySelector('.ecom-builder-preview-inert')).toHaveClass('ecommerce-site-surface');
    expect(container.querySelector('.public-store-shell')).toBeNull();
    const surface = container.querySelector('.ecommerce-site-surface');
    expect(surface.style.getPropertyValue('--store-primary')).toBe('#14532d');
    expect(surface.style.getPropertyValue('--store-secondary')).toBe('#166534');
    expect(surface.style.getPropertyValue('--store-radius-card')).toBe('0');
    expect(surface.style.getPropertyValue('--store-radius-button')).toBe('0');
    expect(surface.style.getPropertyValue('--store-font-family')).toBe(
      'Georgia, Cambria, "Times New Roman", serif'
    );
    expect(container.querySelector('.ecom-builder-preview-inert')).toHaveAttribute('inert');
    expect(container.querySelector('.ecommerce-site-renderer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Café publicado' }));
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('visually removes search and categories and exposes compact layout', () => {
    let document = createDefaultEcommerceSiteDocument();
    document = setCatalogVisibility(document, 'showSearch', false);
    document = setCatalogVisibility(document, 'showCategories', false);
    document = setSectionLayout(document, 'catalog', 'compact');
    const { container } = renderPreview({ document });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(container.querySelector('[data-site-section="catalog"][data-site-layout="compact"]')).toBeTruthy();
  });

  it('renders local examples when no real published products are available', () => {
    const { container } = renderPreview({ previewProducts: [] });
    expect(screen.getByText('Producto de ejemplo')).toBeTruthy();
    expect(screen.getByText('Otro producto de ejemplo')).toBeTruthy();
    expect(container.querySelector('[data-preview-source="examples"]')).toBeTruthy();
  });

  it('changes only the viewport presentation', () => {
    const onViewport = vi.fn();
    const document = createDefaultEcommerceSiteDocument();
    renderPreview({ document, onViewport });
    fireEvent.click(screen.getByRole('button', { name: 'Móvil' }));
    expect(onViewport).toHaveBeenCalledWith('mobile');
    expect(document).toEqual(createDefaultEcommerceSiteDocument());
  });
});
