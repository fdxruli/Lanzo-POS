// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  observerCallback: null,
  observerOptions: null,
  disconnect: vi.fn(),
  observe: vi.fn(),
  loadNextPage: vi.fn(async () => true),
  loadBatchesForProduct: vi.fn(async () => []),
  addSmartItem: vi.fn(),
  saveScrollPosition: vi.fn()
}));

vi.mock('../../../hooks/pos/useActiveOrders', () => ({
  useActiveOrders: (selector) => selector({ addSmartItem: mocks.addSmartItem })
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
  default: ({ product, onCardClick }) => (
    <button type="button" data-testid="product-card" onClick={() => onCardClick(product)}>
      {product.name}
    </button>
  )
}));
vi.mock('../ProductModifiersModal', () => ({ default: () => null }));
vi.mock('../VariantSelectorModal', () => ({ default: () => null }));

import ProductMenu from '../ProductMenu';

const products = Array.from({ length: 5 }, (_, index) => ({
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
  onLoadNextPage: mocks.loadNextPage,
  activeViewKey: 'normal:all',
  savedScrollPosition: 0,
  onScrollPositionChange: mocks.saveScrollPosition
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadNextPage.mockImplementation(async () => true);
  mocks.observerCallback = null;
  globalThis.IntersectionObserver = vi.fn(function IntersectionObserver(callback) {
    mocks.observerCallback = callback;
    mocks.observerOptions = arguments[1];
    this.observe = mocks.observe;
    this.disconnect = mocks.disconnect;
  });
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    callback();
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  cleanup();
  delete globalThis.IntersectionObserver;
  vi.unstubAllGlobals();
});

describe('ProductMenu stable real pagination', () => {
  const getScrollContainer = (container) => container.querySelector('.pos-menu-scroll');

  const moveScroll = (scrollContainer, scrollTop) => {
    scrollContainer.scrollTop = scrollTop;
    fireEvent.scroll(scrollContainer);
  };

  const emitIntersection = async (isIntersecting) => {
    await act(async () => mocks.observerCallback([{ isIntersecting }]));
  };

  it('renders every accumulated page instead of slicing back to the page size', () => {
    const accumulated = Array.from({ length: 15 }, (_, index) => ({
      id: `accumulated-${index}`, name: `Accumulated ${index}`, stock: 10
    }));
    render(<ProductMenu {...defaultProps} products={accumulated} />);
    expect(screen.getAllByTestId('product-card')).toHaveLength(15);
  });

  it('does not preload on mount even when the sentinel is initially visible', async () => {
    const { rerender } = render(<ProductMenu {...defaultProps} />);

    await emitIntersection(true);
    await emitIntersection(true);
    rerender(<ProductMenu {...defaultProps} products={[...products]} />);
    await emitIntersection(true);

    expect(screen.getAllByTestId('product-card')).toHaveLength(5);
    expect(mocks.loadNextPage).not.toHaveBeenCalled();
  });

  it('accepts downward intent after an initially visible sentinel without chaining on completion', async () => {
    const { container, rerender } = render(<ProductMenu {...defaultProps} />);
    const scroll = getScrollContainer(container);

    await emitIntersection(true);
    moveScroll(scroll, 20);
    expect(mocks.loadNextPage).toHaveBeenCalledTimes(1);

    const tenProducts = Array.from({ length: 10 }, (_, index) => ({
      id: `loaded-${index}`, name: `Loaded ${index}`, stock: 10
    }));
    rerender(<ProductMenu {...defaultProps} products={tenProducts} isLoadingNextPage />);
    rerender(<ProductMenu {...defaultProps} products={tenProducts} isLoadingNextPage={false} />);
    moveScroll(scroll, 40);
    await emitIntersection(true);

    expect(screen.getAllByTestId('product-card')).toHaveLength(10);
    expect(mocks.loadNextPage).toHaveBeenCalledTimes(1);
  });

  it('loads once after downward scroll, ignores repeated callbacks and rearms after exit', async () => {
    const { container } = render(<ProductMenu {...defaultProps} />);
    const scroll = getScrollContainer(container);

    await emitIntersection(false);
    moveScroll(scroll, 20);
    await emitIntersection(true);
    await emitIntersection(true);
    expect(mocks.loadNextPage).toHaveBeenCalledTimes(1);

    await emitIntersection(false);
    moveScroll(scroll, 40);
    await emitIntersection(true);
    expect(mocks.loadNextPage).toHaveBeenCalledTimes(2);
  });

  it('does not load after unrelated renders, layout changes or cart mutations', async () => {
    const { container, rerender } = render(<ProductMenu {...defaultProps} />);
    const scroll = getScrollContainer(container);
    await emitIntersection(true);

    rerender(<ProductMenu {...defaultProps} products={[...products]} />);
    fireEvent.click(screen.getAllByTestId('product-card')[0]);
    await emitIntersection(true);
    fireEvent(window, new Event('resize'));
    await emitIntersection(true);

    expect(mocks.addSmartItem).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('product-card')).toHaveLength(5);
    expect(scroll.scrollTop).toBe(0);
    expect(mocks.loadNextPage).not.toHaveBeenCalled();
  });

  it('ignores upward scroll and layout-sized scroll noise', async () => {
    const { container } = render(<ProductMenu {...defaultProps} />);
    const scroll = getScrollContainer(container);

    await emitIntersection(false);
    moveScroll(scroll, 1);
    await emitIntersection(true);
    expect(mocks.loadNextPage).not.toHaveBeenCalled();

    await emitIntersection(false);
    moveScroll(scroll, 20);
    moveScroll(scroll, 10);
    await emitIntersection(true);
    expect(mocks.loadNextPage).not.toHaveBeenCalled();
  });

  it('loads exactly once per manual click and requires exit, downward scroll and re-entry', async () => {
    const { container } = render(<ProductMenu {...defaultProps} />);
    const scroll = getScrollContainer(container);
    await emitIntersection(true);

    await act(async () => fireEvent.click(
      screen.getByRole('button', { name: 'Cargar más productos' })
    ));
    await emitIntersection(true);
    expect(mocks.loadNextPage).toHaveBeenCalledTimes(1);

    await emitIntersection(false);
    await emitIntersection(true);
    moveScroll(scroll, 20);
    expect(mocks.loadNextPage).toHaveBeenCalledTimes(1);

    await emitIntersection(false);
    moveScroll(scroll, 40);
    await emitIntersection(true);
    expect(mocks.loadNextPage).toHaveBeenCalledTimes(2);
  });

  it('rearms after a manual load that began while the sentinel was already outside', async () => {
    const { container } = render(<ProductMenu {...defaultProps} />);
    const scroll = getScrollContainer(container);
    await emitIntersection(false);

    await act(async () => fireEvent.click(
      screen.getByRole('button', { name: 'Cargar más productos' })
    ));
    moveScroll(scroll, 20);
    await emitIntersection(true);

    expect(mocks.loadNextPage).toHaveBeenCalledTimes(2);
  });

  it('uses the internal overflow container as the observer root', () => {
    const { container } = render(<ProductMenu {...defaultProps} />);
    expect(mocks.observerOptions.root).toBe(getScrollContainer(container));
    expect(mocks.observerOptions.rootMargin).toBe('300px 0px');
    expect(mocks.observerOptions.threshold).toBe(0.01);
  });

  it('coalesces a rapid double click before the first page resolves', async () => {
    let resolvePage;
    mocks.loadNextPage.mockReturnValueOnce(new Promise((resolve) => { resolvePage = resolve; }));
    render(<ProductMenu {...defaultProps} />);
    const button = screen.getByRole('button', { name: 'Cargar más productos' });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.loadNextPage).toHaveBeenCalledTimes(1);
    await act(async () => resolvePage(true));
  });

  it('disables the button during loading and removes it at the end', () => {
    const { rerender } = render(<ProductMenu {...defaultProps} isLoadingNextPage />);
    expect(screen.getByRole('button', { name: 'Cargar más productos' })).toBeDisabled();
    expect(screen.getByText('Cargando más productos...')).toBeInTheDocument();

    rerender(<ProductMenu {...defaultProps} hasMore={false} isLoadingNextPage={false} />);
    expect(screen.queryByRole('button', { name: 'Cargar más productos' })).not.toBeInTheDocument();
  });

  it('stores and restores scroll per view without a cart render changing it', () => {
    const { container, rerender } = render(
      <ProductMenu {...defaultProps} savedScrollPosition={120} />
    );
    const scroll = container.querySelector('.pos-menu-scroll');
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, value: 1000 });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 300 });

    rerender(<ProductMenu {...defaultProps} activeViewKey="normal:category:a" savedScrollPosition={400} />);
    expect(scroll.scrollTop).toBe(400);
    scroll.scrollTop = 455;
    fireEvent.scroll(scroll);
    expect(mocks.saveScrollPosition).toHaveBeenLastCalledWith(455);

    fireEvent.click(screen.getAllByTestId('product-card')[0]);
    expect(scroll.scrollTop).toBe(455);
  });

  it('disconnects the observer on unmount and does not page during search', () => {
    const { unmount } = render(<ProductMenu {...defaultProps} />);
    unmount();
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);

    render(<ProductMenu {...defaultProps} searchTerm="sku-remote" />);
    expect(screen.queryByRole('button', { name: 'Cargar más productos' })).not.toBeInTheDocument();
  });
});
