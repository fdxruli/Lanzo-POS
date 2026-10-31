import { useCallback, useMemo, useState } from 'react';
import { actorRuntimeController } from '../../../services/auth/actorRuntimeController';
import {
  getActorSessionToken,
  getDeviceSecurityToken,
  getStableDeviceId,
  supabaseClient
} from '../../../services/supabase';
import { createEcomSignalReceiver, createEcomSignalBrokerClient, createEcomSignalTransport } from '../../../services/ecommerce/ecomSignalReceiver';
import { useEcomSignalQa } from '../../../services/ecommerce/useEcomSignalQa';
import { useAppStore } from '../../../store/useAppStore';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_STATES = new Set(['authorizing', 'connected', 'denied', 'expired', 'retrying', 'stopped']);
const SAFE_RECONCILE_REASONS = new Set(['topic_changed', 'reconnected']);

const safeShortRef = value => typeof value === 'string' && UUID_PATTERN.test(value)
  ? value.slice(0, 8)
  : null;

function createQaReceiver() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publicKey || !supabaseClient) return null;
  const broker = createEcomSignalBrokerClient({
    endpoint: `${url.replace(/\/$/, '')}/functions/v1/lanzo-ecom-bridge-qa`,
    publicKey
  });
  return createEcomSignalReceiver({
    broker,
    createTransport: createEcomSignalTransport
  });
}

export default function EcommerceOrdersRealtimeQa({ enabled, licenseKey, adminDiagnostic = false }) {
  const [status, setStatus] = useState('stopped');
  const [grantRef, setGrantRef] = useState(null);
  const [lastProbe, setLastProbe] = useState(null);
  const [lastReconcile, setLastReconcile] = useState(null);
  const receiver = useMemo(() => createQaReceiver(), []);

  const captureCredentials = useCallback(async handle => {
    handle.assertCurrent('ecommerce');
    const currentLicenseKey = useAppStore.getState().licenseDetails?.license_key;
    if (!licenseKey || currentLicenseKey !== licenseKey) throw new Error('LICENSE_CONTEXT_CHANGED');
    const [actorSessionToken, deviceFingerprint, securityToken] = await Promise.all([
      getActorSessionToken(handle.actorType),
      getStableDeviceId(),
      getDeviceSecurityToken()
    ]);
    handle.assertCurrent('ecommerce');
    if (useAppStore.getState().licenseDetails?.license_key !== licenseKey) throw new Error('LICENSE_CONTEXT_CHANGED');
    if (!actorSessionToken || !deviceFingerprint || !securityToken) throw new Error('QA_CREDENTIALS_UNAVAILABLE');
    return {
      sessionId: handle.sessionId,
      capture: {
        license_key: licenseKey,
        device_fingerprint: deviceFingerprint,
        security_token: securityToken,
        actor_session_token: actorSessionToken
      }
    };
  }, [licenseKey]);

  const onState = useCallback((nextStatus, detail = {}) => {
    setStatus(SAFE_STATES.has(nextStatus) ? nextStatus : 'stopped');
    if (nextStatus === 'connected') setGrantRef(safeShortRef(detail?.grantId));
    if (nextStatus === 'denied' || nextStatus === 'expired' || nextStatus === 'stopped') setGrantRef(null);
  }, []);

  const onProbe = useCallback(probe => {
    const probeRef = safeShortRef(probe?.probe_id);
    if (!probeRef) return;
    setLastProbe({ probeRef, receivedAt: new Date().toISOString() });
  }, []);

  const onReconcileRequired = useCallback(detail => {
    if (!SAFE_RECONCILE_REASONS.has(detail?.reason)) return;
    setLastReconcile(detail.reason);
  }, []);

  useEcomSignalQa({
    enabled: Boolean(enabled && receiver),
    runtime: actorRuntimeController,
    receiver,
    captureCredentials,
    onState,
    onProbe,
    onReconcileRequired
  });

  // The diagnostic is deliberately limited to an Admin on this authorized
  // orders route. It contains safe state and truncated references only.
  if (!adminDiagnostic) return null;

  const leadership = ['authorizing', 'connected', 'retrying'].includes(status)
    ? (globalThis.navigator?.locks ? 'líder mediante Web Locks' : 'líder de pestaña; Web Locks no disponible')
    : 'sin liderazgo';
  const labels = {
    authorizing: 'autorizando', connected: 'conectado', denied: 'denegado',
    expired: 'grant vencido', retrying: 'reintentando', stopped: 'detenido'
  };

  return (
    <aside
      className="ecommerce-qa-diagnostic"
      aria-live="polite"
      aria-label="Diagnóstico QA Realtime"
      style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', margin: '0.5rem 0', fontSize: '0.75rem', opacity: 0.8 }}
    >
      <span>QA Realtime · {labels[status] || 'detenido'}</span>
      <span>Liderazgo: {leadership}</span>
      {grantRef && <span>Grant: {grantRef}</span>}
      {lastProbe && <span>Última sonda: {lastProbe.probeRef} · {lastProbe.receivedAt}</span>}
      {lastReconcile && <span>Reconciliación: {lastReconcile}</span>}
    </aside>
  );
}
