import { Navigate } from 'react-router-dom';
import { ADMIN_ROUTE_PATHS } from './adminRoutePaths';

export const ADMIN_ROUTE_ALIASES = Object.freeze({
  [ADMIN_ROUTE_PATHS.reportsAlias]: `/${ADMIN_ROUTE_PATHS.sales}`,
  [ADMIN_ROUTE_PATHS.layawaysAlias]: `/${ADMIN_ROUTE_PATHS.customers}`
});

export function AdminRouteAlias({ to }) {
  return <Navigate to={to} replace />;
}
