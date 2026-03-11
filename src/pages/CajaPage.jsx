import React, { useState, useEffect } from 'react';
import { useCaja } from '../hooks/useCaja';
import AuditModal from '../components/common/AuditModal';
import { showMessageModal } from '../services/utils';
import { downloadBackupSmart } from '../services/dataTransfer';
import './CajaPage.css';
import Logger from '../services/Logger';
import { Money } from '../utils/moneyMath';

// --- Componente Local: Modal para corregir el fondo inicial ---
const EditInitialModal = ({ show, onClose, onSave, currentAmount }) => {
  const [amount, setAmount] = useState('');

  // Al abrir, cargamos el monto actual para editarlo
  useEffect(() => {
    if (show) setAmount(currentAmount !== undefined ? currentAmount : '')
  }, [show, currentAmount]);

  const handleSubmit = (e) => {
    e.preventDefault();
    try {
      const safeVal = Money.init(amount);
      if (safeVal.gte(0)) {
        onSave(Money.toExactString(safeVal));
        onClose();
      } else {
        alert('Ingresa un monto válido (mayor o igual a 0)');
      }
    } catch (e) {
      alert('Monto inválido');
    }
  };

  if (!show) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 1200 }}>
      <div className="modal-content" style={{ maxWidth: '400px' }}>
        <h3 className="modal-title">Ajustar Fondo Inicial</h3>
        <p style={{ marginBottom: '15px', color: 'var(--text-light)', fontSize: '0.9rem' }}>
          El sistema calculó este fondo automáticamente del turno anterior.
          Si el dinero físico real es diferente, corrígelo aquí.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Fondo Real ($)</label>
            <input
              type="number"
              className="form-input"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              autoFocus
              step="0.01"
              min="0"
            />
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '15px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-cancel" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-save">Actualizar</button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- Componente PRINCIPAL ---
export default function CajaPage() {
  const {
    cajaActual,
    historialCajas,
    movimientosCaja,
    isLoading,
    totalesTurno,
    ajustarMontoInicial, //
    realizarAuditoriaYCerrar,
    registrarMovimiento,
    calcularTotalTeorico
  } = useCaja();

  const [modalVisible, setModalVisible] = useState(null); // 'entrada', 'salida', 'edit-inicial'
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const [isBackupLoading, setIsBackupLoading] = useState(false);

  // --- Handlers ---

  const handleEntradaSubmit = async (event) => {
    event.preventDefault();
    const monto = event.target.elements['entrada-monto-input'].value;
    const concepto = event.target.elements['entrada-concepto-input'].value;
    if (await registrarMovimiento('entrada', monto, concepto)) {
      setModalVisible(null);
      showMessageModal('Entrada registrada correctamente.');
    }
  };

  const handleSalidaSubmit = async (event) => {
    event.preventDefault();
    const monto = event.target.elements['salida-monto-input'].value;
    const concepto = event.target.elements['salida-concepto-input'].value;
    if (await registrarMovimiento('salida', monto, concepto)) {
      setModalVisible(null);
      showMessageModal('Salida registrada correctamente.');
    }
  };

  const handleActionableError = (errorObj) => {
    const { message, details } = errorObj;
    if (details.actionable === 'SUGGEST_RELOAD') {
      showMessageModal(message, () => window.location.reload(), { confirmButtonText: 'Recargar Página' });
    } else {
      showMessageModal(message, null, { type: 'error' });
    }
  };

  const handleAuditConfirm = async (montoFisico, comentarios) => {
    const result = await realizarAuditoriaYCerrar(montoFisico, comentarios);

    if (result.success) {
      setIsAuditOpen(false);

      // --- OPTIMIZACIÓN: Disparar respaldo automático ---
      try {
        // No bloqueamos la UI con alertas, solo lo intentamos descargar
        await downloadBackupSmart();
        showMessageModal(`✅ Corte realizado y respaldo descargado.`);
      } catch (backupError) {
        // Si falla el respaldo, el corte YA se hizo, así que solo avisamos del corte
        console.error("Fallo respaldo automático", backupError);
        showMessageModal(`✅ Corte realizado con éxito (pero falló la descarga del respaldo).`);
      }
      // --------------------------------------------------

    } else {
      if (result.error && result.error.details) {
        handleActionableError(result.error);
      } else {
        showMessageModal(`Error al cerrar caja: ${result.error}`, null, { type: 'error' });
      }
    }
  };

  // Lógica de Backup (Solicitada)
  const handleBackup = async () => {
    setIsBackupLoading(true);
    try {
      await downloadBackupSmart(); // <--- Cambio aquí
      showMessageModal("✅ Respaldo generado correctamente.");
    } catch (e) {
      Logger.error(e);
      showMessageModal("Error al respaldar.", null, { type: 'error' });
    } finally {
      setIsBackupLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="spinner-loader"></div>
        <p style={{ marginTop: '10px', color: 'var(--text-light)' }}>Sincronizando caja inteligente...</p>
      </div>
    );
  }

  // Cálculo del total actual en tiempo real ESTRICTO
  let totalEnCajaSafe = Money.init(0);

  if (cajaActual) {
    // 1. Convertimos todos los strings a instancias seguras de Big.js
    const inicial = Money.init(cajaActual.monto_inicial || 0);
    const ventas = Money.init(totalesTurno.ventasContado || 0);
    const abonos = Money.init(totalesTurno.abonosFiado || 0);
    const entradas = Money.init(cajaActual.entradas_efectivo || 0);
    const salidas = Money.init(cajaActual.salidas_efectivo || 0);

    // 2. Sumamos todo usando los métodos de Money, nunca el operador "+"
    const subtotalIngresos = Money.add(inicial, ventas);
    const subtotalExtras = Money.add(abonos, entradas);
    const ingresosTotales = Money.add(subtotalIngresos, subtotalExtras);

    // 3. Restamos las salidas
    totalEnCajaSafe = Money.subtract(ingresosTotales, salidas);
  }

  return (
    <div className="caja-grid">

      {/* 1. TARJETA DE ESTADO (Siempre activa gracias a autoAbrirCaja) */}
      <div className="caja-card status-card">
        <div className="status-header">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="status-badge open">Turno Activo</span>
            <small style={{ color: 'var(--text-light)', marginTop: '4px' }}>
              Inicio: {cajaActual?.fecha_apertura ? new Date(cajaActual.fecha_apertura).toLocaleString() : '...'}
            </small>
          </div>

          {/* Botón de Backup Integrado */}
          <button
            className="btn btn-backup"
            onClick={handleBackup}
            disabled={isBackupLoading}
            title="Guardar copia de seguridad ahora"
          >
            {/* Icono y Texto condicional */}
            {isBackupLoading ? (
              <>
                <span className="spinner-small"></span> Guardando...
              </>
            ) : (
              <>
                💾 Respaldo Rápido
              </>
            )}
          </button>
        </div>

        <div className="status-body">
          <div className="info-row">
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              Fondo Inicial
              <button
                className="btn-icon-small"
                onClick={() => setModalVisible('edit-inicial')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1rem', padding: '0' }}
                title="Corregir fondo inicial calculado"
              >
                ✏️
              </button>
            </span>
            <span className="amount neutral">${Money.toNumber(cajaActual?.monto_inicial || 0).toFixed(2)}</span>
          </div>

          <div className="info-row">
            <span>Ventas (Efectivo)</span>
            <span className="amount success">+ ${Money.toNumber(totalesTurno.ventasContado || 0).toFixed(2)}</span>
          </div>

          {Money.init(totalesTurno.abonosFiado || 0).gt(0) && (
            <div className="info-row">
              <span>Abonos (Créditos)</span>
              <span className="amount warning">+ ${Money.toNumber(totalesTurno.abonosFiado || 0).toFixed(2)}</span>
            </div>
          )}

          <div className="info-row">
            <span>Entradas Extras</span>
            <span className="amount positive">+ ${Money.toNumber(cajaActual?.entradas_efectivo || 0).toFixed(2)}</span>
          </div>
          <div className="info-row">
            <span>Salidas (Gastos)</span>
            <span className="amount negative">- ${Money.toNumber(cajaActual?.salidas_efectivo || 0).toFixed(2)}</span>
          </div>

          <div className="info-row" style={{ borderTop: '2px solid #eee', marginTop: '10px', paddingTop: '10px', borderBottom: 'none' }}>
            <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>Total en Caja</span>
            <span className="amount" style={{ fontSize: '1.4rem', color: 'var(--primary-color)' }}>
              ${Money.toNumber(totalEnCajaSafe).toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. TARJETA DE ACCIONES */}
      <div className="caja-card actions-card">
        <h3 className="actions-title">Control de Efectivo</h3>
        <div className="actions-grid">
          <button className="btn btn-audit full-width" onClick={() => setIsAuditOpen(true)}>
            🛡️ Corte de Caja (Cerrar Turno)
          </button>
          <button className="btn btn-entry half-width" onClick={() => setModalVisible('entrada')}>
            + Entrada
          </button>
          <button className="btn btn-exit half-width" onClick={() => setModalVisible('salida')}>
            - Salida
          </button>
        </div>
      </div>

      {/* 3. MOVIMIENTOS MANUALES */}
      <div id="caja-movements-container" className="caja-card">
        <h3 className="subtitle">Movimientos del Turno</h3>
        <div id="caja-movements-list">
          {movimientosCaja.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#999', fontStyle: 'italic' }}>No hay movimientos manuales.</p>
          ) : (
            movimientosCaja.map(mov => (
              <div key={mov.id} className="movement-item" style={{
                borderLeft: `4px solid ${mov.tipo === 'entrada' ? 'var(--success-color)' : 'var(--error-color)'}`,
                marginBottom: '8px', padding: '8px', backgroundColor: 'var(--light-background)', borderRadius: '4px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 500 }}>{mov.concepto}</span>
                  <span style={{ fontWeight: 'bold', color: mov.tipo === 'entrada' ? 'var(--success-color)' : 'var(--error-color)' }}>
                    {mov.tipo === 'entrada' ? '+' : '-'}${Money.toNumber(mov.monto).toFixed(2)}
                  </span>
                </div>
                <small style={{ color: 'var(--text-light)' }}>{new Date(mov.fecha).toLocaleTimeString()}</small>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 4. HISTORIAL DE CORTES */}
      <div id="caja-history-container" className="caja-card sales-history-container">
        <h3 className="subtitle">Historial de Cortes</h3>
        {historialCajas.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#999', padding: '20px' }}>No hay historial.</p>
        ) : (
          <div className="history-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
            {historialCajas.map(c => {
              // Sanitización estricta por cada iteración
              const diffSafe = Money.init(c.diferencia || 0);
              const isCuadrada = diffSafe.abs().lt(1); // En lugar de Math.abs

              return (
                <div key={c.id} className="history-item" style={{ padding: '10px', borderBottom: '1px solid #eee' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                    <strong>{new Date(c.fecha_apertura).toLocaleDateString()}</strong>
                    <span className={`status-badge ${isCuadrada ? 'success' : 'error'}`}
                      style={{ fontSize: '0.7rem', padding: '2px 6px' }}>
                      {isCuadrada ? 'Cuadrada' : 'Descuadre'}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: '#666', margin: 0 }}>
                    Cierre: {c.monto_cierre ? `$${Money.toNumber(c.monto_cierre || 0).toFixed(2)}` : 'N/A'}
                  </p>
                  {!isCuadrada && (
                    <small style={{ color: diffSafe.gt(0) ? 'var(--success-color)' : 'var(--error-color)' }}>
                      Dif: {diffSafe.gt(0) ? '+' : ''}${Money.toNumber(diffSafe).toFixed(2)}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 1. Modal Ajuste Inicial (Inteligente) */}
      <EditInitialModal
        show={modalVisible === 'edit-inicial'}
        onClose={() => setModalVisible(null)}
        currentAmount={cajaActual?.monto_inicial}
        onSave={ajustarMontoInicial}
      />

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
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button type="button" className="btn btn-cancel" onClick={() => setModalVisible(null)}>Cancelar</button>
                <button type="submit" className="btn btn-save">Guardar</button>
              </div>
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
                <input name="salida-concepto-input" type="text" className="form-input" placeholder="Ej: Pago proveedor" required />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button type="button" className="btn btn-cancel" onClick={() => setModalVisible(null)}>Cancelar</button>
                <button type="submit" className="btn btn-delete">Registrar Salida</button>
              </div>
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
    </div>
  );
}