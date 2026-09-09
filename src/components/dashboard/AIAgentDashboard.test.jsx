// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_REPORT_UI_STORAGE_KEY } from '../../utils/aiReportUiState';

const mocks = vi.hoisted(() => ({
  getHistory: vi.fn(),
  getDetail: vi.fn(),
  saveHistory: vi.fn(),
  validateConnection: vi.fn(),
  analyzeWithAI: vi.fn(),
  buildAgentPayload: vi.fn(),
  runAgentTools: vi.fn(),
  setCurrentActor: vi.fn()
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../services/auth/useActorRuntimeSnapshot', () => ({
  useActorRuntimeSnapshot: () => ({ status: 'granted', actorType: 'admin', permissions: [] })
}));
vi.mock('../../services/auth/aiAgentAuthorization', () => ({
  hasCurrentActorAIAgentPermission: () => true,
  assertCurrentAIAgentActor: () => undefined
}));
vi.mock('../../services/aiService', () => ({
  AIApiError: class AIApiError extends Error {},
  getAIConfigStatus: () => ({ hasKey: true, provider: 'openai-compatible', model: 'deepseek-chat' }),
  validateAIConnection: mocks.validateConnection,
  analyzeWithAI: mocks.analyzeWithAI
}));
vi.mock('../../services/aiAnalysisLocalHistoryService', () => ({
  getLocalAIAnalysisHistory: mocks.getHistory,
  getLocalAIAnalysisDetail: mocks.getDetail,
  saveLocalAIAnalysis: mocks.saveHistory
}));
vi.mock('../../utils/buildAgentPayload', () => ({
  DATE_RANGES: {
    TODAY: 'today',
    LAST_7_DAYS: 'last_7_days',
    LAST_30_DAYS: 'last_30_days',
    THIS_MONTH: 'this_month',
    LAST_MONTH: 'last_month'
  },
  formatDateRangeLabel: value => value,
  buildAgentPayload: mocks.buildAgentPayload
}));
vi.mock('../../utils/aiPromptBuilder', () => ({
  buildPrompt: () => ({ systemPrompt: 'system', userPrompt: 'user' }),
  validateAgentData: () => ({ valid: true })
}));
vi.mock('../../utils/parseAgentResponse', () => ({
  parseAgentResponse: raw => ({ isStructured: true, raw, resultFormat: 'structured_json', coverage: { complete: true } }),
  classifyParsedAgentResponse: () => ({ providerStatus: 'success', parseStatus: 'structured', reportStatus: 'completed', coverageStatus: 'complete' })
}));
vi.mock('../../agents/agentToolRegistry', () => ({
  getAvailableAgentTools: () => [],
  runAgentTools: mocks.runAgentTools
}));
vi.mock('../../agents/agentActionRouter', () => ({
  resolveAgentAction: action => action,
  executeAgentAction: () => ({ success: true })
}));
vi.mock('../../hooks/dashboard/useAgentPreview', () => ({
  useAgentPreview: () => ({ preview: [], isCalculating: false })
}));
vi.mock('./AIAgentUsageLegend', () => ({ default: () => null }));
vi.mock('./DataPreviewBanner', () => ({ default: () => null }));
vi.mock('./AgentActionConfirmModal', () => ({ default: () => null }));
vi.mock('./AIAgentStructuredResult', () => ({
  default: ({ result }) => <div data-testid="visible-ai-report">{result.id}: Reporte conservado</div>
}));

import AIAgentDashboard from './AIAgentDashboard';

const savedReport = {
  id: 'report-1',
  agentType: 'inventoryAuditor',
  dateRange: 'last_7_days',
  agentName: 'Auditor de inventario',
  generatedAtLabel: '09 sep 2026',
  resultFormat: 'structured_json',
  resultSummary: 'Reporte conservado',
  rawResultContent: '{"executiveSummary":"Reporte conservado"}',
  coverage: { factsOmitted: 0 }
};

const renderDashboard = () => render(
  <AIAgentDashboard
    menu={[{ id: 'product-1', stock: 3, minStock: 5 }]}
    sales={[]}
    customers={[]}
    wasteLogs={[]}
    businessType={['abarrotes']}
  />
);

describe('AIAgentDashboard report continuity', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.sessionStorage.setItem(AI_REPORT_UI_STORAGE_KEY, JSON.stringify({
      selectedAgent: 'inventoryAuditor',
      selectedDateRange: 'last_7_days',
      selectedReportId: savedReport.id,
      showAIAgent: true,
      hasOpenedAIAgent: true
    }));
    mocks.getHistory.mockResolvedValue([savedReport]);
    mocks.getDetail.mockResolvedValue(savedReport);
    mocks.saveHistory.mockResolvedValue(savedReport);
    mocks.validateConnection.mockResolvedValue({ valid: true, provider: 'openai-compatible', model: 'deepseek-chat' });
    mocks.runAgentTools.mockResolvedValue({ availableToolCount: 0, results: [] });
    mocks.buildAgentPayload.mockResolvedValue({ coverage: { complete: true } });
    mocks.analyzeWithAI.mockReset();
    mocks.validateConnection.mockClear();
    mocks.getHistory.mockClear();
    mocks.getDetail.mockClear();
  });

  afterEach(() => cleanup());

  it.each(['visibilitychange', 'focus'])('keeps the selected report visible after %s without starting another analysis', async eventName => {
    renderDashboard();
    expect(await screen.findByTestId('visible-ai-report')).toHaveTextContent('report-1');

    await act(async () => {
      if (eventName === 'visibilitychange') document.dispatchEvent(new Event(eventName));
      else window.dispatchEvent(new Event(eventName));
    });

    expect(screen.getByTestId('visible-ai-report')).toHaveTextContent('Reporte conservado');
    expect(mocks.analyzeWithAI).not.toHaveBeenCalled();
    expect(mocks.getHistory).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate the history or lose the selected report after secondary prop refreshes', async () => {
    const { rerender } = renderDashboard();
    expect(await screen.findByTestId('visible-ai-report')).toBeVisible();

    rerender(
      <AIAgentDashboard
        menu={[{ id: 'product-1', stock: 2, minStock: 5 }, { id: 'product-2', stock: 1, minStock: 3 }]}
        sales={[]}
        customers={[]}
        wasteLogs={[]}
        businessType={['abarrotes']}
      />
    );

    await waitFor(() => expect(screen.getByTestId('visible-ai-report')).toBeVisible());
    expect(screen.getByTestId('visible-ai-report')).toHaveTextContent('Reporte conservado');
    expect(mocks.getHistory).toHaveBeenCalledTimes(1);
  });
});
