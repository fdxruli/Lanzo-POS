const AI_REPORT_UI_STATE_KEY = 'lanzo_ai_report_ui_v1';

const DEFAULT_STATE = Object.freeze({
  activeTab: null,
  showAIAgent: false,
  hasOpenedAIAgent: false,
  selectedAgent: null,
  selectedDateRange: null,
  selectedReportId: null
});

const getSessionStorage = () => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

const normalizeState = (value = {}) => ({
  ...DEFAULT_STATE,
  activeTab: typeof value.activeTab === 'string' ? value.activeTab : null,
  showAIAgent: value.showAIAgent === true,
  hasOpenedAIAgent: value.hasOpenedAIAgent === true,
  selectedAgent: typeof value.selectedAgent === 'string' ? value.selectedAgent : null,
  selectedDateRange: typeof value.selectedDateRange === 'string' ? value.selectedDateRange : null,
  selectedReportId: typeof value.selectedReportId === 'string' ? value.selectedReportId : null
});

export const readAIReportUiState = () => {
  const storage = getSessionStorage();
  if (!storage) return { ...DEFAULT_STATE };

  try {
    const stored = JSON.parse(storage.getItem(AI_REPORT_UI_STATE_KEY) || '{}');
    return normalizeState(stored);
  } catch {
    return { ...DEFAULT_STATE };
  }
};

export const writeAIReportUiState = (patch = {}) => {
  const storage = getSessionStorage();
  const nextState = normalizeState({ ...readAIReportUiState(), ...patch });
  if (!storage) return nextState;

  try {
    storage.setItem(AI_REPORT_UI_STATE_KEY, JSON.stringify(nextState));
  } catch {
    // La vista sigue funcionando aunque el navegador no permita sessionStorage.
  }

  return nextState;
};

export const AI_REPORT_UI_STORAGE_KEY = AI_REPORT_UI_STATE_KEY;

export default readAIReportUiState;
