// src/components/customers/AbonoModal.jsx
import React, { useState, useEffect } from 'react';
import { Wallet, X, CheckCircle, MessageCircle, AlertTriangle, List } from 'lucide-react';
import { db } from '../../services/db/dexie';
import { Money } from '../../utils/moneyMath';
import { customerCreditRepository } from '../../services/db/customerCreditRepository';
import { getSafeCustomerDebt } from '../../utils/customerUtils';
import './AbonoModal.css';

export default function AbonoModal({ show, onClose, onConfirmAbono, customer }) {
  const [monto, setMonto] = useState('');
  const [error, setError] = useState('');
  const [sendReceipt, setSendReceipt] = useState(true);

  // Nuevos estados para asignación manual
  const [advancedMode, setAdvancedMode] = useState(false);
  const [pendingSales, setPendingSales] = useState([]);
  const [allocations, setAllocations] = useState({});

  const deudaActual = getSafeCustomerDebt(customer?.debt);

  useEffect(() => {
    if (!show) {
      setMonto('');
      setError('');
      setAdvancedMode(false);
      setAllocations({});
      setPendingSales([]);
    }
  }, [show]);

  // Cargar notas pendientes si se activa el modo avanzado
  useEffect(() => {
    if (show && advancedMode && customer) {
      const fetchSales = async () => {
        try {
          const sales = await db.sales
            .where('customerId').equals(customer.id)
            .and(s => s.paymentMethod === 'fiado' && s.saldoPendiente > 0)
            .sortBy('timestamp');

          // Directamente establecer las notas pendientes. El saneamiento global se encarga de las discrepancias.
          setPendingSales(sales);

        } catch (err) {
          console.error("Error al cargar ventas pendientes:", err);
        }
      };
      fetchSales();
    }
  }, [show, advancedMode, customer]);

  // Recalcular el monto total cuando cambian las asignaciones en modo avanzado
  useEffect(() => {
    if (advancedMode) {
      let sum = Money.init(0);
      Object.values(allocations).forEach(val => {
        const numVal = parseFloat(val) || 0;
        if (numVal > 0) {
          sum = Money.add(sum, numVal);
        }
      });
      const totalStr = Money.toNumber(sum) > 0 ? Money.toNumber(sum).toString() : '';
      setMonto(totalStr);

      if (Money.toNumber(sum) > deudaActual) {
        setError('El abono no puede ser mayor que la deuda actual.');
      } else {
        setError('');
      }
    }
  }, [allocations, advancedMode, deudaActual]);

  const handleMontoChange = (e) => {
    if (advancedMode) return; // Bloquear edición manual en modo avanzado
    const value = e.target.value;
    setError('');
    if (parseFloat(value) > deudaActual) {
      setError('El abono no puede ser mayor que la deuda actual.');
    }
    setMonto(value);
  };

  const handleSaldarCuenta = () => {
    if (advancedMode) return;
    setMonto(deudaActual.toFixed(2));
    setError('');
  };

  const handleAllocationChange = (saleId, value, maxSaldo) => {
    let valStr = value;
    const numVal = parseFloat(value);

    if (numVal > maxSaldo) {
      valStr = maxSaldo.toString();
    } else if (numVal < 0) {
      valStr = '0';
    }

    setAllocations(prev => ({
      ...prev,
      [saleId]: valStr
    }));
  };

  const handleToggleFullAllocation = (sale) => {
    const currentAlloc = parseFloat(allocations[sale.id]) || 0;
    const isFullyAllocated = currentAlloc === sale.saldoPendiente;

    setAllocations(prev => ({
      ...prev,
      [sale.id]: isFullyAllocated ? '' : sale.saldoPendiente.toString()
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const montoAbono = parseFloat(monto);

    if (isNaN(montoAbono) || montoAbono <= 0) {
      setError('Ingresa un monto válido.');
      return;
    }
    if (montoAbono > deudaActual) {
      setError('El abono no puede ser mayor que la deuda actual.');
      return;
    }

    let finalAllocations = null;
    if (advancedMode) {
      finalAllocations = Object.entries(allocations)
        .map(([saleId, amount]) => ({
          saleId,
          amountApplied: parseFloat(amount)
        }))
        .filter(a => !isNaN(a.amountApplied) && a.amountApplied > 0);

      if (finalAllocations.length === 0) {
        setError('No has asignado ningún monto a las notas.');
        return;
      }
    }

    // El Modal pasa la información al componente PADRE.
    onConfirmAbono(customer, montoAbono, sendReceipt, finalAllocations);
  };

  if (!show || !customer) return null;

  return (
    <div className="modal" style={{ display: 'flex', zIndex: 'var(--z-modal-top)' }}>
      <div className="modal-content abono-modal-content" style={{ maxWidth: advancedMode ? '850px' : '450px', transition: 'max-width 0.3s ease', width: '95%' }}>
        <div className="abono-header">
          <h2 className="modal-title">
            <Wallet size={24} className="text-primary" />
            Abonar a Deuda
          </h2>
          <button className="btn-icon-close" onClick={onClose} aria-label="Cerrar">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="abono-form" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className="abono-desktop-split" style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-start' }}>

            {/* COLUMNA IZQUIERDA */}
            <div className="abono-left-col" style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div className="abono-summary-card" style={{ margin: 0 }}>
                <div className="cliente-info">
                  <span className="cliente-label">Cliente:</span>
                  <span className="cliente-name">{customer.name}</span>
                </div>
                <div className="deuda-row">
                  <span className="deuda-label">Deuda Actual:</span>
                  <span className="deuda-total">${deudaActual.toFixed(2)}</span>
                </div>
              </div>

              <div className="abono-mode-toggle" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  <input
                    type="checkbox"
                    checked={advancedMode}
                    onChange={(e) => {
                      setAdvancedMode(e.target.checked);
                      if (!e.target.checked) setAllocations({});
                    }}
                  />
                  <List size={16} />
                  Asignar a notas específicas
                </label>
              </div>

              <div className="form-group abono-input-group" style={{ margin: 0 }}>
                <div className="abono-input-header">
                  <label className="form-label" htmlFor="abono-monto">Monto a Abonar ($):</label>
                  {!advancedMode && (
                    <button
                      type="button"
                      className="btn-saldar-quick"
                      onClick={handleSaldarCuenta}
                      title="Liquidar toda la deuda"
                    >
                      Saldar $ {deudaActual.toFixed(2)}
                    </button>
                  )}
                </div>

                <div className="input-with-currency">
                  <span className="currency-symbol">$</span>
                  <input
                    className={`form-input abono-monto-input ${error ? 'invalid' : ''}`}
                    id="abono-monto"
                    type="number"
                    step="0.01"
                    min="0"
                    max={deudaActual.toFixed(2)}
                    value={monto}
                    onChange={handleMontoChange}
                    placeholder="0.00"
                    required
                    autoFocus
                    readOnly={advancedMode}
                    style={advancedMode ? { backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' } : {}}
                  />
                </div>
                {error && (
                  <p className="form-help-text validation-message error">
                    <AlertTriangle size={14} /> {error}
                  </p>
                )}
              </div>
            </div>

            {/* COLUMNA DERECHA (Solo en modo avanzado) */}
            {advancedMode && (
              <div className="abono-right-col" style={{ flex: '1 1 400px', display: 'flex', flexDirection: 'column', maxHeight: '55vh' }}>
                <div className="allocations-container" style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.5rem', backgroundColor: 'var(--bg-primary)' }}>
                  {pendingSales.length === 0 ? (
                    <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem', padding: '1rem' }}>No hay notas pendientes.</p>
                  ) : (
                    pendingSales.map(sale => (
                      <div key={sale.id} className="allocation-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', borderBottom: '1px solid var(--border-color)' }}>
                        <div className="sale-info" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>Folio: {sale.folio || sale.id.substring(0, 6)}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            Fecha: {new Date(sale.timestamp).toLocaleDateString()}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--error-color)' }}>
                            Pendiente: ${Number(sale.saldoPendiente).toFixed(2)}
                          </span>
                        </div>
                        <div className="sale-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div className="input-with-currency" style={{ width: '100px' }}>
                            <span className="currency-symbol" style={{ left: '8px' }}>$</span>
                            <input
                              type="number"
                              className="form-input"
                              style={{ paddingLeft: '20px', paddingRight: '5px', height: '32px', fontSize: '0.9rem' }}
                              placeholder="0.00"
                              step="0.01"
                              min="0"
                              max={sale.saldoPendiente}
                              value={allocations[sale.id] || ''}
                              onChange={(e) => handleAllocationChange(sale.id, e.target.value, sale.saldoPendiente)}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleToggleFullAllocation(sale)}
                            className="btn btn-icon"
                            style={{ height: '32px', padding: '0 8px', fontSize: '0.8rem' }}
                            title="Asignar total de esta nota"
                          >
                            <CheckCircle size={16} color={(parseFloat(allocations[sale.id]) === sale.saldoPendiente) ? 'var(--primary-color)' : 'var(--text-secondary)'} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* FOOTER */}
          <div className="abono-footer" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <label className="abono-whatsapp-toggle" style={{ margin: 0 }}>
              <div className="toggle-info">
                <MessageCircle size={20} className="icon-whatsapp" />
                <span>Enviar recibo por WhatsApp</span>
              </div>
              <input
                id="send-receipt-abono"
                type="checkbox"
                checked={sendReceipt}
                onChange={(e) => setSendReceipt(e.target.checked)}
              />
            </label>

            <div className="abono-actions" style={{ margin: 0 }}>
              <button type="submit" className="btn btn-save" disabled={!!error || !monto}>
                <CheckCircle size={18} />
                Confirmar Abono
              </button>
              <button type="button" className="btn btn-cancel" onClick={onClose}>
                Cancelar
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}