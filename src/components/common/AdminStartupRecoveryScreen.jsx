import { AlertTriangle, RefreshCw } from 'lucide-react';
import './AdminStartupRecoveryScreen.css';

const SCREEN_COPY = Object.freeze({
  recovering: {
    title: 'Revisando los archivos de Lanzo POS',
    message: 'Estamos comprobando los recursos instalados. Esto puede tardar unos segundos.',
  },
  updateError: {
    title: 'No se pudo confirmar la recuperación',
    message: 'Lanzo no pudo completar la recuperación de esta versión. Revisa cualquier operación pendiente antes de volver a intentarlo.',
  },
  startupError: {
    title: 'No pudimos iniciar Lanzo POS',
    message: 'La aplicación no pudo completar su preparación. No podemos confirmar el estado de operaciones pendientes desde esta pantalla.',
  },
});

export default function AdminStartupRecoveryScreen({
  mode = 'startupError',
  onRetry,
}) {
  const copy = SCREEN_COPY[mode] || SCREEN_COPY.startupError;
  const recovering = mode === 'recovering';
  const isUpdateError = mode === 'updateError';

  return (
    <main
      className="admin-startup-recovery"
      role={recovering ? 'status' : 'alert'}
      aria-live={recovering ? 'polite' : 'assertive'}
      aria-labelledby="admin-startup-recovery-title"
    >
      <section className="admin-startup-recovery__layout">
        <div className="admin-startup-recovery__content">
          <span className="admin-startup-recovery__icon" aria-hidden="true">
            {recovering
              ? <RefreshCw className="admin-startup-recovery__spin" size={24} />
              : <AlertTriangle size={24} />}
          </span>
          <p className="admin-startup-recovery__eyebrow">Centro de recuperación</p>
          <h1 id="admin-startup-recovery-title">{copy.title}</h1>
          <p className="admin-startup-recovery__message">{copy.message}</p>
          {!recovering && onRetry && (
            <button
              type="button"
              className="ui-button ui-button--primary admin-startup-recovery__action"
              onClick={onRetry}
            >
              <RefreshCw size={18} aria-hidden="true" />
              {isUpdateError ? 'Reintentar recuperación' : 'Reintentar inicio'}
            </button>
          )}
        </div>
        <aside className="admin-startup-recovery__guidance">
          <h2>Qué puedes hacer</h2>
          <p>
            {recovering
              ? 'Mantén esta pestaña abierta mientras termina la comprobación.'
              : 'Si una venta o un cobro quedó pendiente, verifica su resultado antes de volver a intentarlo.'}
          </p>
          <p>Este flujo no solicita borrar datos del navegador.</p>
        </aside>
      </section>
    </main>
  );
}
