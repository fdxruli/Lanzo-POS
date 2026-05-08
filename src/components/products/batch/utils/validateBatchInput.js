/**
 * @typedef {Object} BatchFormValues
 * @property {string | number} cost
 * @property {string | number} price
 * @property {string | number} stock
 * @property {string} notes
 * @property {string} expiryDate
 * @property {string} sku
 * @property {string} attribute1
 * @property {string} attribute2
 * @property {string} location
 * @property {boolean} pagadoDeCaja
 */

/**
 * @param {BatchFormValues} values
 * @returns {{ valid: false, message: string } | { valid: true, parsed: { nStock: number, nCost: number, nPrice: number } }}
 */
export function validateBatchInput(values) {
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

  return {
    valid: true,
    parsed: {
      nStock,
      nCost,
      nPrice
    }
  };
}

