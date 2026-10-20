const sameSnapshot = (left, right) => (
  left?.actorStatus === right?.actorStatus
  && left?.actorKey === right?.actorKey
  && left?.sessionId === right?.sessionId
  && left?.actorGeneration === right?.actorGeneration
  && left?.tenantReady === right?.tenantReady
  && left?.tenantOpaqueId === right?.tenantOpaqueId
  && left?.tenantDatabaseName === right?.tenantDatabaseName
  && left?.tenantGeneration === right?.tenantGeneration
);

/**
 * Captures actor/session and tenant generations in memory for recovery guards.
 * The values are never serialized into support reports or console entries.
 */
export const createContextSnapshotGuard = ({
  capture,
  compare = sameSnapshot
} = {}) => {
  let captured;
  try {
    captured = capture();
  } catch {
    captured = null;
  }

  return () => {
    if (!captured) return false;
    try {
      return compare(captured, capture());
    } catch {
      return false;
    }
  };
};
