import NoPermission from './NoPermission';
import { canReadSalesReports } from '../../services/auth/salesPermissionPolicy';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';

export default function SalesReportsRoute({ children }) {
  const actorRuntime = useActorRuntimeSnapshot();
  return canReadSalesReports(actorRuntime) ? children : <NoPermission />;
}
