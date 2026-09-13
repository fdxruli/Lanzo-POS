from pathlib import Path
import sys


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old, new, 1)


def patch_ui_and_tests():
    modal_path = Path('src/components/ecommerce/EcommerceProductPublishModal.jsx')
    modal = modal_path.read_text(encoding='utf-8')

    modal = replace_once(
        modal,
        """  const businessPolicy = useMemo(() => resolveEcommerceBusinessPolicy({
    profile: companyProfile,
    product: selectedLocalProduct || {},
    publicConfigurationMode: form.publicConfigurationMode
  }), [companyProfile, form.publicConfigurationMode, selectedLocalProduct]);
""",
        """  const searchActive = localProductSearch.trim().length > 0;
  const searchResults = searchActive ? localProducts : [];
  const getLocalProductCategory = (product) => (
    categoriesById.get(product?.categoryId) || product?.category || ''
  );
  const isLinkedLocalProduct = (product) => {
    const ref = String(product?.id || '');
    return Boolean(ref && linkedRefs.has(ref) && ref !== editingProduct?.localProductRef);
  };
  const getLocalProductPolicy = (product) => resolveEcommerceBusinessPolicy({
    profile: companyProfile,
    product: product || {}
  });

  const businessPolicy = useMemo(() => resolveEcommerceBusinessPolicy({
    profile: companyProfile,
    product: selectedLocalProduct || {},
    publicConfigurationMode: form.publicConfigurationMode
  }), [companyProfile, form.publicConfigurationMode, selectedLocalProduct]);
""",
        'insert search result helpers'
    )

    modal = replace_once(
        modal,
        """  const chooseProduct = (event) => {
    const product = selectableLocalProducts.find(
      (item) => String(item.id) === event.target.value
    );
    if (!product) {
      setSelectedProductSnapshot(null);
      setForm((current) => ({
        ...current,
        localProductRef: '',
        stockMode: 'hidden',
        stockTracked: false,
        publicConfigurationMode: null,
        wholesaleEnabled: false
      }));
      return;
    }
    const stockTracked = isProductStockTracked(product);
    setSelectedProductSnapshot(product);
    setForm((current) => ({
      ...current,
      localProductRef: String(product.id),
      publicName: product.name || '',
      publicDescription: product.description || '',
      price: String(product.price ?? 0),
      categoryName: categoriesById.get(product.categoryId) || product.category || '',
      imageUrl: publicUrl(product.imageUrl || product.image),
      stockTracked,
      stockMode: stockTracked ? current.stockMode : 'hidden',
      publicConfigurationMode: null,
      wholesaleEnabled: false
    }));
  };
""",
        """  const clearSelectedProduct = () => {
    setSelectedProductSnapshot(null);
    setForm((current) => ({
      ...current,
      localProductRef: '',
      stockMode: 'hidden',
      stockTracked: false,
      publicConfigurationMode: null,
      wholesaleEnabled: false
    }));
  };

  const selectLocalProduct = (product) => {
    if (!product) {
      clearSelectedProduct();
      return;
    }
    const stockTracked = isProductStockTracked(product);
    setSelectedProductSnapshot(product);
    setForm((current) => ({
      ...current,
      localProductRef: String(product.id),
      publicName: product.name || '',
      publicDescription: product.description || '',
      price: String(product.price ?? 0),
      categoryName: getLocalProductCategory(product),
      imageUrl: publicUrl(product.imageUrl || product.image),
      stockTracked,
      stockMode: stockTracked ? current.stockMode : 'hidden',
      publicConfigurationMode: null,
      wholesaleEnabled: false
    }));
  };

  const chooseProduct = (event) => {
    const product = selectableLocalProducts.find(
      (item) => String(item.id) === event.target.value
    );
    selectLocalProduct(product || null);
  };
""",
        'unify local product selection'
    )

    old_group = """          <label className=\"form-group ecom-admin-span-2\">
            <span className=\"form-label\">Producto del catálogo local *</span>
            <span className=\"ecom-admin-local-product-search\">
              <Search size={16} aria-hidden=\"true\" />
              <input
                className=\"form-input\"
                type=\"search\"
                value={localProductSearch}
                onChange={(event) => {
                  hasUserSearchedRef.current = true;
                  setLocalProductSearch(event.target.value);
                }}
                placeholder=\"Buscar por nombre, código o SKU\"
                disabled={Boolean(editingProduct)}
              />
            </span>
            <select className=\"form-input\" value={form.localProductRef} onChange={chooseProduct} disabled={Boolean(editingProduct)} required>
              <option value=\"\">Selecciona un producto</option>
              {selectableLocalProducts.map((product) => {
                const ref = String(product.id);
                const linked = linkedRefs.has(ref) && ref !== editingProduct?.localProductRef;
                return (
                  <option key={ref} value={ref} disabled={linked}>
                    {product.name} — ${safeNumber(product.price).toFixed(2)}
                    {resolveEcommerceBusinessPolicy({
                      profile: companyProfile,
                      product
                    }).status === BUSINESS_CAPABILITY_STATUS.REQUIRES_REVIEW
                      ? ' — Requiere revisión'
                      : ''}
                    {linked ? ' (ya agregado)' : ''}
                  </option>
                );
              })}
            </select>
            <small className=\"ecom-admin-help\">
              {isPro
                ? 'Lanzo Nube puede mantener vinculados los campos elegidos sin sobrescribir los campos manuales.'
                : 'Se guarda una copia pública; tu producto local no se modifica.'}
            </small>
            {localCatalogLoading && <small className=\"ecom-admin-help\">Cargando productos…</small>}
            {!localCatalogLoading && selectableLocalProducts.length === 0 && (
              <small className=\"ecom-admin-help\">No encontramos productos activos con esa búsqueda.</small>
            )}
            {localCatalogHasMore && !editingProduct && (
              <button
                type=\"button\"
                className=\"btn btn-secondary ecom-admin-load-more-products\"
                onClick={() => onLoadMoreLocalProducts?.(localProductSearch)}
                disabled={localCatalogLoading}
              >
                Cargar más productos
              </button>
            )}
          </label>
"""

    new_group = """          <div className=\"form-group ecom-admin-span-2\">
            <label className=\"form-label\" htmlFor=\"ecom-local-product-select\">Producto del catálogo local *</label>
            <span className=\"ecom-admin-local-product-search\">
              <Search size={16} aria-hidden=\"true\" />
              <input
                className=\"form-input\"
                type=\"search\"
                value={localProductSearch}
                onChange={(event) => {
                  hasUserSearchedRef.current = true;
                  setLocalProductSearch(event.target.value);
                }}
                placeholder=\"Buscar por nombre, código o SKU\"
                aria-label=\"Buscar producto local\"
                disabled={Boolean(editingProduct)}
              />
            </span>

            {searchActive && (
              <div
                className=\"ecom-admin-product-search-results\"
                role=\"region\"
                aria-label=\"Resultados de búsqueda\"
                aria-live=\"polite\"
              >
                <div className=\"ecom-admin-product-search-results-heading\">
                  <strong>Resultados</strong>
                  {localCatalogLoading && <small>Cargando productos…</small>}
                </div>
                {!localCatalogLoading && searchResults.length === 0 && (
                  <div className=\"ecom-admin-product-search-results-empty\">
                    No encontramos productos con esa búsqueda.
                  </div>
                )}
                {searchResults.map((product) => {
                  const ref = String(product.id);
                  const linked = isLinkedLocalProduct(product);
                  const selected = String(form.localProductRef) === ref;
                  const policy = getLocalProductPolicy(product);
                  const categoryName = getLocalProductCategory(product);
                  const secondaryRef = product.sku || product.barcode;
                  return (
                    <button
                      key={ref}
                      type=\"button\"
                      className={`ecom-admin-product-search-result${selected ? ' is-selected' : ''}`}
                      onClick={() => selectLocalProduct(product)}
                      disabled={linked}
                      aria-label={`Seleccionar ${product.name}`}
                      aria-pressed={selected}
                    >
                      <span className=\"ecom-admin-product-search-result-copy\">
                        <strong>{product.name}</strong>
                        <span className=\"ecom-admin-product-search-result-meta\">
                          ${safeNumber(product.price).toFixed(2)}
                          {categoryName ? ` · ${categoryName}` : ''}
                        </span>
                        {secondaryRef && (
                          <small>SKU/código: {String(secondaryRef)}</small>
                        )}
                      </span>
                      <span className=\"ecom-admin-product-search-result-status\">
                        {policy.status === BUSINESS_CAPABILITY_STATUS.REQUIRES_REVIEW && (
                          <small className=\"is-review\">Requiere revisión</small>
                        )}
                        {linked && <small className=\"is-linked\">Ya agregado</small>}
                        {selected && !linked && <small className=\"is-selected\">Seleccionado</small>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <select
              id=\"ecom-local-product-select\"
              className=\"form-input\"
              value={form.localProductRef}
              onChange={chooseProduct}
              disabled={Boolean(editingProduct)}
              required
            >
              <option value=\"\">Selecciona un producto</option>
              {selectableLocalProducts.map((product) => {
                const ref = String(product.id);
                const linked = isLinkedLocalProduct(product);
                return (
                  <option key={ref} value={ref} disabled={linked}>
                    {product.name} — ${safeNumber(product.price).toFixed(2)}
                    {getLocalProductPolicy(product).status === BUSINESS_CAPABILITY_STATUS.REQUIRES_REVIEW
                      ? ' — Requiere revisión'
                      : ''}
                    {linked ? ' (ya agregado)' : ''}
                  </option>
                );
              })}
            </select>
            <small className=\"ecom-admin-help\">
              {isPro
                ? 'Lanzo Nube puede mantener vinculados los campos elegidos sin sobrescribir los campos manuales.'
                : 'Se guarda una copia pública; tu producto local no se modifica.'}
            </small>
            {localCatalogLoading && !searchActive && <small className=\"ecom-admin-help\">Cargando productos…</small>}
            {!localCatalogLoading && !searchActive && selectableLocalProducts.length === 0 && (
              <small className=\"ecom-admin-help\">No encontramos productos activos disponibles.</small>
            )}
            {localCatalogHasMore && !editingProduct && (
              <button
                type=\"button\"
                className=\"btn btn-secondary ecom-admin-load-more-products\"
                onClick={() => onLoadMoreLocalProducts?.(localProductSearch.trim())}
                disabled={localCatalogLoading}
              >
                {searchActive ? 'Cargar más resultados' : 'Cargar más productos'}
              </button>
            )}
          </div>
"""
    modal = replace_once(modal, old_group, new_group, 'replace local product search UI')
    modal_path.write_text(modal, encoding='utf-8')

    portal_path = Path('src/components/ecommerce/EcommercePortalSettings.jsx')
    portal = portal_path.read_text(encoding='utf-8')
    portal = replace_once(
        portal,
        """  const catalogSessionRef = useRef(0);
  const localCatalogCursorRef = useRef(null);
  const categoriesByIdRef = useRef(new Map());
""",
        """  const catalogSessionRef = useRef(0);
  const localCatalogCursorRef = useRef(null);
  const localCatalogSearchTermRef = useRef('');
  const categoriesByIdRef = useRef(new Map());
""",
        'add catalog search term cursor ownership'
    )
    portal = replace_once(
        portal,
        """    const requestId = ++catalogRequestSeqRef.current;
    const requestKindId = (latestRequestByKindRef.current[requestKind] || 0) + 1;
    latestRequestByKindRef.current[requestKind] = requestKindId;
    const setRequestLoading = (value) => {
""",
        """    const normalizedSearchTerm = String(searchTerm || '').trim();
    const requestId = ++catalogRequestSeqRef.current;
    const requestKindId = (latestRequestByKindRef.current[requestKind] || 0) + 1;
    latestRequestByKindRef.current[requestKind] = requestKindId;
    const setRequestLoading = (value) => {
""",
        'normalize search term'
    )
    portal = replace_once(
        portal,
        """    setRequestLoading(true);
    try {
""",
        """    setRequestLoading(true);
    if (requestKind === 'search' && !append) {
      setLocalProducts([]);
      setLocalCatalogHasMore(false);
      localCatalogCursorRef.current = null;
    }
    try {
""",
        'clear prior visual search results while search is pending'
    )
    portal = replace_once(
        portal,
        """          cursor,
          searchTerm
        }),
""",
        """          cursor,
          searchTerm: normalizedSearchTerm
        }),
""",
        'use normalized search term in repository call'
    )
    portal = replace_once(
        portal,
        """      const nextCursor = page.nextCursor || null;
      localCatalogCursorRef.current = nextCursor;
      setLocalCatalogHasMore(Boolean(nextCursor) && pageProducts.length > 0);
""",
        """      const nextCursor = page.nextCursor || null;
      localCatalogCursorRef.current = nextCursor;
      localCatalogSearchTermRef.current = normalizedSearchTerm;
      setLocalCatalogHasMore(Boolean(nextCursor) && pageProducts.length > 0);
""",
        'bind cursor to successful search term'
    )
    portal = replace_once(
        portal,
        """  const loadMoreLocalProducts = useCallback((searchTerm) => {
    const cursor = localCatalogCursorRef.current;
    if (!cursor) return Promise.resolve(true);
    return loadLocalCatalog({
      searchTerm,
      cursor,
      append: true,
      requestKind: 'load-more',
      sessionId: catalogSessionRef.current
    });
  }, [loadLocalCatalog]);
""",
        """  const loadMoreLocalProducts = useCallback((searchTerm) => {
    const normalizedSearchTerm = String(searchTerm || '').trim();
    if (localCatalogSearchTermRef.current !== normalizedSearchTerm) {
      return Promise.resolve(false);
    }
    const cursor = localCatalogCursorRef.current;
    if (!cursor) return Promise.resolve(true);
    return loadLocalCatalog({
      searchTerm: normalizedSearchTerm,
      cursor,
      append: true,
      requestKind: 'load-more',
      sessionId: catalogSessionRef.current
    });
  }, [loadLocalCatalog]);
""",
        'scope load more cursor to active search term'
    )
    portal_path.write_text(portal, encoding='utf-8')

    css_path = Path('src/components/ecommerce/EcommercePortalSettings.css')
    css = css_path.read_text(encoding='utf-8')
    css = replace_once(
        css,
        ".ecom-admin-local-product-search { display: flex; align-items: center; gap: 8px; margin: 8px 0; }\n.ecom-admin-local-product-search .form-input { min-width: 0; }\n.ecom-admin-load-more-products { width: fit-content; margin-top: 8px; }",
        """.ecom-admin-local-product-search { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
.ecom-admin-local-product-search .form-input { min-width: 0; }
.ecom-admin-product-search-results {
  display: grid;
  gap: 8px;
  max-height: min(42vh, 320px);
  margin: 2px 0 8px;
  padding: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  border: 1px solid var(--border-color);
  border-radius: 11px;
  background: var(--light-background);
  overscroll-behavior: contain;
}
.ecom-admin-product-search-results-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 2px 4px 4px;
  color: var(--text-color, var(--text-dark));
}
.ecom-admin-product-search-results-heading small { color: var(--text-light); }
.ecom-admin-product-search-results-empty {
  padding: 13px 12px;
  color: var(--text-light);
  text-align: center;
}
.ecom-admin-product-search-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-width: 0;
  min-height: 52px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  color: var(--text-color, var(--text-dark));
  background: var(--card-background-color);
  text-align: left;
  cursor: pointer;
}
.ecom-admin-product-search-result:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--primary-color) 55%, var(--border-color));
  background: color-mix(in srgb, var(--primary-color) 5%, var(--card-background-color));
}
.ecom-admin-product-search-result:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.ecom-admin-product-search-result.is-selected {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary-color) 12%, transparent);
}
.ecom-admin-product-search-result:disabled {
  opacity: .62;
  cursor: not-allowed;
}
.ecom-admin-product-search-result-copy {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.ecom-admin-product-search-result-copy strong,
.ecom-admin-product-search-result-copy small,
.ecom-admin-product-search-result-meta {
  overflow-wrap: anywhere;
}
.ecom-admin-product-search-result-meta,
.ecom-admin-product-search-result-copy small { color: var(--text-light); font-size: .8rem; }
.ecom-admin-product-search-result-status {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}
.ecom-admin-product-search-result-status small {
  padding: 4px 7px;
  border-radius: 999px;
  background: var(--card-background-color);
  font-size: .72rem;
  font-weight: 800;
  white-space: nowrap;
}
.ecom-admin-product-search-result-status .is-review { color: var(--ui-text-warning, #8a5a00); background: var(--ui-bg-warning-soft, #fff3cd); }
.ecom-admin-product-search-result-status .is-linked { color: var(--text-light); background: color-mix(in srgb, var(--text-light) 10%, transparent); }
.ecom-admin-product-search-result-status .is-selected { color: var(--ui-text-success, #176b3a); background: var(--ui-bg-success-soft, #e7f6ed); }
.ecom-admin-load-more-products { width: fit-content; margin-top: 8px; }""",
        'add visible search results styles'
    )
    css = replace_once(
        css,
        """  .ecom-admin-stock-alert { padding: 12px; }
}""",
        """  .ecom-admin-stock-alert { padding: 12px; }
  .ecom-admin-product-search-results { max-height: min(46vh, 360px); padding: 6px; }
  .ecom-admin-product-search-result { align-items: flex-start; min-height: 56px; padding: 11px; }
  .ecom-admin-product-search-result-status { max-width: 42%; }
}""",
        'add mobile search result styles'
    )
    css_path.write_text(css, encoding='utf-8')

    lifecycle_path = Path('src/components/ecommerce/__tests__/EcommerceProductPublishModal.catalogLifecycle.test.jsx')
    lifecycle = lifecycle_path.read_text(encoding='utf-8')
    extra_tests = r'''

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
'''
    if lifecycle.count("\n});\n") < 1:
        raise SystemExit('catalog lifecycle closing marker not found')
    lifecycle = lifecycle.rsplit('\n});\n', 1)[0] + extra_tests + '\n});\n'
    lifecycle_path.write_text(lifecycle, encoding='utf-8')

    integration_path = Path('src/components/ecommerce/__tests__/EcommercePortalSettings.productModalLifecycle.test.jsx')
    integration = integration_path.read_text(encoding='utf-8')
    integration = replace_once(
        integration,
        """    expect(screen.getByRole('option', { name: /Producto Uno/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
  });
""",
        """    expect(screen.getByRole('option', { name: /Producto Uno/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
    const visibleResult = screen.getByRole('button', { name: 'Seleccionar Producto Dos' });
    expect(visibleResult).toBeInTheDocument();
    expect(visibleResult).toHaveTextContent('$40.00');
    fireEvent.click(visibleResult);
    expect(getProductSelect().value).toBe(productTwo.id);
    expect(screen.getByDisplayValue(productTwo.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productTwo.price))).toBeInTheDocument();
  });
""",
        'make FREE/PRO integration assert visible clickable result'
    )
    integration = replace_once(
        integration,
        """    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();

    await act(async () => {
      firstSearch.resolve({ data: [staleProduct], nextCursor: null });
      await Promise.resolve();
    });

    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Producto Stale/ })).toBeNull();
  });
""",
        """    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seleccionar Producto Dos' })).toBeInTheDocument();

    await act(async () => {
      firstSearch.resolve({ data: [staleProduct], nextCursor: null });
      await Promise.resolve();
    });

    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seleccionar Producto Dos' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Producto Stale/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Seleccionar Producto Stale' })).toBeNull();
  });
""",
        'assert stale search visual results'
    )
    integration = replace_once(
        integration,
        """    expect(screen.queryByRole('option', { name: /Producto Stale/ })).toBeNull();
    expect(getProductSelect().value).toBe(productOne.id);
""",
        """    expect(screen.queryByRole('option', { name: /Producto Stale/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Seleccionar Producto Stale' })).toBeNull();
    expect(getProductSelect().value).toBe(productOne.id);
""",
        'assert stale load more not visible'
    )
    extra_integration_tests = r'''

  it('uses the cursor that belongs to the latest successful search term when loading more results', async () => {
    await renderCatalog();
    await openPublishModal();
    const searchInput = screen.getByPlaceholderText('Buscar por nombre, código o SKU');

    productRepository.listProductsPage.mockResolvedValueOnce({
      data: [{ ...productOne, id: 'coca-1', name: 'Coca Uno' }],
      nextCursor: 'cursor-coca'
    });
    fireEvent.change(searchInput, { target: { value: 'coca' } });
    await act(async () => delay(275));
    await screen.findByRole('button', { name: 'Seleccionar Coca Uno' });

    productRepository.listProductsPage.mockResolvedValueOnce({
      data: [{ ...productTwo, id: 'pepsi-1', name: 'Pepsi Uno' }],
      nextCursor: 'cursor-pepsi'
    });
    fireEvent.change(searchInput, { target: { value: 'pepsi' } });
    await act(async () => delay(275));
    await screen.findByRole('button', { name: 'Seleccionar Pepsi Uno' });

    productRepository.listProductsPage.mockResolvedValueOnce({
      data: [{ ...productTwo, id: 'pepsi-2', name: 'Pepsi Dos' }],
      nextCursor: null
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más resultados' }));
    await screen.findByRole('button', { name: 'Seleccionar Pepsi Dos' });

    expect(productRepository.listProductsPage).toHaveBeenLastCalledWith(expect.objectContaining({
      searchTerm: 'pepsi',
      cursor: 'cursor-pepsi'
    }));
    expect(screen.getByRole('button', { name: 'Seleccionar Pepsi Uno' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seleccionar Pepsi Dos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Seleccionar Coca Uno' })).toBeNull();
  });

  it('appends the next page of the same active search without duplicates', async () => {
    await renderCatalog();
    await openPublishModal();
    const searchInput = screen.getByPlaceholderText('Buscar por nombre, código o SKU');
    const cocaOne = { ...productOne, id: 'coca-1', name: 'Coca Uno' };
    const cocaTwo = { ...productTwo, id: 'coca-2', name: 'Coca Dos' };

    productRepository.listProductsPage.mockResolvedValueOnce({ data: [cocaOne], nextCursor: 'cursor-coca-2' });
    fireEvent.change(searchInput, { target: { value: 'coca' } });
    await act(async () => delay(275));
    await screen.findByRole('button', { name: 'Seleccionar Coca Uno' });

    productRepository.listProductsPage.mockResolvedValueOnce({ data: [cocaOne, cocaTwo], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más resultados' }));
    await screen.findByRole('button', { name: 'Seleccionar Coca Dos' });

    expect(productRepository.listProductsPage).toHaveBeenLastCalledWith(expect.objectContaining({
      searchTerm: 'coca',
      cursor: 'cursor-coca-2'
    }));
    expect(screen.getAllByRole('button', { name: 'Seleccionar Coca Uno' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Seleccionar Coca Dos' })).toHaveLength(1);
  });

  it('restores the opening catalog when the user explicitly clears an active search', async () => {
    await renderCatalog();
    await openPublishModal();
    const searchInput = screen.getByPlaceholderText('Buscar por nombre, código o SKU');

    productRepository.listProductsPage.mockResolvedValueOnce({ data: [productTwo], nextCursor: null });
    fireEvent.change(searchInput, { target: { value: 'dos' } });
    await act(async () => delay(275));
    await screen.findByRole('button', { name: 'Seleccionar Producto Dos' });

    productRepository.listProductsPage.mockResolvedValueOnce({ data: [productOne], nextCursor: 'cursor-2' });
    fireEvent.change(searchInput, { target: { value: '' } });
    await act(async () => delay(275));

    expect(productRepository.listProductsPage).toHaveBeenLastCalledWith(expect.objectContaining({
      searchTerm: '',
      cursor: null
    }));
    expect(screen.queryByRole('region', { name: 'Resultados de búsqueda' })).toBeNull();
    expect(screen.getByRole('option', { name: /Producto Uno/ })).toBeInTheDocument();
  });
'''
    integration = integration.rsplit('\n});\n', 1)[0] + extra_integration_tests + '\n});\n'
    integration_path.write_text(integration, encoding='utf-8')

    legacy_test_path = Path('src/services/db/__tests__/loadDataPaginatedLegacySearch.test.js')
    legacy_test_path.write_text("""// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db, STORES } from '../dexie';
import { loadDataPaginated } from '../index';
import { closeTestTenantRuntime, openTestTenantRuntime } from '../../../test/tenantRuntimeTestHarness';

beforeEach(async () => {
  await openTestTenantRuntime();
  await db.table(STORES.MENU).clear();
});

afterEach(() => {
  closeTestTenantRuntime();
});

describe('loadDataPaginated legacy product search compatibility', () => {
  it('finds an active legacy product without createdAt when searchTerm is active and cursor is empty', async () => {
    await db.table(STORES.MENU).put({
      id: 'legacy-search-product',
      name: 'Producto Legacy Buscable',
      isActive: true,
      createdAt: undefined
    });

    const page = await loadDataPaginated(STORES.MENU, {
      searchTerm: 'legacy',
      status: 'active'
    });

    expect(page.data.map((product) => product.id)).toContain('legacy-search-product');
    expect(page.data.find((product) => product.id === 'legacy-search-product')).toMatchObject({
      name: 'Producto Legacy Buscable',
      isActive: true
    });
  });
});
""", encoding='utf-8')


def patch_db_search():
    db_path = Path('src/services/db/index.js')
    db_text = db_path.read_text(encoding='utf-8')
    db_text = replace_once(
        db_text,
        """            } else {
                // Con searchTerm y sin cursor: full scan para no excluir registros
                // con createdAt undefined que orderBy sí omite
                baseCollection = db.table(STORES.MENU).orderBy(timeIndex).reverse();
            }
""",
        """            } else {
                // Con searchTerm y sin cursor: full scan para no excluir registros
                // con createdAt undefined que orderBy sí omite.
                // Esta rama es deliberadamente acotada: no cambia paginación normal,
                // filtros por categoría, stock/caducidad ni búsquedas con cursor.
                baseCollection = db.table(STORES.MENU).toCollection();
            }
""",
        'fix legacy search full scan contract'
    )
    db_path.write_text(db_text, encoding='utf-8')


mode = sys.argv[1] if len(sys.argv) > 1 else ''
if mode == 'ui-tests':
    patch_ui_and_tests()
elif mode == 'db-fix':
    patch_db_search()
else:
    raise SystemExit('usage: ecommerce_pr287_search_visibility_followup_temp.py ui-tests|db-fix')
