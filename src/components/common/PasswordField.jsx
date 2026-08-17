import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import './PasswordField.css';

export default function PasswordField({
  id,
  label = 'Contraseña',
  value,
  onChange,
  disabled = false,
  required = true,
  fieldClassName = '',
  labelClassName = ''
}) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className={`auth-password-field-group ${fieldClassName}`.trim()}>
      <label className={labelClassName} htmlFor={id}>{label}</label>
      <div className="auth-password-field">
        <input
          id={id}
          className="form-input"
          type={isVisible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete="current-password"
          disabled={disabled}
          required={required}
        />
        <button
          type="button"
          className="auth-password-toggle"
          onClick={() => setIsVisible((visible) => !visible)}
          disabled={disabled}
          aria-label={isVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-pressed={isVisible}
          title={isVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          {isVisible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
