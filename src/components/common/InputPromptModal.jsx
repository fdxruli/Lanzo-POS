import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './InputPromptModal.css';

function InputPromptModal({
  title = 'Ingresar dato',
  message = 'Escribe la información solicitada.',
  placeholder = '',
  confirmButtonText = 'Guardar',
  cancelButtonText = 'Cancelar',
  required = false,
  defaultValue = '',
  onResolve
}) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const resolveCancel = () => {
    onResolve(null);
  };

  const resolveConfirm = () => {
    const trimmedValue = value.trim();

    if (required && !trimmedValue) {
      setError('Ingresa un identificador para continuar.');
      return;
    }

    onResolve(trimmedValue);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    resolveConfirm();
  };

  const handleBackdropClick = () => {
    if (required) {
      setError('Usa Cancelar o escribe un identificador para continuar.');
      return;
    }

    resolveCancel();
  };

  return (
    <div
      className="ui-modal input-prompt-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="input-prompt-title"
      style={{ display: 'flex' }}
      onClick={handleBackdropClick}
    >
      <form className="ui-modal__content input-prompt-modal__content" onSubmit={handleSubmit} onClick={(event) => event.stopPropagation()}>
        <h2 id="input-prompt-title" className="ui-modal__title">
          {title}
        </h2>

        {message && (
          <p className="ui-modal__body input-prompt-modal__message">
            {message}
          </p>
        )}

        <div className="form-group input-prompt-modal__field">
          <input
            ref={inputRef}
            className="form-input"
            type="text"
            value={value}
            placeholder={placeholder}
            onChange={(event) => {
              setValue(event.target.value);
              if (error) setError('');
            }}
            aria-invalid={Boolean(error)}
          />
          {error && (
            <p className="ui-inline-error input-prompt-modal__error" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="ui-modal__actions input-prompt-modal__actions">
          <button type="button" className="ui-button ui-button--ghost" onClick={resolveCancel}>
            {cancelButtonText}
          </button>
          <button type="submit" className="ui-button ui-button--primary">
            {confirmButtonText}
          </button>
        </div>
      </form>
    </div>
  );
}

export function showInputPromptModal(options = {}) {
  if (typeof document === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const mountNode = document.createElement('div');
    document.body.appendChild(mountNode);

    const root = createRoot(mountNode);

    const cleanup = (value) => {
      root.unmount();
      mountNode.remove();
      resolve(value);
    };

    root.render(<InputPromptModal {...options} onResolve={cleanup} />);
  });
}

export default InputPromptModal;
