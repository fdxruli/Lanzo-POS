import { useEffect, useState } from 'react';
import { LoaderCircle, PauseCircle, PlayCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { setOrderPause } from '../../services/ecommerce/ecommerceAdminService';
import {
  businessLocalDateTimeToIso,
  getAvailabilityDetail,
  getAvailabilityLabel
} from '../../utils/ecommerceAvailability';

const REASONS = ['Alta demanda', 'Sin repartidor', 'Cierre anticipado', 'Mantenimiento', 'Otro'];

export default function EcommerceOrderPauseControl({ data, onSaved }) {
  const [mode, setMode] = useState('manual');
  const [reasonChoice, setReasonChoice] = useState('Alta demanda');
  const [otherReason, setOtherReason] = useState('');
  const [customResume, setCustomResume] = useState('');
  const [saving, setSaving] = useState(false);
  const paused = data?.availability?.manuallyPaused === true;

  useEffect(() => {
    if (data?.ordersPauseReason && REASONS.includes(data.ordersPauseReason)) {
      setReasonChoice(data.ordersPauseReason);
    }
  }, [data?.ordersPauseReason]);

  const pause = async () => {
    let resumeAt = null;
    if (mode === '30') resumeAt = new Date(Date.now() + 30 * 60_000).toISOString();
    if (mode === '60') resumeAt = new Date(Date.now() + 60 * 60_000).toISOString();
    if (mode === 'custom') {
      resumeAt = businessLocalDateTimeToIso(customResume, data?.timezone);
      if (!resumeAt) return toast.error('Selecciona una fecha y hora válidas.');
    }
    const reason = reasonChoice === 'Otro' ? otherReason.trim() : reasonChoice;
    setSaving(true);
    const result = await setOrderPause({ paused: true, reason, resumeAt });
    setSaving(false);
    if (!result.success) return toast.error(result.message);
    onSaved?.({ ...result, ordersPauseReason: result.pauseReason, ordersPausedUntil: result.pauseUntil });
    toast.success('Recepción de pedidos pausada.');
  };

  const resume = async () => {
    setSaving(true);
    const result = await setOrderPause({ paused: false });
    setSaving(false);
    if (!result.success) return toast.error(result.message);
    onSaved?.({ ...result, ordersPauseReason: null, ordersPausedUntil: null });
    toast.success('Recepción de pedidos reanudada.');
  };

  return (
    <section className="ui-card ecom-operations-card" aria-labelledby="ecom-pause-title">
      <div className="ecom-admin-card-heading">
        <div>
          <span className="ecom-admin-eyebrow">Control inmediato</span>
          <h3 id="ecom-pause-title">Pausar pedidos</h3>
          <p>Pausar pedidos mantiene visible el catálogo. Pausar portal oculta la tienda completa.</p>
        </div>
        <PauseCircle size={23} />
      </div>
      <div className="ecom-availability-summary" role="status" aria-live="polite">
        <strong>{getAvailabilityLabel(data?.availability)}</strong>
        <span>{getAvailabilityDetail(data?.availability)}</span>
      </div>

      {paused ? (
        <button type="button" className="btn btn-primary" disabled={saving} onClick={resume}>
          {saving ? <LoaderCircle className="ecom-admin-spin" size={17} /> : <PlayCircle size={17} />} Reanudar pedidos
        </button>
      ) : (
        <div className="ecom-pause-form">
          <label className="form-group"><span className="form-label">Duración</span>
            <select className="form-input" value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="manual">Hasta reanudar manualmente</option><option value="30">30 minutos</option>
              <option value="60">1 hora</option><option value="custom">Fecha y hora específicas</option>
            </select>
          </label>
          {mode === 'custom' ? <label className="form-group"><span className="form-label">Reanudar en la zona del negocio</span><input className="form-input" type="datetime-local" value={customResume} onChange={(event) => setCustomResume(event.target.value)} /></label> : null}
          <label className="form-group"><span className="form-label">Razón</span>
            <select className="form-input" value={reasonChoice} onChange={(event) => setReasonChoice(event.target.value)}>{REASONS.map((reason) => <option key={reason}>{reason}</option>)}</select>
          </label>
          {reasonChoice === 'Otro' ? <label className="form-group"><span className="form-label">Otra razón</span><input className="form-input" maxLength={300} value={otherReason} onChange={(event) => setOtherReason(event.target.value)} /></label> : null}
          <button type="button" className="btn btn-secondary" disabled={saving} onClick={pause}>
            {saving ? <LoaderCircle className="ecom-admin-spin" size={17} /> : <PauseCircle size={17} />} Pausar pedidos
          </button>
        </div>
      )}
    </section>
  );
}
