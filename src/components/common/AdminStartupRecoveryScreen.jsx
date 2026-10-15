const SCREEN_COPY = Object.freeze({
  recovering: {
    title: 'Revisando los archivos de Lanzo POS',
    message: 'Estamos comprobando los recursos instalados. Esto puede tardar unos segundos.',
  },
  updateError: {
    title: 'No se pudo completar la actualización',
    message: 'No se pudo actualizar la aplicación. Comprueba la conexión y vuelve a intentarlo.',
  },
  startupError: {
    title: 'No se pudo iniciar Lanzo POS',
    message: 'Esta pantalla no ejecutó una limpieza de datos. No podemos confirmar el resultado de operaciones pendientes.',
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
