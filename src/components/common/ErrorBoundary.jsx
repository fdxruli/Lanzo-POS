import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("🔥 Error capturado por Boundary:", error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    // Opcional: Limpiar estado global si es necesario
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          padding: '2rem', 
          textAlign: 'center', 
          height: '100vh', 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'center', 
          alignItems: 'center',
          backgroundColor: '#fef2f2'
        }}>
          <h2 style={{ color: '#b91c1c' }}>¡Ups! Algo salió mal.</h2>
          <p style={{ maxWidth: '500px', color: '#7f1d1d', margin: '1rem 0' }}>
            Ocurrió un error inesperado en la aplicación. No te preocupes, tus datos están seguros en la base de datos.
          </p>
          <div style={{ backgroundColor: '#fff', padding: '10px', borderRadius: '4px', border: '1px solid #fca5a5', marginBottom: '1rem', textAlign: 'left', overflow: 'auto', maxWidth: '80%' }}>
             <code style={{ color: '#ef4444', fontSize: '0.85rem' }}>
               {this.state.error && this.state.error.toString()}
             </code>
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button 
              onClick={this.handleReset}
              style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #ccc', cursor: 'pointer' }}
            >
              Intentar recuperar
            </button>
            <button 
              onClick={this.handleReload}
              style={{ padding: '10px 20px', borderRadius: '8px', backgroundColor: '#dc2626', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}
            >
              Recargar Página
            </button>
          </div>
        </div>
      );
    }

    return this.props.children; 
  }
}

export default ErrorBoundary;