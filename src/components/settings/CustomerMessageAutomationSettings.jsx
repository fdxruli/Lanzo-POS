import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useSettingsAccess } from '../../services/auth/useSettingsAccess';
import { getCommercialPlanName } from '../../utils/planDisplay';
import {
  CUSTOMER_MESSAGE_REMINDER_DEFAULTS,
  CUSTOMER_MESSAGE_REMINDER_STATUS_LABELS,
  CUSTOMER_MESSAGE_CLOUD_OUTBOX_STATUS_LABELS,
  getCustomerMessageReminderErrorCopy,
  isCloudCustomerMessagingEnabled,
  syncCustomerMessageOutbox,
  listCustomerMessageReminders,
  saveCustomerMessageReminderConfig,
  cancelCustomerMessageReminder,
  rescheduleCustomerMessageReminder
} from '../../services/customerMessaging';
import './CustomerMessageAutomationSettings.css';

const formatDate = (value, timeZone = 'America/Mexico_City') => {
  if (!value) return 'Sin fecha';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Fecha no disponible';
  return parsed.toLocaleString('es-MX', { timeZone });
};

const normalizeConfig = (value = {}) => ({
  ...CUSTOMER_MESSAGE_REMINDER_DEFAULTS,
  ...value,
  enabled: Boolean(value.enabled),
  timeZone: value.timeZone || value.time_zone || CUSTOMER_MESSAGE_REMINDER_DEFAULTS.timeZone,
  localTime: value.localTime || value.local_time || CUSTOMER_MESSAGE_REMINDER_DEFAULTS.localTime,
  maxAttempts: Number(value.maxAttempts ?? value.max_attempts ?? CUSTOMER_MESSAGE_REMINDER_DEFAULTS.maxAttempts),
  backoffMinutes: Number(value.backoffMinutes ?? value.backoff_minutes ?? CUSTOMER_MESSAGE_REMINDER_DEFAULTS.backoffMinutes)
});

const toDateTimeLocal = (value) => {
  const parsed = new Date(value || '');
  return Number.isNaN(parsed.getTime()) ? '' : new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60_000)).toISOString().slice(0, 16);
};

