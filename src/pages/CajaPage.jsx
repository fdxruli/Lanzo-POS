import React, { useState } from 'react';
import { useCaja } from '../hooks/useCaja'; // Importamos nuestro hook
import './CajaPage.css';

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
      <p><strong>Monto Inicial:</strong> ${caja.monto_inicial.toFixed(2)}</p>
      <p style={{ color: 'green' }}><strong>Entradas:</strong> ${caja.entradas_efectivo.toFixed(2)}</p>
      <p style={{ color: 'red' }}><strong>Salidas:</strong> ${caja.salidas_efectivo.toFixed(2)}</p>
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

// UI para MOVIMIENTOS (la lógica estaba en useCaja pero faltaba la UI)
const MovimientosCajaUI = ({ movimientos }) => {
  if (movimientos.length === 0) {
    return null; // No mostrar nada si no hay movimientos
  }
  
  return (
    <div id="caja-movements-container" className="stat-card">
      <h3>Movimientos de Caja (Hoy)</h3>
      <div id="caja-movements-list">
        {movimientos.map(mov => (
          <div key={mov.id} className="movement-item" style={{ color: mov.tipo === 'entrada' ? 'green' : 'red' }}>
            <span>{new Date(mov.fecha).toLocaleTimeString()}: {mov.concepto}</span>
            <span>$${mov.monto.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};


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
            <p><strong>Monto Inicial:</strong> ${c.monto_inicial.toFixed(2)}</p>
            <p><strong>Ventas Efectivo:</strong> ${c.ventas_efectivo.toFixed(2)}</p>
            <p><strong>Diferencia:</strong> 
              <span className={c.diferencia >= 0 ? 'profit' : 'error-message'}>
                ${c.diferencia.toFixed(2)}
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
  const { 
    cajaActual, 
    historialCajas, 
    movimientosCaja, // Ya lo estamos recibiendo del hook
    isLoading, 
    abrirCaja, 
    cerrarCaja, 
    registrarMovimiento 
  } = useCaja();

  // 2. Estado local para manejar qué modal está visible
  const [modalVisible, setModalVisible] = useState(null); // 'open', 'close', 'entrada', 'salida'

  // 3. Lógica para los formularios de los modales (¡COMPLETADA!)
  const handleOpenSubmit = async (event) => {
    event.preventDefault();
    const monto = event.target.elements['monto-inicial-input'].value;
    if (await abrirCaja(parseFloat(monto))) {
      setModalVisible(null);
    }
  };
  
  // (Función que faltaba)
  const handleCloseSubmit = async (event) => {
    event.preventDefault();
    const monto = event.target.elements['monto-cierre-input'].value;
    if (await cerrarCaja(parseFloat(monto))) {
      setModalVisible(null);
    }
  };

  // (Función que faltaba)
  const handleEntradaSubmit = async (event) => {
    event.preventDefault();
    const monto = event.target.elements['entrada-monto-input'].value;
    const concepto = event.target.elements['entrada-concepto-input'].value;
    if (await registrarMovimiento('entrada', parseFloat(monto), concepto)) {
      setModalVisible(null);
    }
  };

  // (Función que faltaba)
  const handleSalidaSubmit = async (event) => {
    event.preventDefault();
    const monto = event.target.elements['salida-monto-input'].value;
    const concepto = event.target.elements['salida-concepto-input'].value;
    if (await registrarMovimiento('salida', parseFloat(monto), concepto)) {
      setModalVisible(null);
    }
  };

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
        
        {/* Añadimos el componente de Movimientos */}
        <MovimientosCajaUI movimientos={movimientosCaja} />

        <HistorialCajaUI historial={historialCajas} />
      </div>

      {/* --- MODALES (¡AHORA COMPLETOS!) --- */}

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

      {/* --- MODALES QUE FALTABAN --- */}
      
      {modalVisible === 'close' && (
        <div id="close-caja-modal" className="modal" style={{ display: 'flex' }}>
          <div className="modal-content">
            <h2 className="modal-title">Cerrar Caja</h2>
            <form onSubmit={handleCloseSubmit}>
              <div className="form-group">
                <label htmlFor="monto-cierre-input" className="form-label">Monto final en efectivo (conteo manual):</label>
                <input type="number" id="monto-cierre-input" className="form-input" step="0.01" min="0" required />
              </div>
              <button type="submit" className="btn btn-process">Confirmar Cierre</button>
              <button type="button" className="btn btn-cancel" onClick={() => setModalVisible(null)}>Cancelar</button>
            </form>
          </div>
        </div>
      )}
      
      {modalVisible === 'entrada' && (
        <div id="entrada-caja-modal" className="modal" style={{ display: 'flex' }}>
          <div className="modal-content">
            <h2 className="modal-title">Registrar Entrada de Efectivo</h2>
            <form onSubmit={handleEntradaSubmit}>
              <div className="form-group">
                <label htmlFor="entrada-monto-input" className="form-label">Monto:</label>
                <input type="number" id="entrada-monto-input" className="form-input" step="0.01" min="0" required />
              </div>
              <div className="form-group">
                <label htmlFor="entrada-concepto-input" className="form-label">Concepto:</label>
                <input type="text" id="entrada-concepto-input" className="form-input" placeholder="Ej: Aportación" required />
              </div>
              <button type="submit" className="btn btn-save">Confirmar Entrada</button>
              <button type="button" className="btn btn-cancel" onClick={() => setModalVisible(null)}>Cancelar</button>
            </form>
          </div>
        </div>
      )}
      
      {modalVisible === 'salida' && (
        <div id="salida-caja-modal" className="modal" style={{ display: 'flex' }}>
          <div className="modal-content">
            <h2 className="modal-title">Registrar Salida de Efectivo</h2>
            <form onSubmit={handleSalidaSubmit}>
              <div className="form-group">
                <label htmlFor="salida-monto-input" className="form-label">Monto:</label>
                <input type="number" id="salida-monto-input" className="form-input" step="0.01" min="0" required />
              </div>
              <div className="form-group">
                <label htmlFor="salida-concepto-input" className="form-label">Concepto:</label>
                <input type="text" id="salida-concepto-input" className="form-input" placeholder="Ej: Compra de azúcar" required />
              </div>
              <button type="submit" className="btn btn-process">Confirmar Salida</button>
              <button type="button" className="btn btn-cancel" onClick={() => setModalVisible(null)}>Cancelar</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}