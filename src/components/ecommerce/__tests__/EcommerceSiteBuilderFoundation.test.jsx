// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultEcommerceSiteDocument } from '../../../utils/ecommerceSiteDocument';
import EcommerceSiteBuilderFoundation from '../EcommerceSiteBuilderFoundation';

const mocks = vi.hoisted(() => ({
  getSiteBuilderState: vi.fn(), listSiteVersions: vi.fn(), saveSiteDraft: vi.fn(),
  publishSiteDraft: vi.fn(), restoreSiteVersion: vi.fn(), error: vi.fn(), success: vi.fn()
}));

vi.mock('../../../services/ecommerce/ecommerceSiteBuilderService', () => mocks);
vi.mock('react-hot-toast', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('../site/EcommerceSiteRenderer', () => ({ default: ({ siteDocument }) => <output data-testid="preview">{JSON.stringify(siteDocument)}</output> }));

const document = createDefaultEcommerceSiteDocument();
const builder = (overrides = {}) => ({
  success: true,
  draft: { document, revision: 4, documentMode: 'default' },
  published: { versionId: 'version-1', versionNumber: 1 },
  hasUnpublishedChanges: false,
  ...overrides
});
const portal = { name: 'Tienda', slug: 'tienda', templateCode: 'classic', pickupEnabled: true, deliveryEnabled: false };

describe('EcommerceSiteBuilderFoundation', () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSiteBuilderState.mockResolvedValue(builder());
    mocks.listSiteVersions.mockImplementation(({ offset = 0 } = {}) => Promise.resolve({ success: true, versions: offset === 0 ? [{ id: 'version-1', versionNumber: 1, createdAt: '2026-07-21T12:00:00Z', documentMode: 'default' }] : [{ id: 'version-2', versionNumber: 2 }], hasMore: offset === 0 }));
    mocks.saveSiteDraft.mockImplementation(({ document: next }) => Promise.resolve({ success: true, draft: { document: next, revision: 5, documentMode: 'custom' } }));
    mocks.publishSiteDraft.mockResolvedValue({ success: true, idempotent: false });
    mocks.restoreSiteVersion.mockResolvedValue({ success: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('does not call protected RPCs for Free and loads state plus real history for Pro', async () => {
    const { rerender } = render(<EcommerceSiteBuilderFoundation isPro={false} portal={portal} />);
    expect(mocks.getSiteBuilderState).not.toHaveBeenCalled();
    rerender(<EcommerceSiteBuilderFoundation isPro portal={portal} />);
    await screen.findByText('Restaurar v1');
    expect(mocks.getSiteBuilderState).toHaveBeenCalledTimes(1);
    expect(mocks.listSiteVersions).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    expect(screen.getByTestId('preview')).toHaveTextContent('header-main');
  });

  it('updates controls and preview locally, separates indicators, and reverts cleanly without saving', async () => {
    mocks.getSiteBuilderState.mockResolvedValue(builder({ hasUnpublishedChanges: true }));
    render(<EcommerceSiteBuilderFoundation isPro portal={portal} />);
    await screen.findByText('Borrador sin publicar');
    fireEvent.click(screen.getByText('Compacta'));
    expect(screen.getByText('Cambios sin guardar')).toBeTruthy();
    expect(screen.getByTestId('preview')).toHaveTextContent('"density":"compact"');
    expect(mocks.saveSiteDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cómoda'));
    expect(screen.queryByText('Cambios sin guardar')).toBeNull();
    expect(screen.getByText('Borrador sin publicar')).toBeTruthy();
  });

  it('saves exactly the working document and revision, without publishing, then marks it clean', async () => {
    render(<EcommerceSiteBuilderFoundation isPro portal={portal} />);
    await screen.findByText('Guardar borrador');
    fireEvent.click(screen.getByText('Compacta'));
    fireEvent.click(screen.getByText('Guardar borrador'));
    await waitFor(() => expect(mocks.saveSiteDraft).toHaveBeenCalledTimes(1));
    expect(mocks.saveSiteDraft).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 4, document: expect.objectContaining({ global: expect.objectContaining({ density: 'compact' }) }) }));
    expect(mocks.publishSiteDraft).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Revisión del borrador:').parentElement).toHaveTextContent('5'));
    expect(screen.queryByText('Cambios sin guardar')).toBeNull();
  });

  it('keeps local changes on conflict and offers both explicit conflict choices', async () => {
    mocks.saveSiteDraft.mockResolvedValue({ success: false, code: 'ECOMMERCE_SITE_DRAFT_CONFLICT', message: 'El borrador cambió.' });
    render(<EcommerceSiteBuilderFoundation isPro portal={portal} />);
    await screen.findByText('Guardar borrador');
    fireEvent.click(screen.getByText('Compacta'));
    fireEvent.click(screen.getByText('Guardar borrador'));
    await screen.findByText('El borrador cambió en otro dispositivo.');
    expect(screen.getByTestId('preview')).toHaveTextContent('"density":"compact"');
    fireEvent.click(screen.getByText('Conservar mis cambios'));
    expect(screen.getByText('Cambios sin guardar')).toBeTruthy();
  });

  it('blocks publication with local changes and publishes once after saving', async () => {
    render(<EcommerceSiteBuilderFoundation isPro portal={portal} />);
    await screen.findByText('Publicar');
    fireEvent.click(screen.getByText('Compacta'));
    fireEvent.click(screen.getByText('Publicar'));
    expect(mocks.error).toHaveBeenCalledWith('Guarda el borrador antes de publicarlo.');
    expect(mocks.publishSiteDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Guardar borrador'));
    await waitFor(() => expect(screen.queryByText('Cambios sin guardar')).toBeNull());
    const publishButton = screen.getByText('Publicar');
    fireEvent.click(publishButton);
    fireEvent.click(publishButton);
    await waitFor(() => expect(mocks.publishSiteDraft).toHaveBeenCalledTimes(1));
    expect(mocks.success).toHaveBeenCalledWith('Sitio publicado.');
  });

  it('reports idempotent publication with the dedicated message', async () => {
    mocks.publishSiteDraft.mockResolvedValue({ success: true, idempotent: true });
    render(<EcommerceSiteBuilderFoundation isPro portal={portal} />);
    await screen.findByText('Publicar');
    fireEvent.click(screen.getByText('Publicar'));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('La versión publicada ya está vigente.'));
  });

  it('confirms restoration over local changes, never publishes, and reloads the draft', async () => {
    const restored = createDefaultEcommerceSiteDocument({ templateCode: 'compact' });
    mocks.getSiteBuilderState.mockResolvedValueOnce(builder()).mockResolvedValueOnce(builder({ draft: { document: restored, revision: 5 } }));
    render(<EcommerceSiteBuilderFoundation isPro portal={portal} />);
    await screen.findByText('Restaurar v1');
    fireEvent.click(screen.getByText('Compacta'));
    fireEvent.click(screen.getByText('Restaurar v1'));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(mocks.restoreSiteVersion).toHaveBeenCalledWith('version-1');
    await waitFor(() => expect(screen.getByTestId('preview')).toHaveTextContent('"layout":"compact"'));
    expect(mocks.publishSiteDraft).not.toHaveBeenCalled();
  });

  it('uses real offsets, keeps viewport out of the document, resets locally, and manages beforeunload', async () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    render(<EcommerceSiteBuilderFoundation isPro portal={portal} />);
    await screen.findByText('Ver más');
    const before = screen.getByTestId('preview').textContent;
    fireEvent.click(screen.getByText('Móvil'));
    expect(screen.getByTestId('preview').textContent).toBe(before);
    fireEvent.click(screen.getByText('Compacta'));
    expect(add).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    fireEvent.click(screen.getByText('Restablecer diseño base'));
    expect(mocks.saveSiteDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Ver más'));
    await waitFor(() => expect(mocks.listSiteVersions).toHaveBeenCalledWith({ limit: 20, offset: 1 }));
    cleanup();
    expect(remove).toHaveBeenCalledWith('beforeunload', expect.any(Function));
  });
});
