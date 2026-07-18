import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import EcommercePortalSettings from '../components/ecommerce/EcommercePortalSettings';

export default function EcommercePortalPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedFocus = searchParams.get('focus');

  useEffect(() => {
    if (requestedFocus !== 'products') return undefined;

    let completed = false;
    const focusProducts = () => {
      if (completed) return;
      const target = document.getElementById('ecommerce-published-products');
      if (!target) return;

      completed = true;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.focus({ preventScroll: true });

      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('focus');
      setSearchParams(nextParams, { replace: true });
    };

    focusProducts();
    if (completed || typeof MutationObserver === 'undefined') return undefined;

    const observer = new MutationObserver(focusProducts);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      completed = true;
      observer.disconnect();
    };
  }, [requestedFocus, searchParams, setSearchParams]);

  return (
    <main className="ui-page ecommerce-portal-page" aria-label="Portal online">
      <EcommercePortalSettings />
    </main>
  );
}
