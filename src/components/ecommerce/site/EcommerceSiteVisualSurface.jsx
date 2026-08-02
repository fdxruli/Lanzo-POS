import { normalizeEcommerceSiteDocument } from '../../../utils/ecommerceSiteDocument';
import { buildEcommerceSiteDesignStyle } from '../../../utils/ecommercePortalTheme';

const normalizeMode = (mode) => ['public', 'preview', 'editor'].includes(mode) ? mode : 'public';

export default function EcommerceSiteVisualSurface({
  siteDocument,
  siteDocumentMode = 'default',
  portal,
  mode = 'public',
  className = '',
  children
}) {
  const document = normalizeEcommerceSiteDocument(siteDocument, {
    templateCode: portal?.templateCode,
    theme: portal?.theme,
    logoUrl: portal?.logoUrl,
    coverImageUrl: portal?.coverImageUrl
  });
  const renderMode = normalizeMode(mode);
  const documentMode = siteDocumentMode === 'custom' ? 'custom' : 'default';
  const designTokens = buildEcommerceSiteDesignStyle({
    theme: document.global.appearance.theme,
    templateCode: document.global.appearance.templateCode,
    density: document.global.density,
    contentWidth: document.global.contentWidth
  });

  return (
    <div
      className={`ecommerce-site-visual-surface ${className}`.trim()}
      data-site-mode={renderMode}
      data-site-document-mode={documentMode}
      data-site-template={document.global.appearance.templateCode}
      data-site-density={document.global.density}
      data-site-content-width={document.global.contentWidth}
      style={designTokens}
    >
      {children}
    </div>
  );
}
