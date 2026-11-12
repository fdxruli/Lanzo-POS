// Distinct scan failures are shown once per code and reason until dismissed.
import React from 'react';

export function UnknownCodesBanner({ issues = [], unknownCodes = [], onClear }) {
  const visible = issues.length ? issues : unknownCodes.map((item) => ({
    code: item.code,
    status: 'NOT_FOUND',
    message: 'Producto no registrado',
  }));
  if (!visible.length) return null;

  return (
    <div className="scanner-error-banner">
      <div className="scanner-error-header">
        <p>Incidencias de lectura:</p>
        <button type="button" className="btn-clear-errors" onClick={onClear}>
          Descartar avisos
        </button>
      </div>
      <div className="unknown-codes-list">
        {visible.map((item) => (
          <div key={`${item.code}:${item.status}`} className="unknown-badge">
            <strong>{item.code}</strong>: {item.message}
            {item.productName && <span> — {item.productName}</span>}
            {item.status === 'DUPLICATE' && (
              <div>
                {item.matches?.map((match) => match.name).filter(Boolean).join(', ')}
                <div>Corrige la asignación del código en Productos antes de vender.</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
