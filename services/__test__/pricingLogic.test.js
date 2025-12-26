import { describe, it, expect } from 'vitest'; // O 'jest'
import { calculateCompositePrice } from '../pricingLogic';

describe('Lógica de Precios (Pricing Logic)', () => {

  // --- CASO 1: PRODUCTO SIMPLE ---
  it('Debe retornar el precio base para productos simples sin mayoreo', () => {
    const product = { price: 10, batchManagement: { enabled: false } };
    const price = calculateCompositePrice(product, 5);
    expect(price).toBe(10);
  });

  // --- CASO 2: MAYOREO SIMPLE ---
  it('Debe aplicar precio de mayoreo correctamente', () => {
    const product = { 
      price: 100, 
      wholesaleTiers: [
        { min: 10, price: 90 }, // 10 o más -> $90
        { min: 50, price: 80 }  // 50 o más -> $80
      ] 
    };

    // Caso: Menos del mínimo
    expect(calculateCompositePrice(product, 5)).toBe(100);
    // Caso: Primer nivel de mayoreo
    expect(calculateCompositePrice(product, 10)).toBe(90);
    // Caso: Entre niveles
    expect(calculateCompositePrice(product, 25)).toBe(90);
    // Caso: Segundo nivel
    expect(calculateCompositePrice(product, 55)).toBe(80);
  });

  // --- CASO 3: LOTES FIFO (EL MÁS COMPLEJO) ---
  it('Debe calcular precio promedio ponderado con lotes FIFO', () => {
    const product = {
      price: 20, // Precio base (fallback)
      batchManagement: { enabled: true },
      activeBatches: [
        { id: 1, price: 10, stock: 5, createdAt: '2023-01-01' }, // Lote Viejo (Barato)
        { id: 2, price: 20, stock: 10, createdAt: '2023-01-02' } // Lote Nuevo (Caro)
      ]
    };

    // Escenario: Compro 5 unidades (Todo del lote viejo)
    // Precio esperado: 10
    expect(calculateCompositePrice(product, 5)).toBe(10);

    // Escenario: Compro 10 unidades (5 del viejo @10, 5 del nuevo @20)
    // Costo total = (5*10) + (5*20) = 50 + 100 = 150
    // Precio unitario = 150 / 10 = 15
    expect(calculateCompositePrice(product, 10)).toBe(15);

    // Escenario: Compro 20 unidades (5 @10, 10 @20, 5 faltantes @20 precio base)
    // Costo total = 50 + 200 + 100 = 350
    // Precio unitario = 350 / 20 = 17.5
    expect(calculateCompositePrice(product, 20)).toBe(17.5);
  });

  // --- CASO 4: INTERACCIÓN MAYOREO + LOTES ---
  it('El precio de mayoreo debe tener prioridad sobre el cálculo FIFO', () => {
    const product = {
      price: 20,
      batchManagement: { enabled: true },
      activeBatches: [{ id: 1, price: 20, stock: 100, createdAt: '2023-01-01' }],
      wholesaleTiers: [{ min: 10, price: 15 }] // Oferta especial
    };

    // Aunque el lote cuesta 20, si llevo 10, el sistema debe respetar el mayoreo de 15
    expect(calculateCompositePrice(product, 10)).toBe(15);
  });

  // --- CASO 5: ERRORES Y BORDE ---
  it('Debe manejar cantidades inválidas o cero', () => {
    const product = { price: 50 };
    expect(calculateCompositePrice(product, 0)).toBe(50); // Retorna precio base
    expect(calculateCompositePrice(product, -5)).toBe(50);
    expect(calculateCompositePrice(null, 10)).toBe(0);
  });

});