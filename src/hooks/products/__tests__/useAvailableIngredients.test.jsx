// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  subscribe: vi.fn()
}));

vi.mock('../../../services/products/productCatalogQueryService', () => ({
  queryActiveIngredientsForConfiguration: mocks.query
}));
vi.mock('../../../services/products/productCatalogEvents', () => ({
  subscribeProductCatalogEvents: mocks.subscribe
}));

import { useAvailableIngredients } from '../useAvailableIngredients';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscribe.mockReturnValue(() => {});
});

describe('useAvailableIngredients', () => {
  it('loads independently and refreshes when the product catalog emits an event', async () => {
    let subscriber;
    mocks.subscribe.mockImplementation((callback) => {
      subscriber = callback;
      return () => {};
    });
    mocks.query.mockResolvedValueOnce([{ id: 'ingredient-1', name: 'Queso', stock: 0 }]);
    const { result } = renderHook(() => useAvailableIngredients());

    await waitFor(() => expect(result.current.ingredients).toHaveLength(1));
    mocks.query.mockResolvedValueOnce([{ id: 'ingredient-1' }, { id: 'ingredient-2', name: 'Salsa' }]);
    await act(async () => { subscriber({ operation: 'created', productId: 'ingredient-2' }); });

    await waitFor(() => expect(result.current.ingredients).toHaveLength(2));
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });
});
