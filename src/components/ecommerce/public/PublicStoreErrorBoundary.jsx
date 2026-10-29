import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { recoverFromPublicChunkError } from '../../../utils/publicChunkRecovery';
import './PublicStoreErrorBoundary.css';

class PublicStoreErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.retryCount = 0;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    recoverFromPublicChunkError(error);
  }

  componentDidUpdate() {
    if (!this.state.hasError) this.retryCount = 0;
  }

  handleRetry = () => {
    if (this.retryCount >= 1) return;
    this.retryCount += 1;
    window.dispatchEvent(new Event('lanzo:public-store-recover'));
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main className="public-store-error" role="alert" aria-live="assertive">
        <section className="public-store-error__content">
          <span className="public-store-error__icon" aria-hidden="true">
            <AlertTriangle size={24} />
          </span>
          <p className="public-store-error__eyebrow">Tienda en línea</p>
          <h1>No pudimos cargar esta tienda</h1>
          <p>
            Puedes intentar cargarla nuevamente. Esta pantalla no elimina el carrito, pero no puede confirmar si un cambio pendiente alcanzó a guardarse.
          </p>
          {this.retryCount >= 1 && (
            <p className="public-store-error__status" role="status">
              El reintento ya se utilizó. Vuelve a intentar más tarde.
            </p>
          )}
          <button
            type="button"
            className="ui-button ui-button--primary public-store-error__action"
            onClick={this.handleRetry}
            disabled={this.retryCount >= 1}
          >
            <RefreshCw size={18} aria-hidden="true" />
            {this.retryCount >= 1 ? 'Reintento utilizado' : 'Reintentar tienda'}
          </button>
        </section>
      </main>
    );
  }
}

export default PublicStoreErrorBoundary;
