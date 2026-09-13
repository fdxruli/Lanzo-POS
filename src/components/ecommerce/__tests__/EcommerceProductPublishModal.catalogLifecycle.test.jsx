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

const selectProductOne = () => {
  fireEvent.change(screen.getByLabelText(/Producto del catálogo local/), {
    target: { value: productOne.id }
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  useAppStore.setState({ companyProfile: { business_type: 'abarrotes' } });
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  useAppStore.setState({ companyProfile: null });
});

describe('EcommerceProductPublishModal catalog lifecycle', () => {
  it('does not issue the redundant initial search or repeat it on parent rerenders', () => {
    const onSearchLocalProducts = vi.fn().mockResolvedValue(true);
    const initialProps = baseProps({ onSearchLocalProducts });
    const { rerender } = render(<EcommerceProductPublishModal {...initialProps} />);

    for (let index = 0; index < 10; index += 1) {
      rerender(<EcommerceProductPublishModal {...initialProps} localCatalogLoading={index % 2 === 0} />);
    }

    act(() => vi.advanceTimersByTime(1000));
    expect(onSearchLocalProducts).not.toHaveBeenCalled();
  });

  it('debounces user search and only dispatches the final stable term', () => {
    const onSearchLocalProducts = vi.fn().mockResolvedValue(true);
    render(<EcommerceProductPublishModal {...baseProps({ onSearchLocalProducts })} />);
    const search = screen.getByPlaceholderText('Buscar por nombre, código o SKU');

    fireEvent.change(search, { target: { value: 'c' } });
    fireEvent.change(search, { target: { value: 'co' } });
    fireEvent.change(search, { target: { value: 'coc' } });
    fireEvent.change(search, { target: { value: 'coca' } });

    act(() => vi.advanceTimersByTime(249));
    expect(onSearchLocalProducts).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onSearchLocalProducts).toHaveBeenCalledTimes(1);
    expect(onSearchLocalProducts).toHaveBeenCalledWith('coca');
  });

  it('preserves selection and form fields when search results replace localProducts', () => {
    const props = baseProps();
    const { rerender } = render(<EcommerceProductPublishModal {...props} />);
    selectProductOne();

    expect(screen.getByLabelText(/Producto del catálogo local/).value).toBe(productOne.id);
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productOne.price))).toBeInTheDocument();

    rerender(
      <EcommerceProductPublishModal
        {...props}
        localProducts={[productTwo]}
        localCatalogLoading
      />
    );

    expect(screen.getByLabelText(/Producto del catálogo local/).value).toBe(productOne.id);
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

    expect(screen.getByLabelText(/Producto del catálogo local/).value).toBe(productOne.id);
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

  it('cancels a pending debounce when the modal closes', () => {
    const onSearchLocalProducts = vi.fn().mockResolvedValue(true);
    const props = baseProps({ onSearchLocalProducts });
    const { rerender } = render(<EcommerceProductPublishModal {...props} />);

    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'pendiente' }
    });
    rerender(<EcommerceProductPublishModal {...props} open={false} />);
    act(() => vi.advanceTimersByTime(500));

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
    expect(screen.getByLabelText(/Producto del catálogo local/).value).toBe('');
    expect(screen.getByLabelText('Nombre público *').value).toBe('');
    expect(screen.getByLabelText('Precio público *').value).toBe('');
  });
});
