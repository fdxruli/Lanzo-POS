// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const shared = vi.hoisted(() => ({
  app: null,
  actorAccess: null,
  catalog: null,
  stats: null,
  repository: {
    saveCategory: vi.fn(),
    saveProduct: vi.fn(),
    confirmLocalCategoryInCloud: vi.fn(),
    deleteCategory: vi.fn(),
    getCategoryProductCounts: vi.fn(),
    getProductById: vi.fn()
  },
  broadcastDBChange: vi.fn(),
  showMessageModal: vi.fn(),
  showConfirmModal: vi.fn()
}));

vi.mock('../../store/useAppStore', () => ({
  useAppStore: (selector) => selector(shared.app)
}));
vi.mock('../../services/auth/useActorAccess', () => ({
  useActorAccess: () => shared.actorAccess
}));
vi.mock('../../store/useInventoryCatalogStore', () => ({
  useInventoryCatalogStore: (selector) => selector(shared.catalog)
}));
vi.mock('../../store/useStatsStore', () => ({
  useStatsStore: (selector) => selector(shared.stats)
}));
vi.mock('../../hooks/useFeatureConfig', () => ({
  useFeatureConfig: () => ({ hasRecipes: false, hasVariants: false })
}));
vi.mock('../../hooks/useNavigationGuard', () => ({
  useNavigationGuard: () => ({ runWithoutBlocking: (callback) => callback() })
}));
vi.mock('../../hooks/useBotScreenContext', () => ({
  usePublishBotScreen: vi.fn()
}));
vi.mock('../../services/products/productRepository', () => ({
  productRepository: shared.repository
}));
vi.mock('../../services/products/productImageMigrationService', () => ({
  migrateLegacyProductImages: vi.fn(),
  prepareProductImageForCloud: vi.fn(async ({ productData }) => ({
    productPayload: productData,
    requiresReselection: false
  }))
}));
vi.mock('../../services/products/productCatalogEvents', () => ({
  broadcastDBChange: shared.broadcastDBChange
}));
vi.mock('../../services/utils', () => ({
  showConfirmModal: shared.showConfirmModal,
  showMessageModal: shared.showMessageModal
}));
vi.mock('../../components/products/form-v2/ProductFormV2', async () => {
  const React = await import('react');
  return {
    default: function MockProductFormV2({ productToEdit, initialDraftValues, onOpenCategoryManager, onSave, onCancel, onDirtyChange }) {
      const [categoryId, setCategoryId] = React.useState(initialDraftValues?.categoryId || productToEdit?.categoryId || '');
      const [productName, setProductName] = React.useState(initialDraftValues?.name || productToEdit?.name || '');
      const [description, setDescription] = React.useState(initialDraftValues?.description || productToEdit?.description || '');

      const changeField = (field, value) => {
        const next = {
          id: productToEdit?.id || 'product-new',
          name: field === 'name' ? value : productName,
          description: field === 'description' ? value : description,
          categoryId: field === 'categoryId' ? value : categoryId
        };
        if (field === 'name') setProductName(value);
        if (field === 'description') setDescription(value);
        if (field === 'categoryId') setCategoryId(value);
        onDirtyChange?.(true, next);
      };

      return (
        <div>
          <h2>{productToEdit?.id ? 'Editar producto' : 'Nuevo producto'}</h2>
          <label>
            Nombre del producto
            <input aria-label="Nombre del producto" value={productName} onChange={(event) => changeField('name', event.target.value)} />
          </label>
          <label>
            Categoría del producto
            <select aria-label="Categoría del producto" value={categoryId} onChange={(event) => changeField('categoryId', event.target.value)}>
              <option value="">Sin categoría</option>
              <option value="category-a">QA Categoría A</option>
              <option value="category-b">Categoría B</option>
              <option value="category-b-created">QA Categoría B</option>
            </select>
          </label>
          <label>
            Descripción del producto
            <input aria-label="Descripción del producto" value={description} onChange={(event) => changeField('description', event.target.value)} />
          </label>
          <button type="button" onClick={() => onSave({
            id: productToEdit?.id || 'product-new',
            name: productName,
            description,
            categoryId: categoryId || productToEdit?.categoryId || ''
          }, productToEdit || null)}>
            Guardar producto
          </button>
          <button type="button" onClick={() => onOpenCategoryManager((category) => setCategoryId(category.id))}>
            Administrar categorías del producto
          </button>
          <button type="button" onClick={onCancel}>Cancelar</button>
        </div>
      );
    }
  };
});
vi.mock('../../components/products/ProductList', () => ({
  default: function MockProductList({ onEdit, products = [], reviewOnly = false, historicalCostReview = false }) {
    return (
      <div>
        {products.map((product) => <span key={product.id} data-testid="listed-product">{product.name}</span>)}
        {reviewOnly && <span data-testid="product-review-mode">{historicalCostReview ? 'Costo histórico' : 'Solo lectura'}</span>}
        {!reviewOnly && (
          <>
            <button type="button" onClick={() => onEdit({ id: 'product-b', name: 'Producto B' })}>Editar producto B</button>
            <button type="button" onClick={() => onEdit({
              id: 'soap-qa', name: 'Jabón QA', description: 'Descripción anterior', categoryId: 'hygiene-qa'
            })}>Editar Jabón QA</button>
          </>
        )}
      </div>
    );
  }
}));

