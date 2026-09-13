// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EcommerceProductPublishModal from '../EcommerceProductPublishModal';
import { useAppStore } from '../../../store/useAppStore';

const productOne = {
  id: 'product-1',
  name: 'Producto Uno',
  description: 'Descripción uno',
  price: 25,
  categoryId: 'category-1',
  trackStock: true,
  imageUrl: 'https://example.com/product-1.jpg'
};

const productTwo = {
  id: 'product-2',
  name: 'Producto Dos',
  description: 'Descripción dos',
  price: 40,
  categoryId: 'category-2',
  trackStock: false,
  imageUrl: 'https://example.com/product-2.jpg'
};

const categories = new Map([
  ['category-1', 'General'],
  ['category-2', 'Especial']
]);

const baseProps = ({
  open = true,
  editingProduct = null,
  localProducts = [productOne, productTwo],
  localCatalogLoading = false,
  localCatalogHasMore = false,
  onSearchLocalProducts = vi.fn().mockResolvedValue(true),
  onLoadMoreLocalProducts = vi.fn().mockResolvedValue(true),
  onClose = vi.fn(),
  onSave = vi.fn().mockResolvedValue(true)
} = {}) => ({
  open,
  editingProduct,
  localProducts,
  categoriesById: categories,
  linkedRefs: new Set(),
  isPro: false,
  limitReached: false,
  localCatalogLoading,
  localCatalogHasMore,
  onSearchLocalProducts,
  onLoadMoreLocalProducts,
  onClose,
  onSave
});

const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
const getProductSelect = () => screen.getAllByRole('combobox')[0];

const selectProductOne = () => {
  fireEvent.change(getProductSelect(), {
    target: { value: productOne.id }
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ companyProfile: { business_type: 'abarrotes' } });
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ companyProfile: null });
});

