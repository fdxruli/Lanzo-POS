const firstLabel = (...values) => values.find((value) => (
  typeof value === 'string' && value.trim().length > 0
))?.trim() || null;

// Device identifiers are provenance for technical audit, not customer-facing copy.
export const getOpeningDeviceLabel = (session = {}) => (
  firstLabel(
    session.opened_by_device_name,
    session.opening_device_name,
    session.device_name
  ) || 'Dispositivo registrado'
);

export const buildLegacyCashAdoptionConfirmation = (session = {}) => (
  `Estás vinculando esta caja a tu identidad administrativa actual.\n\nCaja: $${Number(session.expected_cash_total || 0).toFixed(2)}\nAbierta: ${session.opened_at ? new Date(session.opened_at).toLocaleString() : 'Fecha no disponible'}\nDispositivo original: ${getOpeningDeviceLabel(session)}\n\nEsto NO combinará otras cajas abiertas.`
);