import ProductsPage from '../ProductsPage';

const PRO_LICENSE = {
  license_key: 'test-pro-license',
  features: { cloud_pos_sync: true, cloud_products_sync: true }
};

const makeCategory = (overrides = {}) => ({
  id: 'category-1',
  name: 'Bebidas',
  color: '#123abc',
  sortOrder: 3,
  serverVersion: 4,
  ...overrides
});

const renderPage = (initialEntry = '/productos?tab=categories') => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <ProductsPage />
  </MemoryRouter>
);

const setReviewActor = (permissions = ['products', 'inventory'], overrides = {}) => {
  shared.app.licenseDetails = { ...PRO_LICENSE, license_key: 'license-a' };
  const runtimeSnapshot = {
    actorKey: 'admin:admin-a',
    sessionId: 'session-a',
    tenant: { opaqueId: 'tenant-a' },
    ...overrides
  };
  shared.actorAccess = {
    runtimeSnapshot,
    canAccessPermission: (permission) => permissions.includes(permission)
  };
  return JSON.stringify(['tenant-a', 'admin:admin-a', 'session-a', 'license-a']);
};

const reviewLocation = ({ contextToken, recordReference = { kind: 'product', id: 'product-real-1' }, productName = 'Producto real' } = {}) => ({
  pathname: '/productos',
  search: '?tab=list',
  state: {
    liaProductReview: {
      contextToken,
      recordReference,
      productName,
      costReview: true,
      resumeSnapshot: { version: 1, kind: 'analysis', question: '¿Mi negocio es rentable?' }
    }
  }
});

const createDeferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const beginCreate = async (name) => {
  await screen.findByRole('heading', { name: 'Nueva categoría' });
  fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
};

