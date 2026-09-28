import { describe, expect, it } from 'vitest';
import { validateCompetitiveEvidence } from '../../../services/ai/competitiveAnalysis';
import LiaFormErrorSummary, { LiaFieldIssue } from '../LiaFormValidationComponents';
import * as validationComponents from '../LiaFormValidationComponents';
import {
  presentCompetitiveValidation,
  presentQuestionValidation,
  validateLiaScenarioForm
} from '../liaFormValidation';

const competitor = (overrides = {}) => ({
  uiKey: 'competitor-1',
  name: 'Mercado Uno',
  observedAt: '2026-09-28',
  location: 'Centro',
  source: { type: 'manual', url: '', text: '', label: '' },
  observations: [{
    uiKey: 'observation-1',
    name: 'Café Sierra',
    price: '',
    currency: '',
    type: 'product'
  }],
  ...overrides
});

describe('Lía form validation presentation', () => {
  it('exports the reusable summary and field message components', () => {
    expect(Object.keys(validationComponents).sort()).toEqual(['LiaFieldIssue', 'default']);
    expect({ summary: typeof LiaFormErrorSummary, field: typeof LiaFieldIssue }).toEqual({ summary: 'function', field: 'function' });
  });

  it('shows a free question error only after submit', () => {
    expect(presentQuestionValidation('', false)).toEqual([]);
    expect(presentQuestionValidation('   ', true)).toMatchObject([{
      targetId: 'sales-agent-question',
      message: 'Escribe una pregunta antes de iniciar el análisis.',
      severity: 'error'
    }]);
    expect(presentQuestionValidation('¿Cómo van mis ventas?', true)).toEqual([]);
  });

  it('translates all missing goal fields and the margin range from the contract', () => {
    const missing = validateLiaScenarioForm('goal_simulation', {});
    expect(missing.issues.map(({ message }) => message)).toEqual([
      'Selecciona qué meta quieres alcanzar.',
      'Introduce un valor objetivo mayor que cero.'
    ]);
    const invalidMargin = validateLiaScenarioForm('goal_simulation', {
      goalType: 'gross_margin', targetValue: '100'
    });
    expect(invalidMargin.issues).toMatchObject([{
      path: 'targetValue',
      targetId: 'sales-agent-goal-target',
      message: 'El margen objetivo debe ser inferior al 100%.'
    }]);
  });

  it('collects what-if variable, percentage and conditional product errors', () => {
    const validation = validateLiaScenarioForm('what_if_analysis', { changeType: 'product' });
    expect(validation.issues.map(({ message }) => message)).toEqual([
      'Introduce el porcentaje de cambio.',
      'Selecciona el producto que deseas simular.'
    ]);
    const outOfRange = validateLiaScenarioForm('what_if_analysis', {
      changeType: 'sales', changePercent: '501'
    });
    expect(outOfRange.issues[0]).toMatchObject({
      targetId: 'sales-agent-what-if-percent',
      message: 'El porcentaje permitido va de −99.9% a +500%.'
    });
  });

  it('requires a product and positive price while allowing an empty historical volume', () => {
    const missing = validateLiaScenarioForm('price_simulation', {});
    expect(missing.issues.map(({ message }) => message)).toEqual([
      'Selecciona el producto que deseas simular.',
      'Introduce el nuevo precio.'
    ]);
    expect(validateLiaScenarioForm('price_simulation', {
      productName: 'Producto A', newPrice: '80', historicalVolume: ''
    })).toMatchObject({ valid: true, normalized: { productName: 'Producto A', newPrice: 80 } });
    expect(validateLiaScenarioForm('price_simulation', {
      productName: 'Producto A', newPrice: '-1'
    }).issues).toMatchObject([{ message: 'Introduce un valor mayor que cero.' }]);
  });

  it('keeps promotion price and volume optional, validates entered values and rejects conflicting modes', () => {
    expect(validateLiaScenarioForm('promotion_opportunity', { productName: 'Producto A' }).valid).toBe(true);
    expect(validateLiaScenarioForm('promotion_opportunity', {
      productName: 'Producto A', discountPercent: '101'
    }).issues).toMatchObject([{ message: 'El descuento debe estar entre 0% y 100%.' }]);
    expect(validateLiaScenarioForm('promotion_opportunity', {
      productName: 'Producto A', discountPercent: '20', promotionalPrice: '80'
    }).issues).toMatchObject([{
      targetId: 'sales-agent-promotion-mode',
      message: 'Elige un descuento porcentual o un precio promocional, no ambos.'
    }]);
    expect(validateLiaScenarioForm('promotion_opportunity', {
      productName: 'Producto A', discountPercent: '20', historicalVolume: '-1'
    }).issues).toMatchObject([{ message: 'El volumen esperado no puede ser negativo.' }]);
  });

  it('translates simultaneous competitive paths to row labels and human messages', () => {
    const value = {
      competitors: [competitor({
        observedAt: '',
        observations: [
          { uiKey: 'observation-1', name: 'Café Sierra', price: '39', currency: '' },
          { uiKey: 'observation-2', name: '', price: '', currency: '' }
        ]
      })]
    };
    const validation = validateCompetitiveEvidence(value, { now: new Date('2026-09-28T12:00:00Z') });
    const issues = presentCompetitiveValidation(validation, value);
    expect(issues.filter(({ severity }) => severity === 'error')).toMatchObject([
      { fieldLabel: 'Competidor 1 → Fecha observada', message: 'Selecciona la fecha en que observaste esta información.' },
      { fieldLabel: 'Competidor 1 → Observación 1 → Moneda', message: 'Indica la moneda del precio, por ejemplo MXN.' },
      { fieldLabel: 'Competidor 1 → Observación 2 → Nombre', message: 'Escribe el nombre del producto o servicio.' }
    ]);
    expect(issues.some(({ message }) => message.includes('competitors.0'))).toBe(false);
    expect(issues[1].targetId).toBe('lia-competitor-1-observation-1-currency');
  });

  it('distinguishes invalid and missing sources and keeps duplicate removal as a warning', () => {
    const value = {
      competitors: [competitor({
        source: { type: 'public_url', url: 'javascript:bad', text: '' },
        observations: [
          { uiKey: 'observation-1', name: 'Café Sierra', price: '', currency: '' },
          { uiKey: 'observation-2', name: 'Café Sierra', price: '', currency: '' }
        ]
      })]
    };
    const issues = presentCompetitiveValidation(validateCompetitiveEvidence(value), value);
    expect(issues).toMatchObject([
      { targetId: 'lia-competitor-1-url', message: 'Utiliza una dirección pública HTTP o HTTPS válida.', severity: 'error' },
      { targetId: 'lia-competitor-1-observation-2-name', message: 'Esta observación está repetida; revisa si necesitas conservar ambas.', severity: 'warning' }
    ]);
  });
});
