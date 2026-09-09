// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StructuredAnalysisResult from './AIAgentStructuredResult';

const makeResult = (payload = {}, overrides = {}) => ({
  agentType: 'inventoryAuditor',
  agentName: 'Auditor de Inventario',
  generatedAt: '2026-09-09T12:30:00.000Z',
  status: 'completed',
  rawResultContent: JSON.stringify({
    formatVersion: '1.1',
    executiveSummary: 'Resumen ejecutivo legible.',
    severity: 'warning',
    confidence: 0.8,
    coverage: { complete: true, factsTotal: 2, factsIncluded: 2, factsOmitted: 0, notes: [] },
    findings: [],
    actions: [],
    opportunities: [],
    questionsToAskUser: [],
    toolReferences: [],
    ...payload
  }),
  ...overrides
});

describe('AIAgentStructuredResult', () => {
  afterEach(() => cleanup());

  it('renders the human report first and keeps full JSON closed in technical details', () => {
    const result = makeResult({
      title: 'Reporte de inventario',
      metrics: { productosEnRiesgo: 2 },
      findings: [{ id: 'finding-1', title: 'Revisar existencias', severity: 'warning', evidence: ['Stock bajo'] }]
    });

    render(<StructuredAnalysisResult result={result} onAction={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Reporte de inventario' })).toBeVisible();
    expect(screen.getByText('Resumen ejecutivo legible.')).toBeVisible();
    expect(screen.getByText('Métricas importantes')).toBeVisible();
    expect(screen.getByText('Descargar reporte')).toBeVisible();
    expect(screen.getByText('Descargar JSON técnico')).toBeVisible();

    const technicalDetails = screen.getByText('Detalles técnicos').closest('details');
    expect(technicalDetails).not.toBeNull();
    expect(technicalDetails).not.toHaveAttribute('open');
    expect(screen.getByText('Reporte de inventario')).toBeVisible();
  });

  it('shows friendly messages instead of empty blocks for empty lists', () => {
    render(<StructuredAnalysisResult result={makeResult()} onAction={vi.fn()} />);

    expect(screen.getByText('No hay hallazgos registrados en este análisis.')).toBeVisible();
    expect(screen.getByText('No hay recomendaciones registradas en este análisis.')).toBeVisible();
    expect(screen.getByText('No hay oportunidades registradas en este análisis.')).toBeVisible();
    expect(screen.getByText('No hay preguntas pendientes para este análisis.')).toBeVisible();
  });

  it('shows the partial-coverage state and deterministic local metrics', () => {
    const result = makeResult({
      title: 'Auditoría de inventario',
      coverage: { complete: false, factsTotal: 69, factsIncluded: 24, factsOmitted: 45, notes: [] }
    }, {
      status: 'invalid',
      factSnapshot: {
        menuStats: { outOfStockCount: 9 },
        inventoryAlerts: {
          outOfStockProducts: { total: 9, included: 9, omitted: 0 },
          lowStockProducts: { total: 10, included: 10, omitted: 0 },
          potentialDeadStock: { total: 50, included: 5, omitted: 45 },
          deadStockTotalTiedCapital: 19045.9
        },
        wasteStats: { wasteTransactions: 0 },
        coverage: { complete: false, factsTotal: 69, factsIncluded: 24, factsOmitted: 45 }
      }
    });

    render(<StructuredAnalysisResult result={result} onAction={vi.fn()} />);

    expect(screen.getAllByText('Completado con cobertura parcial').length).toBeGreaterThan(0);
    expect(screen.getByText('Este análisis utiliza una muestra parcial de los datos.')).toBeVisible();
    expect(screen.getByText('24 de 69 datos fueron enviados al análisis.')).toBeVisible();
    expect(screen.getByText('45 datos permanecen disponibles localmente.')).toBeVisible();
    expect(screen.getByText('Confianza del modelo:').parentElement).toHaveTextContent('Confianza del modelo: 80%');
    expect(screen.getByText('Cobertura de datos:').parentElement).toHaveTextContent('Cobertura de datos: 35%');
    expect(screen.getByText('Datos calculados localmente')).toBeVisible();
    expect(screen.getByText('$19,045.90')).toBeVisible();
    expect(screen.getAllByText('9').length).toBeGreaterThan(0);
    expect(screen.getByText('10')).toBeVisible();
    expect(screen.getByText('50')).toBeVisible();
    expect(screen.queryByText('Inválido')).not.toBeInTheDocument();
  });

  it('marks empty collections as having no records in the period', () => {
    const result = makeResult({}, {
      factSnapshot: {
        coverage: { complete: true, factsTotal: 0, factsIncluded: 0, factsOmitted: 0 },
        inventoryAlerts: {
          outOfStockProducts: { total: 0, included: 0, omitted: 0, reason: 'provider_payload_limit' }
        }
      }
    });

    render(<StructuredAnalysisResult result={result} onAction={vi.fn()} />);

    expect(screen.getAllByText('No se encontraron registros en este período.').length).toBeGreaterThan(0);
    expect(screen.queryByText('Motivo: provider_payload_limit')).not.toBeInTheDocument();
  });

  it('hides technical codes while keeping business labels for actions and findings', () => {
    const result = makeResult({
      toolReferences: ['inventory.stockRisk'],
      findings: [{
        id: 'finding-1',
        title: 'inventory.stockRisk',
        summary: 'Permiso requerido: products',
        severity: 'danger',
        evidence: ['outOfStockProducts.total=9']
      }],
      actions: [{
        id: 'action-1',
        label: 'Revisar productos',
        description: 'Ruta: /productos',
        priority: 'high',
        type: 'navigate',
        route: '/productos'
      }]
    });

    render(<StructuredAnalysisResult result={result} onAction={vi.fn()} />);

    expect(screen.getByText('Riesgo de inventario')).toBeVisible();
    expect(screen.getByText('Módulo necesario: Productos')).toBeVisible();
    expect(screen.getByText('Productos agotados: 9')).toBeVisible();
    expect(screen.getByText('Ir al módulo Productos')).toBeVisible();
    expect(screen.queryByText('tool: inventory.stockRisk')).not.toBeInTheDocument();
    expect(screen.queryByText('coverage_incomplete')).not.toBeInTheDocument();
  });
});
