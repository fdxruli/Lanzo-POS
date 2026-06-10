/**
 * @typedef {Object} BatchFormValues
 * @property {string | number} cost
 * @property {string | number} price
 * @property {string | number} stock
 * @property {string} notes
 * @property {string} expiryDate
 * @property {string} alertTargetDate
 * @property {string} alertType
 * @property {string} manufacturerBatchId
 * @property {string} sku
 * @property {string} attribute1
 * @property {string} attribute2
 * @property {string} location
 * @property {boolean} pagadoDeCaja
 */

/**
 * @param {BatchFormValues} values
 * @param {{ expirationMode?: string }} product - Producto padre para validación condicional
 * @returns {{ valid: false, message: string } | { valid: true, parsed: { nStock: number, nCost: number, nPrice: number } }}
 */
export function validateBatchInput(values, product = {}) {
  const nStock = Number.parseFloat(values.stock);
  const nCost = Number.parseFloat(values.cost);
  const nPrice = Number.parseFloat(values.price);

  if (Number.isNaN(nStock) || Number.isNaN(nCost) || Number.isNaN(nPrice)) {
    return { valid: false, message: 'Por favor, ingresa valores numericos validos.' };
  }

  if (nStock < 0) {
    return { valid: false, message: 'ERROR DE SEGURIDAD: No se permiten entradas de stock negativas.' };
  }

  if (nCost < 0) {
    return { valid: false, message: 'ERROR DE SEGURIDAD: El costo no puede ser negativo.' };
  }

  if (nPrice < 0) {
    return { valid: false, message: 'ERROR DE SEGURIDAD: El precio no puede ser negativo.' };
  }

  if (product?.expirationMode === 'STRICT') {
    const rawBatchId = String(values.manufacturerBatchId || '').trim();
    if (!rawBatchId) {
      return {
        valid: false,
        message: '⚠️ LOTE OBLIGATORIO: El modo STRICT requiere el Lote Alfanumérico del Fabricante.'
      };
    }
  }

  // SSOT: Si el modo de expiración no es NONE, la fecha de caducidad es OBLIGATORIA en el lote.
  if (product?.expirationMode === 'STRICT' || product?.expirationMode === 'SHELF_LIFE') {
    const rawDate = String(values.expiryDate || '').trim();
    
    if (!rawDate && product?.expirationMode === 'STRICT') {
      return {
        valid: false,
        message: '⚠️ FECHA OBLIGATORIA: El modo STRICT requiere la fecha de caducidad del lote antes de guardar.'
      };
    }

    if (rawDate) {
      const parsedDate = new Date(rawDate);
      if (Number.isNaN(parsedDate.getTime())) {
        return {
          valid: false,
          message: 'La fecha ingresada no es válida.'
        };
      }
    }
  }

  return {
    valid: true,
    parsed: {
      nStock,
      nCost,
      nPrice
    }
  };
}
