import NoPermission from './NoPermission';
import { canReadSalesReports } from '../../services/auth/salesPermissionPolicy';
import { useActorAccess } from '../../services/auth/useActorAccess';

export default function SalesReportsRoute({ children }) {
  const { runtimeSnapshot } = useActorAccess();
  return canReadSalesReports(runtimeSnapshot || {}) ? children : <NoPermission />;
}
