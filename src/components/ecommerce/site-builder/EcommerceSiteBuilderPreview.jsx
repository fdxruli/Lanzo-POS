import { useMemo } from 'react';
import { Monitor, Smartphone } from 'lucide-react';
import { buildEcommercePortalThemeStyle } from '../../../utils/ecommercePortalTheme';
import { buildEcommerceSiteBuilderPreviewCatalog } from '../../../utils/ecommerceSiteBuilderPreview';
import EcommerceSiteRenderer from '../site/EcommerceSiteRenderer';
import '../../../pages/PublicStorePage.css';

const noop = () => {};
const EMPTY_PREVIEW_PRODUCTS = Object.freeze([]);

export default function EcommerceSiteBuilderPreview({ document, viewport, onViewport, portal, previewProducts = EMPTY_PREVIEW_PRODUCTS }) {
  const previewCatalog = useMemo(
    () => buildEcommerceSiteBuilderPreviewCatalog(previewProducts),
    [previewProducts]
  );
  const themeStyle = useMemo(() => buildEcommercePortalThemeStyle(portal?.theme), [portal?.theme]);
  const catalogProps = useMemo(() => ({
    products: previewCatalog.products,
    filteredProducts: previewCatalog.products,
    categories: previewCatalog.categories,
    searchTerm: '',
    selectedCategory: 'all',
    onSearchChange: noop,
    onCategoryChange: noop,
    onAdd: noop,
    onRetry: noop,
    onLoadMore: noop,
    isLoading: false,
    error: null,
    hasMore: false,
    isLoadingMore: false
  }), [previewCatalog]);

  return (
    <section className="ecom-builder-preview" aria-labelledby="ecom-builder-preview-title">
      <div className="ecom-admin-card-heading"><div><span className="ecom-admin-eyebrow">Borrador local</span><h3 id="ecom-builder-preview-title">Vista previa</h3><p>Los cambios de esta vista previa no serán visibles para tus clientes hasta guardar y publicar.</p></div></div>
      <div className="ecom-builder-choice-row" aria-label="Tamaño de vista previa"><button type="button" className="btn btn-secondary" aria-pressed={viewport === 'desktop'} onClick={() => onViewport('desktop')}><Monitor size={16} />Escritorio</button><button type="button" className="btn btn-secondary" aria-pressed={viewport === 'mobile'} onClick={() => onViewport('mobile')}><Smartphone size={16} />Móvil</button></div>
      <div className={`ecom-builder-preview-frame is-${viewport}`} aria-label="Vista previa inerte del sitio">
        <div className="ecommerce-site-surface ecom-builder-preview-inert" data-preview-source={previewCatalog.usesExamples ? 'examples' : 'published'} style={themeStyle} inert>
          <EcommerceSiteRenderer siteDocument={document} siteDocumentMode="custom" portal={portal} products={previewCatalog.products} categories={previewCatalog.categories} mode="editor" slug={portal?.slug || ''} catalogProps={catalogProps} />
        </div>
      </div>
    </section>
  );
}
