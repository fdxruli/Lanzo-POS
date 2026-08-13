import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  copyTextToClipboard: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

vi.mock('../../../services/support/supportContact', () => ({
  buildSupportMailtoUrl: vi.fn(),
  copyTextToClipboard: mocks.copyTextToClipboard
}));
vi.mock('../../../services/Logger', () => ({ default: mocks.logger }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: { getState: vi.fn(() => ({})) }
}));

import { ErrorBoundary } from '../ErrorBoundary';

const createBoundary = () => {
  const boundary = new ErrorBoundary({});
  boundary._buildReportMessage = vi.fn(() => 'REPORTE');
  boundary.setState = vi.fn();
  return boundary;
};

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('ErrorBoundary clipboard feedback', () => {
  it('sets copied success only when the shared helper returns true', async () => {
    vi.useFakeTimers();
    mocks.copyTextToClipboard.mockResolvedValue(true);
    const boundary = createBoundary();

    await boundary.handleCopy();

    expect(mocks.copyTextToClipboard).toHaveBeenCalledWith('REPORTE');
    expect(boundary.setState).toHaveBeenCalledWith({ copied: true });
    boundary.componentWillUnmount();
  });

  it('does not set copied success when the shared helper returns false', async () => {
    mocks.copyTextToClipboard.mockResolvedValue(false);
    const boundary = createBoundary();

    await boundary.handleCopy();

    expect(boundary.setState).not.toHaveBeenCalledWith({ copied: true });
  });
});
