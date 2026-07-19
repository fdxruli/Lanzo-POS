import PublicCatalog from '../public/PublicCatalog';

export default function EcommerceSiteCatalogSection({ section, catalogProps, chrome }) {
  return (
    <div className="public-store-content" data-site-section="catalog" data-site-layout={section.layout}>
      {chrome}
      <PublicCatalog {...catalogProps} />
    </div>
  );
}
