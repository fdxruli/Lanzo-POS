import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { getLicenseKeyFromDetails, isCloudCustomerCreditSyncEnabled } from '../../services/sync/syncConstants';
import { customerCreditMigrationService as migration } from '../../services/customerCredit/customerCreditMigrationService';
import './HistoricalCreditImport.css';

const money = (cents) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(cents / 100);
const statusCopy = {
  READY: 'Sin conflicto', IMPORTED: 'Importado', ALREADY_IMPORTED_IDENTICAL: 'Importación anterior verificada',
  CONFLICT_DIFFERENT_BALANCE: 'Conflicto: saldo diferente', CONFLICT_EXISTING_CLOUD_LEDGER: 'Conflicto: existe historial en Nube',
  CONFLICT_CUSTOMER_MISSING: 'Conflicto: falta sincronizar el cliente', CONFLICT_LOCAL_ACTIVITY: 'Importado; hay actividad local pendiente'
};
const errorCopy = (error) => ({
  REJECTED_AUTHORITY: 'Se requiere una sesión vigente del propietario.',
  ACTOR_SESSION_INVALID: 'La sesión ya no es válida. El propietario debe iniciar sesión nuevamente.',
  ACTOR_SESSION_REQUIRED: 'El propietario debe iniciar sesión para autorizar estos saldos.',
  AUTHORIZATION_EXPIRED: 'La autorización venció. Revisa el lote y autorízalo nuevamente.',
  EXPIRED: 'La autorización venció. Revisa el lote y autorízalo nuevamente.',
  SESSION_CHANGED: 'La sesión cambió. El propietario debe revisar y autorizar nuevamente.',
  AUTHORIZATION_SESSION_CHANGED: 'La sesión cambió. El propietario debe revisar y autorizar nuevamente.',
  PENDING_AUTHORIZATION: 'El lote espera autorización del propietario.'
}[error?.message] || 'No se confirmó la operación. Los saldos locales siguen preservados. Consulta el estado antes de reintentar.');

export default function HistoricalCreditImport() {
  const details = useAppStore((state) => state.licenseDetails);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!isCloudCustomerCreditSyncEnabled(details)) return null;
  const licenseKey = getLicenseKeyFromDetails(details);
  const run = async (operation) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await operation(); } catch (failure) { setError(errorCopy(failure)); } finally { setBusy(false); }
  };
  const rows = result?.results || preview?.results || [];
  const conflicts = rows.filter((row) => row.status.startsWith('CONFLICT_')).length;
  return (
    <section className="ui-card historical-credit" aria-labelledby="historical-credit-title" aria-busy={busy}>
      <h2 id="historical-credit-title">Importar saldos históricos</h2>
      <p>El propietario puede revisar y autorizar deudas conservadas de Lanzo Local. Importarlas no registra ingresos en Caja.</p>
      <div className="historical-credit__actions">
        <button type="button" className="ui-button ui-button--secondary" disabled={busy} onClick={() => run(async () => {
          setConfirmed(false); setResult(null); setPreview(await migration.preview({ licenseKey }));
        })}>Revisar saldos preservados</button>
        <button type="button" className="ui-button ui-button--ghost" disabled={busy} onClick={() => run(async () => setResult(await migration.status({ licenseKey })))}>Consultar estado</button>
      </div>
      {preview?.empty && <p role="status">No hay saldos históricos pendientes.</p>}
      {preview?.batch && <>
        <p><strong>{preview.batch.manifest.customer_count} clientes · {money(preview.batch.manifest.total_cents)}</strong></p>
        <p>{rows.length - conflicts} sin conflicto · {conflicts} con conflicto. Los conflictos conservan el saldo original para revisión.</p>
      </>}
      {rows.length > 0 && <ul className="historical-credit__rows" aria-label="Clientes y saldos del lote">
        {rows.map((row) => <li key={row.customer_id}>
          <strong>{preview?.names?.[row.customer_id] || row.customer_id}</strong>
          <span>{money(row.amount_cents)} · {statusCopy[row.status] || row.status}</span>
          {row.over_limit && <span className="ui-alert ui-alert--warning">Supera el límite actual. El saldo se conserva; no autoriza nuevos cargos.</span>}
        </li>)}
      </ul>}
      {preview?.batch && result?.state !== 'CONSUMED' && result?.cloudState !== 'CONSUMED' && <>
        <p>Confirmar autoriza los importes exactos declarados. Solo se aplicarán los clientes sin conflicto; un historial Nube distinto requiere revisión manual.</p>
        <label className="historical-credit__confirmation"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />Revisé los clientes, saldos y total y autorizo su importación histórica.</label>
        <div className="historical-credit__actions">
          <button type="button" className="ui-button ui-button--primary" disabled={busy || !confirmed} onClick={() => run(async () => {
            setConfirmed(false); setResult(await migration.authorizeAndImport({ licenseKey, reviewedHash: preview.hash }));
          })}>Autorizar e importar estos saldos</button>
          <button type="button" className="ui-button ui-button--secondary" disabled={busy} onClick={() => run(async () => setResult(await migration.resumeImport({ licenseKey })))}>Consultar y reintentar lote autorizado</button>
        </div>
      </>}
      {result?.state && <p role="status">Estado: {result.state === 'CONSUMED' ? 'Importación confirmada' : result.state}. Los originales locales permanecen guardados.</p>}
      {result?.state === 'LOCAL_CONFLICT' && <p role="alert">Nube confirmó el saldo aprobado, pero existe actividad local posterior pendiente de revisión. No se reemplazó ni descartó.</p>}
      {error && <p role="alert" className="ui-alert ui-alert--warning">{error}</p>}
    </section>
  );
}
