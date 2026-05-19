// src/components/scanner/ScannerCartList.jsx
import React from 'react';

export function ScannerCartList({
  items,
  total,
  isConfirming,
  onAddQuantity,
  onRemoveQuantity,
}) {
  if (items.length === 0) {
    return (
      <p className="empty-message" style={{ padding: '2rem 0' }}>
        Escanea tu primer producto
      </p>
    );
  }

  return (
    <>
      <div className="scanned-items-list">
        {items.map((item, index) => (
          <div
            key={item.uniqueLineId || `${item.id}-${item.batchId ?? index}`}
            className="scanned-item"
          >
            <span
              className="scanned-item-name"
              style={{
                flex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {item.name}
            </span>
            <div className="scanned-item-controls">
              <button
                type="button"
                className="scanner-qty-btn"
                onClick={() => onRemoveQuantity(item.id, item.batchId)}
                disabled={isConfirming}
                title="Reducir cantidad"
              >
                {item.quantity === 1 ? '🗑️' : '-'}
              </button>

              <span className="scanner-qty-value">{item.quantity}</span>

              <button
                type="button"
                className="scanner-qty-btn"
                onClick={() => onAddQuantity(item)}
                disabled={isConfirming}
                title="Aumentar cantidad"
              >
                +
              </button>
            </div>
            <span className="scanned-item-price">
              ${(item.price * item.quantity).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
      <div className="scanner-total-container">
        <span>Total:</span>
        <span>${total.toFixed(2)}</span>
      </div>
    </>
  );
}
