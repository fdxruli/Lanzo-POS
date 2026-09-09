// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getUsage = vi.hoisted(() => vi.fn());
vi.mock('../../services/aiAgentUsageService', () => ({ getAIAgentUsage: getUsage }));

import AIAgentUsageLegend from './AIAgentUsageLegend';

describe('AIAgentUsageLegend secondary refreshes', () => {
  beforeEach(() => {
    getUsage.mockResolvedValue({ success: true, used: 1, remaining: 14, limit: 15 });
  });

  afterEach(() => cleanup());

  it('does not refresh usage merely because the browser regains focus', async () => {
    render(<AIAgentUsageLegend enabled connectionStatus={{ isApiReady: true, isOnline: true }} />);
    await vi.waitFor(() => expect(getUsage).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();

    expect(getUsage).toHaveBeenCalledTimes(1);
  });
});
