// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

vi.mock('../PublicProductDetailModal', () => ({
  default: ({ product, onAdd, onClose }) => (
    <div role="dialog" aria-label={`Detalle de ${product.name}`}>
      {product.description ? <p>{product.description}</p> : null}
      <button type="button" onClick={() => onAdd(product, { quantity: 2 })}>Agregar dos</button>
      <button type="button" onClick={onClose}>Cerrar</button>
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

const catalogElement = ({ products = [product], onAdd = vi.fn(), storeId = 'store-1', interactive = true } = {}) => (
  <PublicCatalog
    slug="demo"
    storeId={storeId}
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
    interactive={interactive}
  />
);
const renderCatalog = (props = {}) => render(catalogElement(props));

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
    expect(screen.queryByRole('dialog', { name: 'Detalle de Café' })).not.toBeInTheDocument();
  });

  it('opens a simple product detail from its name and allows out-of-stock products to be consulted', async () => {
    const unavailableProduct = {
      id: 'simple', name: 'Taza', description: 'Descripción completa', price: 80, isAvailable: true,
      stock: { mode: 'exact', status: 'out_of_stock', quantity: 0 }
    };
    const onAdd = vi.fn();
    renderCatalog({ products: [unavailableProduct], onAdd });

    fireEvent.click(screen.getByRole('button', { name: 'Taza' }));
    const detail = await screen.findByRole('dialog', { name: 'Detalle de Taza' });
    expect(detail).toBeInTheDocument();
    expect(within(detail).getByText('Descripción completa')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Taza no disponible' })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('opens configurable products through the existing configurator from the photograph', async () => {
    renderCatalog();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle de Playera' }));

    expect(await screen.findByRole('dialog', { name: 'Configurador' })).toHaveTextContent('Configurando producto');
    expect(screen.queryByRole('dialog', { name: 'Detalle de Playera' })).not.toBeInTheDocument();
  });

  it('keeps simulated catalog actions inert when used in a preview', () => {
    const simpleProduct = { id: 'simple', name: 'Café', price: 50, isAvailable: true };
    const onAdd = vi.fn();
    renderCatalog({ products: [simpleProduct], onAdd, interactive: false });

    fireEvent.click(screen.getByRole('button', { name: 'Café' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Café' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('closes an open detail when the catalog changes to another store or recovers', async () => {
    const simpleProduct = { id: 'simple', name: 'Café', price: 50, description: 'Una tienda' };
    const view = renderCatalog({ products: [simpleProduct] });
    fireEvent.click(screen.getByRole('button', { name: 'Café' }));
    expect(await screen.findByRole('dialog', { name: 'Detalle de Café' })).toBeInTheDocument();

    view.rerender(catalogElement({
      products: [{ ...simpleProduct, name: 'Té', description: 'Otra tienda' }],
      storeId: 'store-2'
    }));
    expect(screen.queryByRole('dialog', { name: 'Detalle de Café' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Té' }));
    expect(await screen.findByRole('dialog', { name: 'Detalle de Té' })).toBeInTheDocument();
    fireEvent(window, new Event('lanzo:public-store-close-transient-overlays'));
    expect(screen.queryByRole('dialog', { name: 'Detalle de Té' })).not.toBeInTheDocument();
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
