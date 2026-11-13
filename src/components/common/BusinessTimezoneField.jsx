import { useId, useState } from 'react';
import { isValidBusinessTimezone } from '../../utils/layawayCalendar';

const COMMON_TIMEZONES = [
  'America/Merida', 'America/Mexico_City', 'America/Cancun', 'America/Monterrey',
  'America/Chihuahua', 'America/Mazatlan', 'America/Hermosillo', 'America/Tijuana',
  'America/Matamoros', 'America/New_York', 'America/Los_Angeles'
];

export default function BusinessTimezoneField({ value, onChange, required = false, disabled = false, showError = false, inputRef }) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const [detectedZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || '');
  const timezone = value.trim();
  const error = (touched || showError) && (timezone || required) && !isValidBusinessTimezone(timezone)
    ? (timezone
      ? 'Ingresa una zona horaria IANA válida, como America/Merida.'
      : 'Selecciona la zona horaria de tu negocio para continuar.')
    : '';

  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>
        Zona horaria del negocio{required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        ref={inputRef}
        id={id}
        className="form-input"
        type="text"
        list={`${id}-options`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setTouched(true)}
        placeholder="America/Merida"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={128}
        required={required}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-help ${id}-error` : `${id}-help`}
      />
      <datalist id={`${id}-options`}>
        {COMMON_TIMEZONES.map((zone) => <option key={zone} value={zone} />)}
      </datalist>
      <small id={`${id}-help`} className="form-help-text">
        La zona horaria permite gestionar correctamente fechas y horarios de tu negocio y es necesaria para algunas funciones de LANZO POS
      </small>
      {error && <small id={`${id}-error`} className="form-help-text validation-message error" role="alert">{error}</small>}
      {!timezone && isValidBusinessTimezone(detectedZone) && (
        <button type="button" className="ui-button ui-button--ghost" disabled={disabled} onClick={() => onChange(detectedZone)}>
          Usar zona detectada ({detectedZone})
        </button>
      )}
    </div>
  );
}
