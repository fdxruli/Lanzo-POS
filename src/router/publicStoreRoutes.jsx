import PublicStoreErrorBoundary from '../components/ecommerce/public/PublicStoreErrorBoundary';
import PublicStoreStatusScreen from '../components/ecommerce/public/PublicStoreStatusScreen';
import PublicLanzoLandingPage from '../pages/PublicLanzoLandingPage';
import PublicOrderTrackingPage from '../pages/PublicOrderTrackingPage';
import PublicStorePage from '../pages/PublicStorePage';

export function PublicStoreNotFoundPage() {
  return (
    <PublicStoreStatusScreen
      type="unavailable"
      title="Esta tienda no está disponible"
      description="Abre el enlace completo que te compartió el negocio."
    />
  );
}

export function PublicStoreRouteErrorPage() {
  return (
    <PublicStoreStatusScreen
      type="error"
      title="No se pudo abrir la tienda"
      description="Recarga la página para intentarlo nuevamente."
      actionLabel="Recargar"
      onAction={() => window.location.reload()}
    />
  );
}

const withPublicBoundary = (element) => (
  <PublicStoreErrorBoundary>{element}</PublicStoreErrorBoundary>
);

export const publicStoreRoutes = [
  {
    path: '/conoce-lanzo',
    element: withPublicBoundary(<PublicLanzoLandingPage />),
    errorElement: withPublicBoundary(<PublicStoreRouteErrorPage />)
  },
  {
    path: '/tienda/:slug/pedido/:trackingToken',
    element: withPublicBoundary(<PublicOrderTrackingPage />),
    errorElement: withPublicBoundary(<PublicStoreRouteErrorPage />)
  },
  {
    path: '/tienda/:slug',
    element: withPublicBoundary(<PublicStorePage />),
    errorElement: withPublicBoundary(<PublicStoreRouteErrorPage />)
  },
  {
    path: '/tienda',
    element: withPublicBoundary(<PublicStoreNotFoundPage />),
    errorElement: withPublicBoundary(<PublicStoreRouteErrorPage />)
  },
  {
    path: '*',
    element: withPublicBoundary(<PublicStoreNotFoundPage />),
    errorElement: withPublicBoundary(<PublicStoreRouteErrorPage />)
  }
];
