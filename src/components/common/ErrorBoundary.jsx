import { useAppStore } from '../../store/useAppStore';
import { captureIncident } from '../../services/diagnostics/incidentCapture';
import { createRecoveryContextGuard } from '../../services/diagnostics/recoveryContext';
import { getActorCheckoutOwnerships, getPendingActorOperations } from '../../services/auth/actorOperationalHandoff';
import IncidentErrorBoundary from './IncidentErrorBoundary';

const runtime = Object.freeze({
  appStore: useAppStore,
  captureIncident,
  createRecoveryContextGuard,
  areActorOperationsIdle: () => {
    try {
      return getActorCheckoutOwnerships().length === 0 && getPendingActorOperations().length === 0;
    } catch {
      return false;
    }
  }
});

// Production and the isolated lab run the same boundary implementation.
// Only this production wrapper imports the commercial runtime.
export class ErrorBoundary extends IncidentErrorBoundary {
  constructor(props) {
    super({ ...props, runtime });
  }
}
export default ErrorBoundary;
