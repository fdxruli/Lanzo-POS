import PublicCatalog from '../public/PublicCatalog';

export default function EcommerceSiteCatalogSection({ section, catalogProps, chrome }) {
  return (
    <div
      className={`public-store-content ecommerce-site-section ecommerce-site-section--catalog ecommerce-site-section--layout-${section.layout}`}
      data-site-section="catalog"
      data-site-layout={section.layout}
    >
      {chrome}
      <PublicCatalog
        {...catalogProps}
        showSearch={section.props.showSearch}
        showCategories={section.props.showCategories}
      />
    </div>
  );
}