export default function CustomerMessageAutomationSettings() {
  const licenseDetails = useAppStore((state) => state.licenseDetails);
  const access = useSettingsAccess();
  const cloudEnabled = isCloudCustomerMessagingEnabled(licenseDetails);
  const canManage = cloudEnabled && access.isAdmin;
  const [config, setConfig] = useState(CUSTOMER_MESSAGE_REMINDER_DEFAULTS);
  const [reminders, setReminders] = useState([]);
  const [outboxRecords, setOutboxRecords] = useState([]);
  const [rescheduleValues, setRescheduleValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    if (!cloudEnabled) return;
    setLoading(true);
    const [result, outboxResult] = await Promise.all([
      listCustomerMessageReminders({ licenseDetails, actorType: access.actorType }),
      syncCustomerMessageOutbox({ licenseDetails, actorType: access.actorType })
    ]);
    if (result.ok) {
      setConfig(normalizeConfig(result.config || {}));
      setReminders(result.reminders || []);
      if (outboxResult.ok) setOutboxRecords(outboxResult.records || []);
      setStatus('');
    } else setStatus(getCustomerMessageReminderErrorCopy(result.code));
    setLoading(false);
  }, [access.actorType, cloudEnabled, licenseDetails]);

  useEffect(() => { load(); }, [load]);

  const update = (field, value) => setConfig((current) => normalizeConfig({ ...current, [field]: value }));

  const save = async () => {
    setLoading(true);
    const result = await saveCustomerMessageReminderConfig({
      licenseDetails,
      actorType: access.actorType,
      enabled: config.enabled,
      timeZone: config.timeZone,
      localTime: config.localTime,
      maxAttempts: Number(config.maxAttempts),
      backoffMinutes: Number(config.backoffMinutes)
    });
    if (result.ok) {
      setConfig(normalizeConfig(result.config || config));
      setStatus(config.enabled ? 'Recordatorios activados.' : 'Recordatorios pausados. El historial se conserva.');
      await load();
    } else setStatus(getCustomerMessageReminderErrorCopy(result.code));
    setLoading(false);
  };

  const cancel = async (reminder) => {
    setLoading(true);
    const result = await cancelCustomerMessageReminder(reminder.id, { licenseDetails, actorType: access.actorType });
    if (result.ok) {
      setStatus('Recordatorio cancelado. El historial se conserva.');
      await load();
    } else setStatus(getCustomerMessageReminderErrorCopy(result.code));
    setLoading(false);
  };

  const reschedule = async (reminder) => {
    const selected = rescheduleValues[reminder.id];
    if (!selected) return;
    setLoading(true);
    const result = await rescheduleCustomerMessageReminder(
      reminder.id,
      new Date(selected).toISOString(),
      { licenseDetails, actorType: access.actorType }
    );
    if (result.ok) {
      setStatus('Recordatorio reprogramado. El historial se conserva.');
      await load();
    } else setStatus(getCustomerMessageReminderErrorCopy(result.code));
    setLoading(false);
  };

  return (
    <section className="ui-card customer-message-automation" aria-label="Sincronización y recordatorios">
      <div className="customer-message-automation__header">
        <div>
          <h3>Sincronización y recordatorios</h3>
          <p>Plan actual: {getCommercialPlanName(licenseDetails)}.</p>
        </div>
        <span className={`customer-message-automation__badge ${cloudEnabled ? 'is-enabled' : 'is-disabled'}`}>
          {cloudEnabled ? 'Cloud disponible' : 'Requiere Lanzo Nube'}
        </span>
      </div>

      {!cloudEnabled ? (
        <p role="note">Free, Local y Básico conservan el outbox en este dispositivo. El historial sincronizado y los recordatorios requieren Lanzo Nube.</p>
      ) : (
        <>
          <div className="customer-message-automation__summary">
            <strong>Outbox cloud</strong>
            <span>Los cambios confirmados se comparten entre dispositivos del mismo negocio.</span>
            <span>Los estados son honestos: preparado, compartido, descargado, cancelado o error. Nunca se afirma entrega.</span>
          </div>
          <div className="customer-message-automation__list">
            <div className="customer-message-automation__list-header">
              <h4>Historial cloud del outbox</h4>
              <span>{outboxRecords.length} comprobante(s)</span>
            </div>
            {outboxRecords.length === 0 && <p className="customer-message-automation__empty">Aún no hay comprobantes sincronizados.</p>}
            {outboxRecords.slice(0, 10).map((record) => (
              <article className="customer-message-automation__item" key={record.idempotencyKey}>
                <div>
                  <strong>{record.humanReference || record.eventType || 'Comprobante'}</strong>
                  <span>{CUSTOMER_MESSAGE_CLOUD_OUTBOX_STATUS_LABELS[record.cloudStatus || record.status] || 'Estado no disponible'}</span>
                  <small>{formatDate(record.cloudUpdatedAt || record.updatedAt)}</small>
                </div>
              </article>
            ))}
          </div>
          <div className="customer-message-automation__config">
            <h4>Recordatorios de cuentas pendientes</h4>
            <p>Sin proveedor externo configurado, el recordatorio queda programado o listo para preparar.</p>
            <label>
              <input type="checkbox" checked={Boolean(config.enabled)} disabled={!canManage || loading} onChange={(event) => update('enabled', event.target.checked)} />
              Activar recordatorios cloud
            </label>
            <label>Zona horaria
              <input value={config.time_zone || config.timeZone} disabled={!canManage || loading} onChange={(event) => update('timeZone', event.target.value)} placeholder="America/Mexico_City" />
            </label>
            <label>Hora local
              <input type="time" value={config.local_time || config.localTime} disabled={!canManage || loading} onChange={(event) => update('localTime', event.target.value)} />
            </label>
            <label>Máximo de intentos
              <input type="number" min="1" max="10" value={config.max_attempts || config.maxAttempts} disabled={!canManage || loading} onChange={(event) => update('maxAttempts', event.target.value)} />
            </label>
            {canManage && <button type="button" disabled={loading} onClick={save}>Guardar configuración</button>}
            {!access.isAdmin && <p role="note">Staff puede consultar estados, pero no modificar automatizaciones.</p>}
          </div>
          <div className="customer-message-automation__list">
            <div className="customer-message-automation__list-header">
              <h4>Historial de recordatorios</h4>
              <button type="button" disabled={loading} onClick={load}>Actualizar</button>
            </div>
            {reminders.length === 0 && <p className="customer-message-automation__empty">No hay recordatorios programados.</p>}
            {reminders.map((reminder) => (
              <article className="customer-message-automation__item" key={reminder.id}>
                <div>
                  <strong>{reminder.customer_name || 'Cliente'}</strong>
                  <span>Saldo confirmado: {reminder.current_balance ?? '—'}</span>
                  <span>{CUSTOMER_MESSAGE_REMINDER_STATUS_LABELS[reminder.status] || 'Estado no disponible'} · {formatDate(reminder.scheduled_for, reminder.time_zone)}</span>
                  {!reminder.provider_configured && <small>Listo para preparar; no hay proveedor externo configurado.</small>}
                </div>
                {canManage && ['programado', 'listo_para_preparar', 'reintento_pendiente'].includes(reminder.status) && (
                  <div className="customer-message-automation__actions">
                    <input
                      type="datetime-local"
                      value={rescheduleValues[reminder.id] || toDateTimeLocal(reminder.scheduled_for)}
                      disabled={loading}
                      onChange={(event) => setRescheduleValues((current) => ({ ...current, [reminder.id]: event.target.value }))}
                      aria-label={`Nueva fecha para ${reminder.customer_name || 'cliente'}`}
                    />
                    <button type="button" disabled={loading} onClick={() => reschedule(reminder)}>Reprogramar</button>
                    <button type="button" disabled={loading} onClick={() => cancel(reminder)}>Cancelar</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {status && <p role="status" className="customer-message-automation__status">{status}</p>}
    </section>
  );
}
