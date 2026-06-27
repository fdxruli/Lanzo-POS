import { describe, expect, it } from 'vitest';
import {
  REPORT_SOURCE_LABELS,
  REPORT_SOURCE_MODES,
  buildReportSource,
  getReportSourceLabel,
  isCacheReportSource,
  isCloudFinalReportSource,
  isCloudReportSource,
  isLocalReportSource,
  isMixedReportSource,
  normalizeReportSource
} from '../reportSourceBadges';

describe('reportSourceBadges', () => {
  it('debe tolerar null sin romper la pantalla de reportes/ventas', () => {
    expect(normalizeReportSource(null)).toEqual({});
    expect(getReportSourceLabel(null)).toBe(REPORT_SOURCE_LABELS.local);
    expect(isCloudReportSource(null)).toBe(false);
    expect(isCloudFinalReportSource(null)).toBe(false);
    expect(isMixedReportSource(null)).toBe(false);
    expect(isCacheReportSource(null)).toBe(false);
    expect(isLocalReportSource(null)).toBe(false);
  });

  it('debe construir una fuente local segura cuando la entrada no es objeto', () => {
    expect(buildReportSource(null)).toMatchObject({
      mode: REPORT_SOURCE_MODES.LOCAL,
      official: [],
      local: [],
      warnings: [],
      stale: false,
      generatedAt: null
    });
  });

  it('debe seguir detectando fuentes cloud finales validas', () => {
    expect(isCloudFinalReportSource({ mode: REPORT_SOURCE_MODES.CLOUD_FINAL })).toBe(true);
    expect(isCloudFinalReportSource({ final: true })).toBe(true);
    expect(getReportSourceLabel({ mode: REPORT_SOURCE_MODES.CLOUD_FINAL })).toBe(REPORT_SOURCE_LABELS.cloud_final);
  });
});
