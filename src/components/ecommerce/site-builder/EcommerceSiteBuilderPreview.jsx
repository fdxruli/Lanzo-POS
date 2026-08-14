import { useEffect, useMemo, useRef, useState } from 'react';
import { buildEcommerceSiteBuilderPreviewCatalog } from '../../../utils/ecommerceSiteBuilderPreview';
import EcommerceSiteRenderer from '../site/EcommerceSiteRenderer';
import '../../../pages/PublicStorePage.css';

const noop = () => {};
const VIEWPORT_WIDTHS = Object.freeze({ mobile: 390, desktop: 1280 });

const getViewportWidth = (viewport) => VIEWPORT_WIDTHS[viewport] || VIEWPORT_WIDTHS.desktop;

export default function EcommerceSiteBuilderPreview({ document, portal, viewport = 'desktop' }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const [metrics, setMetrics] = useState({ scale: 1, height: 0 });
  const viewportWidth = getViewportWidth(viewport);
  const previewCatalog = useMemo(() => buildEcommerceSiteBuilderPreviewCatalog(), []);
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

  useEffect(() => {
    const updateMetrics = () => {
      const availableWidth = stageRef.current?.clientWidth || 0;
      const scale = availableWidth > 0 ? Math.min(1, availableWidth / viewportWidth) : 1;
      const height = canvasRef.current?.scrollHeight || 0;
      setMetrics((current) => (
        current.scale === scale && current.height === height ? current : { scale, height }
      ));
    };

    updateMetrics();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMetrics);
    if (observer) {
      if (stageRef.current) observer.observe(stageRef.current);
      if (canvasRef.current) observer.observe(canvasRef.current);
    }
    window.addEventListener('resize', updateMetrics);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateMetrics);
    };
  }, [document, viewportWidth]);

  useEffect(() => {
    if (stageRef.current) stageRef.current.scrollTop = 0;
  }, [viewport]);

  const scaledCanvasStyle = {
    width: `${viewportWidth * metrics.scale}px`,
    minHeight: metrics.height ? `${metrics.height * metrics.scale}px` : undefined
  };

  return (
    <div className="ecom-builder-preview-stage" ref={stageRef} aria-label="Vista previa inerte del sitio">
      <div className="ecom-builder-preview-canvas-shell" style={scaledCanvasStyle}>
        <div
          className="ecommerce-site-surface ecom-builder-preview-inert"
          data-preview-source={previewCatalog.usesExamples ? 'examples' : 'published'}
          data-preview-viewport={viewport}
          inert
          ref={canvasRef}
          style={{ width: `${viewportWidth}px`, transform: `scale(${metrics.scale})` }}
        >
          <EcommerceSiteRenderer
            siteDocument={document}
            siteDocumentMode="custom"
            portal={portal}
            products={previewCatalog.products}
            categories={previewCatalog.categories}
            mode="preview"
            slug={portal?.slug || ''}
            catalogProps={catalogProps}
          />
        </div>
      </div>
    </div>
  );
}

export const ecommerceSiteBuilderPreviewInternals = Object.freeze({
  VIEWPORT_WIDTHS,
  getViewportWidth
});
