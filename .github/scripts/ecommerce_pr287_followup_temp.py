from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old, new, 1)


portal_path = Path('src/components/ecommerce/EcommercePortalSettings.jsx')
portal = portal_path.read_text(encoding='utf-8')

portal = replace_once(
    portal,
    "  const [localProducts, setLocalProducts] = useState([]);\n  const [localCatalogCursor, setLocalCatalogCursor] = useState(null);\n  const [localCatalogHasMore, setLocalCatalogHasMore] = useState(false);",
    "  const [localProducts, setLocalProducts] = useState([]);\n  const [localCatalogHasMore, setLocalCatalogHasMore] = useState(false);",
    'remove dead localCatalogCursor state'
)

portal = replace_once(
    portal,
    "  const catalogRequestSeqRef = useRef(0);\n  const catalogSessionRef = useRef(0);",
    "  const catalogRequestSeqRef = useRef(0);\n  const latestRequestByKindRef = useRef({\n    opening: 0,\n    search: 0,\n    'load-more': 0\n  });\n  const catalogSessionRef = useRef(0);",
    'add per-kind request ownership'
)

portal = replace_once(
    portal,
    "    const requestId = ++catalogRequestSeqRef.current;\n    const setRequestLoading = (value) => {",
    "    const requestId = ++catalogRequestSeqRef.current;\n    const requestKindId = (latestRequestByKindRef.current[requestKind] || 0) + 1;\n    latestRequestByKindRef.current[requestKind] = requestKindId;\n    const setRequestLoading = (value) => {",
    'register per-kind request id'
)

portal = replace_once(
    portal,
    "      const nextCursor = page.nextCursor || null;\n      localCatalogCursorRef.current = nextCursor;\n      setLocalCatalogCursor(nextCursor);\n      setLocalCatalogHasMore(Boolean(nextCursor) && pageProducts.length > 0);",
    "      const nextCursor = page.nextCursor || null;\n      localCatalogCursorRef.current = nextCursor;\n      setLocalCatalogHasMore(Boolean(nextCursor) && pageProducts.length > 0);",
    'remove dead cursor setter'
)

portal = replace_once(
    portal,
    "    } finally {\n      const stillCurrent = (\n        requestId === catalogRequestSeqRef.current\n        && sessionId === catalogSessionRef.current\n      );\n      if (stillCurrent) setRequestLoading(false);\n    }",
    "    } finally {\n      const stillLatestForKind = (\n        latestRequestByKindRef.current[requestKind] === requestKindId\n        && sessionId === catalogSessionRef.current\n      );\n      if (stillLatestForKind) setRequestLoading(false);\n    }",
    'release loading by request kind'
)

portal = replace_once(
    portal,
    "La portada seleccionada no tiene una URL pública válida. Intenta subirlo nuevamente.",
    "La portada seleccionada no tiene una URL pública válida. Intenta subirla nuevamente.",
    'revert accidental cover copy'
)

portal_path.write_text(portal, encoding='utf-8')

test_path = Path('src/components/ecommerce/__tests__/EcommercePortalSettings.productModalLifecycle.test.jsx')
test = test_path.read_text(encoding='utf-8')
marker = "  it('invalidates a pending request when the modal closes and starts the next opening cleanly', async () => {"
if test.count(marker) != 1:
    raise SystemExit(f'load-more/search test insertion marker: expected 1 match, found {test.count(marker)}')

new_test = """  it('releases stale load-more loading after a newer search wins the catalog race', async () => {
    await renderCatalog();
    await openPublishModal();

    fireEvent.change(getProductSelect(), {
      target: { value: productOne.id }
    });
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productOne.price))).toBeInTheDocument();

    const loadMoreRequest = deferred();
    const searchRequest = deferred();
    productRepository.listProductsPage
      .mockImplementationOnce(() => loadMoreRequest.promise)
      .mockImplementationOnce(() => searchRequest.promise);

    const loadMoreButton = screen.getByRole('button', { name: 'Cargar más productos' });
    fireEvent.click(loadMoreButton);
    expect(productRepository.listProductsPage).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Cargando productos…')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar por nombre, código o SKU'), {
      target: { value: 'producto' }
    });
    await act(async () => delay(275));
    expect(productRepository.listProductsPage).toHaveBeenCalledTimes(3);

    await act(async () => {
      searchRequest.resolve({ data: [productTwo], nextCursor: 'search-cursor' });
      await Promise.resolve();
    });

    expect(getProductSelect().value).toBe(productOne.id);
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productOne.price))).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Producto Dos/ })).toBeInTheDocument();
    expect(screen.getByText('Cargando productos…')).toBeInTheDocument();

    await act(async () => {
      loadMoreRequest.resolve({ data: [staleProduct], nextCursor: 'stale-cursor' });
      await Promise.resolve();
    });

    expect(screen.queryByRole('option', { name: /Producto Stale/ })).toBeNull();
    expect(getProductSelect().value).toBe(productOne.id);
    expect(screen.getByDisplayValue(productOne.name)).toBeInTheDocument();
    expect(screen.getByDisplayValue(String(productOne.price))).toBeInTheDocument();
    expect(screen.queryByText('Cargando productos…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cargar más productos' }).disabled).toBe(false);
  });

"""
test = test.replace(marker, new_test + marker, 1)
test_path.write_text(test, encoding='utf-8')
