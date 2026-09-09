// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import {
  AI_REPORT_UI_STORAGE_KEY,
  readAIReportUiState,
  writeAIReportUiState
} from '../aiReportUiState';

describe('aiReportUiState', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('persists only report UI selection and mode, not the report payload', () => {
    writeAIReportUiState({
      activeTab: 'tips',
      showAIAgent: true,
      hasOpenedAIAgent: true,
      selectedAgent: 'inventoryAuditor',
      selectedDateRange: 'last_7_days',
      selectedReportId: 'ai_analysis_1'
    });

    expect(readAIReportUiState()).toMatchObject({
      activeTab: 'tips',
      showAIAgent: true,
      hasOpenedAIAgent: true,
      selectedAgent: 'inventoryAuditor',
      selectedDateRange: 'last_7_days',
      selectedReportId: 'ai_analysis_1'
    });
    expect(window.sessionStorage.getItem(AI_REPORT_UI_STORAGE_KEY)).not.toContain('executiveSummary');
  });

  it('falls back safely when stored state is malformed', () => {
    window.sessionStorage.setItem(AI_REPORT_UI_STORAGE_KEY, '{malformed');
    expect(readAIReportUiState()).toMatchObject({
      showAIAgent: false,
      selectedAgent: null,
      selectedReportId: null
    });
  });
});
