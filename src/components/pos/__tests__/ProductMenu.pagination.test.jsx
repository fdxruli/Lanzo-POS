// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  observerCallback: null,
  disconnect: vi.fn(),
  observe: vi.fn(),
  loadNextPage: vi.fn(),
  loadBatchesForProduct: vi.fn(async () => [])
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: (selector) => selector({ addSmartItem: vi.fn() })
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({ licenseDetails: null })
}));
vi.mock('../../../services/utils', () => ({ showMessageModal: vi.fn() }));
vi.mock('../../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasVariants: false, hasModifiers: false, hasWholesale: false })
}));
vi.mock('../../../hooks/useInventoryMovement', () => ({
  useInventoryMovement: () => ({ loadBatchesForProduct: mocks.loadBatchesForProduct })
}));
vi.mock('../ProductCard', () => ({
  default: ({ product }) => <div data-testid="product-card">{product.name}</div>
}));
vi.mock('../ProductModifiersModal', () => ({ default: () => null }));
vi.mock('../VariantSelectorModal', () => ({ default: () => null }));

import ProductMenu from '../ProductMenu';

const products = Array.from({ length: 60 }, (_, index) => ({
  id: `product-${index}`,
  name: `Product ${index}`,
  stock: 10
}));

const defaultProps = {
  products,
  categories: [],
  selectedCategoryId: null,
  onSelectCategory: vi.fn(),
  searchTerm: '',
  onSearchChange: vi.fn(),
  onOpenScanner: vi.fn(),
  showOutofStockCategory: false,
  showExpiredCategory: false,
  hasMore: true,
  isLoadingInitial: false,
  isLoadingNextPage: false,
  onLoadNextPage: mocks.loadNextPage
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.observerCallback = null;
  globalThis.IntersectionObserver = vi.fn(function IntersectionObserver(callback) {
    mocks.observerCallback = callback;
    this.observe = mocks.observe;
    this.disconnect = mocks.disconnect;
  });
});

afterEach(() => {
  cleanup();
  delete globalThis.IntersectionObserver;
});

describe('ProductMenu real pagination', () => {
  it('renders every accumulated page instead of slicing back to 50', () => {
    render(<ProductMenu {...defaultProps} />);
    expect(screen.getAllByTestId('product-card')).toHaveLength(60);
    expect(screen.getByText('Product 0')).toBeInTheDocument();
    expect(screen.getByText('Product 59')).toBeInTheDocument();
  });

  it('loads the next IndexedDB page when the sentinel approaches the viewport', () => {
    render(<ProductMenu {...defaultProps} />);
    expect(mocks.observe).toHaveBeenCalledTimes(1);

    mocks.observerCallback([{ isIntersecting: true }]);
    expect(mocks.loadNextPage).toHaveBeenCalledTimes(1);
  });

  it('keeps an accessible manual fallback and preserves cards while loading', () => {
    render(<ProductMenu {...defaultProps} isLoadingNextPage />);
    expect(screen.getAllByTestId('product-card')).toHaveLength(60);
    expect(screen.getByText('Cargando más productos...')).toBeInTheDocument();

    cleanup();
    render(<ProductMenu {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más productos' }));
    expect(mocks.loadNextPage).toHaveBeenCalledTimes(1);
  });

  it('does not page the visual catalog while textual search is active', () => {
    render(<ProductMenu {...defaultProps} searchTerm="sku-remote" />);
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Cargar más productos' })).not.toBeInTheDocument();
  });
});
