import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Layers3, RefreshCw } from 'lucide-react';
import {
  BATCH_DIRECTORY_PAGE_SIZE,
  queryBatchProductDirectoryPage
} from '../../../services/products/batchProductDirectory';
import Logger from '../../../services/Logger';

export default function BatchProductDirectory({ onSelectProduct }) {
  const [products, setProducts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const mountedRef = useRef(false);
  const fetchingRef = useRef(false);

  const loadPage = useCallback(async (reset = false) => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    if (reset) setLoading(true);
    else setLoadingMore(true);
    setError(false);

    try {
      const page = await queryBatchProductDirectoryPage({
        cursor: reset ? null : cursor,
        pageSize: BATCH_DIRECTORY_PAGE_SIZE
      });
      if (!mountedRef.current) return;
      setProducts((current) => {
        if (reset) return page.items;
        const byId = new Map(current.map((item) => [item.id, item]));
        page.items.forEach((item) => byId.set(item.id, item));
        return [...byId.values()];
      });
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (reason) {
      Logger.error('No se pudieron consultar productos con lotes:', reason);
      if (mountedRef.current) setError(true);
    } finally {
      fetchingRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [cursor]);

  useEffect(() => {
    mountedRef.current = true;
    // La lista es una vista de descubrimiento; no abre consultas por cada producto.
    void loadPage(true);
    return () => { mountedRef.current = false; };
    // Solo al montar: cambiar el cursor no debe reiniciar la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="batch-directory" aria-labelledby="batch-directory-title">
      <div className="batch-directory-heading">
        <div>
          <h3 id="batch-directory-title">Productos con lotes</h3>
          <p>Elige un producto para consultar existencias, variantes e historial.</p>
        </div>
        <span className="batch-directory-count" aria-label="Productos mostrados">
          {products.length} mostrados
        </span>
      </div>

      {loading && (
        <p className="batch-state-message" role="status">Cargando productos con lotes...</p>
      )}

      {!loading && products.length === 0 && !error && (
        <div className="batch-directory-empty">
          <Layers3 size={30} aria-hidden="true" />
          <strong>No hay productos con lotes disponibles en este dispositivo</strong>
          <p>Busca un producto para registrar su primer ingreso. En PRO/Nube, comprueba que la sincronización haya terminado si faltan productos.</p>
        </div>
      )}

      {products.length > 0 && (
        <div className="batch-directory-list" role="list" aria-label="Productos con lotes registrados">
          {products.map((product) => (
            <div role="listitem" key={product.id} className="batch-directory-item">
              <button
                type="button"
                className="batch-directory-product"
                onClick={() => onSelectProduct(product)}
                aria-label={`Consultar lotes de ${product.name}`}
              >
                <span className="batch-directory-product-icon" aria-hidden="true"><Layers3 size={18} /></span>
                <span className="batch-directory-product-text">
                  <strong>{product.name}</strong>
                  <small>{product.sku ? `SKU: ${product.sku}` : 'Con historial de lotes'}</small>
                </span>
                <span className="batch-directory-product-action">Ver lotes <ChevronRight size={17} aria-hidden="true" /></span>
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="batch-directory-error" role="alert">
          <p>No se pudo cargar esta lista. Puedes seguir buscando productos arriba.</p>
          <button type="button" className="ui-button ui-button--secondary ui-button--sm" onClick={() => loadPage(products.length === 0)}>
            Reintentar
          </button>
        </div>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          className="ui-button ui-button--secondary batch-directory-more"
          onClick={() => loadPage(false)}
          disabled={loadingMore}
          aria-busy={loadingMore}
        >
          <RefreshCw size={16} className={loadingMore ? 'icon-spin' : ''} aria-hidden="true" />
          {loadingMore ? 'Cargando...' : 'Ver más productos'}
        </button>
      )}
    </section>
  );
}
