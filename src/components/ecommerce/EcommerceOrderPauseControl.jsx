import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, PauseCircle, PlayCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { setOrderPause } from '../../services/ecommerce/ecommerceAdminService';
import {
  businessLocalDateTimeToIso,
  getAvailabilityDetail
} from '../../utils/ecommerceAvailability';

const REASONS = ['Alta demanda', 'Sin repartidor', 'Cierre anticipado', 'Mantenimiento', 'Otro'];

export default function EcommerceOrderPauseControl({ data, onSaved }) {
  const [mode, setMode] = useState('manual');
  const [reasonChoice, setReasonChoice] = useState('Alta demanda');
  const [otherReason, setOtherReason] = useState('');
  const [customResume, setCustomResume] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const paused = data?.availability?.manuallyPaused === true;
  const confirmedReason = data?.ordersPauseReason || data?.availability?.pauseReason;

  useEffect(() => {
    if (data?.ordersPauseReason && REASONS.includes(data.ordersPauseReason)) {
      setReasonChoice(data.ordersPauseReason);
    }
  }, [data?.ordersPauseReason]);

  const submit = async (pauseRequested) => {
    if (savingRef.current) return;
    let resumeAt = null;
    if (pauseRequested) {
      if (mode === '30') resumeAt = new Date(Date.now() + 30 * 60_000).toISOString();
      if (mode === '60') resumeAt = new Date(Date.now() + 60 * 60_000).toISOString();
      if (mode === 'custom') {
        resumeAt = businessLocalDateTimeToIso(customResume, data?.timezone);
        if (!resumeAt) {
          setError('Selecciona una fecha y hora válidas en la zona del negocio.');
          return;
        }
      }
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const result = await setOrderPause(pauseRequested
        ? { paused: true, reason: reasonChoice === 'Otro' ? otherReason.trim() : reasonChoice, resumeAt }
        : { paused: false });
      if (!result?.success) {
        const message = result?.message || 'No se pudo actualizar la recepción de pedidos.';
        setError(message);
        toast.error(message);
        return;
      }
      // Only the confirmed response updates availability; no optimistic "open" state.
      onSaved?.(pauseRequested
        ? { ...result, ordersPauseReason: result.pauseReason, ordersPausedUntil: result.pauseUntil }
        : { ...result, ordersPauseReason: null, ordersPausedUntil: null });
      toast.success(pauseRequested ? 'Recepción de pedidos pausada.' : 'Recepción de pedidos reanudada.');
    } catch (requestError) {
      const message = requestError?.message || 'No se pudo actualizar la recepción de pedidos.';
      setError(message);
      toast.error(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="ecom-ops-panel ecom-ops-pause" aria-labelledby="ecom-pause-title">
      <header className="ecom-ops-heading">
        <span className="ecom-ops-heading-icon"><PauseCircle size={19} aria-hidden="true" /></span>
        <div>
          <h3 id="ecom-pause-title">Control de pedidos</h3>
          <p>La pausa de pedidos mantiene visible el catálogo. No pausa el portal.</p>
        </div>
      </header>
      {paused ? (
        <div className="ecom-ops-pause-active">
          <strong>Recepción de pedidos pausada</strong>
          {confirmedReason && <span>Motivo: {confirmedReason}</span>}
          <span>{getAvailabilityDetail(data?.availability) || 'Consulta la reanudación en el estado operativo.'}</span>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => submit(false)}>
            {saving ? <LoaderCircle className="ecom-admin-spin" size={17} /> : <PlayCircle size={17} />}
            Reanudar pedidos
          </button>
        </div>
      ) : (
        <div className="ecom-pause-form">
          <div className="ecom-ops-pause-fields">
            <label className="form-group"><span className="form-label">Duración</span>
              <select className="form-input" value={mode} disabled={saving}
                onChange={(event) => setMode(event.target.value)}>
                <option value="manual">Hasta reanudar manualmente</option>
                <option value="30">30 minutos</option>
                <option value="60">1 hora</option>
                <option value="custom">Fecha y hora específicas</option>
              </select>
            </label>
            {mode === 'custom' && (
              <label className="form-group"><span className="form-label">Reanudar en la zona del negocio</span>
                <input className="form-input" type="datetime-local" value={customResume} disabled={saving}
                  onChange={(event) => setCustomResume(event.target.value)} />
              </label>
            )}
            <label className="form-group"><span className="form-label">Motivo</span>
              <select className="form-input" value={reasonChoice} disabled={saving}
                onChange={(event) => setReasonChoice(event.target.value)}>
                {REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
              </select>
            </label>
            {reasonChoice === 'Otro' && (
              <label className="form-group"><span className="form-label">Otra razón</span>
                <input className="form-input" maxLength={300} value={otherReason} disabled={saving}
                  onChange={(event) => setOtherReason(event.target.value)} />
              </label>
            )}
          </div>
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => submit(true)}>
            {saving ? <LoaderCircle className="ecom-admin-spin" size={17} /> : <PauseCircle size={17} />}
            Pausar pedidos
          </button>
        </div>
      )}
      {error && <p className="ecom-inline-error" role="alert">{error}</p>}
    </section>
  );
}
