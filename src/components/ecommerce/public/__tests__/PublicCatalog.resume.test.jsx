// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicCatalog from '../PublicCatalog';

vi.mock('../PublicProductConfigurationModal', () => ({
  default: ({ initialLine, slug }) => (
    <div role="dialog" aria-label="Configurador" data-slug={slug}>
      {initialLine ? `Editando línea ${initialLine.lineKey}` : 'Configurando producto'}
    </div>
  )
}));

const product = {
  id: 'configurable',
  name: 'Playera',
  price: 100,
  currency: 'MXN',
  isAvailable: true,
  configuration: { requiresConfiguration: true, version: 1 },
  stock: { mode: 'hidden', status: null, quantity: null }
};

const renderCatalog = ({ products = [product], onAdd = vi.fn() } = {}) => render(
  <PublicCatalog
    slug="demo"
    products={products}
    filteredProducts={products}
    categories={[]}
    searchTerm=""
    selectedCategory="all"
    onSearchChange={vi.fn()}
    onCategoryChange={vi.fn()}
    onAdd={onAdd}
    isLoading={false}
    error={null}
    onRetry={vi.fn()}
    hasMore={false}
    onLoadMore={vi.fn()}
    isLoadingMore={false}
    catalogRevision={1}
  />
);

describe('PublicCatalog resume overlays', () => {
  afterEach(cleanup);

  it('clears configurationProduct and initialLine on critical recovery', async () => {
    const view = renderCatalog();
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar opciones Playera' }));
    expect(await screen.findByRole('dialog', { name: 'Configurador' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Configurador' })).toHaveAttribute('data-slug', 'demo');

    fireEvent(window, new Event('lanzo:public-store-close-transient-overlays'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Configurador' })).not.toBeInTheDocument();
    });
    expect(view.container.querySelector('.public-product-configuration__backdrop')).toBeNull();
  });

  it('adds a simple product through the catalog action', () => {
    const simpleProduct = { id: 'simple', name: 'Café', price: 50, isAvailable: true };
    const onAdd = vi.fn();
    renderCatalog({ products: [simpleProduct], onAdd });

    fireEvent.click(screen.getByRole('button', { name: 'Agregar Café' }));
    expect(onAdd).toHaveBeenCalledWith(simpleProduct);
  });

  it('does not allow an out-of-stock product to be added', () => {
    const unavailableProduct = {
      id: 'unavailable', name: 'Taza', price: 80, isAvailable: true,
      stock: { mode: 'exact', status: 'out_of_stock', quantity: 0 }
    };
    const onAdd = vi.fn();
    renderCatalog({ products: [unavailableProduct], onAdd });

    expect(screen.getByText('Agotado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Taza no disponible' })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('opens the configurator for editing a configured cart line', async () => {
    renderCatalog();
    const line = {
      lineKey: 'configured-line-1',
      productId: 'configurable',
      quantity: 2,
      variantId: 'variant-1',
      selections: [{ groupId: 'group-1', optionIds: ['option-1'] }]
    };

    fireEvent(window, new CustomEvent('lanzo:ecommerce:edit-configured-line', { detail: line }));

    expect(await screen.findByRole('dialog', { name: 'Configurador' })).toHaveTextContent(
      'Editando línea configured-line-1'
    );
  });

  it('removes the recovery listener when the catalog unmounts', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = renderCatalog();
    view.unmount();

    expect(remove).toHaveBeenCalledWith(
      'lanzo:public-store-close-transient-overlays',
      expect.any(Function)
    );
    remove.mockRestore();
  });
});
