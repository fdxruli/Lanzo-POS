import { describe, expect, it } from 'vitest';
import { mapEdgeErrorMessage } from '../../aiService';

describe('AI Edge error mapping', () => {
  it('gives an actionable message for an invalid commercial request without echoing payload details', () => {
    expect(mapEdgeErrorMessage({
      code: 'INVALID_REQUEST',
      message: 'secret context should not be shown'
    })).toBe('No pudimos procesar esta consulta. Revisa las opciones seleccionadas e inténtalo nuevamente.');
  });
});
