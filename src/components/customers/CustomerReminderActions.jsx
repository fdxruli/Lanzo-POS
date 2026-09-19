import { useEffect, useState } from 'react';
import { CalendarClock, RotateCcw, XCircle } from 'lucide-react';
import { CUSTOMER_MESSAGE_REMINDER_STATUS_LABELS } from '../../services/customerMessaging';
import { getSafeCustomerDebt } from '../../utils/customerUtils';
import './CustomerReminderActions.css';

const ACTIVE_REMINDER_STATUSES = new Set([
    'programado',
    'listo_para_preparar',
    'reintento_pendiente',
    'preparado'
]);

const toDateTimeLocal = (value) => {
    const parsed = new Date(value || '');
    if (Number.isNaN(parsed.getTime())) return '';

    return new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60_000))
        .toISOString()
        .slice(0, 16);
};

const formatReminderDate = (value, timeZone) => {
    const parsed = new Date(value || '');
    if (Number.isNaN(parsed.getTime())) return 'Fecha no disponible';

    return parsed.toLocaleString('es-MX', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timeZone || 'America/Mexico_City'
    });
};

const reminderStatusLabel = (status) => (
    CUSTOMER_MESSAGE_REMINDER_STATUS_LABELS[status] || 'Estado no disponible'
);

export default function CustomerReminderActions({
    customer,
    reminder = null,
    cloudEnabled = false,
    configEnabled = false,
    configError = '',
    canManage = false,
    loadingAction = '',
    feedback = null,
    onSchedule,
    onCancel,
    onReschedule
}) {
    const [rescheduleValue, setRescheduleValue] = useState(() => toDateTimeLocal(reminder?.scheduled_for));
    const hasDebt = getSafeCustomerDebt(customer?.debt) > 0;
    const isBusy = Boolean(loadingAction);
    const hasReminder = Boolean(reminder);
    const isActive = ACTIVE_REMINDER_STATUSES.has(reminder?.status);
    const actionDisabled = isBusy || (loadingAction && loadingAction !== customer?.id);

    useEffect(() => {
        setRescheduleValue(toDateTimeLocal(reminder?.scheduled_for));
    }, [reminder?.id, reminder?.scheduled_for]);

    if (!cloudEnabled) return null;

    if (configError) {
        return (
            <div className="customer-reminder-actions customer-reminder-actions--error" role="status">
                {configError}
            </div>
        );
    }

    if (!hasDebt) {
        return (
            <div className="customer-reminder-actions customer-reminder-actions--muted" role="note">
                Este cliente no tiene saldo pendiente.
            </div>
        );
    }

    const handleReschedule = () => {
        if (!rescheduleValue || !onReschedule || !reminder) return;
        onReschedule(customer, reminder, rescheduleValue);
    };

    return (
        <div className="customer-reminder-actions" aria-label={`Recordatorios de ${customer?.name || 'cliente'}`}>
            {hasReminder ? (
                <div className="customer-reminder-actions__status">
                    <div className="customer-reminder-actions__status-title">
                        <CalendarClock size={16} aria-hidden="true" />
                        <strong>Recordatorio: {reminderStatusLabel(reminder.status)}</strong>
                    </div>
                    <span>
                        Programado para: {formatReminderDate(reminder.scheduled_for, reminder.time_zone)}
                    </span>
                    {reminder.duplicate && <span>Este cliente ya tiene un recordatorio programado.</span>}
                </div>
            ) : (
                <div className="customer-reminder-actions__status">
                    <strong>Recordatorios cloud</strong>
                </div>
            )}

            {!hasReminder && !configEnabled && canManage && (
                <>
                    <button type="button" className="ui-button ui-button--secondary" disabled>
                        <CalendarClock size={16} aria-hidden="true" />
                        Programar recordatorio
                    </button>
                    <span className="customer-reminder-actions__hint">
                        Activa primero los recordatorios cloud en Configuración.
                    </span>
                </>
            )}

            {!hasReminder && configEnabled && canManage && (
                <button
                    type="button"
                    className="ui-button ui-button--primary customer-reminder-actions__schedule"
                    onClick={() => onSchedule?.(customer)}
                    disabled={actionDisabled}
                >
                    <CalendarClock size={16} aria-hidden="true" />
                    {loadingAction === customer?.id ? 'Programando...' : 'Programar recordatorio'}
                </button>
            )}

            {!hasReminder && !canManage && (
                <span className="customer-reminder-actions__hint">
                    Staff puede consultar el estado, pero no programar recordatorios.
                </span>
            )}

            {hasReminder && canManage && (
                <div className="customer-reminder-actions__controls">
                    <label>
                        Nueva fecha
                        <input
                            type="datetime-local"
                            value={rescheduleValue}
                            disabled={actionDisabled || !configEnabled}
                            onChange={(event) => setRescheduleValue(event.target.value)}
                            aria-label={`Nueva fecha del recordatorio para ${customer?.name || 'cliente'}`}
                        />
                    </label>
                    <button
                        type="button"
                        className="ui-button ui-button--secondary"
                        onClick={handleReschedule}
                        disabled={actionDisabled || !configEnabled || !rescheduleValue}
                    >
                        <RotateCcw size={16} aria-hidden="true" />
                        {loadingAction === customer?.id ? 'Guardando...' : 'Reprogramar'}
                    </button>
                    {isActive && (
                        <button
                            type="button"
                            className="ui-button ui-button--danger"
                            onClick={() => onCancel?.(customer, reminder)}
                            disabled={actionDisabled}
                        >
                            <XCircle size={16} aria-hidden="true" />
                            {loadingAction === customer?.id ? 'Cancelando...' : 'Cancelar'}
                        </button>
                    )}
                    {!configEnabled && (
                        <span className="customer-reminder-actions__hint">
                            Activa primero los recordatorios cloud en Configuración.
                        </span>
                    )}
                </div>
            )}

            {hasReminder && !canManage && (
                <span className="customer-reminder-actions__hint">
                    Staff puede consultar el estado, pero no modificar este recordatorio.
                </span>
            )}

            {feedback?.message && (
                <span className={`customer-reminder-actions__feedback is-${feedback.type || 'info'}`} role="status">
                    {feedback.message}
                </span>
            )}
        </div>
    );
}
