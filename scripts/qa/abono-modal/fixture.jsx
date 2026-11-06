import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../src/index.css';
import '../../../src/styles/design-tokens.css';
import '../../../src/styles/buttons.css';
import '../../../src/styles/ui-modal.css';
import '../../../src/styles/ui-alert.css';
import AbonoModal from '../../../src/components/customers/AbonoModal';

const scenario = new URLSearchParams(location.search).get('scenario') || 'reconciled';
const customer = { id: 'controlled-customer', name: 'Cliente de demostración', debt: '30' };
const notes = ['001', '002'].map((folio, index) => ({
  id: `controlled-note-${folio}`,
  customer_id: customer.id,
  folio,
  status: 'closed',
  total: '20',
  original_balance_due: '20',
  current_balance_due: '15',
  credit_allocation_status: 'reconciled',
  timestamp: `2026-11-0${index + 1}T12:00:00Z`
}));
window.paymentCalls = [];

function Fixture() {
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState(
    scenario === 'empty' || scenario === 'pending' ? 'reconciled' : scenario
  );
  return (
    <>
      <main style={{ padding: '2rem' }}>
        <h1>Modal de abonos</h1>
        <p>Datos controlados; no demuestra funcionamiento financiero en Production.</p>
        <button className="ui-button ui-button--primary" onClick={() => setShow(true)}>
          Abrir abono de demostración
        </button>
      </main>
      <AbonoModal
        show={show}
        customer={customer}
        isCloudCredit
        cloudAllocationStatus={status}
        cashSession={{ id: 'controlled-cash' }}
        cashActor={{ displayName: 'Caja de demostración' }}
        authoritativePendingSales={
          status === 'loading' ? null : status === 'reconciled' && scenario !== 'empty' ? notes : []
        }
        onClose={() => setShow(false)}
        onReloadPendingSales={() => {
          setStatus('loading');
          window.finishReload = () => setStatus('reconciled');
        }}
        onConfirmAbono={(...args) => {
          window.paymentCalls.push(args);
          return new Promise((resolve) => {
            window.finishPayment = resolve;
          });
        }}
      />
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 99999,
          textAlign: 'center',
          font: '11px system-ui',
          padding: '2px',
          background: '#173e32',
          color: '#fff',
          pointerEvents: 'none'
        }}
      >
        DEMO LOCAL · DATOS CONTROLADOS · SIN OPERACIONES REALES
      </div>
    </>
  );
}
createRoot(document.getElementById('root')).render(<Fixture />);
