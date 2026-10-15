import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { recoverFromPublicChunkError } from '../../../utils/publicChunkRecovery';

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
      <main className="public-store-shell public-store-shell--centered" role="alert">
        <section className="public-store-state public-store-state--card">
          <AlertTriangle aria-hidden="true" size={36} />
          <h1>No pudimos restaurar la tienda</h1>
          <p>No borraremos el carrito. Si un cambio no alcanzó a guardarse, esta pantalla no puede confirmar su estado.</p>
          <button
            type="button"
            className="ui-button ui-button--primary"
            onClick={this.handleRetry}
            disabled={this.retryCount >= 1}
          >
            <RefreshCw aria-hidden="true" size={18} />
            {this.retryCount >= 1 ? 'Reintento usado' : 'Intentar de nuevo'}
          </button>
          <button
            type="button"
            className="ui-button"
            onClick={() => (this.props.reload || (() => window.location.reload()))()}
          >
            <RefreshCw aria-hidden="true" size={18} />
            Actualizar tienda
          </button>
        </section>
      </main>
    );
  }
}

export default PublicStoreErrorBoundary;