describe('EcommerceProductPublishModal catalog lifecycle', () => {
  it('does not issue the redundant initial search or repeat it on parent rerenders', async () => {
    const onSearchLocalProducts = vi.fn().mockResolvedValue(true);
    const initialProps = baseProps({ onSearchLocalProducts });
    const { rerender } = render(<EcommerceProductPublishModal {...initialProps} />);

    for (let index = 0; index < 10; index += 1) {
      rerender(<EcommerceProductPublishModal {...initialProps} localCatalogLoading={index % 2 === 0} />);
    }

    await act(async () => delay(300));
    expect(onSearchLocalProducts).not.toHaveBeenCalled();
  });

  it('debounces user search and only dispatches the final stable term', async () => {
    const onSearchLocalProducts = vi.fn().mockResolvedValue(true);
    render(<EcommerceProductPublishModal {...baseProps({ onSearchLocalProducts })} />);
    const search = screen.getByPlaceholderText('Buscar por nombre, código o SKU');

    fireEvent.change(search, { target: { value: 'c' } });
    fireEvent.change(search, { target: { value: 'co' } });
    fireEvent.change(search, { target: { value: 'coc' } });
    fireEvent.change(search, { target: { value: 'coca' } });

    expect(onSearchLocalProducts).not.toHaveBeenCalled();
    await act(async () => delay(275));
    expect(onSearchLocalProducts).toHaveBeenCalledTimes(1);
    expect(onSearchLocalProducts).toHaveBeenCalledWith('coca');
  });

  it('preserves selection and form fields when search results replace localProducts', () => {
    const props = baseProps();
    const { rerender } = render(<EcommerceProductPublishModal {...props} />);
    selectProductOne();

    expect(getProductSelect().value).toBe(productOne.id);
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productOne.price))).toBeInTheDocument();

    rerender(
      <EcommerceProductPublishModal
        {...props}
        localProducts={[productTwo]}
        localCatalogLoading
      />
    );

    expect(getProductSelect().value).toBe(productOne.id);
    expect(screen.getByRole('option', { name: /Producto Uno/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productOne.price))).toBeInTheDocument();
    expect(screen.getByText('Cargando productos…')).toBeInTheDocument();
  });

  it('keeps manual edit changes when the local source refreshes', () => {
    const editingProduct = {
      id: 'published-1',
      localProductRef: productOne.id,
      publicName: 'Nombre publicado',
      publicDescription: 'Descripción publicada',
      price: 30,
      categoryName: 'General',
      manualAvailable: true,
      isPublished: true,
      stockMode: 'hidden'
    };
    const props = baseProps({ editingProduct, localProducts: [productOne] });
    const { rerender } = render(<EcommerceProductPublishModal {...props} />);

    fireEvent.change(screen.getByDisplayValue('Nombre publicado'), {
      target: { value: 'Nombre manual' }
    });
    fireEvent.change(screen.getByDisplayValue('30'), {
      target: { value: '33.50' }
    });
    fireEvent.change(screen.getByDisplayValue('Descripción publicada'), {
      target: { value: 'Descripción manual' }
    });

    rerender(
      <EcommerceProductPublishModal
        {...props}
        localProducts={[{
          ...productOne,
          name: 'Nombre fuente actualizado',
          description: 'Descripción fuente actualizada',
          price: 99
        }]}
      />
    );

    expect(screen.getByDisplayValue('Nombre manual')).toBeInTheDocument();
    expect(screen.getByDisplayValue('33.50')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Descripción manual')).toBeInTheDocument();
  });

  it('preserves selection while loading more products', () => {
    const onLoadMoreLocalProducts = vi.fn().mockResolvedValue(true);
    const props = baseProps({
      localProducts: [productOne],
      localCatalogHasMore: true,
      onLoadMoreLocalProducts
    });
    const { rerender } = render(<EcommerceProductPublishModal {...props} />);
    selectProductOne();

    fireEvent.click(screen.getByRole('button', { name: 'Cargar más productos' }));
    expect(onLoadMoreLocalProducts).toHaveBeenCalledTimes(1);
    expect(onLoadMoreLocalProducts).toHaveBeenCalledWith('');

    rerender(
      <EcommerceProductPublishModal
        {...props}
        localProducts={[productOne, productTwo]}
        localCatalogHasMore={false}
      />
    );

    expect(getProductSelect().value).toBe(productOne.id);
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
  });

  it('saves exactly once using the selected snapshot even if the result list no longer contains it', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const props = baseProps({ onSave });
    const { rerender } = render(<EcommerceProductPublishModal {...props} />);
    selectProductOne();

    rerender(<EcommerceProductPublishModal {...props} localProducts={[productTwo]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));
    await act(async () => Promise.resolve());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      localProductRef: productOne.id,
      localProduct: productOne,
      publicName: productOne.name,
      price: productOne.price,
      categoryName: 'General',
      imageUrl: productOne.imageUrl
    }));
  });

  it('cancels a pending debounce when the modal closes', async () => {
    const onSearchLocalProducts = vi.fn().mockResolvedValue(true);
    const props = baseProps({ onSearchLocalProducts });
    const { rerender } = render(<EcommerceProductPublishModal {...props} />);

    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'pendiente' }
    });
    rerender(<EcommerceProductPublishModal {...props} open={false} />);
    await act(async () => delay(300));

    expect(onSearchLocalProducts).not.toHaveBeenCalled();
  });

  it('reopens a new publication with clean search, selection and form state', () => {
    const props = baseProps();
    const { rerender } = render(<EcommerceProductPublishModal {...props} />);
    selectProductOne();
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'producto' }
    });

    rerender(<EcommerceProductPublishModal {...props} open={false} />);
    rerender(<EcommerceProductPublishModal {...props} open />);

    expect(screen.getByPlaceholderText('Buscar por nombre, código o SKU').value).toBe('');
    expect(getProductSelect().value).toBe('');
    expect(screen.getByLabelText('Nombre público *').value).toBe('');
    expect(screen.getByLabelText('Precio público *').value).toBe('');
  });

  it('renders search matches as visible selectable results with price metadata', () => {
    const props = baseProps({ localProducts: [productTwo] });
    render(<EcommerceProductPublishModal {...props} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'dos' }
    });

    const result = screen.getByRole('button', { name: 'Seleccionar Producto Dos' });
    expect(result).toBeInTheDocument();
    expect(result).toHaveTextContent('Producto Dos');
    expect(result).toHaveTextContent('$40.00');
    expect(result).toHaveTextContent('Especial');
  });

  it('selects a visible result through the same product-selection source of truth', () => {
    render(<EcommerceProductPublishModal {...baseProps({ localProducts: [productTwo] })} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'dos' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar Producto Dos' }));

    expect(getProductSelect().value).toBe(productTwo.id);
    expect(screen.getByDisplayValue(productTwo.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productTwo.price))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seleccionar Producto Dos' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a dedicated no-results message for an active search', () => {
    render(<EcommerceProductPublishModal {...baseProps({ localProducts: [] })} />);
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'producto-que-no-existe' }
    });

    expect(screen.getByText('No encontramos productos con esa búsqueda.')).toBeInTheDocument();
  });

  it('does not expose the selected snapshot as a search result when it does not match the current result set', () => {
    const props = baseProps({ localProducts: [productOne] });
    const { rerender } = render(<EcommerceProductPublishModal {...props} />);
    selectProductOne();
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'sabritas' }
    });
    rerender(<EcommerceProductPublishModal {...props} localProducts={[]} />);

    expect(getProductSelect().value).toBe(productOne.id);
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Seleccionar Producto Uno' })).toBeNull();
    expect(screen.getByText('No encontramos productos con esa búsqueda.')).toBeInTheDocument();
  });

  it('keeps linked products visible but disabled in search results', () => {
    render(
      <EcommerceProductPublishModal
        {...baseProps({ localProducts: [productTwo] })}
        linkedRefs={new Set([productTwo.id])}
      />
    );
    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'dos' }
    });

    const result = screen.getByRole('button', { name: 'Seleccionar Producto Dos' });
    expect(result).toBeDisabled();
    expect(result).toHaveTextContent('Ya agregado');
  });

  it('restores the catalog only when the user explicitly clears an active search', async () => {
    const onSearchLocalProducts = vi.fn().mockResolvedValue(true);
    render(<EcommerceProductPublishModal {...baseProps({ onSearchLocalProducts })} />);
    const search = screen.getByPlaceholderText('Buscar por nombre, código o SKU');

    fireEvent.change(search, { target: { value: 'coca' } });
    await act(async () => delay(275));
    expect(onSearchLocalProducts).toHaveBeenLastCalledWith('coca');

    fireEvent.change(search, { target: { value: '' } });
    await act(async () => delay(275));
    expect(onSearchLocalProducts).toHaveBeenCalledTimes(2);
    expect(onSearchLocalProducts).toHaveBeenLastCalledWith('');
  });

});
