// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';

const mocks = vi.hoisted(() => ({
  storage: { isVolatile: true, isCritical: false, persistenceState: 'denied', isRequestingPersistence: false },
  setStorageCritical: vi.fn(),
  setVolatileDismissed: vi.fn(),
  setBackupLoading: vi.fn()
}));

vi.mock('../../../hooks/usePersistentStorage', () => ({ default: () => mocks.storage }));
vi.mock('../../../services/storageManager', () => ({ storageManager: { requestPersistence: vi.fn() } }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    isBackupLoading: false,
    setBackupLoading: mocks.setBackupLoading,
    setStorageCritical: mocks.setStorageCritical,
    isVolatileDismissed: false,
    setVolatileDismissed: mocks.setVolatileDismissed
  })
}));
vi.mock('../../../services/Logger', () => ({ default: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../../../services/dataTransfer', () => ({ downloadBackupSmart: vi.fn() }));
vi.mock('../../../services/utils', () => ({ showMessageModal: vi.fn() }));

import PersistenceWarningBanner from '../PersistenceWarningBanner';
const bannerCss = readFileSync('src/components/common/PersistenceWarningBanner.css', 'utf8');

afterEach(() => {
  cleanup();
  mocks.storage = { isVolatile: true, isCritical: false, persistenceState: 'denied', isRequestingPersistence: false };
  vi.clearAllMocks();
});

describe('PersistenceWarningBanner dismissal boundaries', () => {
  it('keeps a visible dismiss control and supports Escape when focus is inside the normal warning', () => {
    render(<PersistenceWarningBanner />);
    const close = screen.getByRole('button', { name: 'Cerrar aviso de almacenamiento' });
    expect(close).toBeVisible();
    fireEvent.click(close);
    expect(mocks.setVolatileDismissed).toHaveBeenCalledWith(true);
    mocks.setVolatileDismissed.mockClear();
    close.focus();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(mocks.setVolatileDismissed).toHaveBeenCalledWith(true);
    expect(bannerCss).toMatch(/\.persistence-warning-banner\s*\{[^}]*position:\s*relative/u);
    expect(bannerCss).toMatch(/\.banner-btn--dismiss\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/u);
    expect(bannerCss).toContain('env(safe-area-inset-top)');
  });

  it('does not consume Escape from controls outside the normal warning', () => {
    render(<><PersistenceWarningBanner /><button type="button">Control de diálogo</button></>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Control de diálogo' }), { key: 'Escape' });
    expect(mocks.setVolatileDismissed).not.toHaveBeenCalled();
  });

  it('keeps the critical storage lock non-dismissible', () => {
    mocks.storage = { ...mocks.storage, isCritical: true };
    render(<PersistenceWarningBanner />);
    expect(screen.getByRole('heading', { name: 'Operación Pausada: Almacenamiento Crítico' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Descargar Respaldo de Emergencia' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cerrar aviso de almacenamiento' })).not.toBeInTheDocument();
    mocks.setVolatileDismissed.mockClear();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(mocks.setVolatileDismissed).not.toHaveBeenCalled();
  });
});
