import { normalizeEcommerceSiteDocument } from '../../../utils/ecommerceSiteDocument';
import EcommerceSiteHeaderSection from './EcommerceSiteHeaderSection';
import EcommerceSiteCatalogSection from './EcommerceSiteCatalogSection';
import EcommerceSiteFooterSection from './EcommerceSiteFooterSection';

export const SECTION_RENDERERS = Object.freeze({
  header: EcommerceSiteHeaderSection,
  catalog: EcommerceSiteCatalogSection,
  footer: EcommerceSiteFooterSection
});

export default function EcommerceSiteRenderer({
  siteDocument,
  siteDocumentMode = 'default',
  portal,
  products,
  categories,
  hours,
  availability,
  features,
  mode = 'public',
  slug,
  catalogProps = {},
  catalogChrome = null
}) {
  const document = normalizeEcommerceSiteDocument(siteDocument, {
    templateCode: portal?.templateCode
  });
  const renderMode = ['public', 'preview', 'editor'].includes(mode) ? mode : 'public';
  const documentMode = siteDocumentMode === 'custom' ? 'custom' : 'default';

  return (
    <div
      data-site-mode={renderMode}
      data-site-document-mode={documentMode}
      data-site-density={document.global.density}
    >
      {document.sections.filter((section) => section.enabled).map((section) => {
        const Section = SECTION_RENDERERS[section.type];
        if (!Section) return null;
        return (
          <Section
            key={section.id}
            section={section}
            portal={portal}
            products={products}
            categories={categories}
            hours={hours}
            availability={availability}
            features={features}
            slug={slug}
            catalogProps={catalogProps}
            chrome={catalogChrome}
          />
        );
      })}
    </div>
  );
}

export const getRenderableEcommerceSiteDocument = (document, portal) => normalizeEcommerceSiteDocument(
  document,
  { templateCode: portal?.templateCode }
);
