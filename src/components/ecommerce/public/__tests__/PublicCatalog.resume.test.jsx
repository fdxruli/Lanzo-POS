// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicCatalog from '../PublicCatalog';

vi.mock('../PublicProductConfigurationModal', () => ({
  default: ({ initialLine }) => (
    <div role="dialog" aria-label="Configurador">
      {initialLine ? 'Editando línea' : 'Configurando producto'}
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

const renderCatalog = () => render(
  <MemoryRouter initialEntries={['/tienda/demo']}>
    <Routes>
      <Route path="/tienda/:slug" element={(
        <PublicCatalog
          products={[product]}
          filteredProducts={[product]}
          categories={[]}
          searchTerm=""
          selectedCategory="all"
          onSearchChange={vi.fn()}
          onCategoryChange={vi.fn()}
          onAdd={vi.fn()}
          isLoading={false}
          error={null}
          onRetry={vi.fn()}
          hasMore={false}
          onLoadMore={vi.fn()}
          isLoadingMore={false}
          catalogRevision={1}
        />
      )} />
    </Routes>
  </MemoryRouter>
);

describe('PublicCatalog resume overlays', () => {
  afterEach(cleanup);

  it('clears configurationProduct and initialLine on critical recovery', async () => {
    const view = renderCatalog();
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar opciones Playera' }));
    expect(await screen.findByRole('dialog', { name: 'Configurador' })).toBeInTheDocument();

    fireEvent(window, new Event('lanzo:public-store-close-transient-overlays'));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Configurador' })).not.toBeInTheDocument();
    });
    expect(view.container.querySelector('.public-product-configuration__backdrop')).toBeNull();
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
