import React, { useState } from 'react';
import { useCaja } from '../hooks/useCaja'; // Importamos nuestro hook
import './CajaPage.css';

// (Aún no creamos estos componentes, pero este es el plan)
// import { OpenCajaModal, CloseCajaModal, EntradaCajaModal, SalidaCajaModal } from '../components/common/CajaModals';

// --- Componentes de UI (definidos aquí mismo para simplicidad) ---

// UI para cuando la caja está CERRADA
const CajaCerradaUI = ({ onAbrirClick }) => (
  <div id="caja-status-container" className="stat-card">
    <h3>Caja Cerrada</h3>
    <p>Abre una caja para comenzar a vender.</p>
    <div id="caja-actions-container">
      <button id="open-caja-btn" className="btn btn-save" onClick={onAbrirClick}>
        Abrir Caja
      </button>
    </div>
  </div>
);

// UI para cuando la caja está ABIERTA
const CajaAbiertaUI = ({ caja, onCerrarClick, onEntradaClick, onSalidaClick }) => (
  <>
    <div id="caja-status-container" className="stat-card">
      <h3>Caja Abierta</h3>
      <p><strong>Apertura:</strong> {new Date(caja.fecha_apertura).toLocaleString()}</p>
      <p><strong>Monto Inicial:</strong> $${caja.monto_inicial.toFixed(2)}</p>
      <p style={{ color: 'green' }}><strong>Entradas:</strong> $${caja.entradas_efectivo.toFixed(2)}</p>
      <p style={{ color: 'red' }}><strong>Salidas:</strong> $${caja.salidas_efectivo.toFixed(2)}</p>
    </div>
    <div id="caja-actions-container" className="stat-card">
      <button id="close-caja-btn" className="btn btn-process" onClick={onCerrarClick}>
        Cerrar Caja
      </button>
      <button id="add-entrada-btn" className="btn btn-save" style={{ marginTop: '10px' }} onClick={onEntradaClick}>
        + Registrar Entrada
      </button>
      <button id="add-salida-btn" className="btn btn-delete" style={{ marginTop: '10px' }} onClick={onSalidaClick}>
        - Registrar Salida
      </button>
    </div>
  </>
);

// UI para el HISTORIAL
const HistorialCajaUI = ({ historial }) => (
  <div id="caja-history-container" className="sales-history-container">
    <h3 className="subtitle">Historial de Cajas</h3>
    {historial.length === 0 ? (
      <p>No hay historial de cajas.</p>
    ) : (
      <div className="history-list">
        {historial.map(c => (
          <div key={c.id} className="history-item">
            <p><strong>Apertura:</strong> {new Date(c.fecha_apertura).toLocaleString()}</p>
            <p><strong>Cierre:</strong> {new Date(c.fecha_cierre).toLocaleString()}</p>
            <p><strong>Monto Inicial:</strong> $${c.monto_inicial.toFixed(2)}</p>
            <p><strong>Ventas Efectivo:</strong> $${c.ventas_efectivo.toFixed(2)}</p>
            <p><strong>Diferencia:</strong> 
              <span className={c.diferencia >= 0 ? 'profit' : 'error-message'}>
                $${c.diferencia.toFixed(2)}
              </span>
            </p>
          </div>
        ))}
      </div>
    )}
  </div>
);

// --- Componente PRINCIPAL de la Página ---

export default function CajaPage() {
  // 1. Usamos el hook. ¡Toda la lógica vive aquí!
  const { cajaActual, historialCajas, movimientosCaja, isLoading, abrirCaja, cerrarCaja, registrarMovimiento } = useCaja();

  // 2. Estado local para manejar qué modal está visible
  const [modalVisible, setModalVisible] = useState(null); // 'open', 'close', 'entrada', 'salida'

  // 3. Lógica para los formularios de los modales
  const handleOpenSubmit = async (event) => {
    event.preventDefault();
    const monto = event.target.elements['monto-inicial-input'].value;
    if (await abrirCaja(parseFloat(monto))) {
      setModalVisible(null);
    }
  };
  
  // (Aquí irían los 'handleSubmit' para cerrar, entrada y salida)

  if (isLoading) {
    return <div>Cargando estado de la caja...</div>;
  }

  // 4. Renderizamos la UI basada en el estado del hook
  return (
    <>
      <h2 className="section-title">Gestión de Caja</h2>
      <div className="caja-grid">
        {cajaActual && (cajaActual.estado === 'abierta' || cajaActual.estado === 'pendiente_cierre') ? (
          <CajaAbiertaUI
            caja={cajaActual}
            onCerrarClick={() => setModalVisible('close')}
            onEntradaClick={() => setModalVisible('entrada')}
            onSalidaClick={() => setModalVisible('salida')}
          />
        ) : (
          <CajaCerradaUI onAbrirClick={() => setModalVisible('open')} />
        )}

        <HistorialCajaUI historial={historialCajas} />
      </div>

      {/* --- MODALES --- */}
      {/* El siguiente paso sería crear estos componentes modales.
        Por ahora, usamos el HTML de tu index.html
        y lo mostramos condicionalmente.
      */}

      {modalVisible === 'open' && (
        <div id="open-caja-modal" className="modal" style={{ display: 'flex' }}>
          <div className="modal-content">
            <h2 className="modal-title">Abrir Caja</h2>
            <form onSubmit={handleOpenSubmit}>
              <div className="form-group">
                <label htmlFor="monto-inicial-input" className="form-label">Monto inicial:</label>
                <input type="number" id="monto-inicial-input" className="form-input" step="0.01" min="0" required />
              </div>
              <button type="submit" className="btn btn-save">Confirmar Apertura</button>
              <button type="button" className="btn btn-cancel" onClick={() => setModalVisible(null)}>Cancelar</button>
            </form>
          </div>
        </div>
      )}

      {/* (Aquí irían los otros modales: 'close', 'entrada', 'salida') */}
    </>
  );
}