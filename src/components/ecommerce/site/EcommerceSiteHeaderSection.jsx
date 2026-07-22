import PublicStoreHeader from '../public/PublicStoreHeader';

export default function EcommerceSiteHeaderSection({ portal, hours, availability, section }) {
  return (
    <div
      className={`ecommerce-site-section ecommerce-site-section--header ecommerce-site-section--layout-${section.layout}`}
      data-site-section="header"
      data-site-layout={section.layout}
    >
      <PublicStoreHeader portal={portal} hours={hours} availability={availability} />
    </div>
  );
}