describe('ProductsPage category save flow', () => {
  beforeEach(() => {
    shared.app = {
      companyProfile: { business_type: [] },
      licenseDetails: null,
      initializeApp: vi.fn().mockResolvedValue({ status: 'ready' }),
      canAccess: vi.fn(() => true)
    };
    shared.actorAccess = {
      canAccessPermission: (permission) => shared.app?.canAccess(permission) ?? false
    };
    shared.catalog = {
      categories: [makeCategory()],
      menu: [],
      filters: { productType: 'sellable', categoryId: null },
      setFilters: vi.fn(),
      loadInitialProducts: vi.fn().mockResolvedValue(undefined),
      refreshCategories: vi.fn().mockResolvedValue(undefined)
    };
    shared.stats = { adjustInventoryValue: vi.fn() };
    shared.repository.saveCategory.mockReset();
    shared.repository.saveProduct.mockReset();
    shared.repository.confirmLocalCategoryInCloud.mockReset();
    shared.repository.deleteCategory.mockReset().mockResolvedValue({ success: true });
    shared.repository.getCategoryProductCounts.mockReset().mockResolvedValue({ complete: false, counts: {} });
    shared.repository.getProductById.mockReset();
    shared.broadcastDBChange.mockReset();
    shared.showMessageModal.mockReset();
    shared.showConfirmModal.mockReset().mockResolvedValue(true);
  });

  afterEach(() => cleanup());

  it('opens the exact product by its stable id in read-only review mode and distinguishes historical cost', async () => {
    const contextToken = setReviewActor();
    shared.repository.getProductById.mockResolvedValueOnce({
      id: 'product-real-1', name: 'Producto real', cost: 42, isActive: true
    });
    renderPage(reviewLocation({ contextToken }));

    expect(await screen.findByTestId('listed-product')).toHaveTextContent('Producto real');
    expect(screen.getByTestId('product-review-mode')).toHaveTextContent('Costo histórico');
    expect(screen.getByRole('heading', { name: 'Producto real' })).toBeInTheDocument();
    expect(screen.getByText(/costo registrado actualmente en Productos puede ser distinto/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar producto B' })).not.toBeInTheDocument();
    expect(shared.repository.getProductById).toHaveBeenCalledTimes(1);
    expect(shared.repository.getProductById).toHaveBeenCalledWith('product-real-1');
  });

  it('does not look up an invalid reference, a changed tenant, or a product without current permission', async () => {
    const contextToken = setReviewActor();
    const invalidId = reviewLocation({ contextToken, recordReference: { kind: 'product', id: 'bad\nreference' } });
    renderPage(invalidId);
    expect(await screen.findByText(/referencia del producto no es válida/i)).toBeInTheDocument();
    expect(shared.repository.getProductById).not.toHaveBeenCalled();
    cleanup();

    setReviewActor(['products', 'inventory']);
    const tenantChanged = reviewLocation({ contextToken: JSON.stringify(['tenant-old', 'admin:admin-a', 'session-a', 'license-a']) });
    renderPage(tenantChanged);
    expect(await screen.findByText(/negocio o la sesión cambió/i)).toBeInTheDocument();
    expect(shared.repository.getProductById).not.toHaveBeenCalled();
    cleanup();

    const sameContext = setReviewActor([]);
    renderPage(reviewLocation({ contextToken: sameContext }));
    expect(await screen.findByText(/tu permiso actual no permite revisar este registro/i)).toBeInTheDocument();
    expect(shared.repository.getProductById).not.toHaveBeenCalled();
  });

  it('explains archived and unavailable products without redirecting to another record', async () => {
    const contextToken = setReviewActor();
    shared.repository.getProductById.mockResolvedValueOnce({
      id: 'product-real-1', name: 'Producto archivado', cost: 15, isActive: false
    });
    const archived = reviewLocation({ contextToken, productName: 'Producto real' });
    renderPage(archived);
    expect(await screen.findByText(/está archivado/i)).toBeInTheDocument();
    expect(screen.getByTestId('listed-product')).toHaveTextContent('Producto archivado');
    expect(shared.repository.getProductById).toHaveBeenCalledTimes(1);
    expect(shared.repository.getProductById).toHaveBeenCalledWith('product-real-1');
    cleanup();

    const unavailableContext = setReviewActor();
    shared.repository.getProductById.mockResolvedValueOnce(null);
    renderPage(reviewLocation({ contextToken: unavailableContext }));
    expect(await screen.findByText(/ya no está disponible o fue eliminado/i)).toBeInTheDocument();
    expect(shared.repository.getProductById).toHaveBeenCalledTimes(2);
  });

  it('offers the existing verification recovery and keeps product fields after a tenant preflight block', async () => {
    renderPage('/productos?tab=list');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Jabón QA' }));

    const description = screen.getByLabelText('Descripción del producto');
    fireEvent.change(description, { target: { value: 'Descripción conservada' } });
    shared.repository.saveProduct.mockResolvedValueOnce({
      success: false,
      code: 'ACTOR_TENANT_NOT_READY',
      phase: 'actor_preflight',
      recoveryAction: 'retry_tenant_verification'
    });

    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    await waitFor(() => expect(shared.showMessageModal).toHaveBeenCalledOnce());
    const [message, , options] = shared.showMessageModal.mock.calls[0];
    expect(message).toMatch(/contexto seguro de este negocio/i);
    expect(options).toMatchObject({ type: 'warning' });
    expect(options.extraButton.text).toBe('Reintentar verificación');
    await act(async () => options.extraButton.action());

    expect(shared.app.initializeApp).toHaveBeenCalledWith({ force: true });
    expect(description).toHaveValue('Descripción conservada');
  });

  it('reports a successful product save when the later list refresh fails', async () => {
    let failRefresh = false;
    shared.catalog.loadInitialProducts.mockImplementation(async () => {
      if (failRefresh) throw new Error('tenant runtime temporarily unavailable');
      return undefined;
    });
    shared.repository.saveProduct.mockResolvedValueOnce({
      success: true,
      productId: 'soap-qa',
      inventoryValue: 0
    });
    renderPage('/productos?tab=list');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Jabón QA' }));
    fireEvent.change(screen.getByLabelText('Descripción del producto'), { target: { value: 'Descripción guardada' } });
    failRefresh = true;

    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    await waitFor(() => expect(shared.showMessageModal).toHaveBeenCalledOnce());
    const [message, , options] = shared.showMessageModal.mock.calls[0];
    expect(message).toMatch(/actualizado exitosamente/i);
    expect(message).toMatch(/sí quedó guardado, pero la lista no pudo actualizarse/i);
    expect(options.type).toBe('warning');
    expect(message).not.toMatch(/Error inesperado/i);
  });

  it('keeps a confirmed Cloud write pending until verification and catalog refresh, without inventory adjustment', async () => {
    shared.repository.saveProduct.mockResolvedValueOnce({
      success: true,
      pending: true,
      cloudConfirmed: true,
      localReconciliationPending: true,
      productId: 'soap-qa',
      inventoryValue: 125,
      message: 'Nube confirmó el producto. No vuelvas a guardar este cambio.'
    });
    renderPage('/productos?tab=list');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Jabón QA' }));
    shared.catalog.loadInitialProducts.mockClear();
    shared.catalog.refreshCategories.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    await waitFor(() => expect(shared.showMessageModal).toHaveBeenCalledOnce());
    expect(shared.stats.adjustInventoryValue).not.toHaveBeenCalled();
    expect(shared.catalog.loadInitialProducts).not.toHaveBeenCalled();
    expect(shared.catalog.refreshCategories).not.toHaveBeenCalled();
    const [, , options] = shared.showMessageModal.mock.calls[0];
    expect(options.extraButton.text).toBe('Verificar y sincronizar catálogo');

    await act(async () => options.extraButton.action());

    expect(shared.app.initializeApp).toHaveBeenCalledWith({ force: true });
    expect(shared.catalog.loadInitialProducts).toHaveBeenCalledOnce();
    expect(shared.catalog.refreshCategories).toHaveBeenCalledOnce();
  });

  it('reports an uncertain Cloud result without claiming the product was not saved or resubmitting', async () => {
    shared.repository.saveProduct.mockResolvedValueOnce({
      success: false,
      code: 'PRODUCT_SYNC_CONFIRMATION_MISSING',
      message: 'Cloud no devolvió confirmación del producto guardado.'
    });
    renderPage('/productos?tab=list');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Jabón QA' }));
    const description = screen.getByLabelText('Descripción del producto');
    fireEvent.change(description, { target: { value: 'Borrador con respuesta incierta' } });

    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    await waitFor(() => expect(shared.showMessageModal).toHaveBeenCalledOnce());
    const [message, , options] = shared.showMessageModal.mock.calls[0];
    expect(message).toMatch(/Cloud no confirmó el resultado del guardado/i);
    expect(message).toMatch(/verifica el catálogo antes de volver a guardar/i);
    expect(message).not.toMatch(/el producto no se guardó/i);
    expect(options.type).toBe('warning');
    expect(shared.repository.saveProduct).toHaveBeenCalledOnce();
    expect(description).toHaveValue('Borrador con respuesta incierta');
  });

  it('keeps the product and fields intact when the user chooses to continue editing from Cancelar', async () => {
    shared.showConfirmModal.mockResolvedValueOnce(false);
    renderPage('/productos?tab=list');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Jabón QA' }));
    const description = screen.getByLabelText('Descripción del producto');
    fireEvent.change(description, { target: { value: 'Borrador que debe conservarse' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(shared.showConfirmModal).toHaveBeenCalledOnce());
    expect(shared.showConfirmModal).toHaveBeenCalledWith(
      expect.stringMatching(/datos no guardados se perderán/i),
      expect.objectContaining({
        confirmButtonText: 'Sí, salir',
        cancelButtonText: 'Continuar editando'
      })
    );
    expect(screen.getByRole('heading', { name: 'Editar producto' })).toBeInTheDocument();
    expect(description).toHaveValue('Borrador que debe conservarse');
  });

  it('clears the edited product and draft only after confirming exit', async () => {
    shared.showConfirmModal.mockResolvedValueOnce(true);
    renderPage('/productos?tab=list');
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Jabón QA' }));
    fireEvent.change(screen.getByLabelText('Descripción del producto'), { target: { value: 'Descartar este borrador' } });

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar Jabón QA' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Editar producto' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Agregar Producto' }));

    expect(screen.getByRole('heading', { name: 'Nuevo producto' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre del producto')).toHaveValue('');
    expect(screen.getByLabelText('Descripción del producto')).toHaveValue('');
    expect(screen.getByLabelText('Categoría del producto')).toHaveValue('');
  });

  it('opens Categories from the tab using the current actor permission without a false denial', async () => {
    renderPage('/productos');

    fireEvent.click(await screen.findByRole('button', { name: /categorias/i }));

    await screen.findByRole('heading', { name: 'Categorías' });
    expect(shared.showMessageModal).not.toHaveBeenCalledWith(
      'No tienes permiso para gestionar productos.',
      expect.anything(),
      expect.anything()
    );
  });

  it('does not assign a delayed category from product A to product B', async () => {
    const pendingSave = createDeferred();
    shared.repository.saveCategory.mockReturnValueOnce(pendingSave.promise);
    renderPage('/productos?tab=add');

    fireEvent.click(await screen.findByRole('button', { name: 'Administrar categorías del producto' }));
    await screen.findByRole('heading', { name: 'Gestionar categorías' });
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA Categoría A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(shared.repository.saveCategory).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Productos (Venta)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Editar producto B' }));
    const categorySelect = await screen.findByRole('combobox', { name: 'Categoría del producto' });
    fireEvent.change(categorySelect, { target: { value: 'category-b' } });

    fireEvent.click(screen.getByRole('button', { name: 'Administrar categorías del producto' }));
    await screen.findByRole('heading', { name: 'Gestionar categorías' });
    pendingSave.resolve({ id: 'category-a', name: 'QA Categoría A' });
    await waitFor(() => expect(shared.broadcastDBChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'category-created',
      categoryId: 'category-a'
    })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(categorySelect).toHaveValue('category-b');
    expect(screen.getByLabelText('Nombre del producto')).toHaveValue('Producto B');
  });

  it('does not apply an older save after closing and reopening the new-product form with the same React key', async () => {
    const pendingSaveA = createDeferred();
    const pendingSaveB = createDeferred();
    shared.repository.saveCategory
      .mockReturnValueOnce(pendingSaveA.promise)
      .mockReturnValueOnce(pendingSaveB.promise);
    renderPage('/productos?tab=add');

    fireEvent.click(await screen.findByRole('button', { name: 'Administrar categorías del producto' }));
    await screen.findByRole('heading', { name: 'Gestionar categorías' });
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA Categoría A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(shared.repository.saveCategory).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Productos (Venta)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar Producto' }));
    const categorySelect = await screen.findByRole('combobox', { name: 'Categoría del producto' });
    expect(categorySelect).toHaveValue('');
    fireEvent.change(categorySelect, { target: { value: 'category-b' } });

    fireEvent.click(screen.getByRole('button', { name: 'Administrar categorías del producto' }));
    await screen.findByRole('heading', { name: 'Gestionar categorías' });
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA Categoría B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(shared.repository.saveCategory).toHaveBeenCalledTimes(2));

    pendingSaveB.resolve({ id: 'category-b-created', name: 'QA Categoría B' });
    await waitFor(() => expect(shared.broadcastDBChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'category-created',
      categoryId: 'category-b-created'
    })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(categorySelect).toHaveValue('category-b-created');

    pendingSaveA.resolve({ id: 'category-a', name: 'QA Categoría A' });
    await waitFor(() => expect(shared.broadcastDBChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'category-created',
      categoryId: 'category-a'
    })));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(categorySelect).toHaveValue('category-b-created');
  });

  it('offers authorized category recovery before retrying a categorized description edit', async () => {
    shared.app.licenseDetails = { ...PRO_LICENSE, valid: true };
    shared.repository.saveProduct
      .mockResolvedValueOnce({
        success: false,
        code: 'PRODUCT_CATEGORY_RECOVERY_REQUIRED',
        category: { id: 'hygiene-qa', name: 'Higiene QA' },
        message: 'La categoría local necesita confirmación.'
      })
      .mockResolvedValueOnce({ success: true, productId: 'soap-qa', response: { product: { id: 'soap-qa' } } });
    shared.repository.confirmLocalCategoryInCloud.mockResolvedValueOnce({
      success: true,
      category: { id: 'hygiene-qa', name: 'Higiene QA' }
    });
    renderPage('/productos');

    fireEvent.click(await screen.findByRole('button', { name: 'Editar Jabón QA' }));
    const description = await screen.findByRole('textbox', { name: 'Descripción del producto' });
    fireEvent.change(description, { target: { value: 'Descripción corregida' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    await waitFor(() => expect(shared.repository.confirmLocalCategoryInCloud).toHaveBeenCalledWith('hygiene-qa'));
    expect(shared.showConfirmModal).toHaveBeenCalledWith(
      expect.stringContaining('confirma esta categoría en la nube'),
      expect.objectContaining({
        title: 'Confirmar categoría local',
        confirmButtonText: 'Confirmar categoría en Nube',
        cancelButtonText: 'Cancelar'
      })
    );
    await waitFor(() => expect(shared.repository.saveProduct).toHaveBeenCalledTimes(2));
    expect(shared.repository.confirmLocalCategoryInCloud.mock.invocationCallOrder[0])
      .toBeLessThan(shared.repository.saveProduct.mock.invocationCallOrder[1]);
    expect(shared.repository.saveProduct.mock.calls[1][0]).toMatchObject({
      id: 'soap-qa', description: 'Descripción corregida', categoryId: 'hygiene-qa'
    });
  });

  it('selects a category created in the current form session and preserves other product fields', async () => {
    const pendingSave = createDeferred();
    shared.repository.saveCategory.mockReturnValueOnce(pendingSave.promise);
    renderPage('/productos?tab=add');

    const productName = await screen.findByLabelText('Nombre del producto');
    fireEvent.change(productName, { target: { value: 'Producto sin cambios' } });
    fireEvent.click(screen.getByRole('button', { name: 'Administrar categorías del producto' }));
    await screen.findByRole('heading', { name: 'Gestionar categorías' });
    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA Categoría normal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(shared.repository.saveCategory).toHaveBeenCalledOnce());
    pendingSave.resolve({ id: 'category-a', name: 'QA Categoría normal' });

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Categoría del producto' })).toHaveValue('category-a'));
    expect(productName).toHaveValue('Producto sin cambios');
  });

  it('accepts a Free category object without success:true and broadcasts after persistence', async () => {
    shared.repository.saveCategory.mockResolvedValue({
      id: 'category-new',
      name: 'QA Bebidas',
      color: '#3b82f6',
      sortOrder: 0
    });
    renderPage();
    await beginCreate('QA Bebidas');

    await waitFor(() => expect(shared.broadcastDBChange).toHaveBeenCalledOnce());
    expect(shared.catalog.refreshCategories).toHaveBeenCalled();
    expect(shared.catalog.loadInitialProducts).toHaveBeenCalled();
    expect(shared.broadcastDBChange).toHaveBeenCalledWith(expect.objectContaining({
      action: 'category-created',
      categoryId: 'category-new',
      categoryName: 'QA Bebidas'
    }));
    expect(screen.getByRole('status')).toHaveTextContent('Categoría guardada.');
  });

  it('refreshes the Cloud category after a PRO conflict without clearing or saving the stale edit', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      success: false,
      code: 'VERSION_CONFLICT',
      message: 'La categoria fue modificada en otro dispositivo.',
      response: {
        server_version: 9,
        category: { id: 'category-1', name: 'Bebidas Cloud', color: '#abcdef', sort_order: 8, server_version: 9 }
      }
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Nueva categoría' });
    fireEvent.click(screen.getByRole('button', { name: 'Editar Bebidas' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actualizar' })).toBeInTheDocument());
    shared.catalog.loadInitialProducts.mockClear();
    shared.catalog.refreshCategories.mockClear();

    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'Bebidas actualizadas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cambió en otro dispositivo');
    expect(screen.getByRole('alert')).toHaveTextContent('vuelve a abrir la categoría');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('Bebidas actualizadas');
    expect(shared.repository.saveCategory).toHaveBeenCalledWith(expect.objectContaining({
      id: 'category-1',
      serverVersion: 4,
      name: 'Bebidas actualizadas'
    }));
    expect(shared.catalog.refreshCategories).toHaveBeenCalledOnce();
    expect(shared.catalog.loadInitialProducts).not.toHaveBeenCalled();
    expect(shared.broadcastDBChange).not.toHaveBeenCalled();
    expect(shared.showMessageModal).not.toHaveBeenCalled();
  });

  it('shows a PRO duplicate rejection inline without announcing a successful category event', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      success: false,
      code: 'DUPLICATE_CATEGORY_NAME',
      message: 'Ya existe una categoria activa con este nombre.',
      field: 'name'
    });
    renderPage();
    await beginCreate('Bebidas repetidas');

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una categoria activa');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('Bebidas repetidas');
    expect(shared.broadcastDBChange).not.toHaveBeenCalled();
    expect(shared.catalog.refreshCategories).not.toHaveBeenCalled();
  });

  it('explains PRO authorization rejections without clearing the form', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      success: false,
      code: 'PRODUCTS_WRITE_PERMISSION_REQUIRED',
      message: 'PRODUCTS_WRITE_PERMISSION_REQUIRED'
    });
    renderPage();
    await beginCreate('QA permiso');

    expect(await screen.findByRole('alert')).toHaveTextContent('No tienes autorización');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('QA permiso');
    expect(shared.broadcastDBChange).not.toHaveBeenCalled();
  });

  it('keeps a Free form after a local database exception without announcing success', async () => {
    const error = new Error('IndexedDB write failed');
    error.name = 'ConstraintError';
    shared.repository.saveCategory.mockRejectedValue(error);
    renderPage();
    await screen.findByRole('heading', { name: 'Nueva categoría' });
    shared.catalog.loadInitialProducts.mockClear();

    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA local' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('IndexedDB write failed');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('QA local');
    expect(shared.catalog.refreshCategories).not.toHaveBeenCalled();
    expect(shared.catalog.loadInitialProducts).not.toHaveBeenCalled();
    expect(shared.broadcastDBChange).not.toHaveBeenCalled();
  });

  it('shows an explicit cloud confirmation only after the PRO repository resolves successfully', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      success: true,
      id: 'category-new',
      name: 'QA PRO',
      color: '#3b82f6',
      sortOrder: 0
    });
    renderPage();
    await beginCreate('QA PRO');

    expect(await screen.findByRole('status')).toHaveTextContent('Categoría guardada y confirmada en la nube.');
    expect(shared.broadcastDBChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'category-created' }));
  });

  it('rejects a cloud category result that lacks the RPC confirmation flag', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      id: 'category-new',
      name: 'QA sin confirmar'
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Nueva categoría' });
    shared.catalog.loadInitialProducts.mockClear();

    fireEvent.change(screen.getByLabelText('Nombre de la categoria'), { target: { value: 'QA sin confirmar' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('La nube no confirmó el guardado');
    expect(screen.getByLabelText('Nombre de la categoria')).toHaveValue('QA sin confirmar');
    expect(shared.catalog.refreshCategories).not.toHaveBeenCalled();
    expect(shared.catalog.loadInitialProducts).not.toHaveBeenCalled();
    expect(shared.broadcastDBChange).not.toHaveBeenCalled();
  });

  it('labels accepted PRO offline writes as pending synchronization', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.saveCategory.mockResolvedValue({
      id: 'category-new',
      name: 'QA pendiente',
      success: true,
      pending: true
    });
    renderPage();
    await beginCreate('QA pendiente');

    expect(await screen.findByRole('status')).toHaveTextContent('guardada en este dispositivo');
    expect(screen.getByRole('status')).toHaveTextContent('sincronización está pendiente');
    expect(shared.broadcastDBChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'category-created' }));
  });

  it.each([0, 1, 4])('preserves the Free deletion warning for %s local products', async (count) => {
    shared.repository.getCategoryProductCounts.mockResolvedValue({ source: 'local', complete: true, counts: { 'category-1': count } });
    renderPage();
    await screen.findByText(count === 0 ? 'Sin productos' : `${count} ${count === 1 ? 'producto' : 'productos'}`);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Bebidas' }));
    const message = count === 0 ? 'No hay productos asociados. Los productos no se eliminarán.'
      : count === 1 ? 'El producto asociado quedará sin categoría. El producto no se eliminará.'
        : `Los ${count} productos asociados quedarán sin categoría. Los productos no se eliminarán.`;
    expect(shared.showConfirmModal).toHaveBeenCalledWith(message, expect.any(Object));
  });

  it.each([0, 1, 7])('uses a generic PRO warning for %s device products', async (count) => {
    shared.app.licenseDetails = PRO_LICENSE;
    shared.repository.getCategoryProductCounts.mockResolvedValue({ source: 'local', complete: false, counts: { 'category-1': count } });
    renderPage();
    await screen.findByText(count === 0 ? 'Sin productos registrados aquí' : `${count} ${count === 1 ? 'producto' : 'productos'} en este dispositivo`);
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Bebidas' }));
    expect(shared.showConfirmModal).toHaveBeenCalledWith(
      'Los productos asociados quedarán sin categoría. Los productos no se eliminarán.', expect.any(Object)
    );
    await waitFor(() => expect(shared.repository.deleteCategory).toHaveBeenCalledWith('category-1'));
  });

  it('does not infer Cloud zero from a historical PRO snapshot and local zero', async () => {
    shared.app.licenseDetails = PRO_LICENSE;
    // Legacy snapshot result: another device's associations are absent locally.
    shared.repository.getCategoryProductCounts.mockResolvedValue({ complete: true, counts: { 'category-1': 0 } });
    renderPage();
    await screen.findByText('Sin productos');
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Bebidas' }));
    expect(shared.showConfirmModal).toHaveBeenCalledWith(
      'Los productos asociados quedarán sin categoría. Los productos no se eliminarán.',
      expect.any(Object)
    );
    await waitFor(() => expect(shared.repository.deleteCategory).toHaveBeenCalledWith('category-1'));
  });

  it('explains the category and product impact before deletion when the count is reliable', async () => {
    shared.repository.getCategoryProductCounts.mockResolvedValue({
      complete: true,
      counts: { 'category-1': 12 }
    });
    renderPage();

    expect(await screen.findByText('12 productos')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Bebidas' }));

    await waitFor(() => expect(shared.showConfirmModal).toHaveBeenCalledWith(
      'Los 12 productos asociados quedarán sin categoría. Los productos no se eliminarán.',
      expect.objectContaining({
        title: '¿Eliminar «Bebidas»?',
        confirmButtonText: 'Eliminar categoría',
        cancelButtonText: 'Cancelar'
      })
    ));
    await waitFor(() => expect(shared.repository.deleteCategory).toHaveBeenCalledWith('category-1'));
  });

  it('uses a generic deletion warning when the category count is not reliable', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Bebidas' }));

    await waitFor(() => expect(shared.showConfirmModal).toHaveBeenCalledWith(
      'Los productos asociados quedarán sin categoría. Los productos no se eliminarán.',
      expect.objectContaining({ title: '¿Eliminar «Bebidas»?' })
    ));
    expect(shared.showConfirmModal.mock.calls[0][0]).not.toContain('0 productos');
  });
});
