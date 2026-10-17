import { useLocation, useNavigate } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary';
import AdminIncidentNotice from './AdminIncidentNotice';

export default function AdminRouteRecoveryRegion({ children }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <AdminIncidentNotice />
      <ErrorBoundary resetKey={pathname} navigateToPos={navigate}
        recoverySurface={pathname === '/ventas' ? 'sales' : 'section'}>
        {children}
      </ErrorBoundary>
    </>
  );
}
