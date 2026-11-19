import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SANITARY_PAGE_SIZE,
  SANITARY_EXPORT_LIMIT,
  SANITARY_MOVEMENT_TYPES,
  LEGACY_SANITARY_MOVEMENT_TYPES,
  buildSanitaryCsv,
  collectSanitaryExport,
  getSanitaryRegisterPage,
  sanitaryIncidences,
  sanitaryMissingUnitLabel,
  sanitaryUnitSourceLabel
} from '../../services/reports/pharmacySanitaryRegister';
import './PharmacySanitaryRegister.css';

import { addBusinessCalendarDays, formatBusinessInstant, getBusinessDateKey, isValidTimeZone } from '../../utils/businessTime';
import { actorRuntimeController } from '../../services/auth/actorRuntimeController';
import { isActorSnapshotCurrent } from '../../services/auth/actorAccessPolicy';
import { isRecoverableTenantReadinessError } from '../../services/auth/actorAuthorityErrors';
import { canAuditSalesReports, canReadSalesReports, getSalesActorIdentity } from '../../services/auth/salesPermissionPolicy';
import { useActorRuntimeSnapshot } from '../../services/auth/useActorRuntimeSnapshot';
import { getTenantRuntimeReadiness } from '../../services/db/tenantRuntimeRouter';
import { getLicenseKeyFromDetails } from '../../services/sync/syncConstants';
import { useAppStore } from '../../store/useAppStore';

const initialFilters = (timezone) => {
  const today = new Date();
  return { from: getBusinessDateKey(addBusinessCalendarDays(today, -29, timezone), timezone),
    to: getBusinessDateKey(today, timezone), search: '', movementType: '', batchId: '', traceStatus: '' };
};
const LABELS = {
  receipt: 'Recepción', dispensation: 'Dispensación documentada', sale: 'Venta de medicamento', waste: 'Merma',
  return: 'Devolución', adjustment: 'Ajuste', other: 'Sin clasificación',
  complete: 'Documentado', incomplete: 'Dato incompleto', limited: 'Cobertura limitada'
};
const SALE_STATUS_LABELS = { closed: 'Confirmada', cancelled: 'Cancelada' };
const dateLabel = (value, timezone) => (value && formatBusinessInstant(value, timezone, {
  dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23'
})) || 'Fecha no verificable';
const shown = (value) => value === null || value === undefined || value === ''
  ? 'No registrado' : String(value);

