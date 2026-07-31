import React from 'react';

const SCREEN_COPY = Object.freeze({
  recovering: {
    title: 'Lanzo POS se actualizó',
    message: 'Estamos preparando la versión más reciente. Esto puede tardar unos segundos.',
  },
  updateError: {
    title: 'No se pudo completar la actualización',
    message: 'Actualiza los archivos de Lanzo POS para volver a entrar de forma segura.',
  },
  startupError: {
    title: 'No se pudo iniciar Lanzo POS',
    message: 'No se modificaron tus datos. Intenta cargar nuevamente la aplicación.',
  },
});

export default function AdminStartupRecoveryScreen({
  mode = 'startupError',
  onRetry,
}) {
  const copy = SCREEN_COPY[mode] || SCREEN_COPY.startupError;
  const recovering = mode === 'recovering';

  return (
    <main className="public-store-shell public-store-shell--centered" role="alert" aria-live="assertive">
      <section className="public-store-state public-store-state--card">
        <h1>{copy.title}</h1>
        <p>{copy.message}</p>
        {recovering ? (
          <p role="status" aria-live="polite">Preparando actualización…</p>
        ) : (
          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={onRetry}
          >
            Actualizar Lanzo POS
          </button>
        )}
      </section>
    </main>
  );
}
