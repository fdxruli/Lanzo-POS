import React from 'react';
class LabLoadBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main style={{ padding: '2rem' }}><h1>No se pudo cargar el laboratorio QA</h1><p>La prueba no inició. Revisa el acceso al Preview y la conexión. No se cambió la ruta ni se tocaron datos del POS.</p><button onClick={() => window.location.reload()}>Volver a cargar el laboratorio</button></main>;
    return this.props.children;
  }
}
export default LabLoadBoundary;
