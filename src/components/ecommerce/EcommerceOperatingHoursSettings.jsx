import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, ChevronDown, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { saveOperatingSchedule } from '../../services/ecommerce/ecommerceAdminService';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = {
  0: 'Domingo', 1: 'Lunes', 2: 'Martes', 3: 'Miércoles',
  4: 'Jueves', 5: 'Viernes', 6: 'Sábado'
};
const BASE_TIMEZONES = [
  'America/Mexico_City', 'America/Cancun', 'America/Monterrey',
  'America/Chihuahua', 'America/Hermosillo', 'America/Mazatlan', 'America/Tijuana'
];

const completeWeek = (weekly = []) => {
  const byDay = new Map((Array.isArray(weekly) ? weekly : []).map((item) => [Number(item.weekday), item]));
  return DAY_ORDER.map((weekday) => ({
    weekday,
    isOpen: byDay.get(weekday)?.isOpen === true,
    opensAt: byDay.get(weekday)?.opensAt || '09:00',
    closesAt: byDay.get(weekday)?.closesAt || '18:00'
  }));
};

const fromServer = (data, fallbackTimezone) => ({
  enabled: data?.businessHoursEnabled === true,
  timezone: data?.timezone || fallbackTimezone,
  weekly: completeWeek(data?.hours?.weekly),
  exceptions: Array.isArray(data?.hours?.exceptions)
    ? data.hours.exceptions.map((item) => ({
      date: item.date || '',
      isOpen: item.isOpen === true,
      opensAt: item.opensAt || '09:00',
      closesAt: item.closesAt || '18:00',
      reason: item.reason || ''
    }))
    : []
});

const validDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const validateSchedule = ({ enabled, weekly, exceptions }) => {
  if (enabled && !weekly.some((day) => day.isOpen)) {
    return 'Configura al menos un día abierto antes de aplicar el horario.';
  }
  const invalidDay = weekly.find((day) => day.isOpen && (!day.opensAt || !day.closesAt || day.opensAt >= day.closesAt));
  if (invalidDay) return DAY_NAMES[invalidDay.weekday] + ': la apertura debe ser anterior al cierre.';
  if (exceptions.length > 60) return 'Puedes guardar hasta 60 fechas especiales.';
  if (exceptions.some((item) => !validDate(item.date))) return 'Revisa la fecha de las excepciones.';
  if (new Set(exceptions.map((item) => item.date)).size !== exceptions.length) {
    return 'Hay fechas especiales duplicadas. Corrígelas antes de guardar.';
  }
  if (exceptions.some((item) => item.isOpen && (!item.opensAt || !item.closesAt || item.opensAt >= item.closesAt))) {
    return 'Revisa las horas de apertura y cierre de las fechas especiales.';
  }
  return '';
};

