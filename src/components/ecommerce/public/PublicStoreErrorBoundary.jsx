import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

class PublicStoreErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="public-store-shell public-store-shell--centered" role="alert">
        <section className="public-store-state public-store-state--card">
          <AlertTriangle aria-hidden="true" size={36} />
          <h1>No se pudo mostrar la tienda</h1>
          <p>Ocurrió un problema inesperado. Recarga la página para intentarlo nuevamente.</p>
          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={() => window.location.reload()}
          >
            <RefreshCw aria-hidden="true" size={18} />
            Recargar
          </button>
        </section>
      </main>
    );
  }
}

export default PublicStoreErrorBoundary;
