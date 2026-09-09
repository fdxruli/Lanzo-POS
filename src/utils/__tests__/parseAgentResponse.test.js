import { describe, expect, it } from 'vitest';
import { parseAgentResponse } from '../parseAgentResponse';

const completeReport = {
  formatVersion: '1.1',
  executiveSummary: 'Resumen basado en hechos.',
  severity: 'info',
  confidence: 0.8,
  coverage: {
    complete: true,
    factsTotal: 3,
    factsIncluded: 3,
    factsOmitted: 0,
    notes: []
  },
  findings: [{ id: 'finding-1', title: 'Hallazgo', summary: 'Dato confirmado.', severity: 'info', evidence: ['3 hechos'] }],
  actions: [{ id: 'action-1', label: 'Revisar', description: 'Acción concreta.', priority: 'medium', type: 'review' }],
  opportunities: [],
  questionsToAskUser: [],
  toolReferences: ['finance.salesPulse']
};

describe('parseAgentResponse report integrity', () => {
  it('parses strict JSON and keeps the complete contract', () => {
    const raw = JSON.stringify(completeReport);
    const parsed = parseAgentResponse(raw);

    expect(parsed.isStructured).toBe(true);
    expect(parsed.isComplete).toBe(true);
    expect(parsed.validContract).toBe(true);
    expect(parsed.rawResultContent).toBe(raw);
    expect(parsed.coverage.factsOmitted).toBe(0);
  });

  it('parses JSON inside a Markdown fence without losing the raw response', () => {
    const raw = `respuesta:\n\n\`\`\`json\n${JSON.stringify(completeReport)}\n\`\`\``;
    const parsed = parseAgentResponse(raw);

    expect(parsed.isStructured).toBe(true);
    expect(parsed.isComplete).toBe(true);
    expect(parsed.rawResultContent).toBe(raw);
  });

  it('marks a partial JSON response as incomplete while preserving raw content', () => {
    const raw = JSON.stringify({
      ...completeReport,
      coverage: { complete: false, factsTotal: 5, factsIncluded: 3, factsOmitted: 2, notes: ['Lista limitada'] }
    });
    const truncated = raw.slice(0, -18);
    const parsed = parseAgentResponse(truncated, { finishReason: 'length' });

    expect(parsed.rawResultContent).toBe(truncated);
    expect(parsed.isComplete).toBe(false);
    expect(parsed.status).toBe('incomplete');
  });

  it('keeps HTTP 200 structured JSON with coverage_incomplete out of invalid', () => {
    const raw = JSON.stringify({
      ...completeReport,
      coverage: { complete: false, factsTotal: 69, factsIncluded: 24, factsOmitted: 45, notes: ['Muestra limitada'] }
    });
    const parsed = parseAgentResponse(raw, { finishReason: 'stop' });

    expect(parsed.isStructured).toBe(true);
    expect(parsed.parseStatus).toBe('structured');
    expect(parsed.reportStatus).toBe('incomplete');
    expect(parsed.coverageStatus).toBe('partial');
    expect(parsed.status).not.toBe('invalid');
  });

  it('unwraps the current parsedResult.parsedResult shape', () => {
    const internal = parseAgentResponse(JSON.stringify(completeReport), { finishReason: 'stop' });
    const wrapped = JSON.stringify({
      success: true,
      status: 'invalid',
      resultFormat: 'structured_json',
      parsedResult: { parsedResult: internal }
    });
    const parsed = parseAgentResponse(wrapped, { finishReason: 'stop' });

    expect(parsed.isStructured).toBe(true);
    expect(parsed.executiveSummary).toBe(completeReport.executiveSummary);
    expect(parsed.parseStatus).toBe('structured');
  });

  it('preserves an empty provider response as a failed result', () => {
    const parsed = parseAgentResponse('', { finishReason: 'stop' });

    expect(parsed.status).toBe('failed');
    expect(parsed.isComplete).toBe(false);
    expect(parsed.rawResultContent).toBe('');
  });
});
