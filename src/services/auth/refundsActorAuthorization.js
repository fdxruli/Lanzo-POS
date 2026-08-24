import { actorRuntimeController } from './actorRuntimeController';
import {
  runTrackedActorOperationIfGranted,
  runTrackedActorOperationWithHandle
} from './actorOperationalHandoff';
import { SALES_REFUNDS_PERMISSION } from './salesPermissionPolicy';

export const captureRefundsActorHandle = () => (
  actorRuntimeController.capture(SALES_REFUNDS_PERMISSION)
);

export const runRefundsActorOperation = ({
  actorHandle = null,
  label,
  operation
} = {}) => {
  if (actorHandle) {
    return runTrackedActorOperationWithHandle(
      actorHandle,
      label,
      operation,
      SALES_REFUNDS_PERMISSION
    );
  }

  return runTrackedActorOperationIfGranted(
    label,
    operation,
    SALES_REFUNDS_PERMISSION
  );
};

export default Object.freeze({
  captureRefundsActorHandle,
  runRefundsActorOperation
});
