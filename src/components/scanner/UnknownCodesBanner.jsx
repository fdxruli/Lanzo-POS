// src/components/scanner/UnknownCodesBanner.jsx
import React from 'react';

export function UnknownCodesBanner({ unknownCodes, onClear }) {
  if (unknownCodes.length === 0) {
    return null;
  }

  return (
    <div className="scanner-error-banner">
      <div className="scanner-error-header">
        <p>⚠️ Productos no registrados:</p>
        <button className="btn-clear-errors" onClick={onClear}>
          Descartar fallos
        </button>
      </div>
      <div className="unknown-codes-list">
        {unknownCodes.map((item) => (
          <span key={item.code} className="unknown-badge">
            {item.code} {item.attempts > 1 && `(x${item.attempts})`}
          </span>
        ))}
      </div>
    </div>
  );
}