export default function PharmacySanitaryRegister({ licenseKey, cloud, actorIdentity, timezone: configuredTimezone }) {
  const timezone = isValidTimeZone(configuredTimezone) ? configuredTimezone : 'UTC';
  const [draft, setDraft] = useState(() => initialFilters(timezone));
  const [applied, setApplied] = useState(draft);
  const [cursors, setCursors] = useState([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [isRecoveringTenantAuthority, setIsRecoveringTenantAuthority] = useState(false);
  const [pendingTenantRetryKey, setPendingTenantRetryKey] = useState(null);
  const [tenantRetryVersion, setTenantRetryVersion] = useState(0);
  const [cloudMovementTypesByKey, setCloudMovementTypesByKey] = useState({});
  const pendingTenantRetryRef = useRef(null);
  const retriedTenantQueryKeyRef = useRef(null);
  const attemptedTenantRecoveryKeyRef = useRef(null);
  const runtimeSnapshot = useActorRuntimeSnapshot();
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const initializeApp = useAppStore((state) => state.initializeApp);
  const isInitializing = useAppStore((state) => state._isInitializing === true);
  const activeLicenseKey = getLicenseKeyFromDetails(licenseDetails);
  const cursor = cursors[pageIndex];
  const canRead = Boolean(actorIdentity);
  const capabilityKey = `${licenseKey || ''}:${actorIdentity || ''}`;
  const cloudMovementTypes = cloudMovementTypesByKey[capabilityKey] || LEGACY_SANITARY_MOVEMENT_TYPES;
  const movementOptions = cloud ? cloudMovementTypes : SANITARY_MOVEMENT_TYPES;
  const queryKey = useMemo(() => JSON.stringify([
    licenseKey || '', cloud, actorIdentity || '', timezone,
    applied.from, applied.to, applied.search, applied.movementType,
    applied.batchId, applied.traceStatus, cursor?.at || '', cursor?.id || ''
  ]), [licenseKey, cloud, actorIdentity, timezone, applied, cursor]);

  const queueTenantReadinessRetry = useCallback((capturedActor, cause) => {
    if (activeLicenseKey !== licenseKey
      || !isRecoverableTenantReadinessError(cause)
      || retriedTenantQueryKeyRef.current === queryKey) return false;
    const current = actorRuntimeController.getState();
    const tenant = capturedActor?.tenant;
    if (capturedActor?.status !== 'granted'
      || current.status !== 'granted'
      || current.actorKey !== capturedActor.actorKey
      || current.sessionId !== capturedActor.sessionId
      || current.generation !== capturedActor.generation
      || getSalesActorIdentity(current) !== actorIdentity
      || current.tenant?.opaqueId !== tenant?.opaqueId
      || current.tenant?.databaseName !== tenant?.databaseName
      || !tenant?.opaqueId || !tenant?.databaseName) return false;
    pendingTenantRetryRef.current = {
      requestKey: queryKey,
      actorIdentity,
      actorType: capturedActor.actorType,
      actorKey: capturedActor.actorKey,
      sessionId: capturedActor.sessionId,
      tenant: { opaqueId: tenant.opaqueId, databaseName: tenant.databaseName }
    };
    setPendingTenantRetryKey(queryKey);
    setError('Estamos verificando de nuevo la sesión y el dispositivo para esta consulta.');
    return true;
  }, [activeLicenseKey, actorIdentity, licenseKey, queryKey]);

  useEffect(() => {
    const pending = pendingTenantRetryRef.current;
    if (!pending) return;
    if (pending.requestKey !== queryKey) {
      pendingTenantRetryRef.current = null;
      setPendingTenantRetryKey(null);
      return;
    }
    if (activeLicenseKey !== licenseKey) {
      pendingTenantRetryRef.current = null;
      setPendingTenantRetryKey(null);
      setError('La licencia activa cambió. Confirma de nuevo el negocio antes de consultar.');
      return;
    }

    const current = actorRuntimeController.getState();
    const readiness = getTenantRuntimeReadiness();
    const isSameActorSession = current.status === 'granted'
      && current.actorKey === pending.actorKey
      && current.sessionId === pending.sessionId
      && getSalesActorIdentity(current) === pending.actorIdentity;
    const isSameActorTenant = current.tenant?.opaqueId === pending.tenant.opaqueId
      && current.tenant?.databaseName === pending.tenant.databaseName;
    const isSameReadyTenant = readiness?.ready
      && readiness.runtime?.opaqueId === pending.tenant.opaqueId
      && readiness.runtime?.databaseName === pending.tenant.databaseName;

    if (current.status === 'locked'
      || (current.actorType && current.actorType !== pending.actorType)
      || (current.status === 'granted' && (!isSameActorSession || !isSameActorTenant))
      || (readiness?.ready && !isSameReadyTenant)) {
      pendingTenantRetryRef.current = null;
      setPendingTenantRetryKey(null);
      setError('La sesión o el negocio cambió. Confirma el acceso antes de volver a consultar.');
      return;
    }

    if (!isSameActorSession || !isSameActorTenant || !isSameReadyTenant
      || !canReadSalesReports(current) || !canAuditSalesReports(current)
      || !isActorSnapshotCurrent(current)) return;

    pendingTenantRetryRef.current = null;
    retriedTenantQueryKeyRef.current = queryKey;
    setPendingTenantRetryKey(null);
    setTenantRetryVersion((version) => version + 1);
  }, [runtimeSnapshot, queryKey, actorIdentity, activeLicenseKey, licenseKey, pendingTenantRetryKey]);

  useEffect(() => {
    if (!canRead) {
      setResult(null);
      return undefined;
    }
    if (activeLicenseKey !== licenseKey) {
      setResult(null);
      setLoading(false);
      setError('La licencia activa cambió. Confirma de nuevo el negocio antes de consultar.');
      return undefined;
    }
    if (pendingTenantRetryRef.current?.requestKey !== queryKey) {
      pendingTenantRetryRef.current = null;
      setPendingTenantRetryKey(null);
    }
    let active = true;
    const operationActor = actorRuntimeController.getState();
    const isOperationContextCurrent = () => {
      const current = actorRuntimeController.getState();
      return operationActor.status === 'granted'
        && getLicenseKeyFromDetails(useAppStore.getState().licenseDetails) === licenseKey
        && current.status === 'granted'
        && current.actorKey === operationActor.actorKey
        && current.sessionId === operationActor.sessionId
        && current.generation === operationActor.generation
        && getSalesActorIdentity(current) === actorIdentity
        && current.tenant?.opaqueId === operationActor.tenant?.opaqueId
        && current.tenant?.databaseName === operationActor.tenant?.databaseName
        && isActorSnapshotCurrent(operationActor);
    };
    setLoading(true);
    setError('');
    setResult(null);
    getSanitaryRegisterPage({
      licenseKey, cloud, actorIdentity, timezone, filters: applied, cursor, limit: SANITARY_PAGE_SIZE
    }).then((page) => {
      if (active) {
        if (!isOperationContextCurrent()) {
          let staleContextError = null;
          try { actorRuntimeController.assertCurrent(operationActor); } catch (cause) { staleContextError = cause; }
          if (queueTenantReadinessRetry(operationActor, staleContextError)) return;
          setError('La sesión o el negocio cambió durante la consulta. Vuelve a consultar cuando el acceso esté confirmado.');
          return;
        }
        if (cloud) {
          setCloudMovementTypesByKey((current) => ({
            ...current,
            [capabilityKey]: page.supportedMovementTypes || LEGACY_SANITARY_MOVEMENT_TYPES
          }));
        }
        setResult(page);
        if (retriedTenantQueryKeyRef.current === queryKey) retriedTenantQueryKeyRef.current = null;
        attemptedTenantRecoveryKeyRef.current = null;
      }
    }).catch((cause) => {
      if (!active) return;
      if (queueTenantReadinessRetry(operationActor, cause)) return;
      setError(isRecoverableTenantReadinessError(cause)
        ? 'No se pudo restablecer la verificación del negocio. Vuelve a consultar cuando la sesión esté lista.'
        : cause?.message || 'No se pudo consultar el registro.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [licenseKey, activeLicenseKey, cloud, actorIdentity, timezone, applied, cursor, canRead, capabilityKey, queryKey, tenantRetryVersion, queueTenantReadinessRetry]);

  const retryTenantVerification = async () => {
    const pending = pendingTenantRetryRef.current;
    if (!pending || pending.requestKey !== queryKey || isRecoveringTenantAuthority || isInitializing) return;
    if (getLicenseKeyFromDetails(useAppStore.getState().licenseDetails) !== licenseKey) {
      pendingTenantRetryRef.current = null;
      setPendingTenantRetryKey(null);
      setError('La licencia activa cambió. Confirma de nuevo el negocio antes de consultar.');
      return;
    }
    const recoveryKey = JSON.stringify([
      licenseKey, pending.actorIdentity, pending.actorKey, pending.sessionId,
      pending.tenant.opaqueId, pending.tenant.databaseName
    ]);
    if (attemptedTenantRecoveryKeyRef.current === recoveryKey) return;
    attemptedTenantRecoveryKeyRef.current = recoveryKey;
    setIsRecoveringTenantAuthority(true);
    setError('Estamos confirmando de nuevo la misma sesión y el negocio.');
    try {
      const result = await initializeApp({ force: true });
      const current = actorRuntimeController.getState();
      const restoredForSameContext = result?.status === 'ready'
        && getLicenseKeyFromDetails(useAppStore.getState().licenseDetails) === licenseKey
        && current.status === 'granted'
        && current.actorType === pending.actorType
        && current.actorKey === pending.actorKey
        && current.sessionId === pending.sessionId
        && getSalesActorIdentity(current) === pending.actorIdentity
        && current.tenant?.opaqueId === pending.tenant.opaqueId
        && current.tenant?.databaseName === pending.tenant.databaseName
        && isActorSnapshotCurrent(current);
      if (!restoredForSameContext && pendingTenantRetryRef.current?.requestKey === queryKey) {
        pendingTenantRetryRef.current = null;
        setPendingTenantRetryKey(null);
        setError('No pudimos confirmar la misma sesión y el negocio. Vuelve a identificarte antes de consultar.');
      }
    } catch {
      if (pendingTenantRetryRef.current?.requestKey === queryKey) {
        pendingTenantRetryRef.current = null;
        setPendingTenantRetryKey(null);
        setError('La verificación no se pudo restablecer. Vuelve a identificarte antes de consultar.');
      }
    } finally {
      setIsRecoveringTenantAuthority(false);
    }
  };

  const pendingTenantRecovery = pendingTenantRetryRef.current;
  const canRetryTenantVerification = pendingTenantRetryKey === queryKey
    && activeLicenseKey === licenseKey
    && pendingTenantRecovery?.requestKey === queryKey
    && runtimeSnapshot?.status === 'granted'
    && runtimeSnapshot.actorKey === pendingTenantRecovery.actorKey
    && runtimeSnapshot.sessionId === pendingTenantRecovery.sessionId
    && getSalesActorIdentity(runtimeSnapshot) === pendingTenantRecovery.actorIdentity
    && attemptedTenantRecoveryKeyRef.current !== JSON.stringify([
      licenseKey, pendingTenantRecovery.actorIdentity, pendingTenantRecovery.actorKey,
      pendingTenantRecovery.sessionId, pendingTenantRecovery.tenant.opaqueId,
      pendingTenantRecovery.tenant.databaseName
    ]);

  const summary = useMemo(() => {
    const rows = result?.rows || [];
    return {
      receipts: rows.filter((r) => r.movementType === 'receipt').length,
      dispensations: rows.filter((r) => r.movementType === 'dispensation').length,
      sales: rows.filter((r) => r.movementType === 'sale').length,
      other: rows.filter((r) => ['waste', 'return', 'adjustment', 'other'].includes(r.movementType)).length,
      issues: rows.filter((r) => r.traceStatus !== 'complete' || sanitaryIncidences(r).length > 0).length
    };
  }, [result]);

  const apply = (event) => {
    event.preventDefault();
    setCursors([null]);
    setPageIndex(0);
    setApplied({ ...draft });
  };

  const download = async () => {
    if (!canRead || loading || exporting) return;
    setExporting(true);
    setError('');
    try {
      const rows = await collectSanitaryExport({ licenseKey, cloud, actorIdentity, timezone, filters: applied });
      const csv = buildSanitaryCsv(rows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'registro-sanitario-auxiliar-' + applied.from + '-a-' + applied.to + '.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause?.message || 'No se pudo generar el CSV.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="sanitary-register" aria-label="Registro sanitario auxiliar">
      <header className="sanitary-header">
        <h2>Registro sanitario</h2>
        <p>Consulta movimientos de medicamentos, dispensaciones documentadas, ventas e incidencias para revisión documental. Cada fila conserva su lote y puede compartir la misma venta.</p>
        <small>Registro auxiliar de LANZO POS. No sustituye libros oficiales ni documentación física requerida.</small>
      </header>

      <form className="sanitary-filters" onSubmit={apply}>
        <label>Desde
          <input type="date" required value={draft.from}
            onChange={(e) => setDraft((v) => ({ ...v, from: e.target.value }))} />
        </label>
        <label>Hasta
          <input type="date" required value={draft.to}
            onChange={(e) => setDraft((v) => ({ ...v, to: e.target.value }))} />
        </label>
        <label className="sanitary-wide">Medicamento, código o sustancia
          <input type="search" maxLength={120} placeholder="Buscar" value={draft.search}
            onChange={(e) => setDraft((v) => ({ ...v, search: e.target.value }))} />
        </label>
        <label>Movimiento
          <select value={draft.movementType}
            onChange={(e) => setDraft((v) => ({ ...v, movementType: e.target.value }))}>
            <option value="">Todos</option>
            {movementOptions.map((key) => <option key={key} value={key}>{LABELS[key] || key}</option>)}
          </select>
          {cloud && !cloudMovementTypes.includes('sale') && (
            <small>El contrato Cloud activo aún no anuncia este filtro. Se habilitará cuando la consulta confirme la versión SQL compatible.</small>
          )}
        </label>
        <label>Lote (ID o fabricante)
          <input value={draft.batchId} placeholder="Opcional" maxLength={150}
            onChange={(e) => setDraft((v) => ({ ...v, batchId: e.target.value }))} />
        </label>
        <label>Estado de trazabilidad
          <select value={draft.traceStatus}
            onChange={(e) => setDraft((v) => ({ ...v, traceStatus: e.target.value }))}>
            <option value="">Todos</option>
            <option value="complete">Documentado</option>
            <option value="incomplete">Dato incompleto</option>
            <option value="limited">Cobertura limitada</option>
          </select>
        </label>
        <div className="sanitary-actions">
          <button type="submit" disabled={!canRead || loading}>Consultar</button>
          <button type="button" onClick={download} disabled={!canRead || loading || exporting || !result}>
            {exporting ? 'Preparando CSV…' : 'Exportar CSV'}
          </button>
        </div>
      </form>

      <p className="sanitary-source">
        Fuente: {cloud ? 'PRO/Nube autorizada' : 'Solo este dispositivo (Local)'}.
        {' '}Zona horaria de consulta y visualización: {timezone}. El CSV conserva la zona o el desfase de cada timestamp.
        {' '}La cobertura histórica puede ser parcial; los saldos físicos no se calculan desde este reporte.
        {' '}CSV limitado a {SANITARY_EXPORT_LIMIT} filas; si se supera, se solicitará reducir el periodo.
      </p>

      {!canRead && <p role="alert">Se requiere una sesión con permiso de Reportes.</p>}
      {error && <p className="sanitary-error" role={pendingTenantRetryKey === queryKey ? 'status' : 'alert'}>{error}</p>}
      {canRetryTenantVerification && !isInitializing && (
        <div className="sanitary-actions">
          <button type="button" onClick={retryTenantVerification} disabled={isRecoveringTenantAuthority}>
            {isRecoveringTenantAuthority ? 'Verificando…' : 'Reintentar verificación'}
          </button>
        </div>
      )}
      {loading && <p role="status">Consultando movimientos…</p>}

      {result && !loading && (
        <>
          <div className="sanitary-summary" aria-label="Resumen de la página">
            <span>Recepciones <strong>{summary.receipts}</strong></span>
            <span>Dispensaciones documentadas <strong>{summary.dispensations}</strong></span>
            <span>Salidas por venta <strong>{summary.sales}</strong></span>
            <span>Otras operaciones/incidencias <strong>{summary.other}</strong></span>
            <span>Registros a revisar <strong>{summary.issues}</strong></span>
          </div>
          <p className="sanitary-source">Indicadores de esta página ({result.rows.length} movimientos), no totales del periodo.</p>
          <div className="sanitary-list">
            {!result.rows.length && <p>No hay movimientos identificables con estos filtros.</p>}
            {result.rows.map((row) => {
              const incidences = sanitaryIncidences(row);
              return (
                <details className="sanitary-item" key={row.id}>
                  <summary>
                    <span className="sanitary-item-main">
                      <strong>{shown(row.productName)}</strong>
                      <small>{dateLabel(row.occurredAt, timezone)} · {LABELS[row.movementType] || row.movementType}</small>
                    </span>
                    <span className="sanitary-item-end">
                      <strong>{shown(row.quantity)} {row.unit || sanitaryMissingUnitLabel(row)}</strong>
                      <small>{LABELS[row.traceStatus] || 'Revisar'}</small>
                    </span>
                  </summary>
                  <dl className="sanitary-details">
                    {row.movementType !== 'sale' && (
                      <div><dt>Operación</dt><dd>{shown(row.operationId || row.id)}</dd></div>
                    )}
                    {row.movementType === 'sale' && (
                      <>
                        <div><dt>Venta de origen</dt><dd>{shown(row.saleReference)} · ID {shown(row.saleId)}</dd></div>
                        <div><dt>Línea de venta</dt><dd>{shown(row.saleItemId)}</dd></div>
                        <div><dt>Movimiento de origen</dt>
                          <dd>{shown(row.movementId || (row.sourceMovementIds || []).join(', '))}
                            {row.movementGranularity === 'product' ? ' · evento local agregado por producto' : ''}</dd>
                        </div>
                        <div><dt>Estado de venta</dt><dd>{SALE_STATUS_LABELS[row.saleStatus] || shown(row.saleStatus)}</dd></div>
                      </>
                    )}
                    <div><dt>Lote</dt><dd>{shown(row.batchNumber || row.batchId)}</dd></div>
                    <div><dt>Unidad</dt><dd>{row.unit || sanitaryMissingUnitLabel(row)}</dd></div>
                    <div><dt>Fuente de unidad</dt><dd>{sanitaryUnitSourceLabel(row)}</dd></div>
                    <div><dt>Caducidad</dt><dd>{shown(row.expiryDate)}</dd></div>
                    {row.batchSku && <div><dt>SKU de lote</dt><dd>{shown(row.batchSku)}</dd></div>}
                    {row.receiptAt && <div><dt>Recepción declarada</dt><dd>{dateLabel(row.receiptAt, timezone)}</dd></div>}
                    {row.movementType === 'sale'
                      ? <div><dt>Documentación sanitaria</dt><dd>Venta sin dispensación documentada asociada</dd></div>
                      : <div><dt>Comprobante / receta</dt><dd>{shown(row.documentReference)}</dd></div>}
                    {row.movementType !== 'sale' && <div><dt>Venta</dt><dd>{shown(row.saleId)}</dd></div>}
                    <div><dt>Responsable</dt><dd>{shown(row.actor)}</dd></div>
                    <div><dt>Origen</dt><dd>{shown(row.provenance)} · {shown(row.syncStatus)}</dd></div>
                    <div><dt>Nombre</dt><dd>{row.nameSource === 'current_catalog' ? 'Catálogo actual (no histórico)' : 'Registro de operación'}</dd></div>
                    <div><dt>Incidencias / cobertura</dt>
                      <dd>{incidences.length ? incidences.join(' · ') : 'Sin incidencias detectadas con los datos disponibles'}</dd></div>
                  </dl>
                </details>
              );
            })}
          </div>
          <div className="sanitary-pagination">
            <button type="button" disabled={pageIndex === 0}
              onClick={() => setPageIndex((v) => Math.max(v - 1, 0))}>Anterior</button>
            <span>Página {pageIndex + 1}</span>
            <button type="button" disabled={!result.hasMore || !result.nextCursor}
              onClick={() => {
                setCursors((v) => [...v.slice(0, pageIndex + 1), result.nextCursor]);
                setPageIndex((v) => v + 1);
              }}>Siguiente</button>
          </div>
        </>
      )}
    </section>
  );
}
