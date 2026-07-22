import PublicStoreHeader from '../public/PublicStoreHeader';

export default function EcommerceSiteHeaderSection({ portal, hours, availability, section }) {
  return (
    <div data-site-section="header" data-site-layout={section.layout}>
      <PublicStoreHeader portal={portal} hours={hours} availability={availability} />
    </div>
  );
}
