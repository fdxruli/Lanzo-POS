// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EcommerceSiteBuilderFoundation from '../EcommerceSiteBuilderFoundation';

const mocks = vi.hoisted(() => ({
  getSiteBuilderState: vi.fn(),
  listSiteVersions: vi.fn(),
  publishSiteDraft: vi.fn(),
  restoreSiteVersion: vi.fn()
}));

vi.mock('../../../services/ecommerce/ecommerceSiteBuilderService', () => mocks);
vi.mock('react-hot-toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const builder = { success: true, draft: { revision: 4 }, hasUnpublishedChanges: true };

describe('EcommerceSiteBuilderFoundation', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSiteBuilderState.mockResolvedValue(builder);
    mocks.listSiteVersions.mockImplementation(({ offset = 0 } = {}) => Promise.resolve({
      success: true,
      versions: offset === 0 ? [{ id: 'version-1', versionNumber: 1 }] : [{ id: 'version-2', versionNumber: 2 }],
      hasMore: offset === 0
    }));
    mocks.publishSiteDraft.mockResolvedValue({ success: true, idempotent: false });
    mocks.restoreSiteVersion.mockResolvedValue({ success: true });
  });

  it('does not call protected RPCs for Free and loads the first Pro history page', async () => {
    render(<EcommerceSiteBuilderFoundation isPro={false} />);
    expect(mocks.getSiteBuilderState).not.toHaveBeenCalled();
    render(<EcommerceSiteBuilderFoundation isPro />);
    await screen.findByText('Restaurar v1');
    expect(mocks.listSiteVersions).toHaveBeenCalledWith({ limit: 20, offset: 0 });
  });

  it('publishes, restores as draft, and requests the next metadata page', async () => {
    render(<EcommerceSiteBuilderFoundation isPro />);
    await screen.findByText('Restaurar v1');
    fireEvent.click(screen.getByText('Publicar base'));
    await waitFor(() => expect(mocks.publishSiteDraft).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Restaurar v1'));
    await waitFor(() => expect(mocks.restoreSiteVersion).toHaveBeenCalledWith('version-1'));
    fireEvent.click(screen.getByText('Ver más'));
    await waitFor(() => expect(mocks.listSiteVersions).toHaveBeenCalledWith({ limit: 20, offset: 1 }));
  });
});
