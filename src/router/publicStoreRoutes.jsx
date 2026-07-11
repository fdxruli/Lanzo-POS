import PublicStoreErrorBoundary from '../components/ecommerce/public/PublicStoreErrorBoundary';
import PublicStoreState from '../components/ecommerce/public/PublicStoreState';
import PublicLanzoLandingPage from '../pages/PublicLanzoLandingPage';
import PublicStorePage from '../pages/PublicStorePage';

export function PublicStoreNotFoundPage() {
  return (
    <main className="public-store-shell public-store-shell--centered">
      <PublicStoreState
        type="unavailable"
        title="Esta tienda no está disponible"
        description="Abre el enlace completo que te compartió el negocio."
      />
    </main>
  );
}

export function PublicStoreRouteErrorPage() {
  return (
    <main className="public-store-shell public-store-shell--centered">
      <PublicStoreState
        type="error"
        title="No se pudo abrir la tienda"
        description="Recarga la página para intentarlo nuevamente."
        actionLabel="Recargar"
        onAction={() => window.location.reload()}
      />
    </main>
  );
}

const withPublicBoundary = (element) => (
  <PublicStoreErrorBoundary>{element}</PublicStoreErrorBoundary>
);

export const publicStoreRoutes = [
  {
    path: '/conoce-lanzo',
    element: withPublicBoundary(<PublicLanzoLandingPage />),
    errorElement: withPublicBoundary(<PublicStoreRouteErrorPage />),
  },
  {
    path: '/tienda/:slug',
    element: withPublicBoundary(<PublicStorePage />),
    errorElement: withPublicBoundary(<PublicStoreRouteErrorPage />),
  },
  {
    path: '/tienda',
    element: withPublicBoundary(<PublicStoreNotFoundPage />),
    errorElement: withPublicBoundary(<PublicStoreRouteErrorPage />),
  },
];
