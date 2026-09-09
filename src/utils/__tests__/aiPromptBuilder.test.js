import { describe, expect, it } from 'vitest';
import { buildCompactPromptPayload, buildPrompt } from '../aiPromptBuilder';

const baseFacts = {
  dateRange: {
    type: 'last7days',
    label: 'Etiqueta dinámica que no debe viajar',
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-08-08T00:00:00.000Z'
  },
  generatedAt: '2026-08-08T12:00:00.000Z',
  salesStats: { totalRevenue: 1200.5, totalTransactions: 12 },
  localDetails: {
    customers: [{ id: 'private-customer-id', name: 'Nombre privado' }]
  },
  rawData: { private: 'raw data must stay local' }
};

const toolRun = {
  executedAt: '2026-08-08T12:00:00.000Z',
  results: [{
    id: 'finance.salesPulse',
    title: 'Pulso financiero',
    severity: 'warning',
    summary: 'Ingreso confirmado en el período.',
    metrics: { totalRevenue: 1200.5 },
    evidence: ['No debe duplicarse en el prompt.']
  }]
};

describe('aiPromptBuilder compact facts contract', () => {
  it.each(['inventoryAuditor', 'financialAnalyst', 'customerStrategist'])('construye payload compacto para %s', (agentType) => {
    const compact = buildCompactPromptPayload(agentType, baseFacts, { businessType: 'retail' }, toolRun);

    expect(compact.schemaVersion).toBe('ai-facts-1.1');
    expect(compact.dateRange).toEqual({
      type: 'last7days',
      start: '2026-08-01T00:00:00.000Z',
      end: '2026-08-08T00:00:00.000Z'
    });
    expect(compact.facts).not.toHaveProperty('dateRange');
    expect(compact.facts).not.toHaveProperty('generatedAt');
    expect(compact.facts).not.toHaveProperty('localDetails');
    expect(compact.facts).not.toHaveProperty('rawData');
    expect(compact.toolReferences).toEqual([{
      id: 'finance.salesPulse',
      title: 'Pulso financiero',
      severity: 'warning',
      summary: 'Ingreso confirmado en el período.'
    }]);
  });

  it('emite JSON minificado, estable y sin datos personales locales', () => {
    const prompt = buildPrompt('customerStrategist', baseFacts, { businessType: 'retail' }, toolRun);
    const userPayload = JSON.parse(prompt.userPrompt);

    expect(prompt.systemPrompt).toContain('JSON');
    expect(userPayload.outputFormat).toBe('JSON');
    expect(prompt.userPrompt).not.toContain('Nombre privado');
    expect(prompt.userPrompt).not.toContain('private-customer-id');
    expect(prompt.userPrompt).not.toContain('raw data must stay local');
    expect(prompt.userPrompt).not.toContain('No debe duplicarse en el prompt');
    expect(prompt.promptStats.factsOnly).toBe(true);
    expect(prompt.promptStats.containsLocalDetails).toBe(false);
    expect(prompt.promptStats.containsRawToolResults).toBe(false);
    expect(prompt.promptStats.userBytes).toBe(new TextEncoder().encode(prompt.userPrompt).byteLength);
  });
});
