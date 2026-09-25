import { useMemo } from 'react';
import EcommerceSiteVisualSurface from '../site/EcommerceSiteVisualSurface';
import { createDefaultEcommerceSiteDocument } from '../../../utils/ecommerceSiteDocument';
import PublicStoreState from './PublicStoreState';

function PublicStoreStatusScreen(props) {
  const siteDocument = useMemo(() => createDefaultEcommerceSiteDocument(), []);

  return (
    <main className="public-store-shell ecommerce-site-surface public-store-shell--centered public-store-status-page">
      <EcommerceSiteVisualSurface
        siteDocument={siteDocument}
        mode="public"
        className="public-store-status-surface"
      >
        <PublicStoreState {...props} />
      </EcommerceSiteVisualSurface>
    </main>
  );
}

export default PublicStoreStatusScreen;