export default function EcommerceOperatingHoursSettings({ data, onSaved, onDirtyChange }) {
  const browserTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Mexico_City', []
  );
  const initial = useMemo(() => fromServer(data, browserTimezone), [data, browserTimezone]);
  const [confirmed, setConfirmed] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [expandedDay, setExpandedDay] = useState(null);
  const [expandedException, setExpandedException] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(confirmed);
  const validation = validateSchedule(draft);
  const serverSignature = JSON.stringify({
    timezone: data?.timezone,
    businessHoursEnabled: data?.businessHoursEnabled,
    hours: data?.hours
  });

  // An unrelated pause response can refresh availability; never reset a dirty editor.
  useEffect(() => {
    if (!dirty) {
      const snapshot = fromServer(data, browserTimezone);
      setConfirmed(snapshot);
      setDraft(snapshot);
    }
    // Only react to a change in confirmed schedule fields, not availability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSignature, browserTimezone]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const update = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError('');
  };
  const updateDay = (weekday, field, value) => {
    setDraft((current) => ({
      ...current,
      weekly: current.weekly.map((day) => day.weekday === weekday ? { ...day, [field]: value } : day)
    }));
    setError('');
  };
  const updateException = (index, field, value) => {
    setDraft((current) => ({
      ...current,
      exceptions: current.exceptions.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      ))
    }));
    setError('');
  };
  const addException = () => {
    if (draft.exceptions.length >= 60) return toast.error('Puedes guardar hasta 60 fechas especiales.');
    setExpandedException(draft.exceptions.length);
    setDraft((current) => ({
      ...current,
      exceptions: [...current.exceptions, {
        date: '', isOpen: false, opensAt: '09:00', closesAt: '18:00', reason: ''
      }]
    }));
    setError('');
  };
  const removeException = (index) => {
    setDraft((current) => ({
      ...current, exceptions: current.exceptions.filter((_, itemIndex) => itemIndex !== index)
    }));
    setExpandedException(null);
    setError('');
  };

  const submit = async () => {
    if (savingRef.current || !dirty) return;
    if (validation) {
      setError(validation);
      toast.error(validation);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    const submitted = draft;
    try {
      const result = await saveOperatingSchedule({
        timezone: submitted.timezone,
        businessHoursEnabled: submitted.enabled,
        weekly: submitted.weekly,
        exceptions: submitted.exceptions
      });
      if (!result?.success) {
        const message = result?.message || 'No se pudo guardar el horario. Intenta nuevamente.';
        setError(message);
        toast.error(message);
        return;
      }
      const nextConfirmed = fromServer({
        timezone: result.timezone ?? submitted.timezone,
        businessHoursEnabled: result.businessHoursEnabled ?? submitted.enabled,
        hours: {
          weekly: result.hours?.weekly ?? submitted.weekly,
          exceptions: result.hours?.exceptions ?? submitted.exceptions
        }
      }, browserTimezone);
      setConfirmed(nextConfirmed);
      setDraft(nextConfirmed);
      onSaved?.({
        ...result,
        timezone: nextConfirmed.timezone,
        businessHoursEnabled: nextConfirmed.enabled,
        hours: { ...data?.hours, ...result.hours, weekly: nextConfirmed.weekly, exceptions: nextConfirmed.exceptions }
      });
      toast.success('Horarios guardados.');
    } catch (saveError) {
      const message = saveError?.message || 'No se pudieron guardar los horarios. Intenta nuevamente.';
      setError(message);
      toast.error(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const timezoneOptions = Array.from(new Set([...BASE_TIMEZONES, browserTimezone, draft.timezone]));

  return (
    <section className="ecom-ops-panel ecom-ops-schedule" aria-labelledby="ecom-hours-title">
      <header className="ecom-ops-heading">
        <span className="ecom-ops-heading-icon"><CalendarClock size={19} aria-hidden="true" /></span>
        <div>
          <h3 id="ecom-hours-title">Horario semanal</h3>
          <p>Configura cuándo se aceptan pedidos.</p>
        </div>
        {dirty && <span className="ecom-ops-draft-label">Sin guardar</span>}
      </header>

      <fieldset className="ecom-ops-editor" disabled={saving}>
        <label className="ecom-operation-toggle">
          <input type="checkbox" checked={draft.enabled} onChange={(event) => update('enabled', event.target.checked)} />
          <span><strong>Aplicar horario a los pedidos</strong>
            <small>{draft.enabled ? 'El horario limita la recepción de pedidos.' : 'Los horarios guardados no bloquean pedidos.'}</small>
          </span>
        </label>

        <div className="ecom-ops-section-title"><strong>Días de atención</strong><small>Toca un día para modificarlo.</small></div>
        <div className="ecom-week-grid">
          {draft.weekly.map((day) => {
            const expanded = expandedDay === day.weekday;
            return (
              <div className="ecom-week-row" key={day.weekday}>
                <button
                  className="ecom-ops-row-trigger" type="button"
                  aria-expanded={expanded} aria-controls={'ecom-day-edit-' + day.weekday}
                  onClick={() => setExpandedDay(expanded ? null : day.weekday)}
                >
                  <strong>{DAY_NAMES[day.weekday]}</strong>
                  <span className="ecom-week-status">{day.isOpen ? day.opensAt + '–' + day.closesAt : 'Cerrado'}</span>
                  <ChevronDown size={17} aria-hidden="true" />
                </button>
                {expanded && (
                  <div id={'ecom-day-edit-' + day.weekday} className="ecom-ops-row-editor">
                    <label className="ecom-week-day">
                      <input type="checkbox" checked={day.isOpen}
                        onChange={(event) => updateDay(day.weekday, 'isOpen', event.target.checked)} />
                      <span>Abierto este día</span>
                    </label>
                    {day.isOpen && (
                      <div className="ecom-week-times">
                        <label className="ecom-week-time"><span>Apertura</span>
                          <input type="time" value={day.opensAt} aria-label={'Apertura ' + DAY_NAMES[day.weekday]}
                            onChange={(event) => updateDay(day.weekday, 'opensAt', event.target.value)} />
                        </label>
                        <label className="ecom-week-time"><span>Cierre</span>
                          <input type="time" value={day.closesAt} aria-label={'Cierre ' + DAY_NAMES[day.weekday]}
                            onChange={(event) => updateDay(day.weekday, 'closesAt', event.target.value)} />
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="ecom-ops-section-title ecom-exceptions-heading">
          <div><strong>Fechas especiales</strong>
            <small>{draft.exceptions.length} de 60 · Cierres y aperturas excepcionales</small>
          </div>
          <button type="button" className="btn btn-secondary" onClick={addException} disabled={draft.exceptions.length >= 60}>
            <Plus size={16} aria-hidden="true" /> Agregar fecha
          </button>
        </div>
        <div className="ecom-exception-list">
          {draft.exceptions.map((item, index) => (
            <div className="ecom-exception-row" key={index}>
              <div className="ecom-ops-exception-top">
                <button type="button" className="ecom-ops-row-trigger" aria-expanded={expandedException === index}
                  onClick={() => setExpandedException(expandedException === index ? null : index)}>
                  <strong>{item.date || 'Nueva fecha'}</strong>
                  <span className="ecom-week-status">{item.isOpen ? item.opensAt + '–' + item.closesAt : 'Cerrado'}</span>
                  <ChevronDown size={17} aria-hidden="true" />
                </button>
                <button type="button" className="ecom-admin-icon-button" aria-label={'Eliminar fecha ' + (item.date || index + 1)}
                  onClick={() => removeException(index)}><Trash2 size={17} /></button>
              </div>
              {item.reason && <small className="ecom-ops-exception-reason">{item.reason}</small>}
              {expandedException === index && (
                <div className="ecom-ops-row-editor ecom-ops-exception-editor">
                  <label className="form-group"><span className="form-label">Fecha</span>
                    <input className="form-input" type="date" value={item.date} aria-label="Fecha de excepción"
                      onChange={(event) => updateException(index, 'date', event.target.value)} />
                  </label>
                  <label className="ecom-week-day">
                    <input type="checkbox" checked={item.isOpen}
                      onChange={(event) => updateException(index, 'isOpen', event.target.checked)} />
                    <span>Abierto esta fecha</span>
                  </label>
                  {item.isOpen && (
                    <div className="ecom-week-times">
                      <label className="ecom-week-time"><span>Apertura</span>
                        <input type="time" value={item.opensAt} aria-label="Apertura de excepción"
                          onChange={(event) => updateException(index, 'opensAt', event.target.value)} />
                      </label>
                      <label className="ecom-week-time"><span>Cierre</span>
                        <input type="time" value={item.closesAt} aria-label="Cierre de excepción"
                          onChange={(event) => updateException(index, 'closesAt', event.target.value)} />
                      </label>
                    </div>
                  )}
                  <label className="form-group"><span className="form-label">Motivo (opcional)</span>
                    <input className="form-input" type="text" value={item.reason} maxLength={300} aria-label="Razón de excepción"
                      onChange={(event) => updateException(index, 'reason', event.target.value)} />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
        {dirty && confirmed.exceptions.length > draft.exceptions.length && (
          <p className="ecom-ops-hint">Las fechas eliminadas dejarán de aplicarse al guardar.</p>
        )}

        <details className="ecom-ops-timezone">
          <summary><span><strong>Zona horaria</strong><small>{draft.timezone}</small></span><ChevronDown size={17} aria-hidden="true" /></summary>
          <label className="form-group"><span className="form-label">Zona horaria del negocio</span>
            <select className="form-input" value={draft.timezone} onChange={(event) => update('timezone', event.target.value)}>
              {timezoneOptions.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
            </select>
          </label>
        </details>
      </fieldset>

      {validation && dirty && <p className="ecom-inline-error" role="alert">{validation}</p>}
      {error && error !== validation && <p className="ecom-inline-error" role="alert">{error}</p>}
      {dirty && (
        <div className="ecom-ops-save-bar">
          <span>Hay cambios de horarios sin guardar.</span>
          <button className="btn btn-primary" type="button" disabled={saving || Boolean(validation)}
            onClick={submit}>
            {saving ? <LoaderCircle className="ecom-admin-spin" size={17} /> : <Save size={17} />}
            {saving ? 'Guardando…' : 'Guardar horarios'}
          </button>
        </div>
      )}
    </section>
  );
}
