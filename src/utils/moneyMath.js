// src/utils/moneyMath.js
import Big from 'big.js';

// Configurar estándar contable: Redondeo de mitad a par (Banker's Rounding)
// Evita el sesgo estadístico de siempre redondear hacia arriba en el .5
Big.RM = Big.roundHalfEven;

export const Money = {
  /**
   * Inicializa un valor seguro. Retorna una instancia de Big.
   */
  init: (value) => {
    if (value === null || value === undefined || value === '') return new Big(0);
    try {
      return new Big(value);
    } catch (e) {
      throw new Error(`[MoneyMath] Invalid financial value: ${value}`);
    }
  },

  add: (a, b) => Money.init(a).plus(Money.init(b)),
  
  subtract: (a, b) => Money.init(a).minus(Money.init(b)),
  
  multiply: (a, b) => Money.init(a).times(Money.init(b)),
  
  divide: (a, b) => {
    const divisor = Money.init(b);
    if (divisor.eq(0)) throw new Error('Division by zero');
    return Money.init(a).div(divisor);
  },

  /**
   * Solo debe usarse al momento de PERSISTIR en la BD o MOSTRAR en UI.
   * Internamente todo debe fluir como instancias Big o strings crudos.
   */
  toCents: (value) => parseInt(Money.init(value).times(100).round(0).toString(), 10),
  
  fromCents: (cents) => Money.init(cents).div(100),

  /**
   * Retorna el número redondeado a 2 decimales exactos como Number,
   * útil solo para la compatibilidad con componentes UI tontos.
   */
  toNumber: (value) => Number(Money.init(value).round(2).toString()),

  /**
   * Retorna el string exacto. Úsalo para guardar en Dexie si decides no usar centavos.
   */
  toExactString: (value) => Money.init(value).toString()
};