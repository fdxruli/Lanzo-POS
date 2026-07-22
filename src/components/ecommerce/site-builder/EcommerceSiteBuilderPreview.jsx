import { Monitor, Smartphone } from 'lucide-react';
import EcommerceSiteRenderer from '../site/EcommerceSiteRenderer';

const EMPTY_CATALOG = {
  products: [], filteredProducts: [], categories: [], searchTerm: '', selectedCategory: 'all',
  onSearchChange: () => {}, onCategoryChange: () => {}, onAdd: () => {}, onRetry: () => {}, onLoadMore: () => {},
  isLoading: false, error: null, hasMore: false, isLoadingMore: false
};

export default function EcommerceSiteBuilderPreview({ document, viewport, onViewport, portal }) {
  return (
    <section className="ecom-builder-preview" aria-labelledby="ecom-builder-preview-title">
      <div className="ecom-admin-card-heading"><div><span className="ecom-admin-eyebrow">Borrador local</span><h3 id="ecom-builder-preview-title">Vista previa</h3><p>Los cambios de esta vista previa no serán visibles para tus clientes hasta guardar y publicar.</p></div></div>
      <div className="ecom-builder-choice-row" aria-label="Tamaño de vista previa"><button type="button" className="btn btn-secondary" aria-pressed={viewport === 'desktop'} onClick={() => onViewport('desktop')}><Monitor size={16} />Escritorio</button><button type="button" className="btn btn-secondary" aria-pressed={viewport === 'mobile'} onClick={() => onViewport('mobile')}><Smartphone size={16} />Móvil</button></div>
      <div className={`ecom-builder-preview-frame is-${viewport}`} aria-label="Vista previa inerte del sitio"><div className="ecom-builder-preview-inert" inert><EcommerceSiteRenderer siteDocument={document} siteDocumentMode="custom" portal={portal} products={[]} categories={[]} mode="editor" slug={portal?.slug || ''} catalogProps={EMPTY_CATALOG} /></div></div>
    </section>
  );
}
