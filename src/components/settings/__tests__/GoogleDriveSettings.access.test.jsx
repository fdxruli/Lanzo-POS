// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  allowed: false,
  oauth: null,
  login: vi.fn(),
  connectDrive: vi.fn(),
  disconnectDrive: vi.fn(),
  assertCurrent: vi.fn()
}));

vi.mock('@react-oauth/google', () => ({
  useGoogleLogin: (options) => {
    state.oauth = options;
    return state.login;
  }
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() }
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector) => selector({
    driveAccessToken: null,
    driveTokenExpiresAt: null,
    isDriveConnected: false,
    needsDriveReauth: false,
    connectDrive: state.connectDrive,
    disconnectDrive: state.disconnectDrive
  })
}));

vi.mock('../../../services/auth/useSettingsAccess', () => ({
  useSettingsAccess: () => ({ canAccessSection: (section) => section === 'backup' && state.allowed }),
  useSettingsActionGuard: () => () => ({ assertCurrent: state.assertCurrent })
}));

vi.mock('../../common/NoPermission', () => ({
  default: () => <div role="alert">No tienes acceso</div>
}));

describe('Google Drive backup permission boundary', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
    state.allowed = false;
    state.oauth = null;
    state.login.mockReset();
    state.connectDrive.mockReset();
    state.disconnectDrive.mockReset();
    state.assertCurrent.mockReset();
    delete window.google;
  });

  it('does not mount Drive controls without the backup section grant', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-google-client');
    const { default: GoogleDriveSettings } = await import('../GoogleDriveSettings');

    render(<GoogleDriveSettings />);

    expect(screen.getByRole('alert')).toHaveTextContent('No tienes acceso');
    expect(screen.queryByRole('button', { name: /conectar google drive/i })).not.toBeInTheDocument();
  });

  it('rejects an OAuth callback after backup permission is revoked', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-google-client');
    state.allowed = true;
    state.assertCurrent
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => { throw new Error('ACTOR_CONTEXT_STALE'); });
    const { default: GoogleDriveSettings } = await import('../GoogleDriveSettings');
    const view = render(<GoogleDriveSettings />);
    const revoke = vi.fn((_token, callback) => callback?.());
    window.google = { accounts: { oauth2: { revoke } } };

    fireEvent.click(screen.getByRole('button', { name: /conectar google drive/i }));
    expect(state.login).toHaveBeenCalledOnce();
    expect(state.assertCurrent).toHaveBeenCalledTimes(1);

    state.allowed = false;
    view.rerender(<GoogleDriveSettings />);
    state.oauth.onSuccess({
      access_token: 'temporary-drive-token',
      expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/drive.file'
    });

    expect(screen.getByRole('alert')).toHaveTextContent('No tienes acceso');
    expect(revoke).toHaveBeenCalledWith('temporary-drive-token', expect.any(Function));
    expect(state.connectDrive).not.toHaveBeenCalled();
  });
});
