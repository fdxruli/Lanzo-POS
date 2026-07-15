import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { saveOperatingSchedule } from '../../services/ecommerce/ecommerceAdminService';
import { getAvailabilityDetail, getAvailabilityLabel } from '../../utils/ecommerceAvailability';

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
  const byDay = new Map(weekly.map((item) => [Number(item.weekday), item]));
  return DAY_ORDER.map((weekday) => ({
    weekday,
    isOpen: byDay.get(weekday)?.isOpen === true,
    opensAt: byDay.get(weekday)?.opensAt || '09:00',
    closesAt: byDay.get(weekday)?.closesAt || '18:00'
  }));
};

const scheduleError = (weekly) => {
  const invalid = weekly.find((day) => day.isOpen && day.opensAt >= day.closesAt);
  return invalid ? `${DAY_NAMES[invalid.weekday]}: la apertura debe ser anterior al cierre.` : '';
};

export default function EcommerceOperatingHoursSettings({ data, onSaved }) {
  const browserTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Mexico_City',
    []
  );
  const [enabled, setEnabled] = useState(false);
  const [timezone, setTimezone] = useState('America/Mexico_City');
  const [weekly, setWeekly] = useState(() => completeWeek());
  const [exceptions, setExceptions] = useState([]);
  const [saving, setSaving] = useState(false);
  const validation = scheduleError(weekly);
  const timezoneOptions = Array.from(new Set([...BASE_TIMEZONES, browserTimezone, timezone]));

  useEffect(() => {
    setEnabled(data?.businessHoursEnabled === true);
    setTimezone(data?.timezone || browserTimezone);
    setWeekly(completeWeek(data?.hours?.weekly));
    setExceptions(Array.isArray(data?.hours?.exceptions) ? data.hours.exceptions : []);
  }, [browserTimezone, data]);

  const updateDay = (weekday, field, value) => {
    setWeekly((current) => current.map((day) => (
      day.weekday === weekday ? { ...day, [field]: value } : day
    )));
  };

  const addException = () => {
    if (exceptions.length >= 60) return toast.error('Puedes guardar hasta 60 excepciones.');
    setExceptions((current) => [...current, {
      date: '', isOpen: false, opensAt: '09:00', closesAt: '18:00', reason: ''
    }]);
  };

  const updateException = (index, field, value) => {
    setExceptions((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  };

  const submit = async () => {
    if (validation) return toast.error(validation);
    if (enabled && !weekly.some((day) => day.isOpen)) {
      return toast.error('Configura al menos un día abierto antes de aplicar el horario.');
    }
    if (exceptions.some((item) => !item.date || (item.isOpen && item.opensAt >= item.closesAt))) {
      return toast.error('Revisa las fechas y horas de las excepciones.');
    }
    setSaving(true);
    const result = await saveOperatingSchedule({
      timezone,
      businessHoursEnabled: enabled,
      weekly,
      exceptions
    });
    setSaving(false);
    if (!result.success) return toast.error(result.message);
    onSaved?.(result);
    toast.success('Horario de atención guardado.');
  };

  return (
    <section className="ui-card ecom-operations-card" aria-labelledby="ecom-hours-title">
      <div className="ecom-admin-card-heading">
        <div>
          <span className="ecom-admin-eyebrow">Disponibilidad operativa</span>
          <h3 id="ecom-hours-title">Horarios de atención</h3>
          <p>El servidor usa esta zona horaria para aceptar o bloquear pedidos.</p>
        </div>
        <CalendarClock size={23} />
      </div>

      <div className="ecom-availability-summary" role="status" aria-live="polite">
        <strong>{getAvailabilityLabel(data?.availability)}</strong>
        <span>{getAvailabilityDetail(data?.availability)}</span>
      </div>

      <label className="ecom-operation-toggle">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span><strong>Aplicar horario a los pedidos</strong><small>Si está apagado, el horario no bloquea pedidos.</small></span>
      </label>

      <label className="form-group">
        <span className="form-label">Zona horaria del negocio</span>
        <select className="form-input" value={timezone} onChange={(event) => setTimezone(event.target.value)}>
          {timezoneOptions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>

      <div className="ecom-week-grid">
        {weekly.map((day) => (
          <div className="ecom-week-row" key={day.weekday}>
            <label className="ecom-week-day">
              <input
                type="checkbox"
                checked={day.isOpen}
                onChange={(event) => updateDay(day.weekday, 'isOpen', event.target.checked)}
              />
              <strong>{DAY_NAMES[day.weekday]}</strong>
            </label>
            <span>{day.isOpen ? 'Abierto' : 'Cerrado'}</span>
            <input
              type="time" value={day.opensAt} disabled={!day.isOpen}
              aria-label={`Apertura ${DAY_NAMES[day.weekday]}`}
              onChange={(event) => updateDay(day.weekday, 'opensAt', event.target.value)}
            />
            <input
              type="time" value={day.closesAt} disabled={!day.isOpen}
              aria-label={`Cierre ${DAY_NAMES[day.weekday]}`}
              onChange={(event) => updateDay(day.weekday, 'closesAt', event.target.value)}
            />
          </div>
        ))}
      </div>
      {validation ? <p className="ecom-inline-error" role="alert">{validation}</p> : null}

      <div className="ecom-exceptions-heading">
        <div><strong>Excepciones por fecha</strong><small>Una excepción reemplaza el horario semanal.</small></div>
        <button type="button" className="btn btn-secondary" onClick={addException}><Plus size={16} /> Agregar</button>
      </div>
      <div className="ecom-exception-list">
        {exceptions.map((item, index) => (
          <div className="ecom-exception-row" key={`${item.date}-${index}`}>
            <input type="date" value={item.date} aria-label="Fecha de excepción" onChange={(event) => updateException(index, 'date', event.target.value)} />
            <label><input type="checkbox" checked={item.isOpen} onChange={(event) => updateException(index, 'isOpen', event.target.checked)} /> Abierto</label>
            <input type="time" value={item.opensAt || '09:00'} disabled={!item.isOpen} aria-label="Apertura de excepción" onChange={(event) => updateException(index, 'opensAt', event.target.value)} />
            <input type="time" value={item.closesAt || '18:00'} disabled={!item.isOpen} aria-label="Cierre de excepción" onChange={(event) => updateException(index, 'closesAt', event.target.value)} />
            <input type="text" value={item.reason || ''} maxLength={300} placeholder="Razón opcional" aria-label="Razón de excepción" onChange={(event) => updateException(index, 'reason', event.target.value)} />
            <button type="button" className="ecom-admin-icon-button" aria-label="Eliminar excepción" onClick={() => setExceptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>
          </div>
        ))}
      </div>

      <div className="ecom-admin-form-actions">
        <span>Disponible en Plan Free y Lanzo Nube.</span>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={submit}>
          {saving ? <LoaderCircle className="ecom-admin-spin" size={17} /> : <Save size={17} />} Guardar horarios
        </button>
      </div>
    </section>
  );
}
