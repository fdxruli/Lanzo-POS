import { useEffect, useMemo, useState } from 'react';
import {
  SANITARY_PAGE_SIZE,
  SANITARY_EXPORT_LIMIT,
  buildSanitaryCsv,
  collectSanitaryExport,
  getSanitaryRegisterPage,
  sanitaryIncidences
} from '../../services/reports/pharmacySanitaryRegister';
import './PharmacySanitaryRegister.css';

const localDate = (date) => {
  const day = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return day.toISOString().slice(0, 10);
};
const initialFilters = () => {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 29);
  return { from: localDate(from), to: localDate(today),
    search: '', movementType: '', batchId: '', traceStatus: '' };
};
const LABELS = {
  receipt: 'Recepción', dispensation: 'Dispensación', waste: 'Merma',
  return: 'Devolución', adjustment: 'Ajuste', other: 'Sin clasificación',
  complete: 'Documentado', incomplete: 'Dato incompleto', limited: 'Cobertura limitada'
};
const dateLabel = (value) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('es-MX') : 'Fecha no verificable';
};
const shown = (value) => value === null || value === undefined || value === ''
  ? 'No registrado' : String(value);

export default function PharmacySanitaryRegister({ licenseKey, cloud, actorIdentity }) {
  const [draft, setDraft] = useState(initialFilters);
  const [applied, setApplied] = useState(draft);
  const [cursors, setCursors] = useState([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const cursor = cursors[pageIndex];
  const canRead = Boolean(actorIdentity);

  useEffect(() => {
    if (!canRead) {
      setResult(null);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError('');
    setResult(null);
    getSanitaryRegisterPage({
      licenseKey, cloud, actorIdentity, filters: applied, cursor, limit: SANITARY_PAGE_SIZE
    }).then((page) => {
      if (active) setResult(page);
    }).catch((cause) => {
      if (active) setError(cause?.message || 'No se pudo consultar el registro.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [licenseKey, cloud, actorIdentity, applied, cursor, canRead]);

  const summary = useMemo(() => {
    const rows = result?.rows || [];
    return {
      receipts: rows.filter((r) => r.movementType === 'receipt').length,
      dispensations: rows.filter((r) => r.movementType === 'dispensation' && r.saleStatus !== 'cancelled').length,
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
      const rows = await collectSanitaryExport({ licenseKey, cloud, actorIdentity, filters: applied });
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
        <p>Consulta movimientos de medicamentos, recetas e incidencias para revisión documental.</p>
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
            {Object.entries(LABELS).filter(([key]) =>
              ['receipt', 'dispensation', 'waste', 'return', 'adjustment', 'other'].includes(key)
            ).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>Lote (ID)
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
        {' '}La cobertura histórica puede ser parcial; los saldos físicos no se calculan desde este reporte.
        {' '}CSV limitado a {SANITARY_EXPORT_LIMIT} filas; si se supera, se solicitará reducir el periodo.
      </p>

      {!canRead && <p role="alert">Se requiere una sesión con permiso de Reportes.</p>}
      {error && <p className="sanitary-error" role="alert">{error}</p>}
      {loading && <p role="status">Consultando movimientos…</p>}

      {result && !loading && (
        <>
          <div className="sanitary-summary" aria-label="Resumen de la página">
            <span>Recepciones <strong>{summary.receipts}</strong></span>
            <span>Dispensaciones <strong>{summary.dispensations}</strong></span>
            <span>Otras salidas/ajustes <strong>{summary.other}</strong></span>
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
                      <small>{dateLabel(row.occurredAt)} · {LABELS[row.movementType] || row.movementType}</small>
                    </span>
                    <span className="sanitary-item-end">
                      <strong>{shown(row.quantity)} {row.unit || 'unidad no indicada'}</strong>
                      <small>{LABELS[row.traceStatus] || 'Revisar'}</small>
                    </span>
                  </summary>
                  <dl className="sanitary-details">
                    <div><dt>Operación</dt><dd>{shown(row.operationId || row.id)}</dd></div>
                    <div><dt>Lote</dt><dd>{shown(row.batchNumber || row.batchId)}</dd></div>
                    <div><dt>Caducidad</dt><dd>{shown(row.expiryDate)}</dd></div>
                    <div><dt>Comprobante / receta</dt><dd>{shown(row.documentReference)}</dd></div>
                    <div><dt>Venta</dt><dd>{shown(row.saleId)}</dd></div>
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
