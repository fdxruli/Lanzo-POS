import { useState, useEffect } from 'react';
import { useCaja } from '../hooks/useCaja';
import AuditModal from '../components/common/AuditModal';
import { showMessageModal } from '../services/utils';
import {
  downloadBackupSmart,
  BACKUP_ABORT_REASON,
  BACKUP_WARNING_BLOB_PERF
} from '../services/dataTransfer';
import './CajaPage.css';
import Logger from '../services/Logger';
import { Money } from '../utils/moneyMath';
import { useAppStore } from '../store/useAppStore';

// --- Componente Local: Modal para corregir el fondo inicial ---
const EditInitialModal = ({ show, onClose, onSave, currentAmount, isDisabled = false }) => {
  const [amount, setAmount] = useState('');

  // Al abrir, cargamos el monto actual para editarlo
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (show) setAmount(currentAmount !== undefined ? currentAmount : '')
  }, [show, currentAmount]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isDisabled) return;
    try {
      const safeVal = Money.init(amount);
      if (safeVal.gte(0)) {
        onSave(Money.toExactString(safeVal));
        onClose();
      } else {
        alert('Ingresa un monto válido (mayor o igual a 0)');
      }
    } catch {
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
              disabled={isDisabled}
            />
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '15px', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-cancel" onClick={onClose} disabled={isDisabled}>Cancelar</button>
            <button type="submit" className="btn btn-save" disabled={isDisabled}>Actualizar</button>
          </div>
        </form>
      </div>
    </div>
  );
};
// --- Componente Local: Modal para ajuste de caja ---
const CashAdjustmentModal = ({
  show,
  onClose,
  onConfirm,
  calcularTeorico,
  isDisabled = false
}) => {
  const [montoFisicoReal, setMontoFisicoReal] = useState('');
  const [comentario, setComentario] = useState('');
  const [totalTeorico, setTotalTeorico] = useState('0');

  useEffect(() => {
    let isMounted = true;

    const loadTeorico = async () => {
      if (!show || !calcularTeorico) return;
      const teorico = await calcularTeorico();
      if (isMounted) {
        setTotalTeorico(teorico);
        setMontoFisicoReal('');
        setComentario('');
      }
    };

    loadTeorico();

    return () => {
      isMounted = false;
    };
  }, [show, calcularTeorico]);

  if (!show) return null;

  const teoricoSafe = Money.init(totalTeorico || 0);
  const fisicoSafe = Money.init(montoFisicoReal || 0);
  const diferenciaSafe = Money.subtract(fisicoSafe, teoricoSafe);
  const comentarioLimpio = comentario.trim();

  const handleSubmit = (event) => {
    event.preventDefault();
    if (isDisabled) return;

    onConfirm(Money.toExactString(fisicoSafe), comentarioLimpio);
  };

  const diferenciaEsPositiva = diferenciaSafe.gt(0);
  const diferenciaEsNegativa = diferenciaSafe.lt(0);

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 1200 }}>
      <div className="modal-content" style={{ maxWidth: '500px' }}>
        <h3 className="modal-title">Ajuste de Caja</h3>
        <p style={{ marginBottom: '12px', color: 'var(--text-light)', fontSize: '0.9rem' }}>
          Ingresa el monto fisico real para generar un ajuste auditable contra el total teorico.
        </p>

        <div style={{ marginBottom: '12px', padding: '10px', background: 'var(--light-background)', borderRadius: '8px' }}>
          <strong>Total teorico actual:</strong> ${Money.toNumber(teoricoSafe).toFixed(2)}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Monto Fisico Real ($)</label>
            <input
              type="number"
              className="form-input"
              value={montoFisicoReal}
              onChange={(e) => setMontoFisicoReal(e.target.value)}
              step="0.01"
              min="0"
              required
              autoFocus
              disabled={isDisabled}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Comentario (obligatorio)</label>
            <textarea
              className="form-textarea"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Ej: Correccion por cambio mal dado"
              required
              disabled={isDisabled}
            />
          </div>

          <div style={{ marginBottom: '12px', padding: '10px', borderRadius: '8px', background: '#f8fafc' }}>
            <strong>Diferencia:</strong>{' '}
            <span style={{ color: diferenciaEsPositiva ? 'var(--success-color)' : (diferenciaEsNegativa ? 'var(--error-color)' : 'var(--text-dark)') }}>
              {diferenciaEsPositiva ? '+' : ''}${Money.toNumber(diferenciaSafe).toFixed(2)}
            </span>
            {diferenciaEsPositiva && (
              <div style={{ color: 'var(--success-color)', marginTop: '4px' }}>
                Se registrara como ajuste_entrada.
              </div>
            )}
            {diferenciaEsNegativa && (
              <div style={{ color: 'var(--error-color)', marginTop: '4px' }}>
                Se registrara como ajuste_salida.
              </div>
            )}
            {!diferenciaEsPositiva && !diferenciaEsNegativa && (
              <div style={{ color: 'var(--text-light)', marginTop: '4px' }}>
                No hay diferencia; no se registrara movimiento.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '15px' }}>
            <button type="button" className="btn btn-cancel" onClick={onClose} disabled={isDisabled}>Cancelar</button>
            <button
              type="submit"
              className="btn btn-save"
              disabled={isDisabled || !montoFisicoReal || fisicoSafe.lt(0) || comentarioLimpio.length === 0}
            >
              Registrar Ajuste
            </button>
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
    calcularTotalTeorico,
    registrarAjusteCaja,
    sincronizarEstadoCaja
  } = useCaja();

  const [modalVisible, setModalVisible] = useState(null); // 'entrada', 'salida', 'edit-inicial', 'ajuste-caja'
  const [isAuditOpen, setIsAuditOpen] = useState(false);
  const isBackupLoading = useAppStore((state) => state.isBackupLoading);
  const setBackupLoading = useAppStore((state) => state.setBackupLoading);

  // --- Handlers ---

  const handleEntradaSubmit = async (event) => {
    event.preventDefault();
    if (isBackupLoading) return;
    const monto = event.target.elements['entrada-monto-input'].value;
    const concepto = event.target.elements['entrada-concepto-input'].value;
    if (await registrarMovimiento('entrada', monto, concepto)) {
      setModalVisible(null);
      showMessageModal('Entrada registrada correctamente.');
    }
  };

  const handleSalidaSubmit = async (event) => {
    event.preventDefault();
    if (isBackupLoading) return;
    const monto = event.target.elements['salida-monto-input'].value;
    const concepto = event.target.elements['salida-concepto-input'].value;
    if (await registrarMovimiento('salida', monto, concepto)) {
      setModalVisible(null);
      showMessageModal('Salida registrada correctamente.');
    }
  };

  const handleAjusteSubmit = async (montoFisicoReal, comentario) => {
    if (isBackupLoading) return;

    const resultado = await registrarAjusteCaja(montoFisicoReal, comentario);
    if (!resultado.success) {
      showMessageModal(`Error al registrar ajuste: ${resultado.error?.message || resultado.error}`, null, { type: 'error' });
      return;
    }

    if (resultado.noChange) {
      showMessageModal('No hay diferencia entre monto fisico y total teorico. No se registro ajuste.');
      setModalVisible(null);
      return;
    }

    const esEntrada = resultado.tipo === 'ajuste_entrada';
    const montoAjuste = Money.toNumber(resultado.monto_ajuste || 0).toFixed(2);
    showMessageModal(
      `Ajuste registrado: ${esEntrada ? 'ajuste_entrada' : 'ajuste_salida'} por $${montoAjuste}.`
    );
    setModalVisible(null);
  };

  const handleActionableError = (errorObj) => {
    const { message, details } = errorObj;
    if (details.actionable === 'SUGGEST_RELOAD') {
      showMessageModal(message, () => window.location.reload(), { confirmButtonText: 'Recargar Página' });
    } else {
      showMessageModal(message, null, { type: 'error' });
    }
  };

  const showBackupPerformanceWarning = (backupResult) => {
    if (backupResult.warnings?.includes(BACKUP_WARNING_BLOB_PERF)) {
      showMessageModal(
        'Aviso: Respaldo generado en modo compatible (Blob). En bases grandes puede tardar mas.',
        null,
        { type: 'warning' }
      );
    }
  };

  const handleAuditConfirm = async (montoFisicoTotal, montoFondoSiguienteTurno, comentarios) => {
    if (isBackupLoading) return;
    setBackupLoading(true);

    try {
      const result = await realizarAuditoriaYCerrar(montoFisicoTotal, montoFondoSiguienteTurno, comentarios);

      if (!result.success) {
        if (result.error && result.error.details) {
          handleActionableError(result.error);
        } else {
          showMessageModal(`Error al cerrar caja: ${result.error}`, null, { type: 'error' });
        }
        return;
      }

      try {
        const backupResult = await downloadBackupSmart();

        if (backupResult.success === true) {
          showBackupPerformanceWarning(backupResult);
          showMessageModal('Corte realizado y respaldo descargado.');
        } else if (backupResult.reason === BACKUP_ABORT_REASON) {
          showMessageModal('Corte realizado con exito.');
        } else {
          throw new Error('Resultado de respaldo no reconocido.');
        }
      } catch (backupError) {
        Logger.error('Fallo respaldo automatico', backupError);
        showMessageModal('Corte realizado con exito (pero fallo la descarga del respaldo).');
      }

      await sincronizarEstadoCaja();
      setIsAuditOpen(false);
    } finally {
      setBackupLoading(false);
    }
  };

  // Lógica de Backup (Solicitada)
  const handleBackup = async () => {
    if (isBackupLoading) return;
    setBackupLoading(true);
    try {
      const backupResult = await downloadBackupSmart();

      if (backupResult.success === true) {
        showBackupPerformanceWarning(backupResult);
        showMessageModal('Respaldo generado correctamente.');
        return;
      }

      if (backupResult.reason === BACKUP_ABORT_REASON) {
        return;
      }

      throw new Error('Resultado de respaldo no reconocido.');
    } catch (e) {
      Logger.error(e);
      showMessageModal('Error al respaldar.', null, { type: 'error' });
    } finally {
      setBackupLoading(false);
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
                onClick={() => !isBackupLoading && setModalVisible('edit-inicial')}
                style={{ background: 'none', border: 'none', cursor: isBackupLoading ? 'not-allowed' : 'pointer', fontSize: '1rem', padding: '0' }}
                title="Corregir fondo inicial calculado"
                disabled={isBackupLoading}
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
          <button className="btn btn-audit full-width" onClick={() => setIsAuditOpen(true)} disabled={isBackupLoading}>
            🛡️ Corte de Caja (Cerrar Turno)
          </button>
          <button className="btn btn-entry half-width" onClick={() => setModalVisible('entrada')} disabled={isBackupLoading}>
            + Entrada
          </button>
          <button className="btn btn-exit half-width" onClick={() => setModalVisible('salida')} disabled={isBackupLoading}>
            - Salida
          </button>
          <button
            className="btn btn-adjust full-width"
            onClick={() => setModalVisible('ajuste-caja')}
            disabled={isBackupLoading}
            title="Registrar ajuste auditable por diferencia fisica"
          >
            Ajuste de Caja
          </button>
        </div>
      </div>

      {/* 3. MOVIMIENTOS MANUALES */}
      <div id="caja-movements-container" className="caja-card">
        <h3 className="subtitle">Movimientos del Turno</h3>
        <div id="caja-movements-list">
          {movimientosCaja.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#999', fontStyle: 'italic' }}>No hay movimientos registrados.</p>
          ) : (
            movimientosCaja.map(mov => {
              const esEntrada = mov.tipo === 'entrada' || mov.tipo === 'ajuste_entrada';
              const esAjuste = mov.tipo === 'ajuste_entrada' || mov.tipo === 'ajuste_salida';
              const colorMov = esEntrada ? 'var(--success-color)' : 'var(--error-color)';

              return (
                <div key={mov.id} className="movement-item" style={{
                  borderLeft: `4px solid ${colorMov}`,
                  marginBottom: '8px', padding: '8px', backgroundColor: 'var(--light-background)', borderRadius: '4px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 500 }}>
                      {esAjuste ? '[Ajuste] ' : ''}{mov.concepto}
                    </span>
                    <span style={{ fontWeight: 'bold', color: colorMov }}>
                      {esEntrada ? '+' : '-'}${Money.toNumber(mov.monto).toFixed(2)}
                    </span>
                  </div>
                  <small style={{ color: 'var(--text-light)' }}>{new Date(mov.fecha).toLocaleTimeString()}</small>
                </div>
              );
            })
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
        onClose={() => !isBackupLoading && setModalVisible(null)}
        currentAmount={cajaActual?.monto_inicial}
        onSave={ajustarMontoInicial}
        isDisabled={isBackupLoading}
      />

      {/* 2. Modal Entrada */}
      {modalVisible === 'entrada' && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content">
            <h2 className="modal-title">Entrada de Efectivo</h2>
            <form onSubmit={handleEntradaSubmit}>
              <div className="form-group">
                <label className="form-label">Monto:</label>
                <input name="entrada-monto-input" type="number" className="form-input" step="0.01" min="0" required autoFocus disabled={isBackupLoading} />
              </div>
              <div className="form-group">
                <label className="form-label">Concepto:</label>
                <input name="entrada-concepto-input" type="text" className="form-input" placeholder="Ej: Cambio, Aporte extra" required disabled={isBackupLoading} />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button type="button" className="btn btn-cancel" onClick={() => setModalVisible(null)} disabled={isBackupLoading}>Cancelar</button>
                <button type="submit" className="btn btn-save" disabled={isBackupLoading}>Guardar</button>
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
                <input name="salida-monto-input" type="number" className="form-input" step="0.01" min="0" required autoFocus disabled={isBackupLoading} />
              </div>
              <div className="form-group">
                <label className="form-label">Concepto:</label>
                <input name="salida-concepto-input" type="text" className="form-input" placeholder="Ej: Pago proveedor" required disabled={isBackupLoading} />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                <button type="button" className="btn btn-cancel" onClick={() => setModalVisible(null)} disabled={isBackupLoading}>Cancelar</button>
                <button type="submit" className="btn btn-delete" disabled={isBackupLoading}>Registrar Salida</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Modal Ajuste de Caja */}
      <CashAdjustmentModal
        show={modalVisible === 'ajuste-caja'}
        onClose={() => !isBackupLoading && setModalVisible(null)}
        onConfirm={handleAjusteSubmit}
        calcularTeorico={calcularTotalTeorico}
        isDisabled={isBackupLoading}
      />
      {/* 5. Modal Auditoria (Cierre Inteligente) */}
      <AuditModal
        show={isAuditOpen}
        onClose={() => !isBackupLoading && setIsAuditOpen(false)}
        onConfirmAudit={handleAuditConfirm}
        caja={cajaActual}
        calcularTeorico={calcularTotalTeorico}
        isProcessing={isBackupLoading}
      />
    </div>
  );
}
