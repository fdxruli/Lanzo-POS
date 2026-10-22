import { useEffect } from 'react';
import { actorRuntimeController } from '../auth/actorRuntimeController';
import { attachEcomSignalQa } from './ecomSignalActorAdapter';

// Opt-in mount point for owner QA, OFF by default and never mounted globally.
export function useEcomSignalQa({ enabled = false, runtime = actorRuntimeController,
  receiver, captureCredentials, onProbe, onState, onReconcileRequired }) {
  useEffect(() => attachEcomSignalQa({ enabled, runtime, receiver, captureCredentials, onProbe, onState, onReconcileRequired }),
    [enabled, runtime, receiver, captureCredentials, onProbe, onState, onReconcileRequired]);
}
