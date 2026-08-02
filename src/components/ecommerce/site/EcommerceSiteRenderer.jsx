import { normalizeEcommerceSiteDocument } from '../../../utils/ecommerceSiteDocument';
import EcommerceSiteVisualSurface from './EcommerceSiteVisualSurface';
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
  catalogChrome = null,
  children = null
}) {
  const document = normalizeEcommerceSiteDocument(siteDocument, {
    templateCode: portal?.templateCode, theme: portal?.theme,
    logoUrl: portal?.logoUrl, coverImageUrl: portal?.coverImageUrl
  });
  const renderedPortal = {
    ...portal,
    templateCode: document.global.appearance.templateCode,
    theme: document.global.appearance.theme,
    logoUrl: document.global.appearance.branding.logoUrl,
    coverImageUrl: document.global.appearance.branding.coverImageUrl
  };

  return (
    <EcommerceSiteVisualSurface
      siteDocument={document}
      siteDocumentMode={siteDocumentMode}
      portal={portal}
      mode={mode}
      className={`ecommerce-site-renderer ecommerce-site-renderer--density-${document.global.density}`}
    >
      {document.sections.filter((section) => section.enabled).map((section) => {
        const Section = SECTION_RENDERERS[section.type];
        if (!Section) return null;
        return (
          <Section
            key={section.id}
            section={section}
            portal={renderedPortal}
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
      {children}
    </EcommerceSiteVisualSurface>
  );
}

export const getRenderableEcommerceSiteDocument = (document, portal) => normalizeEcommerceSiteDocument(document, {
  templateCode: portal?.templateCode, theme: portal?.theme,
  logoUrl: portal?.logoUrl, coverImageUrl: portal?.coverImageUrl
});
