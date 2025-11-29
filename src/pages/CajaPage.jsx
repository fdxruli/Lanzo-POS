// src/pages/CajaPage.jsx
import React, { useState, useEffect } from 'react';
import { useCaja } from '../hooks/useCaja';
import AuditModal from '../components/common/AuditModal';
import { showMessageModal } from '../services/utils';
import './CajaPage.css';

// --- Componentes de UI ---

// 1. UI para Caja Cerrada
const CajaCerradaUI = ({ onAbrirClick }) => (
  <div id="caja-status-container" className="caja-card status-card" style={{ textAlign: 'center', display: 'block' }}>
    <h3>Caja Cerrada</h3>
    <p style={{ marginBottom: '20px', color: 'var(--text-light)' }}>Abre una caja para comenzar a vender.</p>
    <button id="open-caja-btn" className="btn btn-save" onClick={onAbrirClick} style={{ width: '100%', maxWidth: '300px' }}>
      Abrir Caja
    </button>
  </div>
);

// 2. UI para Caja Abierta (ACTUALIZADA)
const CajaAbiertaUI = ({ caja, totales, onEntradaClick, onSalidaClick, onAuditarClick }) => {

  // Calculamos el total físico esperado sumando:
  // Inicial + Ventas en Efectivo + Abonos de Crédito + Entradas Manuales - Salidas
  const totalEnCaja = (
    caja.monto_inicial +
    totales.ventasContado +
    totales.abonosFiado +
    caja.entradas_efectivo -
    caja.salidas_efectivo
  );

  return (
    <>
      {/* TARJETA DE ESTADO */}
      <div id="caja-status-container" className="caja-card status-card">
        <div className="status-header">
          <span className="status-badge open">Caja Abierta</span>
          <small>{new Date(caja.fecha_apertura).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
        </div>

        <div className="status-body">
          <div className="info-row">
            <span>Monto Inicial</span>
            <span className="amount neutral">${caja.monto_inicial.toFixed(2)}</span>
          </div>

          {/* Fila de Ventas Contado */}
          <div className="info-row">
            <span>Ventas (Efectivo)</span>
            <span className="amount success" style={{ color: 'var(--success-color)' }}>+ ${totales.ventasContado.toFixed(2)}</span>
          </div>

          {/* Fila de Abonos Fiado (Solo si hay) */}
          {totales.abonosFiado > 0 && (
            <div className="info-row">
              <span>Anticipos de Crédito</span>
              <span className="amount warning" style={{ color: 'var(--warning-color)' }}>+ ${totales.abonosFiado.toFixed(2)}</span>
            </div>
          )}

          <div className="info-row">
            <span>Entradas (Extras)</span>
            <span className="amount positive" style={{ fontSize: '0.9rem' }}>+ ${caja.entradas_efectivo.toFixed(2)}</span>
          </div>
          <div className="info-row">
            <span>Salidas (Gastos)</span>
            <span className="amount negative" style={{ fontSize: '0.9rem' }}>- ${caja.salidas_efectivo.toFixed(2)}</span>
          </div>

          {/* Total Destacado */}
          <div className="info-row" style={{ borderTop: '2px solid #eee', marginTop: '10px', paddingTop: '10px', borderBottom: 'none' }}>
            <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>Total en Caja</span>
            <span className="amount" style={{ fontSize: '1.4rem', color: 'var(--primary-color)' }}>
              ${totalEnCaja.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* TARJETA DE ACCIONES */}
      <div id="caja-actions-container" className="caja-card actions-card">
        <h3 className="actions-title">Acciones Rápidas</h3>
        <div className="actions-grid">
          <button id="audit-caja-btn" className="btn btn-audit full-width" onClick={onAuditarClick}>
            🛡️ Auditar y Cerrar Turno
          </button>
          <button id="add-entrada-btn" className="btn btn-entry half-width" onClick={onEntradaClick}>
            + Entrada
          </button>
          <button id="add-salida-btn" className="btn btn-exit half-width" onClick={onSalidaClick}>
            - Salida
          </button>
        </div>
      </div>
    </>
  );
};

// 3. UI para Movimientos Manuales
const MovimientosCajaUI = ({ movimientos }) => {
  if (!movimientos || movimientos.length === 0) return null;

  return (
    <div id="caja-movements-container" className="caja-card">
      <h3 className="subtitle">Movimientos Manuales (Hoy)</h3>
      <div id="caja-movements-list">
        {movimientos.map(mov => (
          <div key={mov.id} className="movement-item" style={{
            borderLeft: `4px solid ${mov.tipo === 'entrada' ? 'var(--success-color)' : 'var(--error-color)'}`,
            marginBottom: '8px', padding: '8px', backgroundColor: 'var(--light-background)', borderRadius: '4px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 500 }}>{mov.concepto}</span>
              <span style={{ fontWeight: 'bold', color: mov.tipo === 'entrada' ? 'var(--success-color)' : 'var(--error-color)' }}>
                {mov.tipo === 'entrada' ? '+' : '-'}${mov.monto.toFixed(2)}
              </span>
            </div>
            <small style={{ color: 'var(--text-light)' }}>{new Date(mov.fecha).toLocaleTimeString()}</small>
          </div>
        ))}
      </div>
    </div>
  );
};

// 4. UI para Historial de Cierres
const HistorialCajaUI = ({ historial }) => (
  <div id="caja-history-container" className="caja-card sales-history-container">
    <h3 className="subtitle">Historial de Cajas</h3>
    {historial.length === 0 ? (
      <p className="empty-message">No hay historial de cajas.</p>
    ) : (
      <div className="history-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {historial.map(c => (
          <div key={c.id} className="history-item" style={{ padding: '10px', borderBottom: '1px solid #eee' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <strong>{new Date(c.fecha_apertura).toLocaleDateString()}</strong>
              <span className={`status-badge ${!c.diferencia || Math.abs(c.diferencia) < 1 ? 'success' : 'error'}`}
                style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
                {Math.abs(c.diferencia || 0) < 1 ? 'Cuadrada' : 'Descuadre'}
              </span>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
              Cierre: {c.monto_cierre ? `$${c.monto_cierre.toFixed(2)}` : 'N/A'}
            </p>
            {/* Mostrar detalles si hubo diferencia */}
            {c.diferencia && Math.abs(c.diferencia) > 0 && (
              <small style={{ color: c.diferencia > 0 ? 'var(--success-color)' : 'var(--error-color)' }}>
                Dif: {c.diferencia > 0 ? '+' : ''}${c.diferencia.toFixed(2)}
              </small>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
);

// --- Componente PRINCIPAL ---

export default function CajaPage() {
  const {
    cajaActual,
    historialCajas,
    movimientosCaja,
    isLoading,
    montoSugerido,
    totalesTurno, // IMPORTANTE: Aquí vienen las ventas desglosadas
    abrirCaja,
    realizarAuditoriaYCerrar,
    registrarMovimiento,
    calcularTotalTeorico
  } = useCaja();

  const [modalVisible, setModalVisible] = useState(null); // 'open', 'entrada', 'salida'
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [montoApertura, setMontoApertura] = useState('');

  // Pre-rellenar monto sugerido al abrir el modal
  useEffect(() => {
    if (modalVisible === 'open' && montoSugerido) {
      setMontoApertura(montoSugerido.toString());
    }
  }, [modalVisible, montoSugerido]);

  // --- Handlers ---

  const handleOpenSubmit = async (event) => {
    event.preventDefault();
    const monto = parseFloat(montoApertura);
    if (await abrirCaja(monto)) {
      setModalVisible(null);
    }
  };

  const handleEntradaSubmit = async (event) => {
    event.preventDefault();
    const monto = event.target.elements['entrada-monto-input'].value;
    const concepto = event.target.elements['entrada-concepto-input'].value;
    if (await registrarMovimiento('entrada', parseFloat(monto), concepto)) {
      setModalVisible(null);
    }
  };

  const handleSalidaSubmit = async (event) => {
    event.preventDefault();
    const monto = event.target.elements['salida-monto-input'].value;
    const concepto = event.target.elements['salida-concepto-input'].value;
    if (await registrarMovimiento('salida', parseFloat(monto), concepto)) {
      setModalVisible(null);
    }
  };

  const handleAuditConfirm = async (montoFisico, comentarios) => {
    const result = await realizarAuditoriaYCerrar(montoFisico, comentarios);
    if (result.success) {
      setIsAuditOpen(false);
      let msg = `Caja cerrada exitosamente.`;
      if (Math.abs(result.diferencia) > 0.5) {
        msg += ` Diferencia registrada: $${result.diferencia.toFixed(2)}`;
      }
      showMessageModal(msg);
    } else {
      showMessageModal(`Error al cerrar caja: ${result.error}`);
    }
  };

  if (isLoading) {
    return <div style={{ padding: '20px', textAlign: 'center' }}>Cargando estado de la caja...</div>;
  }

  return (
    <>
      <div className="caja-grid">

        {/* Panel Superior: Estado de Caja */}
        {cajaActual && cajaActual.estado === 'abierta' ? (
          <CajaAbiertaUI
            caja={cajaActual}
            totales={totalesTurno} // Pasamos el objeto completo con el desglose
            onAuditarClick={() => setIsAuditOpen(true)}
            onEntradaClick={() => setModalVisible('entrada')}
            onSalidaClick={() => setModalVisible('salida')}
          />
        ) : (
          <CajaCerradaUI onAbrirClick={() => setModalVisible('open')} />
        )}

        {/* Panel Central: Movimientos Manuales */}
        <MovimientosCajaUI movimientos={movimientosCaja} />

        {/* Panel Inferior: Historial */}
        <HistorialCajaUI historial={historialCajas} />
      </div>

      {/* --- MODALES --- */}

      {/* 1. Modal Apertura */}
      {modalVisible === 'open' && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content">
            <h2 className="modal-title">Abrir Caja</h2>
            <p style={{ marginBottom: '15px', color: 'var(--text-light)' }}>
              {montoSugerido > 0
                ? `Sugerencia basada en cierre anterior: $${montoSugerido.toFixed(2)}`
                : 'Ingresa el fondo inicial para comenzar el turno.'}
            </p>
            <form onSubmit={handleOpenSubmit}>
              <div className="form-group">
                <label className="form-label">Monto inicial:</label>
                <input
                  type="number"
                  className="form-input"
                  step="0.01"
                  min="0"
                  required
                  value={montoApertura}
                  onChange={(e) => setMontoApertura(e.target.value)}
                  autoFocus
                />
              </div>
              <button type="submit" className="btn btn-save">Confirmar Apertura</button>
              <button type="button" className="btn btn-cancel" onClick={() => setModalVisible(null)}>Cancelar</button>
            </form>
          </div>
        </div>
      )}

      {/* 2. Modal Entrada */}
      {modalVisible === 'entrada' && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content">
            <h2 className="modal-title">Entrada de Efectivo</h2>
            <form onSubmit={handleEntradaSubmit}>
              <div className="form-group">
                <label className="form-label">Monto:</label>
                <input name="entrada-monto-input" type="number" className="form-input" step="0.01" min="0" required autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Concepto:</label>
                <input name="entrada-concepto-input" type="text" className="form-input" placeholder="Ej: Cambio, Aporte extra" required />
              </div>
              <button type="submit" className="btn btn-save">Guardar</button>
              <button type="button" className="btn btn-cancel" onClick={() => setModalVisible(null)}>Cancelar</button>
            </form>
          </div>
        </div>
      )}

      {/* 3. Modal Salida */}
      {modalVisible === 'salida' && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content">
            <h2 className="modal-title">Salida de Efectivo</h2>
            <form onSubmit={handleSalidaSubmit}>
              <div className="form-group">
                <label className="form-label">Monto:</label>
                <input name="salida-monto-input" type="number" className="form-input" step="0.01" min="0" required autoFocus />
              </div>
              <div className="form-group">
                <label className="form-label">Concepto:</label>
                <input name="salida-concepto-input" type="text" className="form-input" placeholder="Ej: Pago proveedor, Compra insumos" required />
              </div>
              <button type="submit" className="btn btn-delete">Guardar</button>
              <button type="button" className="btn btn-cancel" onClick={() => setModalVisible(null)}>Cancelar</button>
            </form>
          </div>
        </div>
      )}

      {/* 4. Modal Auditoría (Cierre Inteligente) */}
      <AuditModal
        show={isAuditOpen}
        onClose={() => setIsAuditOpen(false)}
        onConfirmAudit={handleAuditConfirm}
        caja={cajaActual}
        calcularTeorico={calcularTotalTeorico}
      />
    </>
  );
}